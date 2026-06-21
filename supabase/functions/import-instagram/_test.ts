// Tests for the keyless Instagram caption fetch via /embed/captioned/. The
// fetch is exercised via installMockFetch so we can assert which endpoint is
// hit and how failures (non-2xx, login walls, network errors) are surfaced.

import { assert, assertEquals } from "jsr:@std/assert";
import { installMockFetch } from "../_shared/mock_fetch.ts";
import {
  buildEmbedUrl,
  decodeEntities,
  extractShortcode,
  type FetchEvent,
  fetchInstagramCaption,
  parseCaptionedEmbed,
} from "./fallback.ts";

const REEL_URL = "https://www.instagram.com/reel/DX6MMYWOn3Z/?igsh=abcd";
const EMBED_URL =
  "https://www.instagram.com/p/DX6MMYWOn3Z/embed/captioned/";

// Mirrors the shape of Instagram's /embed/captioned/ markup: an
// EmbeddedMediaImage cover, then a Caption div with a CaptionUsername anchor,
// the caption text (with <br /> line breaks), then a nested CaptionComments div.
function embedHtml(
  opts: { username?: string; caption?: string; image?: string },
): string {
  const userAnchor = opts.username
    ? `<a class="CaptionUsername" href="https://www.instagram.com/${opts.username}/?utm_source=ig_embed" target="_blank">${opts.username}</a><br /><br />`
    : "";
  const img = opts.image
    ? `<img class="EmbeddedMediaImage" alt="cover" src="${opts.image}" />`
    : "";
  return `<!doctype html><html><body>${img}<div class="Caption">${userAnchor}${
    opts.caption ?? ""
  }<div class="CaptionComments"><a class="CaptionComments">12 comments</a></div></div></body></html>`;
}

function htmlResponse(html: string, init: ResponseInit = {}): Response {
  return new Response(html, {
    ...init,
    headers: { "content-type": "text/html", ...(init.headers ?? {}) },
  });
}

Deno.test("decodeEntities: decodes named, decimal and hex entities", () => {
  assertEquals(decodeEntities("Tom &amp; Jerry"), "Tom & Jerry");
  assertEquals(decodeEntities("&quot;quoted&quot;"), '"quoted"');
  assertEquals(decodeEntities("it&#39;s"), "it's");
  assertEquals(decodeEntities("&#8226; bullet"), "• bullet");
  assertEquals(decodeEntities("lime &#x1f34b;"), "lime \u{1f34b}");
});

Deno.test("decodeEntities: leaves unknown / malformed entities untouched", () => {
  assertEquals(decodeEntities("a &bogus; b"), "a &bogus; b");
  assertEquals(decodeEntities("5 &lt; 10 in math"), "5 < 10 in math");
});

Deno.test("extractShortcode: handles reel, p, reels, tv and username prefixes", () => {
  assertEquals(
    extractShortcode("https://www.instagram.com/reel/DX6MMYWOn3Z/?igsh=ab"),
    "DX6MMYWOn3Z",
  );
  assertEquals(
    extractShortcode("https://www.instagram.com/p/AbC-1_2/"),
    "AbC-1_2",
  );
  assertEquals(
    extractShortcode("https://instagram.com/reels/XyZ123/"),
    "XyZ123",
  );
  assertEquals(
    extractShortcode("https://www.instagram.com/thechef/reel/DYh1L_XMEBa/"),
    "DYh1L_XMEBa",
  );
  assertEquals(extractShortcode("https://www.instagram.com/thechef/"), null);
});

Deno.test("buildEmbedUrl: normalises to the /p/ captioned embed", () => {
  assertEquals(
    buildEmbedUrl("DX6MMYWOn3Z"),
    "https://www.instagram.com/p/DX6MMYWOn3Z/embed/captioned/",
  );
});

Deno.test("parseCaptionedEmbed: extracts caption, author and thumbnail", () => {
  const oe = parseCaptionedEmbed(
    embedHtml({
      username: "thechef",
      caption:
        "ZINGY LIME CURD<br />&#8226; 1 egg &amp; honey<br /><br />Bake at 190C",
      image: "https://cdn.test/cover.jpg?a=1&amp;b=2",
    }),
  );
  assert(oe);
  assertEquals(oe.author, "thechef");
  assertEquals(oe.caption, "ZINGY LIME CURD\n• 1 egg & honey\n\nBake at 190C");
  assertEquals(oe.thumbnailUrl, "https://cdn.test/cover.jpg?a=1&b=2");
});

Deno.test("parseCaptionedEmbed: works without a username anchor", () => {
  const oe = parseCaptionedEmbed(
    embedHtml({ caption: "Just a caption<br />line two" }),
  );
  assert(oe);
  assertEquals(oe.author, undefined);
  assertEquals(oe.caption, "Just a caption\nline two");
});

Deno.test("parseCaptionedEmbed: returns null when there is no Caption block", () => {
  assertEquals(
    parseCaptionedEmbed("<html><body>login required</body></html>"),
    null,
  );
});

Deno.test("parseCaptionedEmbed: returns null on an empty caption", () => {
  assertEquals(parseCaptionedEmbed(embedHtml({ username: "thechef" })), null);
});

Deno.test("fetchInstagramCaption: fetches the captioned embed and returns the caption", async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url === EMBED_URL,
      response: htmlResponse(
        embedHtml({
          username: "thechef",
          caption: "Tomato tarte recipe<br />2 tomatoes",
          image: "https://cdn.test/cover.jpg",
        }),
      ),
    },
  ]);
  const oe = await fetchInstagramCaption(REEL_URL);
  assert(oe);
  assertEquals(oe.caption, "Tomato tarte recipe\n2 tomatoes");
  assertEquals(oe.author, "thechef");
  assertEquals(mock.calls.length, 1);
  // The fetch must hit the /p/ captioned embed, not the (walled) post page.
  assertEquals(mock.calls[0].url, EMBED_URL);
  // Sanity: the fetch must use a realistic browser UA, not DishtonBot. Instagram
  // returns 401/403 to non-browser UAs from datacenter IPs in production.
  const ua = mock.calls[0].headers.get("user-agent") ?? "";
  assert(/Mozilla/.test(ua), `expected browser UA, got: ${ua}`);
});

Deno.test("fetchInstagramCaption: returns null and logs no_shortcode for a non-post URL", async () => {
  using mock = installMockFetch([{ match: () => true, response: htmlResponse("") }]);
  const events: FetchEvent[] = [];
  const oe = await fetchInstagramCaption(
    "https://www.instagram.com/thechef/",
    undefined,
    (e) => events.push(e),
  );
  assertEquals(oe, null);
  assertEquals(mock.calls.length, 0);
  assertEquals(events.length, 1);
  assertEquals(events[0].reason, "no_shortcode");
});

Deno.test("fetchInstagramCaption: returns null and logs non_ok on a 4xx", async () => {
  using _mock = installMockFetch([
    { match: () => true, response: new Response("forbidden", { status: 403 }) },
  ]);
  const events: FetchEvent[] = [];
  const oe = await fetchInstagramCaption(
    REEL_URL,
    undefined,
    (e) => events.push(e),
  );
  assertEquals(oe, null);
  assertEquals(events.length, 1);
  assertEquals(events[0].ok, false);
  assertEquals(events[0].status, 403);
  assertEquals(events[0].reason, "non_ok");
});

Deno.test("fetchInstagramCaption: returns null and logs no_caption on a login wall (200, no Caption block)", async () => {
  using _mock = installMockFetch([
    {
      match: () => true,
      response: htmlResponse("<html><body>login required</body></html>"),
    },
  ]);
  const events: FetchEvent[] = [];
  const oe = await fetchInstagramCaption(
    REEL_URL,
    undefined,
    (e) => events.push(e),
  );
  assertEquals(oe, null);
  assertEquals(events.length, 1);
  assertEquals(events[0].ok, false);
  assertEquals(events[0].status, 200);
  assertEquals(events[0].reason, "no_caption");
});

Deno.test("fetchInstagramCaption: returns null and logs fetch_error when the request throws", async () => {
  using _mock = installMockFetch([
    {
      match: () => true,
      response: () => {
        throw new TypeError("network down");
      },
    },
  ]);
  const events: FetchEvent[] = [];
  const oe = await fetchInstagramCaption(
    REEL_URL,
    undefined,
    (e) => events.push(e),
  );
  assertEquals(oe, null);
  assertEquals(events.length, 1);
  assertEquals(events[0].ok, false);
  assertEquals(events[0].reason, "fetch_error");
});
