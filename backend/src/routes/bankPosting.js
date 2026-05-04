/**
 * Endpoints de comptabilització de moviments bancaris (Sprint 4).
 *
 * En un fitxer separat per no inflar routes/bank.js. Munta a /api/bank-posting.
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireSection, requireLevel } = require('../middleware/sectionAccess');
const { logAudit } = require('../services/auditService');
const bankPostingService = require('../services/bankPostingService');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('accounting'));

// POST /movement/:id/post — Comptabilitza un moviment (ha de tenir conciliació CONFIRMED)
router.post('/movement/:id/post', requireLevel('accounting', 'write'), async (req, res) => {
  try {
    const result = await bankPostingService.postBankMovement(req.params.id, req.user.id);
    await logAudit(req, {
      entityType: 'BankMovement',
      entityId: req.params.id,
      action: 'POST',
      after: { journalEntryId: result.journalEntry.id },
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /movement/:id/unpost — Anul·la la comptabilització
router.post('/movement/:id/unpost', requireLevel('accounting', 'admin'), async (req, res) => {
  try {
    const updated = await bankPostingService.unpostBankMovement(req.params.id, req.user.id, req.body?.reason);
    await logAudit(req, {
      entityType: 'BankMovement',
      entityId: req.params.id,
      action: 'UNPOST',
      after: { journalEntryId: null },
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /post-bulk — Comptabilitza tots els moviments amb conciliacions CONFIRMED
//                  d'un rang de dates (per neteja periòdica)
router.post('/post-bulk', requireLevel('accounting', 'write'), async (req, res) => {
  try {
    const { from, to, ids } = req.body || {};
    const { prisma } = require('../config/database');
    const where = {
      journalEntryId: null,
      isDismissed: false,
      conciliations: { some: { status: 'CONFIRMED' } },
    };
    if (ids?.length) where.id = { in: ids };
    else if (from || to) where.date = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };
    else return res.status(400).json({ error: 'Cal indicar ids o rang de dates' });

    const candidates = await prisma.bankMovement.findMany({ where, select: { id: true, description: true } });
    const results = { ok: [], failed: [] };
    for (const m of candidates) {
      try {
        const r = await bankPostingService.postBankMovement(m.id, req.user.id);
        results.ok.push({ movementId: m.id, journalEntryId: r.journalEntry.id });
      } catch (e) {
        results.failed.push({ movementId: m.id, description: m.description?.slice(0, 80), error: e.message });
      }
    }
    await logAudit(req, {
      entityType: 'BankMovement',
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
