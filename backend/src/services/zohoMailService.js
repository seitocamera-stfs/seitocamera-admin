const https = require('https');
const { logger } = require('../config/logger');

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
// OAuth2 Token Management
// ===========================================

/**
 * Obté un access token nou usant el refresh token.
 * Zoho OAuth2 requereix refresh token per obtenir access tokens de curta vida.
 */
async function getAccessToken() {
  // Retornar token en cache si encara és vàlid (amb marge de 60s)
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Zoho Mail no configurat. Afegeix ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET i ZOHO_REFRESH_TOKEN al .env');
  }

  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });

  const data = await zohoRequest('POST', 'accounts.zoho.eu', '/oauth/v2/token', params.toString(), {
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  if (data.error) {
    throw new Error(`Zoho OAuth error: ${data.error}`);
  }

  cachedAccessToken = data.access_token;
  // Zoho tokens duren 3600s per defecte
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

  logger.info('Zoho Mail: Access token renovat');
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
 */
async function apiRequest(method, endpoint, body = null) {
  const token = await getAccessToken();
  const accountId = process.env.ZOHO_ACCOUNT_ID;

  if (!accountId) {
    throw new Error('ZOHO_ACCOUNT_ID no configurat al .env');
  }

  const fullPath = `/api/accounts/${accountId}${endpoint}`;

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
function downloadAttachment(folderId, messageId, attachmentId) {
  return new Promise(async (resolve, reject) => {
    try {
      const token = await getAccessToken();
      const accountId = process.env.ZOHO_ACCOUNT_ID;
      const path = `/api/accounts/${accountId}/folders/${folderId}/messages/${messageId}/attachments/${attachmentId}`;

      const options = {
        hostname: 'mail.zoho.eu',
        path,
        method: 'GET',
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
        },
      };

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
    } catch (err) {
      reject(err);
    }
  });
}

// ===========================================
// Operacions amb correus
// ===========================================

/**
 * Obté les carpetes del compte de correu
 */
async function getFolders() {
  const data = await apiRequest('GET', '/folders');
  return data.data || [];
}

/**
 * Obté l'ID de la carpeta "Inbox" (o una carpeta concreta)
 */
async function getFolderId(folderName = 'Inbox') {
  const folders = await getFolders();
  const folder = folders.find((f) =>
    f.folderName?.toLowerCase() === folderName.toLowerCase()
    || f.path?.toLowerCase() === folderName.toLowerCase()
  );
  if (!folder) {
    throw new Error(`Carpeta '${folderName}' no trobada a Zoho Mail`);
  }
  return folder.folderId;
}

/**
 * Llista correus d'una carpeta
 * @param {string} folderId - ID de la carpeta
 * @param {Object} options - Opcions de filtre
 * @param {number} options.limit - Nombre de correus (default 50)
 * @param {number} options.start - Offset per paginació (default 0)
 * @param {string} options.searchKey - Cerca per text
 * @param {string} options.receivedTime - Filtre per data (en ms des de epoch)
 */
async function getMessages(folderId, options = {}) {
  const { limit = 50, start = 0, searchKey, receivedTime } = options;

  let endpoint = `/folders/${folderId}/messages?limit=${limit}&start=${start}`;
  if (searchKey) endpoint += `&searchKey=${encodeURIComponent(searchKey)}`;
  if (receivedTime) endpoint += `&receivedTime=${receivedTime}`;

  const data = await apiRequest('GET', endpoint);
  return data.data || [];
}

/**
 * Obté el detall d'un correu específic (amb info d'adjunts)
 */
async function getMessage(folderId, messageId) {
  const data = await apiRequest('GET', `/folders/${folderId}/messages/${messageId}`);
  return data.data || null;
}

/**
 * Obté els adjunts d'un correu
 */
async function getAttachments(folderId, messageId) {
  const data = await apiRequest('GET', `/folders/${folderId}/messages/${messageId}/attachments`);
  return data.data?.attachments || [];
}

/**
 * Marca un correu com a llegit
 */
async function markAsRead(messageId) {
  return apiRequest('PUT', '/messages/read', {
    messageId: [messageId],
  });
}

/**
 * Mou un correu a una carpeta específica
 */
async function moveMessage(messageId, destFolderId) {
  return apiRequest('PUT', '/messages/move', {
    messageId: [messageId],
    folderId: destFolderId,
  });
}

// ===========================================
// Processament de factures
// ===========================================

/**
 * Analitza un correu i determina si conté PDFs de factura.
 * Retorna:
 *   - hasPdf: true/false
 *   - pdfAttachments: [{attachmentId, fileName, size}]
 *   - emailMeta: {from, subject, date, body}
 */
async function analyzeInvoiceEmail(folderId, messageId) {
  const message = await getMessage(folderId, messageId);
  if (!message) return null;

  // Obtenir adjunts
  let attachments = [];
  if (message.hasAttachment) {
    attachments = await getAttachments(folderId, messageId);
  }

  // Filtrar només PDFs
  const pdfAttachments = attachments.filter((att) => {
    const name = (att.attachmentName || att.fileName || '').toLowerCase();
    const mime = (att.contentType || att.mimeType || '').toLowerCase();
    return name.endsWith('.pdf') || mime === 'application/pdf';
  });

  return {
    messageId: message.messageId,
    folderId,
    hasPdf: pdfAttachments.length > 0,
    pdfAttachments: pdfAttachments.map((att) => ({
      attachmentId: att.attachmentId,
      fileName: att.attachmentName || att.fileName,
      size: att.attachmentSize || att.size,
    })),
    emailMeta: {
      from: message.fromAddress || message.sender,
      to: message.toAddress,
      subject: message.subject,
      date: message.receivedTime ? new Date(parseInt(message.receivedTime)) : null,
      summary: message.summary || '',
      hasInlineImages: message.hasInlineImage || false,
    },
  };
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
async function scanForInvoices(options = {}) {
  const {
    folderName = 'Inbox',
    since,
    limit = 50,
    keywords = ['factura', 'invoice', 'fra', 'albarà', 'albaran', 'rebut'],
  } = options;

  const folderId = await getFolderId(folderName);

  // Obtenir correus
  const msgOptions = { limit };
  if (since) {
    msgOptions.receivedTime = since.getTime().toString();
  }

  const messages = await getMessages(folderId, msgOptions);

  if (!messages.length) {
    logger.info('Zoho Mail: No hi ha correus nous per processar');
    return [];
  }

  const results = [];

  for (const msg of messages) {
    try {
      // Filtre bàsic per keywords al subject
      const subject = (msg.subject || '').toLowerCase();
      const from = (msg.fromAddress || msg.sender || '').toLowerCase();
      const isRelevant = keywords.some((kw) => subject.includes(kw.toLowerCase()));

      // Analitzar tots els correus amb adjunts, o els que coincideixen amb keywords
      if (msg.hasAttachment || isRelevant) {
        const analysis = await analyzeInvoiceEmail(folderId, msg.messageId);
        if (analysis) {
          results.push({
            ...analysis,
            isRelevantByKeyword: isRelevant,
          });
        }
      }
    } catch (err) {
      logger.warn(`Error analitzant correu ${msg.messageId}: ${err.message}`);
    }
  }

  logger.info(`Zoho Mail: Escanejats ${messages.length} correus, ${results.length} rellevants`);
  return results;
}

// ===========================================
// Connexió test
// ===========================================

/**
 * Comprova la connexió amb l'API de Zoho Mail
 */
async function testConnection() {
  try {
    const folders = await getFolders();
    return {
      connected: true,
      foldersCount: folders.length,
      folders: folders.map((f) => ({ name: f.folderName, path: f.path, id: f.folderId })),
    };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

module.exports = {
  getAccessToken,
  getFolders,
  getFolderId,
  getMessages,
  getMessage,
  getAttachments,
  downloadAttachment,
  markAsRead,
  moveMessage,
  analyzeInvoiceEmail,
  scanForInvoices,
  testConnection,
};
