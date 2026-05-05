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

// Per crear la primera empresa: legalName + NIF obligatoris, la resta opcional
const companyCreateSchema = companyUpdateSchema.extend({
  legalName: z.string().min(1, 'Raó social requerida'),
  nif: z.string().min(1, 'NIF requerit'),
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
// POST /api/companies — Crea la primera empresa (només si no n'hi ha cap)
// MVP single-tenant: el sistema només admet una empresa.
// ===========================================
router.post('/', requireLevel('accounting', 'admin'), validate(companyCreateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.company.findFirst();
    if (existing) {
      return res.status(409).json({
        error: 'Ja hi ha una empresa configurada. Usa PUT per actualitzar-la.',
        code: 'COMPANY_EXISTS',
        existing: { id: existing.id, legalName: existing.legalName },
      });
    }

    const company = await prisma.company.create({
      data: {
        ...req.body,
        // Defaults segurs per camps no enviats
        country: req.body.country || 'ES',
        defaultCurrency: req.body.defaultCurrency || 'EUR',
      },
    });

    await logAudit(req, {
      companyId: company.id,
      entityType: 'Company',
      entityId: company.id,
      action: 'CREATE',
      after: company,
    });

    res.status(201).json(company);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Ja existeix una empresa amb aquest NIF' });
    }
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
