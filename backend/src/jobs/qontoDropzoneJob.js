const cron = require('node-cron');
const { logger } = require('../config/logger');
const { redis } = require('../config/redis');
const { prisma } = require('../config/database');

// ===========================================
// Cron Job: Qonto Dropzone — Justificants automàtics
// ===========================================
//
// Revisa moviments de Qonto que NO tenen justificant (attachment_ids buit),
// busca si a la BD hi ha una conciliació confirmada amb una factura que
// tingui gdriveFileId, i si coincideix, copia el PDF a la carpeta Dropzone
// de Qonto Connect perquè s'associï automàticament.
//
// FREQÜÈNCIA: Cada hora (dies laborables 8-20h)
// ===========================================

const REDIS_LOCK_KEY = 'qonto:dropzone:lock';
const REDIS_LAST_RUN_KEY = 'qonto:dropzone:lastRun';
const MAX_RUN_SECONDS = 600; // 10 min

/**
 * Executa la revisió de moviments sense justificant i copia factures conciliades
 */
async function runDropzoneSync() {
  // Lock per evitar execucions concurrents
  try {
    const locked = await redis.set(REDIS_LOCK_KEY, Date.now().toString(), 'EX', MAX_RUN_SECONDS, 'NX');
    if (!locked) {
      logger.info('Qonto Dropzone: ja en execució, saltant');
      return { skipped: true };
    }
  } catch (lockErr) {
    logger.warn('Qonto Dropzone: Redis lock no disponible, continuant:', lockErr.message);
  }

  const startTime = Date.now();
  let copied = 0, alreadySent = 0, noInvoice = 0, errors = 0;

  try {
    // Obtenir la carpeta Dropzone
    const gdrive = require('../services/gdriveService');
    const dropzoneFolderId = process.env.QONTO_DROPZONE_FOLDER_ID
      || await gdrive.findFolderByName('Dropzone');

    if (!dropzoneFolderId) {
      logger.warn('Qonto Dropzone: Carpeta Dropzone no trobada. Configura QONTO_DROPZONE_FOLDER_ID al .env');
      return { success: false, error: 'Dropzone folder not found' };
    }

    // Buscar moviments de Qonto que:
    // 1. Tenen qontoSlug (vénen de Qonto)
    // 2. Estan conciliats (isConciliated = true)
    // 3. Tenen rawData amb attachment_ids buit (sense justificant a Qonto)
    // 4. No s'ha enviat ja (dropzoneSentAt és null)
    const movements = await prisma.bankMovement.findMany({
      where: {
        qontoSlug: { not: null },
        isConciliated: true,
        dropzoneSentAt: null, // Nou camp per marcar els ja processats
      },
      include: {
        conciliations: {
          where: {
            status: { in: ['AUTO_MATCHED', 'CONFIRMED'] },
            receivedInvoiceId: { not: null },
          },
          include: {
            receivedInvoice: {
              select: {
                id: true,
                gdriveFileId: true,
                invoiceNumber: true,
                totalAmount: true,
                supplier: { select: { name: true } },
              },
            },
          },
          take: 1, // Només ens cal la primera conciliació vàlida
        },
      },
      orderBy: { date: 'desc' },
      take: 100, // Processar en lots de 100
    });

    logger.info(`Qonto Dropzone: ${movements.length} moviments conciliats pendents de revisar`);

    for (const mov of movements) {
      try {
        // Verificar que el moviment de Qonto no té justificant
        const rawData = typeof mov.rawData === 'object' ? mov.rawData : {};
        const attachmentIds = rawData.attachment_ids || [];

        if (attachmentIds.length > 0) {
          // Ja té justificant a Qonto, marcar com a processat
          await prisma.bankMovement.update({
            where: { id: mov.id },
            data: { dropzoneSentAt: new Date() },
          });
          alreadySent++;
          continue;
        }

        // Buscar la conciliació amb factura
        const conciliation = mov.conciliations[0];
        if (!conciliation?.receivedInvoice?.gdriveFileId) {
          noInvoice++;
          continue;
        }

        const invoice = conciliation.receivedInvoice;

        // Copiar el PDF a la Dropzone
        const fileName = invoice.supplier?.name
          ? `${invoice.supplier.name} - ${invoice.invoiceNumber || 'sense-num'}.pdf`
          : `${invoice.invoiceNumber || mov.id}.pdf`;

        await gdrive.copyFile(invoice.gdriveFileId, dropzoneFolderId, fileName);

        // Marcar el moviment com a processat
        await prisma.bankMovement.update({
          where: { id: mov.id },
          data: { dropzoneSentAt: new Date() },
        });

        copied++;
        logger.info(`Qonto Dropzone: Copiat "${fileName}" per moviment ${mov.description} (${mov.qontoSlug})`);
      } catch (err) {
        errors++;
        logger.error(`Qonto Dropzone: Error processant moviment ${mov.id}: ${err.message}`);
      }
    }

    const result = {
      success: true,
      copied,
      alreadySent,
      noInvoice,
      errors,
      totalReviewed: movements.length,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };

    // Guardar resultat a Redis
    try {
      await redis.set(REDIS_LAST_RUN_KEY, JSON.stringify(result), 'EX', 7 * 24 * 3600);
    } catch {}

    if (copied > 0) {
      logger.info(`Qonto Dropzone: ${copied} factures copiades a Dropzone`);
    } else {
      logger.info(`Qonto Dropzone: Res a copiar (${alreadySent} ja enviats, ${noInvoice} sense factura)`);
    }

    return result;
  } catch (err) {
    logger.error(`Qonto Dropzone job error: ${err.message}`);
    return { success: false, error: err.message, durationMs: Date.now() - startTime };
  } finally {
    try { await redis.del(REDIS_LOCK_KEY); } catch {}
  }
}

/**
 * Obté l'últim resultat
 */
async function getLastDropzoneResult() {
  try {
    const data = await redis.get(REDIS_LAST_RUN_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Inicia el cron job
 */
function startQontoDropzoneJob() {
  // Cada hora, dies laborables (Dl-Dv), de 9h a 20h
  const task = cron.schedule('0 9-20 * * 1-5', async () => {
    try {
      await runDropzoneSync();
    } catch (err) {
      logger.error(`Qonto Dropzone cron error: ${err.message}`);
    }
  }, {
    timezone: 'Europe/Madrid',
  });

  logger.info('Qonto Dropzone job programat: cada hora (Dl-Dv 9-20h)');

  // Execució inicial amb delay de 60s (deixar que el bank sync acabi primer)
  setTimeout(async () => {
    logger.info('Qonto Dropzone: Execució inicial...');
    try {
      await runDropzoneSync();
    } catch (err) {
      logger.error(`Qonto Dropzone inicial error: ${err.message}`);
    }
  }, 60000);

  return task;
}

module.exports = {
  startQontoDropzoneJob,
  runDropzoneSync,
  getLastDropzoneResult,
};
