import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Condition = { type: string; key: string; value: string };
type Rewrite = {
  source: string;
  destination: string;
  has?: Condition[];
  missing?: Condition[];
};

const config = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'),
) as { rewrites: Rewrite[] };

// vercel.json UA values are RE2 (Go) patterns with a leading (?i) flag; strip
// that one construct and use a JS 'i' flag instead. Any other inline flag would
// silently mis-translate (and thus mis-route), so fail loudly if one appears.
function uaRegex(value: string): RegExp {
  const body = value.replace(/^\(\?i\)/, '');
  if (body.includes('(?i)')) {
    throw new Error(`unsupported inline flag in UA pattern: ${value}`);
  }
  return new RegExp(body, 'i');
}

const shareRules = config.rewrites.filter((r) => r.source === '/r/:token');
const allow = uaRegex(shareRules.find((r) => r.has)?.has?.[0]?.value ?? '(?!)');
const browserish = uaRegex(shareRules.find((r) => r.missing)?.missing?.[0]?.value ?? '(?!)');

// Mirrors Vercel's first-match-wins evaluation: rule 1 fires when the UA
// matches the allowlist; rule 2 ("missing" mozilla) fires when the UA has no
// mozilla token. Either one sends the request to the Edge Function. This OR
// model is valid only because both rules share one destination; if they ever
// diverged, this would need sequential if-else.
function routedToEdge(ua: string): boolean {
  return allow.test(ua) || !browserish.test(ua);
}

const BROWSERS: [string, string][] = [
  [
    'Chrome desktop',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  ],
  [
    'Safari iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ],
  ['Firefox', 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0'],
  [
    'Android Chrome',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  ],
  [
    'LinkedIn in-app',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.0.0',
  ],
  [
    'Facebook in-app',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0]',
  ],
  [
    'Instagram in-app',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.0',
  ],
];

const AGENTS: [string, string][] = [
  ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  [
    'GPTBot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot',
  ],
  ['ChatGPT-User', 'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com)'],
  ['ClaudeBot', 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'],
  [
    'PerplexityBot',
    'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  ],
  ['Bytespider', 'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)'],
  ['Google-Extended', 'Mozilla/5.0 (compatible; Google-Extended/1.0)'],
  [
    'facebookexternalhit',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  ],
  ['WhatsApp', 'WhatsApp/2.23.20.0'],
  ['curl', 'curl/8.6.0'],
  ['python-requests', 'python-requests/2.32.3'],
  ['empty UA', ''],
];

describe('public share /r/:token routing', () => {
  it.each(BROWSERS)('routes %s to the SPA', (name, ua) => {
    expect(routedToEdge(ua), name).toBe(false);
  });
  it.each(AGENTS)('routes %s to the Edge Function', (name, ua) => {
    expect(routedToEdge(ua), name).toBe(true);
  });
});
