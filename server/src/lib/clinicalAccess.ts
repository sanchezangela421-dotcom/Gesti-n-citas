import { prisma } from '../db';
import { orgScope } from './orgScope';
import type { AuthRequest } from '../middleware/verifyToken';

/**
 * Resuelve el `Specialist` del usuario autenticado dentro de su organización.
 * Devuelve null si el caller no es especialista o no tiene perfil — los endpoints
 * de notas/expediente lo traducen a 403.
 *
 * Es el punto único de control para el acceso clínico: siempre acota por orgScope,
 * de modo que el `specialistId` resultante pertenece necesariamente a la org del caller.
 */
export async function getCallerSpecialist(req: AuthRequest) {
  const caller = req.user;
  if (!caller || caller.role !== 'especialista') return null;
  return prisma.specialist.findFirst({
    where: { userId: caller.id, ...orgScope(caller) },
  });
}
