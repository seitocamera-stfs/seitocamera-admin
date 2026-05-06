// ===========================================
// Telegram polling — fallback al webhook
// ===========================================
//
// Si el webhook de Telegram no està disponible (DNS bloquejat, sense
// HTTPS públic, etc.) podem fer polling de `getUpdates` cada X segons.
//
// Aquest job processa els mateixos updates que processaria el webhook —
// reusant la mateixa lògica del router (extracted to handleTelegramUpdate).
//
// Configuració:
//   TELEGRAM_POLLING_ENABLED=true     — activa el polling
//   TELEGRAM_POLLING_INTERVAL_SEC=30  — interval (default 30s)
// ===========================================

const tg = require('../services/telegramService');
const { logger } = require('../config/logger');
const { handleTelegramUpdate } = require('../routes/telegram');

const INTERVAL_SEC = parseInt(process.env.TELEGRAM_POLLING_INTERVAL_SEC || '30', 10);

let lastUpdateId = 0;
let pollingTimer = null;
let isPolling = false;

async function pollOnce() {
  if (isPolling) return;
  if (!tg.isEnabled()) return;
  isPolling = true;
  try {
    // offset = lastUpdateId + 1 → "ack" tot el que ja hem processat
    const updates = await tg.getUpdates(lastUpdateId + 1);
    if (!Array.isArray(updates) || updates.length === 0) return;
    for (const update of updates) {
      try {
        await handleTelegramUpdate(update);
      } catch (err) {
        logger.error(`Telegram polling: handle update error: ${err.message}`);
      }
      if (update.update_id > lastUpdateId) lastUpdateId = update.update_id;
    }
    if (updates.length > 0) {
      logger.debug(`Telegram polling: processed ${updates.length} update(s)`);
    }
  } catch (err) {
    // No saturem els logs si Telegram puntualment està down
    if (!/timeout|ETIMEDOUT|ECONNRESET/.test(err.message)) {
      logger.warn(`Telegram polling: ${err.message}`);
    }
  } finally {
    isPolling = false;
  }
}

function startTelegramPollingJob() {
  if (!tg.isEnabled()) {
    logger.info('Telegram polling: bot no configurat, desactivat');
    return null;
  }
  if (process.env.TELEGRAM_POLLING_ENABLED !== 'true') {
    logger.info('Telegram polling: desactivat (TELEGRAM_POLLING_ENABLED ≠ true)');
    return null;
  }

  // Important: si el webhook està actiu, getUpdates retornarà 409 Conflict.
  // Així que primer eliminem el webhook (si n'hi ha cap definit).
  tg.deleteWebhook()
    .then((ok) => logger.info(`Telegram polling: webhook eliminat (per evitar conflicte) — ${ok}`))
    .catch((err) => logger.warn(`Telegram polling: deleteWebhook fallit: ${err.message}`));

  pollingTimer = setInterval(pollOnce, INTERVAL_SEC * 1000);
  logger.info(`Telegram polling: actiu (cada ${INTERVAL_SEC}s)`);
  // Primera execució immediata
  setTimeout(pollOnce, 5000);
  return pollingTimer;
}

function stopTelegramPollingJob() {
  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = null;
}

module.exports = { startTelegramPollingJob, stopTelegramPollingJob, pollOnce };
