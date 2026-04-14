const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireSection } = require('../middleware/sectionAccess');

const router = express.Router();

// Totes les rutes requereixen autenticació + accés a la secció
router.use(authenticate);
router.use(requireSection('suppliers'));

// ===========================================
// Schemas de validació
// ===========================================

const supplierSchema = z.object({
  name: z.string().min(1, 'Nom requerit'),
  nif: z.string().optional().nullable(),
  email: z.string().email('Email invàlid').optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().default('ES'),
  notes: z.string().optional().nullable(),
});

// ===========================================
// GET /api/suppliers — Llistar proveïdors
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const { search, page = 1, limit = 25, active } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

    // Filtre per actius/inactius
    if (active !== undefined) {
      where.isActive = active === 'true';
    }

    // Cerca per nom, NIF o email
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nif: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { receivedInvoices: true } },
        },
      }),
      prisma.supplier.count({ where }),
    ]);

    res.json({
      data: suppliers,
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
// GET /api/suppliers/:id — Detall d'un proveïdor
// ===========================================
router.get('/:id', async (req, res, next) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        receivedInvoices: {
          take: 10,
          orderBy: { issueDate: 'desc' },
          select: {
            id: true,
            invoiceNumber: true,
            issueDate: true,
            totalAmount: true,
            status: true,
          },
        },
        _count: { select: { receivedInvoices: true } },
      },
    });

    if (!supplier) {
      return res.status(404).json({ error: 'Proveïdor no trobat' });
    }

    res.json(supplier);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/suppliers — Crear proveïdor
// ===========================================
router.post('/', authorize('ADMIN', 'EDITOR'), validate(supplierSchema), async (req, res, next) => {
  try {
    const supplier = await prisma.supplier.create({
      data: req.body,
    });

    res.status(201).json(supplier);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Ja existeix un proveïdor amb aquest NIF' });
    }
    next(error);
  }
});

// ===========================================
// PUT /api/suppliers/:id — Actualitzar proveïdor
// ===========================================
router.put('/:id', authorize('ADMIN', 'EDITOR'), validate(supplierSchema), async (req, res, next) => {
  try {
    const supplier = await prisma.supplier.update({
      where: { id: req.params.id },
      data: req.body,
    });

    res.json(supplier);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Proveïdor no trobat' });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Ja existeix un proveïdor amb aquest NIF' });
    }
    next(error);
  }
});

// ===========================================
// DELETE /api/suppliers/:id — Desactivar proveïdor (soft delete)
// ===========================================
router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    await prisma.supplier.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });

    res.json({ message: 'Proveïdor desactivat' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Proveïdor no trobat' });
    }
    next(error);
  }
});

module.exports = router;
