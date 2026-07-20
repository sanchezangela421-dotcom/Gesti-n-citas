import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { orgScope } from '../lib/orgScope';
import { localISODate } from '../lib/dates';

const router = Router();

const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── GET /api/periods ──────────────────────────────────────────────────────────
// Devuelve todos los períodos ordenados por fecha de creación desc
router.get('/', readLimiter, verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const periods = await prisma.reportPeriod.findMany({
      where: { ...orgScope(req.user) },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { appointments: true } } },
    });
    res.json(periods);
  } catch (error) {
    console.error('Error fetching periods:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/periods/active ───────────────────────────────────────────────────
// Devuelve el período activo actual (o null si no hay ninguno).
// Si el período activo tiene endDate vencida, lo cierra automáticamente.
router.get('/active', readLimiter, verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const active = await prisma.reportPeriod.findFirst({
      where: { status: 'activo', ...orgScope(req.user) },
      include: { _count: { select: { appointments: true } } },
    });

    if (!active) return res.json(null);

    // Fecha local (TZ del servidor), no UTC: con toISOString el período se
    // auto-cerraba 6 horas antes (desde las 18:00 hora de México).
    const todayStr = localISODate();
    if (active.endDate && active.endDate < todayStr) {
      await prisma.reportPeriod.update({
        where: { id: active.id },
        data: { status: 'cerrado', closedAt: new Date() },
      });
      return res.json(null);
    }

    res.json(active);
  } catch (error) {
    console.error('Error fetching active period:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/periods ─────────────────────────────────────────────────────────
// Crea un nuevo período activo. Solo puede haber uno activo a la vez.
router.post('/', writeLimiter, verifyToken as any, async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Solo el administrador puede crear períodos' });
  }

  const { name, startDate, endDate, absorbUnassigned } = req.body;

  if (!name || !startDate) {
    return res.status(400).json({ error: 'El nombre y la fecha de inicio son requeridos' });
  }

  try {
    const existingActive = await prisma.reportPeriod.findFirst({
      where: { status: 'activo', ...orgScope(req.user) },
    });

    if (existingActive) {
      return res.status(409).json({
        error: 'Ya existe un período activo. Realiza un corte antes de crear uno nuevo.',
        activePeriod: existingActive,
      });
    }

    const period = await prisma.reportPeriod.create({
      data: {
        name: name.trim(),
        startDate,
        endDate: endDate ?? null,
        status: 'activo',
        organizationId: req.user?.organizationId ?? null,
      },
    });

    let absorbed = 0;
    if (absorbUnassigned) {
      // Solo citas sin período DE ESTA organización: sin el scope se absorbían
      // citas de todas las orgs hacia el período recién creado.
      const result = await prisma.appointment.updateMany({
        where: { periodId: null, ...orgScope(req.user) },
        data: { periodId: period.id },
      });
      absorbed = result.count;
    }

    res.status(201).json({ ...period, absorbed });
  } catch (error) {
    console.error('Error creating period:', error);
    res.status(500).json({ error: 'Error al crear el período' });
  }
});

// ── PATCH /api/periods/:id ────────────────────────────────────────────────────
// Edita un período.
// - Activo: se puede editar nombre, startDate y endDate
// - Cerrado: solo se puede editar el nombre
router.patch('/:id', writeLimiter, verifyToken as any, async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Solo el administrador puede editar períodos' });
  }

  const id = req.params.id as string;
  const { name, startDate, endDate } = req.body;

  try {
    // findFirst + orgScope: sin el scope, un admin de otra organización podía
    // editar/cerrar períodos ajenos con solo conocer el ID (IDOR).
    const period = await prisma.reportPeriod.findFirst({ where: { id, ...orgScope(req.user) } });
    if (!period) {
      return res.status(404).json({ error: 'Período no encontrado' });
    }

    const updateData: any = {};

    if (name !== undefined) updateData.name = name.trim();

    if (period.status === 'activo') {
      if (startDate !== undefined) updateData.startDate = startDate;
      if (endDate !== undefined) updateData.endDate = endDate ?? null;
    }
    // Si está cerrado, ignoramos cambios de fechas silenciosamente

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No hay campos válidos para actualizar' });
    }

    const updated = await prisma.reportPeriod.update({
      where: { id },
      data: updateData,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating period:', error);
    res.status(500).json({ error: 'Error al actualizar el período' });
  }
});

// ── POST /api/periods/:id/close ───────────────────────────────────────────────
// Realiza el "corte de datos": cierra el período activo.
// Opcionalmente crea el siguiente período en la misma transacción.
router.post('/:id/close', writeLimiter, verifyToken as any, async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Solo el administrador puede realizar un corte' });
  }

  const id = req.params.id as string;
  const { endDate, nextPeriod } = req.body;
  // nextPeriod?: { name: string; startDate: string; endDate?: string }

  try {
    // findFirst + orgScope: sin el scope, un admin de otra organización podía
    // editar/cerrar períodos ajenos con solo conocer el ID (IDOR).
    const period = await prisma.reportPeriod.findFirst({ where: { id, ...orgScope(req.user) } });
    if (!period) {
      return res.status(404).json({ error: 'Período no encontrado' });
    }
    if (period.status === 'cerrado') {
      return res.status(409).json({ error: 'Este período ya está cerrado' });
    }

    const now = new Date();
    const closingDate = endDate ?? localISODate(now);

    const result = await prisma.$transaction(async (tx) => {
      const closed = await tx.reportPeriod.update({
        where: { id },
        data: {
          status: 'cerrado',
          closedAt: now,
          endDate: closingDate,
        },
      });

      let created = null;
      if (nextPeriod?.name && nextPeriod?.startDate) {
        created = await tx.reportPeriod.create({
          data: {
            name: nextPeriod.name.trim(),
            startDate: nextPeriod.startDate,
            endDate: nextPeriod.endDate ?? null,
            status: 'activo',
            // Hereda la organización del período que se cierra; sin esto el
            // período nuevo quedaba global (null) y desaparecía de las vistas de la org.
            organizationId: period.organizationId,
          },
        });
      }

      return { closed, created };
    });

    res.json(result);
  } catch (error) {
    console.error('Error closing period:', error);
    res.status(500).json({ error: 'Error al realizar el corte' });
  }
});

export default router;
