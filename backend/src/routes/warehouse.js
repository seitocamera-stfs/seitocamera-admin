/**
 * Warehouse briefing — vista operativa "què passa al magatzem ara".
 *
 * Pure SQL/JS aggregations, no LLM. Agrupa en una sola resposta:
 *   - prep_today        Projectes en preparació amb checkDate=avui
 *   - shooting_now      Projectes en rodatge actualment (departureDate ≤ avui ≤ shootEndDate)
 *   - returns_today     Projectes que han de tornar avui
 *   - overdue_returns   Projectes que ja haurien d'haver tornat (returnDate < avui sense actualReturn)
 *   - equipment_conflicts  Mateix Equipment a 2+ projectes amb dates solapades
 *   - pending_returns   ProjectEquipment !isReturned de projectes ja tornats
 *   - issues            Equips DAMAGED/MISSING en devolucions recents
 *   - transports_today  Transports amb data avui
 *   - tasks_today       Tasques operacionals d'avui per categoria
 */
const express = require('express');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');

const router = express.Router();
router.use(authenticate);
router.use(requireSection('operations'));

function localDateAnchors() {
  // Anchored at noon UTC to avoid TZ truncation issues with DATE columns.
  const localToday = new Date();
  const off = localToday.getTimezoneOffset() * 60000;
  const localISO = (date) => new Date(date.getTime() - off).toISOString().slice(0, 10);
  const todayStr = localISO(localToday);
  const tomorrowStr = localISO(new Date(localToday.getTime() + 86400000));
  return {
    todayStr,
    today: new Date(`${todayStr}T12:00:00Z`),
    tomorrow: new Date(`${tomorrowStr}T12:00:00Z`),
    todayStartLocal: new Date(`${todayStr}T00:00:00`),  // start of day in local TZ
    todayEndLocal: new Date(`${todayStr}T23:59:59.999`),
  };
}

router.get('/briefing', async (req, res, next) => {
  try {
    const { today, tomorrow, todayStr, todayStartLocal, todayEndLocal } = localDateAnchors();

    const projectFields = {
      id: true, name: true, clientName: true, projectType: true, status: true, priority: true,
      checkDate: true, checkTime: true,
      departureDate: true, departureTime: true,
      shootEndDate: true, shootEndTime: true,
      returnDate: true, returnTime: true,
      actualReturnDate: true,
      leadUserId: true, techSupportUserId: true, returnLeadUserId: true,
      _count: { select: { equipmentItems: true } },
    };

    // ---- 1) Prep avui (checkDate = avui, status preparant) ----
    const prep_today = await prisma.rentalProject.findMany({
      where: {
        checkDate: today,
        status: { in: ['PENDING_PREP', 'IN_PREPARATION', 'READY'] },
      },
      select: projectFields,
      orderBy: [{ priority: 'desc' }, { checkTime: 'asc' }],
    });

    // ---- 2) En rodatge ara mateix (departureDate ≤ avui ≤ shootEndDate) ----
    const shooting_now = await prisma.rentalProject.findMany({
      where: {
        departureDate: { lte: today },
        OR: [{ shootEndDate: { gte: today } }, { shootEndDate: null }],
        status: { in: ['OUT', 'READY'] },
      },
      select: projectFields,
      orderBy: { shootEndDate: 'asc' },
      take: 30,
    });

    // ---- 3) Han de tornar avui ----
    const returns_today = await prisma.rentalProject.findMany({
      where: {
        returnDate: today,
        actualReturnDate: null,
      },
      select: projectFields,
      orderBy: { returnTime: 'asc' },
    });

    // ---- 4) Devolucions endarrerides (returnDate < avui i no encara tornades) ----
    const overdue_returns = await prisma.rentalProject.findMany({
      where: {
        returnDate: { lt: today },
        actualReturnDate: null,
        status: { not: 'CLOSED' },
      },
      select: projectFields,
      orderBy: { returnDate: 'asc' },
      take: 30,
    });

    // ---- 5) Conflictes d'equipament (mateix Equipment a 2+ projectes solapats) ----
    // Detectem amb una query SQL que busca ProjectEquipment del mateix equipmentId
    // a projectes que es solapen entre departureDate i returnDate.
    const conflictsRaw = await prisma.$queryRawUnsafe(`
      SELECT
        pe1."equipmentId" AS equipment_id,
        e.name           AS equipment_name,
        e.category       AS category,
        ARRAY_AGG(DISTINCT pe1."projectId") AS project_ids
      FROM project_equipment pe1
      JOIN project_equipment pe2
        ON pe2."equipmentId" = pe1."equipmentId"
       AND pe2.id <> pe1.id
      JOIN rental_projects p1 ON p1.id = pe1."projectId"
      JOIN rental_projects p2 ON p2.id = pe2."projectId"
      JOIN equipment e ON e.id = pe1."equipmentId"
      WHERE pe1."equipmentId" IS NOT NULL
        AND p1.status NOT IN ('CLOSED', 'RETURNED')
        AND p2.status NOT IN ('CLOSED', 'RETURNED')
        AND p1."departureDate" <= COALESCE(p2."returnDate", p2."departureDate")
        AND COALESCE(p1."returnDate", p1."departureDate") >= p2."departureDate"
      GROUP BY pe1."equipmentId", e.name, e.category
      LIMIT 50
    `);

    // Hidratar amb info dels projectes implicats
    const conflictProjectIds = [...new Set(conflictsRaw.flatMap((c) => c.project_ids))];
    const conflictProjects = conflictProjectIds.length
      ? await prisma.rentalProject.findMany({
          where: { id: { in: conflictProjectIds } },
          select: { id: true, name: true, departureDate: true, returnDate: true, status: true },
        })
      : [];
    const projById = Object.fromEntries(conflictProjects.map((p) => [p.id, p]));
    const equipment_conflicts = conflictsRaw.map((c) => ({
      equipment_id: c.equipment_id,
      equipment_name: c.equipment_name,
      category: c.category,
      projects: c.project_ids.map((pid) => projById[pid]).filter(Boolean),
    }));

    // ---- 6) Devolucions pendents per ítem (projectes "tornats" però amb items pending) ----
    const pending_items = await prisma.projectEquipment.findMany({
      where: {
        isReturned: false,
        project: {
          OR: [
            { actualReturnDate: { not: null } },
            { status: 'CLOSED' },
          ],
        },
      },
      select: {
        id: true, itemName: true, quantity: true,
        project: { select: { id: true, name: true, returnDate: true, actualReturnDate: true } },
        equipment: { select: { name: true, category: true } },
      },
      orderBy: { project: { actualReturnDate: 'desc' } },
      take: 30,
    });

    // ---- 7) Issues recents (DAMAGED / MISSING) en devolucions ----
    const issues = await prisma.projectEquipment.findMany({
      where: {
        returnCondition: { in: ['DAMAGED', 'MISSING'] },
        project: { actualReturnDate: { gte: new Date(Date.now() - 30 * 86400000) } },
      },
      select: {
        id: true, itemName: true, quantity: true, returnCondition: true, notes: true,
        project: { select: { id: true, name: true, actualReturnDate: true } },
        equipment: { select: { name: true, category: true } },
      },
      orderBy: { project: { actualReturnDate: 'desc' } },
      take: 30,
    });

    // ---- 8) Transports avui ----
    const transports_today = await prisma.transport.findMany({
      where: {
        OR: [
          { dataCarrega: today },
          { dataEntrega: today },
        ],
        estat: { notIn: ['Cancellat', 'Completat'] },
      },
      select: {
        id: true, projecte: true, tipusServei: true, origen: true, desti: true,
        dataCarrega: true, dataEntrega: true,
        horaRecollida: true, horaEntregaEstimada: true,
        responsableProduccio: true, conductorId: true, estat: true,
        rentalProjectId: true,
      },
      orderBy: { horaRecollida: 'asc' },
    });

    // ---- 9) Tasques operacionals avui ----
    const tasks_today = await prisma.projectTask.findMany({
      where: {
        dueAt: { gte: todayStartLocal, lte: todayEndLocal },
        status: { notIn: ['OP_DONE', 'OP_CANCELLED'] },
        category: { in: ['WAREHOUSE', 'TECH', 'TRANSPORT', 'GENERAL'] },
      },
      select: {
        id: true, title: true, category: true, priority: true, status: true,
        dueAt: true, dueTime: true,
        assignedToId: true,
        projectId: true,
      },
      orderBy: [{ priority: 'desc' }, { dueTime: 'asc' }],
      take: 50,
    });

    // ---- 10) Stats globals (per donar context) ----
    const [equipmentStats, brokenEquipmentRaw] = await Promise.all([
      prisma.equipment.groupBy({
        by: ['category', 'status'],
        _count: true,
      }),
      prisma.equipment.findMany({
        where: { status: { in: ['BROKEN', 'LOST', 'BLOCKED'] } },
        select: { id: true, name: true, status: true, category: true, notes: true },
        take: 30,
      }),
    ]);

    // Per cada equip BROKEN/LOST/BLOCKED busquem la incidència oberta més recent
    let brokenEquipment = brokenEquipmentRaw;
    if (brokenEquipmentRaw.length > 0) {
      const equipIds = brokenEquipmentRaw.map((e) => e.id);
      const incidents = await prisma.incident.findMany({
        where: {
          equipmentId: { in: equipIds },
          status: { notIn: ['INC_RESOLVED', 'INC_CLOSED'] },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, equipmentId: true, title: true, status: true, severity: true,
          assignedToId: true, createdAt: true,
        },
      });
      const byEquip = {};
      for (const inc of incidents) {
        if (!byEquip[inc.equipmentId]) byEquip[inc.equipmentId] = inc; // primera = més recent
      }
      brokenEquipment = brokenEquipmentRaw.map((e) => ({
        ...e,
        openIncident: byEquip[e.id] || null,
      }));
    }

    res.json({
      generated_at: new Date().toISOString(),
      today: todayStr,
      summary: {
        prep_today: prep_today.length,
        shooting_now: shooting_now.length,
        returns_today: returns_today.length,
        overdue_returns: overdue_returns.length,
        equipment_conflicts: equipment_conflicts.length,
        pending_items: pending_items.length,
        issues: issues.length,
        transports_today: transports_today.length,
        tasks_today: tasks_today.length,
        equipment_broken_or_lost: brokenEquipment.length,
      },
      prep_today,
      shooting_now,
      returns_today,
      overdue_returns,
      equipment_conflicts,
      pending_items,
      issues,
      transports_today,
      tasks_today,
      equipment_stats: equipmentStats,
      broken_equipment: brokenEquipment,
    });
  } catch (err) { next(err); }
});

module.exports = router;
