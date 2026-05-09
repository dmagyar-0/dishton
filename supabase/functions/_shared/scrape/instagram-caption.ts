// Shared Instagram caption fetcher. Used by both the production
// import-instagram Edge Function and the eval harness so they can't drift
// apart. Strategy mirrors production: try Facebook Graph oEmbed first when a
// token is provided, fall back to scraping og:title / og:description from the
// public page. Returns `null` when neither path yields a usable caption — the
// caller decides whether that's a hard error (production) or a "skip URL with
// reason `instagram_unavailable`" outcome (eval).

const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = 'DishtonBot/0.1 (+https://dishton.app)';

export type InstagramCaption = {
  caption: string;
  thumbnailUrl: string | null;
  source: 'oembed' | 'og';
};

type OEmbed = {
  title?: string;
  html?: string;
  thumbnail_url?: string | null;
};

function mergeSignal(parent: AbortSignal | undefined, ms: number): AbortSignal {
  return parent
    ? AbortSignal.any([parent, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms);
}

async function fetchOEmbed(
  url: string,
  token: string,
  parent?: AbortSignal,
): Promise<OEmbed | null> {
  const endpoint =
    `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${token}`;
  const res = await fetch(endpoint, { signal: mergeSignal(parent, FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  return (await res.json()) as OEmbed;
}

async function fetchOgFallback(
  url: string,
  parent?: AbortSignal,
): Promise<OEmbed | null> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: mergeSignal(parent, FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const og = (key: string): string | undefined => {
    const m = new RegExp(
      `<meta[^>]+property=["']og:${key}["'][^>]+content=["']([^"']+)`,
      'i',
    ).exec(html);
    return m?.[1];
  };
  const title = og('title');
  const description = og('description');
  const image = og('image');
  if (!description && !title) return null;
  return {
    title: title ?? '',
    html: description ?? '',
    thumbnail_url: image ?? null,
  };
}

function assembleCaption(oe: OEmbed): string {
  return `${oe.title ?? ''}\n\n${(oe.html ?? '').replace(/<[^>]+>/g, '')}`;
}

export async function fetchInstagramCaption(
  url: string,
  opts: { token?: string; signal?: AbortSignal } = {},
): Promise<InstagramCaption | null> {
  let oe: OEmbed | null = null;
  if (opts.token) {
    oe = await fetchOEmbed(url, opts.token, opts.signal);
    if (oe) {
      return {
        caption: assembleCaption(oe),
        thumbnailUrl: oe.thumbnail_url ?? null,
        source: 'oembed',
      };
    }
  }
  oe = await fetchOgFallback(url, opts.signal);
  if (!oe) return null;
  return {
    caption: assembleCaption(oe),
    thumbnailUrl: oe.thumbnail_url ?? null,
    source: 'og',
  };
}

export function isInstagramUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'instagram.com' || host.endsWith('.instagram.com');
}
