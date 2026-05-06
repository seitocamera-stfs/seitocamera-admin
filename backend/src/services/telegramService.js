// ===========================================
// Telegram Bot service — vinculació + missatgeria
// ===========================================
//
// Wrapper sobre l'API HTTPS de Telegram (https://api.telegram.org/bot{TOKEN}/...)
// usat tant pel webhook (`/api/telegram/webhook`) com pel cron de
// recordatoris (`taskReminderJob`).
//
// Configuració via `.env`:
//   TELEGRAM_BOT_TOKEN     — token de @BotFather
//   TELEGRAM_BOT_USERNAME  — username del bot (sense @)
//
// Si TELEGRAM_BOT_TOKEN no és present, totes les funcions són NO-OP.
// ===========================================

const https = require('https');
const crypto = require('crypto');
const { logger } = require('../config/logger');

const API_BASE = 'https://api.telegram.org';

function isEnabled() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

function getBotUsername() {
  return process.env.TELEGRAM_BOT_USERNAME || null;
}

/**
 * Crida bàsica HTTP a l'API de Telegram.
 * Retorna el camp `result` o tira un Error.
 */
function tg(method, params = {}) {
  if (!isEnabled()) {
    return Promise.reject(new Error('Telegram bot no configurat (TELEGRAM_BOT_TOKEN buit)'));
  }
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(params);
    const url = new URL(`/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, API_BASE);
    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.ok) return resolve(json.result);
          reject(new Error(`Telegram ${method} error: ${json.description || JSON.stringify(json)}`));
        } catch (e) {
          reject(new Error(`Telegram ${method}: parse error (status ${res.statusCode})`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error(`Telegram ${method}: timeout`)); });
    req.write(payload);
    req.end();
  });
}

/**
 * Envia un missatge a un chat. Suporta format Markdown (parse_mode=MarkdownV2).
 * `text` ja ha de ser MarkdownV2-escaped si conté caràcters especials.
 */
async function sendMessage(chatId, text, opts = {}) {
  if (!isEnabled()) {
    logger.debug(`Telegram: sendMessage NO-OP (no configurat) chatId=${chatId}`);
    return null;
  }
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: opts.parse_mode || 'MarkdownV2',
    disable_web_page_preview: true,
    ...opts,
  });
}

/**
 * Escapa text per MarkdownV2 (manté l'humà tranquil — sense aquesta funció,
 * un missatge amb `_`, `*`, `(`, etc. peta amb 400 Bad Request).
 */
function mdv2Escape(text) {
  if (text == null) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

/**
 * Genera un codi únic per vincular un usuari al bot.
 * Curt (16 chars hex) — l'usuari el rep dins del link `t.me/<bot>?start=<code>`.
 */
function generateLinkCode() {
  return crypto.randomBytes(8).toString('hex'); // 16 chars
}

/**
 * Configura un webhook (Telegram envia POSTs a la nostra URL en lloc de fer
 * polling). Cal HTTPS. Si la URL ja és la mateixa, Telegram no fa res.
 *
 * @param {string} url - URL pública (https://admin.seito.camera/api/telegram/webhook)
 * @param {string} secret - Token secret enviat com a header `X-Telegram-Bot-Api-Secret-Token`
 */
async function setWebhook(url, secret) {
  if (!isEnabled()) return null;
  return tg('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message'], // només missatges (no edits, no inline)
    drop_pending_updates: true,    // ignora updates antigues acumulades
  });
}

async function deleteWebhook() {
  if (!isEnabled()) return null;
  return tg('deleteWebhook', { drop_pending_updates: true });
}

async function getWebhookInfo() {
  if (!isEnabled()) return null;
  return tg('getWebhookInfo');
}

/**
 * Per polling (alternativa al webhook). No s'usa actualment, però útil per debug.
 */
async function getUpdates(offset = 0) {
  if (!isEnabled()) return [];
  return tg('getUpdates', { offset, timeout: 0 });
}

module.exports = {
  isEnabled,
  getBotUsername,
  sendMessage,
  mdv2Escape,
  generateLinkCode,
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
  getUpdates,
};
