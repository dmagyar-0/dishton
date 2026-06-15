#!/usr/bin/env bash
# Capture a full visual snapshot of Dishton's UI from the latest `main`, record
# the synced commit, summarise UI/UX-affecting changes since the last sync, and
# commit everything to the `design-sync` branch.
#
# Run from anywhere inside the repo:  bash .claude/skills/capturing-design-snapshot/run.sh
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

# Snapshot the capture spec now, before any `git checkout main`, so the skill
# can live on a feature branch and still snapshot main's app code.
SPEC_TMP="$(mktemp -d)/_design-snapshot.spec.ts"
cp "$SKILL_DIR/capture.spec.ts" "$SPEC_TMP"

stop_preview() {
  pkill -f 'vite preview' 2>/dev/null || true
  command -v fuser >/dev/null 2>&1 && fuser -k 4173/tcp 2>/dev/null || true
  [ -f /tmp/preview.pid ] && kill "$(cat /tmp/preview.pid)" 2>/dev/null || true
}

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
docker info >/dev/null 2>&1 || (sudo dockerd >/tmp/dockerd.log 2>&1 &)
until docker info >/dev/null 2>&1; do sleep 1; done
if ! command -v supabase >/dev/null 2>&1; then
  mkdir -p "$HOME/.local/share/supabase"
  curl -sL "https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz" \
    | tar -xzf - -C "$HOME/.local/share/supabase"
fi
export PATH="$HOME/.local/share/supabase:$PATH"
pnpm install --frozen-lockfile
pnpm exec playwright install chromium --with-deps >/dev/null

# --- 3. Boot local stack + load deterministic seed (alice + recipes + flags) ---
# Only `edge-runtime` is a valid exclude token; functions ride along with it.
log "Starting Supabase (edge-runtime excluded — sandbox rlimit)"
supabase start -x edge-runtime
supabase db reset    # re-applies migrations + supabase/seed.sql

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

# The seed sets alice's password to an 8-char value, but the SPA login requires
# >=10 chars. Bump it via the Auth admin API (no psql dependency).
log "Bumping seeded user password for login"
curl -fsS -X PUT "$API_URL/auth/v1/admin/users/00000000-0000-0000-0000-000000000001" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"password":"test-password-1234"}' >/dev/null

# --- 4. Point the SPA at local Supabase (flags that gate UI surfaces ON) ---
cat > "$ROOT/.env.local" <<EOF
VITE_SUPABASE_URL=$API_URL
VITE_SUPABASE_ANON_KEY=$ANON_KEY
VITE_FEATURE_GOOGLE_AUTH=false
VITE_FEATURE_INSTAGRAM_IMPORT=true
VITE_FEATURE_TRANSLATION_CACHE=true
EOF

# --- 5. Build + preview (PWA caching needs built output, per CLAUDE.md) ---
log "Building + serving preview"
pnpm build
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

# Keep a stable copy outside the repo so it survives branch operations and can
# be forwarded by the caller.
rm -rf /tmp/design-sync-artifacts && cp -r "$OUT_DIR" /tmp/design-sync-artifacts

# --- 9. Tear down the stack + throwaway spec ---
log "Cleaning up stack"
stop_preview
supabase stop || true
rm -f "$SPEC_DST" "$ROOT/.env.local" /tmp/preview.pid

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
echo "Artifacts: /tmp/design-sync-artifacts (also committed on local branch '$SYNC_BRANCH')."
echo "Push with: git push -u origin $SYNC_BRANCH"
echo "Synced main hash recorded: $MAIN_HASH"
