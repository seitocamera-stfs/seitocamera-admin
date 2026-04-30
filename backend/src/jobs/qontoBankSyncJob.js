const cron = require('node-cron');
const { logger } = require('../config/logger');
const { redis } = require('../config/redis');
const { prisma } = require('../config/database');

// ===========================================
// Cron Job: Sincronització Bancària Automàtica
// ===========================================
//
// Suporta múltiples tipus de sincronització:
//   - QONTO: API directa v2 (qontoApiService)
//   - OPEN_BANKING: GoCardless / Nordigen (openBankingService)
//
// FLUX:
//   1. Cada 30 min (dies laborables 8-21h) busca comptes amb sync automàtic
//   2. Per cada compte, crida el servei corresponent
//   3. Guarda resultats a Redis per frontend
//
// EXECUCIÓ MANUAL: POST /api/bank-accounts/:id/sync
// ===========================================

const REDIS_LAST_SYNC_KEY = 'bank:lastSync';
const REDIS_LOCK_KEY = 'bank:sync:lock';
const MAX_RUN_SECONDS = 1800; // 30 min

/**
 * Executa la sincronització de tots els comptes amb sync automàtic
 */
async function runBankSync(options = {}) {
  // Guard: evitar execucions concurrents amb Redis lock (segur amb múltiples processos)
  try {
    const locked = await redis.set(REDIS_LOCK_KEY, Date.now().toString(), 'EX', MAX_RUN_SECONDS, 'NX');
    if (!locked) {
      const lockTime = await redis.get(REDIS_LOCK_KEY);
      const elapsed = lockTime ? (Date.now() - parseInt(lockTime)) / 60000 : 0;
      if (elapsed < MAX_RUN_SECONDS / 60) {
        logger.info('Bank sync: ja en execució, saltant');
        return { skipped: true };
      }
      logger.warn(`Bank sync: lock antic (${elapsed.toFixed(0)} min), forçant reset`);
      await redis.del(REDIS_LOCK_KEY);
      await redis.set(REDIS_LOCK_KEY, Date.now().toString(), 'EX', MAX_RUN_SECONDS, 'NX');
    }
  } catch (lockErr) {
    logger.warn('Bank sync: Redis lock no disponible, continuant amb precaució:', lockErr.message);
  }

  const startTime = Date.now();
  const results = [];

  try {
    // Trobar tots els comptes actius amb sincronització automàtica
    const accounts = await prisma.bankAccount.findMany({
      where: {
        isActive: true,
        syncType: { in: ['QONTO', 'OPEN_BANKING'] },
      },
    });

    if (accounts.length === 0) {
      logger.info('Bank sync job: Cap compte amb sync automàtic configurat');
      // Fallback: provar sync antic de Qonto per compatibilitat
      try {
        const qontoSync = require('../services/qontoSyncService');
        const result = await qontoSync.syncQontoTransactions(options);
        results.push({ account: 'Qonto (legacy)', ...result });
      } catch (legacyErr) {
        logger.warn(`Bank sync: Fallback legacy Qonto fallit: ${legacyErr.message}`);
      }
    }

    for (const account of accounts) {
      try {
        logger.info(`Bank sync: Sincronitzant ${account.name} (${account.syncType})...`);
        let result;

        if (account.syncType === 'QONTO') {
          const qontoApi = require('../services/qontoApiService');
          result = await qontoApi.syncTransactions({
            bankAccountId: account.id,
            fullSync: options.fullSync || false,
          });
        } else if (account.syncType === 'OPEN_BANKING') {
          try {
            const openBanking = require('../services/openBankingService');
            if (typeof openBanking.syncTransactions === 'function') {
              result = await openBanking.syncTransactions({
                bankAccountId: account.id,
                fullSync: options.fullSync || false,
              });
            } else {
              logger.warn(`Bank sync [${account.name}]: OPEN_BANKING sync no implementat`);
              result = { created: 0, skipped: 0, errors: 0, message: 'Not implemented' };
            }
          } catch (obErr) {
            logger.warn(`Bank sync [${account.name}]: OPEN_BANKING no disponible: ${obErr.message}`);
            result = { created: 0, skipped: 0, errors: 1, message: obErr.message };
          }
        }

        if (result) {
          // Actualitzar lastSyncAt
          await prisma.bankAccount.update({
            where: { id: account.id },
            data: {
              lastSyncAt: new Date(),
              lastSyncError: result.errors > 0 ? `${result.errors} errors` : null,
            },
          });

          results.push({
            accountId: account.id,
            accountName: account.name,
            syncType: account.syncType,
            ...result,
          });

          if (result.created > 0) {
            logger.info(`Bank sync [${account.name}]: ${result.created} nous moviments`);
          } else {
            logger.info(`Bank sync [${account.name}]: Tot actualitzat (${result.skipped} omesos)`);
          }
        }
      } catch (accErr) {
        logger.error(`Bank sync [${account.name}]: Error — ${accErr.message}`);
        // Guardar error al compte
        try {
          await prisma.bankAccount.update({
            where: { id: account.id },
            data: { lastSyncError: accErr.message },
          });
        } catch (e) { /* ignore */ }

        results.push({
          accountId: account.id,
          accountName: account.name,
          syncType: account.syncType,
          success: false,
          error: accErr.message,
        });
      }
    }

    const syncResult = {
      accounts: results,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      success: true,
      // Totals
      totalCreated: results.reduce((s, r) => s + (r.created || 0), 0),
      totalSkipped: results.reduce((s, r) => s + (r.skipped || 0), 0),
      totalErrors: results.reduce((s, r) => s + (r.errors || 0), 0),
    };

    // Guardar resultat a Redis
    try {
      await redis.set(REDIS_LAST_SYNC_KEY, JSON.stringify(syncResult), 'EX', 7 * 24 * 3600);
    } catch (redisErr) {
      logger.warn(`Bank sync: No s'ha pogut guardar resultat a Redis: ${redisErr.message}`);
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

    logger.error(`Bank sync job: Error — ${err.message}`);
    return errorResult;
  } finally {
    try { await redis.del(REDIS_LOCK_KEY); } catch {}
  }
}

// Compatibilitat amb codi antic
async function runQontoSync(options = {}) {
  return runBankSync(options);
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
 * Inicia el cron job de sincronització bancària
 */
function startQontoBankSyncJob() {
  // Cada 30 minuts, dies laborables (Dill-Div), de 8h a 21h
  const task = cron.schedule('*/30 8-21 * * 1-5', async () => {
    try {
      await runBankSync();
    } catch (err) {
      logger.error(`Bank sync cron error: ${err.message}`);
    }
  }, {
    timezone: 'Europe/Madrid',
  });

  logger.info('Bank sync job programat: cada 30 min (Dl-Dv 8-21h)');

  // Sync inicial al arrencar (amb delay de 30s)
  setTimeout(async () => {
    logger.info('Bank sync job: Sincronització inicial...');
    try {
      await runBankSync();
    } catch (err) {
      logger.error(`Bank sync inicial error: ${err.message}`);
    }
  }, 30000);

  return task;
}

module.exports = {
  startQontoBankSyncJob,
  runQontoSync,
  runBankSync,
  getLastSyncResult,
};
