/**
 * Endpoints del tancament d'exercici (Sprint 7).
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireSection, requireLevel } = require('../middleware/sectionAccess');
const { logAudit } = require('../services/auditService');
const closingService = require('../services/closingService');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('accounting'));

router.get('/:year/checklist', async (req, res) => {
  try {
    const data = await closingService.getChecklist(parseInt(req.params.year, 10));
    res.json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:year/regularize-vat', requireLevel('accounting', 'admin'), async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    const entry = await closingService.regularizeVat(year, req.user.id);
    await logAudit(req, { entityType: 'FiscalYear', entityId: String(year), action: 'REGULARIZE_VAT', after: { journalEntryId: entry.id } });
    res.json(entry);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/:year/corporate-tax-preview', async (req, res) => {
  try {
    const data = await closingService.previewCorporateTax(parseInt(req.params.year, 10));
    res.json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:year/post-corporate-tax', requireLevel('accounting', 'admin'), async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    const result = await closingService.postCorporateTax(year, req.user.id, req.body || {});
    await logAudit(req, {
      entityType: 'FiscalYear', entityId: String(year), action: 'POST_IS',
      after: { journalEntryId: result.journalEntry.id, finalTax: result.preview.finalTax },
    });
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:year/close', requireLevel('accounting', 'admin'), async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    const result = await closingService.closeYear(year, req.user.id);
    await logAudit(req, {
      entityType: 'FiscalYear', entityId: result.fiscalYear.id, action: 'CLOSE',
      after: { journalEntryId: result.closingEntry.id, netResult: result.netResult },
    });
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:year/open-next', requireLevel('accounting', 'admin'), async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    const result = await closingService.openNextYear(year, req.user.id);
    await logAudit(req, {
      entityType: 'FiscalYear', entityId: result.fiscalYear.id, action: 'OPEN_NEXT',
      after: { journalEntryId: result.openingEntry.id },
    });
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
