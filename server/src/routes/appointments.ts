import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';

const router = Router();

// GET /api/appointments
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
      orderBy: [{ date: 'asc' }, { time: 'asc' }]
    });

    res.json(appointments);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/appointments
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

      if (conflict) {
        throw new Error('SLOT_TAKEN');
      }

      // Prevent duplicate follow-up: if parentId provided, check no active follow-up exists
      if (data.parentId) {
        const existingFollowUp = await tx.appointment.findFirst({
          where: {
            parentId: data.parentId,
            status: { notIn: ['Cancelada'] },
          },
        });
        if (existingFollowUp) {
          throw new Error('DUPLICATE_FOLLOW_UP');
        }
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

const VALID_TRANSITIONS: Record<string, string[]> = {
  'Pendiente':  ['Confirmada', 'Cancelada'],
  'Confirmada': ['Completada', 'Cancelada'],
  'Completada': [],
  'Cancelada':  [],
};

// PATCH /api/appointments/:id/status
router.patch('/:id/status', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const { status, notes } = req.body;

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

      // Only students are restricted to 24h; specialists and admins can cancel anytime
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
        ...(notes !== undefined && { notes })
      }
    });

    res.json(appointment);
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ error: 'Error al actualizar la cita' });
  }
});

// PATCH /api/appointments/:id/reschedule
router.patch('/:id/reschedule', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const { date, time, modality, byRole } = req.body;

    const appointment = await prisma.$transaction(async (tx) => {
      const current = await tx.appointment.findUnique({ where: { id } });
      if (!current) throw new Error('NOT_FOUND');

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
