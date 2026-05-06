// ===========================================
// Telegram routes: webhook + vinculació
// ===========================================
//
// - POST /api/telegram/webhook        ← Telegram envia updates aquí (HTTPS)
// - POST /api/telegram/link/start     ← Frontend genera codi i link per usuari
// - POST /api/telegram/link/cancel    ← Cancel·la vinculació activa
// - POST /api/telegram/test           ← Envia un missatge de prova al chat vinculat
// - GET  /api/telegram/status         ← Estat de la vinculació de l'usuari actual
// - POST /api/telegram/admin/setup    ← Admin: configura webhook (one-shot)
// - GET  /api/telegram/admin/info     ← Admin: info del webhook
// ===========================================

const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');
const tg = require('../services/telegramService');

const router = express.Router();

// ---------------------------------------------------------------
// handleTelegramUpdate — lògica compartida entre webhook i polling
// ---------------------------------------------------------------
async function handleTelegramUpdate(update) {
  const message = update.message;
  if (!message || !message.text) return { ignored: 'no text message' };

  const chatId = String(message.chat.id);
  const text = String(message.text).trim();
  const fromUsername = message.from?.username || null;

  // /start <code>
  const startMatch = text.match(/^\/start(?:\s+(\S+))?/);
  if (startMatch) {
    const linkCode = startMatch[1];
    if (!linkCode) {
      await tg.sendMessage(chatId,
        tg.mdv2Escape(`👋 Hola! Sóc el bot de SeitoCamera Admin.\n\nPer vincular el teu compte, ves al teu perfil a admin.seito.camera i clica "Vincular Telegram".`)
      );
      return { ok: true };
    }

    const user = await prisma.user.findFirst({
      where: {
        telegramLinkCode: linkCode,
        telegramLinkExpires: { gt: new Date() },
      },
    });
    if (!user) {
      await tg.sendMessage(chatId,
        tg.mdv2Escape(`❌ Codi invàlid o caducat. Genera un nou codi al teu perfil i torna-ho a provar.`)
      );
      return { ok: true, error: 'invalid code' };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: chatId,
        telegramUsername: fromUsername,
        telegramLinkCode: null,
        telegramLinkExpires: null,
        telegramLinkedAt: new Date(),
      },
    });
    logger.info(`Telegram: usuari ${user.email} vinculat amb chatId=${chatId} (@${fromUsername || '-'})`);

    await tg.sendMessage(chatId,
      `✅ *Vinculat correctament*\n\nHola ${tg.mdv2Escape(user.name)}, ara rebràs aquí els recordatoris de les teves tasques\\.\n\nPots desactivar les notificacions des del teu perfil quan vulguis\\.`
    );
    return { ok: true };
  }

  // /help
  if (/^\/help/.test(text)) {
    await tg.sendMessage(chatId, tg.mdv2Escape(
      `Comandes disponibles:\n` +
      `/start <codi> — Vincular el teu compte\n` +
      `/desvincular — Trencar la vinculació\n` +
      `/help — Aquesta ajuda`
    ));
    return { ok: true };
  }

  // /desvincular
  if (/^\/desvincular/.test(text)) {
    const result = await prisma.user.updateMany({
      where: { telegramChatId: chatId },
      data: {
        telegramChatId: null,
        telegramUsername: null,
        telegramLinkedAt: null,
      },
    });
    if (result.count > 0) {
      await tg.sendMessage(chatId, tg.mdv2Escape(`✅ Desvinculat. Ja no rebràs més recordatoris aquí.`));
    } else {
      await tg.sendMessage(chatId, tg.mdv2Escape(`ℹ️ No tens cap compte vinculat actualment.`));
    }
    return { ok: true };
  }

  // Per defecte
  await tg.sendMessage(chatId, tg.mdv2Escape(
    `No reconec aquesta comanda. Envia /help per veure les opcions.`
  ));
  return { ok: true };
}

// ---------------------------------------------------------------
// Webhook — NO authenticate, NO rate-limit (validem amb secret token)
// ---------------------------------------------------------------
router.post('/webhook', express.json(), async (req, res) => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const got = req.header('X-Telegram-Bot-Api-Secret-Token');
  if (!expected || got !== expected) {
    logger.warn('Telegram webhook: secret token invàlid');
    return res.status(403).send('forbidden');
  }
  try {
    const result = await handleTelegramUpdate(req.body || {});
    return res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(`Telegram webhook error: ${err.message}`);
    return res.json({ ok: true, internalError: true });
  }
});

// ---------------------------------------------------------------
// Endpoints autenticats per a usuaris
// ---------------------------------------------------------------
router.use(authenticate);

/**
 * GET /api/telegram/status — estat de la vinculació de l'usuari actual
 */
router.get('/status', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        telegramChatId: true,
        telegramUsername: true,
        telegramLinkedAt: true,
        telegramLinkCode: true,
        telegramLinkExpires: true,
        notifyTelegram: true,
      },
    });
    res.json({
      enabled: tg.isEnabled(),
      botUsername: tg.getBotUsername(),
      linked: Boolean(user?.telegramChatId),
      linkedAt: user?.telegramLinkedAt,
      telegramUsername: user?.telegramUsername,
      notifyTelegram: user?.notifyTelegram ?? true,
      pendingCode: user?.telegramLinkCode,
      pendingExpires: user?.telegramLinkExpires,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/telegram/link/start — genera codi temporal i link de vinculació
 */
router.post('/link/start', async (req, res, next) => {
  try {
    if (!tg.isEnabled()) {
      return res.status(503).json({ error: 'Telegram bot no configurat' });
    }
    const botUsername = tg.getBotUsername();
    if (!botUsername) {
      return res.status(503).json({ error: 'TELEGRAM_BOT_USERNAME no configurat' });
    }

    const linkCode = tg.generateLinkCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        telegramLinkCode: linkCode,
        telegramLinkExpires: expires,
      },
    });

    res.json({
      linkCode,
      expires,
      url: `https://t.me/${botUsername}?start=${linkCode}`,
      botUsername,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/telegram/link/cancel — cancel·la el codi pendent i desvincula
 */
router.post('/link/cancel', async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        telegramChatId: null,
        telegramUsername: null,
        telegramLinkCode: null,
        telegramLinkExpires: null,
        telegramLinkedAt: null,
      },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * POST /api/telegram/preferences — toggle notifyTelegram
 */
router.post('/preferences', async (req, res, next) => {
  try {
    const { notifyTelegram } = req.body || {};
    await prisma.user.update({
      where: { id: req.user.id },
      data: { notifyTelegram: Boolean(notifyTelegram) },
    });
    res.json({ ok: true, notifyTelegram: Boolean(notifyTelegram) });
  } catch (err) { next(err); }
});

/**
 * POST /api/telegram/test — envia un missatge de prova al xat vinculat
 */
router.post('/test', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { telegramChatId: true, name: true },
    });
    if (!user?.telegramChatId) {
      return res.status(400).json({ error: 'No tens Telegram vinculat' });
    }
    await tg.sendMessage(user.telegramChatId,
      `🔔 *Missatge de prova*\n\nHola ${tg.mdv2Escape(user.name)}, la vinculació funciona correctament\\!\n\n_Aquest missatge l'has enviat tu mateix des de la teva configuració\\._`
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error(`Telegram test message: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// Endpoints d'admin
// ---------------------------------------------------------------

/**
 * POST /api/telegram/admin/setup — configura el webhook (one-shot)
 * Body: { url, secret? }
 */
router.post('/admin/setup', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { url, secret } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url requerida' });

    const finalSecret = secret || process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!finalSecret) {
      return res.status(400).json({
        error: 'Falta secret. Defineix TELEGRAM_WEBHOOK_SECRET al .env o passa-ho al body.',
      });
    }

    const result = await tg.setWebhook(url, finalSecret);
    res.json({ ok: true, result });
  } catch (err) { next(err); }
});

/**
 * GET /api/telegram/admin/info — info del webhook
 */
router.get('/admin/info', authorize('ADMIN'), async (req, res, next) => {
  try {
    const info = await tg.getWebhookInfo();
    res.json(info);
  } catch (err) { next(err); }
});

/**
 * DELETE /api/telegram/admin/webhook — desactiva el webhook
 */
router.delete('/admin/webhook', authorize('ADMIN'), async (req, res, next) => {
  try {
    const result = await tg.deleteWebhook();
    res.json({ ok: true, result });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.handleTelegramUpdate = handleTelegramUpdate;
