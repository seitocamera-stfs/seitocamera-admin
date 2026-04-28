const cron = require('node-cron');
const { logger } = require('../config/logger');
const shellyService = require('../services/shellyService');

// ===========================================
// Cron Job: Sincronització de Consum Elèctric (Shelly Pro 3EM)
// ===========================================
//
// Cada dia a les 4:00h (Madrid) descarrega les lectures del dia anterior
// i backfill dels últims 7 dies per resiliència.
//
// Les dades s'utilitzen a Factures Compartides per calcular
// el repartiment automàtic de la factura de llum.
//
// EXECUCIÓ MANUAL: POST /api/shelly/sync
// ===========================================

/**
 * Executa la sincronització de dades Shelly
 */
async function runShellySync(options = {}) {
  const startTime = Date.now();

  try {
    const available = await shellyService.isAvailable();
    if (!available) {
      logger.info('Shelly sync job: Shelly no configurat, saltant');
      return { skipped: true, reason: 'not_configured' };
    }

    // Sincronitzar ahir (el dia complet més recent)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    logger.info('Shelly sync job: Iniciant sincronització diària');

    // Backfill: últims 7 dies per si algun dia va fallar
    const backfillDays = options.backfillDays || 7;
    const backfillStart = new Date(yesterday);
    backfillStart.setDate(backfillStart.getDate() - backfillDays + 1);

    const results = await shellyService.syncDateRange(backfillStart, yesterday);

    const success = results.filter((r) => !r.error).length;
    const errors = results.filter((r) => r.error).length;
    const totalKwh = results
      .filter((r) => !r.error)
      .reduce((sum, r) => sum + (r.totalKwh || 0), 0);

    const duration = Date.now() - startTime;
    logger.info(
      `Shelly sync job: Completat en ${duration}ms — ` +
      `${success} dies sincronitzats, ${errors} errors, ` +
      `${totalKwh.toFixed(2)} kWh total`
    );

    return { success, errors, totalKwh, duration, results };
  } catch (err) {
    logger.error(`Shelly sync job error: ${err.message}`);
    return { error: err.message };
  }
}

/**
 * Inicia el cron job de sincronització Shelly
 */
function startShellySyncJob() {
  // Cada dia a les 4:00h (hora de Madrid)
  cron.schedule('0 4 * * *', () => {
    runShellySync().catch((err) => {
      logger.error(`Shelly sync cron error: ${err.message}`);
    });
  }, { timezone: 'Europe/Madrid' });

  logger.info('Shelly sync job programat: cada dia a les 4:00h (Europe/Madrid)');

  // Sync inicial 30s després d'arrencar
  setTimeout(() => {
    runShellySync().catch((err) => {
      logger.error(`Shelly sync initial error: ${err.message}`);
    });
  }, 30000);
}

module.exports = { startShellySyncJob, runShellySync };
