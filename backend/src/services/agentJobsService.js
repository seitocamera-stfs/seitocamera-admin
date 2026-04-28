/**
 * SERVEI DE JOBS AUTOMÀTICS DE L'AGENT COMPTABLE
 *
 * Executa tasques periòdiques en segon pla:
 *   1. Classificar factures noves sense classificar
 *   2. Detectar anomalies en factures recents
 *   3. Detectar possibles duplicats
 *   4. Alertar de factures pròximes a vèncer
 *   5. Proposar conciliacions bancàries
 */

const cron = require('node-cron');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');
const agent = require('./accountingAgentService');

// ===========================================
// Configuració per defecte dels jobs
// ===========================================

const DEFAULT_JOBS = [
  {
    jobType: 'classify',
    label: 'Classificar factures',
    description: 'Classifica automàticament factures noves sense compte PGC assignat',
    cronSchedule: '0 */3 * * *', // cada 3 hores
  },
  {
    jobType: 'anomalies',
    label: 'Detectar anomalies',
    description: 'Revisa factures recents buscant IVA incorrecte, imports inusuals, dades incompletes',
    cronSchedule: '30 8 * * 1-5', // dilluns a divendres a les 8:30
  },
  {
    jobType: 'duplicates',
    label: 'Detectar duplicats',
    description: 'Busca factures amb el mateix número/proveïdor/import que podrien ser duplicades',
    cronSchedule: '0 9 * * *', // cada dia a les 9
  },
  {
    jobType: 'overdue',
    label: 'Alertar venciments',
    description: 'Crea alertes per factures pendents que vencen en els pròxims 7 dies',
    cronSchedule: '0 8 * * 1-5', // dilluns a divendres a les 8
  },
  {
    jobType: 'conciliation',
    label: 'Proposar conciliacions',
    description: 'Busca moviments bancaris que coincideixin amb factures per proposar conciliació',
    cronSchedule: '0 10 * * 1-5', // dilluns a divendres a les 10
  },
];

// Referència als cron jobs actius
const activeJobs = {};

// ===========================================
// Funcions dels jobs
// ===========================================

/**
 * Job: Classificar factures sense classificar
 */
async function runClassify() {
  const startTime = Date.now();
  const job = await prisma.agentJob.create({
    data: { jobType: 'classify', status: 'running' },
  });

  try {
    const unclassified = await agent.getUnclassifiedInvoices(10);

    if (unclassified.length === 0) {
      await prisma.agentJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          itemsProcessed: 0,
          summary: 'Cap factura per classificar',
          durationMs: Date.now() - startTime,
          completedAt: new Date(),
        },
      });
      return;
    }

    let created = 0;
    const details = [];

    for (const invoice of unclassified) {
      try {
        const classification = await agent.classifyInvoice(invoice.id);

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

        created++;
        details.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          supplier: invoice.supplier?.name,
          result: `${classification.pgcAccount} (${classification.confidence * 100}%)`,
        });
      } catch (err) {
        details.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          error: err.message,
        });
      }
    }

    await prisma.agentJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        itemsProcessed: unclassified.length,
        itemsCreated: created,
        summary: `${created}/${unclassified.length} factures classificades`,
        details,
        durationMs: Date.now() - startTime,
        completedAt: new Date(),
      },
    });

    logger.info(`[Agent Job] classify: ${created}/${unclassified.length} factures classificades`);
  } catch (err) {
    await prisma.agentJob.update({
      where: { id: job.id },
      data: { status: 'failed', error: err.message, durationMs: Date.now() - startTime, completedAt: new Date() },
    });
    logger.error(`[Agent Job] classify error: ${err.message}`);
  }
}

/**
 * Job: Detectar anomalies en factures recents
 */
async function runAnomalies() {
  const startTime = Date.now();
  const job = await prisma.agentJob.create({
    data: { jobType: 'anomalies', status: 'running' },
  });

  try {
    // Factures dels últims 7 dies sense suggeriments d'anomalia
    const recent = await prisma.receivedInvoice.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
        status: { notIn: ['REJECTED'] },
        agentSuggestions: { none: { type: { in: ['ANOMALY', 'TAX_WARNING', 'DUPLICATE', 'MISSING_DATA'] } } },
      },
      select: { id: true },
      take: 20,
    });

    if (recent.length === 0) {
      await prisma.agentJob.update({
        where: { id: job.id },
        data: { status: 'completed', itemsProcessed: 0, summary: 'Cap factura nova per revisar', durationMs: Date.now() - startTime, completedAt: new Date() },
      });
      return;
    }

    const invoiceIds = recent.map((r) => r.id);
    const anomalies = await agent.analyzeAnomalies(invoiceIds);

    let created = 0;
    for (const anomaly of anomalies) {
      try {
        await prisma.agentSuggestion.create({
          data: {
            receivedInvoiceId: invoiceIds[0],
            type: anomaly.type || 'ANOMALY',
            title: anomaly.title,
            description: anomaly.description,
            confidence: anomaly.confidence || 0.7,
            reasoning: anomaly.description,
          },
        });
        created++;
      } catch {}
    }

    await prisma.agentJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        itemsProcessed: recent.length,
        itemsCreated: created,
        summary: `${recent.length} factures revisades, ${created} anomalies detectades`,
        durationMs: Date.now() - startTime,
        completedAt: new Date(),
      },
    });

    logger.info(`[Agent Job] anomalies: ${created} anomalies en ${recent.length} factures`);
  } catch (err) {
    await prisma.agentJob.update({
      where: { id: job.id },
      data: { status: 'failed', error: err.message, durationMs: Date.now() - startTime, completedAt: new Date() },
    });
    logger.error(`[Agent Job] anomalies error: ${err.message}`);
  }
}

/**
 * Job: Detectar possibles duplicats
 */
async function runDuplicates() {
  const startTime = Date.now();
  const job = await prisma.agentJob.create({
    data: { jobType: 'duplicates', status: 'running' },
  });

  try {
    // Buscar factures amb el mateix número i proveïdor
    const duplicates = await prisma.$queryRaw`
      SELECT a.id as "id1", b.id as "id2",
             a."invoiceNumber", a."supplierId",
             a."totalAmount" as "amount1", b."totalAmount" as "amount2",
             a."issueDate" as "date1", b."issueDate" as "date2"
      FROM "received_invoices" a
      JOIN "received_invoices" b ON a."invoiceNumber" = b."invoiceNumber"
        AND a."supplierId" = b."supplierId"
        AND a.id < b.id
      WHERE a.status != 'REJECTED' AND b.status != 'REJECTED'
        AND a."isDuplicate" = false AND b."isDuplicate" = false
        AND a."createdAt" > NOW() - INTERVAL '30 days'
      LIMIT 20
    `;

    let created = 0;
    for (const dup of duplicates) {
      // Comprovar si ja hi ha un suggeriment de duplicat per aquesta parella
      const existing = await prisma.agentSuggestion.findFirst({
        where: {
          receivedInvoiceId: dup.id2,
          type: 'DUPLICATE',
          status: 'PENDING',
        },
      });
      if (existing) continue;

      const supplier = await prisma.supplier.findUnique({
        where: { id: dup.supplierId },
        select: { name: true },
      });

      const sameAmount = parseFloat(dup.amount1) === parseFloat(dup.amount2);

      await prisma.agentSuggestion.create({
        data: {
          receivedInvoiceId: dup.id2,
          type: 'DUPLICATE',
          title: `Possible duplicat: ${dup.invoiceNumber} (${supplier?.name || '?'})`,
          description: sameAmount
            ? `Dues factures amb el mateix número (${dup.invoiceNumber}), proveïdor i import (${dup.amount2}€). Probablement duplicada.`
            : `Dues factures amb el mateix número (${dup.invoiceNumber}) i proveïdor però import diferent (${dup.amount1}€ vs ${dup.amount2}€). Revisar quina és correcta.`,
          confidence: sameAmount ? 0.95 : 0.75,
          reasoning: `Factura ${dup.invoiceNumber} apareix dues vegades per ${supplier?.name}`,
          suggestedValue: { duplicateOfId: dup.id1, sameAmount },
        },
      });
      created++;
    }

    await prisma.agentJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        itemsProcessed: duplicates.length,
        itemsCreated: created,
        summary: created > 0 ? `${created} possibles duplicats trobats` : 'Cap duplicat detectat',
        durationMs: Date.now() - startTime,
        completedAt: new Date(),
      },
    });

    logger.info(`[Agent Job] duplicates: ${created} duplicats trobats`);
  } catch (err) {
    await prisma.agentJob.update({
      where: { id: job.id },
      data: { status: 'failed', error: err.message, durationMs: Date.now() - startTime, completedAt: new Date() },
    });
    logger.error(`[Agent Job] duplicates error: ${err.message}`);
  }
}

/**
 * Job: Alertar factures pròximes a vèncer
 */
async function runOverdue() {
  const startTime = Date.now();
  const job = await prisma.agentJob.create({
    data: { jobType: 'overdue', status: 'running' },
  });

  try {
    const now = new Date();
    const in7days = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

    // Factures que vencen en 7 dies o ja estan vençudes
    const overdue = await prisma.receivedInvoice.findMany({
      where: {
        status: { notIn: ['PAID', 'REJECTED'] },
        dueDate: { lte: in7days },
        conciliations: { none: { status: { in: ['CONFIRMED', 'MANUAL_MATCHED'] } } },
      },
      include: { supplier: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
      take: 30,
    });

    let created = 0;
    for (const inv of overdue) {
      // No crear duplicat si ja hi ha alerta pendent
      const existing = await prisma.agentSuggestion.findFirst({
        where: { receivedInvoiceId: inv.id, type: 'ANOMALY', status: 'PENDING', title: { contains: 'venciment' } },
      });
      if (existing) continue;

      const isOverdue = inv.dueDate < now;
      const daysUntil = Math.ceil((inv.dueDate - now) / (24 * 3600 * 1000));

      await prisma.agentSuggestion.create({
        data: {
          receivedInvoiceId: inv.id,
          type: 'ANOMALY',
          title: isOverdue
            ? `⚠️ Venciment passat: ${inv.invoiceNumber} (${inv.supplier?.name})`
            : `Venciment proper: ${inv.invoiceNumber} (${inv.supplier?.name})`,
          description: isOverdue
            ? `Factura ${inv.invoiceNumber} de ${inv.supplier?.name} per ${inv.totalAmount}€ va vèncer fa ${Math.abs(daysUntil)} dies. Pendent de pagament.`
            : `Factura ${inv.invoiceNumber} de ${inv.supplier?.name} per ${inv.totalAmount}€ venç en ${daysUntil} dies (${inv.dueDate.toISOString().split('T')[0]}).`,
          confidence: isOverdue ? 1.0 : 0.9,
          reasoning: `Data venciment: ${inv.dueDate.toISOString().split('T')[0]}`,
        },
      });
      created++;
    }

    await prisma.agentJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        itemsProcessed: overdue.length,
        itemsCreated: created,
        summary: created > 0 ? `${created} alertes de venciment creades (${overdue.length} factures revisades)` : 'Totes les factures al dia',
        durationMs: Date.now() - startTime,
        completedAt: new Date(),
      },
    });

    logger.info(`[Agent Job] overdue: ${created} alertes de ${overdue.length} factures`);
  } catch (err) {
    await prisma.agentJob.update({
      where: { id: job.id },
      data: { status: 'failed', error: err.message, durationMs: Date.now() - startTime, completedAt: new Date() },
    });
    logger.error(`[Agent Job] overdue error: ${err.message}`);
  }
}

/**
 * Job: Proposar conciliacions automàtiques
 */
async function runConciliation() {
  const startTime = Date.now();
  const job = await prisma.agentJob.create({
    data: { jobType: 'conciliation', status: 'running' },
  });

  try {
    // Moviments bancaris no conciliats (despeses)
    const movements = await prisma.bankMovement.findMany({
      where: { isConciliated: false, type: 'DEBIT' },
      orderBy: { date: 'desc' },
      take: 50,
    });

    // Factures sense conciliar
    const invoices = await prisma.receivedInvoice.findMany({
      where: {
        status: { notIn: ['PAID', 'REJECTED'] },
        conciliations: { none: {} },
      },
      include: { supplier: { select: { name: true } } },
    });

    let created = 0;
    const matched = [];

    for (const mov of movements) {
      const amount = Math.abs(parseFloat(mov.amount));

      // Buscar factura amb import exacte (o molt proper, ±0.05€)
      const match = invoices.find((inv) => {
        const invAmount = parseFloat(inv.totalAmount);
        return Math.abs(invAmount - amount) < 0.05;
      });

      if (match) {
        // Comprovar si ja existeix un suggeriment
        const existing = await prisma.agentSuggestion.findFirst({
          where: { receivedInvoiceId: match.id, type: 'CONCILIATION_MATCH', status: 'PENDING' },
        });
        if (existing) continue;

        await prisma.agentSuggestion.create({
          data: {
            receivedInvoiceId: match.id,
            type: 'CONCILIATION_MATCH',
            title: `Conciliar: ${match.invoiceNumber} ↔ moviment ${mov.date.toISOString().split('T')[0]}`,
            description: `Factura ${match.invoiceNumber} (${match.supplier?.name}, ${match.totalAmount}€) coincideix amb moviment bancari del ${mov.date.toISOString().split('T')[0]} (${mov.amount}€): "${mov.description?.substring(0, 80)}"`,
            confidence: 0.85,
            reasoning: `Import coincident: factura ${match.totalAmount}€ ≈ moviment ${Math.abs(mov.amount)}€`,
            suggestedValue: { bankMovementId: mov.id, invoiceId: match.id },
          },
        });
        created++;
        matched.push({ invoiceId: match.id, movementId: mov.id, amount });
      }
    }

    await prisma.agentJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        itemsProcessed: movements.length,
        itemsCreated: created,
        summary: created > 0 ? `${created} possibles conciliacions proposades` : `${movements.length} moviments revisats, cap coincidència`,
        details: matched.length > 0 ? matched : null,
        durationMs: Date.now() - startTime,
        completedAt: new Date(),
      },
    });

    logger.info(`[Agent Job] conciliation: ${created} propostes de ${movements.length} moviments`);
  } catch (err) {
    await prisma.agentJob.update({
      where: { id: job.id },
      data: { status: 'failed', error: err.message, durationMs: Date.now() - startTime, completedAt: new Date() },
    });
    logger.error(`[Agent Job] conciliation error: ${err.message}`);
  }
}

// ===========================================
// Mapa de funcions
// ===========================================

const JOB_FUNCTIONS = {
  classify: runClassify,
  anomalies: runAnomalies,
  duplicates: runDuplicates,
  overdue: runOverdue,
  conciliation: runConciliation,
};

// ===========================================
// Inicialització i gestió de cron jobs
// ===========================================

/**
 * Inicialitza els jobs al arrencar el servidor
 */
async function initJobs() {
  try {
    // Crear configs per defecte si no existeixen
    for (const def of DEFAULT_JOBS) {
      await prisma.agentJobConfig.upsert({
        where: { jobType: def.jobType },
        create: def,
        update: {}, // no sobreescriure si ja existeix
      });
    }

    // Programar tots els jobs actius
    const configs = await prisma.agentJobConfig.findMany({ where: { isEnabled: true } });

    for (const config of configs) {
      scheduleJob(config);
    }

    logger.info(`[Agent Jobs] ${configs.length} jobs programats`);
  } catch (err) {
    logger.error(`[Agent Jobs] Error inicialitzant: ${err.message}`);
  }
}

/**
 * Programa un job individual
 */
function scheduleJob(config) {
  // Aturar si ja estava programat
  if (activeJobs[config.jobType]) {
    activeJobs[config.jobType].stop();
    delete activeJobs[config.jobType];
  }

  const fn = JOB_FUNCTIONS[config.jobType];
  if (!fn) {
    logger.warn(`[Agent Jobs] Job desconegut: ${config.jobType}`);
    return;
  }

  if (!cron.validate(config.cronSchedule)) {
    logger.warn(`[Agent Jobs] Cron invàlid per ${config.jobType}: ${config.cronSchedule}`);
    return;
  }

  activeJobs[config.jobType] = cron.schedule(config.cronSchedule, async () => {
    logger.info(`[Agent Jobs] Executant ${config.jobType}...`);
    try {
      await fn();
      await prisma.agentJobConfig.update({
        where: { jobType: config.jobType },
        data: { lastRunAt: new Date() },
      });
    } catch (err) {
      logger.error(`[Agent Jobs] Error executant ${config.jobType}: ${err.message}`);
    }
  });

  logger.info(`[Agent Jobs] Programat ${config.jobType} amb schedule: ${config.cronSchedule}`);
}

/**
 * Reprograma un job (quan canvia la config)
 */
async function rescheduleJob(jobType) {
  const config = await prisma.agentJobConfig.findUnique({ where: { jobType } });
  if (!config) return;

  if (config.isEnabled) {
    scheduleJob(config);
  } else {
    if (activeJobs[jobType]) {
      activeJobs[jobType].stop();
      delete activeJobs[jobType];
    }
  }
}

/**
 * Executa un job manualment (sense esperar al cron)
 */
async function runJobManually(jobType) {
  const fn = JOB_FUNCTIONS[jobType];
  if (!fn) throw new Error(`Job desconegut: ${jobType}`);
  await fn();
  await prisma.agentJobConfig.update({
    where: { jobType },
    data: { lastRunAt: new Date() },
  });
}

module.exports = {
  initJobs,
  rescheduleJob,
  runJobManually,
  JOB_FUNCTIONS,
};
