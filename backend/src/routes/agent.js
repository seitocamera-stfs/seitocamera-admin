const express = require('express');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');
const agent = require('../services/accountingAgentService');
const { rescheduleJob, runJobManually } = require('../services/agentJobsService');
const { logger } = require('../config/logger');

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
      const result = await agent.applySuggestion(req.params.id, { userId: req.user?.id });
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
        await agent.applySuggestion(suggestion.id, { userId: req.user?.id });
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
// ===========================================
// AI Review (passades puntuals manuals — duplicates / conciliation)
// ===========================================
const aiReview = require('../services/aiReviewService');

router.post('/ai-review/duplicates', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { daysBack, maxSuppliers } = req.body || {};
    const stats = await aiReview.aiDuplicatesReview({
      daysBack: daysBack ? parseInt(daysBack, 10) : undefined,
      maxSuppliers: maxSuppliers ? parseInt(maxSuppliers, 10) : undefined,
    });
    res.json({ message: 'AI duplicates review completat', ...stats });
  } catch (err) { next(err); }
});

router.post('/ai-review/conciliation', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { daysBack, maxBatches } = req.body || {};
    const stats = await aiReview.aiConciliationReview({
      daysBack: daysBack ? parseInt(daysBack, 10) : undefined,
      maxBatches: maxBatches ? parseInt(maxBatches, 10) : undefined,
    });
    res.json({ message: 'AI conciliation review completat', ...stats });
  } catch (err) { next(err); }
});

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

// ===========================================
// REGLES — Gestió de regles de l'agent
// ===========================================

const VALID_CATEGORIES = ['INVOICES', 'CLASSIFICATION', 'CONCILIATION', 'SUPPLIERS', 'ANOMALIES', 'FISCAL', 'GENERAL'];
const VALID_SOURCES = ['MANUAL', 'LEARNED', 'SYSTEM'];

/**
 * GET /api/agent/rules — Llistar regles
 */
router.get('/rules', async (req, res, next) => {
  try {
    const { category, isActive, source, search } = req.query;
    const where = {};
    if (category) where.category = category;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (source) where.source = source;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { condition: { contains: search, mode: 'insensitive' } },
        { action: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rules = await prisma.agentRule.findMany({
      where,
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    res.json(rules);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agent/rules — Crear regla
 */
router.post('/rules', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { title, condition, action, category, priority, examples } = req.body;
    if (!title?.trim() || !condition?.trim() || !action?.trim()) {
      return res.status(400).json({ error: 'Títol, condició i acció són obligatoris' });
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Categoria invàlida. Opcions: ${VALID_CATEGORIES.join(', ')}` });
    }

    const rule = await prisma.agentRule.create({
      data: {
        title: title.trim(),
        condition: condition.trim(),
        action: action.trim(),
        category: category || 'GENERAL',
        source: 'MANUAL',
        priority: priority || 0,
        examples: examples?.trim() || null,
        createdById: req.user.id,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    res.status(201).json(rule);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/agent/rules/:id — Actualitzar regla
 */
router.put('/rules/:id', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const existing = await prisma.agentRule.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Regla no trobada' });

    const { title, condition, action, category, priority, examples, isActive } = req.body;
    const data = {};
    if (title !== undefined) data.title = title.trim();
    if (condition !== undefined) data.condition = condition.trim();
    if (action !== undefined) data.action = action.trim();
    if (category !== undefined) {
      if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: `Categoria invàlida` });
      }
      data.category = category;
    }
    if (priority !== undefined) data.priority = priority;
    if (examples !== undefined) data.examples = examples?.trim() || null;
    if (isActive !== undefined) data.isActive = isActive;

    const rule = await prisma.agentRule.update({
      where: { id: req.params.id },
      data,
      include: { createdBy: { select: { id: true, name: true } } },
    });

    res.json(rule);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/agent/rules/:id/toggle — Activar/desactivar regla
 */
router.patch('/rules/:id/toggle', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const existing = await prisma.agentRule.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Regla no trobada' });

    const rule = await prisma.agentRule.update({
      where: { id: req.params.id },
      data: { isActive: !existing.isActive },
    });

    res.json(rule);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/agent/rules/:id — Eliminar regla
 */
router.delete('/rules/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const existing = await prisma.agentRule.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Regla no trobada' });

    await prisma.agentRule.delete({ where: { id: req.params.id } });
    res.json({ message: 'Regla eliminada' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agent/rules/learn — L'agent aprèn una regla d'una correcció
 * Body: { correction, context }
 * Exemple: { correction: "La factura correcta és sempre l'última rebuda", context: "Factures duplicades del mateix proveïdor" }
 */
router.post('/rules/learn', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { correction, context } = req.body;
    if (!correction?.trim()) {
      return res.status(400).json({ error: 'La correcció és obligatòria' });
    }

    // Usar Claude per convertir la correcció en una regla estructurada
    const prompt = `L'usuari ha fet una correcció al sistema comptable. Converteix-la en una regla clara i estructurada.

CORRECCIÓ DE L'USUARI: "${correction}"
${context ? `CONTEXT: "${context}"` : ''}

Respon en JSON:
{
  "title": "Títol curt (màx 60 caràcters)",
  "condition": "Quan passa... (descripció de la situació)",
  "action": "L'acció a fer... (què ha de fer l'agent)",
  "category": "INVOICES|CLASSIFICATION|CONCILIATION|SUPPLIERS|ANOMALIES|FISCAL|GENERAL",
  "priority": 0
}`;

    const response = await agent.chat(prompt, [], {});

    // Intentar parsejar la resposta com JSON
    let ruleData;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      ruleData = JSON.parse(jsonMatch[0]);
    } catch {
      // Si no pot parsejar, crear regla bàsica
      ruleData = {
        title: correction.substring(0, 60),
        condition: context || correction,
        action: correction,
        category: 'GENERAL',
        priority: 0,
      };
    }

    const rule = await prisma.agentRule.create({
      data: {
        title: ruleData.title,
        condition: ruleData.condition,
        action: ruleData.action,
        category: VALID_CATEGORIES.includes(ruleData.category) ? ruleData.category : 'GENERAL',
        source: 'LEARNED',
        priority: ruleData.priority || 0,
        examples: correction,
        createdById: req.user.id,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    res.status(201).json(rule);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// JOBS — Configuració i historial de l'agent automàtic
// ===========================================

/**
 * GET /api/agent/jobs/config — Llistar configuració de jobs
 */
router.get('/jobs/config', async (req, res, next) => {
  try {
    const configs = await prisma.agentJobConfig.findMany({
      orderBy: { jobType: 'asc' },
    });
    res.json(configs);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/agent/jobs/config/:jobType — Actualitzar configuració d'un job
 */
router.put('/jobs/config/:jobType', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { isEnabled, cronSchedule } = req.body;
    const data = {};
    if (isEnabled !== undefined) data.isEnabled = isEnabled;
    if (cronSchedule) data.cronSchedule = cronSchedule;

    const config = await prisma.agentJobConfig.update({
      where: { jobType: req.params.jobType },
      data,
    });

    // Reprogramar el job
    await rescheduleJob(req.params.jobType);

    res.json(config);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Job no trobat' });
    next(error);
  }
});

/**
 * POST /api/agent/jobs/run/:jobType — Executar un job manualment
 */
router.post('/jobs/run/:jobType', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    // Executar en background, no bloquejar la resposta
    runJobManually(req.params.jobType).catch((err) => {
      logger.error(`[Agent Jobs] Error manual ${req.params.jobType}: ${err.message}`);
    });
    res.json({ message: `Job "${req.params.jobType}" iniciat` });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/agent/jobs/history — Historial d'execucions
 */
router.get('/jobs/history', async (req, res, next) => {
  try {
    const { jobType, limit = 50 } = req.query;
    const where = {};
    if (jobType) where.jobType = jobType;

    const jobs = await prisma.agentJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
    });

    res.json(jobs);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/agent/jobs/stats — Estadístiques resum
 */
router.get('/jobs/stats', async (req, res, next) => {
  try {
    const [totalRuns, last24h, pendingSuggestions, configs] = await Promise.all([
      prisma.agentJob.count(),
      prisma.agentJob.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
      prisma.agentSuggestion.count({ where: { status: 'PENDING' } }),
      prisma.agentJobConfig.findMany(),
    ]);

    const lastByType = await prisma.agentJob.findMany({
      where: { status: 'completed' },
      distinct: ['jobType'],
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    res.json({
      totalRuns,
      last24h,
      pendingSuggestions,
      enabledJobs: configs.filter((c) => c.isEnabled).length,
      totalJobs: configs.length,
      lastRuns: lastByType,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
