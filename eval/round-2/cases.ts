// Staged test suite. Each case lazily builds the production prompt messages for
// its lane (URL / caption / image), reusing the real prompt builders from
// supabase/functions/_shared/ai/prompts.ts so the eval feeds models exactly
// what production would.
//
// Stage 1 — simple URL regression (the curated round-1 list).
// Stage 2 — Instagram captions + complex multi-section recipes.
// Stage 3 — the cookbook breakdown matrix photo (use only the middle column).

import type { AiMessage } from '../../supabase/functions/_shared/ai/client.ts';
import {
  structuringFromCaption,
  structuringFromHtml,
  structuringFromImage,
} from '../../supabase/functions/_shared/ai/prompts.ts';
import { fetchAndExtract } from '../nim/fetch.ts';
import { encodeBase64 } from '@std/encoding/base64';
import { extname } from '@std/path';

// Empty whitelist → the model returns tags=[]. Round 2 is not testing the
// household tag whitelist, so we keep it out of the variables.
const ALLOWED_TAGS: string[] = [];

export type CaseKind = 'url' | 'caption' | 'image';
export type BuiltCase = { messages: AiMessage[]; sourceExcerpt: string };

export type EvalCase = {
  id: string;
  stage: 1 | 2 | 3;
  kind: CaseKind;
  label: string;
  goldPath?: string;
  build: () => Promise<BuiltCase>;
};

type MediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
const IMG_MEDIA: Record<string, MediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function mediaType(p: string): MediaType {
  return IMG_MEDIA[extname(p).toLowerCase()] ?? 'image/jpeg';
}

// Reuse the production image prompt verbatim, then swap its placeholder URL
// blocks for base64 blocks (local files aren't publicly fetchable). Keeping the
// prompt text as the single source of truth avoids drift with import-photo.
async function imageMessages(
  paths: string[],
  comment: string,
  extraSystemRule?: string,
): Promise<AiMessage[]> {
  const imgs = await Promise.all(
    paths.map(async (p) => ({
      media_type: mediaType(p),
      data: encodeBase64(await Deno.readFile(p)),
    })),
  );
  const placeholders = imgs.map((_, i) => `local-image-${i}`);
  const msgs = structuringFromImage({
    imageUrls: placeholders,
    comment,
    allowedTags: ALLOWED_TAGS,
  });
  const swapped = msgs.map((m): AiMessage => {
    if (m.role !== 'user' || typeof m.content === 'string') return m;
    let i = 0;
    const content = m.content.map((b) => {
      if (b.type !== 'image') return b;
      const img = imgs[i++]!;
      return {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.media_type, data: img.data },
      };
    });
    return { role: 'user', content };
  });
  // Prompt-variant experiments append an extra rule to the system message,
  // leaving the production prompt untouched.
  if (!extraSystemRule) return swapped;
  return swapped.map((m): AiMessage =>
    m.role === 'system' && typeof m.content === 'string'
      ? { role: 'system', content: `${m.content}\n${extraSystemRule}` }
      : m
  );
}

async function readLines(path: string): Promise<string[]> {
  const text = await Deno.readTextFile(path);
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

async function listImages(dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && IMG_MEDIA[extname(e.name).toLowerCase()]) out.push(`${dir}/${e.name}`);
  }
  return out.sort();
}

export async function loadCases(): Promise<EvalCase[]> {
  const cases: EvalCase[] = [];

  // Stage 1 — simple URL regression (reuse the curated round-1 list).
  const urls = await readLines('eval/round-1/urls.txt');
  urls.forEach((url, i) => {
    cases.push({
      id: `s1-url-${i + 1}`,
      stage: 1,
      kind: 'url',
      label: url,
      build: async () => {
        const r = await fetchAndExtract(url);
        return {
          messages: structuringFromHtml({
            html: r.text,
            sourceUrl: url,
            scraped: r.scraped,
            allowedTags: ALLOWED_TAGS,
          }),
          sourceExcerpt: r.text.slice(0, 1500),
        };
      },
    });
  });

  // Stage 2 — Instagram captions + complex multi-section recipes.
  const captions = [
    {
      id: 's2-cap-cheesecake',
      path: 'eval/nim/captions/zingy-lime-cheesecake.txt',
      url: 'https://www.instagram.com/reel/CHEESECAKE/',
    },
    {
      id: 's2-cap-hu-langos',
      path: 'eval/round-2/fixtures/captions/hu-langos.txt',
      url: 'https://www.instagram.com/reel/LANGOS/',
    },
    {
      id: 's2-cap-lasagna',
      path: 'eval/round-2/fixtures/captions/sectioned-lasagna.txt',
      url: 'https://www.instagram.com/reel/LASAGNA/',
    },
  ];
  for (const c of captions) {
    cases.push({
      id: c.id,
      stage: 2,
      kind: 'caption',
      label: c.path,
      build: async () => {
        const caption = await Deno.readTextFile(c.path);
        return {
          messages: structuringFromCaption({
            caption,
            sourceUrl: c.url,
            allowedTags: ALLOWED_TAGS,
          }),
          sourceExcerpt: caption.slice(0, 1500),
        };
      },
    });
  }

  // Stage 3 — cookbook breakdown matrix (known-failing). The note replicates
  // the user's real-world phrasing ("middle column") to reproduce the failure.
  const imgDir = 'eval/round-2/fixtures/images/shepherdless-pie';
  const comment = 'You should use only the middle column of the pictures to add the recipe.';
  cases.push({
    id: 's3-img-shepherdless',
    stage: 3,
    kind: 'image',
    label: 'shepherdless-pie (middle column = Sweet Potato Cottage Pie)',
    goldPath: 'eval/round-2/gold/sweet-potato-cottage-pie.json',
    build: async () => {
      const paths = await listImages(imgDir);
      if (paths.length === 0) throw new Error(`no images in ${imgDir}`);
      return {
        messages: await imageMessages(paths, comment),
        sourceExcerpt: `${paths.length} photos: ${
          paths.map((p) => p.split('/').pop()).join(', ')
        } — note: "${comment}"`,
      };
    },
  });

  // R2.1 prompt experiment: the baseline winners (sonnet/opus) extract the right
  // column but drop the plain "750g potatoes" from a topping that lists BOTH
  // potatoes and sweet potatoes — despite the production prompt's existing
  // "plain potatoes in a Sweet Potato variant" line. This variant appends a
  // sharpened multi-item rule to the system message (production prompt left
  // untouched) to measure the lift.
  const R21_MULTI_ITEM_RULE =
    'Each distinct ingredient line in the chosen column/variant is its own ingredient row. When a single cell or category lists more than one ingredient (for example a topping made of BOTH potatoes AND sweet potatoes), output a separate row for every one of them — never merge two ingredients into one row, and never drop one because it seems redundant with the dish name.';
  cases.push({
    id: 's3-img-shepherdless-r21',
    stage: 3,
    kind: 'image',
    label: 'shepherdless-pie (R2.1 prompt: strict multi-item rule)',
    goldPath: 'eval/round-2/gold/sweet-potato-cottage-pie.json',
    build: async () => {
      const paths = await listImages(imgDir);
      if (paths.length === 0) throw new Error(`no images in ${imgDir}`);
      return {
        messages: await imageMessages(paths, comment, R21_MULTI_ITEM_RULE),
        sourceExcerpt: `${paths.length} photos (R2.1 strict multi-item rule) — note: "${comment}"`,
      };
    },
  });

  return cases;
}
