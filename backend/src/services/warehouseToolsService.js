/**
 * warehouseToolsService — Tools del Magatzem IA.
 *
 * Mix de read i mutating. Les mutating (create_prep_task, mark_returned,
 * notify_*) executen acció a la base de dades + envien notificacions.
 *
 * NOTA: tots els retorns d'errors són { error: string } (no llançar) perquè
 * el agent loop els pugui veure i decidir què fer.
 */
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');
const { notifyUser, notifyRole } = require('./notificationService');
const transversal = require('./transversalContextService');

const TOOLS = [
  // ===========================================
  // Read
  // ===========================================
  {
    name: 'get_today_status',
    description: 'Estat operatiu AVUI del magatzem: prep, devolucions, conflictes, items pendents, equips trencats. Comença sempre per aquí per situar-te.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_project_kit',
    description: 'Llista d\'equipament assignat a un projecte concret (ProjectEquipment) amb estat checked_out / returned / condition.',
    input_schema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'find_equipment_conflicts',
    description: 'Detecta conflictes: mateix Equipment reservat a 2+ projectes amb dates solapades. Retorna llista detallada.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_pending_tasks',
    description: 'Tasques pendents (no completades ni cancel·lades). Filtra opcionalment per data, categoria, usuari, projecte.',
    input_schema: {
      type: 'object',
      properties: {
        date:          { type: 'string', description: 'YYYY-MM-DD (data programada)' },
        category:      { type: 'string', enum: ['WAREHOUSE', 'TECH', 'ADMIN', 'TRANSPORT', 'GENERAL'] },
        assignedToUserId: { type: 'string' },
        rentalProjectId:  { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'list_users',
    description: 'Llista d\'usuaris actius (id, nom, role) per saber a qui assignar tasques o notificar.',
    input_schema: {
      type: 'object',
      properties: { role: { type: 'string', description: 'Opcional: filtra per role (ADMIN, EDITOR, WAREHOUSE, etc.)' } },
      required: [],
    },
  },
  {
    name: 'list_recent_projects',
    description: 'Llista projectes recents/actius amb dates clau (per identificar quin projecte cal preparar).',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', default: 15 } },
      required: [],
    },
  },

  // ===========================================
  // Mutating
  // ===========================================
  {
    name: 'create_task',
    description: 'Crea una tasca operativa. Si rentalProjectId i assignedToUserId estan presents, l\'usuari rep notificació automàtica.',
    input_schema: {
      type: 'object',
      properties: {
        title:           { type: 'string' },
        description:     { type: 'string' },
        category:        { type: 'string', enum: ['WAREHOUSE', 'TECH', 'ADMIN', 'TRANSPORT', 'GENERAL'], default: 'WAREHOUSE' },
        priority:        { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL' },
        scheduledDate:   { type: 'string', description: 'YYYY-MM-DD' },
        scheduledTime:   { type: 'string', description: 'HH:MM' },
        assignedToUserId: { type: 'string' },
        rentalProjectId:  { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'mark_equipment_returned',
    description: 'Marca un ProjectEquipment com a tornat. Pot indicar la condició (OK/DAMAGED/MISSING/CONSUMABLE_USED).',
    input_schema: {
      type: 'object',
      properties: {
        projectEquipmentId: { type: 'string' },
        condition:          { type: 'string', enum: ['OK', 'DAMAGED', 'MISSING', 'CONSUMABLE_USED'], default: 'OK' },
        notes:              { type: 'string' },
      },
      required: ['projectEquipmentId'],
    },
  },
  {
    name: 'flag_equipment',
    description: 'Marca un Equipment amb un nou estat (BROKEN, LOST, ACTIVE, SOLD). Útil quan un retorn revela un problema. Notifica WAREHOUSE_LEAD.',
    input_schema: {
      type: 'object',
      properties: {
        equipmentId: { type: 'string' },
        status:      { type: 'string', enum: ['ACTIVE', 'BROKEN', 'LOST', 'SOLD'] },
        notes:       { type: 'string' },
      },
      required: ['equipmentId', 'status'],
    },
  },
  {
    name: 'notify_user',
    description: 'Envia una notificació in-app + push a un usuari concret. Usar amb mesura: només quan calgui acció humana.',
    input_schema: {
      type: 'object',
      properties: {
        userId:   { type: 'string' },
        title:    { type: 'string' },
        message:  { type: 'string' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
        entityType: { type: 'string', description: 'Opcional: rental_project, task, equipment, etc.' },
        entityId:   { type: 'string', description: 'Opcional: id de l\'entity referenciada' },
      },
      required: ['userId', 'title', 'message'],
    },
  },
  {
    name: 'notify_role',
    description: 'Envia notificació a TOTS els usuaris assignats a un rol operatiu (WAREHOUSE_LEAD, ADMIN_COORDINATION, etc.). Retorna nombre d\'usuaris notificats.',
    input_schema: {
      type: 'object',
      properties: {
        roleCode: { type: 'string' },
        title:    { type: 'string' },
        message:  { type: 'string' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
        entityType: { type: 'string' },
        entityId:   { type: 'string' },
      },
      required: ['roleCode', 'title', 'message'],
    },
  },
];

const HANDLERS = {
  // ---- Read ----
  get_today_status: async () => transversal.getWarehouseBriefing(),

  get_project_kit: async ({ projectId }) => {
    if (!projectId) return { error: 'projectId requerit' };
    const items = await prisma.projectEquipment.findMany({
      where: { projectId },
      include: { equipment: { select: { id: true, name: true, category: true, status: true } } },
    });
    const project = await prisma.rentalProject.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, departureDate: true, returnDate: true, status: true, leadUserId: true },
    });
    return {
      project,
      items: items.map((i) => ({
        id: i.id, itemName: i.itemName, quantity: i.quantity,
        equipment: i.equipment,
        isCheckedOut: i.isCheckedOut, isReturned: i.isReturned,
        returnCondition: i.returnCondition, notes: i.notes,
      })),
    };
  },

  find_equipment_conflicts: async () => {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        pe1."equipmentId" AS equipment_id,
        e.name           AS equipment_name,
        e.category       AS category,
        ARRAY_AGG(DISTINCT pe1."projectId") AS project_ids
      FROM project_equipment pe1
      JOIN project_equipment pe2 ON pe2."equipmentId" = pe1."equipmentId" AND pe2.id <> pe1.id
      JOIN rental_projects p1 ON p1.id = pe1."projectId"
      JOIN rental_projects p2 ON p2.id = pe2."projectId"
      JOIN equipment e ON e.id = pe1."equipmentId"
      WHERE pe1."equipmentId" IS NOT NULL
        AND p1.status NOT IN ('CLOSED', 'RETURNED')
        AND p2.status NOT IN ('CLOSED', 'RETURNED')
        AND p1."departureDate" <= COALESCE(p2."returnDate", p2."departureDate")
        AND COALESCE(p1."returnDate", p1."departureDate") >= p2."departureDate"
      GROUP BY pe1."equipmentId", e.name, e.category
      LIMIT 30
    `);
    if (!rows.length) return { conflicts: [] };
    const ids = [...new Set(rows.flatMap((r) => r.project_ids))];
    const projs = await prisma.rentalProject.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, departureDate: true, returnDate: true, status: true },
    });
    const byId = Object.fromEntries(projs.map((p) => [p.id, p]));
    return {
      conflicts: rows.map((r) => ({
        equipment_id: r.equipment_id,
        equipment_name: r.equipment_name,
        category: r.category,
        projects: r.project_ids.map((pid) => byId[pid]).filter(Boolean),
      })),
    };
  },

  list_pending_tasks: async ({ date, category, assignedToUserId, rentalProjectId }) => {
    const where = { status: { notIn: ['OP_DONE', 'OP_CANCELLED'] } };
    if (category) where.category = category;
    if (assignedToUserId) where.assignedToId = assignedToUserId;
    if (rentalProjectId) where.projectId = rentalProjectId;
    if (date) {
      const d = new Date(date + 'T00:00:00');
      const next = new Date(d.getTime() + 86400000);
      where.dueAt = { gte: d, lt: next };
    }
    const tasks = await prisma.projectTask.findMany({
      where,
      select: {
        id: true, title: true, category: true, priority: true, status: true,
        dueAt: true, dueTime: true,
        assignedToId: true, projectId: true,
      },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take: 50,
    });
    return { tasks };
  },

  list_users: async ({ role }) => {
    const where = { isActive: true };
    if (role) where.role = role;
    const users = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
    return { users };
  },

  list_recent_projects: async ({ limit = 15 }) => {
    const projects = await prisma.rentalProject.findMany({
      where: { status: { notIn: ['CLOSED'] } },
      select: {
        id: true, name: true, clientName: true, status: true, projectType: true,
        checkDate: true, departureDate: true, returnDate: true, actualReturnDate: true,
        leadUserId: true, techSupportUserId: true, returnLeadUserId: true,
      },
      orderBy: [{ priority: 'desc' }, { departureDate: 'asc' }],
      take: limit,
    });
    return { projects };
  },

  // ---- Mutating ----
  create_task: async ({ title, description, category = 'WAREHOUSE', priority = 'NORMAL',
                       scheduledDate, scheduledTime, assignedToUserId, rentalProjectId }) => {
    if (!title) return { error: 'title requerit' };
    const data = {
      title, description, category, priority,
      dueTime: scheduledTime,
      assignedToId: assignedToUserId,
      projectId: rentalProjectId,
    };
    if (scheduledDate) data.dueAt = new Date(`${scheduledDate}T12:00:00`);
    const task = await prisma.projectTask.create({ data, select: { id: true, title: true, dueAt: true } });

    if (assignedToUserId) {
      await notifyUser(assignedToUserId, {
        type: 'task_assigned_by_warehouse_agent',
        title: `Nova tasca: ${title.slice(0, 80)}`,
        message: description ? description.slice(0, 200) : `Programada per ${scheduledDate || '—'}`,
        priority: priority === 'URGENT' ? 'urgent' : priority === 'HIGH' ? 'high' : 'normal',
        entityType: 'task', entityId: task.id,
      });
    }
    return { task, notified: Boolean(assignedToUserId) };
  },

  mark_equipment_returned: async ({ projectEquipmentId, condition = 'OK', notes }, ctx = {}) => {
    if (!projectEquipmentId) return { error: 'projectEquipmentId requerit' };
    const updated = await prisma.projectEquipment.update({
      where: { id: projectEquipmentId },
      data: { isReturned: true, returnCondition: condition, notes },
      select: {
        id: true, itemName: true, returnCondition: true,
        project: { select: { id: true, name: true } },
        equipment: { select: { id: true, name: true } },
      },
    });

    let incident = null;
    if (condition === 'DAMAGED' || condition === 'MISSING') {
      // 1. Notificar
      await notifyRole('WAREHOUSE_LEAD', {
        type: 'equipment_issue',
        title: `${condition}: ${updated.equipment?.name || updated.itemName}`,
        message: `Projecte "${updated.project?.name}". ${notes || 'Sense notes.'}`,
        priority: 'high',
        entityType: 'rental_project', entityId: updated.project?.id,
      });
      // 2. Crear incidència vinculada (si tenim equipmentId i userId)
      const reportedById = await _resolveReportedById(ctx);
      if (updated.equipment?.id && reportedById) {
        incident = await prisma.incident.create({
          data: {
            equipmentId: updated.equipment.id,
            projectId: updated.project?.id,
            reportedById,
            title: `${condition === 'MISSING' ? 'Falta' : 'Danyat'}: ${updated.equipment.name}`,
            description: `Detectat al retorn del projecte "${updated.project?.name || '?'}". ${notes || 'Sense notes.'}`,
            severity: condition === 'MISSING' ? 'HIGH' : 'MEDIUM',
            assignedRoleCode: 'WAREHOUSE_LEAD',
          },
          select: { id: true, title: true, status: true, severity: true },
        });
      }
    }
    return { updated, incident };
  },

  flag_equipment: async ({ equipmentId, status, notes }, ctx = {}) => {
    if (!equipmentId || !status) return { error: 'equipmentId i status requerits' };
    const updated = await prisma.equipment.update({
      where: { id: equipmentId },
      data: { status, notes },
      select: { id: true, name: true, status: true, category: true },
    });
    let incident = null;
    if (status === 'BROKEN' || status === 'LOST') {
      // 1. Notificar
      await notifyRole('WAREHOUSE_LEAD', {
        type: 'equipment_flagged',
        title: `Equip ${status}: ${updated.name}`,
        message: `Categoria ${updated.category || '?'}. ${notes || ''}`,
        priority: 'high',
        entityType: 'equipment', entityId: updated.id,
      });
      // 2. Crear incidència vinculada si no n'hi ha cap d'oberta per aquest equip
      const reportedById = await _resolveReportedById(ctx);
      if (reportedById) {
        const existing = await prisma.incident.findFirst({
          where: {
            equipmentId,
            status: { in: ['INC_OPEN', 'INC_IN_PROGRESS', 'INC_WAITING_PARTS', 'INC_WAITING_CLIENT'] },
          },
          select: { id: true },
        });
        if (!existing) {
          incident = await prisma.incident.create({
            data: {
              equipmentId,
              reportedById,
              title: `${status}: ${updated.name}`,
              description: notes || `Equip marcat com ${status} pel Magatzem IA.`,
              severity: status === 'LOST' ? 'HIGH' : 'MEDIUM',
              assignedRoleCode: 'WAREHOUSE_LEAD',
            },
            select: { id: true, title: true, status: true, severity: true },
          });
        }
      }
    }
    return { updated, incident };
  },

  notify_user: async ({ userId, title, message, priority = 'normal', entityType, entityId }) => {
    await notifyUser(userId, { type: 'warehouse_agent_alert', title, message, priority, entityType, entityId });
    return { notified: 1 };
  },

  notify_role: async ({ roleCode, title, message, priority = 'normal', entityType, entityId }) => {
    const n = await notifyRole(roleCode, { type: 'warehouse_agent_alert', title, message, priority, entityType, entityId });
    return { notified: n };
  },
};

/**
 * @param {{ userId?: string }} ctx
 * @returns {Promise<string|null>} userId per posar a `reportedById`. Cau a primer ADMIN si no es passa context.
 */
async function _resolveReportedById(ctx = {}) {
  if (ctx.userId) return ctx.userId;
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return admin?.id || null;
}

async function executeTool(name, input, ctx = {}) {
  const handler = HANDLERS[name];
  if (!handler) return { error: `Tool desconegut: ${name}` };
  try {
    return await handler(input || {}, ctx);
  } catch (err) {
    logger.error(`warehouseToolsService.${name} error: ${err.message}`);
    return { error: err.message };
  }
}

module.exports = { TOOLS, HANDLERS, executeTool };
