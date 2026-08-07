import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { orgScope } from '../lib/orgScope';
import { getCallerSpecialist } from '../lib/clinicalAccess';
import { writeAudit, getClientIp } from '../services/auditLogger';

const router = Router();

// ── GET /api/patients ───────────────────────────────────────────────────────────
// Pacientes atendidos por el especialista autenticado (distinct de SUS citas).
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const spec = await getCallerSpecialist(req);
    if (!spec) return res.status(403).json({ error: 'Solo especialistas' });

    const appts = await prisma.appointment.findMany({
      where: { specialistId: spec.id, ...orgScope(req.user) },
      select: { studentId: true, studentName: true, date: true },
      orderBy: { date: 'desc' },
    });

    // Agregar por paciente: última sesión (más reciente, ya viene ordenado desc) y total
    const byStudent = new Map<string, { studentId: string; studentName: string; lastSession: string; total: number; inactive: boolean }>();
    for (const a of appts) {
      const cur = byStudent.get(a.studentId);
      if (cur) cur.total += 1;
      else byStudent.set(a.studentId, { studentId: a.studentId, studentName: a.studentName, lastSession: a.date, total: 1, inactive: false });
    }

    // Los pacientes dados de baja SIGUEN apareciendo: su expediente debe conservarse
    // y consultarse (NOM-004). Solo se marcan como inactivos para que el
    // especialista sepa que ya no puede agendar con ellos.
    if (byStudent.size > 0) {
      const deactivated = await prisma.user.findMany({
        where: { id: { in: [...byStudent.keys()] }, NOT: { deletedAt: null } },
        select: { id: true },
      });
      for (const { id } of deactivated) {
        const entry = byStudent.get(id);
        if (entry) entry.inactive = true;
      }
    }

    res.json([...byStudent.values()]);
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/patients/:studentId/record ─────────────────────────────────────────
// Expediente del paciente con continuidad por departamento.
// Triple filtro: organización + departamento del especialista + relación de atención.
router.get('/:studentId/record', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const spec = await getCallerSpecialist(req);
    if (!spec) return res.status(403).json({ error: 'Solo especialistas' });

    const studentId = req.params.studentId as string;
    const scope = orgScope(req.user);

    // Gate: el especialista debe tener una relación de atención real con el paciente.
    // No se exige que el paciente siga activo: el expediente de una persona dada de
    // baja debe permanecer consultable durante todo el periodo de retención.
    const relation = await prisma.appointment.findFirst({
      where: { specialistId: spec.id, studentId, ...scope },
      select: { id: true },
    });
    if (!relation) {
      return res.status(403).json({ error: 'No tienes una relación de atención con este paciente.' });
    }

    const patient = await prisma.user.findUnique({
      where: { id: studentId },
      select: { deletedAt: true },
    });

    // Timeline: historial del paciente DENTRO del departamento del especialista
    const appointments = await prisma.appointment.findMany({
      where: { studentId, department: spec.department, ...scope },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      select: {
        id: true, date: true, time: true, status: true, modality: true,
        motivo: true, specialistId: true, specialistName: true,
        isFollowUp: true, parentId: true,
      },
    });

    // Notas visibles por continuidad de departamento (mismo depto + misma org)
    const notes = await prisma.clinicalNote.findMany({
      where: { studentId, department: spec.department, ...scope },
      select: { id: true, appointmentId: true, specialistId: true, body: true, createdAt: true, updatedAt: true },
    });
    const noteByAppt = new Map(notes.map(n => [n.appointmentId, n]));

    const timeline = appointments.map(a => {
      const n = noteByAppt.get(a.id);
      return {
        ...a,
        note: n
          ? { id: n.id, body: n.body, authoredByMe: n.specialistId === spec.id, createdAt: n.createdAt, updatedAt: n.updatedAt }
          : null,
      };
    });

    // Auditoría: todo acceso al expediente queda registrado, marcando si hubo continuidad
    const viaContinuidad = notes.some(n => n.specialistId !== spec.id);
    writeAudit({
      actorId: req.user!.id,
      actorRole: 'especialista',
      action: 'CLINICAL_RECORD_VIEWED',
      targetEntity: 'PatientRecord',
      targetId: studentId,
      organizationId: req.user?.organizationId ?? null,
      metadata: { department: spec.department, notesCount: notes.length, viaContinuidad },
      ipAddress: getClientIp(req),
    });

    res.json({ studentId, department: spec.department, inactive: !!patient?.deletedAt, timeline });
  } catch (error) {
    console.error('Error fetching patient record:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
