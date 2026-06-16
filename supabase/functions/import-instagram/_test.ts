// Tests for the direct, no-key Instagram caption fetch. The fetch is exercised
// via installMockFetch so we can assert which endpoint is hit and how failures
// (non-2xx, login walls, network errors) are surfaced.

import { assert, assertEquals } from "jsr:@std/assert";
import { installMockFetch } from "../_shared/mock_fetch.ts";
import {
  decodeEntities,
  fetchDirectCaption,
  type FetchEvent,
  parseInstagramHtml,
} from "./fallback.ts";

const REEL_URL = "https://www.instagram.com/reel/DX6MMYWOn3Z/?igsh=abcd";

function htmlWithOg(
  parts: { title?: string; description?: string; image?: string },
): string {
  const tags: string[] = [];
  if (parts.title) {
    tags.push(`<meta property="og:title" content="${parts.title}" />`);
  }
  if (parts.description) {
    tags.push(
      `<meta property="og:description" content="${parts.description}" />`,
    );
  }
  if (parts.image) {
    tags.push(`<meta property="og:image" content="${parts.image}" />`);
  }
  return `<!doctype html><html><head>${
    tags.join("")
  }</head><body></body></html>`;
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

Deno.test("parseInstagramHtml: extracts and decodes og:title, og:description, og:image", () => {
  const oe = parseInstagramHtml(
    htmlWithOg({
      title: "Jena on Instagram: &quot;ZINGY LIME&quot;",
      description: "&#8226; 1 egg &amp; honey",
      image: "https://example.test/cover.jpg?a=1&amp;b=2",
    }),
  );
  assert(oe);
  assertEquals(oe.title, 'Jena on Instagram: "ZINGY LIME"');
  assertEquals(oe.html, "• 1 egg & honey");
  assertEquals(oe.thumbnail_url, "https://example.test/cover.jpg?a=1&b=2");
});

Deno.test("parseInstagramHtml: returns null when both title and description are missing", () => {
  const oe = parseInstagramHtml("<html><head></head><body>no og</body></html>");
  assertEquals(oe, null);
});

Deno.test("parseInstagramHtml: tolerates content-before-property attribute order", () => {
  const html =
    '<meta content="A caption" property="og:description"><meta content="A title" property="og:title">';
  const oe = parseInstagramHtml(html);
  assert(oe);
  assertEquals(oe.title, "A title");
  assertEquals(oe.html, "A caption");
});

Deno.test("parseInstagramHtml: captures multi-line caption content", () => {
  const caption = "ZINGY LIME\nLime Curd\n• 1 egg\n• honey";
  const oe = parseInstagramHtml(
    `<meta property="og:description" content="${caption}" />`,
  );
  assert(oe);
  assertEquals(oe.html, caption);
});

Deno.test("fetchDirectCaption: returns the caption on a 200 with og tags", async () => {
  using mock = installMockFetch([
    {
      match: (req) =>
        req.url.startsWith("https://www.instagram.com/reel/DX6MMYWOn3Z/"),
      response: htmlResponse(
        htmlWithOg({
          title: "@chef on Instagram",
          description: "Tomato tarte recipe",
          image: "https://example.test/cover.jpg",
        }),
      ),
    },
  ]);
  const oe = await fetchDirectCaption(REEL_URL);
  assert(oe);
  assertEquals(oe.html, "Tomato tarte recipe");
  assertEquals(mock.calls.length, 1);
  assertEquals(mock.calls[0].url, REEL_URL);
  // Sanity: the fetch must use a realistic browser UA, not DishtonBot. Instagram
  // returns 401/403 to non-browser UAs from datacenter IPs in production.
  const ua = mock.calls[0].headers.get("user-agent") ?? "";
  assert(/Mozilla/.test(ua), `expected browser UA, got: ${ua}`);
});

Deno.test("fetchDirectCaption: returns null and logs non_ok on a 4xx", async () => {
  using _mock = installMockFetch([
    { match: () => true, response: new Response("forbidden", { status: 403 }) },
  ]);
  const events: FetchEvent[] = [];
  const oe = await fetchDirectCaption(
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

Deno.test("fetchDirectCaption: returns null and logs no_og on a login wall (200, no og tags)", async () => {
  using _mock = installMockFetch([
    {
      match: () => true,
      response: htmlResponse("<html><body>login required</body></html>"),
    },
  ]);
  const events: FetchEvent[] = [];
  const oe = await fetchDirectCaption(
    REEL_URL,
    undefined,
    (e) => events.push(e),
  );
  assertEquals(oe, null);
  assertEquals(events.length, 1);
  assertEquals(events[0].ok, false);
  assertEquals(events[0].status, 200);
  assertEquals(events[0].reason, "no_og");
});

Deno.test("fetchDirectCaption: returns null and logs fetch_error when the request throws", async () => {
  using _mock = installMockFetch([
    {
      match: () => true,
      response: () => {
        throw new TypeError("network down");
      },
    },
  ]);
  const events: FetchEvent[] = [];
  const oe = await fetchDirectCaption(
    REEL_URL,
    undefined,
    (e) => events.push(e),
  );
  assertEquals(oe, null);
  assertEquals(events.length, 1);
  assertEquals(events[0].ok, false);
  assertEquals(events[0].reason, "fetch_error");
});
