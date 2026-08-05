import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { orgScope } from '../lib/orgScope';
import { sanitizeOptionalHttpUrl } from '../lib/urls';
import { getCallerSpecialist } from '../lib/clinicalAccess';
import { writeAudit, getClientIp } from '../services/auditLogger';
import {
  sendAppointmentNewEmails,
  sendAppointmentConfirmedEmail,
  sendCancelledBySpecialistEmail,
  sendCancelledByStudentEmail,
  sendRescheduledBySpecialistEmail,
  sendRescheduledByStudentEmail,
} from '../services/email';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

/** Texto de ubicación a partir de una sede del catálogo (name — address) */
function formatLocation(loc?: { name: string; address: string | null } | null): string | undefined {
  if (!loc) return undefined;
  return loc.address ? `${loc.name} — ${loc.address}` : loc.name;
}

/** Obtiene el email del alumno y del especialista de la BD */
async function getPartyEmails(studentId: string, specialistId: string) {
  const [studentUser, specialist] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentId } }),
    prisma.specialist.findUnique({ where: { id: specialistId }, include: { user: true } }),
  ]);
  return {
    studentEmail: studentUser?.email ?? null,
    specialistEmail: (specialist as any)?.user?.email ?? null,
  };
}

/** Ejecuta el envío de correo en background; nunca lanza hacia el caller */
function fireEmail(fn: () => Promise<void>) {
  fn().catch((err) => console.error('[email]', err));
}

// ── GET /api/appointments ─────────────────────────────────────────────────────

router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const caller = req.user!;
    const { department, status } = req.query;

    const where: any = { ...orgScope(caller) };

    // Acotar el alcance por rol ANTES de aplicar los filtros opcionales:
    // los end-users solo ven sus propias citas y los especialistas solo las suyas.
    // admin / superadmin sí pueden filtrar libremente dentro de su organización.
    if (caller.role === 'alumno' || caller.role === 'usuario') {
      where.studentId = caller.id;
    } else if (caller.role === 'especialista') {
      const spec = await prisma.specialist.findFirst({ where: { userId: caller.id } });
      if (!spec) return res.json([]);
      where.specialistId = spec.id;
    } else {
      if (req.query.studentId)    where.studentId = req.query.studentId as string;
      if (req.query.specialistId) where.specialistId = req.query.specialistId as string;
    }

    if (department) where.department = department;
    if (status) where.status = status;

    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
    });

    res.json(appointments);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/appointments ────────────────────────────────────────────────────

router.post('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const caller = req.user!;
    const data = req.body;

    if (!data.specialistId || !data.date || !data.time) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    // El alumno/usuario solo puede agendar para sí mismo; admin indica el alumno en el body.
    const isEndUser = caller.role === 'alumno' || caller.role === 'usuario';
    // Si la agenda un especialista (caso seguimiento) la cita queda confirmada de una vez.
    const createdBySpecialist = caller.role === 'especialista';
    const studentId: string | undefined = isEndUser ? caller.id : data.studentId;
    if (!studentId) {
      return res.status(400).json({ error: 'Falta el alumno de la cita' });
    }

    // Cargar alumno y especialista validando que existan dentro del alcance del usuario.
    // Derivar nombre/departamento/organización de la BD impide que el cliente los falsifique.
    // `deletedAt: null` en ambos lados: no se puede agendar con una persona dada
    // de baja ni a nombre de ella (su cuenta existe solo por retención documental).
    const scope = orgScope(caller);
    const [student, specialist] = await Promise.all([
      prisma.user.findFirst({ where: { id: studentId, deletedAt: null, ...scope } }),
      prisma.specialist.findFirst({ where: { id: data.specialistId, deletedAt: null, ...scope }, include: { location: true } }),
    ]);
    if (!student || !specialist) {
      return res.status(404).json({ error: 'Alumno o especialista no disponible en tu organización' });
    }
    // Inactivo = no admite citas nuevas (conserva las que ya tenía). Se valida en
    // el servidor y no solo ocultándolo en la lista: el cliente no es la autoridad.
    if (!specialist.active) {
      return res.status(409).json({ error: 'Este especialista no está disponible para nuevas citas.' });
    }
    if (student.organizationId !== specialist.organizationId) {
      return res.status(403).json({ error: 'El alumno y el especialista pertenecen a organizaciones distintas' });
    }

    // Rechazar citas en fecha/hora pasada o con formato inválido (una fecha
    // malformada produce NaN, y NaN <= now es false: sin el isNaN se colaba)
    const [h, m] = data.time.split(':').map(Number);
    const apptDateTime = new Date(`${data.date}T00:00:00`);
    apptDateTime.setHours(h, m, 0, 0);
    if (isNaN(apptDateTime.getTime()) || apptDateTime <= new Date()) {
      return res.status(422).json({ error: 'No puedes agendar una cita en una fecha u hora que ya pasó.' });
    }

    // Obtener período activo DE LA ORGANIZACIÓN para etiquetar la cita (fuera de
    // la tx para no bloquear). Sin el scope, con varias orgs activas la cita se
    // etiquetaba con el período de otra organización.
    const activePeriod = await prisma.reportPeriod.findFirst({
      where: { status: 'activo', ...scope },
      select: { id: true },
    });

    const appointment = await prisma.$transaction(async (tx) => {
      const conflict = await tx.appointment.findFirst({
        where: {
          specialistId: specialist.id,
          date: data.date,
          time: data.time,
          status: { notIn: ['Cancelada'] },
        },
      });

      if (conflict) throw new Error('SLOT_TAKEN');

      if (data.parentId) {
        const parent = await tx.appointment.findUnique({ where: { id: data.parentId } });
        // El seguimiento debe encadenarse a una cita del mismo alumno
        if (!parent || parent.studentId !== student.id) throw new Error('INVALID_PARENT');

        // Solo se bloquea si ya hay un seguimiento ABIERTO (pendiente o confirmado).
        // Los seguimientos ya completados no impiden agendar la siguiente sesión.
        const openFollowUp = await tx.appointment.findFirst({
          where: {
            parentId: data.parentId,
            status: { in: ['Pendiente', 'Confirmada'] },
          },
        });
        if (openFollowUp) throw new Error('DUPLICATE_FOLLOW_UP');
      }

      return tx.appointment.create({
        data: {
          studentId: student.id,
          studentName: student.name,
          specialistId: specialist.id,
          specialistName: specialist.name,
          department: specialist.department,
          date: data.date,
          time: data.time,
          status: createdBySpecialist ? 'Confirmada' : 'Pendiente',
          modality: data.modality,
          motivo: data.motivo,
          // Seguimiento virtual auto-confirmado: hereda el enlace por defecto del especialista
          ...(createdBySpecialist && data.modality === 'Virtual' && specialist.meetingUrl
            ? { meetingUrl: specialist.meetingUrl }
            : {}),
          ...(createdBySpecialist && data.modality === 'Presencial' && specialist.location
            ? { location: formatLocation(specialist.location) }
            : {}),
          isFollowUp: data.isFollowUp ?? false,
          parentId: data.parentId ?? null,
          periodId: activePeriod?.id ?? null,
          organizationId: specialist.organizationId,
        },
      });
    });

    // Email según quién agenda:
    //  - especialista (seguimiento): la cita ya está confirmada → solo se avisa al alumno (confirmación).
    //  - alumno: solicitud nueva → se notifica al alumno (recibida) y al especialista (pendiente).
    fireEmail(async () => {
      const { studentEmail, specialistEmail } = await getPartyEmails(
        appointment.studentId,
        appointment.specialistId
      );
      const base = {
        date: formatDate(appointment.date),
        time: formatTime(appointment.time),
        specialistName: appointment.specialistName,
        studentName: appointment.studentName,
        department: appointment.department ?? '',
        modality: appointment.modality ?? '',
      };

      if (createdBySpecialist) {
        if (studentEmail) {
          await sendAppointmentConfirmedEmail(studentEmail, {
            ...base,
            meetingUrl: appointment.modality === 'Virtual' ? (specialist.meetingUrl ?? undefined) : undefined,
            location: appointment.modality === 'Presencial' ? formatLocation(specialist.location) : undefined,
          });
        }
        return;
      }

      if (!studentEmail || !specialistEmail) return;
      await sendAppointmentNewEmails(studentEmail, specialistEmail, { ...base, reason: appointment.motivo ?? undefined });
    });

    res.status(201).json(appointment);
  } catch (error: any) {
    if (error.message === 'SLOT_TAKEN') {
      return res.status(409).json({ error: 'Este horario ya fue reservado. Por favor elige otro.' });
    }
    if (error.message === 'DUPLICATE_FOLLOW_UP') {
      return res.status(409).json({ error: 'Ya existe una cita de seguimiento activa para esta sesión.' });
    }
    if (error.message === 'INVALID_PARENT') {
      return res.status(422).json({ error: 'La cita de seguimiento no corresponde a este alumno.' });
    }
    console.error('Error creating appointment:', error);
    res.status(500).json({ error: 'Error al crear la cita' });
  }
});

// ── PATCH /api/appointments/:id/status ───────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  'Pendiente':  ['Confirmada', 'Cancelada'],
  'Confirmada': ['Completada', 'Cancelada'],
  'Completada': [],
  'Cancelada':  [],
};

router.patch('/:id/status', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const { status, notes, meetingUrl: bodyMeetingUrl, locationId: bodyLocationId } = req.body;

    const current = await prisma.appointment.findFirst({ where: { id, ...orgScope(req.user) } });
    if (!current) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    // Validar propiedad: end-users solo sus citas, especialistas solo las asignadas
    if ((req.user?.role === 'alumno' || req.user?.role === 'usuario') && current.studentId !== req.user.id) {
      return res.status(403).json({ error: 'Sin permisos sobre esta cita' });
    }
    if (req.user?.role === 'especialista') {
      const spec = await prisma.specialist.findFirst({ where: { userId: req.user.id } });
      if (!spec || current.specialistId !== spec.id) {
        return res.status(403).json({ error: 'Sin permisos sobre esta cita' });
      }
    }

    // Los end-users solo pueden cancelar sus citas; confirmar o completar (y con
    // ello fijar meetingUrl/ubicación) es exclusivo del especialista o admin.
    if ((req.user?.role === 'alumno' || req.user?.role === 'usuario') && status !== 'Cancelada') {
      return res.status(403).json({ error: 'Solo puedes cancelar tus citas' });
    }

    const allowed = VALID_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(status)) {
      return res.status(422).json({
        error: `No se puede cambiar de "${current.status}" a "${status}"`,
      });
    }

    // El especialista/admin debe justificar la cancelación
    if (status === 'Cancelada' && (req.user?.role === 'especialista' || req.user?.role === 'admin')) {
      if (!(typeof notes === 'string' && notes.trim())) {
        return res.status(400).json({ error: 'El motivo de cancelación es obligatorio.' });
      }
    }

    if (status === 'Cancelada' && (req.user?.role === 'alumno' || req.user?.role === 'usuario')) {
      const [hours, minutes] = current.time.split(':').map(Number);
      const apptDateTime = new Date(`${current.date}T00:00:00`);
      apptDateTime.setHours(hours, minutes, 0, 0);
      const now = new Date();

      if (apptDateTime < now) {
        return res.status(422).json({ error: 'No puedes cancelar una cita que ya pasó.' });
      }

      const hoursUntil = (apptDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (hoursUntil < 24) {
        return res.status(422).json({
          error: 'No puedes cancelar con menos de 24 horas de anticipación. Contacta directamente a tu especialista.',
        });
      }
    }

    // Saneamiento del enlace de videollamada (anti-XSS): solo se acepta http(s),
    // porque se renderiza como <a href> en correos y en el frontend.
    const safeBodyUrl = sanitizeOptionalHttpUrl(bodyMeetingUrl);
    if (!safeBodyUrl.ok) {
      return res.status(400).json({ error: 'El enlace de videollamada debe ser una URL http(s) válida.' });
    }

    // Resolver meetingUrl / ubicación antes del update para guardarlos en la cita
    let resolvedMeetingUrl: string | undefined;
    let resolvedLocation: string | undefined;
    if (status === 'Confirmada' && (current.modality === 'Virtual' || current.modality === 'Presencial')) {
      const spec = await prisma.specialist.findUnique({ where: { id: current.specialistId }, include: { location: true } });
      if (current.modality === 'Virtual') resolvedMeetingUrl = safeBodyUrl.value || spec?.meetingUrl || undefined;
      if (current.modality === 'Presencial') {
        // El especialista puede elegir la sede al confirmar; si no, usa su sede por defecto.
        if (bodyLocationId) {
          const loc = await prisma.orgLocation.findFirst({ where: { id: bodyLocationId, ...orgScope(req.user) } });
          resolvedLocation = formatLocation(loc);
        } else {
          resolvedLocation = formatLocation(spec?.location);
        }
      }
    }

    const noteText = typeof notes === 'string' ? notes.trim() : '';

    // Dual-write transitorio: seguimos llenando Appointment.notes hasta el DROP (Fase B4),
    // mientras poblamos las fuentes nuevas (ClinicalNote al completar / cancellationReason al cancelar).
    const { appointment, noteAudit } = await prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.update({
        where: { id },
        data: {
          status,
          ...(status === 'Cancelada' && noteText && { cancellationReason: noteText }),
          ...(resolvedMeetingUrl !== undefined && { meetingUrl: resolvedMeetingUrl }),
          ...(resolvedLocation !== undefined && { location: resolvedLocation }),
        },
      });

      // Al completar con anotaciones, el especialista asignado persiste la nota clínica.
      // (Un admin que cierre la cita NO escribe nota clínica — no es personal clínico.)
      let audit: { action: string; id: string } | null = null;
      if (status === 'Completada' && noteText && req.user?.role === 'especialista') {
        const existing = await tx.clinicalNote.findUnique({ where: { appointmentId: id } });
        if (existing) {
          await tx.clinicalNoteRevision.create({
            data: { noteId: existing.id, body: existing.body, editedBySpecialistId: current.specialistId },
          });
          const n = await tx.clinicalNote.update({ where: { id: existing.id }, data: { body: noteText } });
          audit = { action: 'CLINICAL_NOTE_EDITED', id: n.id };
        } else {
          const n = await tx.clinicalNote.create({
            data: {
              appointmentId: id,
              specialistId: current.specialistId,
              studentId: current.studentId,
              department: current.department,
              organizationId: current.organizationId,
              body: noteText,
            },
          });
          audit = { action: 'CLINICAL_NOTE_CREATED', id: n.id };
        }
      }
      return { appointment: updated, noteAudit: audit };
    });

    if (noteAudit) {
      writeAudit({
        actorId: req.user!.id,
        actorRole: req.user!.role,
        action: noteAudit.action,
        targetEntity: 'ClinicalNote',
        targetId: noteAudit.id,
        organizationId: req.user?.organizationId ?? null,
        metadata: { appointmentId: id, studentId: current.studentId, department: current.department, via: 'complete' },
        ipAddress: getClientIp(req),
      });
    }

    const cancelReason = notes ?? undefined;
    const actorRole = req.user?.role;

    // Emails según el nuevo status
    fireEmail(async () => {
      const { studentEmail, specialistEmail } = await getPartyEmails(
        appointment.studentId,
        appointment.specialistId
      );
      const base = {
        date: formatDate(appointment.date),
        time: formatTime(appointment.time),
        specialistName: appointment.specialistName,
        studentName: appointment.studentName,
        department: appointment.department ?? '',
        modality: appointment.modality ?? '',
      };

      if (status === 'Confirmada' && studentEmail) {
        await sendAppointmentConfirmedEmail(studentEmail, {
          ...base,
          meetingUrl: resolvedMeetingUrl,
          location: resolvedLocation,
        });
      }

      if (status === 'Cancelada') {
        // El end-user canceló → avisa al especialista
        if ((actorRole === 'alumno' || actorRole === 'usuario') && specialistEmail) {
          await sendCancelledByStudentEmail(specialistEmail, { ...base, reason: cancelReason });
        }
        // El especialista o admin canceló → avisa al alumno
        if ((actorRole === 'especialista' || actorRole === 'admin') && studentEmail) {
          await sendCancelledBySpecialistEmail(studentEmail, { ...base, reason: cancelReason });
        }
      }
    });

    res.json(appointment);
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ error: 'Error al actualizar la cita' });
  }
});

// ── PATCH /api/appointments/:id/reschedule ────────────────────────────────────

router.patch('/:id/reschedule', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const caller = req.user!;
    const id = req.params.id as string;
    const { date, time, modality } = req.body;

    if (!date || !time) {
      return res.status(400).json({ error: 'Fecha y hora son requeridas' });
    }

    // Mismo criterio que al crear: la nueva fecha/hora debe ser futura y válida
    const [nh, nm] = String(time).split(':').map(Number);
    const newDateTime = new Date(`${date}T00:00:00`);
    newDateTime.setHours(nh, nm, 0, 0);
    if (isNaN(newDateTime.getTime()) || newDateTime <= new Date()) {
      return res.status(422).json({ error: 'No puedes reagendar a una fecha u hora que ya pasó.' });
    }

    let previousDate = '';
    let previousTime = '';
    // El rol efectivo se deriva del JWT, nunca del body, y se calcula dentro
    // de la tx tras validar la pertenencia de la cita.
    let actedAsStudent = false;

    const appointment = await prisma.$transaction(async (tx) => {
      const current = await tx.appointment.findFirst({ where: { id, ...orgScope(caller) } });
      if (!current) throw new Error('NOT_FOUND');

      // Validar pertenencia: el end-user solo su cita, el especialista solo las suyas.
      if (caller.role === 'alumno' || caller.role === 'usuario') {
        if (current.studentId !== caller.id) throw new Error('FORBIDDEN');
        actedAsStudent = true;
      } else if (caller.role === 'especialista') {
        const spec = await tx.specialist.findFirst({ where: { userId: caller.id } });
        if (!spec || current.specialistId !== spec.id) throw new Error('FORBIDDEN');
      }
      // admin / superadmin quedan ya acotados por orgScope.

      previousDate = current.date;
      previousTime = current.time;

      if (actedAsStudent) {
        const [h, m] = current.time.split(':').map(Number);
        const apptDateTime = new Date(`${current.date}T00:00:00`);
        apptDateTime.setHours(h, m, 0, 0);
        const hoursUntil = (apptDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
        if (hoursUntil < 24) throw new Error('WITHIN_24H');
      }

      const conflict = await tx.appointment.findFirst({
        where: {
          specialistId: current.specialistId,
          date,
          time,
          status: { notIn: ['Cancelada'] },
          NOT: { id },
        },
      });

      if (conflict) throw new Error('SLOT_TAKEN');

      return tx.appointment.update({
        where: { id },
        data: {
          date,
          time,
          ...(modality && { modality }),
          ...(actedAsStudent && { status: 'Pendiente' }),
        },
      });
    });

    // Email: avisa a quien NO reagendó (rol determinado por el servidor)
    fireEmail(async () => {
      const { studentEmail, specialistEmail } = await getPartyEmails(
        appointment.studentId,
        appointment.specialistId
      );
      const rescheduleData = {
        date: formatDate(appointment.date),
        time: formatTime(appointment.time),
        previousDate: formatDate(previousDate),
        previousTime: formatTime(previousTime),
        newDate: formatDate(appointment.date),
        newTime: formatTime(appointment.time),
        specialistName: appointment.specialistName,
        studentName: appointment.studentName,
        department: appointment.department ?? '',
        modality: appointment.modality ?? '',
      };

      if (actedAsStudent && specialistEmail) {
        await sendRescheduledByStudentEmail(specialistEmail, rescheduleData);
      } else if (!actedAsStudent && studentEmail) {
        await sendRescheduledBySpecialistEmail(studentEmail, rescheduleData);
      }
    });

    res.json(appointment);
  } catch (error: any) {
    if (error.message === 'SLOT_TAKEN') {
      return res.status(409).json({ error: 'Este horario ya fue reservado. Por favor elige otro.' });
    }
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    if (error.message === 'FORBIDDEN') {
      return res.status(403).json({ error: 'Sin permisos sobre esta cita' });
    }
    if (error.message === 'WITHIN_24H') {
      return res.status(422).json({ error: 'No puedes reagendar con menos de 24 horas de anticipación. Contacta directamente a tu especialista.' });
    }
    console.error('Error rescheduling appointment:', error);
    res.status(500).json({ error: 'Error al reagendar la cita' });
  }
});

// ── GET /api/appointments/:id/note ───────────────────────────────────────────
// Lee la nota clínica de SU cita (para editar). Solo el especialista asignado.
router.get('/:id/note', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const spec = await getCallerSpecialist(req);
    if (!spec) return res.status(403).json({ error: 'Solo especialistas' });

    const id = req.params.id as string;
    const appt = await prisma.appointment.findFirst({
      where: { id, specialistId: spec.id, ...orgScope(req.user) },
      select: { id: true },
    });
    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });

    const note = await prisma.clinicalNote.findUnique({ where: { appointmentId: id } });
    res.json(note ?? null);
  } catch (error) {
    console.error('Error fetching clinical note:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── PUT /api/appointments/:id/note ───────────────────────────────────────────
// Crea/edita (upsert) la nota clínica de SU cita. Cada edición guarda el cuerpo
// anterior en ClinicalNoteRevision (historial inmutable, integridad NOM-004).
router.put('/:id/note', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const spec = await getCallerSpecialist(req);
    if (!spec) return res.status(403).json({ error: 'Solo especialistas' });

    const id = req.params.id as string;
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) return res.status(400).json({ error: 'La nota no puede estar vacía' });

    const appt = await prisma.appointment.findFirst({
      where: { id, specialistId: spec.id, ...orgScope(req.user) },
    });
    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
    if (appt.status !== 'Confirmada' && appt.status !== 'Completada') {
      return res.status(422).json({ error: 'Solo puedes anotar en citas confirmadas o completadas.' });
    }

    const existing = await prisma.clinicalNote.findUnique({ where: { appointmentId: id } });

    const note = await prisma.$transaction(async (tx) => {
      if (existing) {
        // Snapshot inmutable del contenido anterior antes de sobrescribir
        await tx.clinicalNoteRevision.create({
          data: { noteId: existing.id, body: existing.body, editedBySpecialistId: spec.id },
        });
        return tx.clinicalNote.update({ where: { id: existing.id }, data: { body } });
      }
      return tx.clinicalNote.create({
        data: {
          appointmentId: id,
          specialistId: spec.id,
          studentId: appt.studentId,
          department: appt.department,
          organizationId: appt.organizationId,
          body,
        },
      });
    });

    writeAudit({
      actorId: req.user!.id,
      actorRole: 'especialista',
      action: existing ? 'CLINICAL_NOTE_EDITED' : 'CLINICAL_NOTE_CREATED',
      targetEntity: 'ClinicalNote',
      targetId: note.id,
      organizationId: req.user?.organizationId ?? null,
      metadata: { appointmentId: id, studentId: appt.studentId, department: appt.department },
      ipAddress: getClientIp(req),
    });

    res.json(note);
  } catch (error) {
    console.error('Error saving clinical note:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
