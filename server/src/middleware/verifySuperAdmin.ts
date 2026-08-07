import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET no está configurado');

// IPs permitidas — lista separada por comas en env. Si está vacía, no se aplica restricción.
// En producción: SUPERADMIN_ALLOWED_IPS=200.x.x.x,201.x.x.x
const ALLOWED_IPS = (process.env.SUPERADMIN_ALLOWED_IPS ?? '')
  .split(',')
  .map(ip => ip.trim())
  .filter(Boolean);

export interface SuperAdminRequest extends Request {
  actor?: {
    id: string;
    email: string;
    role: string;
    organizationId: null;
  };
}

function getClientIp(req: Request): string {
  // req.ip respeta 'trust proxy' (index.ts): detrás de nginx es la IP real del
  // cliente. Antes se leía X-Forwarded-For directamente, lo que permitía a un
  // atacante falsificar una IP permitida y saltarse el allowlist.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export const verifySuperAdmin = async (req: SuperAdminRequest, res: Response, next: NextFunction) => {
  // Capa 1: IP allowlist (solo si está configurada)
  if (ALLOWED_IPS.length > 0) {
    const clientIp = getClientIp(req);
    if (!ALLOWED_IPS.includes(clientIp)) {
      return res.status(403).json({ error: 'Acceso denegado.' });
    }
  }

  // Capa 2: token presente
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
  }

  const token = authHeader.split(' ')[1];

  // Capa 3: verificación JWT con algoritmo fijo — previene ataques de confusión de algoritmo
  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err: any) {
    const msg = err?.name === 'TokenExpiredError'
      ? 'Sesión expirada. Inicia sesión nuevamente.'
      : 'Token inválido.';
    return res.status(401).json({ error: msg });
  }

  // Capa 4: verificación de rol explícita — nunca delega a lógica genérica
  if (decoded.role !== 'superadmin') {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }

  // Capa 5: revalidación contra la BD — el usuario sigue siendo superadmin y el
  // token no fue revocado (tokenVersion). Cierra la sesión si cambió la contraseña.
  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, role: true, tokenVersion: true, deletedAt: true },
    });

    if (!user || user.role !== 'superadmin' || user.deletedAt || user.tokenVersion !== (decoded.tokenVersion ?? 0)) {
      return res.status(403).json({ error: 'Acceso denegado.' });
    }

    req.actor = { id: user.id, email: user.email, role: user.role, organizationId: null };
    next();
  } catch {
    return res.status(500).json({ error: 'Error de autenticación.' });
  }
};
