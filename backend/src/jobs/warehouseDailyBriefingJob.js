/**
 * warehouseDailyBriefingJob — cron diari (8:00) que detecta situacions del
 * magatzem que requereixen acció humana i envia notificacions proactives:
 *
 *  - Projectes amb checkDate=avui i status PENDING_PREP/IN_PREPARATION
 *      → notifica leadUserId (responsable de prep)
 *  - Devolucions endarrerides (returnDate < avui sense actualReturn)
 *      → notifica returnLeadUserId i WAREHOUSE_LEAD
 *  - Conflictes d'equipament detectats
 *      → notifica WAREHOUSE_LEAD una sola vegada per equip
 *  - Items pendents de devolució (project tornat però items no isReturned)
 *      → notifica WAREHOUSE_LEAD una sola vegada per project
 *
 * Cap notificació es duplica el mateix dia gràcies a `alreadyNotified`.
 */
const cron = require('node-cron');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');
const { notifyUser, notifyRole, alreadyNotified } = require('../services/notificationService');

function localToday() {
  const now = new Date();
  const off = now.getTimezoneOffset() * 60000;
  const todayStr = new Date(now.getTime() - off).toISOString().slice(0, 10);
  return new Date(`${todayStr}T12:00:00Z`);
}

async function runWarehouseDailyBriefing() {
  const today = localToday();
  let prepNotified = 0, overdueNotified = 0, conflictsNotified = 0, pendingNotified = 0;

  // ---- 1) Projectes que es preparen avui → notifica lead ----
  const prepToday = await prisma.rentalProject.findMany({
    where: {
      checkDate: today,
      status: { in: ['PENDING_PREP', 'IN_PREPARATION'] },
      leadUserId: { not: null },
    },
    select: { id: true, name: true, leadUserId: true, departureDate: true, departureTime: true },
  });
  for (const p of prepToday) {
    if (await alreadyNotified(p.leadUserId, { type: 'warehouse_prep_today', entityId: p.id, withinHours: 12 })) continue;
    await notifyUser(p.leadUserId, {
      type: 'warehouse_prep_today',
      title: `Avui prepares: ${p.name}`,
      message: `Sortida ${p.departureDate ? new Date(p.departureDate).toLocaleDateString('ca-ES') : '?'}${p.departureTime ? ' · ' + p.departureTime : ''}.`,
      priority: 'high',
      entityType: 'rental_project', entityId: p.id,
    });
    prepNotified++;
  }

  // ---- 2) Devolucions endarrerides ----
  // Excluïm els ja RETURNED/CLOSED (estats finals).
  const overdue = await prisma.rentalProject.findMany({
    where: {
      returnDate: { lt: today },
      actualReturnDate: null,
      status: { notIn: ['CLOSED', 'RETURNED'] },
    },
    select: {
      id: true, name: true, returnDate: true, returnLeadUserId: true,
    },
    take: 30,
  });
  // Notifica al return lead individual
  for (const p of overdue) {
    if (!p.returnLeadUserId) continue;
    if (await alreadyNotified(p.returnLeadUserId, { type: 'warehouse_overdue_return', entityId: p.id, withinHours: 24 })) continue;
    const daysLate = Math.floor((today - new Date(p.returnDate)) / 86400000);
    await notifyUser(p.returnLeadUserId, {
      type: 'warehouse_overdue_return',
      title: `Devolució endarrerida: ${p.name}`,
      message: `Havia de tornar fa ${daysLate} dia${daysLate === 1 ? '' : 's'}.`,
      priority: daysLate >= 3 ? 'urgent' : 'high',
      entityType: 'rental_project', entityId: p.id,
    });
    overdueNotified++;
  }
  // Notifica a WAREHOUSE_LEAD un resum si n'hi ha
  if (overdue.length >= 3) {
    const dedupKey = `summary_${today.toISOString().slice(0, 10)}_overdue`;
    // Truc per evitar duplicar el resum: usem un ID virtual
    const usersInRole = await prisma.roleAssignment.findMany({
      where: { role: { code: 'WAREHOUSE_LEAD' }, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
      select: { userId: true },
    });
    const firstNotified = usersInRole.length > 0
      && await alreadyNotified(usersInRole[0].userId, { type: 'warehouse_overdue_summary', entityId: dedupKey, withinHours: 22 });
    if (!firstNotified) {
      await notifyRole('WAREHOUSE_LEAD', {
        type: 'warehouse_overdue_summary',
        title: `${overdue.length} devolucions endarrerides`,
        message: `Revisa el briefing del magatzem per detalls.`,
        priority: 'high',
        entityType: 'warehouse', entityId: dedupKey,
      });
    }
  }

  // ---- 3) Conflictes d'equipament ----
  const conflicts = await prisma.$queryRawUnsafe(`
    SELECT
      pe1."equipmentId" AS equipment_id,
      e.name           AS equipment_name,
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
    GROUP BY pe1."equipmentId", e.name
    LIMIT 20
  `);
  if (conflicts.length > 0) {
    const usersInRole = await prisma.roleAssignment.findMany({
      where: { role: { code: 'WAREHOUSE_LEAD' }, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
      select: { userId: true },
    });
    const summaryKey = `summary_${today.toISOString().slice(0, 10)}_conflicts`;
    const alreadySent = usersInRole.length > 0
      && await alreadyNotified(usersInRole[0].userId, { type: 'warehouse_equipment_conflict', entityId: summaryKey, withinHours: 22 });
    if (!alreadySent) {
      await notifyRole('WAREHOUSE_LEAD', {
        type: 'warehouse_equipment_conflict',
        title: `⚠️ ${conflicts.length} conflicte${conflicts.length === 1 ? '' : 's'} d'equipament`,
        message: `Equips reservats a 2+ projectes solapats. Primer: ${conflicts[0].equipment_name}.`,
        priority: 'urgent',
        entityType: 'warehouse', entityId: summaryKey,
      });
      conflictsNotified = conflicts.length;
    }
  }

  // ---- 4) Items pendents de devolució de projectes ja tornats ----
  const pendingItems = await prisma.projectEquipment.findMany({
    where: {
      isReturned: false,
      project: {
        OR: [{ actualReturnDate: { not: null } }, { status: 'CLOSED' }],
      },
    },
    select: {
      id: true, itemName: true,
      project: { select: { id: true, name: true } },
      equipment: { select: { name: true } },
    },
    distinct: ['projectId'],
    take: 30,
  });
  if (pendingItems.length > 0) {
    const usersInRole = await prisma.roleAssignment.findMany({
      where: { role: { code: 'WAREHOUSE_LEAD' }, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
      select: { userId: true },
    });
    const summaryKey = `summary_${today.toISOString().slice(0, 10)}_pending_items`;
    const alreadySent = usersInRole.length > 0
      && await alreadyNotified(usersInRole[0].userId, { type: 'warehouse_pending_items', entityId: summaryKey, withinHours: 22 });
    if (!alreadySent) {
      await notifyRole('WAREHOUSE_LEAD', {
        type: 'warehouse_pending_items',
        title: `${pendingItems.length} ítems pendents de devolució`,
        message: `De projectes ja tancats. Revisa el briefing.`,
        priority: 'high',
        entityType: 'warehouse', entityId: summaryKey,
      });
      pendingNotified = pendingItems.length;
    }
  }

  const summary = {
    prep_notified: prepNotified,
    overdue_notified: overdueNotified,
    conflicts_summary_sent: conflictsNotified,
    pending_items_summary_sent: pendingNotified,
  };
  logger.info(`[Warehouse Briefing] ${JSON.stringify(summary)}`);
  return summary;
}

let cronTask = null;

function startWarehouseBriefingJob() {
  if (cronTask) return;
  // 08:00 cada dia (Madrid TZ definida pel sistema)
  const schedule = process.env.WAREHOUSE_BRIEFING_CRON || '0 8 * * *';
  cronTask = cron.schedule(schedule, () => {
    runWarehouseDailyBriefing().catch((err) =>
      logger.error(`[Warehouse Briefing] Error: ${err.message}`)
    );
  });
  logger.info(`Warehouse briefing job programat: ${schedule}`);
}

function stopWarehouseBriefingJob() {
  if (cronTask) { cronTask.stop(); cronTask = null; }
}

module.exports = { startWarehouseBriefingJob, stopWarehouseBriefingJob, runWarehouseDailyBriefing };
