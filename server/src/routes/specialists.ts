import { Router } from 'express';
import { prisma } from '../db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { sendAccountInvitation } from '../services/email';

const EMAIL_REGEX = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;

const router = Router();

function orgFilter(req: AuthRequest) {
  if (req.user?.role === 'superadmin') return {};
  return req.user?.organizationId ? { organizationId: req.user.organizationId } : {};
}

// GET /api/specialists
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const department = req.query.department as string | undefined;
    const where: any = { ...orgFilter(req) };
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

    const specialist = await prisma.specialist.findUnique({ where: { id } });
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
    const specialist = await prisma.specialist.findUnique({ where: { id } });
    if (!specialist) return res.status(404).json({ error: 'No encontrado' });

    if (req.user?.role !== 'admin' && req.user?.id !== specialist.userId) {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const { meetingUrl } = req.body;
    const updated = await prisma.specialist.update({
      where: { id },
      data: { meetingUrl: meetingUrl || null },
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
    const specialist = await prisma.specialist.findUnique({ where: { id } });
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

    const specialist = await prisma.specialist.findUnique({
      where: { id },
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

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    // Sunday (0): Monday is tomorrow (+1), matching specialist dashboard behaviour
    const dayShift = now.getDay() === 0 ? 1 : 1 - now.getDay();
    const mondayOfCurrentWeek = new Date(now);
    mondayOfCurrentWeek.setDate(now.getDate() + dayShift);

    const diffMs = requestedDate.getTime() - mondayOfCurrentWeek.getTime();
    const diffWeeks = Math.floor(diffMs / (7 * 24 * 3600 * 1000));
    const requestedWeek = Math.max(0, diffWeeks);

    const specialist = await prisma.specialist.findUnique({
      where: { id },
      include: { schedules: true }
    });

    if (!specialist) return res.status(404).json({ error: 'No encontrado' });

    // Combine both specific-date slots AND recurring slots for the day
    // (previously used OR logic which dropped recurring slots if any specific-date slot existed)
    const specificSlots = specialist.schedules.filter((s: any) =>
      s.specificDate === date && s.available
    );

    const recurringSlots = specialist.schedules.filter((s: any) =>
      s.dayOfWeek === dayOfWeek &&
      s.available &&
      s.specificDate === null &&
      (s.week === null || s.week === requestedWeek)
    );

    const activeSlotsForDay = [...specificSlots, ...recurringSlots];

    const appointmentsOnDate = await prisma.appointment.findMany({
      where: { specialistId: id, date, status: { not: 'Cancelada' } }
    });

    const occupiedTimes = new Set(appointmentsOnDate.map((a: any) => a.time));
    const nowTime = new Date();
    const todayISO = nowTime.toISOString().split('T')[0];
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

    if (caller.role !== 'admin') {
      const spec = await prisma.specialist.findUnique({ where: { id } });
      if (!spec || spec.userId !== caller.id) {
        return res.status(403).json({ error: 'Sin permisos' });
      }
    }

    const { dayOfWeek, startTime, endTime, week, specificDate } = req.body;

    const slot = await prisma.scheduleSlot.create({
      data: {
        specialistId: id,
        dayOfWeek,
        startTime,
        endTime,
        week: week === undefined ? null : (week === 'both' ? null : parseInt(String(week))),
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

    if (caller.role !== 'admin') {
      const spec = await prisma.specialist.findUnique({ where: { id } });
      if (!spec || spec.userId !== caller.id) {
        return res.status(403).json({ error: 'Sin permisos' });
      }
    }

    await prisma.scheduleSlot.delete({ where: { id: slotId } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
