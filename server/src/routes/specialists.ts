import { Router } from 'express';
import { prisma } from '../db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { orgScope } from '../lib/orgScope';
import { localISODate } from '../lib/dates';
import { sendAccountInvitation } from '../services/email';

const EMAIL_REGEX = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;

const router = Router();

// GET /api/specialists
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const department = req.query.department as string | undefined;
    const where: any = { ...orgScope(req.user) };
    if (department) where.department = department;

    const specialists = await prisma.specialist.findMany({
      where,
      include: { schedules: true, user: { select: { avatarUrl: true } } }
    });

    res.json(specialists.map((s: any) => {
      const { user, ...rest } = s;
      return { ...rest, avatarUrl: user?.avatarUrl ?? null };
    }));
  } catch (error) {
    console.error('Error fetching specialists:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/specialists — admin only
router.post('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const { name, department, email, shift } = req.body;

    if (!name || !email || !department) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'El formato del correo no es válido' });
    }

    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;
    if (allowedDomain) {
      const emailDomain = email.split('@')[1];
      if (emailDomain !== allowedDomain) {
        return res.status(400).json({ error: `Solo se permiten correos institucionales (@${allowedDomain})` });
      }
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(400).json({ error: 'El correo ya está registrado' });

    // Contraseña aleatoria bloqueante — el especialista la cambiará vía el link de activación
    const tempPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const activationToken = crypto.randomBytes(32).toString('hex');
    const activationExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 horas

    const org = req.user?.organizationId
      ? await prisma.organization.findUnique({ where: { id: req.user.organizationId } })
      : null;

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email, password: tempPassword, name,
          role: 'especialista', department,
          emailVerified: true,
          resetPasswordToken: activationToken,
          resetPasswordTokenExpiresAt: activationExpiry,
          organizationId: req.user?.organizationId ?? null,
        }
      });

      return await tx.specialist.create({
        data: { userId: user.id, name, department, email, active: true, shift: shift || 'Matutino', organizationId: req.user?.organizationId ?? null },
        include: { schedules: true }
      });
    });

    // Enviar invitación con link de activación (no se envían credenciales planas)
    const activationUrl = `${process.env.FRONTEND_URL}/reset-password?token=${activationToken}`;
    sendAccountInvitation(name, email, org?.name ?? 'la plataforma', 'especialista', activationUrl).catch(err => {
      console.error('Error sending invitation email:', err);
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating specialist:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/specialists/:id — admin only
router.patch('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const id = req.params.id as string;
    const { name, department, email, password, active, shift } = req.body;

    const specialist = await prisma.specialist.findFirst({ where: { id, ...orgScope(req.user) } });
    if (!specialist) return res.status(404).json({ error: 'No encontrado' });

    const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: specialist.userId },
        data: {
          ...(name && { name }),
          ...(email && { email }),
          ...(department && { department }),
          ...(hashedPassword && { password: hashedPassword })
        }
      });

      return await tx.specialist.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(email && { email }),
          ...(department && { department }),
          ...(active !== undefined && { active }),
          ...(shift && { shift })
        },
        include: { schedules: true }
      });
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating specialist:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/specialists/:id/meeting-url — specialist (self) or admin
router.patch('/:id/meeting-url', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const specialist = await prisma.specialist.findFirst({ where: { id, ...orgScope(req.user) } });
    if (!specialist) return res.status(404).json({ error: 'No encontrado' });

    const isManager = req.user?.role === 'admin' || req.user?.role === 'superadmin';
    if (!isManager && req.user?.id !== specialist.userId) {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const { meetingUrl, locationId } = req.body;
    const data: any = {};
    if (meetingUrl !== undefined) {
      // Saneamiento anti-XSS: el enlace se muestra como <a href> en correos y frontend,
      // así que solo aceptamos http(s) y bloqueamos esquemas peligrosos (javascript:, data:…).
      const trimmed = typeof meetingUrl === 'string' ? meetingUrl.trim() : '';
      if (trimmed) {
        let validUrl = false;
        try {
          const u = new URL(trimmed);
          validUrl = u.protocol === 'http:' || u.protocol === 'https:';
        } catch { validUrl = false; }
        if (!validUrl) {
          return res.status(400).json({ error: 'El enlace de videollamada debe ser una URL http(s) válida.' });
        }
      }
      data.meetingUrl = trimmed || null;
    }
    if (locationId !== undefined) {
      // La sede debe pertenecer a la organización del especialista
      if (locationId) {
        const loc = await prisma.orgLocation.findFirst({ where: { id: locationId, ...orgScope(req.user) } });
        if (!loc) return res.status(400).json({ error: 'Sede no válida' });
      }
      data.locationId = locationId || null;
    }

    const updated = await prisma.specialist.update({
      where: { id },
      data,
      include: { schedules: true },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating meeting URL:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/specialists/:id — admin only
router.delete('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const id = req.params.id as string;
    const specialist = await prisma.specialist.findFirst({ where: { id, ...orgScope(req.user) } });
    if (!specialist) return res.status(404).json({ error: 'No encontrado' });

    await prisma.$transaction(async (tx) => {
      await tx.specialist.delete({ where: { id } });
      await tx.user.delete({ where: { id: specialist.userId } });
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting specialist:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/specialists/:id
router.get('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;

    const specialist = await prisma.specialist.findFirst({
      where: { id, ...orgScope(req.user) },
      include: { schedules: true }
    });

    if (!specialist) return res.status(404).json({ error: 'No encontrado' });
    res.json(specialist);
  } catch (error) {
    console.error('Error fetching specialist:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/specialists/:id/available-slots
router.get('/:id/available-slots', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const date = req.query.date as string | undefined;

    if (!date) return res.status(400).json({ error: 'Fecha requerida' });

    const requestedDate = new Date(date + 'T12:00:00');
    requestedDate.setHours(0, 0, 0, 0);
    const dayOfWeek = requestedDate.getDay();

    const specialist = await prisma.specialist.findFirst({
      where: { id, ...orgScope(req.user) },
      include: { schedules: true }
    });

    if (!specialist) return res.status(404).json({ error: 'No encontrado' });

    // Slots de fecha específica + recurrentes semanales (week null).
    // La marca week=0/1 era relativa a "hoy" (los slots de semana reaparecían
    // eternamente); ahora esos slots se anclan por specificDate (ver migración
    // 20260719000000) y aquí ya no se comparan semanas.
    const specificSlots = specialist.schedules.filter((s: any) =>
      s.specificDate === date && s.available
    );

    const recurringSlots = specialist.schedules.filter((s: any) =>
      s.dayOfWeek === dayOfWeek &&
      s.available &&
      s.specificDate === null &&
      s.week === null
    );

    const activeSlotsForDay = [...specificSlots, ...recurringSlots];

    const appointmentsOnDate = await prisma.appointment.findMany({
      where: { specialistId: id, date, status: { not: 'Cancelada' } }
    });

    const occupiedTimes = new Set(appointmentsOnDate.map((a: any) => a.time));
    const nowTime = new Date();
    // Fecha local del servidor (TZ), no UTC: con toISOString, a partir de las
    // 18:00 hora de México "hoy" era mañana y el filtro de horas pasadas fallaba.
    const todayISO = localISODate(nowTime);
    const isToday = date === todayISO;

    const seen = new Set<string>();
    const results: { start: string; end: string }[] = [];
    activeSlotsForDay.forEach((slot: any) => {
      if (occupiedTimes.has(slot.startTime) || seen.has(slot.startTime)) return;
      // Si la fecha solicitada es hoy, omitir horarios que ya pasaron
      if (isToday) {
        const [sh, sm] = slot.startTime.split(':').map(Number);
        const slotTime = new Date();
        slotTime.setHours(sh, sm, 0, 0);
        if (slotTime <= nowTime) return;
      }
      seen.add(slot.startTime);
      results.push({ start: slot.startTime, end: slot.endTime });
    });

    res.json(results.sort((a, b) => a.start.localeCompare(b.start)));
  } catch (error) {
    console.error('Error fetching slots:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/specialists/:id/schedules — specialist (own) or admin
router.post('/:id/schedules', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const caller = req.user!;

    // Cargar el especialista dentro del scope de la organización antes de validar permisos
    const spec = await prisma.specialist.findFirst({ where: { id, ...orgScope(caller) } });
    if (!spec) return res.status(404).json({ error: 'No encontrado' });
    const isManager = caller.role === 'admin' || caller.role === 'superadmin';
    if (!isManager && spec.userId !== caller.id) {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const { dayOfWeek, startTime, endTime, specificDate } = req.body;

    // Validación básica del rango: formato HH:MM y inicio < fin
    const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!TIME_RE.test(String(startTime)) || !TIME_RE.test(String(endTime)) || startTime >= endTime) {
      return res.status(400).json({ error: 'Rango de horario inválido (inicio debe ser antes del fin)' });
    }
    const dow = Number(dayOfWeek);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
      return res.status(400).json({ error: 'Día de la semana inválido' });
    }

    const slot = await prisma.scheduleSlot.create({
      data: {
        specialistId: id,
        dayOfWeek: dow,
        startTime,
        endTime,
        // "week" es legacy: los horarios por semana ahora se anclan con specificDate
        week: null,
        specificDate: specificDate || null
      }
    });

    res.json(slot);
  } catch (error) {
    console.error('Error creating schedule:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/specialists/:id/schedules/:slotId — specialist (own) or admin
router.delete('/:id/schedules/:slotId', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const slotId = req.params.slotId as string;
    const caller = req.user!;

    // Cargar el especialista dentro del scope de la organización antes de validar permisos
    const spec = await prisma.specialist.findFirst({ where: { id, ...orgScope(caller) } });
    if (!spec) return res.status(404).json({ error: 'No encontrado' });
    const isManager = caller.role === 'admin' || caller.role === 'superadmin';
    if (!isManager && spec.userId !== caller.id) {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    // Acotar el slot al especialista de la URL: antes se podía borrar el horario
    // de OTRO especialista (incluso de otra organización) conociendo el slotId (IDOR).
    const { count } = await prisma.scheduleSlot.deleteMany({ where: { id: slotId, specialistId: id } });
    if (count === 0) return res.status(404).json({ error: 'Horario no encontrado' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
