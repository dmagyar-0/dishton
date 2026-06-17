#!/usr/bin/env bash
# Capture a full visual snapshot of Dishton's UI from the latest `main`, record
# the synced commit, summarise UI/UX-affecting changes since the last sync, and
# commit everything to the `design-sync` branch.
#
# Run from anywhere inside the repo:  bash .claude/skills/design-synch/run.sh
#
# Environment setup (docker / supabase CLI / playwright) mirrors the
# validating-features-visually skill — see that SKILL.md for the rationale.

# Re-exec from a /tmp copy so `git checkout main` (which can remove this file
# when the skill lives on a feature branch) cannot pull the script out from
# under the running shell.
if [ "${DS_REEXEC:-}" != "1" ]; then
  _self_dir="$(cd "$(dirname "$0")" && pwd)"
  _self_tmp="$(mktemp -d)/run.sh"
  cp "$_self_dir/run.sh" "$_self_tmp"
  DS_REEXEC=1 DS_SKILL_DIR="$_self_dir" exec bash "$_self_tmp" "$@"
fi

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
SKILL_DIR="${DS_SKILL_DIR:?re-exec must set DS_SKILL_DIR}"
SYNC_BRANCH="design-sync"
SPEC_DST="$ROOT/e2e/_design-snapshot.spec.ts"
ORIG_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
OUT_DIR="$(mktemp -d)"
SHOTS_DIR="$OUT_DIR/screenshots"

log() { printf '\n=== %s ===\n' "$1"; }

# Print an OS-native absolute path (Windows form via cygpath; POSIX as-is) so
# emitted screenshot locations are easy to open, not MSYS /tmp paths.
native_path() {
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) cygpath -w "$1" 2>/dev/null || printf '%s' "$1" ;;
    *) printf '%s' "$1" ;;
  esac
}

# Snapshot the capture spec now, before any `git checkout main`, so the skill
# can live on a feature branch and still snapshot main's app code.
SPEC_TMP="$(mktemp -d)/_design-snapshot.spec.ts"
cp "$SKILL_DIR/capture.spec.ts" "$SPEC_TMP"

stop_preview() {
  pkill -f 'vite preview' 2>/dev/null || true
  command -v fuser >/dev/null 2>&1 && fuser -k 4173/tcp 2>/dev/null || true
  [ -f /tmp/preview.pid ] && kill "$(cat /tmp/preview.pid)" 2>/dev/null || true
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      # vite/node can outlive the pnpm pid on Windows; free the port by listener PID.
      _pp="$(netstat -ano 2>/dev/null | grep -E ':4173 .*LISTENING' | awk '{print $NF}' | head -1 || true)"
      [ -n "${_pp:-}" ] && taskkill //PID "$_pp" //F >/dev/null 2>&1 || true
      ;;
  esac
}

# Safety net that runs on ANY exit (success or failure): restore the dev's real
# .env.local (the snapshot overwrites it) and drop the throwaway spec, so a real
# dev machine is never left damaged by a mid-run failure. No-op in the sandbox,
# where there is no pre-existing .env.local.
ENVLOCAL_BAK=""
ENVLOCAL_WROTE=""
cleanup_safety() {
  stop_preview
  rm -f "$SPEC_DST" 2>/dev/null || true
  if [ -n "$ENVLOCAL_BAK" ]; then
    mv -f "$ENVLOCAL_BAK" "$ROOT/.env.local" 2>/dev/null || true
  elif [ -n "$ENVLOCAL_WROTE" ]; then
    rm -f "$ROOT/.env.local" 2>/dev/null || true
  fi
}
trap cleanup_safety EXIT

# --- 0. Previous synced hash (read from the design-sync branch, if it exists) ---
log "Reading previous sync state"
git fetch origin --quiet 2>/dev/null || true
PREV_HASH="$(git show "origin/$SYNC_BRANCH:design-sync/manifest.json" 2>/dev/null \
  | sed -n 's/.*"main_hash": *"\([0-9a-f]\{7,40\}\)".*/\1/p' | head -1 || true)"
echo "Previous synced main hash: ${PREV_HASH:-<none — first sync>}"

# --- 1. Update to latest main (in-place; caller's branch restored at step 11) ---
log "Pulling latest main"
git checkout main
git pull origin main
MAIN_HASH="$(git rev-parse HEAD)"
MAIN_SHORT="$(git rev-parse --short HEAD)"
echo "Snapshotting main @ $MAIN_HASH"

# --- 2. Prerequisites (idempotent; safe to re-run) ---
log "Ensuring docker / supabase CLI / playwright"
# Bring the Docker engine up if it isn't already — mechanism is OS-specific.
if ! docker info >/dev/null 2>&1; then
  case "$(uname -s)" in
    Linux) sudo dockerd >/tmp/dockerd.log 2>&1 & ;;
    Darwin) open -a Docker 2>/dev/null || true ;;
    MINGW* | MSYS* | CYGWIN*)
      # Git Bash on Windows: the daemon lives inside Docker Desktop's VM.
      _pf="$(cygpath -u "${PROGRAMFILES:-C:\\Program Files}" 2>/dev/null || echo '/c/Program Files')"
      for _dd in "$_pf/Docker/Docker/Docker Desktop.exe" \
                 "/c/Program Files/Docker/Docker/Docker Desktop.exe"; do
        if [ -f "$_dd" ]; then ("$_dd" >/dev/null 2>&1 &); break; fi
      done
      ;;
  esac
fi
# Wait (bounded) for the engine rather than looping forever if it never comes up.
_waited=0
until docker info >/dev/null 2>&1; do
  sleep 2
  _waited=$((_waited + 2))
  if [ "$_waited" -ge 180 ]; then
    echo "ERROR: Docker engine not ready after 180s. Start Docker and re-run." >&2
    exit 1
  fi
done
if ! command -v supabase >/dev/null 2>&1; then
  mkdir -p "$HOME/.local/share/supabase"
  curl -sL "https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz" \
    | tar -xzf - -C "$HOME/.local/share/supabase"
fi
export PATH="$HOME/.local/share/supabase:$PATH"
pnpm install --frozen-lockfile
# --with-deps installs Linux OS packages and errors on macOS/Windows.
if [ "$(uname -s)" = "Linux" ]; then
  pnpm exec playwright install chromium --with-deps >/dev/null
else
  pnpm exec playwright install chromium >/dev/null
fi

# --- 3. Boot local stack (trimmed: the SPA never touches studio/pg-meta/mailpit) ---
# edge-runtime is excluded for the sandbox rlimit; studio/postgres-meta/mailpit are
# admin/email-only infra, so dropping them is fewer containers to boot + healthcheck.
SUPA_EXCLUDE="edge-runtime,studio,postgres-meta,mailpit"
log "Starting Supabase (trimmed services)"
if ! supabase start -x "$SUPA_EXCLUDE"; then
  # Most common local failure: a stale data volume from an older CLI whose
  # Postgres major version no longer matches config.toml (e.g. PG15 vs PG17),
  # which leaves the db container "unhealthy". Clearing the volume fixes it, and
  # is safe because the very next step is `supabase db reset` anyway.
  echo "supabase start failed — clearing local volumes (stale Postgres?) and retrying once"
  supabase stop --no-backup >/dev/null 2>&1 || true
  supabase start -x "$SUPA_EXCLUDE"
fi

# Read connection keys now — they're derived from config.toml and stable across a
# db reset, so reading them before the reseed lets the SPA build run in parallel.
STATUS_JSON="$(supabase status -o json)"
# Key names drift across CLI versions (ANON_KEY/PUBLISHABLE_KEY,
# SERVICE_ROLE_KEY/SECRET_KEY) — try each.
read_status() {
  node -e '
    const s = JSON.parse(process.argv[1]);
    for (const k of process.argv.slice(2)) if (s[k]) { process.stdout.write(s[k]); break; }
  ' "$STATUS_JSON" "$@"
}
API_URL="$(read_status API_URL)"
ANON_KEY="$(read_status ANON_KEY PUBLISHABLE_KEY)"
SERVICE_KEY="$(read_status SERVICE_ROLE_KEY SECRET_KEY)"

# --- 4. Point the SPA at local Supabase (the build needs only this, not the seed) ---
# Preserve a real .env.local before clobbering it; the EXIT trap restores it.
if [ -f "$ROOT/.env.local" ] && [ -z "$ENVLOCAL_BAK" ]; then
  ENVLOCAL_BAK="$(mktemp)"
  cp "$ROOT/.env.local" "$ENVLOCAL_BAK"
fi
ENVLOCAL_WROTE=1
cat > "$ROOT/.env.local" <<EOF
VITE_SUPABASE_URL=$API_URL
VITE_SUPABASE_ANON_KEY=$ANON_KEY
VITE_FEATURE_GOOGLE_AUTH=false
VITE_FEATURE_INSTAGRAM_IMPORT=true
VITE_FEATURE_TRANSLATION_CACHE=true
EOF

# --- 5. Build the SPA WHILE the DB reseeds (they're independent → overlap the two
# slowest steps), then serve the built output. Skip the package build's `tsc -b`:
# a snapshot needs the app to render, not type-check, and `main` already passed CI.
log "Building SPA + reseeding DB (in parallel)"
(pnpm exec vite build >/tmp/ds-build.log 2>&1) &
_buildpid=$!
supabase db reset    # recreate + re-apply migrations + supabase/seed.sql
if ! wait "$_buildpid"; then
  echo "ERROR: vite build failed —" >&2
  cat /tmp/ds-build.log >&2
  exit 1
fi
cat /tmp/ds-build.log

# Seed is loaded now → bump alice's 8-char seed password to the >=10 the SPA login
# requires, via the Auth admin API (no psql dependency).
log "Bumping seeded user password for login"
curl -fsS -X PUT "$API_URL/auth/v1/admin/users/00000000-0000-0000-0000-000000000001" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"password":"test-password-1234"}' >/dev/null

log "Serving preview"
pnpm preview --host 127.0.0.1 --port 4173 >/tmp/preview.log 2>&1 &
echo $! > /tmp/preview.pid
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:4173 >/dev/null 2>&1 && break || sleep 1
done

# --- 6. Capture every route + state, desktop AND mobile ---
log "Capturing screenshots"
mkdir -p "$SHOTS_DIR/desktop" "$SHOTS_DIR/mobile"
cp "$SPEC_TMP" "$SPEC_DST"
SNAPSHOT_DIR="$SHOTS_DIR" PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 \
  pnpm exec playwright test e2e/_design-snapshot.spec.ts --reporter=list || true

DESKTOP_COUNT="$(find "$SHOTS_DIR/desktop" -name '*.png' | wc -l | tr -d ' ')"
MOBILE_COUNT="$(find "$SHOTS_DIR/mobile" -name '*.png' | wc -l | tr -d ' ')"
echo "Captured: $DESKTOP_COUNT desktop, $MOBILE_COUNT mobile"

# --- 7. UI/UX changelog since last sync ---
log "Generating UI/UX changelog"
# Paths whose changes can affect what the user sees.
UI_PATHS=(src/ui src/routes src/feature-flags src/domain
          'src/lib/i18n*.ts' 'src/**/*.css' 'src/index.css'
          tailwind.config.ts tailwind.config.js postcss.config.js
          index.html public)
{
  echo "# UI/UX changes since last design sync"
  echo
  echo "- Snapshot of \`main\` @ \`$MAIN_SHORT\` ($MAIN_HASH)"
  if [ -n "$PREV_HASH" ]; then
    echo "- Previous sync: \`$PREV_HASH\`"
    echo "- Range: \`$PREV_HASH..$MAIN_HASH\`"
    echo
    echo "## Commits touching UI-affecting paths"
    echo
    git log --no-merges --pretty='- %s (%h)' "$PREV_HASH..$MAIN_HASH" -- "${UI_PATHS[@]}" 2>/dev/null \
      || echo "_(unable to compute commit range)_"
    echo
    echo "## Files changed (UI-affecting paths)"
    echo '```'
    git diff --stat "$PREV_HASH..$MAIN_HASH" -- "${UI_PATHS[@]}" 2>/dev/null || true
    echo '```'
  else
    echo "- Previous sync: none — this is the first design sync, so everything is new."
  fi
} > "$OUT_DIR/CHANGELOG.md"

# --- 8. Manifest the design web app consumes ---
log "Writing manifest"
PREV_JSON="null"; [ -n "$PREV_HASH" ] && PREV_JSON="\"$PREV_HASH\""
node - "$SHOTS_DIR" > "$OUT_DIR/manifest.json" <<NODE
const fs = require('fs'), path = require('path');
const shots = process.argv[2];
const list = (d) => fs.existsSync(d) ? fs.readdirSync(d).filter(f=>f.endsWith('.png')).sort() : [];
const manifest = {
  generated_at: new Date().toISOString(),
  main_hash: "$MAIN_HASH",
  main_short: "$MAIN_SHORT",
  previous_main_hash: $PREV_JSON,
  changelog: "CHANGELOG.md",
  screenshots: {
    desktop: list(path.join(shots,'desktop')).map(f=>'screenshots/desktop/'+f),
    mobile:  list(path.join(shots,'mobile')).map(f=>'screenshots/mobile/'+f),
  },
};
process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
NODE

# Keep a stable copy in the repo's PARENT dir — just outside the repo, so it
# survives branch operations, is easy to open, and is never git-tracked. Derived
# from the repo root to stay portable across machines (Linux sandbox included);
# on a Windows checkout this lands at <...>\Documents\dishton\design-sync-artifacts.
ARTIFACTS="$(dirname "$ROOT")/design-sync-artifacts"
# Flatten into ONE folder for easy browsing: CHANGELOG.md + every screenshot,
# each named <viewport>-<shot>.png (desktop-/mobile-) so the two viewports —
# which share identical base names — don't collide. (The design-sync branch
# keeps the nested screenshots/{desktop,mobile}/ layout its manifest.json indexes.)
rm -rf "$ARTIFACTS" && mkdir -p "$ARTIFACTS"
cp "$OUT_DIR/CHANGELOG.md" "$ARTIFACTS/" 2>/dev/null || true
for _vp in desktop mobile; do
  for _png in "$OUT_DIR/screenshots/$_vp"/*.png; do
    [ -e "$_png" ] && cp "$_png" "$ARTIFACTS/$_vp-$(basename "$_png")"
  done
done
# Emit the OS-native absolute path as soon as the screenshots land, so they're
# easy to open without hunting through the MSYS /tmp mount.
ARTIFACTS_NATIVE="$(native_path "$ARTIFACTS")"
log "Screenshots saved (flat: CHANGELOG.md + all screenshots in one folder)"
echo "  $ARTIFACTS_NATIVE"
echo "  $DESKTOP_COUNT desktop + $MOBILE_COUNT mobile PNGs (desktop-*/mobile-* prefixed)"

# --- 8b. Record the last sync on `main` itself, so the default branch shows when
# design-synch last captured a NEW commit (just timestamp + hashes — the
# screenshots stay on the design-sync branch). We're on `main` here (step 1
# checked it out), so this commits the marker to main; only commit when the
# snapshotted commit actually changed, to avoid timestamp-only churn on reruns. ---
MARKER="$ROOT/.claude/skills/design-synch/last-sync.json"
RECORDED_HASH="$(git show "HEAD:.claude/skills/design-synch/last-sync.json" 2>/dev/null \
  | sed -n 's/.*"main_hash": *"\([0-9a-f]\{7,40\}\)".*/\1/p' | head -1 || true)"
if [ "$RECORDED_HASH" != "$MAIN_HASH" ]; then
  log "Recording last-sync marker on main"
  node - > "$MARKER" <<NODE
process.stdout.write(JSON.stringify({
  last_synced_at: new Date().toISOString(),
  main_hash: "$MAIN_HASH",
  main_short: "$MAIN_SHORT",
  previous_main_hash: $PREV_JSON,
}, null, 2) + '\n');
NODE
  git add "$MARKER"
  git commit -q -m "design-synch: synced main @ $MAIN_SHORT"
  echo "Recorded last-sync marker on main — push with: git push origin main"
else
  echo "Last-sync marker already at $MAIN_SHORT — left unchanged."
fi

# --- 9. Tear down the stack (spec + .env.local handled by the EXIT trap) ---
log "Cleaning up stack"
stop_preview
supabase stop || true
rm -f /tmp/preview.pid

# --- 10. Commit artifacts to the design-sync branch via an ISOLATED worktree ---
# The main working tree is never switched onto design-sync, so the caller's
# branch and tree are never disturbed.
log "Committing to $SYNC_BRANCH branch (isolated worktree)"
WT="$(mktemp -d)/sync-wt"
git worktree prune
if git show-ref --verify --quiet "refs/remotes/origin/$SYNC_BRANCH"; then
  git worktree add -B "$SYNC_BRANCH" "$WT" "origin/$SYNC_BRANCH"
else
  # First sync: branch off main, then strip code so the tip holds only design-sync/.
  git worktree add -B "$SYNC_BRANCH" "$WT" HEAD
  git -C "$WT" rm -rqf . >/dev/null 2>&1 || true
fi
mkdir -p "$WT/design-sync"
rm -rf "${WT:?}/design-sync"/*
cp -r "$OUT_DIR/." "$WT/design-sync/"
git -C "$WT" add -A
git -C "$WT" commit -q -m "Design snapshot of main @ $MAIN_SHORT" || echo "Nothing new to commit."
git worktree remove --force "$WT"

# --- 11. Restore the caller's branch ---
log "Restoring $ORIG_BRANCH"
git checkout "$ORIG_BRANCH"

log "Done"
echo "Screenshots: $ARTIFACTS_NATIVE"
echo "  $DESKTOP_COUNT desktop + $MOBILE_COUNT mobile PNGs (desktop-*/mobile-* prefixed), flat in one folder"
echo "Also committed on local branch '$SYNC_BRANCH' (design-sync/screenshots/)."
echo "Push with: git push -u origin $SYNC_BRANCH"
echo "Synced main hash recorded: $MAIN_HASH"
