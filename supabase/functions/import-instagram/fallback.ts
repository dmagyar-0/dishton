// No-key Instagram fallback. When IG_OEMBED_TOKEN is not set (or oEmbed fails),
// we try a chain of caption-bearing endpoints in order:
//   1. Instagram's own /embed/captioned/ page — server-rendered for embedders,
//      historically permissive for public posts and includes og:* tags inline.
//   2. The post URL itself with a realistic browser UA — handles edge cases
//      where the embed path doesn't apply (e.g. user already pasted /share/).
//   3. A public mirror (ddinstagram.com) that proxies Instagram and rebuilds
//      OG tags for Discord/Twitter unfurls — last-resort for when Instagram
//      blocks our datacenter IPs entirely.
// Each tier uses a short timeout so the chain stays inside the function budget.

export type OEmbed = {
  title?: string;
  html?: string;
  thumbnail_url?: string;
  author_name?: string;
};

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

async function fetchAsHtml(
  url: string,
  parent?: AbortSignal,
): Promise<OEmbed | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: browserHeaders(),
      redirect: 'follow',
      signal: mergeSignal(parent, PER_FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const html = await res.text();
  return parseInstagramHtml(html);
}

export async function fetchOgFallback(
  url: string,
  parent?: AbortSignal,
): Promise<OEmbed | null> {
  const embed = captionedEmbedUrl(url);
  if (embed) {
    const oe = await fetchAsHtml(embed, parent);
    if (oe) return oe;
  }
  const direct = await fetchAsHtml(url, parent);
  if (direct) return direct;
  const mirror = mirrorUrl(url);
  if (mirror) {
    const oe = await fetchAsHtml(mirror, parent);
    if (oe) return oe;
  }
  return null;
}
