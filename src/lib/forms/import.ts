import { z } from 'zod';

export const ImportUrlSchema = z.object({
  url: z.string().url(),
});
export type ImportUrlInput = z.infer<typeof ImportUrlSchema>;

export const ImportInstagramSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => u.includes('instagram.com'), 'must be an instagram URL'),
});
export type ImportInstagramInput = z.infer<typeof ImportInstagramSchema>;

export const ImportPhotoSchema = z.object({
  comment: z.string().trim().max(500).optional().or(z.literal('')),
});
export type ImportPhotoInput = z.infer<typeof ImportPhotoSchema>;
