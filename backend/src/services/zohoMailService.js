const https = require('https');
const { logger } = require('../config/logger');
const company = require('../config/company');

// ===========================================
// Zoho Mail API Service
// ===========================================
// Gestiona OAuth2 i operacions amb correus.
// Documentació: https://www.zoho.com/mail/help/api/
//
// Flux de factures:
//   1. Llegir correus nous de la safata d'entrada (o carpeta específica)
//   2. Si té PDF adjunt → source: EMAIL_WITH_PDF
//   3. Si no té PDF adjunt → source: EMAIL_NO_PDF + recordatori
// ===========================================

let cachedAccessToken = null;
let tokenExpiresAt = 0;

// ===========================================
// Credencials: BD (ServiceConnection) → .env (fallback)
// ===========================================

/**
 * Obté les credencials Zoho: primer de la BD, fallback a .env.
 * Retorna { clientId, clientSecret, refreshToken, accountId, fromAddress }
 */
async function getCredentials() {
  try {
    const { prisma } = require('../config/database');
    const conn = await prisma.serviceConnection.findUnique({
      where: { provider: 'ZOHO_MAIL' },
    });
    if (conn && conn.clientId && conn.refreshToken) {
      return {
        clientId: conn.clientId,
        clientSecret: conn.clientSecret,
        refreshToken: conn.refreshToken,
        accountId: conn.config?.accountId || process.env.ZOHO_ACCOUNT_ID,
        fromAddress: conn.config?.fromAddress || process.env.ZOHO_REMINDER_FROM || 'rental@seitocamera.com',
        source: 'database',
      };
    }
  } catch (err) {
    // Taula pot no existir encara → fallback a .env
    logger.debug(`ServiceConnection lookup failed (fallback to .env): ${err.message}`);
  }

  return {
    clientId: process.env.ZOHO_CLIENT_ID,
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    refreshToken: process.env.ZOHO_REFRESH_TOKEN,
    accountId: process.env.ZOHO_ACCOUNT_ID,
    fromAddress: process.env.ZOHO_REMINDER_FROM || 'rental@seitocamera.com',
    source: 'env',
  };
}

// ===========================================
// Multi-compte: retorna els Account IDs configurats
// ===========================================

/**
 * Retorna la llista d'Account IDs configurats.
 * Prioritza ZOHO_ACCOUNT_IDS (separats per coma) i fa fallback a ZOHO_ACCOUNT_ID.
 */
function getConfiguredAccountIds() {
  const multiIds = process.env.ZOHO_ACCOUNT_IDS;
  if (multiIds) {
    return multiIds.split(',').map((id) => id.trim()).filter(Boolean);
  }
  const singleId = process.env.ZOHO_ACCOUNT_ID;
  if (singleId) return [singleId.trim()];
  return [];
}

// ===========================================
// OAuth2 Token Management
// ===========================================

/**
 * Obté un access token nou usant el refresh token.
 * Primer mira la BD (ServiceConnection), fallback a .env.
 */
async function getAccessToken() {
  // Retornar token en cache si encara és vàlid (amb marge de 60s)
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  const creds = await getCredentials();

  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    throw new Error('Zoho Mail no configurat. Connecta Zoho Mail des de Configuració → Connexions, o afegeix les variables al .env');
  }

  const params = new URLSearchParams({
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: 'refresh_token',
  });

  const data = await zohoRequest('POST', 'accounts.zoho.eu', '/oauth/v2/token', params.toString(), {
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  if (data.error) {
    // Actualitzar estat a la BD si l'error és d'autenticació
    try {
      const { prisma } = require('../config/database');
      await prisma.serviceConnection.updateMany({
        where: { provider: 'ZOHO_MAIL' },
        data: { status: 'ERROR', lastError: `OAuth error: ${data.error}` },
      });
    } catch {} // ignore
    throw new Error(`Zoho OAuth error: ${data.error}`);
  }

  cachedAccessToken = data.access_token;
  // Zoho tokens duren 3600s per defecte
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

  // Actualitzar access token a la BD si existeix
  try {
    const { prisma } = require('../config/database');
    await prisma.serviceConnection.updateMany({
      where: { provider: 'ZOHO_MAIL' },
      data: {
        accessToken: cachedAccessToken,
        tokenExpiresAt: new Date(tokenExpiresAt),
        status: 'ACTIVE',
        lastUsedAt: new Date(),
        lastError: null,
      },
    });
  } catch {} // ignore si la taula no existeix

  logger.info(`Zoho Mail: Access token renovat (source: ${creds.source})`);
  return cachedAccessToken;
}

// ===========================================
// HTTP Helper
// ===========================================

/**
 * Fa una petició HTTPS a l'API de Zoho
 */
function zohoRequest(method, hostname, path, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method,
      headers: {
        ...extraHeaders,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Resposta no JSON de Zoho: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Zoho API timeout'));
    });

    if (body) req.write(body);
    req.end();
  });
}

/**
 * Fa una petició autenticada a l'API de Zoho Mail
 * @param {string} method - HTTP method
 * @param {string} endpoint - API endpoint (sense /api/accounts/...)
 * @param {*} body - Cos de la petició (opcional)
 * @param {string} [accountId] - Account ID (opcional, per defecte ZOHO_ACCOUNT_ID)
 */
async function apiRequest(method, endpoint, body = null, accountId = null) {
  const token = await getAccessToken();
  const accId = accountId || process.env.ZOHO_ACCOUNT_ID;

  if (!accId) {
    throw new Error('ZOHO_ACCOUNT_ID no configurat al .env');
  }

  const fullPath = `/api/accounts/${accId}${endpoint}`;

  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    Accept: 'application/json',
  };

  if (body && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  return zohoRequest(method, 'mail.zoho.eu', fullPath, body, headers);
}

/**
 * Descarrega un fitxer binari (attachment) de l'API de Zoho Mail
 */
/**
 * Descarrega un fitxer binari (attachment) de l'API de Zoho Mail
 * Zoho API: GET /folders/{folderId}/messages/{messageId}/attachments/{attachmentId}
 * Docs: https://www.zoho.com/mail/help/api/get-attachment-content.html
 */
async function downloadAttachment(folderId, messageId, attachmentId, accountId = null) {
  const token = await getAccessToken();
  const accId = accountId || process.env.ZOHO_ACCOUNT_ID;
  const reqPath = `/api/accounts/${accId}/folders/${folderId}/messages/${messageId}/attachments/${attachmentId}`;

  const options = {
    hostname: 'mail.zoho.eu',
    path: reqPath,
    method: 'GET',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: 'application/octet-stream',
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          reject(new Error(`Error descarregant attachment: HTTP ${res.statusCode}`));
        } else {
          resolve(buffer);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Timeout descarregant attachment'));
    });

    req.end();
  });
}

// ===========================================
// Operacions amb correus
// ===========================================

/**
 * Obté les carpetes del compte de correu
 * @param {string} [accountId] - Account ID (opcional)
 */
async function getFolders(accountId = null) {
  const data = await apiRequest('GET', '/folders', null, accountId);
  return data.data || [];
}

/**
 * Obté l'ID de la carpeta "Inbox" (o una carpeta concreta)
 * @param {string} [folderName] - Nom de la carpeta
 * @param {string} [accountId] - Account ID (opcional)
 */
async function getFolderId(folderName = 'Inbox', accountId = null) {
  const folders = await getFolders(accountId);
  const nameLower = folderName.toLowerCase();
  // Buscar primer per path complet (ex: /Inbox/ADMIN), després per nom
  const folder = folders.find((f) =>
    f.path?.toLowerCase() === nameLower
    || f.path?.toLowerCase() === '/' + nameLower
    || f.folderName?.toLowerCase() === nameLower
  );
  if (!folder) {
    throw new Error(`Carpeta '${folderName}' no trobada a Zoho Mail`);
  }
  return folder.folderId;
}

/**
 * Retorna els IDs de múltiples carpetes pel seu nom o path.
 * No llença error si alguna no existeix, simplement la ignora.
 */
async function getFolderIds(folderNames = [], accountId = null) {
  const folders = await getFolders(accountId);
  const results = [];
  for (const name of folderNames) {
    const nameLower = name.toLowerCase();
    const folder = folders.find((f) =>
      f.path?.toLowerCase() === nameLower
      || f.path?.toLowerCase() === '/' + nameLower
      || f.folderName?.toLowerCase() === nameLower
    );
    if (folder) {
      results.push({ name: folder.folderName, path: folder.path, folderId: folder.folderId });
    } else {
      logger.warn(`Zoho getFolderIds: carpeta '${name}' no trobada, s'omet`);
    }
  }
  return results;
}

/**
 * Llista correus d'una carpeta
 * @param {string} folderId - ID de la carpeta
 * @param {Object} options - Opcions de filtre
 * @param {number} options.limit - Nombre de correus (default 50)
 * @param {number} options.start - Offset per paginació (default 0)
 * @param {string} options.searchKey - Cerca per text
 * @param {Date} options.since - Només correus posteriors a aquesta data
 * @param {Date} options.until - Només correus anteriors a aquesta data (rang superior)
 */
async function getMessages(folderId, options = {}, accountId = null) {
  const { limit = 50, start = 0, searchKey, since, until } = options;

  // Zoho Mail API: llistar missatges → GET /messages/view?folderId=...
  let endpoint = `/messages/view?folderId=${folderId}&limit=${limit}&start=${start}`;

  // Zoho accepta searchKey amb sintaxi: after:YYYY/MM/DD before:YYYY/MM/DD
  const fmtDate = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  let searchParts = [];
  if (since instanceof Date && !isNaN(since)) {
    searchParts.push(`after:${fmtDate(since)}`);
  }
  if (until instanceof Date && !isNaN(until)) {
    searchParts.push(`before:${fmtDate(until)}`);
  }
  if (searchKey) searchParts.push(searchKey);
  if (searchParts.length > 0) {
    endpoint += `&searchKey=${encodeURIComponent(searchParts.join(' '))}`;
  }

  logger.debug(`Zoho getMessages: GET ${endpoint}`);
  const data = await apiRequest('GET', endpoint, null, accountId);

  // La resposta pot ser { data: [...messages...], status: {...} }
  const messages = Array.isArray(data.data) ? data.data : [];
  logger.info(`Zoho getMessages: carpeta ${folderId} → ${messages.length} correus retornats`);
  if (messages.length === 0) {
    logger.info(`Zoho getMessages: response status: ${JSON.stringify(data.status || {})}, dataType: ${typeof data.data}`);
  }

  return messages;
}

/**
 * Retorna la resposta RAW de Zoho (sense processar) per diagnòstic
 */
async function getRawMessages(folderId, options = {}, accountId = null) {
  const { limit = 50, start = 0 } = options;
  const endpoint = `/messages/view?folderId=${folderId}&limit=${limit}&start=${start}`;
  return apiRequest('GET', endpoint, null, accountId);
}

/**
 * Obté el detall (metadades) d'un correu específic.
 * Zoho Mail API: GET /folders/{folderId}/messages/{messageId}/details
 * Docs: https://www.zoho.com/mail/help/api/get-email-meta-data.html
 */
async function getMessage(folderId, messageId, accountId = null) {
  const data = await apiRequest('GET', `/folders/${folderId}/messages/${messageId}/details`, null, accountId);

  // Validar que la resposta és un missatge real (no un error)
  if (!data.data || data.data.errorCode || data.status?.code >= 400) {
    logger.warn(`Zoho getMessage: error per ${messageId}: ${JSON.stringify(data.data || data.status)}`);
    return null;
  }

  return data.data;
}

/**
 * Obté els adjunts d'un correu
 * Zoho Mail API: GET /folders/{folderId}/messages/{messageId}/attachmentinfo
 * Docs: https://www.zoho.com/mail/help/api/get-attach-info.html
 */
async function getAttachments(folderId, messageId, accountId = null) {
  const data = await apiRequest('GET', `/folders/${folderId}/messages/${messageId}/attachmentinfo`, null, accountId);

  if (!data.data || data.data.errorCode) {
    logger.warn(`Zoho getAttachments: error per ${messageId}: ${JSON.stringify(data.data || data.status)}`);
    return [];
  }

  // Zoho pot retornar { data: { attachments: [...] } } o { data: [...] }
  if (Array.isArray(data.data)) return data.data;
  return data.data?.attachments || [];
}

/**
 * Marca un correu com a llegit
 * Zoho API: PUT /updatemessage { mode: "markAsRead", messageId: [...] }
 * Docs: https://www.zoho.com/mail/help/api/put-mark-email-as-read.html
 */
async function markAsRead(messageId, accountId = null) {
  return apiRequest('PUT', '/updatemessage', {
    mode: 'markAsRead',
    messageId: [messageId],
  }, accountId);
}

/**
 * Mou un correu a una carpeta específica
 * Zoho API: PUT /updatemessage { mode: "moveMessage", messageId: [...], destfolderId: "..." }
 * Docs: https://www.zoho.com/mail/help/api/move-email.html
 */
async function moveMessage(messageId, destFolderId, accountId = null) {
  return apiRequest('PUT', '/updatemessage', {
    mode: 'moveMessage',
    messageId: [messageId],
    destfolderId: destFolderId,
  }, accountId);
}

// ===========================================
// Processament de factures
// ===========================================

const { findPlatformByEmail, findPlatformByContent } = require('../config/knownPlatforms');

// ---- Paraules clau per scoring ----
const INVOICE_KEYWORDS_HIGH = ['factura', 'invoice', 'fra.', 'fra ', 'receipt', 'rebut'];
const INVOICE_KEYWORDS_MEDIUM = ['billing', 'payment', 'cobr', 'pagament', 'subscript', 'renovació', 'renewal', 'your invoice', 'download invoice', 'view invoice', 'albarà', 'albaran', 'pressupost'];
const AMOUNT_PATTERNS = /(\d+[.,]\d{2})\s*[€$£]|[€$£]\s*(\d+[.,]\d{2})|(\d+[.,]\d{2})\s*(eur|usd|gbp)/i;
const PROMO_KEYWORDS = ['unsubscribe', 'newsletter', 'marketing', 'promo', 'oferta', 'descompte', 'discount', 'sale', 'shop now', 'compra ara', 'free trial'];
const LINK_PATTERNS = /(download|descarreg|view|veure|accedir|access)\s*(your\s*)?(invoice|factura|receipt|rebut|pdf)/i;

/**
 * Calcula un score de probabilitat que un correu sigui una factura.
 *
 * Puntuació:
 *   +4  subject conté keyword alta (factura, invoice, receipt...)
 *   +2  subject conté keyword mitjana (billing, payment, subscription...)
 *   +3  body/summary conté import (€, $, xifra amb decimals)
 *   +3  body conté "download invoice" / "descarrega factura" / link
 *   +2  remitent és plataforma coneguda
 *   +2  carpeta FACTURA REBUDA
 *   -3  conté keywords promocionals (newsletter, unsubscribe, promo...)
 *   -2  no conté cap keyword de factura ni al subject ni al body
 *
 * @param {Object} params
 * @param {string} params.subject
 * @param {string} params.summary - resum o body del correu
 * @param {string} params.from - adreça del remitent
 * @param {boolean} params.isFolderFactura - si el correu és a la carpeta FACTURA REBUDA
 * @returns {{ score: number, reasons: string[], isLikelyInvoice: boolean }}
 */
function scoreInvoiceProbability({ subject = '', summary = '', from = '', isFolderFactura = false }) {
  let score = 0;
  const reasons = [];
  const subjectLower = subject.toLowerCase();
  const summaryLower = summary.toLowerCase();
  const allText = `${subjectLower} ${summaryLower}`;

  // +4: keyword alta al subject, +3 al body
  let highHit = false;
  for (const kw of INVOICE_KEYWORDS_HIGH) {
    if (subjectLower.includes(kw)) {
      score += 4;
      reasons.push(`subject conté "${kw}"`);
      highHit = true;
      break;
    }
  }
  if (!highHit) {
    for (const kw of INVOICE_KEYWORDS_HIGH) {
      if (summaryLower.includes(kw)) {
        score += 3;
        reasons.push(`body conté "${kw}"`);
        break;
      }
    }
  }

  // +2: keyword mitjana al subject, +1 al body
  let medHit = false;
  for (const kw of INVOICE_KEYWORDS_MEDIUM) {
    if (subjectLower.includes(kw)) {
      score += 2;
      reasons.push(`subject conté "${kw}"`);
      medHit = true;
      break;
    }
  }
  if (!medHit) {
    for (const kw of INVOICE_KEYWORDS_MEDIUM) {
      if (summaryLower.includes(kw)) {
        score += 1;
        reasons.push(`body conté "${kw}"`);
        break;
      }
    }
  }

  // +3: import detectat al text
  if (AMOUNT_PATTERNS.test(allText)) {
    score += 3;
    const match = allText.match(AMOUNT_PATTERNS);
    reasons.push(`import detectat: ${match[0].trim()}`);
  }

  // +3: link de descàrrega de factura
  if (LINK_PATTERNS.test(allText)) {
    score += 3;
    reasons.push('conté link/instrucció de descàrrega de factura');
  }

  // +2: plataforma coneguda
  const platform = findPlatformByEmail(from);
  if (platform) {
    score += 2;
    reasons.push(`remitent és plataforma coneguda: ${platform.name}`);
  }

  // +2: carpeta FACTURA REBUDA
  if (isFolderFactura) {
    score += 2;
    reasons.push('carpeta FACTURA REBUDA');
  }

  // -3: contingut promocional
  const promoHits = PROMO_KEYWORDS.filter((kw) => allText.includes(kw));
  if (promoHits.length > 0) {
    score -= 3;
    reasons.push(`probable promo/newsletter (${promoHits.join(', ')})`);
  }

  // -2: cap keyword de factura en tot el text
  const anyInvoiceKw = [...INVOICE_KEYWORDS_HIGH, ...INVOICE_KEYWORDS_MEDIUM].some((kw) => allText.includes(kw));
  if (!anyInvoiceKw && !platform && !isFolderFactura) {
    score -= 2;
    reasons.push('cap keyword de factura detectada');
  }

  return {
    score,
    reasons,
    isLikelyInvoice: score >= 3, // llindar mínim
  };
}

/**
 * Classifica un correu en una de 3 categories:
 *   A: PDF_ATTACHED    → Factura amb PDF adjunt, descarregar directament
 *   B: LINK_DETECTED   → Sense PDF però amb link/plataforma coneguda
 *   C: MANUAL_REVIEW   → Sense PDF ni link clar, revisió manual
 *
 * @param {Object} analysis - Resultat d'analyzeInvoiceEmail
 * @returns {string} - 'PDF_ATTACHED' | 'LINK_DETECTED' | 'MANUAL_REVIEW' | 'NOT_INVOICE'
 */
// Emails a excloure sempre (sistema, propi domini)
const EXCLUDED_SENDERS = [
  '@seitocamera.com',   // emails interns
  'noreply@zoho.eu',    // moderació Zoho
  'noreply@zoho.com',
  'notification@zoho',
];

function isExcludedSender(from) {
  if (!from) return false;
  const fromLower = from.toLowerCase();
  return EXCLUDED_SENDERS.some(ex => fromLower.includes(ex));
}

/**
 * Classificació per regles (FALLBACK si Claude no disponible)
 */
function classifyEmailByRules(analysis) {
  if (!analysis) return 'NOT_INVOICE';

  // Excloure emails interns i de sistema
  if (isExcludedSender(analysis.emailMeta?.from)) {
    return 'NOT_INVOICE';
  }

  // A: té PDF adjunt
  if (analysis.hasPdf && analysis.pdfAttachments.length > 0) {
    const isFolderFactura = analysis.folderPath?.toUpperCase().includes('FACTURA') || false;
    if (isFolderFactura) {
      return 'PDF_ATTACHED';
    }
    if (analysis.scoring && analysis.scoring.score >= 3) {
      const allText = `${analysis.emailMeta?.subject || ''} ${analysis.emailMeta?.summary || ''}`.toLowerCase();
      const invoiceKeywords = ['factura', 'invoice', 'fra.', 'fra ', 'receipt', 'rebut', 'adjuntamos factura', 'your receipt'];
      const hasInvoiceKeyword = invoiceKeywords.some(kw => allText.includes(kw));
      if (hasInvoiceKeyword || analysis.platform) {
        return 'PDF_ATTACHED';
      }
    }
    return 'NOT_INVOICE';
  }

  if (!analysis.scoring || !analysis.scoring.isLikelyInvoice) {
    return 'NOT_INVOICE';
  }

  if (analysis.platform || analysis.hasDownloadLink) {
    return 'LINK_DETECTED';
  }

  return 'MANUAL_REVIEW';
}

// ===========================================
// Classificació per IA (Claude Haiku)
// ===========================================

const EMAIL_CLASSIFY_PROMPT = `Ets un assistent expert en classificació d'emails per a una empresa de ${company.sector} (${company.name}).

La teva tasca és determinar si un email conté o fa referència a una FACTURA (invoice) enviada per un proveïdor.

CONTEXT IMPORTANT:
- L'empresa rep factures de lloguer d'equip audiovisual, serveis tècnics, software, subministraments, etc.
- NO són factures: newsletters, ofertes comercials, confirmacions de comanda, albarans, pressupostos, gear lists, CVs, llistats d'equip, notificacions de sistema, emails interns.
- Una factura normalment conté: "factura", "invoice", "fra.", imports amb €/$, número de factura, NIF/CIF.
- Plataformes SaaS (Adobe, Google, Amazon, etc.) sovint envien la factura com a PDF adjunt o amb link de descàrrega.

Classifica l'email en UNA d'aquestes categories:
- PDF_ATTACHED: L'email conté un PDF adjunt que és (o molt probablement és) una factura. Els PDFs que NO són factures (gear lists, pressupostos, CVs, contractes) NO compten.
- LINK_DETECTED: No hi ha PDF adjunt, però l'email indica que hi ha una factura disponible per descarregar (link a plataforma, "download your invoice", etc.)
- MANUAL_REVIEW: Podria ser una factura però no n'estàs segur — cal revisió manual.
- NOT_INVOICE: Clarament NO és una factura (newsletter, promo, notificació, etc.)

Retorna NOMÉS un JSON (sense explicacions):
{
  "classification": "PDF_ATTACHED | LINK_DETECTED | MANUAL_REVIEW | NOT_INVOICE",
  "confidence": 0.95,
  "reason": "breu explicació en català"
}`;

/**
 * Classifica un email usant Claude Haiku.
 * Retorna la classificació o null si falla (per caure al fallback de regles).
 */
async function classifyEmailWithAI(analysis) {
  try {
    const claude = require('./claudeExtractService');
    if (!claude.isAvailable()) return null;

    const aiCostTracker = require('./aiCostTracker');

    // Construir el missatge amb les dades de l'email
    const pdfNames = analysis.pdfAttachments?.map(a => a.fileName).join(', ') || 'cap';
    const userMessage = [
      `De: ${analysis.emailMeta?.from || 'desconegut'}`,
      `Assumpte: ${analysis.emailMeta?.subject || 'sense assumpte'}`,
      `Data: ${analysis.emailMeta?.date ? analysis.emailMeta.date.toISOString().split('T')[0] : '?'}`,
      `Carpeta: ${analysis.folderPath || 'inbox'}`,
      `PDFs adjunts: ${pdfNames}`,
      `Resum: ${(analysis.emailMeta?.summary || '').substring(0, 1000)}`,
    ].join('\n');

    const apiResult = await claude.callClaude(EMAIL_CLASSIFY_PROMPT, userMessage, { maxTokens: 256 });

    if (!apiResult || !apiResult.text) return null;

    // Tracking de costos
    aiCostTracker.trackUsage({
      service: 'email_classification',
      model: apiResult.model,
      inputTokens: apiResult.usage.input_tokens,
      outputTokens: apiResult.usage.output_tokens,
      entityType: 'email',
      entityId: analysis.messageId,
      metadata: {
        from: analysis.emailMeta?.from,
        subject: analysis.emailMeta?.subject,
      },
    }).catch(() => {});

    // Parsejar resposta
    const jsonStr = apiResult.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    const validClassifications = ['PDF_ATTACHED', 'LINK_DETECTED', 'MANUAL_REVIEW', 'NOT_INVOICE'];
    if (!validClassifications.includes(parsed.classification)) {
      logger.warn(`Claude email classify: classificació invàlida: ${parsed.classification}`);
      return null;
    }

    // Validació extra: no pot ser PDF_ATTACHED si no hi ha PDFs
    if (parsed.classification === 'PDF_ATTACHED' && !analysis.hasPdf) {
      parsed.classification = 'LINK_DETECTED';
      parsed.reason = (parsed.reason || '') + ' (corregit: no hi ha PDF adjunt)';
    }

    logger.info(`Claude email classify: ${parsed.classification} (${parsed.confidence}) — ${parsed.reason} [${analysis.emailMeta?.from}]`);

    return parsed.classification;
  } catch (err) {
    logger.warn(`Claude email classify error: ${err.message}`);
    return null;
  }
}

/**
 * Classifica un email: regles primer, IA només pels casos dubtosos.
 *
 * Lògica d'estalvi:
 *   score ≥ 6  → regles prou segures, NO cal IA
 *   score ≤ 0  → clarament NO factura, NO cal IA
 *   score 1-5  → zona grisa, cridar Claude Haiku per desempatar
 *
 * Això redueix les crides a l'API de Claude un 70-80%.
 */
async function classifyEmail(analysis) {
  if (!analysis) return 'NOT_INVOICE';

  // Excloure emails interns i de sistema (ni cal preguntar a la IA)
  if (isExcludedSender(analysis.emailMeta?.from)) {
    return 'NOT_INVOICE';
  }

  const score = analysis.scoring?.score ?? 0;

  // Score alt (≥6): les regles estan segures → classificar directament
  if (score >= 6) {
    const rulesResult = classifyEmailByRules(analysis);
    logger.info(`Email classify [REGLES·SEGUR]: score=${score} → ${rulesResult} | ${analysis.emailMeta?.from} — ${analysis.emailMeta?.subject} (IA estalviada)`);
    return rulesResult;
  }

  // Score baix (≤0): clarament no és factura → classificar directament
  if (score <= 0) {
    logger.info(`Email classify [REGLES·DESCART]: score=${score} → NOT_INVOICE | ${analysis.emailMeta?.from} — ${analysis.emailMeta?.subject} (IA estalviada)`);
    return classifyEmailByRules(analysis);
  }

  // Zona grisa (score 1-5): demanar a Claude Haiku
  logger.info(`Email classify [IA·ZONA_GRISA]: score=${score} → consultant Claude | ${analysis.emailMeta?.from} — ${analysis.emailMeta?.subject}`);
  const aiClassification = await classifyEmailWithAI(analysis);
  if (aiClassification) {
    return aiClassification;
  }

  // Fallback a regles si la IA no està disponible o falla
  logger.debug('Email classify: fallback a regles (IA no disponible)');
  return classifyEmailByRules(analysis);
}

/**
 * Analitza un correu: detecta PDFs, calcula score, classifica, i detecta plataforma.
 */
async function analyzeInvoiceEmail(folderId, messageId, { isFolderFactura = false, folderPath = '', accountId = null } = {}) {
  const message = await getMessage(folderId, messageId, accountId);
  if (!message) return null;

  const from = message.fromAddress || message.sender || '';
  const subject = message.subject || '';
  const summary = message.summary || '';

  // Obtenir adjunts (hasAttachment pot ser string "1" o booleà)
  let attachments = [];
  if (message.hasAttachment === '1' || message.hasAttachment === true) {
    attachments = await getAttachments(folderId, messageId, accountId);
  }

  // Filtrar només PDFs
  const pdfAttachments = attachments.filter((att) => {
    const name = (att.attachmentName || att.fileName || '').toLowerCase();
    const mime = (att.contentType || att.mimeType || '').toLowerCase();
    return name.endsWith('.pdf') || mime === 'application/pdf';
  });

  // Scoring de probabilitat
  const scoring = scoreInvoiceProbability({
    subject,
    summary,
    from,
    isFolderFactura,
  });

  // Detectar plataforma coneguda
  const platform = findPlatformByEmail(from) || findPlatformByContent(`${subject} ${summary}`);

  // Detectar si hi ha link de descàrrega al summary
  const hasDownloadLink = LINK_PATTERNS.test(`${subject} ${summary}`.toLowerCase());

  const analysis = {
    messageId: message.messageId,
    folderId,
    folderPath,
    accountId: accountId || process.env.ZOHO_ACCOUNT_ID,
    hasPdf: pdfAttachments.length > 0,
    pdfAttachments: pdfAttachments.map((att) => ({
      attachmentId: att.attachmentId,
      fileName: att.attachmentName || att.fileName,
      size: att.attachmentSize || att.size,
    })),
    emailMeta: {
      from,
      to: message.toAddress,
      subject,
      date: message.receivedTime ? new Date(parseInt(message.receivedTime)) : null,
      summary,
      hasInlineImages: message.hasInlineImage || false,
    },
    // Nous camps
    scoring,
    platform: platform ? { name: platform.name, billingUrl: platform.billingUrl, instructions: platform.instructions } : null,
    hasDownloadLink,
    classification: null, // es calcula a continuació
  };

  analysis.classification = await classifyEmail(analysis);

  return analysis;
}

/**
 * Processa correus nous buscant factures.
 * Retorna una llista de correus classificats.
 *
 * @param {Object} options
 * @param {string} options.folderName - Nom de la carpeta (default 'Inbox')
 * @param {Date} options.since - Només correus posteriors a aquesta data
 * @param {number} options.limit - Nombre de correus a processar
 * @param {string[]} options.keywords - Paraules clau per filtrar (factura, invoice, etc.)
 */
/**
 * Carpetes que el cron escaneja per trobar factures.
 * Es busquen per nom o path; si no existeixen, s'ometen.
 */
const DEFAULT_SCAN_FOLDERS = [
  'Inbox',           // safata general
  '/Inbox/ADMIN',    // admin@seitocamera.com
  '/Inbox/RENTAL',   // rental@seitocamera.com
  'FACTURA REBUDA',  // carpeta dedicada a factures
];

async function scanForInvoices(options = {}) {
  const {
    folderNames = DEFAULT_SCAN_FOLDERS,
    since,
    until,
    limit = 50,
    keywords = ['factura', 'invoice', 'fra', 'albarà', 'albaran', 'rebut', 'pressupost'],
    accountId = null,
  } = options;

  // Resolem IDs de totes les carpetes
  const folders = await getFolderIds(
    Array.isArray(folderNames) ? folderNames : [folderNames],
    accountId
  );

  if (folders.length === 0) {
    logger.warn('Zoho scanForInvoices: cap carpeta vàlida trobada');
    return [];
  }

  logger.info(`Zoho scanForInvoices: escanejant ${folders.length} carpetes: ${folders.map((f) => f.path).join(', ')} | since: ${since?.toISOString() || 'cap'} | limit: ${limit}`);

  const allResults = [];

  for (const folder of folders) {
    try {
      // Obtenir correus d'aquesta carpeta
      const msgOptions = { limit };
      if (since) msgOptions.since = since;
      if (until) msgOptions.until = until;

      let messages = await getMessages(folder.folderId, msgOptions, accountId);

      // Si 0 amb filtre de data, reintentar sense filtre (per diagnòstic / primer run)
      if (!messages.length && since) {
        logger.info(`Zoho scanForInvoices [${folder.path}]: 0 amb filtre de data, reintentant sense filtre (últims 20)`);
        messages = await getMessages(folder.folderId, { limit: 20 }, accountId);
      }

      if (!messages.length) {
        logger.info(`Zoho scanForInvoices [${folder.path}]: buida`);
        continue;
      }

      logger.info(`Zoho scanForInvoices [${folder.path}]: ${messages.length} correus a analitzar`);

      // La carpeta FACTURA REBUDA ja conté factures → tots rellevants
      const isFolderFactura = folder.path?.toUpperCase().includes('FACTURA');

      for (const msg of messages) {
        try {
          const subject = (msg.subject || '').toLowerCase();
          const isRelevant = isFolderFactura || keywords.some((kw) => subject.includes(kw.toLowerCase()));
          const hasAttach = msg.hasAttachment === '1' || msg.hasAttachment === true;

          // Analitzar si té adjunts o és rellevant per keyword/carpeta
          if (hasAttach || isRelevant) {
            const analysis = await analyzeInvoiceEmail(folder.folderId, msg.messageId, { isFolderFactura, folderPath: folder.path, accountId });
            if (analysis) {
              allResults.push({
                ...analysis,
                folderName: folder.name,
                folderPath: folder.path,
                isRelevantByKeyword: isRelevant,
              });
            }
          }
        } catch (err) {
          logger.warn(`Error analitzant correu ${msg.messageId} a ${folder.path}: ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`Zoho scanForInvoices [${folder.path}]: error: ${err.message}`);
    }
  }

  logger.info(`Zoho scanForInvoices: total ${allResults.length} correus rellevants de ${folders.length} carpetes`);
  return allResults;
}

// ===========================================
// Connexió test
// ===========================================

/**
 * Comprova la connexió amb l'API de Zoho Mail
 */
async function testConnection(accountId = null) {
  try {
    const folders = await getFolders(accountId);
    return {
      connected: true,
      accountId: accountId || process.env.ZOHO_ACCOUNT_ID,
      foldersCount: folders.length,
      folders: folders.map((f) => ({ name: f.folderName, path: f.path, id: f.folderId })),
    };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

/**
 * Escaneja TOTS els comptes configurats (ZOHO_ACCOUNT_IDS o ZOHO_ACCOUNT_ID).
 * Retorna tots els correus classificats de tots els comptes.
 *
 * @param {Object} options - Opcions de scanForInvoices (since, limit, folderNames, keywords)
 * @returns {Array} Tots els resultats amb camp accountId per identificar l'origen
 */
async function scanAllAccounts(options = {}) {
  const accountIds = getConfiguredAccountIds();
  if (accountIds.length === 0) {
    logger.warn('Zoho scanAllAccounts: cap compte configurat');
    return [];
  }

  logger.info(`Zoho scanAllAccounts: escanejant ${accountIds.length} comptes: ${accountIds.join(', ')}`);

  const allResults = [];
  for (const accId of accountIds) {
    try {
      const results = await scanForInvoices({ ...options, accountId: accId });
      logger.info(`Zoho scanAllAccounts [${accId}]: ${results.length} correus rellevants`);
      allResults.push(...results);
    } catch (err) {
      logger.error(`Zoho scanAllAccounts [${accId}]: error: ${err.message}`);
    }
  }

  logger.info(`Zoho scanAllAccounts: total ${allResults.length} correus de ${accountIds.length} comptes`);
  return allResults;
}

// ===========================================
// Enviar correus
// ===========================================

/**
 * Envia un correu electrònic via Zoho Mail API.
 * Zoho API: POST /messages
 * Docs: https://www.zoho.com/mail/help/api/post-send-an-email.html
 *
 * @param {Object} params
 * @param {string} params.to - Destinatari (email)
 * @param {string} params.subject - Assumpte
 * @param {string} params.body - Cos del missatge (text pla, es converteix a HTML)
 * @param {string} [params.fromAddress] - Adreça remitent (default: ZOHO_REMINDER_FROM o rental@seitocamera.com)
 * @param {string} [params.cc] - CC (opcional)
 * @param {string} [params.accountId] - Account ID (opcional)
 * @returns {Object} Resposta de Zoho
 */
async function sendEmail({ to, subject, body, fromAddress, cc, accountId }) {
  if (!to || !subject || !body) {
    throw new Error('Cal indicar to, subject i body per enviar un correu');
  }

  // Obtenir fromAddress de credencials (BD o .env)
  const creds = await getCredentials();
  const from = fromAddress || creds.fromAddress || 'rental@seitocamera.com';

  // Convertir text pla a HTML bàsic (preservant salts de línia)
  const htmlBody = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/^(.*)$/gm, '<p style="margin:0">$1</p>')
    .replace(/<p style="margin:0"><br><\/p>/g, '<br>');

  const emailData = {
    fromAddress: from,
    toAddress: to,
    subject,
    content: htmlBody,
    askReceipt: 'no',
  };

  if (cc) emailData.ccAddress = cc;

  logger.info(`Zoho sendEmail: enviant a ${to} des de ${from} — ${subject}`);

  const result = await apiRequest('POST', '/messages', emailData, accountId);

  if (result.status?.code !== 200 && result.status?.code !== 201) {
    const errMsg = result.data?.errorCode || result.status?.description || JSON.stringify(result);
    throw new Error(`Error enviant correu via Zoho: ${errMsg}`);
  }

  logger.info(`Zoho sendEmail: enviat correctament a ${to}`);
  return result;
}

module.exports = {
  getAccessToken,
  getCredentials,
  getConfiguredAccountIds,
  getFolders,
  getFolderId,
  getFolderIds,
  getMessages,
  getRawMessages,
  getMessage,
  getAttachments,
  downloadAttachment,
  markAsRead,
  moveMessage,
  sendEmail,
  analyzeInvoiceEmail,
  scoreInvoiceProbability,
  classifyEmail,
  scanForInvoices,
  scanAllAccounts,
  testConnection,
};
