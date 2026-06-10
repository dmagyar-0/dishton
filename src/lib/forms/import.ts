import { z } from 'zod';

export const ImportUrlSchema = z.object({
  // .url() alone admits javascript:/file:/data: — the Edge Function enforces
  // http(s) too (SSRF guard); this just fails fast in the form.
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), { message: 'invalid_url' }),
});
export type ImportUrlInput = z.infer<typeof ImportUrlSchema>;

export type ImportSource = 'url' | 'instagram';

export function detectImportSource(rawUrl: string): ImportSource {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return 'url';
  }
  return host === 'instagram.com' || host.endsWith('.instagram.com') ? 'instagram' : 'url';
}

export const ImportPhotoSchema = z.object({
  comment: z.string().trim().max(500).optional().or(z.literal('')),
});
export type ImportPhotoInput = z.infer<typeof ImportPhotoSchema>;
