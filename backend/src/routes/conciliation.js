const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireSection, requireLevel } = require('../middleware/sectionAccess');
const { logger } = require('../config/logger');
const { runAIConciliation } = require('../services/aiConciliationService');
const company = require('../config/company');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('conciliation'));

// ===========================================
// Helper: Auto-poblar memòria de contraparts
// Quan es confirma una conciliació, guardem la relació contrapart→proveïdor/client
// ===========================================
async function updateCounterpartyMemory(tx, bankMovementId, receivedInvoiceId, issuedInvoiceId) {
  try {
    const movement = await tx.bankMovement.findUnique({ where: { id: bankMovementId }, select: { counterparty: true } });
    if (!movement?.counterparty) return;

    const counterparty = movement.counterparty.trim();
    if (counterparty.length < 3) return;

    if (receivedInvoiceId) {
      const invoice = await tx.receivedInvoice.findUnique({ where: { id: receivedInvoiceId }, select: { supplierId: true } });
      if (invoice?.supplierId) {
        await tx.counterpartyMap.upsert({
          where: { counterparty_supplierId: { counterparty, supplierId: invoice.supplierId } },
          create: { counterparty, supplierId: invoice.supplierId, matchCount: 1, lastUsed: new Date() },
          update: { matchCount: { increment: 1 }, lastUsed: new Date() },
        });
      }
    }

    if (issuedInvoiceId) {
      const invoice = await tx.issuedInvoice.findUnique({ where: { id: issuedInvoiceId }, select: { clientId: true } });
      if (invoice?.clientId) {
        await tx.counterpartyMap.upsert({
          where: { counterparty_clientId: { counterparty, clientId: invoice.clientId } },
          create: { counterparty, clientId: invoice.clientId, matchCount: 1, lastUsed: new Date() },
          update: { matchCount: { increment: 1 }, lastUsed: new Date() },
        });
      }
    }
  } catch (err) {
    // No fallar la conciliació si la memòria falla
    logger.warn('Error actualitzant counterparty memory:', err.message);
  }
}

// ===========================================
// Helper: Actualitzar paidAmount i status de la factura
// Suporta pagaments parcials: si paidAmount < totalAmount → PARTIALLY_PAID
// ===========================================
async function updateInvoicePayment(tx, { receivedInvoiceId, issuedInvoiceId, paymentAmount }) {
  if (receivedInvoiceId) {
    const invoice = await tx.receivedInvoice.findUnique({
      where: { id: receivedInvoiceId },
      select: { totalAmount: true, paidAmount: true },
    });
    if (invoice) {
      const total = parseFloat(invoice.totalAmount);
      const newPaid = parseFloat(invoice.paidAmount) + (paymentAmount || total);
      const fullyPaid = newPaid >= total - 0.02; // tolerància de 2 cèntims
      await tx.receivedInvoice.update({
        where: { id: receivedInvoiceId },
        data: {
          paidAmount: Math.min(newPaid, total),
          status: fullyPaid ? 'PAID' : 'PARTIALLY_PAID',
        },
      });
    }
  }
  if (issuedInvoiceId) {
    const invoice = await tx.issuedInvoice.findUnique({
      where: { id: issuedInvoiceId },
      select: { totalAmount: true, paidAmount: true },
    });
    if (invoice) {
      const total = parseFloat(invoice.totalAmount);
      const newPaid = parseFloat(invoice.paidAmount) + (paymentAmount || total);
      const fullyPaid = newPaid >= total - 0.02;
      await tx.issuedInvoice.update({
        where: { id: issuedInvoiceId },
        data: {
          paidAmount: Math.min(newPaid, total),
          status: fullyPaid ? 'PAID' : 'PARTIALLY_PAID',
        },
      });
    }
  }
}

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
// GET /api/conciliation/counterparty-suggestions — Suggeriments basats en memòria
// Donat un counterparty, retorna els proveïdors/clients més freqüents
// ===========================================
router.get('/counterparty-suggestions', async (req, res, next) => {
  try {
    const { counterparty } = req.query;
    if (!counterparty || counterparty.trim().length < 3) {
      return res.json({ suppliers: [], clients: [] });
    }

    const cp = counterparty.trim();

    // Buscar coincidències exactes i parcials
    const maps = await prisma.counterpartyMap.findMany({
      where: {
        counterparty: { contains: cp, mode: 'insensitive' },
      },
      include: {
        supplier: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
      },
      orderBy: { matchCount: 'desc' },
      take: 10,
    });

    const suppliers = maps
      .filter(m => m.supplier)
      .map(m => ({ id: m.supplier.id, name: m.supplier.name, matchCount: m.matchCount, lastUsed: m.lastUsed }));
    const clients = maps
      .filter(m => m.client)
      .map(m => ({ id: m.client.id, name: m.client.name, matchCount: m.matchCount, lastUsed: m.lastUsed }));

    res.json({ suppliers, clients });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// GET /api/conciliation/commission-rules — Regles de comissions actives
// ===========================================
router.get('/commission-rules', async (req, res, next) => {
  try {
    const rules = await prisma.commissionRule.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json(rules);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// GET /api/conciliation/recurring-patterns — Patrons de pagaments recurrents
// Analitza moviments conciliats per trobar patrons: mateix counterparty + import similar + mensual
// ===========================================
router.get('/recurring-patterns', async (req, res, next) => {
  try {
    const { counterparty } = req.query;
    if (!counterparty || counterparty.trim().length < 3) {
      return res.json({ patterns: [] });
    }

    // Buscar moviments conciliats amb aquest contrapart
    const movements = await prisma.bankMovement.findMany({
      where: {
        isConciliated: true,
        counterparty: { contains: counterparty.trim(), mode: 'insensitive' },
      },
      select: { id: true, amount: true, date: true, counterparty: true },
      orderBy: { date: 'desc' },
      take: 24, // Últims 2 anys de moviments
    });

    if (movements.length < 3) {
      return res.json({ patterns: [] });
    }

    // Agrupar per import similar (±2%)
    const patterns = [];
    const used = new Set();

    for (let i = 0; i < movements.length; i++) {
      if (used.has(i)) continue;
      const baseAmt = Math.abs(parseFloat(movements[i].amount));
      const group = [movements[i]];
      used.add(i);

      for (let j = i + 1; j < movements.length; j++) {
        if (used.has(j)) continue;
        const amt = Math.abs(parseFloat(movements[j].amount));
        if (Math.abs(amt - baseAmt) / baseAmt < 0.02) {
          group.push(movements[j]);
          used.add(j);
        }
      }

      if (group.length >= 3) {
        // Comprovar si són mensuals (±5 dies de diferència entre consecutius)
        const dates = group.map(m => new Date(m.date)).sort((a, b) => a - b);
        let isMonthly = true;
        for (let k = 1; k < dates.length; k++) {
          const diffDays = (dates[k] - dates[k - 1]) / (1000 * 60 * 60 * 24);
          if (diffDays < 20 || diffDays > 40) { isMonthly = false; break; }
        }

        if (isMonthly) {
          const avgDay = Math.round(dates.reduce((s, d) => s + d.getDate(), 0) / dates.length);
          patterns.push({
            amount: baseAmt,
            occurrences: group.length,
            avgDayOfMonth: avgDay,
            lastDate: dates[dates.length - 1],
            isMonthly: true,
          });
        }
      }
    }

    res.json({ patterns });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// GET /api/conciliation — Llistar conciliacions
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;

    // Cerca per descripció del moviment, número de factura o nom proveïdor/client
    if (search) {
      where.OR = [
        { bankMovement: { description: { contains: search, mode: 'insensitive' } } },
        { bankMovement: { counterparty: { contains: search, mode: 'insensitive' } } },
        { receivedInvoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
        { receivedInvoice: { supplier: { name: { contains: search, mode: 'insensitive' } } } },
        { issuedInvoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
        { issuedInvoice: { client: { name: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [conciliations, total] = await Promise.all([
      prisma.conciliation.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { bankMovement: { date: 'desc' } },
        include: {
          bankMovement: { select: { id: true, date: true, description: true, amount: true, type: true, counterparty: true } },
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
          { counterparty: { contains: company.bankName, mode: 'insensitive' } },
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
          { counterparty: { contains: company.bankName, mode: 'insensitive' } },
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
          { counterparty: { contains: company.bankName, mode: 'insensitive' } },
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
          // >= 80% confiança → confirmar directament (sense supervisió)
          const autoConfirm = bestConfidence >= 0.8;

          await prisma.$transaction(async (tx) => {
            await tx.conciliation.create({
              data: {
                bankMovementId: movement.id,
                receivedInvoiceId: bestType === 'received' ? bestMatch.id : null,
                issuedInvoiceId: bestType === 'issued' ? bestMatch.id : null,
                status: autoConfirm ? 'CONFIRMED' : 'AUTO_MATCHED',
                confidence: Math.round(bestConfidence * 100) / 100,
                matchReason: autoConfirm ? `${matchReason} [auto-confirmat ≥80%]` : matchReason,
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
// POST /api/conciliation/recalculate — Esborrar AUTO_MATCHED i re-conciliar
// Esborra tots els suggeriments automàtics no confirmats, allibera moviments, i re-llança
// ===========================================
router.post('/recalculate', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    // 1. Trobar totes les AUTO_MATCHED (suggeriments pendents de revisió)
    const autoMatched = await prisma.conciliation.findMany({
      where: { status: 'AUTO_MATCHED' },
      select: { id: true, bankMovementId: true, receivedInvoiceId: true, issuedInvoiceId: true },
    });

    if (autoMatched.length === 0) {
      logger.info('Recalculate: cap AUTO_MATCHED trobada, llançant auto directament');
    } else {
      const movementIds = [...new Set(autoMatched.map(c => c.bankMovementId))];
      const receivedIds = [...new Set(autoMatched.filter(c => c.receivedInvoiceId).map(c => c.receivedInvoiceId))];
      const issuedIds = [...new Set(autoMatched.filter(c => c.issuedInvoiceId).map(c => c.issuedInvoiceId))];

      // Pas 1: Esborrar totes les AUTO_MATCHED d'un cop
      await prisma.conciliation.deleteMany({ where: { status: 'AUTO_MATCHED' } });

      // Pas 2: Trobar moviments que encara tenen conciliació confirmed (no alliberar)
      const movementsWithConfirmed = await prisma.conciliation.findMany({
        where: {
          bankMovementId: { in: movementIds },
          status: { in: ['CONFIRMED', 'MANUAL_MATCHED'] },
        },
        select: { bankMovementId: true },
      });
      const keepConciliatedIds = new Set(movementsWithConfirmed.map(c => c.bankMovementId));
      const toFreeIds = movementIds.filter(id => !keepConciliatedIds.has(id));

      // Pas 3: Alliberar moviments en bloc
      if (toFreeIds.length > 0) {
        await prisma.bankMovement.updateMany({
          where: { id: { in: toFreeIds } },
          data: { isConciliated: false },
        });
      }

      // Pas 4: Trobar factures que encara tenen conciliació confirmed (no revertir)
      if (receivedIds.length > 0) {
        const receivedWithConfirmed = await prisma.conciliation.findMany({
          where: {
            receivedInvoiceId: { in: receivedIds },
            status: { in: ['CONFIRMED', 'MANUAL_MATCHED'] },
          },
          select: { receivedInvoiceId: true },
        });
        const keepReceivedIds = new Set(receivedWithConfirmed.map(c => c.receivedInvoiceId));
        const toRevertReceived = receivedIds.filter(id => !keepReceivedIds.has(id));
        if (toRevertReceived.length > 0) {
          await prisma.receivedInvoice.updateMany({
            where: { id: { in: toRevertReceived } },
            data: { status: 'PENDING', paidAmount: 0 },
          });
        }
      }

      if (issuedIds.length > 0) {
        const issuedWithConfirmed = await prisma.conciliation.findMany({
          where: {
            issuedInvoiceId: { in: issuedIds },
            status: { in: ['CONFIRMED', 'MANUAL_MATCHED'] },
          },
          select: { issuedInvoiceId: true },
        });
        const keepIssuedIds = new Set(issuedWithConfirmed.map(c => c.issuedInvoiceId));
        const toRevertIssued = issuedIds.filter(id => !keepIssuedIds.has(id));
        if (toRevertIssued.length > 0) {
          await prisma.issuedInvoice.updateMany({
            where: { id: { in: toRevertIssued } },
            data: { status: 'PENDING', paidAmount: 0 },
          });
        }
      }

      logger.info(`Recalculate: ${autoMatched.length} AUTO_MATCHED esborrades, ${toFreeIds.length} moviments alliberats`);
    }

    // 3. Retornar resultat — el frontend farà la crida a /auto després
    res.json({
      message: `${autoMatched.length} suggeriments anteriors esborrats. Llança auto-conciliació per generar nous resultats.`,
      cleared: autoMatched.length,
    });
  } catch (error) {
    logger.error(`Recalculate error: ${error.message}`);
    next(error);
  }
});

// ===========================================
// POST /api/conciliation/ai-auto — Conciliació amb IA (Claude)
// ===========================================
router.post('/ai-auto', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { movementIds } = req.body || {};

    // 1. Recollir moviments — si s'envien IDs, només aquells; sinó, tots els no conciliats
    const whereMovements = {
      isConciliated: false,
      NOT: [
        { description: { contains: 'Internal transfer', mode: 'insensitive' } },
        { counterparty: { contains: company.bankName, mode: 'insensitive' } },
      ],
    };
    if (Array.isArray(movementIds) && movementIds.length > 0) {
      whereMovements.id = { in: movementIds };
    }

    const movements = await prisma.bankMovement.findMany({
      where: whereMovements,
      orderBy: { date: 'desc' },
    });

    if (movements.length === 0) {
      return res.json({
        message: 'No hi ha moviments pendents de conciliar',
        matched: 0,
        processed: 0,
      });
    }

    // 2. Recollir factures rebudes no conciliades
    const receivedInvoices = await prisma.receivedInvoice.findMany({
      where: {
        conciliations: { none: {} },
        deletedAt: null,
        isDuplicate: false,
        status: { notIn: ['NOT_INVOICE', 'PAID'] },
      },
      include: { supplier: { select: { name: true, nif: true } } },
      orderBy: { issueDate: 'desc' },
    });

    // 3. Recollir factures emeses no conciliades
    const issuedInvoices = await prisma.issuedInvoice.findMany({
      where: {
        conciliations: { none: {} },
        status: { not: 'PAID' },
      },
      include: { client: { select: { name: true, nif: true } } },
      orderBy: { issueDate: 'desc' },
    });

    if (receivedInvoices.length === 0 && issuedInvoices.length === 0) {
      return res.json({
        message: 'No hi ha factures pendents per conciliar',
        matched: 0,
        processed: movements.length,
      });
    }

    // 4. Cridar a Claude
    const aiResult = await runAIConciliation(movements, receivedInvoices, issuedInvoices);

    // 5. Crear les conciliacions a la BD
    let matched = 0;
    let autoConfirmed = 0;
    const details = [];

    for (const match of aiResult.matches) {
      try {
        const autoConfirm = match.confidence >= 0.80;

        await prisma.$transaction(async (tx) => {
          for (const inv of match.invoices) {
            await tx.conciliation.create({
              data: {
                bankMovementId: match.movementId,
                receivedInvoiceId: inv.type === 'received' ? inv.invoiceId : null,
                issuedInvoiceId: inv.type === 'issued' ? inv.invoiceId : null,
                status: autoConfirm ? 'CONFIRMED' : 'AUTO_MATCHED',
                confidence: match.confidence,
                matchReason: `[IA] ${match.reason}`,
                ...(autoConfirm ? { confirmedAt: new Date(), confirmedBy: req.user.id } : {}),
              },
            });

            // Marcar factura com PAID
            if (inv.type === 'received') {
              await tx.receivedInvoice.update({
                where: { id: inv.invoiceId },
                data: { status: 'PAID' },
              });
            } else {
              await tx.issuedInvoice.update({
                where: { id: inv.invoiceId },
                data: { status: 'PAID' },
              });
            }
          }

          await tx.bankMovement.update({
            where: { id: match.movementId },
            data: { isConciliated: true },
          });
        });

        matched++;
        if (autoConfirm) autoConfirmed++;

        details.push({
          movementId: match.movementId,
          invoices: match.invoices.map(i => i.invoiceId),
          confidence: Math.round(match.confidence * 100) + '%',
          reason: match.reason,
          autoConfirmed: autoConfirm,
        });
      } catch (concErr) {
        logger.warn(`Conciliació IA: error creant match ${match.movementId}: ${concErr.message}`);
      }
    }

    logger.info(`Conciliació IA completada: ${matched} matches de ${movements.length} moviments`);

    res.json({
      message: `Conciliació IA completada`,
      processed: aiResult.movementsSent,
      matched,
      autoConfirmed,
      pendingReview: matched - autoConfirmed,
      unmatched: aiResult.movementsSent - matched,
      noMatch: aiResult.noMatch?.length || 0,
      noMatchReasons: (aiResult.noMatch || []).slice(0, 20).map(n => ({
        movementId: n.movementId,
        reason: n.reason,
      })),
      summary: aiResult.summary,
      tokens: aiResult.tokens,
      details: details.slice(0, 50),
    });
  } catch (error) {
    logger.error(`Conciliació IA error: ${error.message}`);
    // Si és error de l'API, retornar 502
    if (error.message.includes('Claude API')) {
      return res.status(502).json({ error: `Error de la IA: ${error.message}` });
    }
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

      // Actualitzar paidAmount i status (suporta parcials)
      const movement = await tx.bankMovement.findUnique({ where: { id: bankMovementId }, select: { amount: true } });
      const paymentAmount = Math.abs(parseFloat(movement?.amount || 0));
      await updateInvoicePayment(tx, { receivedInvoiceId, issuedInvoiceId, paymentAmount });

      // Actualitzar memòria de contraparts
      await updateCounterpartyMemory(tx, bankMovementId, receivedInvoiceId, issuedInvoiceId);

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

        // Actualitzar paidAmount i status de cada factura (pagament total per defecte)
        await updateInvoicePayment(tx, {
          receivedInvoiceId: inv.type === 'received' ? inv.id : null,
          issuedInvoiceId: inv.type === 'issued' ? inv.id : null,
        });
      }

      await tx.bankMovement.update({
        where: { id: bankMovementId },
        data: { isConciliated: true },
      });

      // Actualitzar memòria de contraparts per cada factura
      for (const inv of invoices) {
        await updateCounterpartyMemory(
          tx, bankMovementId,
          inv.type === 'received' ? inv.id : null,
          inv.type === 'issued' ? inv.id : null
        );
      }

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

      // Actualitzar paidAmount i status
      const movement = await tx.bankMovement.findUnique({ where: { id: conc.bankMovementId }, select: { amount: true } });
      const paymentAmount = Math.abs(parseFloat(movement?.amount || 0));
      await updateInvoicePayment(tx, {
        receivedInvoiceId: conc.receivedInvoiceId,
        issuedInvoiceId: conc.issuedInvoiceId,
        paymentAmount,
      });

      // Actualitzar memòria de contraparts
      await updateCounterpartyMemory(tx, conc.bankMovementId, conc.receivedInvoiceId, conc.issuedInvoiceId);

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
// PATCH /api/conciliation/:id/undo — Desfer conciliació confirmada
// Elimina la conciliació, marca el moviment com no conciliat,
// i reverteix l'estat de la factura de PAID a PENDING.
// ===========================================
router.patch('/:id/undo', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const conciliation = await prisma.conciliation.findUnique({
      where: { id: req.params.id },
    });

    if (!conciliation) {
      return res.status(404).json({ error: 'Conciliació no trobada' });
    }

    await prisma.$transaction(async (tx) => {
      // Obtenir import del moviment per revertir paidAmount
      const movement = await tx.bankMovement.findUnique({ where: { id: conciliation.bankMovementId }, select: { amount: true } });
      const paymentAmount = Math.abs(parseFloat(movement?.amount || 0));

      // Revertir paidAmount i status de la factura
      if (conciliation.receivedInvoiceId) {
        const invoice = await tx.receivedInvoice.findUnique({
          where: { id: conciliation.receivedInvoiceId },
          select: { paidAmount: true },
        });
        if (invoice) {
          const newPaid = Math.max(0, parseFloat(invoice.paidAmount) - paymentAmount);
          await tx.receivedInvoice.update({
            where: { id: conciliation.receivedInvoiceId },
            data: {
              paidAmount: newPaid,
              status: newPaid > 0.02 ? 'PARTIALLY_PAID' : 'PENDING',
            },
          });
        }
      }
      if (conciliation.issuedInvoiceId) {
        const invoice = await tx.issuedInvoice.findUnique({
          where: { id: conciliation.issuedInvoiceId },
          select: { paidAmount: true },
        });
        if (invoice) {
          const newPaid = Math.max(0, parseFloat(invoice.paidAmount) - paymentAmount);
          await tx.issuedInvoice.update({
            where: { id: conciliation.issuedInvoiceId },
            data: {
              paidAmount: newPaid,
              status: newPaid > 0.02 ? 'PARTIALLY_PAID' : 'PENDING',
            },
          });
        }
      }

      // Eliminar la conciliació
      await tx.conciliation.delete({ where: { id: req.params.id } });

      // Marcar moviment com no conciliat
      await tx.bankMovement.update({
        where: { id: conciliation.bankMovementId },
        data: { isConciliated: false },
      });
    });

    logger.info(`Conciliació desfeta: ${req.params.id} per usuari ${req.user.id}`);

    res.json({
      message: 'Conciliació desfeta — moviment i factura tornats a pendents',
      bankMovementId: conciliation.bankMovementId,
    });
  } catch (error) {
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
