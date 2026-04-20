const express = require('express');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');
const agent = require('../services/accountingAgentService');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('agent'));

// ===========================================
// XATS — Conversa lliure amb l'agent
// ===========================================

/**
 * POST /api/agent/chat — Enviar missatge al xat
 * Body: { message, chatId?, context? }
 */
router.post('/chat', async (req, res, next) => {
  try {
    const { message, chatId, context } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ error: 'El missatge és obligatori' });
    }

    let chat;
    let history = [];

    // Recuperar xat existent o crear-ne un de nou
    if (chatId) {
      chat = await prisma.agentChat.findUnique({ where: { id: chatId } });
      if (!chat || chat.userId !== req.user.id) {
        return res.status(404).json({ error: 'Xat no trobat' });
      }
      history = chat.messages || [];
    }

    // Obtenir resposta de l'agent
    const response = await agent.chat(message, history, context || {});

    // Actualitzar historial
    const newMessages = [
      ...history,
      { role: 'user', content: message, timestamp: new Date().toISOString() },
      { role: 'assistant', content: response, timestamp: new Date().toISOString() },
    ];

    if (chat) {
      // Actualitzar xat existent
      await prisma.agentChat.update({
        where: { id: chat.id },
        data: { messages: newMessages, context: context || chat.context },
      });
    } else {
      // Crear nou xat
      // Generar títol a partir del primer missatge
      const title = message.length > 60 ? message.substring(0, 57) + '...' : message;
      chat = await prisma.agentChat.create({
        data: {
          userId: req.user.id,
          title,
          messages: newMessages,
          context: context || null,
        },
      });
    }

    res.json({
      chatId: chat.id,
      response,
      messagesCount: newMessages.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/agent/chats — Llistar converses
 */
router.get('/chats', async (req, res, next) => {
  try {
    const chats = await prisma.agentChat.findMany({
      where: { userId: req.user.id },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        messages: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    // Retornar amb recompte de missatges
    const result = chats.map((c) => ({
      id: c.id,
      title: c.title,
      messagesCount: Array.isArray(c.messages) ? c.messages.length : 0,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/agent/chats/:id — Obtenir conversa completa
 */
router.get('/chats/:id', async (req, res, next) => {
  try {
    const chat = await prisma.agentChat.findUnique({ where: { id: req.params.id } });
    if (!chat || chat.userId !== req.user.id) {
      return res.status(404).json({ error: 'Xat no trobat' });
    }
    res.json(chat);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/agent/chats/:id — Eliminar conversa
 */
router.delete('/chats/:id', async (req, res, next) => {
  try {
    const chat = await prisma.agentChat.findUnique({ where: { id: req.params.id } });
    if (!chat || chat.userId !== req.user.id) {
      return res.status(404).json({ error: 'Xat no trobat' });
    }
    await prisma.agentChat.delete({ where: { id: req.params.id } });
    res.json({ message: 'Xat eliminat' });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// CLASSIFICACIÓ — Categorització de factures
// ===========================================

/**
 * POST /api/agent/classify — Classificar una factura
 * Body: { invoiceId }
 */
router.post('/classify', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { invoiceId } = req.body;
    if (!invoiceId) {
      return res.status(400).json({ error: 'invoiceId és obligatori' });
    }

    const classification = await agent.classifyInvoice(invoiceId);

    // Crear suggeriment (no aplicar automàticament)
    const suggestion = await prisma.agentSuggestion.create({
      data: {
        receivedInvoiceId: invoiceId,
        type: 'CLASSIFICATION',
        title: `${classification.accountingType === 'INVESTMENT' ? 'Inversió' : 'Despesa'}: ${classification.pgcAccount} ${classification.pgcAccountName}`,
        description: classification.reasoning,
        suggestedValue: {
          accountingType: classification.accountingType,
          pgcAccount: classification.pgcAccount,
          pgcAccountName: classification.pgcAccountName,
        },
        confidence: classification.confidence,
        reasoning: classification.reasoning,
      },
    });

    res.json({ classification, suggestionId: suggestion.id });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agent/classify-batch — Classificar múltiples factures
 * Body: { invoiceIds?: string[], all?: boolean }
 */
router.post('/classify-batch', authorize('ADMIN'), async (req, res, next) => {
  try {
    let { invoiceIds } = req.body;
    const { all } = req.body;

    if (all) {
      const unclassified = await agent.getUnclassifiedInvoices(50);
      invoiceIds = unclassified.map((i) => i.id);
    }

    if (!invoiceIds?.length) {
      return res.json({ message: 'Cap factura per classificar', results: [] });
    }

    const results = await agent.batchClassify(invoiceIds);

    res.json({
      message: `${results.filter((r) => r.success).length}/${results.length} factures classificades`,
      results,
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// SUGGERIMENTS — Gestió de propostes de l'agent
// ===========================================

/**
 * GET /api/agent/suggestions — Llistar suggeriments
 */
router.get('/suggestions', async (req, res, next) => {
  try {
    const { status, type, invoiceId, page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (invoiceId) where.receivedInvoiceId = invoiceId;

    const [suggestions, total] = await Promise.all([
      prisma.agentSuggestion.findMany({
        where,
        include: {
          receivedInvoice: {
            select: {
              id: true,
              invoiceNumber: true,
              totalAmount: true,
              supplier: { select: { name: true } },
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.agentSuggestion.count({ where }),
    ]);

    res.json({
      data: suggestions,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/agent/suggestions/summary — Resum de suggeriments pendents
 */
router.get('/suggestions/summary', async (req, res, next) => {
  try {
    const [pending, byType] = await Promise.all([
      prisma.agentSuggestion.count({ where: { status: 'PENDING' } }),
      prisma.agentSuggestion.groupBy({
        by: ['type'],
        where: { status: 'PENDING' },
        _count: true,
      }),
    ]);

    res.json({
      pending,
      byType: byType.map((t) => ({ type: t.type, count: t._count })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/agent/suggestions/:id — Acceptar o rebutjar suggeriment
 * Body: { action: 'accept' | 'reject' }
 */
router.patch('/suggestions/:id', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { action } = req.body;
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action ha de ser "accept" o "reject"' });
    }

    if (action === 'accept') {
      const result = await agent.applySuggestion(req.params.id);
      res.json({ message: 'Suggeriment acceptat i aplicat', ...result });
    } else {
      await prisma.agentSuggestion.update({
        where: { id: req.params.id },
        data: {
          status: 'REJECTED',
          resolvedBy: 'user',
          resolvedAt: new Date(),
        },
      });
      res.json({ message: 'Suggeriment rebutjat' });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agent/suggestions/accept-all — Acceptar tots els suggeriments pendents d'alta confiança
 */
router.post('/suggestions/accept-all', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { minConfidence = 0.85 } = req.body;

    const pendingHigh = await prisma.agentSuggestion.findMany({
      where: {
        status: 'PENDING',
        confidence: { gte: parseFloat(minConfidence) },
      },
    });

    let applied = 0;
    for (const suggestion of pendingHigh) {
      try {
        await agent.applySuggestion(suggestion.id);
        applied++;
      } catch (err) {
        // continuar amb la resta
      }
    }

    res.json({
      message: `${applied}/${pendingHigh.length} suggeriments acceptats`,
      applied,
      total: pendingHigh.length,
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// ANÀLISI — Detectar anomalies
// ===========================================

/**
 * POST /api/agent/analyze — Analitzar anomalies
 * Body: { invoiceIds }
 */
router.post('/analyze', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    let { invoiceIds } = req.body;

    // Si no s'especifiquen IDs, analitzar les últimes 20 factures
    if (!invoiceIds?.length) {
      const recent = await prisma.receivedInvoice.findMany({
        where: { status: { notIn: ['REJECTED'] } },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      invoiceIds = recent.map((r) => r.id);
    }

    const anomalies = await agent.analyzeAnomalies(invoiceIds);

    // Crear suggeriments per cada anomalia
    // Per cada anomalia, buscar a quina factura correspon (simplificat: totes van a les factures analitzades)
    for (const anomaly of anomalies) {
      // Intentar associar a una factura específica (si l'anomalia menciona un número)
      const targetId = invoiceIds[0]; // Simplificat, es pot millorar

      await prisma.agentSuggestion.create({
        data: {
          receivedInvoiceId: targetId,
          type: anomaly.type || 'ANOMALY',
          title: anomaly.title,
          description: anomaly.description,
          confidence: anomaly.confidence || 0.7,
          reasoning: anomaly.description,
        },
      });
    }

    res.json({ anomalies, created: anomalies.length });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
