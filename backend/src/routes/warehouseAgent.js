/**
 * Endpoints del Magatzem IA (chat operatiu + briefing).
 *
 * El conjunt sencer (chat + briefing diari) es pot desactivar des del
 * Supervisor IA via AgentJobConfig{jobType:'warehouse_agent', isEnabled:false}.
 * Quan està OFF, /chat retorna 503; el cron diari no s'arrenca.
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');
const { logger } = require('../config/logger');
const warehouseAgent = require('../services/warehouseAgentService');
const { isJobEnabled } = require('../services/agentJobsService');

const router = express.Router();
router.use(authenticate);
router.use(requireSection('agent'));

// Middleware per bloquejar tot el router quan el toggle del Supervisor IA està OFF.
router.use(async (req, res, next) => {
  try {
    const enabled = await isJobEnabled('warehouse_agent');
    if (!enabled) {
      return res.status(503).json({
        error: 'Magatzem IA desactivat',
        code: 'AGENT_DISABLED',
        hint: 'Activa\'l a Administració → Supervisor IA → Magatzem IA',
      });
    }
    next();
  } catch (e) {
    next(e);
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Falta el camp `message`' });
    }
    const result = await warehouseAgent.chat(message, Array.isArray(history) ? history : [], { userId: req.user?.id });
    res.json(result);
  } catch (err) {
    logger.error(`Warehouse agent chat error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
