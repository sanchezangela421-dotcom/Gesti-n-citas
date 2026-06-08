import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifySuperAdmin } from '../../middleware/verifySuperAdmin';
import loginRouter from './login';
import organizationsRouter from './organizations';
import usersRouter from './users';
import auditRouter from './audit';
import statsRouter from './stats';

const router = Router();

// Reads: permissive — dashboard navega entre tabs frecuentemente
const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'GET',
});

// Writes: estricto — mutaciones destructivas
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Demasiadas operaciones de escritura. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET',
});

// Login no requiere token — se monta antes del middleware de autenticación
router.use('/login', loginRouter);

router.use(readLimiter);
router.use(writeLimiter);
router.use(verifySuperAdmin as any);

router.use('/organizations', organizationsRouter);
router.use('/users',         usersRouter);
router.use('/audit',         auditRouter);
router.use('/stats',         statsRouter);

export default router;
