// Post-deploy production verification (see the Testing section of CLAUDE.md).
//
// Why this exists: the local stack is seeded by supabase/seed.sql, which a
// deployed project never runs, so anything the seed sets up is invisible to
// every local check. #166 shipped the save-a-followed-recipe surface with unit,
// DB, E2E and a full local visual validation all green while the feature was
// dark in production, because `follows_enabled` only ever existed as a seeded
// row. This script looks at the REAL deployment instead.
//
// Two sandbox problems it works around, so it runs from Claude-Code-on-the-web:
//
//   1. Chromium cannot reach the internet here. The agent proxy relays Node's
//      fetch fine but drops the browser's own tunnels
//      (net::ERR_CONNECTION_RESET / ws_closed_mid_exchange). So every browser
//      request is intercepted and fulfilled from Node instead of dialled by
//      Chromium. The page is still the real production app over the real
//      network -- only the transport differs.
//   2. Production analytics are live. Any signed-in run would write
//      app.analytics_events rows, and app.metrics_active_users counts
//      `distinct profile_id` from that table -- so a smoke run would show up
//      as a real user in the admin dashboard. Writes to that endpoint are
//      blocked, leaving no metrics footprint.
//
// Usage:
//   node scripts/verify-production.mjs                      # anonymous checks
//   PROD_SMOKE_EMAIL=... PROD_SMOKE_PASSWORD=... \
//     node scripts/verify-production.mjs --authed           # + signed-in shots
//
// Options: --base <url> --out <dir> --marker <str> (repeatable) --keep-analytics
//
// Credentials are never stored in this repo. The smoke account's password is
// reset to a fresh random value at run time through the Supabase connector --
// see CLAUDE.md for the procedure.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const BASE = opt('base', 'https://dishton.vercel.app').replace(/\/$/, '');
const OUT = opt('out', 'prod-verification');
const AUTHED = has('authed');
const KEEP_ANALYTICS = has('keep-analytics');
const markers = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--marker' && args[i + 1]) markers.push(args[i + 1]);
}

mkdirSync(OUT, { recursive: true });

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// --- 1. The deployment responds, and the LIVE bundle carries the change. -----

const indexRes = await fetch(`${BASE}/`);
const indexHtml = await indexRes.text();
record('production responds', indexRes.status === 200, `HTTP ${indexRes.status}`);

const bundlePath = (indexHtml.match(/\/assets\/[A-Za-z0-9._-]+\.js/g) ?? [])[0];
record('index references a JS bundle', Boolean(bundlePath), bundlePath ?? 'none found');

let bundle = '';
if (bundlePath) {
  const res = await fetch(`${BASE}${bundlePath}`);
  bundle = await res.text();
  record('bundle downloads', res.status === 200, `${bundlePath} (${bundle.length} bytes)`);
}

// Markers prove the deployed JavaScript actually contains the change, rather
// than inferring it from a green deploy.
for (const m of markers) {
  record(`bundle contains "${m}"`, bundle.includes(m));
}

// --- 2. Render the real thing, via Node-fulfilled requests. -----------------

const { chromium } = await import('@playwright/test');
const executablePath =
  process.env.PROD_VERIFY_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath });

let blockedAnalytics = 0;

async function attachRouting(ctx) {
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (!KEEP_ANALYTICS && req.method() === 'POST' && /\/rest\/v1\/analytics_events/.test(url)) {
      blockedAnalytics++;
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }
    try {
      const res = await fetch(url, {
        method: req.method(),
        headers: req.headers(),
        body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer(),
        redirect: 'follow',
      });
      const body = Buffer.from(await res.arrayBuffer());
      const headers = {};
      res.headers.forEach((v, k) => {
        // fetch already decoded the payload; leaving these makes Chromium
        // try to decode it a second time and render nothing.
        if (!['content-encoding', 'content-length'].includes(k.toLowerCase())) headers[k] = v;
      });
      await route.fulfill({ status: res.status, headers, body });
    } catch (err) {
      console.error(
        `  route error ${req.method()} ${url.slice(0, 90)}: ${String(err).split('\n')[0]}`,
      );
      await route.abort();
    }
  });
}

const VIEWPORTS = [
  ['desktop', { width: 1280, height: 900 }, false],
  ['mobile', { width: 390, height: 844 }, true],
];

async function shoot(page, label) {
  await page.waitForTimeout(2500);
  const file = join(OUT, `${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const text = await page.evaluate(() => document.body.innerText);
  const rawKeys = (text.match(/\b[a-z_]+\.[a-z_]{3,}\b/g) ?? []).filter(
    (k) => !k.includes('.test'),
  );
  record(`${label}: no horizontal overflow`, overflow <= 0, `${overflow}px`);
  record(`${label}: no raw i18n keys`, rawKeys.length === 0, rawKeys.slice(0, 3).join(', '));
  return { file, text };
}

for (const [name, viewport, isMobile] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
  await attachRouting(ctx);
  const page = await ctx.newPage();
  const res = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  record(`${name}: app loads`, (res?.status() ?? 0) < 400, `HTTP ${res?.status()} → ${page.url()}`);
  await shoot(page, `${name}-landing`);

  if (AUTHED) {
    const email = process.env.PROD_SMOKE_EMAIL;
    const password = process.env.PROD_SMOKE_PASSWORD;
    if (!email || !password) {
      record(`${name}: signed-in checks`, false, 'PROD_SMOKE_EMAIL/PASSWORD not set');
    } else {
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.waitForURL(/\/h\//, { timeout: 45000 }).catch(() => {});
      record(`${name}: signed in`, /\/h\//.test(page.url()), page.url());
      await shoot(page, `${name}-own-list`);

      await page.goto(`${BASE}/households`, { waitUntil: 'domcontentloaded' });
      const households = await shoot(page, `${name}-households`);
      record(
        `${name}: followed household listed`,
        /Smoke Source Kitchen/i.test(households.text),
        'expects the smoke fixture',
      );

      const browse = page.getByRole('link', { name: /browse recipes/i }).first();
      if (await browse.isVisible().catch(() => false)) {
        await browse.click();
        const followed = await shoot(page, `${name}-followed-browse`);
        record(
          `${name}: followed-household banner`,
          /Smoke Source Kitchen/i.test(followed.text) &&
            !/Good (morning|afternoon|evening)/i.test(followed.text),
          'names the household, no personal greeting',
        );
        const saveBtn = page.locator('button[aria-label*="Save"]').first();
        const visible = await saveBtn.isVisible().catch(() => false);
        const opacity = visible
          ? await saveBtn.evaluate((el) => getComputedStyle(el).opacity)
          : 'n/a';
        record(
          `${name}: save control visible without hover`,
          visible && opacity === '1',
          `opacity=${opacity}`,
        );

        const link = page.locator('a[href*="/r/"]').first();
        if (await link.isVisible().catch(() => false)) {
          await link.click();
          const detail = await shoot(page, `${name}-followed-recipe`);
          record(
            `${name}: save control on the recipe page`,
            /Save to/i.test(detail.text),
            (detail.text.match(/Save to [^\n]*/i) ?? ['not found'])[0],
          );
        }
      } else {
        record(`${name}: "Browse recipes" control present`, false, 'not visible on /households');
      }
    }
  }
  await ctx.close();
}

await browser.close();

if (!KEEP_ANALYTICS) {
  console.log(`\nBlocked ${blockedAnalytics} analytics write(s) — no metrics footprint.`);
}

const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ base: BASE, results }, null, 2));
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${OUT}/`,
);
if (failed.length > 0) {
  console.error(`\nFailed:\n${failed.map((f) => `  - ${f.name} (${f.detail})`).join('\n')}`);
  process.exit(1);
}
