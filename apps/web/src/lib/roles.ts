import type { Role } from '@careerconnect/shared';

const RANK: Record<Role, number> = { VIEWER: 0, REVIEWER: 1, ADMIN: 2 };

/** VIEWER < REVIEWER < ADMIN; higher roles include lower ones. */
export function roleAtLeast(role: Role | null | undefined, min: Role): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[min];
}
