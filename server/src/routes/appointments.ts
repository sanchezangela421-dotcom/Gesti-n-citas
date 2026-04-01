import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
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
    const { studentId, specialistId, department, status } = req.query;

    const where: any = {};
    if (studentId) where.studentId = studentId;
    if (specialistId) where.specialistId = specialistId;
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
    const data = req.body;

    if (!data.studentId || !data.specialistId || !data.date || !data.time) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const appointment = await prisma.$transaction(async (tx) => {
      const conflict = await tx.appointment.findFirst({
        where: {
          specialistId: data.specialistId,
          date: data.date,
          time: data.time,
          status: { notIn: ['Cancelada'] },
        },
      });

      if (conflict) throw new Error('SLOT_TAKEN');

      if (data.parentId) {
        const existingFollowUp = await tx.appointment.findFirst({
          where: {
            parentId: data.parentId,
            status: { notIn: ['Cancelada'] },
          },
        });
        if (existingFollowUp) throw new Error('DUPLICATE_FOLLOW_UP');
      }

      return tx.appointment.create({
        data: {
          studentId: data.studentId,
          studentName: data.studentName,
          specialistId: data.specialistId,
          specialistName: data.specialistName,
          department: data.department,
          date: data.date,
          time: data.time,
          status: 'Pendiente',
          modality: data.modality,
          motivo: data.motivo,
          notes: data.notes,
          isFollowUp: data.isFollowUp ?? false,
          parentId: data.parentId ?? null,
        },
      });
    });

    // Email: avisa al alumno (recibida) y al especialista (nueva solicitud)
    fireEmail(async () => {
      const { studentEmail, specialistEmail } = await getPartyEmails(
        appointment.studentId,
        appointment.specialistId
      );
      if (!studentEmail || !specialistEmail) return;
      await sendAppointmentNewEmails(studentEmail, specialistEmail, {
        date: formatDate(appointment.date),
        time: formatTime(appointment.time),
        specialistName: appointment.specialistName,
        studentName: appointment.studentName,
        department: appointment.department ?? '',
        modality: appointment.modality ?? '',
        reason: appointment.motivo ?? undefined,
      });
    });

    res.status(201).json(appointment);
  } catch (error: any) {
    if (error.message === 'SLOT_TAKEN') {
      return res.status(409).json({ error: 'Este horario ya fue reservado. Por favor elige otro.' });
    }
    if (error.message === 'DUPLICATE_FOLLOW_UP') {
      return res.status(409).json({ error: 'Ya existe una cita de seguimiento activa para esta sesión.' });
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
    const { status, notes, meetingUrl: bodyMeetingUrl } = req.body;

    const current = await prisma.appointment.findUnique({ where: { id } });
    if (!current) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const allowed = VALID_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(status)) {
      return res.status(422).json({
        error: `No se puede cambiar de "${current.status}" a "${status}"`,
      });
    }

    if (status === 'Cancelada') {
      const [hours, minutes] = current.time.split(':').map(Number);
      const apptDateTime = new Date(`${current.date}T00:00:00`);
      apptDateTime.setHours(hours, minutes, 0, 0);
      const now = new Date();

      if (apptDateTime < now) {
        return res.status(422).json({ error: 'No se puede cancelar una cita que ya pasó.' });
      }

      if (req.user?.role === 'alumno') {
        const hoursUntil = (apptDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (hoursUntil < 24) {
          return res.status(422).json({
            error: 'No puedes cancelar con menos de 24 horas de anticipación. Contacta directamente a tu especialista.',
          });
        }
      }
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: {
        status,
        ...(notes !== undefined && { notes }),
      },
    });

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
        const resolvedMeetingUrl = bodyMeetingUrl
          || (await prisma.specialist.findUnique({ where: { id: appointment.specialistId } }))?.meetingUrl
          || undefined;
        await sendAppointmentConfirmedEmail(studentEmail, {
          ...base,
          meetingUrl: resolvedMeetingUrl,
        });
      }

      if (status === 'Cancelada') {
        // El alumno canceló → avisa al especialista
        if (actorRole === 'alumno' && specialistEmail) {
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
    const id = req.params.id as string;
    const { date, time, modality, byRole } = req.body;

    let previousDate = '';
    let previousTime = '';

    const appointment = await prisma.$transaction(async (tx) => {
      const current = await tx.appointment.findUnique({ where: { id } });
      if (!current) throw new Error('NOT_FOUND');

      previousDate = current.date;
      previousTime = current.time;

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
          ...(byRole === 'student' && { status: 'Pendiente' }),
        },
      });
    });

    // Email: avisa a quien NO reagendó
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

      if (byRole === 'student' && specialistEmail) {
        await sendRescheduledByStudentEmail(specialistEmail, rescheduleData);
      } else if (byRole === 'specialist' && studentEmail) {
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
    console.error('Error rescheduling appointment:', error);
    res.status(500).json({ error: 'Error al reagendar la cita' });
  }
});

export default router;
