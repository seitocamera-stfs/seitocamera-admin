const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireSection, requireLevel } = require('../middleware/sectionAccess');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('bank'));

// ===========================================
// Schemas de validació
// ===========================================

const bankMovementSchema = z.object({
  date: z.string().transform((s) => new Date(s)),
  valueDate: z.string().transform((s) => new Date(s)).optional().nullable(),
  description: z.string().min(1, 'Descripció requerida'),
  amount: z.number().or(z.string().transform(Number)),
  balance: z.number().or(z.string().transform(Number)).optional().nullable(),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
  reference: z.string().optional().nullable(),
  bankAccount: z.string().optional().nullable(),
});

// ===========================================
// GET /api/bank — Llistar moviments
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const { search, type, conciliated, dateFrom, dateTo, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

    if (type) where.type = type;
    if (conciliated !== undefined) where.isConciliated = conciliated === 'true';

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }

    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [movements, total] = await Promise.all([
      prisma.bankMovement.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { date: 'desc' },
        include: {
          _count: { select: { conciliations: true } },
        },
      }),
      prisma.bankMovement.count({ where }),
    ]);

    res.json({
      data: movements,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// SINCRONITZACIÓ QONTO (ha d'anar ABANS de /:id)
// ===========================================

const qontoSync = require('../services/qontoSyncService');

/**
 * GET /api/bank/qonto/status — Estat de connexió amb Qonto
 */
router.get('/qonto/status', authorize('ADMIN'), async (req, res, next) => {
  try {
    const result = await qontoSync.testConnection();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/bank/qonto/sync — Sincronitzar moviments de Qonto
 */
router.post('/qonto/sync', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { fullSync = false } = req.body || {};
    const result = await qontoSync.syncQontoTransactions({ fullSync });
    res.json({ message: 'Sincronització Qonto completada', ...result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/bank/:id — Detall moviment
 */
router.get('/:id', async (req, res, next) => {
  try {
    const movement = await prisma.bankMovement.findUnique({
      where: { id: req.params.id },
      include: {
        conciliations: {
          include: {
            receivedInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, supplier: { select: { name: true } } } },
            issuedInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, client: { select: { name: true } } } },
          },
        },
      },
    });

    if (!movement) {
      return res.status(404).json({ error: 'Moviment no trobat' });
    }

    res.json(movement);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/bank — Crear moviment manualment
 */
router.post('/', authorize('ADMIN', 'EDITOR'), validate(bankMovementSchema), async (req, res, next) => {
  try {
    const movement = await prisma.bankMovement.create({
      data: req.body,
    });

    res.status(201).json(movement);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/bank/import — Importar moviments des de CSV
 */
router.post('/import', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { movements } = req.body;

    if (!Array.isArray(movements) || movements.length === 0) {
      return res.status(400).json({ error: 'Cal enviar un array de moviments' });
    }

    // Parsejar dates i números
    const data = movements.map((m) => ({
      date: new Date(m.date),
      valueDate: m.valueDate ? new Date(m.valueDate) : null,
      description: m.description,
      amount: parseFloat(m.amount),
      balance: m.balance ? parseFloat(m.balance) : null,
      type: m.type || (parseFloat(m.amount) >= 0 ? 'INCOME' : 'EXPENSE'),
      reference: m.reference || null,
      bankAccount: m.bankAccount || null,
      rawData: m,
    }));

    const result = await prisma.bankMovement.createMany({
      data,
      skipDuplicates: true,
    });

    res.status(201).json({
      message: `${result.count} moviments importats`,
      count: result.count,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/bank/:id — Actualitzar moviment
 */
router.put('/:id', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const data = { ...req.body };
    if (data.date) data.date = new Date(data.date);
    if (data.valueDate) data.valueDate = new Date(data.valueDate);

    const movement = await prisma.bankMovement.update({
      where: { id: req.params.id },
      data,
    });

    res.json(movement);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Moviment no trobat' });
    }
    next(error);
  }
});

/**
 * DELETE /api/bank/:id — Eliminar moviment
 */
router.delete('/:id', requireLevel('bank', 'admin'), async (req, res, next) => {
  try {
    await prisma.bankMovement.delete({
      where: { id: req.params.id },
    });

    res.json({ message: 'Moviment eliminat' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Moviment no trobat' });
    }
    next(error);
  }
});

/**
 * GET /api/bank/stats/summary — Resum de moviments
 */
router.get('/stats/summary', async (req, res, next) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const where = {};

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }

    const [income, expense, unconciliated] = await Promise.all([
      prisma.bankMovement.aggregate({
        where: { ...where, type: 'INCOME' },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.bankMovement.aggregate({
        where: { ...where, type: 'EXPENSE' },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.bankMovement.count({
        where: { ...where, isConciliated: false },
      }),
    ]);

    res.json({
      income: { total: income._sum.amount || 0, count: income._count },
      expense: { total: expense._sum.amount || 0, count: expense._count },
      unconciliated,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
