import type { AuthRequest } from '../middleware/verifyToken';

type AuthUser = AuthRequest['user'];

/**
 * Filtro de Prisma que restringe los resultados a la organización del usuario.
 *
 * - `superadmin`  → sin filtro (acceso a toda la plataforma).
 * - cualquier otro → acotado a su `organizationId`, incluido `null`
 *   (datos legacy sin organización).
 *
 * Nunca devuelve `{}` para un usuario que no sea superadmin: si su
 * `organizationId` es `null` se filtra explícitamente por `null`, evitando la
 * fuga de datos entre organizaciones que ocurría al devolver un filtro vacío.
 */
export function orgScope(user: AuthUser): { organizationId?: string | null } {
  if (user?.role === 'superadmin') return {};
  return { organizationId: user?.organizationId ?? null };
}
