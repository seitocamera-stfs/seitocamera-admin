const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

// ===========================================
// AI Cost Tracker — Registre de costos Claude API
// ===========================================

// Preus per 1M tokens (USD) — actualitzar si canvien
// Font: https://docs.anthropic.com/en/docs/about-claude/models
const PRICING = {
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
  // Fallback per models desconeguts (assumir Haiku)
  default: { input: 1.00, output: 5.00 },
};

/**
 * Calcula el cost en USD a partir dels tokens i el model.
 */
function calculateCost(model, inputTokens, outputTokens) {
  const pricing = PRICING[model] || PRICING.default;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimals
}

/**
 * Registra una crida a la IA amb els tokens i el cost.
 * Fire-and-forget: no bloqueja el flux principal.
 *
 * @param {Object} params
 * @param {string} params.service - 'email_classification' | 'invoice_extraction' | 'accounting_agent' | 'equipment_extraction'
 * @param {string} params.model - nom del model Claude
 * @param {number} params.inputTokens
 * @param {number} params.outputTokens
 * @param {string} [params.entityType] - 'email' | 'invoice' | 'equipment'
 * @param {string} [params.entityId]
 * @param {boolean} [params.success=true]
 * @param {Object} [params.metadata]
 */
async function trackUsage({ service, model, inputTokens, outputTokens, entityType, entityId, success = true, metadata }) {
  try {
    const costUsd = calculateCost(model, inputTokens, outputTokens);

    await prisma.aiUsageLog.create({
      data: {
        service,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        entityType: entityType || null,
        entityId: entityId || null,
        success,
        metadata: metadata || null,
      },
    });

    logger.debug(`AI cost: ${service} [${model}] ${inputTokens}+${outputTokens} tokens = $${costUsd.toFixed(6)}`);
  } catch (err) {
    // No bloquejar mai per errors de tracking
    logger.warn(`AI cost tracker error: ${err.message}`);
  }
}

/**
 * Obté el resum de costos per un mes donat.
 * @param {number} year
 * @param {number} month - 1-12
 * @returns {Object} { total, byService: [...], byModel: [...], dailyBreakdown: [...] }
 */
async function getMonthlySummary(year, month) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1);

  const where = {
    timestamp: { gte: startDate, lt: endDate },
  };

  // Total
  const totals = await prisma.aiUsageLog.aggregate({
    where,
    _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    _count: { _all: true },
  });

  // Per servei
  const byService = await prisma.aiUsageLog.groupBy({
    by: ['service'],
    where,
    _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    _count: { _all: true },
  });

  // Per model
  const byModel = await prisma.aiUsageLog.groupBy({
    by: ['model'],
    where,
    _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    _count: { _all: true },
  });

  // Per dia (resum diari)
  const dailyRaw = await prisma.$queryRaw`
    SELECT
      DATE("timestamp") as date,
      "service",
      COUNT(*)::int as calls,
      SUM("inputTokens")::int as "inputTokens",
      SUM("outputTokens")::int as "outputTokens",
      ROUND(SUM("costUsd")::numeric, 6) as "costUsd"
    FROM "ai_usage_logs"
    WHERE "timestamp" >= ${startDate} AND "timestamp" < ${endDate}
    GROUP BY DATE("timestamp"), "service"
    ORDER BY date ASC, "service"
  `;

  // Errors
  const errorCount = await prisma.aiUsageLog.count({
    where: { ...where, success: false },
  });

  return {
    period: `${year}-${String(month).padStart(2, '0')}`,
    total: {
      calls: totals._count._all,
      inputTokens: totals._sum.inputTokens || 0,
      outputTokens: totals._sum.outputTokens || 0,
      costUsd: Math.round((totals._sum.costUsd || 0) * 1_000_000) / 1_000_000,
      errors: errorCount,
    },
    byService: byService.map((s) => ({
      service: s.service,
      calls: s._count._all,
      inputTokens: s._sum.inputTokens || 0,
      outputTokens: s._sum.outputTokens || 0,
      costUsd: Math.round((s._sum.costUsd || 0) * 1_000_000) / 1_000_000,
    })),
    byModel: byModel.map((m) => ({
      model: m.model,
      calls: m._count._all,
      inputTokens: m._sum.inputTokens || 0,
      outputTokens: m._sum.outputTokens || 0,
      costUsd: Math.round((m._sum.costUsd || 0) * 1_000_000) / 1_000_000,
    })),
    dailyBreakdown: dailyRaw,
  };
}

module.exports = {
  trackUsage,
  calculateCost,
  getMonthlySummary,
  PRICING,
};
