const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireSection } = require('../middleware/sectionAccess');
const { logger } = require('../config/logger');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('conciliation'));

// ===========================================
// Schemas
// ===========================================

const manualMatchSchema = z.object({
  bankMovementId: z.string().min(1),
  receivedInvoiceId: z.string().optional().nullable(),
  issuedInvoiceId: z.string().optional().nullable(),
});

// ===========================================
// GET /api/conciliation — Llistar conciliacions
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;

    const [conciliations, total] = await Promise.all([
      prisma.conciliation.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          bankMovement: { select: { id: true, date: true, description: true, amount: true, type: true } },
          receivedInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, supplier: { select: { name: true } } } },
          issuedInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, client: { select: { name: true } } } },
        },
      }),
      prisma.conciliation.count({ where }),
    ]);

    res.json({
      data: conciliations,
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
// POST /api/conciliation/auto — Auto-conciliació
// ===========================================
router.post('/auto', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    // Buscar moviments no conciliats
    const unconciliated = await prisma.bankMovement.findMany({
      where: { isConciliated: false },
    });

    let matched = 0;

    for (const movement of unconciliated) {
      const absAmount = Math.abs(parseFloat(movement.amount));
      const tolerance = 0.01; // 1 cèntim de tolerància

      let invoice = null;
      let invoiceType = null;

      if (movement.type === 'EXPENSE') {
        // Buscar factura rebuda amb import coincident
        invoice = await prisma.receivedInvoice.findFirst({
          where: {
            totalAmount: {
              gte: absAmount - tolerance,
              lte: absAmount + tolerance,
            },
            status: { in: ['PENDING', 'APPROVED'] },
            conciliations: { none: {} },
          },
        });
        invoiceType = 'received';
      } else if (movement.type === 'INCOME') {
        // Buscar factura emesa amb import coincident
        invoice = await prisma.issuedInvoice.findFirst({
          where: {
            totalAmount: {
              gte: absAmount - tolerance,
              lte: absAmount + tolerance,
            },
            status: { in: ['PENDING', 'APPROVED'] },
            conciliations: { none: {} },
          },
        });
        invoiceType = 'issued';
      }

      if (invoice) {
        // Crear conciliació
        await prisma.$transaction([
          prisma.conciliation.create({
            data: {
              bankMovementId: movement.id,
              receivedInvoiceId: invoiceType === 'received' ? invoice.id : null,
              issuedInvoiceId: invoiceType === 'issued' ? invoice.id : null,
              status: 'AUTO_MATCHED',
              confidence: 0.95,
              matchReason: `Import coincident: ${absAmount}€`,
            },
          }),
          prisma.bankMovement.update({
            where: { id: movement.id },
            data: { isConciliated: true },
          }),
        ]);

        matched++;
        logger.info(`Auto-conciliació: moviment ${movement.id} → ${invoiceType} invoice ${invoice.id}`);
      }
    }

    res.json({
      message: `Conciliació automàtica completada`,
      processed: unconciliated.length,
      matched,
      unmatched: unconciliated.length - matched,
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/conciliation/manual — Conciliació manual
// ===========================================
router.post('/manual', authorize('ADMIN', 'EDITOR'), validate(manualMatchSchema), async (req, res, next) => {
  try {
    const { bankMovementId, receivedInvoiceId, issuedInvoiceId } = req.body;

    if (!receivedInvoiceId && !issuedInvoiceId) {
      return res.status(400).json({ error: 'Cal indicar una factura (rebuda o emesa)' });
    }

    const conciliation = await prisma.$transaction(async (tx) => {
      const conc = await tx.conciliation.create({
        data: {
          bankMovementId,
          receivedInvoiceId: receivedInvoiceId || null,
          issuedInvoiceId: issuedInvoiceId || null,
          status: 'MANUAL_MATCHED',
          confirmedBy: req.user.id,
          confirmedAt: new Date(),
        },
      });

      await tx.bankMovement.update({
        where: { id: bankMovementId },
        data: { isConciliated: true },
      });

      return conc;
    });

    res.status(201).json(conciliation);
  } catch (error) {
    if (error.code === 'P2003') {
      return res.status(400).json({ error: 'Moviment o factura no trobats' });
    }
    next(error);
  }
});

// ===========================================
// PATCH /api/conciliation/:id/confirm — Confirmar conciliació
// ===========================================
router.patch('/:id/confirm', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const conciliation = await prisma.conciliation.update({
      where: { id: req.params.id },
      data: {
        status: 'CONFIRMED',
        confirmedBy: req.user.id,
        confirmedAt: new Date(),
      },
    });

    res.json(conciliation);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Conciliació no trobada' });
    }
    next(error);
  }
});

// ===========================================
// PATCH /api/conciliation/:id/reject — Rebutjar conciliació
// ===========================================
router.patch('/:id/reject', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const conciliation = await prisma.conciliation.findUnique({
      where: { id: req.params.id },
    });

    if (!conciliation) {
      return res.status(404).json({ error: 'Conciliació no trobada' });
    }

    await prisma.$transaction([
      prisma.conciliation.update({
        where: { id: req.params.id },
        data: { status: 'REJECTED' },
      }),
      prisma.bankMovement.update({
        where: { id: conciliation.bankMovementId },
        data: { isConciliated: false },
      }),
    ]);

    res.json({ message: 'Conciliació rebutjada' });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// DELETE /api/conciliation/:id — Eliminar conciliació
// ===========================================
router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const conciliation = await prisma.conciliation.findUnique({
      where: { id: req.params.id },
    });

    if (!conciliation) {
      return res.status(404).json({ error: 'Conciliació no trobada' });
    }

    await prisma.$transaction([
      prisma.conciliation.delete({ where: { id: req.params.id } }),
      prisma.bankMovement.update({
        where: { id: conciliation.bankMovementId },
        data: { isConciliated: false },
      }),
    ]);

    res.json({ message: 'Conciliació eliminada' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
