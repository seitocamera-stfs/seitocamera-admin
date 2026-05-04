const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSection, requireLevel } = require('../middleware/sectionAccess');
const { validate } = require('../middleware/validate');
const { logAudit } = require('../services/auditService');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('accounting'));

const createSchema = z.object({
  companyId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// ===========================================
// GET /api/fiscal-years — Llistar exercicis
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const { companyId } = req.query;
    const where = companyId ? { companyId } : {};
    const years = await prisma.fiscalYear.findMany({
      where,
      include: { lockedBy: { select: { id: true, name: true, email: true } } },
      orderBy: { year: 'desc' },
    });
    res.json(years);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// POST /api/fiscal-years — Crear nou exercici
// ===========================================
router.post('/', requireLevel('accounting', 'admin'), validate(createSchema), async (req, res, next) => {
  try {
    const { companyId, year, startDate, endDate } = req.body;

    const exists = await prisma.fiscalYear.findUnique({
      where: { companyId_year: { companyId, year } },
    });
    if (exists) {
      return res.status(409).json({ error: `L'exercici ${year} ja existeix` });
    }

    const fy = await prisma.fiscalYear.create({
      data: {
        companyId,
        year,
        startDate: startDate ? new Date(startDate) : new Date(`${year}-01-01T00:00:00Z`),
        endDate: endDate ? new Date(endDate) : new Date(`${year}-12-31T23:59:59Z`),
        status: 'OPEN',
      },
    });

    await logAudit(req, {
      companyId,
      entityType: 'FiscalYear',
      entityId: fy.id,
      action: 'CREATE',
      after: fy,
    });

    res.status(201).json(fy);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// PATCH /api/fiscal-years/:id/lock — Bloqueja exercici
// ===========================================
router.patch('/:id/lock', requireLevel('accounting', 'admin'), async (req, res, next) => {
  try {
    const before = await prisma.fiscalYear.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'Exercici no trobat' });
    if (before.locked) return res.status(409).json({ error: 'L\'exercici ja està bloquejat' });

    const after = await prisma.fiscalYear.update({
      where: { id: req.params.id },
      data: {
        locked: true,
        lockedAt: new Date(),
        lockedById: req.user.id,
        status: 'CLOSED',
      },
    });

    await logAudit(req, {
      companyId: after.companyId,
      entityType: 'FiscalYear',
      entityId: after.id,
      action: 'LOCK',
      before,
      after,
    });

    res.json(after);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// PATCH /api/fiscal-years/:id/unlock — Desbloqueja exercici (només ADMIN)
// ===========================================
router.patch('/:id/unlock', requireLevel('accounting', 'admin'), async (req, res, next) => {
  try {
    const before = await prisma.fiscalYear.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'Exercici no trobat' });
    if (!before.locked) return res.status(409).json({ error: 'L\'exercici no està bloquejat' });

    const after = await prisma.fiscalYear.update({
      where: { id: req.params.id },
      data: {
        locked: false,
        lockedAt: null,
        lockedById: null,
        status: 'OPEN',
      },
    });

    await logAudit(req, {
      companyId: after.companyId,
      entityType: 'FiscalYear',
      entityId: after.id,
      action: 'UNLOCK',
      before,
      after,
    });

    res.json(after);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
