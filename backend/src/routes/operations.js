const express = require('express');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');
const { logger } = require('../config/logger');

const router = express.Router();

router.use(authenticate);

// Dashboard i stats tenen el seu propi control (secció 'dashboard').
// La resta d'endpoints d'operacions requereixen accés a la secció 'operations'.
router.use((req, res, next) => {
  // Endpoints exempts: dashboard i stats (controlats per la secció 'dashboard')
  if (req.path === '/dashboard' || req.path === '/stats') {
    return next();
  }
  // Notificacions també són generals (qualsevol usuari autenticat)
  if (req.path.startsWith('/notifications')) {
    return next();
  }
  // Absències: qualsevol usuari pot gestionar les seves pròpies
  if (req.path.startsWith('/absences')) {
    return next();
  }
  // La resta requereix permís 'operations'
  requireSection('operations')(req, res, next);
});

// ===========================================
// Tasques predeterminades per projecte
// ===========================================

const DEFAULT_PROJECT_TASKS = [
  { title: 'Backfocus Camera', category: 'TECH' },
  { title: 'Col·limar òptiques', category: 'TECH' },
  { title: 'Revisar bateries', category: 'TECH' },
  { title: 'Linkar teradeks', category: 'TECH' },
  { title: 'Posar GPS', category: 'TECH' },
];

async function createDefaultTasks(projectId, createdById = null) {
  try {
    await prisma.projectTask.createMany({
      data: DEFAULT_PROJECT_TASKS.map((t) => ({
        projectId,
        title: t.title,
        category: t.category,
        status: 'OP_PENDING',
        createdById,
      })),
    });
  } catch (err) {
    logger.error('Error creant tasques predeterminades:', err.message);
  }
}

// ===========================================
// EQUIP — Llista d'usuaris actius (per selectors)
// ===========================================

// GET /api/operations/team — Usuaris actius (id, name) per usar als selectors
router.get('/team', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// ROLS — Definicions i Assignacions
// ===========================================

// GET /api/operations/roles — Llistar rols amb assignacions actuals
router.get('/roles', async (req, res, next) => {
  try {
    const roles = await prisma.roleDefinition.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        assignments: {
          where: {
            OR: [
              { endDate: null },
              { endDate: { gte: new Date() } },
            ],
          },
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: { isPrimary: 'desc' },
        },
        permissions: true,
      },
    });
    res.json(roles);
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/roles/:id — Actualitzar rol
router.put('/roles/:id', async (req, res, next) => {
  try {
    const { name, shortName, description, responsibilities, limitations, color, icon } = req.body;
    const role = await prisma.roleDefinition.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(shortName && { shortName }),
        ...(description !== undefined && { description }),
        ...(responsibilities && { responsibilities }),
        ...(limitations !== undefined && { limitations }),
        ...(color && { color }),
        ...(icon !== undefined && { icon }),
      },
    });
    res.json(role);
  } catch (err) {
    next(err);
  }
});

// POST /api/operations/roles/:id/assign — Assignar persona a rol
router.post('/roles/:id/assign', async (req, res, next) => {
  try {
    const { userId, isPrimary = true, notes } = req.body;
    const role = await prisma.roleDefinition.findUnique({ where: { id: req.params.id } });
    if (!role) return res.status(404).json({ error: 'Rol no trobat' });

    const assignment = await prisma.roleAssignment.create({
      data: {
        roleId: req.params.id,
        userId,
        isPrimary,
        notes,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        role: { select: { name: true, code: true } },
      },
    });
    res.json(assignment);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/operations/role-assignments/:id — Desassignar persona de rol
router.delete('/role-assignments/:id', async (req, res, next) => {
  try {
    await prisma.roleAssignment.update({
      where: { id: req.params.id },
      data: { endDate: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/role-permissions — Actualitzar permisos d'un rol
router.put('/role-permissions', async (req, res, next) => {
  try {
    const { roleId, section, level } = req.body;
    const perm = await prisma.rolePermission.upsert({
      where: { roleId_section: { roleId, section } },
      create: { roleId, section, level },
      update: { level },
    });
    res.json(perm);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// PROJECTES
// ===========================================

// GET /api/operations/projects — Llistar projectes amb filtres
router.get('/projects', async (req, res, next) => {
  try {
    const {
      status, search, dateFrom, dateTo,
      priority, leadUserId,
      sortBy = 'departureDate', sortOrder = 'asc',
      page = 1, limit = 50,
    } = req.query;

    const where = {};
    if (status) {
      // Suporta múltiples estats separats per coma
      const statuses = status.split(',');
      where.status = statuses.length > 1 ? { in: statuses } : statuses[0];
    }
    if (priority) where.priority = parseInt(priority);
    if (leadUserId) where.leadUserId = leadUserId;
    if (dateFrom || dateTo) {
      where.departureDate = {};
      if (dateFrom) where.departureDate.gte = new Date(dateFrom);
      if (dateTo) where.departureDate.lte = new Date(dateTo + 'T23:59:59.999Z');
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { clientName: { contains: search, mode: 'insensitive' } },
        { budgetReference: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const orderBy = { [sortBy]: sortOrder };

    const [projects, total] = await Promise.all([
      prisma.rentalProject.findMany({
        where,
        orderBy,
        skip,
        take: parseInt(limit),
        include: {
          leadUser: { select: { id: true, name: true } },
          techSupportUser: { select: { id: true, name: true } },
          returnLeadUser: { select: { id: true, name: true } },
          client: { select: { id: true, name: true } },
          assignments: {
            include: { user: { select: { id: true, name: true } } },
          },
          _count: {
            select: { incidents: true, tasks: true, equipmentItems: true, communications: true },
          },
        },
      }),
      prisma.rentalProject.count({ where }),
    ]);

    res.json({ projects, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
});

// GET /api/operations/projects/:id — Detall complet d'un projecte
router.get('/projects/:id', async (req, res, next) => {
  try {
    const project = await prisma.rentalProject.findUnique({
      where: { id: req.params.id },
      include: {
        leadUser: { select: { id: true, name: true, email: true } },
        techSupportUser: { select: { id: true, name: true, email: true } },
        returnLeadUser: { select: { id: true, name: true, email: true } },
        client: { select: { id: true, name: true, phone: true, email: true } },
        assignments: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { isLead: 'desc' },
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
        incidents: {
          orderBy: { createdAt: 'desc' },
        },
        tasks: {
          include: {
            createdBy: { select: { id: true, name: true } },
            assignedTo: { select: { id: true, name: true } },
            completedBy: { select: { id: true, name: true } },
          },
          orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        },
        equipmentItems: {
          include: {
            equipment: { select: { id: true, name: true, serialNumber: true, category: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        communications: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!project) return res.status(404).json({ error: 'Projecte no trobat' });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

// POST /api/operations/projects — Crear projecte
router.post('/projects', async (req, res, next) => {
  try {
    const {
      name, clientName, clientId,
      checkDate, checkTime,
      departureDate, departureTime,
      shootEndDate, shootEndTime,
      returnDate, returnTime,
      priority = 0, leadUserId, techSupportUserId, returnLeadUserId, leadRoleCode,
      transportType, transportNotes, pickupTime,
      techValidationRequired = false,
      rentmanProjectId, budgetReference,
      internalNotes, clientNotes,
    } = req.body;

    const project = await prisma.rentalProject.create({
      data: {
        name,
        clientName,
        clientId: clientId || null,
        checkDate: checkDate ? new Date(checkDate) : null,
        checkTime: checkTime || null,
        departureDate: new Date(departureDate),
        departureTime,
        shootEndDate: shootEndDate ? new Date(shootEndDate) : null,
        shootEndTime: shootEndTime || null,
        returnDate: new Date(returnDate),
        returnTime,
        priority,
        leadUserId: leadUserId || null,
        techSupportUserId: techSupportUserId || null,
        returnLeadUserId: returnLeadUserId || null,
        leadRoleCode,
        transportType,
        transportNotes,
        pickupTime,
        techValidationRequired,
        rentmanProjectId,
        budgetReference,
        internalNotes,
        clientNotes,
        statusHistory: {
          create: {
            toStatus: 'PENDING_PREP',
            changedBy: req.user.id,
            reason: 'Projecte creat',
          },
        },
      },
      include: {
        leadUser: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
      },
    });

    // Crear tasques predeterminades
    await createDefaultTasks(project.id, req.user.id);

    // Notificar WAREHOUSE_LEAD
    await createNotificationForRole('WAREHOUSE_LEAD', {
      type: 'project_created',
      title: 'Nou projecte creat',
      message: `${project.name} — Sortida: ${new Date(departureDate).toLocaleDateString('ca-ES')}`,
      entityType: 'rental_project',
      entityId: project.id,
      priority: priority >= 2 ? 'urgent' : 'normal',
    });

    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/projects/:id — Actualitzar projecte
router.put('/projects/:id', async (req, res, next) => {
  try {
    const data = { ...req.body };
    // Convertir dates si venen com a string
    if (data.departureDate) data.departureDate = new Date(data.departureDate);
    if (data.returnDate) data.returnDate = new Date(data.returnDate);
    if (data.actualReturnDate) data.actualReturnDate = new Date(data.actualReturnDate);

    // Treure camps que no van directament al update
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;
    delete data.leadUser;
    delete data.techSupportUser;
    delete data.returnLeadUser;
    delete data.client;
    delete data.assignments;
    delete data.statusHistory;
    delete data.incidents;
    delete data.tasks;
    delete data.equipmentItems;
    delete data.communications;
    delete data._count;

    const project = await prisma.rentalProject.update({
      where: { id: req.params.id },
      data,
      include: {
        leadUser: { select: { id: true, name: true } },
        techSupportUser: { select: { id: true, name: true } },
        returnLeadUser: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
      },
    });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/projects/:id/status — Canviar estat del projecte
router.put('/projects/:id/status', async (req, res, next) => {
  try {
    const { status, reason } = req.body;
    const current = await prisma.rentalProject.findUnique({
      where: { id: req.params.id },
      select: { status: true, name: true },
    });
    if (!current) return res.status(404).json({ error: 'Projecte no trobat' });

    const project = await prisma.rentalProject.update({
      where: { id: req.params.id },
      data: {
        status,
        statusHistory: {
          create: {
            fromStatus: current.status,
            toStatus: status,
            changedBy: req.user.id,
            reason,
          },
        },
      },
    });

    // Notificacions automàtiques per canvis d'estat rellevants
    if (status === 'PENDING_TECH_REVIEW') {
      await createNotificationForRole('TECH_LEAD', {
        type: 'tech_review_needed',
        title: 'Revisió tècnica necessària',
        message: `${current.name} requereix validació tècnica`,
        entityType: 'rental_project',
        entityId: req.params.id,
        priority: 'high',
      });
    }

    res.json(project);
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/projects/:id/validate-warehouse — Validar magatzem
router.put('/projects/:id/validate-warehouse', async (req, res, next) => {
  try {
    const project = await prisma.rentalProject.update({
      where: { id: req.params.id },
      data: {
        warehouseValidated: true,
        warehouseValidatedBy: req.user.id,
        warehouseValidatedAt: new Date(),
      },
    });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/projects/:id/validate-tech — Validar tècnica
router.put('/projects/:id/validate-tech', async (req, res, next) => {
  try {
    const project = await prisma.rentalProject.update({
      where: { id: req.params.id },
      data: {
        techValidated: true,
        techValidatedBy: req.user.id,
        techValidatedAt: new Date(),
      },
    });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// ASSIGNACIONS DE PROJECTE
// ===========================================

// POST /api/operations/projects/:id/assignments — Assignar persona
router.post('/projects/:id/assignments', async (req, res, next) => {
  try {
    const { userId, roleCode, isLead = false, notes } = req.body;
    const assignment = await prisma.projectAssignment.create({
      data: {
        projectId: req.params.id,
        userId,
        roleCode,
        isLead,
        notes,
      },
      include: { user: { select: { id: true, name: true } } },
    });

    // Notificar l'usuari assignat
    createNotificationForUser(userId, {
      type: 'project_assigned',
      title: 'Assignat a un projecte',
      message: `T'han assignat al projecte`,
      entityType: 'rental_project',
      entityId: req.params.id,
    });

    res.json(assignment);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/operations/project-assignments/:id
router.delete('/project-assignments/:id', async (req, res, next) => {
  try {
    await prisma.projectAssignment.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ===========================================
// MATERIAL DEL PROJECTE (ProjectEquipment)
// ===========================================

// POST /api/operations/projects/:id/equipment — Afegir equip
router.post('/projects/:id/equipment', async (req, res, next) => {
  try {
    const { equipmentId, itemName, quantity = 1, notes } = req.body;

    // Si s'indica equipmentId, obtenim el nom automàticament
    let name = itemName;
    if (equipmentId && !name) {
      const eq = await prisma.equipment.findUnique({ where: { id: equipmentId }, select: { name: true } });
      name = eq?.name || 'Equip desconegut';
    }

    const item = await prisma.projectEquipment.create({
      data: {
        projectId: req.params.id,
        equipmentId: equipmentId || null,
        itemName: name,
        quantity,
        notes,
      },
      include: {
        equipment: { select: { id: true, name: true, serialNumber: true, category: true } },
      },
    });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/project-equipment/:id — Actualitzar equip del projecte
router.put('/project-equipment/:id', async (req, res, next) => {
  try {
    const { isCheckedOut, isReturned, returnCondition, notes } = req.body;
    const item = await prisma.projectEquipment.update({
      where: { id: req.params.id },
      data: {
        ...(isCheckedOut !== undefined && { isCheckedOut }),
        ...(isReturned !== undefined && { isReturned }),
        ...(returnCondition !== undefined && { returnCondition }),
        ...(notes !== undefined && { notes }),
      },
    });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/operations/project-equipment/:id
router.delete('/project-equipment/:id', async (req, res, next) => {
  try {
    await prisma.projectEquipment.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ===========================================
// TASQUES DEL PROJECTE
// ===========================================

// POST /api/operations/projects/:id/default-tasks — Crear tasques predeterminades
router.post('/projects/:id/default-tasks', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Comprovar que el projecte existeix
    const project = await prisma.rentalProject.findUnique({ where: { id } });
    if (!project) return res.status(404).json({ error: 'Projecte no trobat' });

    // Comprovar si ja té alguna de les tasques predeterminades
    const existing = await prisma.projectTask.findMany({
      where: {
        projectId: id,
        title: { in: DEFAULT_PROJECT_TASKS.map((t) => t.title) },
      },
    });
    const existingTitles = new Set(existing.map((t) => t.title));
    const toCreate = DEFAULT_PROJECT_TASKS.filter((t) => !existingTitles.has(t.title));

    if (toCreate.length === 0) {
      return res.json({ message: 'Totes les tasques predeterminades ja existeixen', created: 0, tasks: [] });
    }

    await prisma.projectTask.createMany({
      data: toCreate.map((t) => ({
        projectId: id,
        title: t.title,
        category: t.category,
        status: 'OP_PENDING',
        createdById: req.user.id,
      })),
    });

    // Retornar totes les tasques del projecte
    const tasks = await prisma.projectTask.findMany({
      where: { projectId: id },
      include: {
        assignedTo: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ message: `${toCreate.length} tasques creades`, created: toCreate.length, tasks });
  } catch (err) {
    next(err);
  }
});

// POST /api/operations/projects/:id/tasks — Crear tasca
router.post('/projects/:id/tasks', async (req, res, next) => {
  try {
    const { title, description, assignedToId, dueAt, requiresSupervision = false } = req.body;
    const task = await prisma.projectTask.create({
      data: {
        projectId: req.params.id,
        title,
        description,
        createdById: req.user.id,
        assignedToId,
        dueAt: dueAt ? new Date(dueAt) : null,
        requiresSupervision,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });

    // Notificar si s'assigna a algú (delegació)
    if (assignedToId && assignedToId !== req.user.id) {
      const project = await prisma.rentalProject.findUnique({
        where: { id: req.params.id },
        select: { name: true },
      });
      await createNotificationForUser(assignedToId, {
          type: 'task_assigned',
          title: `Tasca delegada per ${req.user.name || 'un company'}`,
          message: `${title}${project ? ` — Projecte: ${project.name}` : ''}`,
          entityType: 'rental_project',
          entityId: req.params.id,
          priority: requiresSupervision ? 'high' : 'normal',
      });
    }

    res.json(task);
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/tasks/:id — Actualitzar tasca
router.put('/tasks/:id', async (req, res, next) => {
  try {
    const {
      title, description, notes, assignedToId, status,
      category, dueAt, dueTime,
      reminder, reminderCustom,
      recurrence, recurrenceCustom, recurrenceEndAt,
      requiresSupervision, projectId,
    } = req.body;

    const data = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (notes !== undefined) data.notes = notes;
    if (assignedToId !== undefined) data.assignedToId = assignedToId;
    if (category !== undefined) data.category = category;
    if (dueAt !== undefined) data.dueAt = dueAt ? new Date(dueAt) : null;
    if (dueTime !== undefined) data.dueTime = dueTime || null;
    if (reminder !== undefined) data.reminder = reminder;
    if (reminderCustom !== undefined) data.reminderCustom = reminderCustom;
    if (recurrence !== undefined) data.recurrence = recurrence;
    if (recurrenceCustom !== undefined) data.recurrenceCustom = recurrenceCustom;
    if (recurrenceEndAt !== undefined) data.recurrenceEndAt = recurrenceEndAt ? new Date(recurrenceEndAt) : null;
    if (requiresSupervision !== undefined) data.requiresSupervision = requiresSupervision;
    if (projectId !== undefined) data.projectId = projectId || null;

    if (status !== undefined) {
      data.status = status;
      if (status === 'OP_DONE') {
        data.completedAt = new Date();
        data.completedById = req.user.id;
      } else if (status !== 'OP_DONE') {
        data.completedAt = null;
        data.completedById = null;
      }
    }

    const currentTask = await prisma.projectTask.findUnique({
      where: { id: req.params.id },
      select: { assignedToId: true, title: true, projectId: true },
    });

    const task = await prisma.projectTask.update({
      where: { id: req.params.id },
      data,
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });

    // Notificar + push si es reassigna
    if (assignedToId && assignedToId !== currentTask?.assignedToId && assignedToId !== req.user.id) {
      logger.info(`Tasca ${task.id} reassignada a ${assignedToId} per ${req.user.id}`);
      await createNotificationForUser(assignedToId, {
        type: 'task_assigned',
        title: `Tasca de ${req.user.name || 'un company'}`,
        message: `${task.title}${task.project ? ` — ${task.project.name}` : ''}`,
        entityType: 'task',
        entityId: task.id,
        priority: 'normal',
      });
    }

    res.json(task);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/operations/tasks/:id
router.delete('/tasks/:id', async (req, res, next) => {
  try {
    await prisma.projectTask.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ===========================================
// INCIDÈNCIES
// ===========================================

// GET /api/operations/incidents — Llistar incidències
router.get('/incidents', async (req, res, next) => {
  try {
    const { status, severity, projectId, equipmentId, assignedToId, page = 1, limit = 50 } = req.query;
    const where = {};
    if (status) {
      const statuses = status.split(',');
      where.status = statuses.length > 1 ? { in: statuses } : statuses[0];
    }
    if (severity) where.severity = severity;
    if (projectId) where.projectId = projectId;
    if (equipmentId) where.equipmentId = equipmentId;
    if (assignedToId) where.assignedToId = assignedToId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [incidents, total] = await Promise.all([
      prisma.incident.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: parseInt(limit),
        include: {
          project: { select: { id: true, name: true, status: true } },
          equipment: { select: { id: true, name: true, serialNumber: true } },
        },
      }),
      prisma.incident.count({ where }),
    ]);

    res.json({ incidents, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
});

// GET /api/operations/incidents/:id — Detall incidència
router.get('/incidents/:id', async (req, res, next) => {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: req.params.id },
      include: {
        project: { select: { id: true, name: true, status: true, departureDate: true } },
        equipment: { select: { id: true, name: true, serialNumber: true, category: true, status: true } },
      },
    });
    if (!incident) return res.status(404).json({ error: 'Incidència no trobada' });
    res.json(incident);
  } catch (err) {
    next(err);
  }
});

// POST /api/operations/incidents — Crear incidència
router.post('/incidents', async (req, res, next) => {
  try {
    const {
      projectId, equipmentId, title, description,
      severity = 'MEDIUM', assignedToId, assignedRoleCode,
      affectsFutureDeparture = false, affectedProjectId,
      requiresClientNotification = false, equipmentBlocked = false,
      actionTaken,
    } = req.body;

    const incident = await prisma.incident.create({
      data: {
        projectId: projectId || null,
        equipmentId: equipmentId || null,
        title,
        description,
        severity,
        assignedToId,
        assignedRoleCode,
        reportedById: req.user.id,
        affectsFutureDeparture,
        affectedProjectId,
        requiresClientNotification,
        equipmentBlocked,
        actionTaken,
      },
      include: {
        project: { select: { id: true, name: true } },
        equipment: { select: { id: true, name: true } },
      },
    });

    // Bloquejar equip si cal
    if (equipmentBlocked && equipmentId) {
      await prisma.equipment.update({
        where: { id: equipmentId },
        data: { status: 'BLOCKED' },
      });
    }

    // Notificacions segons severitat
    if (severity === 'CRITICAL') {
      // Notificar a tots els responsables
      for (const role of ['WAREHOUSE_LEAD', 'TECH_LEAD', 'ADMIN_COORDINATION']) {
        await createNotificationForRole(role, {
          type: 'incident_critical',
          title: `Incidència CRÍTICA: ${title}`,
          message: description.substring(0, 200),
          entityType: 'incident',
          entityId: incident.id,
          priority: 'urgent',
        });
      }
    } else if (assignedToId) {
      await createNotificationForUser(assignedToId, {
          type: 'incident_assigned',
          title: `Nova incidència assignada: ${title}`,
          message: description.substring(0, 200),
          entityType: 'incident',
          entityId: incident.id,
          priority: severity === 'HIGH' ? 'high' : 'normal',
      });
    }

    // Notificar admin si cal avisar client
    if (requiresClientNotification) {
      await createNotificationForRole('ADMIN_COORDINATION', {
        type: 'incident_client_notification',
        title: 'Cal avisar el client',
        message: `Incidència: ${title}`,
        entityType: 'incident',
        entityId: incident.id,
        priority: 'high',
      });
    }

    res.status(201).json(incident);
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/incidents/:id — Actualitzar incidència
router.put('/incidents/:id', async (req, res, next) => {
  try {
    const data = { ...req.body };
    delete data.id;
    delete data.createdAt;
    delete data.project;
    delete data.equipment;

    // Si es resol
    if (data.status === 'INC_RESOLVED' && !data.resolvedAt) {
      data.resolvedAt = new Date();
      data.resolvedById = req.user.id;
    }

    // Si es desbloqueja l'equip
    const current = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (current?.equipmentBlocked && data.equipmentBlocked === false && current.equipmentId) {
      await prisma.equipment.update({
        where: { id: current.equipmentId },
        data: { status: 'ACTIVE' },
      });
    }
    // Si es bloqueja ara
    if (!current?.equipmentBlocked && data.equipmentBlocked === true && (data.equipmentId || current?.equipmentId)) {
      await prisma.equipment.update({
        where: { id: data.equipmentId || current.equipmentId },
        data: { status: 'BLOCKED' },
      });
    }

    const incident = await prisma.incident.update({
      where: { id: req.params.id },
      data,
    });
    res.json(incident);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// COMUNICACIONS DE PROJECTE
// ===========================================

// POST /api/operations/projects/:id/communications — Nova comunicació
router.post('/projects/:id/communications', async (req, res, next) => {
  try {
    const { message, targetRoleCode, isUrgent = false } = req.body;
    const comm = await prisma.projectCommunication.create({
      data: {
        projectId: req.params.id,
        authorId: req.user.id,
        targetRoleCode,
        message,
        isUrgent,
      },
    });

    // Si és urgent, notificar el rol destinatari
    if (isUrgent && targetRoleCode) {
      const project = await prisma.rentalProject.findUnique({
        where: { id: req.params.id },
        select: { name: true },
      });
      await createNotificationForRole(targetRoleCode, {
        type: 'urgent_communication',
        title: `Missatge URGENT — ${project?.name || 'Projecte'}`,
        message: message.substring(0, 200),
        entityType: 'rental_project',
        entityId: req.params.id,
        priority: 'urgent',
      });
    }

    res.json(comm);
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/communications/:id/read — Marcar com llegida
router.put('/communications/:id/read', async (req, res, next) => {
  try {
    await prisma.projectCommunication.update({
      where: { id: req.params.id },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ===========================================
// PLA DEL DIA
// ===========================================

// GET /api/operations/daily/:date — Pla del dia (o crea buit si no existeix)
router.get('/daily/:date', async (req, res, next) => {
  try {
    const date = new Date(req.params.date);
    date.setHours(0, 0, 0, 0);
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    const dayAfter = new Date(date);
    dayAfter.setDate(dayAfter.getDate() + 2);

    // Pla del dia
    let plan = await prisma.dailyPlan.findUnique({ where: { date } });

    // Checks/preparació d'avui
    const checksToday = await prisma.rentalProject.findMany({
      where: {
        checkDate: { gte: date, lt: nextDay },
      },
      orderBy: [{ priority: 'desc' }, { checkTime: 'asc' }],
      include: {
        leadUser: { select: { id: true, name: true } },
        assignments: { include: { user: { select: { id: true, name: true } } } },
        _count: { select: { incidents: true, tasks: true } },
      },
    });

    // Sortides d'avui (inici rodatge)
    const departuresToday = await prisma.rentalProject.findMany({
      where: {
        departureDate: { gte: date, lt: nextDay },
      },
      orderBy: [{ priority: 'desc' }, { departureTime: 'asc' }],
      include: {
        leadUser: { select: { id: true, name: true } },
        assignments: { include: { user: { select: { id: true, name: true } } } },
        _count: { select: { incidents: true, tasks: true } },
      },
    });

    // Sortides de demà
    const departuresTomorrow = await prisma.rentalProject.findMany({
      where: {
        departureDate: { gte: nextDay, lt: dayAfter },
      },
      orderBy: [{ priority: 'desc' }, { departureTime: 'asc' }],
      include: {
        leadUser: { select: { id: true, name: true } },
        assignments: { include: { user: { select: { id: true, name: true } } } },
        _count: { select: { incidents: true, tasks: true } },
      },
    });

    // Devolucions previstes avui
    const returnsToday = await prisma.rentalProject.findMany({
      where: {
        returnDate: { gte: date, lt: nextDay },
        status: { in: ['OUT', 'RETURNED', 'RETURN_REVIEW'] },
      },
      orderBy: { returnTime: 'asc' },
      include: {
        leadUser: { select: { id: true, name: true } },
      },
    });

    // Incidències obertes
    const openIncidents = await prisma.incident.findMany({
      where: {
        status: { in: ['INC_OPEN', 'INC_IN_PROGRESS', 'INC_WAITING_PARTS'] },
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      include: {
        project: { select: { id: true, name: true } },
        equipment: { select: { id: true, name: true } },
      },
    });

    // Personal amb rols actius
    const staff = await prisma.roleAssignment.findMany({
      where: {
        OR: [
          { endDate: null },
          { endDate: { gte: new Date() } },
        ],
      },
      include: {
        user: { select: { id: true, name: true } },
        role: { select: { code: true, name: true, shortName: true, color: true } },
      },
      orderBy: { role: { sortOrder: 'asc' } },
    });

    // Tasques pendents assignades a l'usuari actual
    const myTasks = await prisma.projectTask.findMany({
      where: {
        assignedToId: req.user.id,
        status: { in: ['OP_PENDING', 'OP_IN_PROGRESS'] },
      },
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    });

    res.json({
      plan,
      checksToday,
      departuresToday,
      departuresTomorrow,
      returnsToday,
      openIncidents,
      staff,
      myTasks,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/daily/:date — Actualitzar pla del dia
router.put('/daily/:date', async (req, res, next) => {
  try {
    const date = new Date(req.params.date);
    date.setHours(0, 0, 0, 0);
    const { summary, availableStaff, urgentNotes } = req.body;

    const plan = await prisma.dailyPlan.upsert({
      where: { date },
      create: {
        date,
        summary,
        availableStaff,
        urgentNotes,
        createdById: req.user.id,
      },
      update: {
        summary,
        availableStaff,
        urgentNotes,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
    });
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// CALENDARI MENSUAL
// ===========================================

// GET /api/operations/calendar/:year/:month — Dades del calendari mensual
router.get('/calendar/:year/:month', async (req, res, next) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month) - 1; // JS months are 0-based
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 1);

    // Projectes que se solapen amb el mes (check, rodatge o retorn dins del mes)
    const projects = await prisma.rentalProject.findMany({
      where: {
        OR: [
          { checkDate: { gte: startDate, lt: endDate } },
          { departureDate: { gte: startDate, lt: endDate } },
          { shootEndDate: { gte: startDate, lt: endDate } },
          { returnDate: { gte: startDate, lt: endDate } },
          // Projectes que cobreixen tot el mes
          { departureDate: { lt: startDate }, returnDate: { gte: endDate } },
        ],
        status: { not: 'CLOSED' },
      },
      select: {
        id: true,
        name: true,
        checkDate: true,
        checkTime: true,
        departureDate: true,
        departureTime: true,
        shootEndDate: true,
        shootEndTime: true,
        returnDate: true,
        returnTime: true,
        status: true,
        priority: true,
        clientName: true,
        rentmanProjectId: true,
        leadUser: { select: { id: true, name: true } },
      },
      orderBy: [{ priority: 'desc' }, { departureDate: 'asc' }],
    });

    // Tasques amb dueAt dins del mes
    const tasks = await prisma.projectTask.findMany({
      where: {
        dueAt: { gte: startDate, lt: endDate },
      },
      include: {
        project: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { dueAt: 'asc' },
    });

    res.json({ projects, tasks, year, month: month + 1 });
  } catch (err) {
    next(err);
  }
});

// ===========================================
// TASQUES GENERALS
// ===========================================

// GET /api/operations/tasks — Llistat de tasques amb vistes
// Vistes: today, pending, blocked, done, all
router.get('/tasks', async (req, res, next) => {
  try {
    const { view = 'pending', category, assignedToId, projectId, page = 1, limit = 200 } = req.query;
    const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'EDITOR';

    const where = {};

    // Vista
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    switch (view) {
      case 'today':
        where.OR = [
          { dueAt: { gte: todayStart, lte: todayEnd } },
          { dueAt: null, status: { in: ['OP_PENDING', 'OP_IN_PROGRESS'] } },
        ];
        where.status = { not: 'OP_CANCELLED' };
        break;
      case 'pending':
        where.status = { in: ['OP_PENDING', 'OP_IN_PROGRESS'] };
        break;
      case 'blocked':
        where.status = 'OP_BLOCKED';
        break;
      case 'done':
        where.status = 'OP_DONE';
        break;
      default: // 'all'
        where.status = { not: 'OP_CANCELLED' };
        break;
    }

    // Filtre per categoria
    if (category) where.category = category;

    // Filtre per projecte
    if (projectId) where.projectId = projectId;

    // Filtre per assignat / visibilitat
    if (assignedToId) {
      where.assignedToId = assignedToId;
    } else if (!isAdmin) {
      // Combinar amb filtre de vista (pot tenir OR)
      const userFilter = [
        { assignedToId: req.user.id },
        { createdById: req.user.id },
        { assignedToId: null }, // tasques sense assignar les veu tothom
      ];
      if (where.OR) {
        // La vista ja té OR → AND amb el filtre d'usuari
        where.AND = [{ OR: where.OR }, { OR: userFilter }];
        delete where.OR;
      } else {
        where.OR = userFilter;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [tasks, total] = await Promise.all([
      prisma.projectTask.findMany({
        where,
        include: {
          project: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
          completedBy: { select: { id: true, name: true } },
        },
        orderBy: [
          { dueAt: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip,
        take: parseInt(limit),
      }),
      prisma.projectTask.count({ where }),
    ]);

    // Comptadors per les vistes (sempre retornar-los per al badge)
    const [pendingCount, blockedCount, todayCount] = await Promise.all([
      prisma.projectTask.count({
        where: {
          status: { in: ['OP_PENDING', 'OP_IN_PROGRESS'] },
          ...(isAdmin ? {} : { OR: [{ assignedToId: req.user.id }, { createdById: req.user.id }, { assignedToId: null }] }),
        },
      }),
      prisma.projectTask.count({
        where: {
          status: 'OP_BLOCKED',
          ...(isAdmin ? {} : { OR: [{ assignedToId: req.user.id }, { createdById: req.user.id }, { assignedToId: null }] }),
        },
      }),
      prisma.projectTask.count({
        where: {
          status: { not: 'OP_CANCELLED' },
          OR: [
            { dueAt: { gte: todayStart, lte: todayEnd } },
            { dueAt: null, status: { in: ['OP_PENDING', 'OP_IN_PROGRESS'] } },
          ],
          ...(isAdmin ? {} : { AND: [{ OR: [{ assignedToId: req.user.id }, { createdById: req.user.id }, { assignedToId: null }] }] }),
        },
      }),
    ]);

    res.json({ tasks, total, isAdmin, counts: { pending: pendingCount, blocked: blockedCount, today: todayCount } });
  } catch (err) {
    next(err);
  }
});

// POST /api/operations/tasks — Crear tasca independent (no lligada a projecte obligatòriament)
router.post('/tasks', async (req, res, next) => {
  try {
    const {
      title, description, notes,
      assignedToId, projectId,
      category = 'GENERAL',
      dueAt, dueTime,
      reminder = 'NONE', reminderCustom,
      recurrence = 'NONE', recurrenceCustom, recurrenceEndAt,
    } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: 'El títol és obligatori' });

    const task = await prisma.projectTask.create({
      data: {
        title: title.trim(),
        description: description || null,
        notes: notes || null,
        createdById: req.user.id,
        assignedToId: assignedToId || null,
        projectId: projectId || null,
        category,
        dueAt: dueAt ? new Date(dueAt) : null,
        dueTime: dueTime || null,
        reminder,
        reminderCustom: reminderCustom || null,
        recurrence,
        recurrenceCustom: recurrenceCustom || null,
        recurrenceEndAt: recurrenceEndAt ? new Date(recurrenceEndAt) : null,
      },
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });

    // Notificar + push si s'assigna a algú
    if (assignedToId && assignedToId !== req.user.id) {
      logger.info(`Nova tasca ${task.id} assignada a ${assignedToId} per ${req.user.id}`);
      await createNotificationForUser(assignedToId, {
        type: 'task_assigned',
        title: `Tasca de ${req.user.name || 'un company'}`,
        message: `${title.trim()}${task.project ? ` — ${task.project.name}` : ''}`,
        entityType: 'task',
        entityId: task.id,
        priority: 'normal',
      });
    }

    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// PROTOCOLS
// ===========================================

// GET /api/operations/protocols — Llistar protocols
router.get('/protocols', async (req, res, next) => {
  try {
    const { category } = req.query;
    const where = { isActive: true };
    if (category) where.category = category;

    const protocols = await prisma.protocol.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
    res.json(protocols);
  } catch (err) {
    next(err);
  }
});

// GET /api/operations/protocols/:slug — Detall protocol
router.get('/protocols/:slug', async (req, res, next) => {
  try {
    const protocol = await prisma.protocol.findUnique({
      where: { slug: req.params.slug },
    });
    if (!protocol) return res.status(404).json({ error: 'Protocol no trobat' });
    res.json(protocol);
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/protocols/:id — Editar protocol
router.put('/protocols/:id', async (req, res, next) => {
  try {
    const { title, content, category, sortOrder } = req.body;
    const protocol = await prisma.protocol.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(content && { content }),
        ...(category && { category }),
        ...(sortOrder !== undefined && { sortOrder }),
        lastEditedById: req.user.id,
      },
    });
    res.json(protocol);
  } catch (err) {
    next(err);
  }
});

// POST /api/operations/protocols — Crear protocol
router.post('/protocols', async (req, res, next) => {
  try {
    const { title, slug, category, content, sortOrder = 0 } = req.body;
    const protocol = await prisma.protocol.create({
      data: { title, slug, category, content, sortOrder, lastEditedById: req.user.id },
    });
    res.json(protocol);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// NOTIFICACIONS
// ===========================================

// GET /api/operations/notifications — Les meves notificacions
router.get('/notifications', async (req, res, next) => {
  try {
    const { unreadOnly } = req.query;
    const where = { userId: req.user.id };
    if (unreadOnly === 'true') where.isRead = false;

    const notifications = await prisma.opNotification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const unreadCount = await prisma.opNotification.count({
      where: { userId: req.user.id, isRead: false },
    });

    res.json({ notifications, unreadCount });
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/notifications/read-all — Marcar totes com llegides
router.put('/notifications/read-all', async (req, res, next) => {
  try {
    await prisma.opNotification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/operations/notifications/:id/read — Marcar una com llegida
router.put('/notifications/:id/read', async (req, res, next) => {
  try {
    await prisma.opNotification.update({
      where: { id: req.params.id },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ===========================================
// RESUM / ESTADÍSTIQUES
// ===========================================

// GET /api/operations/stats — Resum general per dashboard
router.get('/stats', async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      projectsByStatus,
      departuresToday,
      departuresTomorrow,
      openIncidents,
      criticalIncidents,
      unreadNotifications,
    ] = await Promise.all([
      prisma.rentalProject.groupBy({
        by: ['status'],
        _count: { id: true },
        where: { status: { notIn: ['CLOSED'] } },
      }),
      prisma.rentalProject.count({
        where: { departureDate: { gte: today, lt: tomorrow } },
      }),
      prisma.rentalProject.count({
        where: {
          departureDate: { gte: tomorrow, lt: new Date(tomorrow.getTime() + 86400000) },
        },
      }),
      prisma.incident.count({
        where: { status: { in: ['INC_OPEN', 'INC_IN_PROGRESS'] } },
      }),
      prisma.incident.count({
        where: { severity: 'CRITICAL', status: { in: ['INC_OPEN', 'INC_IN_PROGRESS'] } },
      }),
      prisma.opNotification.count({
        where: { userId: req.user.id, isRead: false },
      }),
    ]);

    res.json({
      projectsByStatus,
      departuresToday,
      departuresTomorrow,
      openIncidents,
      criticalIncidents,
      unreadNotifications,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/operations/dashboard — Dashboard operatiu complet
router.get('/dashboard', async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const [
      activeProjects,
      readyProjects,
      pendingTasks,
      todayTasks,
      openIncidentsCount,
      criticalIncidents,
      upcomingDepartures,
      tasksToday,
      returnsToday,
      openIncidents,
      staff,
      todayAbsences,
    ] = await Promise.all([
      // Projectes actius (no tancats)
      prisma.rentalProject.count({
        where: { status: { notIn: ['CLOSED'] } },
      }),
      // Projectes preparats
      prisma.rentalProject.count({
        where: { status: 'READY' },
      }),
      // Tasques pendents totals
      prisma.projectTask.count({
        where: { status: { in: ['OP_PENDING', 'OP_IN_PROGRESS'] } },
      }),
      // Tasques per avui
      prisma.projectTask.count({
        where: {
          status: { in: ['OP_PENDING', 'OP_IN_PROGRESS'] },
          dueAt: { gte: today, lt: tomorrow },
        },
      }),
      // Incidències obertes (count)
      prisma.incident.count({
        where: { status: { in: ['INC_OPEN', 'INC_IN_PROGRESS'] } },
      }),
      // Incidències crítiques
      prisma.incident.count({
        where: { severity: 'CRITICAL', status: { in: ['INC_OPEN', 'INC_IN_PROGRESS'] } },
      }),
      // Pròximes sortides (7 dies)
      prisma.rentalProject.findMany({
        where: {
          departureDate: { gte: today, lte: weekEnd },
          status: { notIn: ['CLOSED'] },
        },
        select: {
          id: true, name: true, clientName: true, status: true,
          departureDate: true, departureTime: true,
          checkDate: true, returnDate: true,
          leadUser: { select: { id: true, name: true, color: true } },
          client: { select: { id: true, name: true } },
        },
        orderBy: { departureDate: 'asc' },
        take: 8,
      }),
      // Tasques del dia
      prisma.projectTask.findMany({
        where: {
          status: { in: ['OP_PENDING', 'OP_IN_PROGRESS', 'OP_DONE'] },
          OR: [
            { dueAt: { gte: today, lt: tomorrow } },
            { status: 'OP_DONE', completedAt: { gte: today } },
          ],
        },
        select: {
          id: true, title: true, status: true, category: true,
          dueAt: true, completedAt: true,
          assignedTo: { select: { id: true, name: true, color: true } },
          project: { select: { id: true, name: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 15,
      }),
      // Devolucions previstes avui/demà
      prisma.rentalProject.findMany({
        where: {
          returnDate: { gte: today, lt: new Date(today.getTime() + 2 * 24 * 3600 * 1000) },
          status: { in: ['OUT', 'RETURNED', 'RETURN_REVIEW'] },
        },
        select: {
          id: true, name: true, clientName: true, status: true,
          returnDate: true, returnTime: true,
          leadUser: { select: { id: true, name: true } },
          client: { select: { id: true, name: true } },
        },
        orderBy: { returnDate: 'asc' },
        take: 8,
      }),
      // Incidències obertes (detall)
      prisma.incident.findMany({
        where: {
          status: { in: ['INC_OPEN', 'INC_IN_PROGRESS', 'INC_WAITING_PARTS'] },
        },
        select: {
          id: true, title: true, severity: true, status: true,
          project: { select: { id: true, name: true } },
          equipment: { select: { id: true, name: true } },
          createdAt: true,
        },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: 10,
      }),
      // Personal amb rols actius (disponibilitat)
      prisma.roleAssignment.findMany({
        where: {
          OR: [
            { endDate: null },
            { endDate: { gte: new Date() } },
          ],
        },
        include: {
          user: { select: { id: true, name: true, color: true, isActive: true } },
          role: { select: { code: true, name: true, shortName: true, color: true } },
        },
        orderBy: { role: { sortOrder: 'asc' } },
      }),
      // Absències aprovades per avui (safe: taula pot no existir encara)
      prisma.staffAbsence.findMany({
        where: {
          status: 'APROVADA',
          startDate: { lte: today },
          endDate: { gte: today },
        },
        include: {
          user: { select: { id: true, name: true } },
        },
      }).catch(() => []),
    ]);

    // Filtrar personal: actiu i no absent avui
    const absentUserIds = new Set(todayAbsences.map(a => a.userId));
    const availableStaffList = staff
      .filter((s) => s.user.isActive !== false)
      .map((s) => ({
        ...s,
        absent: absentUserIds.has(s.user.id),
      }));

    res.json({
      stats: {
        activeProjects,
        readyProjects,
        pendingTasks,
        todayTasks,
        openIncidents: openIncidentsCount,
        criticalIncidents,
        returnsToday: returnsToday.length,
      },
      upcomingDepartures,
      tasksToday,
      returnsToday,
      openIncidents,
      staff: availableStaffList,
      todayAbsences: todayAbsences.map(a => ({
        id: a.id,
        userId: a.userId,
        userName: a.user.name,
        type: a.type,
        startDate: a.startDate,
        endDate: a.endDate,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ===========================================
// HELPERS
// ===========================================

/**
 * Crea notificació per un usuari + push
 */
async function createNotificationForUser(userId, notifData) {
  try {
    await prisma.opNotification.create({ data: { userId, ...notifData } });
    try {
      const pushService = require('../services/pushService');
      pushService.sendToUser(userId, {
        title: notifData.title || 'SeitoCamera',
        body: notifData.message || '',
        url: '/',
        tag: notifData.type || 'notification',
      }).catch(() => {});
    } catch { /* */ }
  } catch (err) {
    logger.error(`Error creant notificació per user ${userId}: ${err.message}`);
  }
}

/**
 * Crea notificació per a tots els usuaris assignats a un rol operatiu
 * + envia push notification als dispositius subscrits
 */
async function createNotificationForRole(roleCode, notifData) {
  try {
    const assignments = await prisma.roleAssignment.findMany({
      where: {
        role: { code: roleCode },
        OR: [
          { endDate: null },
          { endDate: { gte: new Date() } },
        ],
      },
      select: { userId: true },
    });

    if (assignments.length > 0) {
      await prisma.opNotification.createMany({
        data: assignments.map(a => ({
          userId: a.userId,
          ...notifData,
        })),
      });

      // Enviar push als dispositius subscrits
      try {
        const pushService = require('../services/pushService');
        const userIds = assignments.map(a => a.userId);
        pushService.sendToUsers(userIds, {
          title: notifData.title || 'SeitoCamera',
          body: notifData.message || '',
          url: notifData.entityType ? `/${notifData.entityType}s` : '/',
          tag: notifData.type || 'notification',
        }).catch(() => {}); // Fire & forget
      } catch { /* push no disponible */ }
    }
  } catch (err) {
    logger.error(`Error creant notificació per rol ${roleCode}: ${err.message}`);
  }
}

// ===========================================
// ABSÈNCIES DE PERSONAL
// ===========================================

const ABSENCE_TYPE_LABELS = {
  VACANCES: 'Vacances',
  MALALTIA: 'Malaltia',
  RODATGE: 'Rodatge',
  PERMIS: 'Permís',
  FORMACIO: 'Formació',
  ALTRE: 'Altre',
};

/**
 * GET /operations/absences — Llista absències
 * Query: ?from=&to=&userId=&status=
 * Qualsevol usuari pot veure totes les absències (calendari)
 */
router.get('/absences', async (req, res, next) => {
  try {
    const { from, to, userId, status } = req.query;
    const where = {};

    if (from || to) {
      where.startDate = {};
      if (to) where.startDate.lte = new Date(to);
      where.endDate = {};
      if (from) where.endDate.gte = new Date(from);
    }
    if (userId) where.userId = userId;
    if (status) where.status = status;

    const absences = await prisma.staffAbsence.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, color: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { startDate: 'asc' },
    });

    res.json(absences);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /operations/absences/today — Personal absent avui (per dashboard)
 */
router.get('/absences/today', async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const absences = await prisma.staffAbsence.findMany({
      where: {
        status: 'APROVADA',
        startDate: { lte: today },
        endDate: { gte: today },
      },
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    // Retorna set de userIds absents
    const absentUserIds = [...new Set(absences.map(a => a.userId))];
    res.json({ absentUserIds, absences });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /operations/absences — Crear absència
 * Treballador: crea amb status PENDENT
 * Admin: pot crear directament amb status APROVADA
 */
router.post('/absences', async (req, res, next) => {
  try {
    const { startDate, endDate, type, notes, userId: targetUserId } = req.body;
    const isAdmin = req.user.role === 'ADMIN';

    if (!startDate || !endDate || !type) {
      return res.status(400).json({ error: 'startDate, endDate i type són obligatoris' });
    }

    if (!ABSENCE_TYPE_LABELS[type]) {
      return res.status(400).json({ error: `Tipus invàlid: ${type}` });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) {
      return res.status(400).json({ error: 'endDate no pot ser anterior a startDate' });
    }

    // Admin pot crear per qualsevol usuari; treballadors només per ells mateixos
    const userId = isAdmin && targetUserId ? targetUserId : req.user.id;

    const absence = await prisma.staffAbsence.create({
      data: {
        userId,
        startDate: start,
        endDate: end,
        type,
        notes: notes || null,
        status: isAdmin ? 'APROVADA' : 'PENDENT',
        approvedById: isAdmin ? req.user.id : null,
      },
      include: {
        user: { select: { id: true, name: true, color: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });

    logger.info(`Absència creada: ${absence.user.name} ${type} ${startDate}→${endDate} [${absence.status}]`);
    res.status(201).json(absence);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /operations/absences/:id — Editar absència
 * Treballador: pot editar les seves PENDENT
 * Admin: pot editar qualsevol
 */
router.put('/absences/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { startDate, endDate, type, notes } = req.body;
    const isAdmin = req.user.role === 'ADMIN';

    const existing = await prisma.staffAbsence.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Absència no trobada' });

    // Permisos: treballadors només les seves i en estat PENDENT
    if (!isAdmin && (existing.userId !== req.user.id || existing.status !== 'PENDENT')) {
      return res.status(403).json({ error: 'No tens permís per editar aquesta absència' });
    }

    const data = {};
    if (startDate) data.startDate = new Date(startDate);
    if (endDate) data.endDate = new Date(endDate);
    if (type) data.type = type;
    if (notes !== undefined) data.notes = notes || null;

    const absence = await prisma.staffAbsence.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, name: true, color: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });

    res.json(absence);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /operations/absences/:id/approve — Aprovar absència (admin)
 */
router.put('/absences/:id/approve', async (req, res, next) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Només administradors poden aprovar absències' });
    }

    const absence = await prisma.staffAbsence.update({
      where: { id: req.params.id },
      data: {
        status: 'APROVADA',
        approvedById: req.user.id,
      },
      include: {
        user: { select: { id: true, name: true, color: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });

    logger.info(`Absència aprovada: ${absence.user.name} ${absence.type} ${absence.startDate}→${absence.endDate}`);
    res.json(absence);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /operations/absences/:id/reject — Rebutjar absència (admin)
 */
router.put('/absences/:id/reject', async (req, res, next) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Només administradors poden rebutjar absències' });
    }

    const absence = await prisma.staffAbsence.update({
      where: { id: req.params.id },
      data: {
        status: 'REBUTJADA',
        approvedById: req.user.id,
        rejectReason: req.body.reason || null,
      },
      include: {
        user: { select: { id: true, name: true, color: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });

    logger.info(`Absència rebutjada: ${absence.user.name} ${absence.type}`);
    res.json(absence);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /operations/absences/:id — Eliminar absència
 * Treballador: pot eliminar les seves PENDENT
 * Admin: pot eliminar qualsevol
 */
router.delete('/absences/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const isAdmin = req.user.role === 'ADMIN';

    const existing = await prisma.staffAbsence.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Absència no trobada' });

    if (!isAdmin && (existing.userId !== req.user.id || existing.status !== 'PENDENT')) {
      return res.status(403).json({ error: 'No tens permís per eliminar aquesta absència' });
    }

    await prisma.staffAbsence.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;