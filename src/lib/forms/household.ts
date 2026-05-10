import { TAG_MAX_COUNT, TAG_PATTERN } from '@/domain/default-tags';
import { z } from 'zod';

export const CreateHouseholdSchema = z.object({
  name: z.string().min(1).max(80),
});
export type CreateHouseholdInput = z.infer<typeof CreateHouseholdSchema>;

export const RedeemInviteSchema = z.object({
  code: z.string().regex(/^[A-Z2-7]{8}$/, 'invalid invite code'),
});
export type RedeemInviteInput = z.infer<typeof RedeemInviteSchema>;

export const AddFollowSchema = z.object({
  code: z.string().regex(/^f_[A-Z2-7]{12}$/, 'invalid follow code'),
});
export type AddFollowInput = z.infer<typeof AddFollowSchema>;

// Single tag in the household whitelist. Mirrors the SQL CHECK constraint
// in 20260510120100_household_allowed_tags.sql so client-side validation and
// server-side validation reject the same strings.
export const AllowedTagSchema = z
  .string()
  .regex(TAG_PATTERN, 'tags use lowercase letters, digits, spaces, or hyphens (1-40 chars)');

export const AllowedTagsSchema = z
  .array(AllowedTagSchema)
  .max(TAG_MAX_COUNT, `at most ${TAG_MAX_COUNT} tags`)
  .superRefine((tags, ctx) => {
    const seen = new Set<string>();
    for (const t of tags) {
      if (seen.has(t)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate tag: ${t}` });
        return;
      }
      seen.add(t);
    }
  });
