// M23 login (ADR-0023): local accounts, roles operator/admin. Viewing needs no login.
import { z } from 'zod';

export const userRoleSchema = z.enum(['operator', 'admin']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const authUserSchema = z.object({
  email: z.string(),
  /** Staff code when linked to core.staff, else the email. */
  label: z.string(),
  roles: z.array(userRoleSchema),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const sessionResponseSchema = z.object({ user: authUserSchema.nullable() });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const loginRequestSchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authErrorSchema = z.object({ message: z.string() });

/** Minimum length for new passwords (user-cli). */
export const PASSWORD_MIN_LENGTH = 12;

/** Session lifetime from login (ADR-0011, kept by ADR-0023). */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export const hasRole = (user: AuthUser | null | undefined, role: UserRole): boolean =>
  !!user && (user.roles.includes('admin') || user.roles.includes(role));
