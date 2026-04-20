const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

router.use(authenticate);

// ===========================================
// Schemas
// ===========================================

const reminderSchema = z.object({
  title: z.string().min(1, 'Títol requerit'),
  description: z.string().optional().nullable(),
  dueAt: z.string().transform((s) => new Date(s)),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  recurrence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']).optional().nullable(),
  entityType: z.string().optional().nullable(),
  entityId: z.string().optional().nullable(),
  mentionUserIds: z.array(z.string()).optional().default([]),
});

// ===========================================
// GET /api/reminders — Llistar recordatoris
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const { completed, priority, page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      OR: [
        { authorId: req.user.id },
        { mentions: { some: { userId: req.user.id } } },
      ],
    };

    if (completed !== undefined) where.isCompleted = completed === 'true';
    if (priority) where.priority = priority;

    const [reminders, total] = await Promise.all([
      prisma.reminder.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: [
          { isCompleted: 'asc' },
          { dueAt: 'asc' },
        ],
        include: {
          author: { select: { id: true, name: true } },
          mentions: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      }),
      prisma.reminder.count({ where }),
    ]);

    res.json({
      data: reminders,
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
// GET /api/reminders/pending — Mencions pendents de llegir
// ===========================================
router.get('/pending', async (req, res, next) => {
  try {
    const mentions = await prisma.reminderMention.findMany({
      where: {
        userId: req.user.id,
        isRead: false,
      },
      include: {
        reminder: {
          include: {
            author: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      count: mentions.length,
      data: mentions,
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/reminders — Crear recordatori
// ===========================================
router.post('/', validate(reminderSchema), async (req, res, next) => {
  try {
    const { mentionUserIds, ...data } = req.body;

    const reminder = await prisma.reminder.create({
      data: {
        ...data,
        authorId: req.user.id,
        mentions: {
          create: mentionUserIds.map((userId) => ({ userId })),
        },
      },
      include: {
        author: { select: { id: true, name: true } },
        mentions: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    res.status(201).json(reminder);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// PUT /api/reminders/:id — Actualitzar recordatori
// ===========================================
router.put('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.reminder.findUnique({ where: { id: req.params.id } });

    if (!existing) {
      return res.status(404).json({ error: 'Recordatori no trobat' });
    }

    if (existing.authorId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Només pots editar els teus recordatoris' });
    }

    const { mentionUserIds, ...data } = req.body;
    if (data.dueAt) data.dueAt = new Date(data.dueAt);

    const updateData = { ...data };

    // Si venen mencions noves, reemplaçar-les
    if (mentionUserIds) {
      // Eliminar mencions anteriors
      await prisma.reminderMention.deleteMany({ where: { reminderId: req.params.id } });
      updateData.mentions = {
        create: mentionUserIds.map((userId) => ({ userId })),
      };
    }

    const reminder = await prisma.reminder.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        author: { select: { id: true, name: true } },
        mentions: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    res.json(reminder);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Recordatori no trobat' });
    }
    next(error);
  }
});

// ===========================================
// PATCH /api/reminders/:id/complete — Marcar com a completat
// ===========================================
router.patch('/:id/complete', async (req, res, next) => {
  try {
    const reminder = await prisma.reminder.update({
      where: { id: req.params.id },
      data: {
        isCompleted: true,
        completedAt: new Date(),
      },
    });

    res.json(reminder);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Recordatori no trobat' });
    }
    next(error);
  }
});

// ===========================================
// PATCH /api/reminders/mentions/:id/read — Marcar menció com a llegida
// ===========================================
router.patch('/mentions/:id/read', async (req, res, next) => {
  try {
    const mention = await prisma.reminderMention.update({
      where: { id: req.params.id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    res.json(mention);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Menció no trobada' });
    }
    next(error);
  }
});

// ===========================================
// DELETE /api/reminders/:id — Eliminar recordatori
// ===========================================
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.reminder.findUnique({ where: { id: req.params.id } });

    if (!existing) {
      return res.status(404).json({ error: 'Recordatori no trobat' });
    }

    if (existing.authorId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Només pots eliminar els teus recordatoris' });
    }

    await prisma.reminder.delete({ where: { id: req.params.id } });

    res.json({ message: 'Recordatori eliminat' });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// GET /api/reminders/invoice-collection — Checklist mensual recollida factures
// ===========================================
router.get('/invoice-collection', async (req, res, next) => {
  try {
    const { year, month } = req.query;
    const now = new Date();
    const targetYear = parseInt(year) || now.getFullYear();
    const targetMonth = parseInt(month) || (now.getMonth() + 1); // 1-12

    const monthStart = new Date(targetYear, targetMonth - 1, 1);
    const monthEnd = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    // Proveïdors que requereixen recollida manual
    const suppliers = await prisma.supplier.findMany({
      where: {
        requiresManualDownload: true,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        manualDownloadUrl: true,
      },
      orderBy: { name: 'asc' },
    });

    if (suppliers.length === 0) {
      return res.json({ year: targetYear, month: targetMonth, suppliers: [], collected: 0, total: 0 });
    }

    // Comprovar quins tenen factura aquell mes
    const supplierIds = suppliers.map((s) => s.id);
    const invoicesThisMonth = await prisma.receivedInvoice.findMany({
      where: {
        supplierId: { in: supplierIds },
        issueDate: { gte: monthStart, lte: monthEnd },
        deletedAt: null,
        status: { not: 'NOT_INVOICE' },
      },
      select: {
        supplierId: true,
        invoiceNumber: true,
        totalAmount: true,
        issueDate: true,
      },
    });

    // Agrupar factures per proveïdor
    const invoicesBySupplier = {};
    for (const inv of invoicesThisMonth) {
      if (!invoicesBySupplier[inv.supplierId]) {
        invoicesBySupplier[inv.supplierId] = [];
      }
      invoicesBySupplier[inv.supplierId].push(inv);
    }

    const result = suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.manualDownloadUrl,
      collected: !!invoicesBySupplier[s.id],
      invoices: (invoicesBySupplier[s.id] || []).map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        totalAmount: parseFloat(inv.totalAmount) || 0,
        issueDate: inv.issueDate,
      })),
    }));

    const collected = result.filter((s) => s.collected).length;

    res.json({
      year: targetYear,
      month: targetMonth,
      suppliers: result,
      collected,
      total: result.length,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
