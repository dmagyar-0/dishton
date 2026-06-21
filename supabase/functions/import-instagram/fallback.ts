// Keyless Instagram caption fetch via the public /embed/captioned/ page.
//
// Why the embed page and not the post page: as of 2026-06 Instagram serves a
// logged-out wall (no og:* tags) to fetches of the post URL itself from
// datacenter IPs — which is where our Edge Function egresses — so the previous
// direct og-tag scrape fails with `no_og` for every post (prod import_jobs
// show `instagram_unavailable` for every Instagram import since ~2026-06-16,
// failing fast at the scrape phase). The /embed/captioned/ surface is built to
// be server-rendered by third-party sites, so Instagram still returns it
// (caption included) to datacenter IPs where the post page is walled. We fetch
//   https://www.instagram.com/p/<shortcode>/embed/captioned/
// and read the caption out of the rendered `<div class="Caption">` block and
// the cover image out of `<img class="EmbeddedMediaImage">`. No API keys, no
// cookies.
//
// History: the pipeline was once a multi-tier chain — Instagram oEmbed via
// IG_OEMBED_TOKEN, the captioned-embed page, a direct og-tag fetch, a
// ddinstagram.com mirror, and ScraperAPI. #143 reduced it to the direct og-tag
// fetch and dropped the embed tier on the belief that "the captioned-embed page
// no longer emits og tags" — that is true, but the caption is still rendered in
// the Caption div, so the embed tier keeps working where the og-tag fetch now
// fails from a datacenter IP. This restores it as the single keyless path.

export type EmbedResult = {
  caption: string;
  author?: string;
  thumbnailUrl?: string;
};

export type FetchEvent = {
  url: string;
  ok: boolean;
  status?: number;
  ms: number;
  reason?: "no_shortcode" | "fetch_error" | "non_ok" | "no_caption";
};

export type FetchLogger = (event: FetchEvent) => void;

const PER_FETCH_TIMEOUT_MS = 8_000;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

function browserHeaders(): HeadersInit {
  return {
    "user-agent": BROWSER_UA,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
  };
}

function mergeSignal(parent: AbortSignal | undefined, ms: number): AbortSignal {
  return parent
    ? AbortSignal.any([parent, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Decode the HTML entities Instagram emits inside the embed markup: named
// (&amp; &quot; &#39;), decimal (&#8226;) and hex (&#x1f34b;). The caption
// arrives encoded, and the cover-image URL carries &amp; that must become & for
// the link to resolve.
export function decodeEntities(input: string): string {
  return input.replace(
    /&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi,
    (match, body: string) => {
      if (body[0] === "#") {
        const hex = body[1] === "x" || body[1] === "X";
        const code = hex
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      const named = NAMED_ENTITIES[body.toLowerCase()];
      return named ?? match;
    },
  );
}

// Pull the shortcode out of a post / reel / tv / reels URL, tolerating an
// optional leading /<username>/ segment and any trailing query string.
export function extractShortcode(url: string): string | null {
  const m =
    /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i
      .exec(url);
  return m?.[1] ?? null;
}

// The /p/ embed form works for every post type (posts, reels, tv), so we
// normalise to it rather than carrying the original path segment through.
export function buildEmbedUrl(shortcode: string): string {
  return `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
}

// Convert an HTML caption fragment to plain text: <br> becomes a newline,
// remaining tags are dropped, entities decoded, and runs of blank lines
// collapsed.
function htmlToText(fragment: string): string {
  const withNewlines = fragment
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(withNewlines)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractThumbnail(html: string): string | undefined {
  const imgTag = /<img[^>]*EmbeddedMediaImage[^>]*>/i.exec(html)?.[0];
  if (!imgTag) return undefined;
  const src = /\ssrc=["']([^"']+)["']/i.exec(imgTag)?.[1];
  return src ? decodeEntities(src) : undefined;
}

// Parse the rendered caption out of a /embed/captioned/ page. The Caption div
// holds: <a class="CaptionUsername">handle</a> then the caption text, then a
// nested <div class="CaptionComments"> we stop at. Returns null when there is
// no Caption block (a login wall) or the caption is empty.
export function parseCaptionedEmbed(html: string): EmbedResult | null {
  const capStart = html.indexOf('class="Caption"');
  if (capStart < 0) return null;
  const contentStart = html.indexOf(">", capStart);
  if (contentStart < 0) return null;

  let block = html.slice(contentStart + 1);
  const commentsAt = block.indexOf('<div class="CaptionComments"');
  if (commentsAt >= 0) {
    block = block.slice(0, commentsAt);
  } else {
    const closeAt = block.indexOf("</div>");
    if (closeAt >= 0) block = block.slice(0, closeAt);
  }

  // The block opens with the author's handle anchor — capture it, then drop it
  // so it does not lead the caption text.
  const userMatch =
    /<a[^>]*class=["']CaptionUsername["'][^>]*>([^<]*)<\/a>/i.exec(block);
  const author = userMatch ? decodeEntities(userMatch[1]).trim() : undefined;
  const withoutUser = userMatch ? block.replace(userMatch[0], "") : block;

  const caption = htmlToText(withoutUser);
  if (!caption) return null;

  return {
    caption,
    author: author || undefined,
    thumbnailUrl: extractThumbnail(html),
  };
}

// Fetch the /embed/captioned/ page for a post URL and parse its caption.
// Returns null (and logs a reason) when the URL has no shortcode, the fetch
// errors, returns non-2xx, or returns a page without a Caption block.
export async function fetchInstagramCaption(
  url: string,
  parent?: AbortSignal,
  logger?: FetchLogger,
): Promise<EmbedResult | null> {
  const shortcode = extractShortcode(url);
  if (!shortcode) {
    logger?.({ url, ok: false, ms: 0, reason: "no_shortcode" });
    return null;
  }
  const embedUrl = buildEmbedUrl(shortcode);

  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(embedUrl, {
      headers: browserHeaders(),
      redirect: "follow",
      signal: mergeSignal(parent, PER_FETCH_TIMEOUT_MS),
    });
  } catch {
    logger?.({
      url: embedUrl,
      ok: false,
      ms: Math.round(performance.now() - t0),
      reason: "fetch_error",
    });
    return null;
  }
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    logger?.({ url: embedUrl, ok: false, status: res.status, ms, reason: "non_ok" });
    return null;
  }
  const html = await res.text();
  const parsed = parseCaptionedEmbed(html);
  if (!parsed) {
    logger?.({ url: embedUrl, ok: false, status: res.status, ms, reason: "no_caption" });
    return null;
  }
  logger?.({ url: embedUrl, ok: true, status: res.status, ms });
  return parsed;
}
