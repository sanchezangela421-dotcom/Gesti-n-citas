import { Router } from 'express';
import { prisma } from '../db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { orgScope } from '../lib/orgScope';
import { sanitizeOptionalHttpUrl } from '../lib/urls';
import { contractedDepartmentNames, isDepartmentContracted } from '../lib/departments';
import { localISODate } from '../lib/dates';
import { sendAccountInvitation } from '../services/email';
import { cancelOpenAppointments, notifyCancelledByDeactivation } from '../services/deactivation';
import { writeAudit, getClientIp } from '../services/auditLogger';

const EMAIL_REGEX = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;

const router = Router();

// GET /api/specialists
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const department = req.query.department as string | undefined;
    const where: any = { ...orgScope(req.user) };

    // Los dados de baja se ocultan por defecto. Solo el admin puede pedirlos
    // explícitamente (?includeDeleted=1) para poder reactivarlos desde su panel.
    const isManager = req.user?.role === 'admin' || req.user?.role === 'superadmin';
    if (!(isManager && req.query.includeDeleted === '1')) where.deletedAt = null;

    // `active` = disponible para agendar (a diferencia de la baja, es reversible y
    // el especialista conserva su acceso para cerrar las citas que ya tenía).
    // Los usuarios finales no deben verlo, porque no pueden reservar con él; el
    // admin sí lo ve, para poder reactivarlo, y el propio especialista también,
    // porque su dashboard se resuelve a partir de esta lista.
    const isEndUser = req.user?.role === 'alumno' || req.user?.role === 'usuario';

    if (isEndUser) {
      where.active = true;

      // Mismo criterio para un departamento que la organización dejó de
      // contratar: desaparece del selector, pero el especialista conserva su
      // acceso y sus citas ya agendadas.
      const allowed = await contractedDepartmentNames(req.user?.organizationId);

      // El filtro ?department= se intersecta con lo contratado, no lo sustituye:
      // pedir explícitamente un departamento dado de baja no debe saltarse el límite.
      if (department) {
        if (!allowed.includes(department)) return res.json([]);
        where.department = department;
      } else {
        where.department = { in: allowed };
      }
    } else if (department) {
      where.department = department;
    }

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

    if (!(await isDepartmentContracted(req.user?.organizationId, department))) {
      return res.status(409).json({ error: `Tu organización no tiene contratado el departamento de ${department}.` });
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

    // La cuenta de un dado de baja conserva su correo (el expediente la referencia),
    // así que se guía al admin a reactivarla en vez de dejarlo en un callejón sin salida.
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        code: existingUser.deletedAt ? 'USER_DEACTIVATED' : 'EMAIL_TAKEN',
        error: existingUser.deletedAt
          ? 'Este correo pertenece a un especialista dado de baja. Reactívalo desde la lista de especialistas.'
          : 'El correo ya está registrado',
      });
    }

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

    const specialist = await prisma.specialist.findFirst({ where: { id, deletedAt: null, ...orgScope(req.user) } });
    if (!specialist) return res.status(404).json({ error: 'No encontrado' });

    // Cambiar de departamento solo hacia uno contratado; el actual se respeta
    // aunque haya dejado de estarlo (el especialista conserva su agenda).
    if (department && department !== specialist.department
        && !(await isDepartmentContracted(specialist.organizationId, department))) {
      return res.status(409).json({ error: `Tu organización no tiene contratado el departamento de ${department}.` });
    }

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
    const specialist = await prisma.specialist.findFirst({ where: { id, deletedAt: null, ...orgScope(req.user) } });
    if (!specialist) return res.status(404).json({ error: 'No encontrado' });

    const isManager = req.user?.role === 'admin' || req.user?.role === 'superadmin';
    if (!isManager && req.user?.id !== specialist.userId) {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const { meetingUrl, locationId } = req.body;
    const data: any = {};
    if (meetingUrl !== undefined) {
      const safeUrl = sanitizeOptionalHttpUrl(meetingUrl);
      if (!safeUrl.ok) {
        return res.status(400).json({ error: 'El enlace de videollamada debe ser una URL http(s) válida.' });
      }
      data.meetingUrl = safeUrl.value;
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

// DELETE /api/specialists/:id — admin only. BAJA LÓGICA, nunca borrado físico:
// las notas clínicas que este especialista firmó deben conservarse (NOM-004) y
// sus citas sostienen los reportes históricos.
router.delete('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const id = req.params.id as string;
    const specialist = await prisma.specialist.findFirst({
      where: { id, deletedAt: null, ...orgScope(req.user) },
    });
    if (!specialist) return res.status(404).json({ error: 'No encontrado' });

    const rawReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const reason = rawReason || `El especialista ${specialist.name} ya no está disponible.`;
    const now = new Date();

    const cancelled = await prisma.$transaction(async (tx) => {
      // Las citas abiertas quedarían huérfanas: se cancelan con constancia del motivo.
      const affected = await cancelOpenAppointments(tx, { specialistId: id }, reason);

      await tx.specialist.update({
        where: { id },
        data: { deletedAt: now, active: false },
      });

      // La cuenta se marca de baja y se invalidan sus sesiones abiertas
      // (tokenVersion): el bloqueo es inmediato, no espera a que expire el JWT.
      await tx.user.update({
        where: { id: specialist.userId },
        data: { deletedAt: now, tokenVersion: { increment: 1 } },
      });

      // Los horarios publicados se retiran para que nadie pueda reservar con él.
      await tx.scheduleSlot.deleteMany({ where: { specialistId: id } });

      return affected;
    });

    notifyCancelledByDeactivation(cancelled, 'students', reason, specialist.organizationId);

    writeAudit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'SPECIALIST_DEACTIVATED',
      targetEntity: 'Specialist',
      targetId: id,
      organizationId: specialist.organizationId,
      metadata: { name: specialist.name, email: specialist.email, reason, cancelledAppointments: cancelled.length },
      ipAddress: getClientIp(req),
    });

    res.json({ success: true, cancelledAppointments: cancelled.length });
  } catch (error) {
    console.error('Error deactivating specialist:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/specialists/:id/restore — admin only. Revierte la baja lógica.
// Sus citas canceladas NO se reabren: si el paciente quiere volver, agenda de nuevo.
router.post('/:id/restore', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const id = req.params.id as string;
    const specialist = await prisma.specialist.findFirst({
      where: { id, NOT: { deletedAt: null }, ...orgScope(req.user) },
    });
    if (!specialist) return res.status(404).json({ error: 'Especialista dado de baja no encontrado' });

    const restored = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: specialist.userId }, data: { deletedAt: null } });
      return tx.specialist.update({
        where: { id },
        data: { deletedAt: null, active: true },
        include: { schedules: true },
      });
    });

    writeAudit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'SPECIALIST_REACTIVATED',
      targetEntity: 'Specialist',
      targetId: id,
      organizationId: specialist.organizationId,
      metadata: { name: specialist.name, email: specialist.email },
      ipAddress: getClientIp(req),
    });

    res.json(restored);
  } catch (error) {
    console.error('Error restoring specialist:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/specialists/:id
router.get('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;

    const specialist = await prisma.specialist.findFirst({
      where: { id, deletedAt: null, ...orgScope(req.user) },
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
      where: { id, deletedAt: null, ...orgScope(req.user) },
      include: { schedules: true }
    });

    if (!specialist) return res.status(404).json({ error: 'No encontrado' });

    // Sin reservas nuevas si el especialista está inactivo o si su departamento
    // dejó de estar contratado. Se responde sin horarios en lugar de 404 para
    // que el calendario simplemente aparezca vacío.
    if (!specialist.active) return res.json([]);
    if (!(await isDepartmentContracted(specialist.organizationId, specialist.department))) {
      return res.json([]);
    }

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
    const spec = await prisma.specialist.findFirst({ where: { id, deletedAt: null, ...orgScope(caller) } });
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

    // Fecha concreta opcional. Si viene, el día de la semana se DERIVA de ella:
    // aceptarlo del cliente permitía guardar un slot incoherente (fecha de lunes
    // etiquetada como miércoles) que luego aparecía en el día equivocado.
    let date: string | null = null;
    let dow: number;
    if (specificDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(specificDate))) {
        return res.status(400).json({ error: 'Fecha inválida (formato esperado YYYY-MM-DD)' });
      }
      const parsed = new Date(`${specificDate}T12:00:00`);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Fecha inválida' });
      }
      if (localISODate(parsed) < localISODate()) {
        return res.status(422).json({ error: 'No puedes publicar horarios en una fecha que ya pasó.' });
      }
      date = String(specificDate);
      dow = parsed.getDay();
    } else {
      dow = Number(dayOfWeek);
      if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
        return res.status(400).json({ error: 'Día de la semana inválido' });
      }
    }

    // Solapes: hasta ahora esto solo se validaba en el navegador, así que dos
    // pestañas abiertas —o una llamada directa a la API— creaban horarios
    // encimados que el alumno veía duplicados.
    //
    // Un horario recurrente aplica a TODAS las semanas de ese día, así que choca
    // con cualquier otro del mismo día; dos horarios de fecha concreta solo
    // chocan si son del mismo día del calendario.
    const slot = await prisma.$transaction(async (tx) => {
      const sameDay = await tx.scheduleSlot.findMany({
        where: { specialistId: id, dayOfWeek: dow },
        select: { startTime: true, endTime: true, specificDate: true },
      });

      const overlaps = sameDay.some(s =>
        (date === null || s.specificDate === null || s.specificDate === date) &&
        startTime < s.endTime && endTime > s.startTime
      );
      if (overlaps) throw new Error('SLOT_OVERLAP');

      return tx.scheduleSlot.create({
        data: {
          specialistId: id,
          dayOfWeek: dow,
          startTime,
          endTime,
          // "week" es legacy: los horarios por semana ahora se anclan con specificDate
          week: null,
          specificDate: date,
        },
      });
    });

    res.json(slot);
  } catch (error) {
    if (error instanceof Error && error.message === 'SLOT_OVERLAP') {
      return res.status(409).json({ error: 'Ya tienes un horario que se encima con ese rango.' });
    }
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
    const spec = await prisma.specialist.findFirst({ where: { id, deletedAt: null, ...orgScope(caller) } });
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
