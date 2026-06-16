// Direct, no-key Instagram caption fetch. Fetches the public post URL with a
// realistic browser UA and reads the caption out of the page's og:title /
// og:description meta tags. No API keys required.
//
// History: this was once a multi-tier chain (Instagram oEmbed via token, the
// /embed/captioned/ page, this direct fetch, a ddinstagram.com mirror, and
// ScraperAPI). As of 2026-06 the other keyless tiers stopped working — the
// captioned-embed page no longer emits og tags and the ddinstagram.com mirror's
// domain stopped resolving — and the keyed tiers need secrets we don't have. The
// direct fetch still returns the full caption in the og:* tags, so it is the
// only path we keep.

export type OEmbed = {
  title?: string;
  html?: string;
  thumbnail_url?: string;
  author_name?: string;
};

export type FetchEvent = {
  url: string;
  ok: boolean;
  status?: number;
  ms: number;
  reason?: "fetch_error" | "non_ok" | "no_og";
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

// Decode the HTML entities Instagram emits inside og:* attribute values:
// named (&amp; &quot; &#39;), decimal (&#8226;) and hex (&#x1f34b;). The
// caption arrives encoded, and og:image URLs carry &amp; that must become &
// for the link to resolve.
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

// Extract a single og:<key> meta tag's content. Tolerant of attribute order
// (property/content can appear in either order) and quote style. The content
// value may span newlines (multi-line captions), which the negated character
// class handles.
function og(html: string, key: string): string | undefined {
  const propFirst = new RegExp(
    `<meta[^>]+property=["']og:${key}["'][^>]+content=["']([^"']+)`,
    "i",
  );
  const contentFirst = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${key}["']`,
    "i",
  );
  return propFirst.exec(html)?.[1] ?? contentFirst.exec(html)?.[1];
}

export function parseInstagramHtml(html: string): OEmbed | null {
  const title = og(html, "title");
  const description = og(html, "description");
  const image = og(html, "image");
  if (!title && !description) return null;
  return {
    title: title ? decodeEntities(title) : "",
    html: description ? decodeEntities(description) : "",
    thumbnail_url: image ? decodeEntities(image) : undefined,
  };
}

// Fetch the post URL directly and parse the caption out of its og:* tags.
// Returns null (and logs a reason) when the fetch errors, returns non-2xx, or
// returns a page without og tags (e.g. a login/consent wall).
export async function fetchDirectCaption(
  url: string,
  parent?: AbortSignal,
  logger?: FetchLogger,
): Promise<OEmbed | null> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(url, {
      headers: browserHeaders(),
      redirect: "follow",
      signal: mergeSignal(parent, PER_FETCH_TIMEOUT_MS),
    });
  } catch {
    logger?.({
      url,
      ok: false,
      ms: Math.round(performance.now() - t0),
      reason: "fetch_error",
    });
    return null;
  }
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    logger?.({ url, ok: false, status: res.status, ms, reason: "non_ok" });
    return null;
  }
  const html = await res.text();
  const parsed = parseInstagramHtml(html);
  if (!parsed) {
    logger?.({ url, ok: false, status: res.status, ms, reason: "no_og" });
    return null;
  }
  logger?.({ url, ok: true, status: res.status, ms });
  return parsed;
}
