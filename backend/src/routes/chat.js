// ===========================================
// Chat routes — canals, missatges, membres, adjunts
// ===========================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const { authenticate, authorize } = require('../middleware/auth');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');
const { chatAttachmentUpload, CHAT_ATTACHMENTS_DIR } = require('../config/upload');
const chatService = require('../services/chatService');

const router = express.Router();

router.use(authenticate);

// ====================================================================
// Helpers
// ====================================================================

async function isMember(channelId, userId) {
  const m = await prisma.chatMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { channelId: true, role: true },
  });
  return m;
}

async function assertMember(req, res, next) {
  const m = await isMember(req.params.channelId, req.user.id);
  if (!m) {
    // Admin pot accedir igualment
    if (req.user.role === 'ADMIN') {
      req.isImplicitAdmin = true;
      return next();
    }
    return res.status(403).json({ error: 'No ets membre d\'aquest canal' });
  }
  req.chatMember = m;
  return next();
}

// ====================================================================
// Canals
// ====================================================================

/**
 * GET /api/chat/channels — canals on l'usuari és membre
 *   ?all=1   (admin) llista tots els canals incloent els no-membres
 */
router.get('/channels', async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'ADMIN';
    const wantAll = isAdmin && req.query.all === '1';

    const where = { isArchived: false };
    if (!wantAll) {
      where.members = { some: { userId: req.user.id } };
    }

    const channels = await prisma.chatChannel.findMany({
      where,
      include: {
        _count: { select: { members: true, messages: true } },
        members: {
          where: { userId: req.user.id },
          select: { lastReadAt: true, role: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Counts de no-llegits
    const unread = await chatService.getUnreadCountsForUser(req.user.id);

    const out = channels.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      type: c.type,
      color: c.color,
      icon: c.icon,
      isArchived: c.isArchived,
      memberCount: c._count.members,
      messageCount: c._count.messages,
      myMembership: c.members[0] || null,
      unreadCount: unread.byChannel[c.id] || 0,
    }));

    res.json({ channels: out, totalUnread: unread.total });
  } catch (err) { next(err); }
});

/**
 * POST /api/chat/channels — crear canal (només ADMIN)
 */
router.post('/channels', authorize('ADMIN'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).max(50),
      description: z.string().max(500).optional(),
      type: z.enum(['TEAM', 'PROJECT', 'DM']).default('TEAM'),
      color: z.string().max(20).optional(),
      icon: z.string().max(20).optional(),
      memberIds: z.array(z.string()).default([]),
    });
    const data = schema.parse(req.body);

    const channel = await prisma.chatChannel.create({
      data: {
        name: data.name.trim(),
        description: data.description || null,
        type: data.type,
        color: data.color || null,
        icon: data.icon || null,
        createdById: req.user.id,
        members: {
          create: [
            // Creador sempre és admin del canal
            { userId: req.user.id, role: 'ADMIN' },
            ...data.memberIds
              .filter(id => id !== req.user.id)
              .map(id => ({ userId: id, role: 'MEMBER' })),
          ],
        },
      },
      include: {
        _count: { select: { members: true } },
      },
    });

    logger.info(`Chat: canal "${channel.name}" creat per ${req.user.email} (${data.memberIds.length + 1} membres)`);
    res.status(201).json(channel);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

/**
 * PUT /api/chat/channels/:channelId — editar canal (admin del canal o admin global)
 */
router.put('/channels/:channelId', assertMember, async (req, res, next) => {
  try {
    const isChannelAdmin = req.chatMember?.role === 'ADMIN' || req.user.role === 'ADMIN';
    if (!isChannelAdmin) return res.status(403).json({ error: 'Cal ser admin del canal' });

    const schema = z.object({
      name: z.string().min(1).max(50).optional(),
      description: z.string().max(500).nullable().optional(),
      color: z.string().max(20).nullable().optional(),
      icon: z.string().max(20).nullable().optional(),
      isArchived: z.boolean().optional(),
    });
    const data = schema.parse(req.body);

    const updated = await prisma.chatChannel.update({
      where: { id: req.params.channelId },
      data,
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

/**
 * DELETE /api/chat/channels/:channelId — esborrar (cascade missatges)
 */
router.delete('/channels/:channelId', authorize('ADMIN'), async (req, res, next) => {
  try {
    await prisma.chatChannel.delete({ where: { id: req.params.channelId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ====================================================================
// Membres
// ====================================================================

/**
 * GET /api/chat/channels/:channelId/members
 */
router.get('/channels/:channelId/members', assertMember, async (req, res, next) => {
  try {
    const members = await prisma.chatMember.findMany({
      where: { channelId: req.params.channelId },
      include: { user: { select: { id: true, name: true, email: true, color: true, role: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    res.json(members);
  } catch (err) { next(err); }
});

/**
 * POST /api/chat/channels/:channelId/members — afegir membres
 */
router.post('/channels/:channelId/members', assertMember, async (req, res, next) => {
  try {
    const isChannelAdmin = req.chatMember?.role === 'ADMIN' || req.user.role === 'ADMIN';
    if (!isChannelAdmin) return res.status(403).json({ error: 'Cal ser admin del canal' });

    const schema = z.object({ userIds: z.array(z.string()).min(1) });
    const { userIds } = schema.parse(req.body);

    await prisma.chatMember.createMany({
      data: userIds.map(uid => ({
        channelId: req.params.channelId,
        userId: uid,
        role: 'MEMBER',
      })),
      skipDuplicates: true,
    });
    res.json({ ok: true, added: userIds.length });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

/**
 * DELETE /api/chat/channels/:channelId/members/:userId
 */
router.delete('/channels/:channelId/members/:userId', assertMember, async (req, res, next) => {
  try {
    const isChannelAdmin = req.chatMember?.role === 'ADMIN' || req.user.role === 'ADMIN';
    const isSelf = req.params.userId === req.user.id;
    if (!isChannelAdmin && !isSelf) {
      return res.status(403).json({ error: 'No tens permís' });
    }
    await prisma.chatMember.delete({
      where: { channelId_userId: { channelId: req.params.channelId, userId: req.params.userId } },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ====================================================================
// Missatges
// ====================================================================

/**
 * GET /api/chat/channels/:channelId/messages?before=<id>&limit=50
 */
router.get('/channels/:channelId/messages', assertMember, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const where = { channelId: req.params.channelId };
    if (req.query.before) {
      const cursor = await prisma.chatMessage.findUnique({
        where: { id: req.query.before }, select: { createdAt: true },
      });
      if (cursor) where.createdAt = { lt: cursor.createdAt };
    }
    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, name: true, color: true } },
        mentions: { select: { userId: true } },
        attachment: true,
      },
    });
    res.json(messages.reverse()); // tornem ordre cronològic ascendent
  } catch (err) { next(err); }
});

/**
 * POST /api/chat/channels/:channelId/messages — enviar missatge
 */
router.post('/channels/:channelId/messages', assertMember, async (req, res, next) => {
  try {
    const schema = z.object({
      content: z.string().min(1).max(5000),
      attachmentId: z.string().optional().nullable(),
    });
    const { content, attachmentId } = schema.parse(req.body);

    // Asseguro que el canal existeix
    const channel = await prisma.chatChannel.findUnique({
      where: { id: req.params.channelId },
      select: { id: true, name: true },
    });
    if (!channel) return res.status(404).json({ error: 'Canal no trobat' });

    // Resoldre @mencions ABANS de crear el missatge
    const mentionUserIds = await chatService.resolveMentionUserIds(channel.id, content);

    const message = await prisma.chatMessage.create({
      data: {
        channelId: channel.id,
        userId: req.user.id,
        content,
        attachmentId: attachmentId || null,
        mentions: {
          create: mentionUserIds.map(uid => ({ userId: uid })),
        },
      },
      include: {
        user: { select: { id: true, name: true, color: true } },
        mentions: { select: { userId: true } },
        attachment: true,
      },
    });

    // Actualitzar lastReadAt del propi autor (per no marcar el seu missatge com a sense llegir)
    await prisma.chatMember.update({
      where: { channelId_userId: { channelId: channel.id, userId: req.user.id } },
      data: { lastReadAt: new Date() },
    }).catch(() => {});

    // Notificar mencions (in-app + push + Telegram) — async, sense bloquejar resposta
    chatService.notifyNewMessage({
      message, channel, mentionUserIds, authorName: req.user.name,
    }).catch(err => logger.warn(`Chat notify error: ${err.message}`));

    res.status(201).json(message);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

/**
 * PUT /api/chat/messages/:messageId — editar missatge propi
 */
router.put('/messages/:messageId', async (req, res, next) => {
  try {
    const message = await prisma.chatMessage.findUnique({
      where: { id: req.params.messageId },
      select: { userId: true, channelId: true },
    });
    if (!message) return res.status(404).json({ error: 'Missatge no trobat' });
    if (message.userId !== req.user.id) {
      return res.status(403).json({ error: 'Només pots editar els teus missatges' });
    }

    const { content } = z.object({ content: z.string().min(1).max(5000) }).parse(req.body);

    // Re-resoldre mencions amb el text nou
    const mentionUserIds = await chatService.resolveMentionUserIds(message.channelId, content);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.chatMessageMention.deleteMany({ where: { messageId: req.params.messageId } });
      return tx.chatMessage.update({
        where: { id: req.params.messageId },
        data: {
          content,
          editedAt: new Date(),
          mentions: { create: mentionUserIds.map(uid => ({ userId: uid })) },
        },
        include: {
          user: { select: { id: true, name: true, color: true } },
          mentions: { select: { userId: true } },
          attachment: true,
        },
      });
    });

    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

/**
 * DELETE /api/chat/messages/:messageId — esborrar (soft delete)
 */
router.delete('/messages/:messageId', async (req, res, next) => {
  try {
    const message = await prisma.chatMessage.findUnique({
      where: { id: req.params.messageId },
      select: { userId: true, channelId: true },
    });
    if (!message) return res.status(404).json({ error: 'Missatge no trobat' });
    const isOwner = message.userId === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'No tens permís' });
    }

    await prisma.chatMessage.update({
      where: { id: req.params.messageId },
      data: { deletedAt: new Date(), content: '_(missatge esborrat)_' },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ====================================================================
// Lectura — marcar com a llegit
// ====================================================================

/**
 * POST /api/chat/channels/:channelId/read — marca tots com a llegits fins ara
 */
router.post('/channels/:channelId/read', assertMember, async (req, res, next) => {
  try {
    if (req.isImplicitAdmin) return res.json({ ok: true, ignored: 'no membership' });
    await prisma.chatMember.update({
      where: { channelId_userId: { channelId: req.params.channelId, userId: req.user.id } },
      data: { lastReadAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ====================================================================
// Counts globals (per badge a la sidebar)
// ====================================================================

router.get('/unread-counts', async (req, res, next) => {
  try {
    const counts = await chatService.getUnreadCountsForUser(req.user.id);
    res.json(counts);
  } catch (err) { next(err); }
});

// ====================================================================
// Adjunts
// ====================================================================

/**
 * POST /api/chat/channels/:channelId/attachments — pujar fitxer (un cada cop)
 * Retorna { id } per usar a la creació del missatge.
 */
router.post('/channels/:channelId/attachments',
  assertMember,
  chatAttachmentUpload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Cap fitxer rebut' });
      const att = await prisma.chatAttachment.create({
        data: {
          channelId: req.params.channelId,
          filename: req.file.filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          uploadedById: req.user.id,
        },
      });
      res.status(201).json(att);
    } catch (err) {
      if (req.file) fs.unlink(req.file.path, () => {});
      next(err);
    }
  }
);

/**
 * GET /api/chat/attachments/:attachmentId/download[?inline=1]
 */
router.get('/attachments/:attachmentId/download', async (req, res, next) => {
  try {
    const att = await prisma.chatAttachment.findUnique({
      where: { id: req.params.attachmentId },
    });
    if (!att) return res.status(404).json({ error: 'Adjunt no trobat' });

    // Cal ser membre del canal (o admin)
    const m = await isMember(att.channelId, req.user.id);
    if (!m && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'No ets membre d\'aquest canal' });
    }

    const filePath = path.join(
      CHAT_ATTACHMENTS_DIR,
      att.channelId.replace(/[^a-zA-Z0-9]/g, ''),
      att.filename
    );
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fitxer no trobat al disc' });
    }
    const inline = req.query.inline === '1';
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(att.originalName)}"`);
    res.setHeader('Content-Length', att.sizeBytes);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) { next(err); }
});

module.exports = router;
