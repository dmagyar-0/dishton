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
