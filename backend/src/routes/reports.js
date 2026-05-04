/**
 * Endpoints d'informes financers (Sprint 8).
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');
const { getBalanceSheet, getProfitAndLoss } = require('../services/financialReportsService');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('accounting'));

router.get('/balance-sheet', async (req, res) => {
  try {
    const data = await getBalanceSheet({
      companyId: req.query.companyId,
      atDate: req.query.atDate || new Date().toISOString(),
      compareDate: req.query.compareDate || null,
    });
    res.json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/profit-loss', async (req, res) => {
  try {
    const data = await getProfitAndLoss({
      companyId: req.query.companyId,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      compareFromDate: req.query.compareFromDate || null,
      compareToDate: req.query.compareToDate || null,
    });
    res.json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
