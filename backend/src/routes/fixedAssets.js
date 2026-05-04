/**
 * Endpoints d'immobilitzat i amortitzacions (Sprint 6).
 */
const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSection, requireLevel } = require('../middleware/sectionAccess');
const { validate } = require('../middleware/validate');
const { logAudit } = require('../services/auditService');
const fixedAssetService = require('../services/fixedAssetService');
const amortizationService = require('../services/amortizationService');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('accounting'));

// ============ FIXED ASSETS ============

router.get('/', async (req, res, next) => {
  try {
    const { companyId, status, search } = req.query;
    const where = {};
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;
    if (search) where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
    ];

    const items = await prisma.fixedAsset.findMany({
      where,
      include: {
        account: { select: { code: true, name: true } },
        equipment: { select: { id: true, name: true } },
        receivedInvoice: { select: { id: true, invoiceNumber: true } },
        amortizationEntries: { select: { status: true, amount: true, accumulated: true, year: true, month: true } },
      },
      orderBy: { acquisitionDate: 'desc' },
    });

    // Calcular valor net actual
    const enriched = items.map((fa) => {
      const postedEntries = fa.amortizationEntries.filter((e) => e.status === 'POSTED');
      const accumulatedAmort = postedEntries.reduce((s, e) => s + Number(e.amount), 0);
      const netValue = Math.round((Number(fa.acquisitionValue) - accumulatedAmort) * 100) / 100;
      return {
        ...fa,
        amortizationEntries: undefined,
        accumulatedAmort: Math.round(accumulatedAmort * 100) / 100,
        netValue,
        monthsPosted: postedEntries.length,
        monthsTotal: fa.amortizationEntries.length,
      };
    });
    res.json(enriched);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const fa = await prisma.fixedAsset.findUnique({
      where: { id: req.params.id },
      include: {
        account: true,
        amortizationAccount: true,
        expenseAccount: true,
        equipment: { select: { id: true, name: true } },
        receivedInvoice: { select: { id: true, invoiceNumber: true } },
        amortizationEntries: {
          include: { journalEntry: { select: { id: true, entryNumber: true } } },
          orderBy: [{ year: 'asc' }, { month: 'asc' }],
        },
      },
    });
    if (!fa) return res.status(404).json({ error: 'Immobilitzat no trobat' });
    res.json(fa);
  } catch (err) { next(err); }
});

const createSchema = z.object({
  companyId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  accountId: z.string().min(1),
  acquisitionDate: z.string(),
  acquisitionValue: z.number().positive(),
  residualValue: z.number().nonnegative().optional(),
  usefulLifeYears: z.number().positive().optional(),
  equipmentId: z.string().nullable().optional(),
  receivedInvoiceId: z.string().nullable().optional(),
  code: z.string().optional(),
});

router.post('/', requireLevel('accounting', 'write'), validate(createSchema), async (req, res) => {
  try {
    const fa = await fixedAssetService.createManual(req.body);
    await logAudit(req, { entityType: 'FixedAsset', entityId: fa.id, action: 'CREATE', after: fa });
    res.status(201).json(fa);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/regenerate-schedule', requireLevel('accounting', 'admin'), async (req, res) => {
  try {
    const count = await fixedAssetService.generateAmortizationSchedule(req.params.id);
    res.json({ success: true, entries: count });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/dispose', requireLevel('accounting', 'admin'), async (req, res) => {
  try {
    const updated = await fixedAssetService.dispose(req.params.id, { date: req.body?.date, notes: req.body?.notes });
    await logAudit(req, { entityType: 'FixedAsset', entityId: req.params.id, action: 'DISPOSE', after: updated });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============ AMORTITZACIONS ============

router.post('/amortizations/:id/post', requireLevel('accounting', 'write'), async (req, res) => {
  try {
    const j = await amortizationService.postEntry(req.params.id, req.user.id);
    await logAudit(req, { entityType: 'AmortizationEntry', entityId: req.params.id, action: 'POST', after: { journalEntryId: j.id } });
    res.json(j);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/amortizations/:id/unpost', requireLevel('accounting', 'admin'), async (req, res) => {
  try {
    await amortizationService.unpostEntry(req.params.id, req.user.id, req.body?.reason);
    await logAudit(req, { entityType: 'AmortizationEntry', entityId: req.params.id, action: 'UNPOST' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/amortizations/run-month', requireLevel('accounting', 'write'), async (req, res) => {
  try {
    const year = parseInt(req.body?.year, 10) || new Date().getFullYear();
    const month = parseInt(req.body?.month, 10) || new Date().getMonth() + 1;
    if (month < 1 || month > 12) return res.status(400).json({ error: 'Mes invàlid' });
    const result = await amortizationService.runMonth(year, month, req.user.id);
    await logAudit(req, { entityType: 'AmortizationEntry', entityId: 'bulk', action: 'POST_BULK', after: { year, month, ok: result.ok.length, failed: result.failed.length } });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/amortizations/calendar', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const entries = await prisma.amortizationEntry.findMany({
      where: { year, fixedAsset: { status: { in: ['ACTIVE', 'FULLY_AMORTIZED'] } } },
      include: {
        fixedAsset: { select: { id: true, code: true, name: true, status: true } },
        journalEntry: { select: { id: true, entryNumber: true } },
      },
      orderBy: [{ month: 'asc' }, { fixedAsset: { code: 'asc' } }],
    });

    // Agrupar per mes
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      entries: [],
      totalAmount: 0,
      pending: 0,
      posted: 0,
    }));
    for (const e of entries) {
      const m = months[e.month - 1];
      m.entries.push(e);
      m.totalAmount += Number(e.amount);
      if (e.status === 'PENDING') m.pending++;
      else if (e.status === 'POSTED') m.posted++;
    }
    months.forEach((m) => { m.totalAmount = Math.round(m.totalAmount * 100) / 100; });

    res.json({ year, months });
  } catch (err) { next(err); }
});

module.exports = router;
