const express = require('express');
const { authenticate } = require('../middleware/auth');
const pushService = require('../services/pushService');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/push/vapid-key — Retorna la clau pública VAPID
 */
router.get('/vapid-key', (req, res) => {
  const keys = pushService.getVapidKeys();
  if (!keys) {
    return res.status(503).json({ error: 'Push no configurat' });
  }
  res.json({ publicKey: keys.publicKey });
});

/**
 * POST /api/push/subscribe — Registrar subscripció push
 */
router.post('/subscribe', async (req, res, next) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'Subscripció invàlida' });
    }

    const sub = await pushService.subscribe(
      req.user.id,
      subscription,
      req.headers['user-agent']
    );

    res.json({ ok: true, id: sub.id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/push/unsubscribe — Eliminar subscripció push
 */
router.post('/unsubscribe', async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'Endpoint requerit' });

    await pushService.unsubscribe(endpoint);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/push/test — Enviar notificació de prova
 */
router.post('/test', async (req, res, next) => {
  try {
    await pushService.sendToUser(req.user.id, {
      title: 'SeitoCamera',
      body: 'Les notificacions push funcionen correctament!',
      url: '/',
      tag: 'test',
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
