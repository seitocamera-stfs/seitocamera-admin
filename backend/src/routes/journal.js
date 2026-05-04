const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSection, requireLevel } = require('../middleware/sectionAccess');
const { validate } = require('../middleware/validate');
const { logAudit } = require('../services/auditService');
const journalService = require('../services/journalService');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('accounting'));

const lineSchema = z.object({
  accountId: z.string().min(1),
  debit: z.number().nonnegative().optional(),
  credit: z.number().nonnegative().optional(),
  description: z.string().nullable().optional(),
  counterpartyId: z.string().nullable().optional(),
  counterpartyType: z.enum(['SUPPLIER', 'CLIENT']).nullable().optional(),
  projectId: z.string().nullable().optional(),
  vatRate: z.number().nullable().optional(),
  vatBase: z.number().nullable().optional(),
  irpfRate: z.number().nullable().optional(),
  irpfBase: z.number().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const createSchema = z.object({
  companyId: z.string().min(1),
  date: z.string(),
  description: z.string().min(1),
  type: z.enum([
    'RECEIVED_INVOICE','ISSUED_INVOICE','PAYMENT','COLLECTION','BANK_TRANSFER','BANK_FEE',
    'AMORTIZATION','PAYROLL','TAX_PAYMENT','TAX_ACCRUAL','YEAR_CLOSING','YEAR_OPENING',
    'ADJUSTMENT','OTHER',
  ]).optional(),
  source: z.enum(['MANUAL','AUTO_INVOICE','AUTO_BANK','AUTO_AMORTIZATION','AUTO_CLOSING','AGENT']).optional(),
  sourceRef: z.string().nullable().optional(),
  lines: z.array(lineSchema).min(2),
});

const updateSchema = createSchema.partial();

// ===========================================
// GET /api/journal — Llistat (Llibre Diari)
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const {
      companyId, fiscalYearId, type, status, source,
      from, to, accountId,
      page = '1', pageSize = '50',
    } = req.query;

    const where = {};
    if (companyId) where.companyId = companyId;
    if (fiscalYearId) where.fiscalYearId = fiscalYearId;
    if (type) where.type = type;
    if (status) where.status = status;
    if (source) where.source = source;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to)   where.date.lte = new Date(to);
    }
    if (accountId) {
      where.lines = { some: { accountId } };
    }

    const take = Math.min(parseInt(pageSize, 10) || 50, 200);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const [items, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        include: {
          lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { sortOrder: 'asc' } },
          fiscalYear: { select: { year: true, locked: true } },
          createdBy: { select: { id: true, name: true } },
          postedBy: { select: { id: true, name: true } },
        },
        orderBy: [{ date: 'desc' }, { entryNumber: 'desc' }],
        take,
        skip,
      }),
      prisma.journalEntry.count({ where }),
    ]);

    res.json({ items, total, page: parseInt(page, 10), pageSize: take });
  } catch (err) { next(err); }
});

// ===========================================
// GET /api/journal/:id
// ===========================================
router.get('/:id', async (req, res, next) => {
  try {
    const entry = await prisma.journalEntry.findUnique({
      where: { id: req.params.id },
      include: {
        lines: { include: { account: true }, orderBy: { sortOrder: 'asc' } },
        fiscalYear: true,
        createdBy: { select: { id: true, name: true, email: true } },
        postedBy: { select: { id: true, name: true, email: true } },
        reverses: true,
        reversedBy: true,
      },
    });
    if (!entry) return res.status(404).json({ error: 'Assentament no trobat' });
    res.json(entry);
  } catch (err) { next(err); }
});

// ===========================================
// POST /api/journal — Crear (DRAFT)
// ===========================================
router.post('/', requireLevel('accounting', 'write'), validate(createSchema), async (req, res, next) => {
  try {
    const created = await journalService.createDraft({
      ...req.body,
      createdById: req.user.id,
    });
    await logAudit(req, {
      companyId: req.body.companyId,
      entityType: 'JournalEntry',
      entityId: created.id,
      action: 'CREATE',
      after: created,
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===========================================
// PUT /api/journal/:id — Editar (només DRAFT)
// ===========================================
router.put('/:id', requireLevel('accounting', 'write'), validate(updateSchema), async (req, res, next) => {
  try {
    const before = await prisma.journalEntry.findUnique({
      where: { id: req.params.id }, include: { lines: true },
    });
    if (!before) return res.status(404).json({ error: 'Assentament no trobat' });

    const updated = await journalService.update(req.params.id, req.body, req.user.id);
    await logAudit(req, {
      companyId: updated.companyId,
      entityType: 'JournalEntry',
      entityId: updated.id,
      action: 'UPDATE',
      before, after: updated,
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===========================================
// PATCH /api/journal/:id/post — Comptabilitzar (DRAFT → POSTED)
// ===========================================
router.patch('/:id/post', requireLevel('accounting', 'write'), async (req, res, next) => {
  try {
    const before = await prisma.journalEntry.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'Assentament no trobat' });

    const posted = await journalService.post(req.params.id, req.user.id);
    await logAudit(req, {
      companyId: posted.companyId,
      entityType: 'JournalEntry',
      entityId: posted.id,
      action: 'POST',
      before, after: posted,
    });
    res.json(posted);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===========================================
// PATCH /api/journal/:id/reverse — Anul·lar (POSTED → REVERSED + nou assentament d'inversió)
// ===========================================
router.patch('/:id/reverse', requireLevel('accounting', 'admin'), async (req, res, next) => {
  try {
    const reversal = await journalService.reverse(req.params.id, req.user.id, req.body?.reason || '');
    await logAudit(req, {
      companyId: reversal.companyId,
      entityType: 'JournalEntry',
      entityId: req.params.id,
      action: 'REVERSE',
      after: reversal,
    });
    res.json(reversal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===========================================
// DELETE /api/journal/:id — Esborrar (només DRAFT)
// ===========================================
router.delete('/:id', requireLevel('accounting', 'admin'), async (req, res, next) => {
  try {
    const before = await prisma.journalEntry.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'Assentament no trobat' });

    await journalService.remove(req.params.id);
    await logAudit(req, {
      companyId: before.companyId,
      entityType: 'JournalEntry',
      entityId: before.id,
      action: 'DELETE',
      before,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
