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
  if (!message) return { ignored: 'no message' };

  const chatType = message.chat?.type; // 'private' | 'group' | 'supergroup' | 'channel'
  const chatId = String(message.chat.id);
  const text = message.text ? String(message.text).trim() : '';
  const fromUsername = message.from?.username || null;
  const fromUserId = message.from?.id ? String(message.from.id) : null;
  const fromName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || fromUsername || 'Usuari Telegram';

  // ============================================================
  // MISSATGES EN XATS PRIVATS — comandes (/start, /help, /desvincular)
  // ============================================================
  if (chatType === 'private') {
    if (!text) return { ignored: 'no text in private' };

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
          telegramUserId: fromUserId,
          telegramUsername: fromUsername,
          telegramLinkCode: null,
          telegramLinkExpires: null,
          telegramLinkedAt: new Date(),
        },
      });
      logger.info(`Telegram: usuari ${user.email} vinculat amb chatId=${chatId} userId=${fromUserId} (@${fromUsername || '-'})`);

      await tg.sendMessage(chatId,
        `✅ *Vinculat correctament*\n\nHola ${tg.mdv2Escape(user.name)}, ara rebràs aquí els recordatoris i les mencions del xat de l'app\\.`
      );
      return { ok: true };
    }

    if (/^\/help/.test(text)) {
      await tg.sendMessage(chatId, tg.mdv2Escape(
        `Comandes disponibles:\n` +
        `/start <codi> — Vincular el teu compte\n` +
        `/desvincular — Trencar la vinculació\n` +
        `/help — Aquesta ajuda\n\n` +
        `Dins d'un grup:\n` +
        `/link <codi> — Vincular el grup amb un canal de l'app\n` +
        `/unlink — Trencar el bridge del grup`
      ));
      return { ok: true };
    }

    if (/^\/desvincular/.test(text)) {
      const result = await prisma.user.updateMany({
        where: { telegramChatId: chatId },
        data: {
          telegramChatId: null,
          telegramUserId: null,
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

    // Comanda no reconeguda — només si comença amb /
    if (text.startsWith('/')) {
      await tg.sendMessage(chatId, tg.mdv2Escape(
        `No reconec aquesta comanda. Envia /help per veure les opcions.`
      ));
    }
    return { ok: true };
  }

  // ============================================================
  // MISSATGES EN GRUPS / SUPERGRUPS
  // ============================================================
  if (chatType === 'group' || chatType === 'supergroup') {
    // /link <code> — vincula aquest grup amb un canal de l'app
    const linkMatch = text.match(/^\/link(?:@\w+)?(?:\s+(\S+))?/);
    if (linkMatch) {
      const code = linkMatch[1];
      if (!code) {
        await tg.sendMessage(chatId, tg.mdv2Escape(
          `Usa: /link <codi>\n\nGenera el codi des de l'app:\nXat → ⚙️ del canal → "Connectar grup Telegram"`
        ));
        return { ok: true };
      }
      const channel = await prisma.chatChannel.findFirst({
        where: {
          telegramLinkCode: code,
          telegramLinkExpires: { gt: new Date() },
        },
      });
      if (!channel) {
        await tg.sendMessage(chatId, tg.mdv2Escape(`❌ Codi invàlid o caducat. Genera un nou codi des de l'app.`));
        return { ok: true };
      }
      // Comprovar que aquest grup no estigui ja linkat amb un altre canal
      const conflict = await prisma.chatChannel.findFirst({
        where: { telegramGroupChatId: chatId, NOT: { id: channel.id } },
      });
      if (conflict) {
        await tg.sendMessage(chatId, tg.mdv2Escape(`⚠️ Aquest grup ja està vinculat amb el canal "${conflict.name}". Desvincula'l primer amb /unlink.`));
        return { ok: true };
      }

      const groupTitle = message.chat.title || 'Grup Telegram';
      await prisma.chatChannel.update({
        where: { id: channel.id },
        data: {
          telegramGroupChatId: chatId,
          telegramGroupTitle: groupTitle,
          telegramLinkCode: null,
          telegramLinkExpires: null,
        },
      });
      logger.info(`Chat bridge: canal "${channel.name}" vinculat amb grup TG "${groupTitle}" (chatId=${chatId})`);

      await tg.sendMessage(chatId,
        `✅ *Bridge actiu*\n\nAquest grup està vinculat al canal *\\#${tg.mdv2Escape(channel.name)}* de l'app\\.\n\nA partir d'ara els missatges es repliquen en les dues direccions\\.`
      );
      return { ok: true };
    }

    // /unlink — desvincula
    if (/^\/unlink(?:@\w+)?/.test(text)) {
      const channel = await prisma.chatChannel.findFirst({
        where: { telegramGroupChatId: chatId },
      });
      if (!channel) {
        await tg.sendMessage(chatId, tg.mdv2Escape(`ℹ️ Aquest grup no està vinculat amb cap canal.`));
        return { ok: true };
      }
      await prisma.chatChannel.update({
        where: { id: channel.id },
        data: { telegramGroupChatId: null, telegramGroupTitle: null },
      });
      await tg.sendMessage(chatId, tg.mdv2Escape(`✅ Bridge desactivat. Els missatges ja no es repliquen entre app i grup.`));
      return { ok: true };
    }

    // Missatge normal en grup vinculat → forward al canal de l'app
    if (text || message.photo || message.document) {
      const channel = await prisma.chatChannel.findFirst({
        where: { telegramGroupChatId: chatId },
        select: { id: true, name: true },
      });
      if (!channel) {
        // Grup no vinculat — ignorem silenciosament
        return { ok: true, ignored: 'group not linked' };
      }

      // Identificar autor: usuari amb telegramUserId = fromUserId
      let author = null;
      if (fromUserId) {
        author = await prisma.user.findUnique({
          where: { telegramUserId: fromUserId },
          select: { id: true, name: true },
        });
      }

      // Si no està vinculat a cap usuari nostre → autor és el primer ADMIN
      // del canal (com a "fallback inbox"), amb el contingut prefixat amb el nom
      const finalContent = author
        ? text
        : `_(${fromName} via Telegram)_ ${text || '(adjunt)'}`;

      let authorUserId = author?.id;
      if (!authorUserId) {
        const fallback = await prisma.chatMember.findFirst({
          where: { channelId: channel.id, role: 'ADMIN' },
          select: { userId: true },
        });
        authorUserId = fallback?.userId;
      }

      if (!authorUserId) {
        logger.warn(`Chat bridge: missatge de TG group "${channel.name}" sense cap admin com a fallback`);
        return { ok: true, ignored: 'no fallback admin' };
      }

      // Evita duplicats si Telegram ens reenvia el mateix update
      const tgMsgId = String(message.message_id);
      const existing = await prisma.chatMessage.findFirst({
        where: { channelId: channel.id, telegramMessageId: tgMsgId },
        select: { id: true },
      });
      if (existing) return { ok: true, deduplicated: true };

      // Resoldre @mencions del text
      const chatService = require('../services/chatService');
      const mentionUserIds = await chatService.resolveMentionUserIds(channel.id, finalContent);

      const created = await prisma.chatMessage.create({
        data: {
          channelId: channel.id,
          userId: authorUserId,
          content: finalContent,
          source: 'TELEGRAM',
          telegramMessageId: tgMsgId,
          mentions: { create: mentionUserIds.map(uid => ({ userId: uid })) },
        },
        include: {
          user: { select: { id: true, name: true } },
        },
      });

      // Notificacions (no re-emetem cap a Telegram el mateix missatge!)
      // Marquem amb source=TELEGRAM perquè notifyNewMessage no ho repliqui.
      chatService.notifyNewMessage({
        message: created,
        channel: { id: channel.id, name: channel.name },
        mentionUserIds,
        authorName: author?.name || fromName,
        skipTelegramForward: true, // crucial: no fer ping-pong
      }).catch(err => logger.warn(`Chat bridge notify error: ${err.message}`));

      return { ok: true, forwarded: true };
    }

    return { ok: true };
  }

  return { ignored: `chat type ${chatType}` };
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
