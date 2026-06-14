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

// Changing the password from the (authenticated) profile page. Unlike the
// recovery flow, this also collects the current password so we can verify the
// caller before letting them set a new one — Supabase's updateUser does not
// check the existing password on its own.
export const ChangePasswordSchema = z
  .object({
    current_password: z.string().min(1),
    password: z.string().min(10, 'Use a password of at least 10 characters.'),
    confirm: z.string().min(10, 'Use a password of at least 10 characters.'),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match.',
  });
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
