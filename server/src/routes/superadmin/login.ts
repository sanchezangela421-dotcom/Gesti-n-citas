import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { prisma } from '../../db';
import { writeAudit, getClientIp } from '../../services/auditLogger';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET no está configurado');

// 5 intentos por IP cada 15 minutos — más agresivo que el login normal (15/15min)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos. Acceso bloqueado por 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Cuenta incluso las respuestas exitosas para evitar enumeración de usuarios
  skipSuccessfulRequests: false,
});

// POST /api/superadmin/login
router.post('/', loginLimiter, async (req, res) => {
  const ip = getClientIp(req);

  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Respuesta genérica — no revela si el email existe, el rol, ni si fue dado de baja
    if (!user || user.role !== 'superadmin' || user.deletedAt) {
      writeAudit({
        actorId:      'unknown',
        actorRole:    'unknown',
        action:       'SUPERADMIN_LOGIN_FAILED',
        targetEntity: 'Auth',
        targetId:     'login',
        metadata:     { email, reason: 'user_not_found_or_wrong_role' },
        ipAddress:    ip,
      });
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      writeAudit({
        actorId:      user.id,
        actorRole:    'superadmin',
        action:       'SUPERADMIN_LOGIN_FAILED',
        targetEntity: 'Auth',
        targetId:     user.id,
        metadata:     { reason: 'wrong_password' },
        ipAddress:    ip,
      });
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Token de corta duración — 2h en lugar de 24h del token normal
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, organizationId: null, tokenVersion: user.tokenVersion },
      JWT_SECRET,
      { expiresIn: '2h', algorithm: 'HS256' }
    );

    writeAudit({
      actorId:      user.id,
      actorRole:    'superadmin',
      action:       'SUPERADMIN_LOGIN_SUCCESS',
      targetEntity: 'Auth',
      targetId:     user.id,
      metadata:     { email: user.email },
      ipAddress:    ip,
    });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });

  } catch (error) {
    console.error('[superadmin] Login error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

export default router;
