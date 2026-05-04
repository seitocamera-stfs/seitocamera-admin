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

const companyUpdateSchema = z.object({
  legalName: z.string().min(1).optional(),
  commercialName: z.string().nullable().optional(),
  nif: z.string().min(1).optional(),
  address: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  province: z.string().nullable().optional(),
  country: z.string().length(2).optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  website: z.string().url().nullable().optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  defaultCurrency: z.string().length(3).optional(),
  defaultVatRate: z.number().min(0).max(100).optional(),
  defaultIrpfRate: z.number().min(0).max(100).optional(),
  corporateTaxRate: z.number().min(0).max(100).optional(),
  aeatRegime: z.enum(['GENERAL', 'RECARGO_EQUIVALENCIA', 'EXEMPT']).optional(),
  is347Threshold: z.number().min(0).optional(),
  vatPeriod: z.enum(['QUARTERLY', 'MONTHLY']).optional(),
});

// ===========================================
// GET /api/companies — Retorna l'empresa principal (única al MVP)
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!company) {
      return res.status(404).json({ error: 'No s\'ha trobat cap empresa configurada' });
    }
    res.json(company);
  } catch (err) {
    next(err);
  }
});

// ===========================================
// PUT /api/companies/:id — Actualitza dades fiscals
// ===========================================
router.put('/:id', requireLevel('accounting', 'admin'), validate(companyUpdateSchema), async (req, res, next) => {
  try {
    const before = await prisma.company.findUnique({ where: { id: req.params.id } });
    if (!before) {
      return res.status(404).json({ error: 'Empresa no trobada' });
    }

    const after = await prisma.company.update({
      where: { id: req.params.id },
      data: req.body,
    });

    await logAudit(req, {
      companyId: after.id,
      entityType: 'Company',
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

module.exports = router;
