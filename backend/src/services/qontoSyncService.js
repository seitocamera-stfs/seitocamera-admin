const { google } = require('googleapis');
const fs = require('fs');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

// ===========================================
// Servei de sincronització Qonto → Bank Movements
// ===========================================
// Llegeix el Google Sheet de Qonto Connect i importa
// les transaccions com a moviments bancaris.
//
// Sheet ID hardcoded (es podria moure a .env)
// Full: "Sync. transactions - Do not edit"
// ===========================================

const QONTO_SHEET_ID = process.env.QONTO_SHEET_ID || '1mFFXYlH1hwyJ-dHg9o7Sf6hnsVdbamPEeFUQ2RTGNBw';
const QONTO_SHEET_NAME = 'Sync. transactions - Do not edit';

let sheetsClient = null;

/**
 * Inicialitza el client de Google Sheets
 */
async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  let credentials;
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (keyFile && fs.existsSync(keyFile)) {
    credentials = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  } else if (keyFile) {
    credentials = JSON.parse(keyFile);
  } else {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY no configurat');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/**
 * Llegeix totes les transaccions del Google Sheet de Qonto
 * @returns {Array<Object>} Transaccions amb camps normalitzats
 */
async function readQontoTransactions() {
  const sheets = await getSheetsClient();

  // Llegir totes les files (capçalera + dades)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: QONTO_SHEET_ID,
    range: `'${QONTO_SHEET_NAME}'!A1:Z`,
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const transactions = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (row[j] || '').trim();
    }

    // Saltar transaccions sense data o import
    if (!obj['emitted at'] || !obj['amount']) continue;

    // Saltar transaccions declined
    if (obj['status'] === 'declined') continue;

    transactions.push(obj);
  }

  return transactions;
}

/**
 * Mapeja el "side" de Qonto al MovementType del nostre schema
 */
function mapMovementType(side, operationType) {
  if (operationType === 'income') return 'INCOME';
  if (side === 'credit') return 'INCOME';
  if (operationType === 'transfer') return 'TRANSFER';
  return 'EXPENSE';
}

/**
 * Sincronitza les transaccions de Qonto amb la BD
 * @param {Object} options - { fullSync: boolean }
 * @returns {Object} { created, skipped, updated, errors, total }
 */
async function syncQontoTransactions(options = {}) {
  const { fullSync = false } = options;

  const transactions = await readQontoTransactions();
  logger.info(`Qonto sync: ${transactions.length} transaccions llegides del Sheet`);

  let created = 0;
  let skipped = 0;
  let updated = 0;
  let errors = 0;

  for (const tx of transactions) {
    try {
      const slug = tx['slug transaction'];
      if (!slug) {
        skipped++;
        continue;
      }

      // Comprovar si ja existeix pel slug de Qonto
      const existing = await prisma.bankMovement.findFirst({
        where: { qontoSlug: slug },
      });

      if (existing) {
        // Si fullSync, actualitzar dades (per si han canviat al Sheet)
        if (fullSync) {
          await prisma.bankMovement.update({
            where: { id: existing.id },
            data: {
              counterparty: tx['counterparty name'] || null,
              reference: tx['reference'] || existing.reference,
              category: tx['category'] || null,
              accountName: tx['account name'] || null,
            },
          });
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      // Parsejar dades
      const amount = parseFloat(tx['amount']) || 0;
      const side = tx['side']; // credit o debit
      const signedAmount = side === 'debit' ? -Math.abs(amount) : Math.abs(amount);

      const date = new Date(tx['emitted at']);
      if (isNaN(date.getTime())) {
        logger.warn(`Qonto sync: Data invàlida per transacció ${slug}`);
        errors++;
        continue;
      }

      const settledAt = tx['settled at'] ? new Date(tx['settled at']) : null;
      const vatAmount = tx['vat amount'] ? parseFloat(tx['vat amount']) : null;
      const vatRate = tx['vat rate'] ? parseFloat(tx['vat rate']) : null;

      // Construir descripció
      const counterparty = tx['counterparty name'] || '';
      const reference = tx['reference'] || '';
      const description = counterparty
        ? (reference ? `${counterparty} — ${reference}` : counterparty)
        : reference || tx['category'] || 'Transacció Qonto';

      await prisma.bankMovement.create({
        data: {
          date,
          valueDate: settledAt && !isNaN(settledAt.getTime()) ? settledAt : null,
          description,
          amount: signedAmount,
          type: mapMovementType(side, tx['operation type']),
          reference: reference || null,
          bankAccount: 'Qonto',
          counterparty: counterparty || null,
          accountName: tx['account name'] || null,
          category: tx['category'] || null,
          operationType: tx['operation type'] || null,
          qontoSlug: slug,
          rawData: {
            status: tx['status'],
            vatAmount,
            vatRate,
            initiator: tx['initiator name'] || null,
            attachments: tx['attachment names'] || null,
            facturaEmesa: tx['factura emesa'] || null,
            gasto: tx['gasto'] || null,
          },
        },
      });

      created++;
    } catch (err) {
      logger.error(`Qonto sync error: ${err.message}`);
      errors++;
    }
  }

  logger.info(`Qonto sync completat: ${created} creats, ${skipped} omesos, ${updated} actualitzats, ${errors} errors`);

  return { total: transactions.length, created, skipped, updated, errors };
}

/**
 * Comprova la connexió amb el Google Sheet de Qonto
 */
async function testConnection() {
  try {
    const sheets = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: QONTO_SHEET_ID });
    const sheetNames = meta.data.sheets.map(s => s.properties.title);
    return { connected: true, sheets: sheetNames, title: meta.data.properties.title };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

module.exports = {
  readQontoTransactions,
  syncQontoTransactions,
  testConnection,
};
