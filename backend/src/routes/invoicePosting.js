/**
 * Endpoints de comptabilització de factures (Sprint 3).
 *
 * En un fitxer separat de `routes/invoices.js` (2500+ línies) per no engreixar-lo
 * més. Munta a /api/invoice-posting.
 */
const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../middleware/auth');
const { requireSection, requireLevel } = require('../middleware/sectionAccess');
const { logAudit } = require('../services/auditService');
const invoicePostingService = require('../services/invoicePostingService');
const accountingAgent = require('../services/accountingAgentService');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('accounting'));

// ===========================================
// POST /received/:id/post — Comptabilitzar factura rebuda
// ===========================================
router.post('/received/:id/post', requireLevel('accounting', 'write'), async (req, res) => {
  try {
    const result = await invoicePostingService.postReceivedInvoice(req.params.id, {
      userId: req.user.id,
      agent: accountingAgent,
    });
    await logAudit(req, {
      entityType: 'ReceivedInvoice',
      entityId: req.params.id,
      action: 'POST',
      after: { journalEntryId: result.journalEntry.id, accountId: result.invoice.accountId, resolvedByAgent: result.resolvedByAgent },
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===========================================
// POST /received/:id/unpost — Desfer comptabilització (anul·la l'assentament)
// ===========================================
router.post('/received/:id/unpost', requireLevel('accounting', 'admin'), async (req, res) => {
  try {
    const updated = await invoicePostingService.unpostInvoice('RECEIVED', req.params.id, {
      userId: req.user.id,
      reason: req.body?.reason,
    });
    await logAudit(req, {
      entityType: 'ReceivedInvoice',
      entityId: req.params.id,
      action: 'UNPOST',
      after: { journalEntryId: null },
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===========================================
// POST /received/post-bulk — Comptabilitzar massiva (de l'objecte filter o ids)
// ===========================================
const bulkSchema = z.object({
  ids: z.array(z.string()).optional(),
  // O filtres per resoldre la llista al servidor:
  status: z.enum(['REVIEWED', 'APPROVED']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
}).refine((d) => d.ids?.length || d.status, { message: 'Cal indicar ids o status+rang de dates' });

router.post('/received/post-bulk', requireLevel('accounting', 'write'), async (req, res) => {
  try {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Paràmetres invàlids' });
    const { ids, status, from, to } = parsed.data;

    const { prisma } = require('../config/database');
    const where = {
      deletedAt: null,
      journalEntryId: null,
      origin: { not: 'LOGISTIK' },
    };
    if (ids?.length) {
      where.id = { in: ids };
    } else {
      if (status) where.status = status;
      if (from || to) where.issueDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };
    }

    const candidates = await prisma.receivedInvoice.findMany({ where, select: { id: true, invoiceNumber: true } });

    const results = { ok: [], failed: [] };
    for (const inv of candidates) {
      try {
        const r = await invoicePostingService.postReceivedInvoice(inv.id, {
          userId: req.user.id,
          agent: accountingAgent,
        });
        results.ok.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, journalEntryId: r.journalEntry.id, resolvedByAgent: r.resolvedByAgent });
      } catch (e) {
        results.failed.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, error: e.message });
      }
    }

    await logAudit(req, {
      entityType: 'ReceivedInvoice',
      entityId: 'bulk',
      action: 'POST_BULK',
      after: { processed: candidates.length, ok: results.ok.length, failed: results.failed.length },
    });

    res.json({ total: candidates.length, ...results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===========================================
// POST /issued/:id/post — Comptabilitzar factura emesa
// ===========================================
router.post('/issued/:id/post', requireLevel('accounting', 'write'), async (req, res) => {
  try {
    const result = await invoicePostingService.postIssuedInvoice(req.params.id, {
      userId: req.user.id,
    });
    await logAudit(req, {
      entityType: 'IssuedInvoice',
      entityId: req.params.id,
      action: 'POST',
      after: { journalEntryId: result.journalEntry.id, accountId: result.invoice.accountId },
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/issued/:id/unpost', requireLevel('accounting', 'admin'), async (req, res) => {
  try {
    const updated = await invoicePostingService.unpostInvoice('ISSUED', req.params.id, {
      userId: req.user.id,
      reason: req.body?.reason,
    });
    await logAudit(req, {
      entityType: 'IssuedInvoice',
      entityId: req.params.id,
      action: 'UNPOST',
      after: { journalEntryId: null },
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/issued/post-bulk', requireLevel('accounting', 'write'), async (req, res) => {
  try {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Paràmetres invàlids' });
    const { ids, status, from, to } = parsed.data;

    const { prisma } = require('../config/database');
    const where = { journalEntryId: null };
    if (ids?.length) where.id = { in: ids };
    else {
      if (status) where.status = status;
      if (from || to) where.issueDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };
    }

    const candidates = await prisma.issuedInvoice.findMany({ where, select: { id: true, invoiceNumber: true } });

    const results = { ok: [], failed: [] };
    for (const inv of candidates) {
      try {
        const r = await invoicePostingService.postIssuedInvoice(inv.id, { userId: req.user.id });
        results.ok.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, journalEntryId: r.journalEntry.id });
      } catch (e) {
        results.failed.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, error: e.message });
      }
    }

    await logAudit(req, {
      entityType: 'IssuedInvoice',
      entityId: 'bulk',
      action: 'POST_BULK',
      after: { processed: candidates.length, ok: results.ok.length, failed: results.failed.length },
    });

    res.json({ total: candidates.length, ...results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
