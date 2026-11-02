import type { Role } from '../../generated/prisma/enums.js';

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  /** Id de la sesión (refresh token) que originó el access token. */
  sid: string;
};

export type PublicUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
};

export function toPublicUser(user: {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
