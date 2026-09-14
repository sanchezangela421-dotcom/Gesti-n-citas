import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { SuperAdminRequest } from '../../middleware/verifySuperAdmin';

const router = Router();
const PAGE_SIZE = 100;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Límites del día en la zona horaria DEL SERVIDOR (TZ), no en UTC.
 *
 * Quien consulta la bitácora piensa en "lo que pasó el martes" según su reloj.
 * Con UTC, a partir de las 18:00 hora de México el día ya habría cambiado y los
 * eventos de esa tarde caerían fuera del filtro.
 */
function dayStart(value: string): Date {
  return new Date(`${value}T00:00:00`);
}
function dayEnd(value: string): Date {
  return new Date(`${value}T23:59:59.999`);
}

// GET /api/superadmin/audit/actions
//
// Las acciones que existen HOY en la bitácora, para poblar el selector del panel.
// Se consultan en vez de escribirlas en el frontend: una lista fija se desfasa en
// cuanto se añade un evento nuevo, y filtrar por un valor que no existe devuelve
// una pantalla vacía sin explicar por qué.
router.get('/actions', async (_req: SuperAdminRequest, res) => {
  try {
    const rows = await prisma.auditLog.groupBy({
      by: ['action'],
      _count: { action: true },
      orderBy: { action: 'asc' },
    });
    res.json(rows.map(r => ({ action: r.action, count: r._count.action })));
  } catch (error) {
    console.error('[superadmin] Error fetching audit actions:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/superadmin/audit?orgId=&action=&actorId=&ip=&email=&from=&to=&page=
//
// Antes solo se podía filtrar por organización y paginar, así que responder
// "todos los intentos fallidos desde esta IP" era imposible desde la pantalla.
// Los índices que sostienen estos filtros (action+fecha, fecha, IP+fecha) ya
// existen desde la migración 20260910000000.
router.get('/', async (req: SuperAdminRequest, res) => {
  try {
    const { orgId, action, actorId, ip, email, from, to } = req.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1'));

    for (const [name, value] of [['from', from], ['to', to]] as const) {
      if (value && !ISO_DATE.test(value)) {
        return res.status(400).json({ error: `El parámetro ${name} debe tener el formato YYYY-MM-DD` });
      }
    }
    if (from && to && from > to) {
      return res.status(422).json({ error: 'El rango de fechas está invertido' });
    }

    const where: Prisma.AuditLogWhereInput = {};
    if (orgId) where.organizationId = orgId;
    if (action) where.action = action;
    if (actorId) where.actorId = actorId;
    if (ip) where.ipAddress = ip;

    // El correo de un intento vive en `metadata`, no en una columna: es el dato
    // que separa "alguien probando correos al azar" de "alguien insistiendo
    // sobre una cuenta concreta", que son incidentes distintos.
    if (email) where.metadata = { path: ['email'], equals: email };

    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: dayStart(from) } : {}),
        ...(to ? { lte: dayEnd(to) } : {}),
      };
    }

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ entries, total, page, pageSize: PAGE_SIZE });
  } catch (error) {
    console.error('[superadmin] Error fetching audit log:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
