import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email('Correo inválido').max(254),
  password: z.string().min(1, 'La contraseña es obligatoria').max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'La contraseña actual es obligatoria').max(200),
  newPassword: z
    .string()
    .min(8, 'La nueva contraseña debe tener al menos 8 caracteres')
    .max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
