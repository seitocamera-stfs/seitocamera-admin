const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireSection, requireLevel } = require('../middleware/sectionAccess');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('clients'));

// ===========================================
// Schemas de validació
// ===========================================

// Helper: converteix strings buides a null per camps opcionals
const emptyToNull = (val) => (val === '' || val === undefined ? null : val);

const clientSchema = z.object({
  name: z.string().min(1, 'Nom requerit'),
  nif: z.preprocess(emptyToNull, z.string().nullable().optional()),
  email: z.preprocess(
    emptyToNull,
    z.string().email('Email invàlid').nullable().optional()
  ),
  phone: z.preprocess(emptyToNull, z.string().nullable().optional()),
  address: z.preprocess(emptyToNull, z.string().nullable().optional()),
  city: z.preprocess(emptyToNull, z.string().nullable().optional()),
  postalCode: z.preprocess(emptyToNull, z.string().nullable().optional()),
  country: z.preprocess((v) => (v === '' || v === undefined ? 'ES' : v), z.string().default('ES')),
  notes: z.preprocess(emptyToNull, z.string().nullable().optional()),
});

// ===========================================
// GET /api/clients — Llistar clients
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const { search, page = 1, limit = 25, active, sortBy, sortOrder } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

    if (active !== undefined) {
      where.isActive = active === 'true';
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nif: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Ordenació dinàmica
    const dir = sortOrder === 'desc' ? 'desc' : 'asc';
    const orderByMap = {
      name: { name: dir },
      nif: { nif: dir },
      email: { email: dir },
      city: { city: dir },
    };
    const orderBy = orderByMap[sortBy] || { name: 'asc' };

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy,
        include: {
          _count: { select: { issuedInvoices: true } },
        },
      }),
      prisma.client.count({ where }),
    ]);

    res.json({
      data: clients,
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
// GET /api/clients/:id — Detall d'un client
// ===========================================
router.get('/:id', async (req, res, next) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: {
        issuedInvoices: {
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
        _count: { select: { issuedInvoices: true } },
      },
    });

    if (!client) {
      return res.status(404).json({ error: 'Client no trobat' });
    }

    res.json(client);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/clients — Crear client
// ===========================================
router.post('/', authorize('ADMIN', 'EDITOR'), validate(clientSchema), async (req, res, next) => {
  try {
    const client = await prisma.client.create({
      data: req.body,
    });

    res.status(201).json(client);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Ja existeix un client amb aquest NIF' });
    }
    next(error);
  }
});

// ===========================================
// PUT /api/clients/:id — Actualitzar client
// ===========================================
router.put('/:id', authorize('ADMIN', 'EDITOR'), validate(clientSchema), async (req, res, next) => {
  try {
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: req.body,
    });

    res.json(client);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Client no trobat' });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Ja existeix un client amb aquest NIF' });
    }
    next(error);
  }
});

// ===========================================
// DELETE /api/clients/:id — Desactivar client (soft delete)
// ===========================================
router.delete('/:id', requireLevel('clients', 'admin'), async (req, res, next) => {
  try {
    await prisma.client.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });

    res.json({ message: 'Client desactivat' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Client no trobat' });
    }
    next(error);
  }
});

module.exports = router;
