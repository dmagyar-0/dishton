// Tests for AI_MOCK_MODE. The key guarantee: when AI_MOCK_MODE is set, aiChat
// and callAndValidate return canned fixture output and make NO network call.
// Run via `pnpm test:edge`.

import { assert, assertEquals } from 'jsr:@std/assert';
import { Recipe } from '../domain/recipe.ts';
import { aiChat } from './client.ts';
import { callAndValidate, callValidateThenTranslate } from './validate.ts';
import { isMockMode } from './mock.ts';
import { structuringFromHtml, translatePrompt } from './prompts.ts';

// Install a fetch that fails loudly if any code attempts a network call, so a
// regression that hits api.anthropic.com in mock mode is caught immediately.
function withNoNetwork<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    called = true;
    throw new Error(`unexpected network call in mock mode: ${String(input)}`);
  }) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
    assertEquals(called, false, 'fetch must not be called in mock mode');
  });
}

function setMock(on: boolean): void {
  if (on) Deno.env.set('AI_MOCK_MODE', '1');
  else Deno.env.delete('AI_MOCK_MODE');
}

Deno.test('isMockMode reflects the AI_MOCK_MODE env var', () => {
  setMock(false);
  assertEquals(isMockMode(), false);
  setMock(true);
  assertEquals(isMockMode(), true);
  Deno.env.set('AI_MOCK_MODE', 'playwright');
  assertEquals(isMockMode(), true);
  Deno.env.set('AI_MOCK_MODE', '0');
  assertEquals(isMockMode(), false);
  setMock(false);
});

Deno.test('aiChat returns the draft fixture in mock mode without a network call', async () => {
  setMock(true);
  try {
    const result = await withNoNetwork(() =>
      aiChat({
        lane: 'text',
        estimatedTokens: 100,
        messages: structuringFromHtml({
          html: '<html></html>',
          sourceUrl: 'https://example.test/r',
          allowedTags: [],
        }),
      })
    );
    assertEquals(result.model, 'mock');
    assert(result.tool_input, 'expected tool_input to be set');
    const parsed = Recipe.safeParse(result.tool_input);
    assert(parsed.success, 'mock draft must parse as a Recipe');
    assertEquals(parsed.data.title, 'Tomato Tarte Tatin');
  } finally {
    setMock(false);
  }
});

Deno.test('callAndValidate returns ok with the mock recipe and no network call', async () => {
  setMock(true);
  try {
    const result = await withNoNetwork(() =>
      callAndValidate({
        lane: 'text',
        estimatedTokens: 100,
        messages: structuringFromHtml({
          html: '<html></html>',
          sourceUrl: 'https://example.test/r',
          allowedTags: [],
        }),
      })
    );
    assert(result.ok, 'expected ok validation result');
    if (result.ok) {
      assertEquals(result.model, 'mock');
      assertEquals(result.recipe.title, 'Tomato Tarte Tatin');
    }
  } finally {
    setMock(false);
  }
});

Deno.test('mock mode returns the German fixture for a translate prompt', async () => {
  setMock(true);
  try {
    const result = await withNoNetwork(() =>
      aiChat({
        lane: 'text',
        estimatedTokens: 100,
        messages: translatePrompt({ recipeJson: '{}', targetLanguage: 'de' }),
      })
    );
    const parsed = Recipe.safeParse(result.tool_input);
    assert(parsed.success);
    assertEquals(parsed.data.title, 'Tomaten-Tarte-Tatin');
    // A translation stores the recipe under the TARGET language, not the source.
    assertEquals(parsed.data.source_language, 'de');
  } finally {
    setMock(false);
  }
});

// Regression: the import pipeline translates THROUGH the extract_recipe tool
// (translateExtractedRecipe), whose system prompt opens "You translate an
// already-parsed recipe …". The mock's translate detector previously only
// matched the display-path prompt ("You translate a Dishton recipe …"), so the
// import-path translation went unrecognised and every cross-language import came
// back as the untranslated English fixture. Drive the real import path end to
// end (structuring + translation) in mock mode and assert the recipe lands in
// the chosen language.
function htmlStructuring() {
  return {
    lane: 'text' as const,
    estimatedTokens: 100,
    messages: structuringFromHtml({
      html: '<html></html>',
      sourceUrl: 'https://example.test/r',
      allowedTags: [],
    }),
  };
}

Deno.test('mock mode: cross-language import lands the recipe in the chosen language', async () => {
  setMock(true);
  try {
    const result = await withNoNetwork(() => callValidateThenTranslate(htmlStructuring(), 'hu'));
    assert(result.ok, JSON.stringify(result));
    if (result.ok) {
      // Before the fix this was 'en' (the translation pass was a no-op).
      assertEquals(result.recipe.source_language, 'hu');
    }
  } finally {
    setMock(false);
  }
});

Deno.test('mock mode: German import returns translated German strings', async () => {
  setMock(true);
  try {
    const result = await withNoNetwork(() => callValidateThenTranslate(htmlStructuring(), 'de'));
    assert(result.ok, JSON.stringify(result));
    if (result.ok) {
      assertEquals(result.recipe.title, 'Tomaten-Tarte-Tatin');
      assertEquals(result.recipe.source_language, 'de');
    }
  } finally {
    setMock(false);
  }
});

Deno.test('mock mode: same-language (en) import is not altered by the translate path', async () => {
  setMock(true);
  try {
    const result = await withNoNetwork(() => callValidateThenTranslate(htmlStructuring(), 'en'));
    assert(result.ok, JSON.stringify(result));
    if (result.ok) {
      assertEquals(result.recipe.title, 'Tomato Tarte Tatin');
      assertEquals(result.recipe.source_language, 'en');
    }
  } finally {
    setMock(false);
  }
});
