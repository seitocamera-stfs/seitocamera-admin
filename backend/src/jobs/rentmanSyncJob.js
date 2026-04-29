const cron = require('node-cron');
const { redis } = require('../config/redis');
const rentmanSync = require('../services/rentmanSyncService');
const { logger } = require('../config/logger');

// ===========================================
// Cron Job: Sincronització Rentman → Factures Emeses
// ===========================================
// - Sync incremental cada hora (9h-21h) — només factures dels últims 7 dies
// - Sync complet cada nit (03:30) — totes les factures (sense projecte per velocitat)
// - Sync complet amb projecte diumenge 04:00 (manteniment setmanal)
// ===========================================

let isRunning = false;
let runStartedAt = null;
const MAX_RUN_MINUTES = 30;

/**
 * Executa sync incremental: factures dels últims 7 dies, amb info de projecte.
 * Ideal per horari laboral: captura canvis de status (paid/pending) i factures noves.
 */
async function runIncrementalSync() {
  if (isRunning) {
    const elapsed = (Date.now() - runStartedAt) / 60000;
    if (elapsed < MAX_RUN_MINUTES) {
      logger.info('Rentman sync: ja s\'està executant, s\'omet');
      return;
    }
    logger.warn(`Rentman sync: lock antic (${elapsed.toFixed(0)} min), forçant reset`);
  }

  if (!process.env.RENTMAN_API_TOKEN) {
    return; // Rentman no configurat
  }

  isRunning = true;
  runStartedAt = Date.now();
  try {
    const result = await rentmanSync.syncAllInvoices({
      fetchProjects: true,
      onlyRecentDays: 7,
    });

    // Guardar timestamp i resultats a Redis
    await redis.set('rentman:lastSync', Date.now().toString());
    await redis.set('rentman:lastSyncResult', JSON.stringify(result), 'EX', 7 * 24 * 3600);

    if (result.created > 0 || result.updated > 0 || result.errors > 0) {
      logger.info(
        `Rentman cron incremental: +${result.created} creades, ~${result.updated} actualitzades, ${result.errors} errors`
      );
    }
  } catch (err) {
    logger.error(`Rentman cron incremental: error: ${err.message}`);
  } finally {
    isRunning = false;
  }
}

/**
 * Sync complet nocturn: totes les factures però SENSE consultar projecte
 * (per velocitat — el projecte ja l'haurà capturat l'incremental).
 */
async function runNightlyFullSync() {
  if (isRunning) {
    logger.info('Rentman nightly sync: un altre sync està en marxa, s\'omet');
    return;
  }

  if (!process.env.RENTMAN_API_TOKEN) return;

  isRunning = true;
  runStartedAt = Date.now();
  try {
    const result = await rentmanSync.syncAllInvoices({
      fetchProjects: false, // més ràpid; el sync incremental ja porta els projectes
      onlyRecentDays: null,
    });

    await redis.set('rentman:lastFullSync', Date.now().toString());
    await redis.set('rentman:lastFullSyncResult', JSON.stringify(result), 'EX', 30 * 24 * 3600);

    logger.info(
      `Rentman cron nocturn: +${result.created} creades, ~${result.updated} actualitzades, ${result.errors} errors (${result.durationSec}s)`
    );
  } catch (err) {
    logger.error(`Rentman cron nocturn: error: ${err.message}`);
  } finally {
    isRunning = false;
  }
}

/**
 * Sync setmanal amb projecte: una vegada per setmana sincronitza-ho tot
 * consultant els projectes (per si alguna referència ha canviat).
 */
async function runWeeklyProjectSync() {
  if (isRunning) {
    logger.info('Rentman weekly sync: un altre sync està en marxa, s\'omet');
    return;
  }

  if (!process.env.RENTMAN_API_TOKEN) return;

  isRunning = true;
  runStartedAt = Date.now();
  try {
    const result = await rentmanSync.syncAllInvoices({
      fetchProjects: true,
      onlyRecentDays: null,
    });

    await redis.set('rentman:lastWeeklySync', Date.now().toString());
    logger.info(
      `Rentman cron setmanal (amb projectes): +${result.created} creades, ~${result.updated} actualitzades, ${result.errors} errors (${result.durationSec}s)`
    );
  } catch (err) {
    logger.error(`Rentman cron setmanal: error: ${err.message}`);
  } finally {
    isRunning = false;
  }
}

/**
 * Inicialitza els cron jobs de Rentman
 */
function startRentmanSyncJob() {
  if (!process.env.RENTMAN_API_TOKEN) {
    logger.info('Rentman sync: No configurat (falta RENTMAN_API_TOKEN), cron desactivat');
    return null;
  }

  // 1. Incremental: cada hora en horari laboral (9-21h), dl-ds
  const incrementalTask = cron.schedule('0 9-21 * * 1-6', runIncrementalSync, {
    timezone: 'Europe/Madrid',
  });

  // 2. Complet nocturn: cada dia a les 03:30
  const nightlyTask = cron.schedule('30 3 * * *', runNightlyFullSync, {
    timezone: 'Europe/Madrid',
  });

  // 3. Amb projectes: diumenges a les 04:00
  const weeklyTask = cron.schedule('0 4 * * 0', runWeeklyProjectSync, {
    timezone: 'Europe/Madrid',
  });

  logger.info('Rentman sync: crons activats — incremental cada hora 9-21h (dl-ds), complet 03:30/dia, amb projectes diumenges 04:00');

  return { incrementalTask, nightlyTask, weeklyTask };
}

module.exports = {
  startRentmanSyncJob,
  runIncrementalSync,
  runNightlyFullSync,
  runWeeklyProjectSync,
};
