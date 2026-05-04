/**
 * Endpoints del Gestor IA (Sprint Agent IA).
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');
const { logger } = require('../config/logger');
const scanService = require('../services/agentScanService');
const gestorAgent = require('../services/gestorAgentService');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('agent'));

router.get('/scan', async (req, res) => {
  try {
    const data = await scanService.scan();
    res.json(data);
  } catch (err) {
    logger.error(`Gestor scan error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /chat — torn de conversa amb el Gestor IA.
 * Body: { message: string, history?: Anthropic messages array }
 * Retorna: { reply, toolCalls, proposals, history }
 */
router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Falta el camp `message`' });
    }
    const result = await gestorAgent.chat(message, Array.isArray(history) ? history : []);
    res.json(result);
  } catch (err) {
    logger.error(`Gestor chat error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
