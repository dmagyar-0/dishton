import { assert, assertEquals } from '@std/assert';
import { type OgElement, buildOgElement } from './og.ts';

function flatten(el: OgElement, acc: OgElement[] = []): OgElement[] {
  acc.push(el);
  const children = el.props.children;
  const arr = Array.isArray(children) ? children : children != null ? [children] : [];
  for (const c of arr) {
    if (c && typeof c === 'object' && 'type' in c) flatten(c as OgElement, acc);
  }
  return acc;
}

Deno.test('og card with a hero image splits into text + image panes', () => {
  const el = buildOgElement({
    title: 'Tomato Tarte Tatin',
    householdName: 'The Pantry',
    metaLine: '4 servings · 55 min · 3 ingredients',
    heroSrc: 'data:image/jpeg;base64,abc',
  });
  const nodes = flatten(el);
  assert(nodes.some((n) => n.type === 'img' && n.props.src === 'data:image/jpeg;base64,abc'));
  const texts = nodes.flatMap((n) =>
    typeof n.props.children === 'string' ? [n.props.children] : [],
  );
  assert(texts.includes('Tomato Tarte Tatin'));
  assert(texts.some((t) => t.includes('The Pantry')));
  assert(texts.includes('4 servings · 55 min · 3 ingredients'));
  assert(texts.includes('Dishton'));
});

Deno.test('og card without a hero renders no img node', () => {
  const el = buildOgElement({
    title: 'Limoncello',
    householdName: "Carol's Kitchen",
    metaLine: '12 servings · 1440 min · 3 ingredients',
    heroSrc: null,
  });
  assertEquals(
    flatten(el).some((n) => n.type === 'img'),
    false,
  );
});
