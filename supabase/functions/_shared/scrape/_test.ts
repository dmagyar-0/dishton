// Unit tests for the JSON-LD recipe extractor and lightStripHtml.
// Run via `pnpm test:edge`.

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { parseHTML } from 'npm:linkedom@0.18';
import { extractRecipeJsonLd, type ScrapeDoc } from './recipe-jsonld.ts';
import { lightStripHtml } from './strip-html.ts';

// linkedom's exported types expose parseHTML as returning Window without a
// statically-typed `.document`; in production the property is real. Cast
// through unknown to ScrapeDoc so tests type-check.
function parseDoc(html: string): ScrapeDoc {
  return (parseHTML(html) as unknown as { document: ScrapeDoc }).document;
}

function docFromJsonLd(jsonLd: unknown): ScrapeDoc {
  const html = `<!doctype html><html><head><script type="application/ld+json">${
    JSON.stringify(jsonLd)
  }</script></head><body></body></html>`;
  return parseDoc(html);
}

Deno.test('extracts a top-level Recipe node', () => {
  const doc = docFromJsonLd({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'Tomato Tarte',
    description: 'A savoury tarte.',
    recipeYield: '4 servings',
    totalTime: 'PT45M',
    recipeIngredient: ['500 g tomatoes', '1 sheet puff pastry'],
    recipeInstructions: ['Preheat oven.', 'Bake 30 min.'],
    image: 'https://example.test/tarte.jpg',
    inLanguage: 'en',
  });
  const r = extractRecipeJsonLd(doc);
  assert(r);
  assertEquals(r.name, 'Tomato Tarte');
  assertEquals(r.description, 'A savoury tarte.');
  assertEquals(r.yield, '4 servings');
  assertEquals(r.total_time_min, 45);
  assertEquals(r.ingredients, ['500 g tomatoes', '1 sheet puff pastry']);
  assertEquals(r.instructions, ['Preheat oven.', 'Bake 30 min.']);
  assertEquals(r.image, 'https://example.test/tarte.jpg');
  assertEquals(r.language, 'en');
});

Deno.test('finds Recipe nested inside @graph (Yoast / WordPress)', () => {
  const doc = docFromJsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', name: 'Page' },
      {
        '@type': 'Recipe',
        name: 'Graph Recipe',
        recipeIngredient: ['1 egg'],
        recipeInstructions: 'Crack and fry.',
      },
    ],
  });
  const r = extractRecipeJsonLd(doc);
  assert(r);
  assertEquals(r.name, 'Graph Recipe');
  assertEquals(r.ingredients, ['1 egg']);
  assertEquals(r.instructions, ['Crack and fry.']);
});

Deno.test('flattens HowToSection > HowToStep instructions (NYT-style)', () => {
  const doc = docFromJsonLd({
    '@type': 'Recipe',
    name: 'Sectioned',
    recipeInstructions: [
      {
        '@type': 'HowToSection',
        name: 'Prep',
        itemListElement: [
          { '@type': 'HowToStep', text: 'Chop onions.' },
          { '@type': 'HowToStep', text: 'Mince garlic.' },
        ],
      },
      {
        '@type': 'HowToSection',
        name: 'Cook',
        itemListElement: [
          { '@type': 'HowToStep', text: 'Sauté in oil.' },
        ],
      },
    ],
  });
  const r = extractRecipeJsonLd(doc);
  assert(r);
  assertEquals(r.instructions, ['Chop onions.', 'Mince garlic.', 'Sauté in oil.']);
});

Deno.test('handles @type as array containing Recipe', () => {
  const doc = docFromJsonLd({
    '@type': ['Recipe', 'NewsArticle'],
    name: 'Hybrid',
    recipeIngredient: ['flour'],
  });
  const r = extractRecipeJsonLd(doc);
  assert(r);
  assertEquals(r.name, 'Hybrid');
  assertEquals(r.ingredients, ['flour']);
});

Deno.test('parses ISO 8601 durations correctly', () => {
  const cases: Array<[string, number | null]> = [
    ['PT1H30M', 90],
    ['PT45M', 45],
    ['PT2H', 120],
    ['P1DT2H', 1560],
    ['PT0S', null],
    ['', null],
    ['garbage', null],
    ['30 min', null],
  ];
  for (const [input, expected] of cases) {
    const doc = docFromJsonLd({ '@type': 'Recipe', name: 'x', totalTime: input });
    const r = extractRecipeJsonLd(doc);
    assert(r);
    assertEquals(r.total_time_min, expected, `for input ${JSON.stringify(input)}`);
  }
});

Deno.test('returns null on malformed JSON without throwing', () => {
  const html = `<!doctype html><html><head>
    <script type="application/ld+json">{ this is not json </script>
  </head><body></body></html>`;
  const doc = parseDoc(html);
  assertEquals(extractRecipeJsonLd(doc), null);
});

Deno.test('returns null when no Recipe node exists', () => {
  const doc = docFromJsonLd({
    '@type': 'WebPage',
    name: 'Just a page',
  });
  assertEquals(extractRecipeJsonLd(doc), null);
});

Deno.test('returns null when there is no JSON-LD at all', () => {
  const html = `<!doctype html><html><body><h1>No structured data</h1></body></html>`;
  const doc = parseDoc(html);
  assertEquals(extractRecipeJsonLd(doc), null);
});

Deno.test('skips malformed scripts and finds Recipe in a later one', () => {
  const html = `<!doctype html><html><head>
    <script type="application/ld+json">{ broken </script>
    <script type="application/ld+json">${JSON.stringify({
    '@type': 'Recipe',
    name: 'Found Me',
    recipeIngredient: ['salt'],
  })}</script>
  </head><body></body></html>`;
  const doc = parseDoc(html);
  const r = extractRecipeJsonLd(doc);
  assert(r);
  assertEquals(r.name, 'Found Me');
});

Deno.test('normalizes image as string, array, and ImageObject', () => {
  const cases: Array<[unknown, string | null]> = [
    ['https://a.test/x.jpg', 'https://a.test/x.jpg'],
    [['https://a.test/x.jpg', 'https://a.test/y.jpg'], 'https://a.test/x.jpg'],
    [{ '@type': 'ImageObject', url: 'https://a.test/z.jpg' }, 'https://a.test/z.jpg'],
    [null, null],
    [{}, null],
  ];
  for (const [input, expected] of cases) {
    const doc = docFromJsonLd({ '@type': 'Recipe', name: 'x', image: input });
    const r = extractRecipeJsonLd(doc);
    assert(r);
    assertEquals(r.image, expected);
  }
});

Deno.test('merges and dedupes recipeKeywords, recipeCategory, recipeCuisine', () => {
  const doc = docFromJsonLd({
    '@type': 'Recipe',
    name: 'x',
    recipeKeywords: 'easy, weeknight, italian',
    recipeCategory: ['main course'],
    recipeCuisine: 'Italian',
  });
  const r = extractRecipeJsonLd(doc);
  assert(r);
  // dedupe is case-insensitive — italian and Italian collapse, first wins
  assertEquals(r.keywords, ['easy', 'weeknight', 'italian', 'main course']);
});

Deno.test('extracts author name from string and Person object', () => {
  const a = docFromJsonLd({ '@type': 'Recipe', name: 'x', author: 'Jane Cook' });
  assertEquals(extractRecipeJsonLd(a)?.author, 'Jane Cook');

  const b = docFromJsonLd({
    '@type': 'Recipe',
    name: 'x',
    author: { '@type': 'Person', name: 'John Chef' },
  });
  assertEquals(extractRecipeJsonLd(b)?.author, 'John Chef');

  const c = docFromJsonLd({
    '@type': 'Recipe',
    name: 'x',
    author: [{ '@type': 'Person', name: 'First Author' }],
  });
  assertEquals(extractRecipeJsonLd(c)?.author, 'First Author');
});

Deno.test('returns numeric recipeYield as string', () => {
  const doc = docFromJsonLd({ '@type': 'Recipe', name: 'x', recipeYield: 6 });
  assertEquals(extractRecipeJsonLd(doc)?.yield, '6');
});

// ----- lightStripHtml -----

Deno.test('lightStripHtml removes script blocks', () => {
  const out = lightStripHtml('<p>keep</p><script>var x = 1;</script><p>also keep</p>');
  assertStringIncludes(out, 'keep');
  assertStringIncludes(out, 'also keep');
  assertEquals(out.includes('var x'), false);
  assertEquals(out.includes('<script>'), false);
});

Deno.test('lightStripHtml removes style/svg/noscript/iframe/picture/template/head blocks', () => {
  const html = `
    <head><title>t</title><style>.x{color:red}</style></head>
    <body>
      <noscript>js disabled</noscript>
      <svg><path d="M0 0"/></svg>
      <iframe src="https://ads"></iframe>
      <picture><source srcset="x.webp"/><img src="x.jpg"/></picture>
      <template>tpl</template>
      <p>content</p>
    </body>
  `;
  const out = lightStripHtml(html);
  assertStringIncludes(out, 'content');
  assertEquals(out.includes('color:red'), false);
  assertEquals(out.includes('<svg'), false);
  assertEquals(out.includes('<iframe'), false);
  assertEquals(out.includes('<picture'), false);
  assertEquals(out.includes('<template'), false);
  assertEquals(out.includes('<title'), false);
  assertEquals(out.includes('js disabled'), false);
});

Deno.test('lightStripHtml removes self-closing link/meta/base/source tags', () => {
  const html = '<link rel="x" href="y"/><meta name="a" content="b"><base href="/"/><p>hi</p>';
  const out = lightStripHtml(html);
  assertEquals(out, '<p>hi</p>');
});

Deno.test('lightStripHtml removes HTML comments', () => {
  const html = '<p>before</p><!-- secret --><p>after</p>';
  const out = lightStripHtml(html);
  assertEquals(out.includes('secret'), false);
  assertStringIncludes(out, 'before');
  assertStringIncludes(out, 'after');
});

Deno.test('lightStripHtml collapses whitespace runs into single spaces', () => {
  const html = '<p>a</p>\n\n\n<p>b</p>     <p>c</p>\t\t';
  const out = lightStripHtml(html);
  assertEquals(out, '<p>a</p> <p>b</p> <p>c</p>');
});

Deno.test('lightStripHtml preserves <input>, <form>, <table>, attributes', () => {
  const html = '<form><input type="checkbox" id="x"/><div class="font-bold">salt</div></form>';
  const out = lightStripHtml(html);
  assertStringIncludes(out, '<input');
  assertStringIncludes(out, 'type="checkbox"');
  assertStringIncludes(out, 'class="font-bold"');
  assertStringIncludes(out, 'salt');
});

Deno.test('lightStripHtml handles script with newlines and complex attrs', () => {
  const html = `<p>ok</p><script
    type="application/ld+json"
    data-foo="x">
      var s = "</wrong>";
  </script><p>after</p>`;
  const out = lightStripHtml(html);
  assertStringIncludes(out, 'ok');
  assertStringIncludes(out, 'after');
  assertEquals(out.includes('var s'), false);
});
