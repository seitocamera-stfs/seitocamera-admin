// ===========================================
// Chat service — lògica de negoci
// ===========================================

const { prisma } = require('../config/database');
const { logger } = require('../config/logger');
const tg = require('./telegramService');
const push = require('./pushService');

// =====================================================
// Detecció de @mencions al text
// =====================================================
// Sintaxi: `@nom` o `@nom.cognom` (lletres/nums/_/.)  → busca per User.name
// Internament guardem la mention amb userId.
//
// Si volem ser estrictes, busquem només si el nom encaixa amb un usuari real.

const MENTION_REGEX = /@([a-zA-Zàèéíòóúïüçñ0-9._-]{2,40})/gi;

/**
 * Extreu noms candidats a mention del text. Retorna Set<string>.
 */
function extractMentionCandidates(text) {
  const set = new Set();
  if (!text) return set;
  let m;
  while ((m = MENTION_REGEX.exec(text)) !== null) {
    set.add(m[1].toLowerCase());
  }
  return set;
}

/**
 * Donat un text amb @mencions i un canal, retorna la llista d'usuaris
 * mencionats que SÓN MEMBRES del canal. Compara per nom (insensitive).
 *
 * També suporta `@all` / `@tothom` → tots els membres del canal.
 */
async function resolveMentionUserIds(channelId, text) {
  const candidates = extractMentionCandidates(text);
  if (candidates.size === 0) return [];

  // @all / @tothom → tots els membres
  const wantAll = candidates.has('all') || candidates.has('tothom') || candidates.has('todos');

  const members = await prisma.chatMember.findMany({
    where: { channelId },
    include: { user: { select: { id: true, name: true } } },
  });

  if (wantAll) {
    return members.map(m => m.userId);
  }

  // Cerca per nom: comparem la primera paraula del nom + tot el nom (lowercase)
  const matched = new Set();
  for (const m of members) {
    if (!m.user) continue;
    const fullName = m.user.name.toLowerCase().trim();
    const firstName = fullName.split(/\s+/)[0];
    const compactName = fullName.replace(/\s+/g, '.');
    if (candidates.has(fullName) || candidates.has(firstName) || candidates.has(compactName)) {
      matched.add(m.userId);
    }
  }
  return Array.from(matched);
}

// =====================================================
// Notificacions multi-canal per a missatges nous
// =====================================================
//
// Política:
//   - Tots els membres del canal: només queden marcats com a "no llegits"
//     (es resol al frontend comparant lastReadAt). NO es crea entrada
//     a OpNotification per a cada missatge nou (massa soroll).
//   - Mencionats explícitament: notificació in-app + push + Telegram (opt-in).
//   - L'autor mai rep notificació del seu propi missatge.

async function notifyNewMessage({ message, channel, mentionUserIds, authorName, skipTelegramForward = false }) {
  const channelLabel = channel.name;
  const previewText = message.content.length > 200
    ? message.content.slice(0, 200) + '...'
    : message.content;
  const front = process.env.FRONTEND_URL?.replace(/\/$/, '') || '';
  const link = `${front}/chat/${channel.id}`;

  // ============================================
  // 1) Bridge App → grup Telegram (si està vinculat)
  // ============================================
  // Important: si la font del missatge és TELEGRAM, NO el repliquem cap al grup
  // (sinó faríem ping-pong infinit). El handler del webhook passa skipTelegramForward=true.
  if (!skipTelegramForward) {
    try {
      const fullChannel = await prisma.chatChannel.findUnique({
        where: { id: channel.id },
        select: { telegramGroupChatId: true },
      });
      if (fullChannel?.telegramGroupChatId) {
        const e = tg.mdv2Escape;
        // Format minimal: *Nom:* missatge
        const tgText = `*${e(authorName)}:* ${e(message.content)}`;
        await tg.sendMessage(fullChannel.telegramGroupChatId, tgText);
      }
    } catch (err) {
      logger.warn(`Chat bridge App→TG group error: ${err.message}`);
    }
  }

  // ============================================
  // 2) Notificar mencionats (in-app + push + Telegram personal)
  // ============================================
  if (!mentionUserIds || mentionUserIds.length === 0) return;

  const targets = await prisma.user.findMany({
    where: { id: { in: mentionUserIds }, isActive: true },
    select: {
      id: true, name: true,
      telegramChatId: true, notifyTelegram: true,
    },
  });

  // 1) In-app notification (OpNotification)
  try {
    await prisma.opNotification.createMany({
      data: targets
        .filter(u => u.id !== message.userId)
        .map(u => ({
          userId: u.id,
          title: `${authorName} t'ha mencionat a #${channelLabel}`,
          body: previewText,
          link,
          // type: 'chat_mention' (si tenim enum, sinó string)
        })),
      skipDuplicates: true,
    });
  } catch (err) {
    logger.warn(`Chat: error creant OpNotification: ${err.message}`);
  }

  // 2) Push browser
  try {
    const ids = targets.filter(u => u.id !== message.userId).map(u => u.id);
    if (ids.length > 0) {
      await push.sendToUsers(ids, {
        title: `💬 ${authorName} a #${channelLabel}`,
        body: previewText,
        url: link,
      });
    }
  } catch (err) {
    logger.warn(`Chat: error enviant push: ${err.message}`);
  }

  // 3) Telegram per a usuaris vinculats amb notifyTelegram=true
  for (const u of targets) {
    if (u.id === message.userId) continue;
    if (!u.telegramChatId || !u.notifyTelegram) continue;
    try {
      const e = tg.mdv2Escape;
      const text = [
        `💬 *${e(authorName)}* t'ha mencionat a *\\#${e(channelLabel)}*`,
        '',
        e(previewText),
        '',
        `[Obrir a l'app](${link})`,
      ].join('\n');
      await tg.sendMessage(u.telegramChatId, text);
    } catch (err) {
      if (/chat not found|bot was blocked|user is deactivated/i.test(err.message)) {
        await prisma.user.update({
          where: { id: u.id },
          data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
        });
        logger.warn(`Chat→Telegram: chat invàlid per ${u.name}, desvinculat`);
      } else {
        logger.error(`Chat→Telegram error per user=${u.id}: ${err.message}`);
      }
    }
  }
}

// =====================================================
// Counts de missatges no llegits per usuari
// =====================================================
//
// Per cada canal del qual l'usuari és membre, conta els missatges
// posteriors a `member.lastReadAt`. Retorna { channelId: count, total }.

async function getUnreadCountsForUser(userId) {
  const memberships = await prisma.chatMember.findMany({
    where: { userId },
    select: { channelId: true, lastReadAt: true },
  });
  if (memberships.length === 0) return { byChannel: {}, total: 0 };

  const byChannel = {};
  let total = 0;

  for (const m of memberships) {
    const where = {
      channelId: m.channelId,
      deletedAt: null,
      userId: { not: userId }, // no contem els nostres propis missatges
    };
    if (m.lastReadAt) where.createdAt = { gt: m.lastReadAt };
    const count = await prisma.chatMessage.count({ where });
    byChannel[m.channelId] = count;
    total += count;
  }
  return { byChannel, total };
}

module.exports = {
  extractMentionCandidates,
  resolveMentionUserIds,
  notifyNewMessage,
  getUnreadCountsForUser,
};
