/**
 * Endpoints del CEO IA estratègic.
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');
const { logger } = require('../config/logger');
const strategic = require('../services/strategicAnalysisService');
const ceoAgent = require('../services/ceoAgentService');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('agent'));

router.get('/kpi-overview', async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : undefined;
    const data = await strategic.getKpiOverview(year);
    res.json(data);
  } catch (err) {
    logger.error(`CEO kpi error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/strategic-scan', async (req, res) => {
  try {
    const [risks, kpi, cashflow, overdue, topClients, topSuppliers, projects, inventory] = await Promise.all([
      strategic.getStrategicRisks(),
      strategic.getKpiOverview(),
      strategic.getCashFlowProjection(60),
      strategic.getOverdueCollections(),
      strategic.getTopClients(undefined, 5),
      strategic.getTopSuppliers(undefined, 5),
      strategic.getProjectsSummary(),
      strategic.getInventorySummary(),
    ]);
    res.json({ generatedAt: new Date().toISOString(), risks, kpi, cashflow, overdue, topClients, topSuppliers, projects, inventory });
  } catch (err) {
    logger.error(`CEO scan error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Falta el camp `message`' });
    }
    const result = await ceoAgent.chat(message, Array.isArray(history) ? history : []);
    res.json(result);
  } catch (err) {
    logger.error(`CEO chat error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
