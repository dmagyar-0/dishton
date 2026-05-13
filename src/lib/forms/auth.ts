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

export const UpdatePasswordSchema = z
  .object({
    password: z.string().min(10),
    confirm: z.string().min(10),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match.',
  });
export type UpdatePasswordInput = z.infer<typeof UpdatePasswordSchema>;
