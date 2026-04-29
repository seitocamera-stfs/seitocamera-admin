const cron = require('node-cron');
const { logger } = require('../config/logger');
const shellyService = require('../services/shellyService');

// ===========================================
// Cron Job: Lectura periòdica del comptador Shelly Pro 3EM
// ===========================================
//
// Cada 4 hores fa una lectura del comptador acumulat via /device/status
// i la guarda a la BD. El consum d'un període es calcula per diferència
// entre la lectura inicial i final.
//
// EXECUCIÓ MANUAL: POST /api/shelly/sync
// ===========================================

/**
 * Pren una lectura del comptador Shelly
 */
async function runShellySync() {
  const startTime = Date.now();

  try {
    const available = await shellyService.isAvailable();
    if (!available) {
      logger.info('Shelly sync: no configurat, saltant');
      return { skipped: true, reason: 'not_configured' };
    }

    const reading = await shellyService.takeReading();
    const duration = Date.now() - startTime;

    logger.info(`Shelly sync: lectura OK en ${duration}ms — ${reading.totalKwh} kWh acumulats`);
    return { success: true, totalKwh: reading.totalKwh, duration };
  } catch (err) {
    logger.error(`Shelly sync error: ${err.message}`);
    return { error: err.message };
  }
}

/**
 * Inicia el cron job de lectura Shelly
 */
function startShellySyncJob() {
  // Cada 4 hores (0:00, 4:00, 8:00, 12:00, 16:00, 20:00)
  cron.schedule('0 */4 * * *', () => {
    runShellySync().catch((err) => {
      logger.error(`Shelly sync cron error: ${err.message}`);
    });
  }, { timezone: 'Europe/Madrid' });

  logger.info('Shelly sync: programat cada 4h');

  // Lectura inicial 15s després d'arrencar
  setTimeout(() => {
    runShellySync().catch((err) => {
      logger.error(`Shelly sync initial error: ${err.message}`);
    });
  }, 15000);
}

module.exports = { startShellySyncJob, runShellySync };
