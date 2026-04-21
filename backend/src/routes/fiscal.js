const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');
const { logger } = require('../config/logger');
const {
  calculateModel303,
  calculateModel111,
  calculateModel347,
  calculateModel349,
  calculateQuarterSummary,
  calculateYearSummary,
} = require('../services/fiscalService');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('fiscal'));

// ===========================================
// GET /api/fiscal/summary — Resum anual
// ===========================================
router.get('/summary', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const summary = await calculateYearSummary(year);
    res.json(summary);
  } catch (error) {
    logger.error(`Fiscal summary error: ${error.message}`);
    next(error);
  }
});

// ===========================================
// GET /api/fiscal/303 — Model 303 (IVA)
// ===========================================
router.get('/303', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const quarter = parseInt(req.query.quarter) || Math.ceil((new Date().getMonth() + 1) / 3);
    const data = await calculateModel303(year, quarter);
    res.json(data);
  } catch (error) {
    logger.error(`Model 303 error: ${error.message}`);
    next(error);
  }
});

// ===========================================
// GET /api/fiscal/111 — Model 111 (IRPF)
// ===========================================
router.get('/111', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const quarter = parseInt(req.query.quarter) || Math.ceil((new Date().getMonth() + 1) / 3);
    const data = await calculateModel111(year, quarter);
    res.json(data);
  } catch (error) {
    logger.error(`Model 111 error: ${error.message}`);
    next(error);
  }
});

// ===========================================
// GET /api/fiscal/347 — Model 347 (tercers)
// ===========================================
router.get('/347', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const data = await calculateModel347(year);
    res.json(data);
  } catch (error) {
    logger.error(`Model 347 error: ${error.message}`);
    next(error);
  }
});

// ===========================================
// GET /api/fiscal/349 — Model 349 (intracomunitàries)
// ===========================================
router.get('/349', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const quarter = parseInt(req.query.quarter) || Math.ceil((new Date().getMonth() + 1) / 3);
    const data = await calculateModel349(year, quarter);
    res.json(data);
  } catch (error) {
    logger.error(`Model 349 error: ${error.message}`);
    next(error);
  }
});

module.exports = router;
