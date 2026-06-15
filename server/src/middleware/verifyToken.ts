import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET no está configurado en las variables de entorno');

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    organizationId?: string | null;
  };
}

export const verifyToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso denegado. No se proporcionó token.' });
  }

  const token = authHeader.split(' ')[1];

  // Algoritmo fijo — previene ataques de confusión de algoritmo
  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  try {
    // Revalidar contra la BD: el usuario debe existir y el token no haber sido
    // revocado (tokenVersion). Se usan rol y organización frescos de la BD, de modo
    // que un cambio de rol o de organización surte efecto sin esperar a que expire el JWT.
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, role: true, organizationId: true, tokenVersion: true },
    });

    if (!user || user.tokenVersion !== (decoded.tokenVersion ?? 0)) {
      return res.status(401).json({ error: 'Sesión inválida. Inicia sesión nuevamente.' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };
    next();
  } catch {
    res.status(500).json({ error: 'Error de autenticación' });
  }
};
