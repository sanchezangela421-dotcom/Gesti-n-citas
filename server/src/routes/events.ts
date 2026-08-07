import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { upload } from '../middleware/upload';
import { orgScope } from '../lib/orgScope';
import { sanitizeOptionalHttpUrl } from '../lib/urls';

const router = Router();

const INVALID_URL = 'El enlace de registro debe ser una URL http(s) válida.';

/**
 * Notificación in-app "nuevo evento" para todos los end-users de la organización
 * del evento, en una sola operación (createMany). Antes esto lo hacía el frontend
 * con un POST /notifications por alumno: cientos de requests desde el navegador
 * del admin que chocaban con el rate limit y dejaban alumnos sin notificar.
 * Fire-and-forget: un fallo aquí no debe tirar la creación del evento.
 */
function notifyOrgAboutEvent(event: { id: string; title: string; department: string; date: string; time: string; organizationId: string | null }) {
  (async () => {
    const recipients = await prisma.user.findMany({
      where: {
        role: { in: [UserRole.alumno, UserRole.usuario] },
        organizationId: event.organizationId,
        deletedAt: null, // los dados de baja no pueden entrar a ver el evento
      },
      select: { id: true },
    });
    if (recipients.length === 0) return;

    const dateStr = new Date(event.date + 'T12:00:00')
      .toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
    const timeNow = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    await prisma.notification.createMany({
      data: recipients.map(u => ({
        userId: u.id,
        title: `Nuevo evento: ${event.title}`,
        message: `Se publicó un nuevo evento de ${event.department}: "${event.title}" el ${dateStr}${event.time ? ` a las ${event.time}` : ''}.`,
        time: timeNow,
        type: 'event',
        organizationId: event.organizationId,
      })),
    });
  })().catch(err => console.error('[events] Error creando notificaciones del evento:', err));
}

// GET /api/events
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const { department } = req.query;
    const where: any = { ...orgScope(req.user) };
    if (department) where.department = department;

    const events = await prisma.appEvent.findMany({
      where,
      orderBy: { date: 'asc' },
      include: {
        _count: { select: { registrations: true } },
        registrations: { where: { userId: req.user!.id }, select: { id: true } },
      },
    });

    // Aplanar: agregar conteo de inscritos e indicar si el usuario actual ya está inscrito
    const shaped = events.map(({ _count, registrations, ...e }) => ({
      ...e,
      registeredCount: _count.registrations,
      isRegistered: registrations.length > 0,
    }));
    res.json(shaped);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/events
router.post('/', verifyToken as any, upload.single('image'), async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'especialista' && req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  try {
    const { title, description, department, date, time, type, registrationUrl } = req.body;
    let imageUrl = req.body.imageUrl;

    if (!title || !date || !department) {
      return res.status(400).json({ error: 'title, date y department son requeridos' });
    }

    // El alumno abre este enlace con window.open desde el carrusel: solo http(s)
    const safeRegUrl = sanitizeOptionalHttpUrl(registrationUrl);
    if (!safeRegUrl.ok) return res.status(400).json({ error: INVALID_URL });

    // Si se subió una imagen vía multer
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    const event = await prisma.appEvent.create({
      data: {
        title,
        description: description || '',
        department,
        date,
        time: time || '',
        type: type || 'conferencia',
        imageUrl: imageUrl || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=400&q=80',
        registrationUrl: safeRegUrl.value,
        createdById: req.user?.id ?? null,
        organizationId: req.user?.organizationId ?? null,
      }
    });

    notifyOrgAboutEvent(event);

    res.status(201).json(event);
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/events/:id
router.patch('/:id', verifyToken as any, upload.single('image'), async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'especialista' && req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  try {
    const existing = await prisma.appEvent.findUnique({ where: { id: req.params.id as string } });
    if (!existing) return res.status(404).json({ error: 'No encontrado' });
    if (req.user?.role !== 'superadmin' && existing.organizationId !== req.user?.organizationId) {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const { title, description, department, date, time, type, registrationUrl } = req.body;
    const data: any = {};
    if (title !== undefined)           data.title = title;
    if (description !== undefined)     data.description = description;
    if (department !== undefined)      data.department = department;
    if (date !== undefined)            data.date = date;
    if (time !== undefined)            data.time = time;
    if (type !== undefined)            data.type = type;
    if (registrationUrl !== undefined) {
      const safeRegUrl = sanitizeOptionalHttpUrl(registrationUrl);
      if (!safeRegUrl.ok) return res.status(400).json({ error: INVALID_URL });
      data.registrationUrl = safeRegUrl.value;
    }
    if (req.file)                      data.imageUrl = `/uploads/${req.file.filename}`;
    else if (req.body.imageUrl !== undefined) data.imageUrl = req.body.imageUrl;

    const event = await prisma.appEvent.update({ where: { id: req.params.id as string }, data });
    res.json(event);
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/events/:id
router.delete('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'especialista' && req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  try {
    const existing = await prisma.appEvent.findUnique({ where: { id: req.params.id as string } });
    if (!existing) return res.status(404).json({ error: 'No encontrado' });
    if (req.user?.role !== 'superadmin' && existing.organizationId !== req.user?.organizationId) {
      return res.status(403).json({ error: 'Sin permisos' });
    }
    await prisma.appEvent.delete({ where: { id: req.params.id as string } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/events/:id/register ─────────────────────────────────────────────
// El alumno/usuario se inscribe al evento (vincula su cuenta). Idempotente.
router.post('/:id/register', verifyToken as any, async (req: AuthRequest, res) => {
  const caller = req.user!;
  if (caller.role !== 'alumno' && caller.role !== 'usuario') {
    return res.status(403).json({ error: 'Solo los usuarios pueden inscribirse' });
  }
  try {
    const id = req.params.id as string;
    const event = await prisma.appEvent.findFirst({ where: { id, ...orgScope(caller) } });
    if (!event) return res.status(404).json({ error: 'Evento no encontrado' });

    try {
      await prisma.eventRegistration.create({
        data: { eventId: id, userId: caller.id, organizationId: event.organizationId },
      });
    } catch (e: any) {
      if (e.code === 'P2002') return res.json({ ok: true, alreadyRegistered: true }); // ya inscrito
      throw e;
    }
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error('Error registering to event:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── DELETE /api/events/:id/register ───────────────────────────────────────────
// El alumno/usuario cancela su inscripción. Idempotente.
router.delete('/:id/register', verifyToken as any, async (req: AuthRequest, res) => {
  const caller = req.user!;
  try {
    const id = req.params.id as string;
    await prisma.eventRegistration.deleteMany({ where: { eventId: id, userId: caller.id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error unregistering from event:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/events/:id/registrations ─────────────────────────────────────────
// Lista de inscritos: el admin ve los de su org; el especialista solo los de SUS eventos.
router.get('/:id/registrations', verifyToken as any, async (req: AuthRequest, res) => {
  const caller = req.user!;
  if (caller.role !== 'admin' && caller.role !== 'superadmin' && caller.role !== 'especialista') {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  try {
    const id = req.params.id as string;
    const event = await prisma.appEvent.findFirst({ where: { id, ...orgScope(caller) } });
    if (!event) return res.status(404).json({ error: 'Evento no encontrado' });

    // El especialista solo ve inscritos de los eventos que él creó
    if (caller.role === 'especialista' && event.createdById !== caller.id) {
      return res.status(403).json({ error: 'Solo puedes ver inscritos de tus propios eventos' });
    }

    const regs = await prisma.eventRegistration.findMany({
      where: { eventId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
    });
    res.json(regs.map(r => ({
      id: r.id,
      registeredAt: r.createdAt,
      userId: r.user.id,
      name: r.user.name,
      email: r.user.email,
    })));
  } catch (error) {
    console.error('Error fetching event registrations:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
