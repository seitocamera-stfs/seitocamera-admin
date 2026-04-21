const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireSection, requireLevel } = require('../middleware/sectionAccess');
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

const multiMatchSchema = z.object({
  bankMovementId: z.string().min(1),
  invoices: z.array(z.object({
    id: z.string().min(1),
    type: z.enum(['received', 'issued']),
  })).min(1).max(20),
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
        orderBy: { bankMovement: { date: 'desc' } },
        include: {
          bankMovement: { select: { id: true, date: true, description: true, amount: true, type: true } },
          receivedInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, gdriveFileId: true, filePath: true, supplier: { select: { name: true } } } },
          issuedInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, filePath: true, client: { select: { name: true } } } },
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
    // 1. Marcar transferències INTERNES com a conciliades automàticament (no necessiten factura)
    // IMPORTANT: operationType='transfer' NO vol dir interna — inclou pagaments a proveïdors!
    // Només descartem les que van entre comptes propis (SEITO CAMERA) o diuen "Internal transfer"
    const internalTransfers = await prisma.bankMovement.findMany({
      where: {
        isConciliated: false,
        OR: [
          { description: { contains: 'Internal transfer', mode: 'insensitive' } },
          { counterparty: { contains: 'SEITO CAMERA', mode: 'insensitive' } },
        ],
      },
    });

    let dismissedTransfers = 0;
    for (const t of internalTransfers) {
      await prisma.bankMovement.update({
        where: { id: t.id },
        data: { isConciliated: true },
      });
      dismissedTransfers++;
    }
    if (dismissedTransfers > 0) {
      logger.info(`Auto-conciliació: ${dismissedTransfers} transferències internes descartades`);
    }

    // 1b. Reparar inconsistències: conciliacions existents on la factura encara no està PAID
    const inconsistentConciliations = await prisma.conciliation.findMany({
      where: {
        status: { in: ['CONFIRMED', 'AUTO_MATCHED', 'MANUAL_MATCHED'] },
        OR: [
          { receivedInvoice: { status: { not: 'PAID' } } },
          { issuedInvoice: { status: { not: 'PAID' } } },
        ],
      },
      include: {
        receivedInvoice: { select: { id: true, invoiceNumber: true, status: true } },
        issuedInvoice: { select: { id: true, invoiceNumber: true, status: true } },
      },
    });

    let repairedInvoices = 0;
    for (const conc of inconsistentConciliations) {
      if (conc.receivedInvoice && conc.receivedInvoice.status !== 'PAID') {
        await prisma.receivedInvoice.update({
          where: { id: conc.receivedInvoice.id },
          data: { status: 'PAID' },
        });
        repairedInvoices++;
        logger.info(`Reparació: factura rebuda ${conc.receivedInvoice.invoiceNumber} marcada com PAID (conciliació ${conc.id})`);
      }
      if (conc.issuedInvoice && conc.issuedInvoice.status !== 'PAID') {
        await prisma.issuedInvoice.update({
          where: { id: conc.issuedInvoice.id },
          data: { status: 'PAID' },
        });
        repairedInvoices++;
        logger.info(`Reparació: factura emesa ${conc.issuedInvoice.invoiceNumber} marcada com PAID (conciliació ${conc.id})`);
      }
    }
    if (repairedInvoices > 0) {
      logger.info(`Auto-conciliació: ${repairedInvoices} factures reparades (tenien conciliació però status != PAID)`);
    }

    // 2. Buscar moviments no conciliats restants (incloent transfers a proveïdors)
    const unconciliated = await prisma.bankMovement.findMany({
      where: {
        isConciliated: false,
        NOT: [
          { description: { contains: 'Internal transfer', mode: 'insensitive' } },
          { counterparty: { contains: 'SEITO CAMERA', mode: 'insensitive' } },
        ],
      },
      orderBy: { date: 'desc' },
    });

    // 2b. Buscar moviments "orfes": isConciliated=true però SENSE registre Conciliation vinculat a factura
    // Això passa quan un moviment es va marcar com conciliat (ex: transfer a proveïdor) però no s'hi va vincular factura
    const orphanedMovements = await prisma.bankMovement.findMany({
      where: {
        isConciliated: true,
        conciliations: { none: {} },
        NOT: [
          { description: { contains: 'Internal transfer', mode: 'insensitive' } },
          { counterparty: { contains: 'SEITO CAMERA', mode: 'insensitive' } },
        ],
      },
      orderBy: { date: 'desc' },
    });

    if (orphanedMovements.length > 0) {
      logger.info(`Auto-conciliació: ${orphanedMovements.length} moviments orfes trobats (isConciliated=true sense Conciliation)`);
    }

    // Combinar els dos conjunts per processar-los tots
    const allToProcess = [...unconciliated, ...orphanedMovements];

    let matched = 0;
    let autoConfirmed = 0;
    const details = [];

    for (const movement of allToProcess) {
      const absAmount = Math.abs(parseFloat(movement.amount));
      const tolerance = 0.02; // 2 cèntims de tolerància
      const counterparty = (movement.counterparty || '').toLowerCase();

      let bestMatch = null;
      let bestConfidence = 0;
      let bestType = null;
      let matchReason = '';

      if (movement.type === 'EXPENSE' || parseFloat(movement.amount) < 0) {
        // DESPESA → buscar factura rebuda
        const candidates = await prisma.receivedInvoice.findMany({
          where: {
            totalAmount: { gte: absAmount - tolerance, lte: absAmount + tolerance },
            conciliations: { none: {} },
            deletedAt: null,
            isDuplicate: false,
            status: { notIn: ['NOT_INVOICE'] },
          },
          include: { supplier: { select: { name: true } } },
        });

        for (const inv of candidates) {
          let confidence = 0.5; // Base: import coincident
          const reasons = [`Import: ${absAmount}€`];

          // Bonus per nom del proveïdor coincident amb counterparty
          const supplierName = (inv.supplier?.name || '').toLowerCase();
          if (supplierName && counterparty) {
            const supplierWords = supplierName.split(/[\s,.\-]+/).filter(w => w.length > 2);
            const counterWords = counterparty.split(/[\s,.\-]+/).filter(w => w.length > 2);
            const matchingWords = supplierWords.filter(w => counterWords.some(cw => cw.includes(w) || w.includes(cw)));

            if (matchingWords.length >= 2) {
              confidence += 0.4;
              reasons.push(`Proveïdor: ${inv.supplier.name}`);
            } else if (matchingWords.length >= 1) {
              confidence += 0.2;
              reasons.push(`Proveïdor parcial: ${inv.supplier.name}`);
            }
          }

          // Bonus per data propera (±7 dies)
          const daysDiff = Math.abs((new Date(movement.date) - new Date(inv.issueDate)) / (1000 * 86400));
          if (daysDiff <= 7) {
            confidence += 0.1;
            reasons.push(`Data propera (${Math.round(daysDiff)}d)`);
          }

          if (confidence > bestConfidence) {
            bestMatch = inv;
            bestConfidence = confidence;
            bestType = 'received';
            matchReason = reasons.join(' + ');
          }
        }
      }

      if (movement.type === 'INCOME' || parseFloat(movement.amount) > 0) {
        // INGRÉS → buscar factura emesa
        const candidates = await prisma.issuedInvoice.findMany({
          where: {
            totalAmount: { gte: absAmount - tolerance, lte: absAmount + tolerance },
            conciliations: { none: {} },
          },
          include: { client: { select: { name: true } } },
        });

        for (const inv of candidates) {
          let confidence = 0.5;
          const reasons = [`Import: ${absAmount}€`];

          // Bonus per nom del client coincident amb counterparty
          const clientName = (inv.client?.name || '').toLowerCase();
          if (clientName && counterparty) {
            const clientWords = clientName.split(/[\s,.\-]+/).filter(w => w.length > 2);
            const counterWords = counterparty.split(/[\s,.\-]+/).filter(w => w.length > 2);
            const matchingWords = clientWords.filter(w => counterWords.some(cw => cw.includes(w) || w.includes(cw)));

            if (matchingWords.length >= 2) {
              confidence += 0.4;
              reasons.push(`Client: ${inv.client.name}`);
            } else if (matchingWords.length >= 1) {
              confidence += 0.2;
              reasons.push(`Client parcial: ${inv.client.name}`);
            }
          }

          // Bonus per data propera
          const daysDiff = Math.abs((new Date(movement.date) - new Date(inv.issueDate)) / (1000 * 86400));
          if (daysDiff <= 7) {
            confidence += 0.1;
            reasons.push(`Data propera (${Math.round(daysDiff)}d)`);
          }

          if (confidence > bestConfidence) {
            bestMatch = inv;
            bestConfidence = confidence;
            bestType = 'issued';
            matchReason = reasons.join(' + ');
          }
        }
      }

      // Només crear conciliació si la confiança és >= 0.5 (mínim import coincident)
      if (bestMatch && bestConfidence >= 0.5) {
        try {
          // >= 90% confiança → confirmar directament (sense supervisió)
          const autoConfirm = bestConfidence >= 0.9;

          await prisma.$transaction(async (tx) => {
            await tx.conciliation.create({
              data: {
                bankMovementId: movement.id,
                receivedInvoiceId: bestType === 'received' ? bestMatch.id : null,
                issuedInvoiceId: bestType === 'issued' ? bestMatch.id : null,
                status: autoConfirm ? 'CONFIRMED' : 'AUTO_MATCHED',
                confidence: Math.round(bestConfidence * 100) / 100,
                matchReason: autoConfirm ? `${matchReason} [auto-confirmat ≥90%]` : matchReason,
                ...(autoConfirm ? { confirmedAt: new Date() } : {}),
              },
            });
            await tx.bankMovement.update({
              where: { id: movement.id },
              data: { isConciliated: true },
            });
            // Marcar la factura com a PAID
            if (bestType === 'received') {
              await tx.receivedInvoice.update({ where: { id: bestMatch.id }, data: { status: 'PAID' } });
            } else {
              await tx.issuedInvoice.update({ where: { id: bestMatch.id }, data: { status: 'PAID' } });
            }
          });

          matched++;
          if (autoConfirm) autoConfirmed++;
          details.push({
            movement: `${movement.counterparty} (${absAmount}€)`,
            invoice: bestMatch.invoiceNumber,
            type: bestType,
            confidence: Math.round(bestConfidence * 100) + '%',
            reason: matchReason,
            autoConfirmed,
          });
        } catch (concErr) {
          // Pot fallar si ja existeix la conciliació
          logger.warn(`Conciliació duplicada: ${concErr.message}`);
        }
      }
    }

    logger.info(`Auto-conciliació: ${matched} de ${allToProcess.length} moviments conciliats (${orphanedMovements.length} orfes recuperats)`);

    res.json({
      message: `Conciliació automàtica completada`,
      processed: allToProcess.length,
      matched,
      autoConfirmed,
      pendingReview: matched - autoConfirmed,
      unmatched: allToProcess.length - matched,
      orphanedRecovered: orphanedMovements.length,
      repairedInvoices,
      dismissedTransfers,
      details: details.slice(0, 50),
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

      // Marcar la factura com a PAID
      if (receivedInvoiceId) {
        await tx.receivedInvoice.update({
          where: { id: receivedInvoiceId },
          data: { status: 'PAID' },
        });
      }
      if (issuedInvoiceId) {
        await tx.issuedInvoice.update({
          where: { id: issuedInvoiceId },
          data: { status: 'PAID' },
        });
      }

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
// POST /api/conciliation/multi — Conciliar un moviment amb múltiples factures
// Un sol pagament bancari pot cobrir 2 o més factures.
// ===========================================
router.post('/multi', authorize('ADMIN', 'EDITOR'), validate(multiMatchSchema), async (req, res, next) => {
  try {
    const { bankMovementId, invoices } = req.body;

    const conciliations = await prisma.$transaction(async (tx) => {
      const results = [];

      for (const inv of invoices) {
        const conc = await tx.conciliation.create({
          data: {
            bankMovementId,
            receivedInvoiceId: inv.type === 'received' ? inv.id : null,
            issuedInvoiceId: inv.type === 'issued' ? inv.id : null,
            status: 'MANUAL_MATCHED',
            matchReason: `Multi-match: ${invoices.length} factures per 1 moviment`,
            confirmedBy: req.user.id,
            confirmedAt: new Date(),
          },
        });
        results.push(conc);

        // Marcar cada factura com a PAID
        if (inv.type === 'received') {
          await tx.receivedInvoice.update({ where: { id: inv.id }, data: { status: 'PAID' } });
        } else if (inv.type === 'issued') {
          await tx.issuedInvoice.update({ where: { id: inv.id }, data: { status: 'PAID' } });
        }
      }

      await tx.bankMovement.update({
        where: { id: bankMovementId },
        data: { isConciliated: true },
      });

      return results;
    });

    res.status(201).json({ matched: conciliations.length, conciliations });
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
    const conciliation = await prisma.$transaction(async (tx) => {
      const conc = await tx.conciliation.update({
        where: { id: req.params.id },
        data: {
          status: 'CONFIRMED',
          confirmedBy: req.user.id,
          confirmedAt: new Date(),
        },
      });

      // Marcar la factura com a PAID si encara no ho està
      if (conc.receivedInvoiceId) {
        await tx.receivedInvoice.updateMany({
          where: { id: conc.receivedInvoiceId, status: { not: 'PAID' } },
          data: { status: 'PAID' },
        });
      }
      if (conc.issuedInvoiceId) {
        await tx.issuedInvoice.updateMany({
          where: { id: conc.issuedInvoiceId, status: { not: 'PAID' } },
          data: { status: 'PAID' },
        });
      }

      return conc;
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

    // Rebutjar: desvincula la factura però manté la conciliació a la llista
    await prisma.$transaction([
      prisma.conciliation.update({
        where: { id: req.params.id },
        data: {
          status: 'REJECTED',
          receivedInvoiceId: null,
          issuedInvoiceId: null,
          confidence: null,
          matchReason: null,
        },
      }),
      prisma.bankMovement.update({
        where: { id: conciliation.bankMovementId },
        data: { isConciliated: false },
      }),
    ]);

    res.json({
      message: 'Conciliació rebutjada — factura desvinculada',
      bankMovementId: conciliation.bankMovementId,
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// PUT /api/conciliation/:id/reassign — Reassignar factura a conciliació rebutjada
// ===========================================
router.put('/:id/reassign', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { receivedInvoiceId, issuedInvoiceId } = req.body;

    if (!receivedInvoiceId && !issuedInvoiceId) {
      return res.status(400).json({ error: 'Cal indicar una factura' });
    }

    const conciliation = await prisma.conciliation.findUnique({
      where: { id: req.params.id },
    });

    if (!conciliation) {
      return res.status(404).json({ error: 'Conciliació no trobada' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.conciliation.update({
        where: { id: req.params.id },
        data: {
          status: 'MANUAL_MATCHED',
          receivedInvoiceId: receivedInvoiceId || null,
          issuedInvoiceId: issuedInvoiceId || null,
          confirmedBy: req.user.id,
          confirmedAt: new Date(),
          matchReason: 'Reassignació manual',
        },
      });
      await tx.bankMovement.update({
        where: { id: conciliation.bankMovementId },
        data: { isConciliated: true },
      });
      // Marcar la factura com a PAID
      if (receivedInvoiceId) {
        await tx.receivedInvoice.update({
          where: { id: receivedInvoiceId },
          data: { status: 'PAID' },
        });
      }
      if (issuedInvoiceId) {
        await tx.issuedInvoice.update({
          where: { id: issuedInvoiceId },
          data: { status: 'PAID' },
        });
      }
    });

    res.json({ message: 'Factura reassignada correctament' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Conciliació o factura no trobada' });
    }
    next(error);
  }
});

// ===========================================
// DELETE /api/conciliation/:id — Eliminar conciliació
// ===========================================
router.delete('/:id', requireLevel('conciliation', 'admin'), async (req, res, next) => {
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
