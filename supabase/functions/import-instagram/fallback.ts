// No-key Instagram fallback. When IG_OEMBED_TOKEN is not set (or oEmbed fails),
// we try a chain of caption-bearing endpoints in order:
//   1. Instagram's own /embed/captioned/ page — server-rendered for embedders,
//      historically permissive for public posts and includes og:* tags inline.
//   2. The post URL itself with a realistic browser UA — handles edge cases
//      where the embed path doesn't apply (e.g. user already pasted /share/).
//   3. A public mirror (ddinstagram.com) that proxies Instagram and rebuilds
//      OG tags for Discord/Twitter unfurls — works when Instagram blocks our
//      datacenter IPs entirely.
//   4. ScraperAPI (only if SCRAPER_API_KEY is set) — rotates residential IPs
//      to fetch the captioned-embed page. Last-resort for when even the mirror
//      fails. Free tier ~1000 req/mo, suitable for hobby projects.
// Each tier uses a short timeout so the chain stays inside the function budget.

export type OEmbed = {
  title?: string;
  html?: string;
  thumbnail_url?: string;
  author_name?: string;
};

export type FallbackTier = 'captioned_embed' | 'direct' | 'mirror' | 'scraper';

export type FallbackEvent = {
  tier: FallbackTier;
  url: string;
  ok: boolean;
  status?: number;
  ms: number;
  reason?: 'fetch_error' | 'non_ok' | 'no_og';
};

export type FallbackLogger = (event: FallbackEvent) => void;

export type FallbackResult = { oembed: OEmbed; source: FallbackTier };

const PER_FETCH_TIMEOUT_MS = 8_000;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

function browserHeaders(): HeadersInit {
  return {
    'user-agent': BROWSER_UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
  };
}

function mergeSignal(parent: AbortSignal | undefined, ms: number): AbortSignal {
  return parent
    ? AbortSignal.any([parent, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms);
}

// Extract a single og:<key> meta tag's content. Tolerant of attribute order
// (property/content can appear in either order) and quote style.
function og(html: string, key: string): string | undefined {
  const propFirst = new RegExp(
    `<meta[^>]+property=["']og:${key}["'][^>]+content=["']([^"']+)`,
    'i',
  );
  const contentFirst = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${key}["']`,
    'i',
  );
  return propFirst.exec(html)?.[1] ?? contentFirst.exec(html)?.[1];
}

export function parseInstagramHtml(html: string): OEmbed | null {
  const title = og(html, 'title');
  const description = og(html, 'description');
  const image = og(html, 'image');
  if (!title && !description) return null;
  return {
    title: title ?? '',
    html: description ?? '',
    thumbnail_url: image,
  };
}

// /reel/ID/, /p/ID/, /tv/ID/, /reels/ID/ → captioned-embed URL on instagram.com.
// Returns null for anything we don't recognise so callers can fall through.
export function captionedEmbedUrl(postUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(postUrl);
  } catch {
    return null;
  }
  if (!u.hostname.endsWith('instagram.com')) return null;
  const m = u.pathname.match(/^\/(reel|reels|p|tv)\/([^/]+)\/?/i);
  if (!m) return null;
  const kind = m[1].toLowerCase() === 'reels' ? 'reel' : m[1].toLowerCase();
  return `https://www.instagram.com/${kind}/${m[2]}/embed/captioned/`;
}

// Public mirror that rebuilds og:* tags from Instagram. Used by Discord/Twitter
// embedders. Last-resort: bypasses datacenter-IP blocks but is third-party.
export function mirrorUrl(postUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(postUrl);
  } catch {
    return null;
  }
  if (!u.hostname.endsWith('instagram.com')) return null;
  return `https://www.ddinstagram.com${u.pathname}`;
}

// ScraperAPI proxy URL. Wraps the captioned-embed URL because that's the
// caption-richest variant — fetching it through residential IPs sidesteps the
// datacenter blocks that affect all three other tiers. Returns null when no
// API key is configured or the URL isn't an Instagram post we can rewrite.
export function scraperUrl(postUrl: string, apiKey: string | undefined): string | null {
  if (!apiKey) return null;
  const target = captionedEmbedUrl(postUrl);
  if (!target) return null;
  return `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(target)}`;
}

async function fetchAsHtml(
  url: string,
  tier: FallbackTier,
  parent?: AbortSignal,
  logger?: FallbackLogger,
): Promise<OEmbed | null> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(url, {
      headers: browserHeaders(),
      redirect: 'follow',
      signal: mergeSignal(parent, PER_FETCH_TIMEOUT_MS),
    });
  } catch {
    logger?.({
      tier,
      url,
      ok: false,
      ms: Math.round(performance.now() - t0),
      reason: 'fetch_error',
    });
    return null;
  }
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    logger?.({ tier, url, ok: false, status: res.status, ms, reason: 'non_ok' });
    return null;
  }
  const html = await res.text();
  const parsed = parseInstagramHtml(html);
  if (!parsed) {
    logger?.({ tier, url, ok: false, status: res.status, ms, reason: 'no_og' });
    return null;
  }
  logger?.({ tier, url, ok: true, status: res.status, ms });
  return parsed;
}

export async function fetchOgFallback(
  url: string,
  parent?: AbortSignal,
  logger?: FallbackLogger,
  scraperApiKey?: string,
): Promise<FallbackResult | null> {
  const embed = captionedEmbedUrl(url);
  if (embed) {
    const oe = await fetchAsHtml(embed, 'captioned_embed', parent, logger);
    if (oe) return { oembed: oe, source: 'captioned_embed' };
  }
  const direct = await fetchAsHtml(url, 'direct', parent, logger);
  if (direct) return { oembed: direct, source: 'direct' };
  const mirror = mirrorUrl(url);
  if (mirror) {
    const oe = await fetchAsHtml(mirror, 'mirror', parent, logger);
    if (oe) return { oembed: oe, source: 'mirror' };
  }
  const scraper = scraperUrl(url, scraperApiKey);
  if (scraper) {
    const oe = await fetchAsHtml(scraper, 'scraper', parent, logger);
    if (oe) return { oembed: oe, source: 'scraper' };
  }
  return null;
}
