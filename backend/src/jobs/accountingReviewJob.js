/**
 * JOB DE REVISIÓ COMPTABLE AUTOMÀTICA
 *
 * Executa periòdicament:
 *   1. Classifica factures noves sense classificar
 *   2. Detecta anomalies en factures recents
 *   3. Crea suggeriments per l'usuari
 *
 * Freqüència: cada 6 hores (dies laborables)
 */

const cron = require('node-cron');
const { logger } = require('../config/logger');
const { prisma } = require('../config/database');

const BATCH_SIZE = 10; // Factures per lot (limitar cost API)

/**
 * Executa la revisió automàtica
 */
async function runAccountingReview() {
  // Verificar que la clau API està configurada
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.info('Accounting review: ANTHROPIC_API_KEY no configurada, saltant revisió');
    return { skipped: true, reason: 'no_api_key' };
  }

  const agent = require('../services/accountingAgentService');
  const results = { classified: 0, anomalies: 0, errors: 0 };

  try {
    // 1) Classificar factures sense classificar
    const unclassified = await agent.getUnclassifiedInvoices(BATCH_SIZE);

    if (unclassified.length > 0) {
      logger.info(`Accounting review: ${unclassified.length} factures per classificar`);

      for (const invoice of unclassified) {
        try {
          // Comprovar si ja té un suggeriment pendent
          const existing = await prisma.agentSuggestion.findFirst({
            where: {
              receivedInvoiceId: invoice.id,
              type: 'CLASSIFICATION',
              status: 'PENDING',
            },
          });
          if (existing) continue; // Ja té suggeriment pendent

          const classification = await agent.classifyInvoice(invoice.id);

          // Si la confiança és alta (>0.85), aplicar directament
          if (classification.confidence >= 0.85) {
            await prisma.receivedInvoice.update({
              where: { id: invoice.id },
              data: {
                accountingType: classification.accountingType,
                pgcAccount: classification.pgcAccount,
                pgcAccountName: classification.pgcAccountName,
                classifiedBy: 'AGENT_AUTO',
                classifiedAt: new Date(),
              },
            });

            await prisma.agentSuggestion.create({
              data: {
                receivedInvoiceId: invoice.id,
                type: 'CLASSIFICATION',
                status: 'ACCEPTED',
                title: `${classification.accountingType === 'INVESTMENT' ? 'Inversió' : 'Despesa'}: ${classification.pgcAccount} ${classification.pgcAccountName}`,
                description: classification.reasoning,
                suggestedValue: {
                  accountingType: classification.accountingType,
                  pgcAccount: classification.pgcAccount,
                  pgcAccountName: classification.pgcAccountName,
                },
                confidence: classification.confidence,
                reasoning: classification.reasoning,
                resolvedBy: 'auto',
                resolvedAt: new Date(),
              },
            });
          } else {
            // Crear suggeriment per revisió manual
            await prisma.agentSuggestion.create({
              data: {
                receivedInvoiceId: invoice.id,
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
          }

          results.classified++;
        } catch (err) {
          logger.error(`Accounting review: Error classificant ${invoice.invoiceNumber}: ${err.message}`);
          results.errors++;
        }

        // Pausa entre crides per no saturar l'API
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // 2) Detectar anomalies en factures recents (últimes 24h) no revisades
    const recentInvoices = await prisma.receivedInvoice.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
        status: { notIn: ['REJECTED'] },
        agentSuggestions: { none: { type: { in: ['ANOMALY', 'TAX_WARNING', 'MISSING_DATA'] } } },
      },
      select: { id: true },
      take: BATCH_SIZE,
    });

    if (recentInvoices.length > 0) {
      try {
        // Obtenir les factures completes per fer match per invoiceNumber
        const recentFull = await prisma.receivedInvoice.findMany({
          where: { id: { in: recentInvoices.map((r) => r.id) } },
          select: { id: true, invoiceNumber: true },
        });
        const invoiceByNumber = new Map(recentFull.map((inv) => [inv.invoiceNumber, inv.id]));

        const anomalies = await agent.analyzeAnomalies(recentInvoices.map((r) => r.id));
        results.anomalies = anomalies.length;

        for (const anomaly of anomalies) {
          // Buscar la factura correcta per invoiceNumber retornat pel LLM
          let targetInvoiceId = recentFull[0]?.id; // fallback al primer
          if (anomaly.invoiceNumber) {
            const matched = invoiceByNumber.get(anomaly.invoiceNumber);
            if (matched) {
              targetInvoiceId = matched;
            } else {
              // Intentar match parcial (per si el LLM afegeix/treu espais)
              for (const [num, id] of invoiceByNumber) {
                if (num.includes(anomaly.invoiceNumber) || anomaly.invoiceNumber.includes(num)) {
                  targetInvoiceId = id;
                  break;
                }
              }
            }
          }

          await prisma.agentSuggestion.create({
            data: {
              receivedInvoiceId: targetInvoiceId,
              type: anomaly.type || 'ANOMALY',
              title: anomaly.title,
              description: anomaly.description,
              confidence: anomaly.confidence || 0.7,
              reasoning: anomaly.description,
            },
          });
        }
      } catch (err) {
        logger.error(`Accounting review: Error analitzant anomalies: ${err.message}`);
        results.errors++;
      }
    }

    logger.info(`Accounting review completat: ${results.classified} classificades, ${results.anomalies} anomalies, ${results.errors} errors`);
    return results;
  } catch (error) {
    logger.error('Accounting review error fatal:', error.message);
    return { ...results, error: error.message };
  }
}

/**
 * Inicia el cron job
 * Cada 6 hores, dies laborables (dilluns-divendres), 8-20h
 */
function startAccountingReviewJob() {
  // Cada 6 hores: 8:00, 14:00, 20:00
  cron.schedule('0 8,14,20 * * 1-5', async () => {
    logger.info('Accounting review: iniciant revisió programada...');
    await runAccountingReview();
  }, { timezone: 'Europe/Madrid' });

  logger.info('Accounting review job programat (8:00, 14:00, 20:00 L-V)');
}

module.exports = {
  startAccountingReviewJob,
  runAccountingReview,
};
