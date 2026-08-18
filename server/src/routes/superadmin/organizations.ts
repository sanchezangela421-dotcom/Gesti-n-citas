import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { SuperAdminRequest } from '../../middleware/verifySuperAdmin';
import { writeAudit, getClientIp } from '../../services/auditLogger';
import {
  SEED_DEPARTMENTS,
  normalizeDepartmentName,
  listOrgDepartments,
  syncOrgDepartmentNames,
  departmentIsRenameable,
} from '../../lib/departments';
import { notifyDepartmentDisabled } from '../../services/departmentNotices';
import { upload } from '../../middleware/upload';
import { defaultFieldsForOrgType, normalizeFieldKey } from '../../lib/registrationFields';

const VALID_FIELD_TYPES = ['text', 'number', 'select', 'date', 'radio'];

const router = Router();

// GET /api/superadmin/organizations
router.get('/', async (_req: SuperAdminRequest, res) => {
  try {
    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true, specialists: true, appointments: true } },
      },
    });
    res.json(orgs);
  } catch (error) {
    console.error('[superadmin] Error fetching organizations:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/superadmin/organizations
router.post('/', async (req: SuperAdminRequest, res) => {
  try {
    const { name, slug, type, plan } = req.body;

    if (!name || !slug || !type) {
      return res.status(400).json({ error: 'name, slug y type son requeridos' });
    }

    const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const existing = await prisma.organization.findUnique({ where: { slug: slugClean } });
    if (existing) {
      return res.status(409).json({ error: 'El slug ya está en uso' });
    }

    const { userRoleLabel } = req.body;

    // La organización nace CON sus campos de registro. Antes nacía sin ninguno:
    // su formulario no pedía más que nombre y correo, así que no se capturaba
    // fecha de nacimiento ni género y las gráficas demográficas quedaban vacías
    // para siempre sin que nadie lo notara hasta abrir un reporte.
    //
    // Van en una transacción para que no pueda existir una organización a medio
    // configurar, que es justo el estado que produjo el problema.
    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { name: name.trim(), slug: slugClean, type, plan: plan ?? 'free', active: true, userRoleLabel: userRoleLabel?.trim() || 'Usuario' },
      });

      // Catálogo de departamentos propio de la organización. Nace con los tres
      // originales; desde aquí el superadmin puede añadir los suyos o retirarlos.
      await tx.orgDepartment.createMany({
        data: SEED_DEPARTMENTS.map(d => ({
          organizationId: created.id,
          name: d.name,
          color: d.color,
          icon: d.icon,
          requiresNote: d.requiresNote,
          order: d.order,
        })),
      });

      await tx.registrationField.createMany({
        data: defaultFieldsForOrgType(type).map(f => ({
          organizationId: created.id,
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
          order: f.order,
          options: f.options ?? Prisma.JsonNull,
          placeholder: f.placeholder,
        })),
      });

      return created;
    });

    writeAudit({
      actorId: req.actor!.id,
      actorRole: 'superadmin',
      action: 'CREATE_ORGANIZATION',
      targetEntity: 'Organization',
      targetId: org.id,
      metadata: { name: org.name, slug: org.slug, type: org.type },
      ipAddress: getClientIp(req),
    });

    res.status(201).json(org);
  } catch (error) {
    console.error('[superadmin] Error creating organization:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/superadmin/organizations/:id
router.patch('/:id', async (req: SuperAdminRequest, res) => {
  try {
    const id = req.params.id as string;
    const { name, type, plan, active, userRoleLabel, departments } = req.body;

    const org = await prisma.organization.findUnique({ where: { id } });
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

    const data: any = {};
    if (name !== undefined)          data.name          = name.trim();
    if (type !== undefined)          data.type          = type;
    if (plan !== undefined)          data.plan          = plan;
    if (active !== undefined)        data.active        = active;
    if (userRoleLabel !== undefined) data.userRoleLabel = userRoleLabel.trim() || 'Usuario';

    // Departamentos contratados. Ahora la lista de nombres no reemplaza una
    // columna: activa o desactiva filas del catálogo de la organización. Solo se
    // aceptan nombres que YA existan en él — dar de alta uno nuevo tiene su
    // propio endpoint, para no crearlo sin color, icono ni régimen de nota.
    let removed: string[] = [];

    const updated = await prisma.$transaction(async (tx) => {
      if (departments !== undefined) {
        if (!Array.isArray(departments) || departments.some(d => typeof d !== 'string')) {
          throw new Error('INVALID_DEPARTMENTS');
        }
        const wanted = new Set<string>(departments as string[]);

        const catalog = await tx.orgDepartment.findMany({ where: { organizationId: id } });
        const known = new Set(catalog.map(d => d.name));
        const unknown = [...wanted].filter(n => !known.has(n));
        if (unknown.length > 0) throw new Error(`UNKNOWN_DEPARTMENTS:${unknown.join(', ')}`);

        removed = catalog.filter(d => d.active && !wanted.has(d.name)).map(d => d.name);

        await tx.orgDepartment.updateMany({
          where: { organizationId: id, name: { in: [...wanted] } },
          data: { active: true },
        });
        await tx.orgDepartment.updateMany({
          where: { organizationId: id, name: { notIn: [...wanted] } },
          data: { active: false },
        });
      }

      const saved = await tx.organization.update({ where: { id }, data });
      if (departments !== undefined) await syncOrgDepartmentNames(tx, id);
      return saved;
    });

    // Retirar un departamento NO cancela nada: las citas ya agendadas se
    // respetan y solo se bloquean las nuevas. Se avisa por correo para que
    // nadie intente reservar en vano ni dude de si su cita sigue en pie.
    for (const department of removed) {
      notifyDepartmentDisabled(updated, department);
    }

    writeAudit({
      actorId: req.actor!.id,
      actorRole: 'superadmin',
      action: active === false ? 'DEACTIVATE_ORGANIZATION' : 'UPDATE_ORGANIZATION',
      targetEntity: 'Organization',
      targetId: id,
      organizationId: id,
      metadata: data,
      ipAddress: getClientIp(req),
    });

    res.json(updated);
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'INVALID_DEPARTMENTS') {
      return res.status(400).json({ error: 'La lista de departamentos no es válida.' });
    }
    if (msg.startsWith('UNKNOWN_DEPARTMENTS:')) {
      return res.status(400).json({
        error: `Esta organización no tiene en su catálogo: ${msg.split(':')[1]}. Créalos antes de contratarlos.`,
      });
    }
    console.error('[superadmin] Error updating organization:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/superadmin/organizations/:id
// Soft delete — desactiva la org, no elimina datos
router.delete('/:id', async (req: SuperAdminRequest, res) => {
  try {
    const id = req.params.id as string;

    const org = await prisma.organization.findUnique({ where: { id } });
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

    await prisma.organization.update({ where: { id }, data: { active: false } });

    writeAudit({
      actorId: req.actor!.id,
      actorRole: 'superadmin',
      action: 'DELETE_ORGANIZATION',
      targetEntity: 'Organization',
      targetId: id,
      organizationId: id,
      metadata: { name: org.name },
      ipAddress: getClientIp(req),
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[superadmin] Error deleting organization:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Logo upload ───────────────────────────────────────────────────────────────

// PATCH /api/superadmin/organizations/:id/logo
router.patch('/:id/logo', upload.single('logo'), async (req: SuperAdminRequest, res) => {
  try {
    const id = req.params.id as string;
    if (!req.file) return res.status(400).json({ error: 'No se proporcionó imagen' });

    const org = await prisma.organization.findUnique({ where: { id } });
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

    const logoUrl = `/uploads/${req.file.filename}`;
    const updated = await prisma.organization.update({ where: { id }, data: { logoUrl } });

    writeAudit({
      actorId: req.actor!.id, actorRole: 'superadmin',
      action: 'UPDATE_ORG_LOGO', targetEntity: 'Organization', targetId: id,
      organizationId: id, metadata: { logoUrl },
      ipAddress: getClientIp(req),
    });

    res.json(updated);
  } catch (error) {
    console.error('[superadmin] Error uploading logo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Departamentos de la organización ─────────────────────────────────────────

// GET /api/superadmin/organizations/:id/departments
router.get('/:id/departments', async (req: SuperAdminRequest, res) => {
  try {
    res.json(await listOrgDepartments(req.params.id as string));
  } catch (error) {
    console.error('[superadmin] Error fetching departments:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/superadmin/organizations/:id/departments
router.post('/:id/departments', async (req: SuperAdminRequest, res) => {
  try {
    const organizationId = req.params.id as string;
    const { color, icon, requiresNote, order } = req.body;

    const name = normalizeDepartmentName(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: 'El nombre debe tener entre 2 y 60 caracteres.' });
    }

    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

    const existing = await prisma.orgDepartment.findUnique({
      where: { organizationId_name: { organizationId, name } },
    });
    if (existing) {
      return res.status(409).json({ error: `La organización ya tiene un departamento llamado "${name}".` });
    }

    const department = await prisma.$transaction(async (tx) => {
      const created = await tx.orgDepartment.create({
        data: {
          organizationId,
          name,
          ...(typeof color === 'string' && color.trim() ? { color: color.trim() } : {}),
          ...(typeof icon === 'string' && icon.trim() ? { icon: icon.trim() } : {}),
          ...(requiresNote !== undefined ? { requiresNote: !!requiresNote } : {}),
          ...(Number.isInteger(order) ? { order } : {}),
        },
      });
      await syncOrgDepartmentNames(tx, organizationId);
      return created;
    });

    writeAudit({
      actorId: req.actor!.id, actorRole: 'superadmin',
      action: 'CREATE_DEPARTMENT', targetEntity: 'OrgDepartment', targetId: department.id,
      organizationId, metadata: { name, requiresNote: department.requiresNote },
      ipAddress: getClientIp(req),
    });

    res.status(201).json(department);
  } catch (error) {
    console.error('[superadmin] Error creating department:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/superadmin/organizations/:id/departments/:deptId
router.patch('/:id/departments/:deptId', async (req: SuperAdminRequest, res) => {
  try {
    const organizationId = req.params.id as string;
    const deptId = req.params.deptId as string;
    const { color, icon, requiresNote, active, order } = req.body;

    const department = await prisma.orgDepartment.findUnique({ where: { id: deptId } });
    if (!department || department.organizationId !== organizationId) {
      return res.status(404).json({ error: 'Departamento no encontrado' });
    }

    const data: Record<string, unknown> = {};

    // Renombrar solo mientras no tenga citas ni especialistas: el nombre viaja
    // denormalizado al expediente, y cambiarlo después desconectaría al paciente
    // de su propio historial.
    if (req.body?.name !== undefined) {
      const name = normalizeDepartmentName(req.body.name);
      if (!name) {
        return res.status(400).json({ error: 'El nombre debe tener entre 2 y 60 caracteres.' });
      }
      if (name !== department.name) {
        if (!(await departmentIsRenameable(organizationId, department.name))) {
          return res.status(409).json({
            code: 'DEPARTMENT_IN_USE',
            error: 'Este departamento ya tiene citas o especialistas: su nombre no puede cambiarse. Desactívalo y crea uno nuevo si hace falta.',
          });
        }
        const clash = await prisma.orgDepartment.findUnique({
          where: { organizationId_name: { organizationId, name } },
        });
        if (clash) return res.status(409).json({ error: `Ya existe un departamento llamado "${name}".` });
        data.name = name;
      }
    }

    if (typeof color === 'string' && color.trim())  data.color = color.trim();
    if (typeof icon === 'string' && icon.trim())    data.icon = icon.trim();
    if (requiresNote !== undefined)                 data.requiresNote = !!requiresNote;
    if (active !== undefined)                       data.active = !!active;
    if (Number.isInteger(order))                    data.order = order;

    const wasActive = department.active;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.orgDepartment.update({ where: { id: deptId }, data });
      await syncOrgDepartmentNames(tx, organizationId);
      return row;
    });

    // Retirarlo NO cancela nada: las citas agendadas se respetan y solo se
    // bloquean las nuevas. Se avisa para que nadie intente reservar en vano.
    if (wasActive && updated.active === false) {
      const org = await prisma.organization.findUnique({ where: { id: organizationId } });
      if (org) notifyDepartmentDisabled(org, updated.name);
    }

    writeAudit({
      actorId: req.actor!.id, actorRole: 'superadmin',
      action: 'UPDATE_DEPARTMENT', targetEntity: 'OrgDepartment', targetId: deptId,
      organizationId, metadata: data,
      ipAddress: getClientIp(req),
    });

    res.json(updated);
  } catch (error) {
    console.error('[superadmin] Error updating department:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/superadmin/organizations/:id/departments/:deptId
// Solo si nunca se usó. Con citas o especialistas detrás se desactiva, no se
// borra: el nombre está denormalizado en el expediente y quedaría huérfano.
router.delete('/:id/departments/:deptId', async (req: SuperAdminRequest, res) => {
  try {
    const organizationId = req.params.id as string;
    const deptId = req.params.deptId as string;

    const department = await prisma.orgDepartment.findUnique({ where: { id: deptId } });
    if (!department || department.organizationId !== organizationId) {
      return res.status(404).json({ error: 'Departamento no encontrado' });
    }

    if (!(await departmentIsRenameable(organizationId, department.name))) {
      return res.status(409).json({
        code: 'DEPARTMENT_IN_USE',
        error: 'Este departamento ya tiene citas o especialistas. Desactívalo en vez de eliminarlo: su historial debe conservarse.',
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.orgDepartment.delete({ where: { id: deptId } });
      await syncOrgDepartmentNames(tx, organizationId);
    });

    writeAudit({
      actorId: req.actor!.id, actorRole: 'superadmin',
      action: 'DELETE_DEPARTMENT', targetEntity: 'OrgDepartment', targetId: deptId,
      organizationId, metadata: { name: department.name },
      ipAddress: getClientIp(req),
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[superadmin] Error deleting department:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Registration Fields ───────────────────────────────────────────────────────

// GET /api/superadmin/organizations/:id/fields
router.get('/:id/fields', async (req: SuperAdminRequest, res) => {
  try {
    const id = req.params.id as string;
    const fields = await prisma.registrationField.findMany({
      where: { organizationId: id },
      orderBy: { order: 'asc' },
    });
    res.json(fields);
  } catch (error) {
    console.error('[superadmin] Error fetching fields:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/superadmin/organizations/:id/fields
router.post('/:id/fields', async (req: SuperAdminRequest, res) => {
  try {
    const organizationId = req.params.id as string;
    const { key, label, type, required, options, placeholder, order } =
      req.body as { key?: string; label?: string; type?: string; required?: boolean; options?: string[]; placeholder?: string; order?: number };

    if (!key?.trim() || !label?.trim() || !type) {
      return res.status(400).json({ error: 'key, label y type son requeridos' });
    }
    if (!VALID_FIELD_TYPES.includes(type)) {
      return res.status(400).json({ error: `Tipo inválido. Válidos: ${VALID_FIELD_TYPES.join(', ')}` });
    }
    if ((type === 'select' || type === 'radio') && (!options || options.length === 0)) {
      return res.status(400).json({ error: 'Los campos select/radio requieren al menos una opción' });
    }

    // La MISMA forma normalizada para comprobar y para guardar: antes el chequeo
    // usaba la clave tal cual y la escritura la normalizaba, así que dos etiquetas
    // distintas podían colapsar en la misma clave, pasar el chequeo y reventar
    // contra el índice único devolviendo un 500 en vez de un 409 explicativo.
    const normalizedKey = normalizeFieldKey(key);

    const existing = await prisma.registrationField.findUnique({
      where: { organizationId_key: { organizationId, key: normalizedKey } },
    });
    if (existing) return res.status(409).json({ error: 'Ya existe un campo con ese identificador' });

    const lastField = await prisma.registrationField.findFirst({
      where: { organizationId },
      orderBy: { order: 'desc' },
    });

    const field = await prisma.registrationField.create({
      data: {
        organizationId,
        key:         normalizedKey,
        label:       label.trim(),
        type,
        required:    required ?? false,
        order:       order ?? (lastField ? lastField.order + 1 : 0),
        options:     options && options.length > 0 ? options : Prisma.JsonNull,
        placeholder: placeholder?.trim() || null,
      },
    });

    writeAudit({
      actorId: req.actor!.id, actorRole: 'superadmin',
      action: 'CREATE_REGISTRATION_FIELD',
      targetEntity: 'RegistrationField', targetId: field.id,
      organizationId, metadata: { key: field.key, label: field.label, type: field.type },
      ipAddress: getClientIp(req),
    });

    res.status(201).json(field);
  } catch (error) {
    console.error('[superadmin] Error creating field:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/superadmin/organizations/:id/fields/:fieldId
router.patch('/:id/fields/:fieldId', async (req: SuperAdminRequest, res) => {
  try {
    const organizationId = req.params.id as string;
    const fieldId        = req.params.fieldId as string;
    const { label, type, required, options, placeholder, order } = req.body;

    const field = await prisma.registrationField.findUnique({ where: { id: fieldId } });
    if (!field || field.organizationId !== organizationId) {
      return res.status(404).json({ error: 'Campo no encontrado' });
    }

    const data: Prisma.RegistrationFieldUpdateInput = {};
    if (label !== undefined)       data.label       = label.trim();
    if (type !== undefined)        data.type        = type;
    if (required !== undefined)    data.required    = required;
    if (order !== undefined)       data.order       = order;
    if (placeholder !== undefined) data.placeholder = placeholder?.trim() || null;
    if (options !== undefined)     data.options     = options && options.length > 0 ? options : Prisma.JsonNull;

    const updated = await prisma.registrationField.update({ where: { id: fieldId }, data });
    res.json(updated);
  } catch (error) {
    console.error('[superadmin] Error updating field:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/superadmin/organizations/:id/fields/:fieldId
router.delete('/:id/fields/:fieldId', async (req: SuperAdminRequest, res) => {
  try {
    const organizationId = req.params.id as string;
    const fieldId        = req.params.fieldId as string;

    const field = await prisma.registrationField.findUnique({ where: { id: fieldId } });
    if (!field || field.organizationId !== organizationId) {
      return res.status(404).json({ error: 'Campo no encontrado' });
    }

    await prisma.registrationField.delete({ where: { id: fieldId } });

    writeAudit({
      actorId: req.actor!.id, actorRole: 'superadmin',
      action: 'DELETE_REGISTRATION_FIELD',
      targetEntity: 'RegistrationField', targetId: fieldId,
      organizationId, metadata: { key: field.key, label: field.label },
      ipAddress: getClientIp(req),
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[superadmin] Error deleting field:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
