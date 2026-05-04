import { z } from 'zod';

export const ImportUrlSchema = z.object({
  url: z.string().url(),
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
