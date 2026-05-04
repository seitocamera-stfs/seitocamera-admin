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

const accountSchema = z.object({
  companyId: z.string().min(1),
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
  subtype: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  level: z.number().int().min(0).max(5).optional(),
  isLeaf: z.boolean().optional(),
  defaultVatRate: z.number().min(0).max(100).nullable().optional(),
  taxBookType: z.enum(['VAT_INPUT', 'VAT_OUTPUT', 'IRPF']).nullable().optional(),
});

const accountUpdateSchema = accountSchema.partial().omit({ companyId: true });

// ===========================================
// GET /api/chart-of-accounts — Llistar tots (pla, possiblement filtrat)
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const { companyId, type, leafOnly, search } = req.query;
    const where = {};
    if (companyId) where.companyId = companyId;
    if (type) where.type = type;
    if (leafOnly === 'true') where.isLeaf = true;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const accounts = await prisma.chartOfAccount.findMany({
      where,
      orderBy: { code: 'asc' },
    });
    res.json(accounts);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// GET /api/chart-of-accounts/tree — Retorna estructura jeràrquica
// ===========================================
router.get('/tree', async (req, res, next) => {
  try {
    const { companyId } = req.query;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId requerit' });
    }

    const accounts = await prisma.chartOfAccount.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
    });

    const byId = new Map();
    accounts.forEach(a => byId.set(a.id, { ...a, children: [] }));

    const roots = [];
    for (const acc of accounts) {
      const node = byId.get(acc.id);
      if (acc.parentId && byId.has(acc.parentId)) {
        byId.get(acc.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }

    res.json(roots);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// POST /api/chart-of-accounts — Crear nou compte
// ===========================================
router.post('/', requireLevel('accounting', 'write'), validate(accountSchema), async (req, res, next) => {
  try {
    const { companyId, code } = req.body;

    const exists = await prisma.chartOfAccount.findUnique({
      where: { companyId_code: { companyId, code } },
    });
    if (exists) {
      return res.status(409).json({ error: `El compte ${code} ja existeix` });
    }

    // Auto-resoldre parent: el compte amb codi més llarg que sigui prefix
    let parentId = req.body.parentId || null;
    if (!parentId && code.length > 1) {
      for (let len = code.length - 1; len >= 1; len--) {
        const prefix = code.substring(0, len);
        const candidate = await prisma.chartOfAccount.findUnique({
          where: { companyId_code: { companyId, code: prefix } },
          select: { id: true },
        });
        if (candidate) {
          parentId = candidate.id;
          break;
        }
      }
    }

    const created = await prisma.chartOfAccount.create({
      data: {
        ...req.body,
        parentId,
        isSystem: false,
      },
    });

    await logAudit(req, {
      companyId,
      entityType: 'ChartOfAccount',
      entityId: created.id,
      action: 'CREATE',
      after: created,
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// PUT /api/chart-of-accounts/:id — Actualitzar compte
// ===========================================
router.put('/:id', requireLevel('accounting', 'write'), validate(accountUpdateSchema), async (req, res, next) => {
  try {
    const before = await prisma.chartOfAccount.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'Compte no trobat' });

    if (before.isSystem && (req.body.code || req.body.type)) {
      return res.status(403).json({
        error: 'No es pot modificar el codi ni el tipus d\'un compte del sistema',
      });
    }

    const after = await prisma.chartOfAccount.update({
      where: { id: req.params.id },
      data: req.body,
    });

    await logAudit(req, {
      companyId: after.companyId,
      entityType: 'ChartOfAccount',
      entityId: after.id,
      action: 'UPDATE',
      before,
      after,
    });

    res.json(after);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// DELETE /api/chart-of-accounts/:id — Eliminar compte (només no-system, sense apunts)
// ===========================================
router.delete('/:id', requireLevel('accounting', 'admin'), async (req, res, next) => {
  try {
    const before = await prisma.chartOfAccount.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'Compte no trobat' });
    if (before.isSystem) {
      return res.status(403).json({ error: 'No es poden eliminar comptes del sistema' });
    }

    // En sprints futurs, comprovar que no hi hagi JournalLine referenciant aquest compte.
    // Ara mateix encara no existeix la taula, així que la verificació es farà al Sprint 2.

    await prisma.chartOfAccount.delete({ where: { id: req.params.id } });

    await logAudit(req, {
      companyId: before.companyId,
      entityType: 'ChartOfAccount',
      entityId: before.id,
      action: 'DELETE',
      before,
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
