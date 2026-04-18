const cron = require('node-cron');
const { logger } = require('../config/logger');
const { redis } = require('../config/redis');
const qontoSync = require('../services/qontoSyncService');

// ===========================================
// Cron Job: Sincronització Qonto → Moviments Bancaris
// ===========================================
//
// FLUX:
//   1. Cada 30 min (dies laborables 8-21h) llegeix el Google Sheet de Qonto
//   2. Importa les transaccions noves (deduplicació per qontoSlug)
//   3. Guarda l'últim resultat a Redis per mostrar-lo al frontend
//
// EXECUCIÓ MANUAL: POST /api/bank/qonto/sync
// ===========================================

const REDIS_LAST_SYNC_KEY = 'qonto:lastSync';

/**
 * Executa la sincronització de Qonto
 * @param {Object} options - { fullSync: boolean }
 * @returns {Object} Resultat de la sincronització
 */
async function runQontoSync(options = {}) {
  const startTime = Date.now();

  try {
    logger.info('Qonto sync job: Iniciant sincronització...');

    const result = await qontoSync.syncQontoTransactions(options);

    const syncResult = {
      ...result,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      success: true,
    };

    // Guardar resultat a Redis (expira en 7 dies)
    try {
      await redis.set(REDIS_LAST_SYNC_KEY, JSON.stringify(syncResult), 'EX', 7 * 24 * 3600);
    } catch (redisErr) {
      logger.warn(`Qonto sync: No s'ha pogut guardar resultat a Redis: ${redisErr.message}`);
    }

    if (result.created > 0) {
      logger.info(`Qonto sync job: ${result.created} nous moviments importats`);
    } else {
      logger.info(`Qonto sync job: Tot actualitzat (${result.skipped} omesos)`);
    }

    return syncResult;
  } catch (err) {
    const errorResult = {
      success: false,
      error: err.message,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };

    try {
      await redis.set(REDIS_LAST_SYNC_KEY, JSON.stringify(errorResult), 'EX', 7 * 24 * 3600);
    } catch {}

    logger.error(`Qonto sync job: Error — ${err.message}`);
    return errorResult;
  }
}

/**
 * Obté l'últim resultat de sincronització
 */
async function getLastSyncResult() {
  try {
    const data = await redis.get(REDIS_LAST_SYNC_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Inicia el cron job de sincronització Qonto
 */
function startQontoBankSyncJob() {
  // Cada 30 minuts, dies laborables (Dill-Div), de 8h a 21h
  const task = cron.schedule('*/30 8-21 * * 1-5', async () => {
    await runQontoSync();
  }, {
    timezone: 'Europe/Madrid',
  });

  logger.info('Qonto bank sync job programat: cada 30 min (Dl-Dv 8-21h)');

  // Sync inicial al arrencar (amb delay de 30s per donar temps a que tot estigui llest)
  setTimeout(async () => {
    logger.info('Qonto sync job: Sincronització inicial...');
    await runQontoSync();
  }, 30000);

  return task;
}

module.exports = {
  startQontoBankSyncJob,
  runQontoSync,
  getLastSyncResult,
};
