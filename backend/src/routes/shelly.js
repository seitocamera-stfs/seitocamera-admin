const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');
const shellyService = require('../services/shellyService');
const { logger } = require('../config/logger');

const router = express.Router();

router.use(authenticate);

// ===========================================
// Shelly Pro 3EM — Consum elèctric
// ===========================================

/**
 * GET /api/shelly/status
 * Estat de la connexió Shelly
 */
router.get('/status', async (req, res, next) => {
  try {
    const available = await shellyService.isAvailable();
    if (!available) {
      return res.json({ configured: false });
    }
    const status = await shellyService.testConnection();
    res.json({ configured: true, ...status });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shelly/consumption?from=2026-03-01&to=2026-03-31
 * Obtenir consum emmagatzemat per un rang de dates
 */
router.get('/consumption', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'Cal indicar from i to (YYYY-MM-DD)' });
    }
    const data = await shellyService.getConsumption(from, to);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shelly/consumption/monthly/:year/:month
 * Resum mensual amb desglossament diari
 */
router.get('/consumption/monthly/:year/:month', async (req, res, next) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month) - 1; // JS months 0-based

    const from = new Date(year, month, 1);
    const to = new Date(year, month + 1, 0); // Últim dia del mes

    const data = await shellyService.getConsumption(from, to);
    res.json({
      year,
      month: month + 1,
      daysInMonth: to.getDate(),
      ...data,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shelly/suggest-split?from=&to=&totalKwh=
 * Suggeriment de repartiment basat en dades Shelly
 */
router.get('/suggest-split', async (req, res, next) => {
  try {
    const { from, to, totalKwh } = req.query;
    if (!from || !to || !totalKwh) {
      return res.status(400).json({
        error: 'Cal indicar from, to (YYYY-MM-DD) i totalKwh (de la factura)',
      });
    }
    const suggestion = await shellyService.suggestSplit(from, to, parseFloat(totalKwh));
    res.json(suggestion);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/shelly/sync
 * Sincronització manual (admin)
 */
router.post('/sync', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { runShellySync } = require('../jobs/shellySyncJob');
    const result = await runShellySync(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/shelly/sync-range
 * Sincronitzar un rang de dates específic (admin)
 */
router.post('/sync-range', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) {
      return res.status(400).json({ error: 'Cal indicar from i to (YYYY-MM-DD)' });
    }
    const results = await shellyService.syncDateRange(new Date(from), new Date(to));
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
