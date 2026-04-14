const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireSection } = require('../middleware/sectionAccess');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('clients'));

// ===========================================
// Schemas de validació
// ===========================================

const clientSchema = z.object({
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
// GET /api/clients — Llistar clients
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const { search, page = 1, limit = 25, active } = req.query;
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

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { name: 'asc' },
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
router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
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
