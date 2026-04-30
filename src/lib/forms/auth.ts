import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const SignupSchema = LoginSchema.extend({
  display_name: z.string().min(1).max(80),
});
export type SignupInput = z.infer<typeof SignupSchema>;

export const ResetSchema = z.object({ email: z.string().email() });
export type ResetInput = z.infer<typeof ResetSchema>;
