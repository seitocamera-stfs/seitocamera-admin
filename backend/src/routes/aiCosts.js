const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const aiCostTracker = require('../services/aiCostTracker');
const { logger } = require('../config/logger');

const router = express.Router();

router.use(authenticate);

// Només admins poden veure els costos
router.use(authorize('ADMIN'));

/**
 * GET /api/ai-costs/summary?year=2026&month=4
 * Retorna el resum mensual de costos IA.
 */
router.get('/summary', async (req, res, next) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);

    if (month < 1 || month > 12 || year < 2024 || year > 2100) {
      return res.status(400).json({ error: 'Any o mes invàlid' });
    }

    const summary = await aiCostTracker.getMonthlySummary(year, month);
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/ai-costs/pricing
 * Retorna els preus actuals per model.
 */
router.get('/pricing', (req, res) => {
  res.json(aiCostTracker.PRICING);
});

/**
 * GET /api/ai-costs/overview
 * Resum ràpid dels últims 6 mesos per al dashboard.
 */
router.get('/overview', async (req, res, next) => {
  try {
    const now = new Date();
    const months = [];

    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const summary = await aiCostTracker.getMonthlySummary(d.getFullYear(), d.getMonth() + 1);
      months.push({
        period: summary.period,
        calls: summary.total.calls,
        costUsd: summary.total.costUsd,
        inputTokens: summary.total.inputTokens,
        outputTokens: summary.total.outputTokens,
      });
    }

    res.json({ months: months.reverse() });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
