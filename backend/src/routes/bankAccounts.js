const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireSection } = require('../middleware/sectionAccess');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('bank'));

// ===========================================
// Schemas de validació
// ===========================================

const bankAccountSchema = z.object({
  name: z.string().min(1, 'Nom requerit'),
  iban: z.string().optional().nullable(),
  bankEntity: z.string().optional().nullable(),
  syncType: z.enum(['MANUAL', 'CSV', 'QONTO', 'OPEN_BANKING']).optional().default('MANUAL'),
  color: z.string().optional().default('#2390A0'),
  isActive: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
});

// ===========================================
// GET /api/bank-accounts — Llistar comptes bancaris
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { movements: true } },
      },
    });
    res.json(accounts);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// GET /api/bank-accounts/all — Tots (inclús inactius)
// ===========================================
router.get('/all', authorize('ADMIN'), async (req, res, next) => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { movements: true } },
      },
    });
    res.json(accounts);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// GET /api/bank-accounts/:id — Detall compte
// ===========================================
router.get('/:id', async (req, res, next) => {
  try {
    const account = await prisma.bankAccount.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { movements: true } },
      },
    });
    if (!account) return res.status(404).json({ error: 'Compte no trobat' });
    res.json(account);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/bank-accounts — Crear compte
// ===========================================
router.post('/', authorize('ADMIN'), validate(bankAccountSchema), async (req, res, next) => {
  try {
    const data = { ...req.body };

    // Si és el primer o es marca com a default, treure default dels altres
    if (data.isDefault) {
      await prisma.bankAccount.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const account = await prisma.bankAccount.create({ data });
    res.status(201).json(account);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// PUT /api/bank-accounts/:id — Actualitzar compte
// ===========================================
router.put('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const data = { ...req.body };
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;

    if (data.isDefault) {
      await prisma.bankAccount.updateMany({
        where: { isDefault: true, id: { not: req.params.id } },
        data: { isDefault: false },
      });
    }

    const account = await prisma.bankAccount.update({
      where: { id: req.params.id },
      data,
    });
    res.json(account);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Compte no trobat' });
    next(error);
  }
});

// ===========================================
// DELETE /api/bank-accounts/:id — Desactivar compte (soft delete)
// ===========================================
router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const account = await prisma.bankAccount.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { movements: true } } },
    });

    if (!account) return res.status(404).json({ error: 'Compte no trobat' });

    if (account.isDefault) {
      return res.status(400).json({ error: 'No es pot eliminar el compte per defecte' });
    }

    // Soft delete: desactivar
    await prisma.bankAccount.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });

    res.json({ message: 'Compte desactivat', movementsCount: account._count.movements });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/bank-accounts/:id/import-csv — Importar CSV per un compte
// ===========================================
router.post('/:id/import-csv', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const account = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
    if (!account) return res.status(404).json({ error: 'Compte no trobat' });

    const { movements, format } = req.body;

    if (!Array.isArray(movements) || movements.length === 0) {
      return res.status(400).json({ error: 'Cal enviar un array de moviments' });
    }

    // Parsejar segons format (genèric o Sabadell)
    const data = movements.map((m) => {
      const amount = parseFloat(m.amount);
      return {
        date: new Date(m.date),
        valueDate: m.valueDate ? new Date(m.valueDate) : null,
        description: m.description || m.concept || '',
        amount,
        balance: m.balance ? parseFloat(m.balance) : null,
        type: m.type || (amount >= 0 ? 'INCOME' : 'EXPENSE'),
        reference: m.reference || null,
        bankAccountId: req.params.id,
        counterparty: m.counterparty || null,
        rawData: m,
      };
    });

    const result = await prisma.bankMovement.createMany({
      data,
      skipDuplicates: true,
    });

    res.status(201).json({
      message: `${result.count} moviments importats al compte ${account.name}`,
      count: result.count,
      accountName: account.name,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
