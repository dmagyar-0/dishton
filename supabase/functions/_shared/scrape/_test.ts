// Unit tests for the JSON-LD recipe extractor. Run via `pnpm test:edge`.

import { assert, assertEquals } from 'jsr:@std/assert';
import { parseHTML } from 'npm:linkedom@0.18';
import { extractRecipeJsonLd, type ScrapeDoc } from './recipe-jsonld.ts';

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
