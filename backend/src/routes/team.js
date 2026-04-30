const express = require('express');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { logger } = require('../config/logger');

const router = express.Router();
router.use(authenticate);

const STANDARD_MINUTES = 480; // 8h jornada estàndard

// ===========================================
// Control Horari — Time Entries
// ===========================================

/**
 * GET /api/team/time-entries
 * Llistat de registres horaris amb filtres
 */
router.get('/time-entries', async (req, res, next) => {
  try {
    const { userId, from, to, type, overtimeOnly, page = 1, limit = 50 } = req.query;
    const isAdmin = req.user.role === 'ADMIN';

    const where = {};

    // Usuaris no-admin només veuen els seus
    if (!isAdmin) {
      where.userId = req.user.id;
    } else if (userId) {
      where.userId = userId;
    }

    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    if (type) where.type = type;
    if (overtimeOnly === 'true') where.overtimeMinutes = { gt: 0 };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [entries, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, color: true } },
          approvedBy: { select: { id: true, name: true } },
        },
        orderBy: [{ date: 'desc' }, { clockIn: 'desc' }],
        skip,
        take: parseInt(limit),
      }),
      prisma.timeEntry.count({ where }),
    ]);

    res.json({ entries, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/team/time-entries/today
 * Estat actual del fitxatge de l'usuari (hi ha entrada oberta?)
 */
router.get('/time-entries/today', async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const entries = await prisma.timeEntry.findMany({
      where: { userId: req.user.id, date: today },
      orderBy: { clockIn: 'desc' },
    });

    const openEntry = entries.find(e => !e.clockOut);

    res.json({
      date: today.toISOString().split('T')[0],
      entries,
      openEntry: openEntry || null,
      totalMinutesToday: entries.reduce((sum, e) => sum + (e.totalMinutes || 0), 0),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/team/time-entries/clock-in
 * Fitxar entrada
 */
router.post('/time-entries/clock-in', async (req, res, next) => {
  try {
    const { type = 'OFICINA', shootingRole, projectName, notes } = req.body;
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Transacció serialitzable per evitar entrades duplicades amb requests concurrents
    const entry = await prisma.$transaction(async (tx) => {
      // Comprovar si ja hi ha una entrada oberta
      const openEntry = await tx.timeEntry.findFirst({
        where: { userId: req.user.id, clockOut: null },
      });

      if (openEntry) {
        const err = new Error('Ja tens una entrada oberta. Fitxa la sortida primer.');
        err.statusCode = 400;
        err.openEntry = openEntry;
        throw err;
      }

      return tx.timeEntry.create({
        data: {
          userId: req.user.id,
          date: today,
          clockIn: now,
          type,
          shootingRole: type === 'RODATGE' ? (shootingRole || null) : null,
          projectName: projectName || null,
          notes: notes || null,
          updatedAt: now,
        },
        include: {
          user: { select: { id: true, name: true } },
        },
      });
    }, {
      isolationLevel: 'Serializable',
    });

    logger.info(`Clock-in: ${req.user.name} (${type}${projectName ? ` — ${projectName}` : ''})`);
    res.json(entry);
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message, openEntry: err.openEntry });
    }
    next(err);
  }
});

/**
 * POST /api/team/time-entries/clock-out
 * Fitxar sortida (tanca l'entrada oberta)
 */
router.post('/time-entries/clock-out', async (req, res, next) => {
  try {
    const { notes } = req.body;
    const now = new Date();

    // Transacció serialitzable per evitar doble clock-out concurrent
    const { entry, totalMinutes, overtimeMinutes } = await prisma.$transaction(async (tx) => {
      // Buscar entrada oberta
      const openEntry = await tx.timeEntry.findFirst({
        where: { userId: req.user.id, clockOut: null },
      });

      if (!openEntry) {
        const err = new Error('No tens cap entrada oberta.');
        err.statusCode = 400;
        throw err;
      }

      // Calcular minuts totals i hores extres
      const _totalMinutes = Math.round((now - new Date(openEntry.clockIn)) / 60000);
      const _overtimeMinutes = Math.max(0, _totalMinutes - STANDARD_MINUTES);

      const updated = await tx.timeEntry.update({
        where: { id: openEntry.id },
        data: {
          clockOut: now,
          totalMinutes: _totalMinutes,
          overtimeMinutes: _overtimeMinutes,
          overtimeStatus: _overtimeMinutes > 0 ? 'PENDENT' : 'APROVADA',
          notes: notes || openEntry.notes,
        },
        include: {
          user: { select: { id: true, name: true } },
        },
      });

      return { entry: updated, totalMinutes: _totalMinutes, overtimeMinutes: _overtimeMinutes };
    }, {
      isolationLevel: 'Serializable',
    });

    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    logger.info(`Clock-out: ${req.user.name} — ${hours}h${mins}m${overtimeMinutes > 0 ? ` (${overtimeMinutes}min extres)` : ''}`);

    res.json(entry);
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * PUT /api/team/time-entries/:id
 * Editar un registre (l'usuari o admin)
 */
router.put('/time-entries/:id', async (req, res, next) => {
  try {
    const entry = await prisma.timeEntry.findUnique({ where: { id: req.params.id } });
    if (!entry) return res.status(404).json({ error: 'Registre no trobat' });

    const isAdmin = req.user.role === 'ADMIN';
    if (!isAdmin && entry.userId !== req.user.id) {
      return res.status(403).json({ error: 'No tens permisos' });
    }

    const { type, shootingRole, projectName, notes, clockIn, clockOut } = req.body;
    const data = {};

    if (type) data.type = type;
    if (shootingRole !== undefined) data.shootingRole = type === 'RODATGE' || entry.type === 'RODATGE' ? shootingRole : null;
    if (projectName !== undefined) data.projectName = projectName;
    if (notes !== undefined) data.notes = notes;

    // Recalcular si canvien hores
    if (clockIn || clockOut) {
      const newClockIn = clockIn ? new Date(clockIn) : new Date(entry.clockIn);
      const newClockOut = clockOut ? new Date(clockOut) : (entry.clockOut ? new Date(entry.clockOut) : null);

      if (clockIn) {
        data.clockIn = newClockIn;
        data.date = new Date(newClockIn);
        data.date.setHours(0, 0, 0, 0);
      }
      if (clockOut) data.clockOut = newClockOut;

      if (newClockOut) {
        data.totalMinutes = Math.round((newClockOut - newClockIn) / 60000);
        data.overtimeMinutes = Math.max(0, data.totalMinutes - STANDARD_MINUTES);
        if (data.overtimeMinutes > 0) data.overtimeStatus = 'PENDENT';
      }
    }

    const updated = await prisma.timeEntry.update({
      where: { id: req.params.id },
      data,
      include: {
        user: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/team/time-entries/:id
 * Eliminar registre (admin o propi del dia)
 */
router.delete('/time-entries/:id', async (req, res, next) => {
  try {
    const entry = await prisma.timeEntry.findUnique({ where: { id: req.params.id } });
    if (!entry) return res.status(404).json({ error: 'Registre no trobat' });

    const isAdmin = req.user.role === 'ADMIN';
    if (!isAdmin && entry.userId !== req.user.id) {
      return res.status(403).json({ error: 'No tens permisos' });
    }

    await prisma.timeEntry.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ===========================================
// Hores Extres — Aprovació Admin
// ===========================================

/**
 * GET /api/team/overtime/pending
 * Llistat d'hores extres pendents d'aprovar (admin)
 */
router.get('/overtime/pending', authorize('ADMIN'), async (req, res, next) => {
  try {
    const entries = await prisma.timeEntry.findMany({
      where: { overtimeMinutes: { gt: 0 }, overtimeStatus: 'PENDENT' },
      include: {
        user: { select: { id: true, name: true, color: true } },
      },
      orderBy: { date: 'desc' },
    });

    res.json(entries);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/team/overtime/:id/approve
 * Aprovar hores extres (admin)
 */
router.post('/overtime/:id/approve', authorize('ADMIN'), async (req, res, next) => {
  try {
    const entry = await prisma.timeEntry.update({
      where: { id: req.params.id },
      data: {
        overtimeStatus: 'APROVADA',
        approvedById: req.user.id,
        approvedAt: new Date(),
      },
      include: { user: { select: { id: true, name: true } } },
    });

    logger.info(`Overtime approved: ${entry.user.name} — ${entry.overtimeMinutes}min (${entry.date.toISOString().split('T')[0]})`);
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/team/overtime/:id/reject
 * Rebutjar hores extres (admin)
 */
router.post('/overtime/:id/reject', authorize('ADMIN'), async (req, res, next) => {
  try {
    const entry = await prisma.timeEntry.update({
      where: { id: req.params.id },
      data: {
        overtimeStatus: 'REBUTJADA',
        approvedById: req.user.id,
        approvedAt: new Date(),
      },
      include: { user: { select: { id: true, name: true } } },
    });

    res.json(entry);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/team/overtime/approve-all
 * Aprovar totes les hores extres pendents (admin)
 */
router.post('/overtime/approve-all', authorize('ADMIN'), async (req, res, next) => {
  try {
    const result = await prisma.timeEntry.updateMany({
      where: { overtimeMinutes: { gt: 0 }, overtimeStatus: 'PENDENT' },
      data: {
        overtimeStatus: 'APROVADA',
        approvedById: req.user.id,
        approvedAt: new Date(),
      },
    });

    res.json({ approved: result.count });
  } catch (err) {
    next(err);
  }
});

// ===========================================
// Resum mensual
// ===========================================

/**
 * GET /api/team/summary/monthly?year=2026&month=4&userId=xxx
 * Resum mensual per usuari
 */
router.get('/summary/monthly', async (req, res, next) => {
  try {
    const { year, month, userId } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'Cal indicar year i month' });

    const isAdmin = req.user.role === 'ADMIN';
    const targetUserId = isAdmin && userId ? userId : req.user.id;

    const from = new Date(parseInt(year), parseInt(month) - 1, 1);
    const to = new Date(parseInt(year), parseInt(month), 0);

    const entries = await prisma.timeEntry.findMany({
      where: {
        userId: targetUserId,
        date: { gte: from, lte: to },
        clockOut: { not: null },
      },
      orderBy: { date: 'asc' },
    });

    const totalMinutes = entries.reduce((sum, e) => sum + (e.totalMinutes || 0), 0);
    const overtimeMinutes = entries.reduce((sum, e) => sum + (e.overtimeMinutes || 0), 0);
    const overtimeApproved = entries.filter(e => e.overtimeStatus === 'APROVADA').reduce((sum, e) => sum + e.overtimeMinutes, 0);
    const overtimePending = entries.filter(e => e.overtimeStatus === 'PENDENT').reduce((sum, e) => sum + e.overtimeMinutes, 0);

    const byType = {};
    for (const e of entries) {
      if (!byType[e.type]) byType[e.type] = { count: 0, minutes: 0 };
      byType[e.type].count++;
      byType[e.type].minutes += e.totalMinutes || 0;
    }

    const daysWorked = new Set(entries.map(e => e.date.toISOString().split('T')[0])).size;

    res.json({
      userId: targetUserId,
      year: parseInt(year),
      month: parseInt(month),
      daysWorked,
      totalEntries: entries.length,
      totalMinutes,
      totalHours: Math.round(totalMinutes / 60 * 10) / 10,
      overtimeMinutes,
      overtimeHours: Math.round(overtimeMinutes / 60 * 10) / 10,
      overtimeApprovedMinutes: overtimeApproved,
      overtimePendingMinutes: overtimePending,
      byType,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
