// String-level HTML noise stripper for the import-url LLM input. Unlike
// Mozilla's Readability — which scores DOM nodes and keeps a single "article"
// — this function removes only known-noise elements (scripts, styles, head,
// SVG/picture/iframe, comments, link/meta/source) and leaves everything else
// intact. The model receives structured HTML (e.g. <ul class="ingredients">,
// flex grids with quantity/unit/name divs) instead of textContent that has
// lost the structure.
//
// Why not Readability? On Yoast/JSON-LD-clean sites (allrecipes, BBC) it
// works fine. On JS-framework recipe pages (Next.js, hydrated React) it
// scores the ingredient list — typically rendered as a checkbox shopping
// grid — *below* surrounding editorial copy and prunes it. We've seen this
// turn a 19-ingredient recipe into a 1-ingredient recipe in production
// (streetkitchen.hu). See docs/superpowers/specs for the full analysis.

const STRIP_BLOCK_TAGS = [
  'script',
  'style',
  'svg',
  'noscript',
  'head',
  'picture',
  'iframe',
  'template',
] as const;

const STRIP_VOID_TAGS = ['link', 'meta', 'base', 'source'] as const;

const BLOCK_PATTERNS = STRIP_BLOCK_TAGS.map(
  (t) => new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?<\\/${t}>`, 'gi'),
);

const VOID_PATTERN = new RegExp(
  `<(?:${STRIP_VOID_TAGS.join('|')})\\b[^>]*\\/?>`,
  'gi',
);

const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

// Multiple whitespace chars (including newlines) collapsed to a single space.
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Removes script/style/svg/noscript/head/picture/iframe/template blocks,
 * void link/meta/base/source tags, HTML comments, and collapses whitespace.
 * Leaves all other tags (including <input>, <form>, <table>) intact so the
 * model can use them as structural signals.
 */
export function lightStripHtml(html: string): string {
  let out = html;
  for (const re of BLOCK_PATTERNS) out = out.replace(re, '');
  out = out.replace(VOID_PATTERN, '');
  out = out.replace(COMMENT_PATTERN, '');
  out = out.replace(WHITESPACE_PATTERN, ' ').trim();
  return out;
}
