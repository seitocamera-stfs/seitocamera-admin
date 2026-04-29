const cron = require('node-cron');
const { prisma } = require('../config/database');
const { redis } = require('../config/redis');
const zohoMail = require('../services/zohoMailService');
const gdrive = require('../services/gdriveService');
const { logger } = require('../config/logger');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ===========================================
// Cron Job: Sincronització Zoho Mail → Factures
// ===========================================
// Cada 15 minuts busca correus nous a les carpetes configurades
// i processa segons 3 categories:
//   A) PDF_ATTACHED   → descarrega PDF i puja a GDrive inbox
//   B) LINK_DETECTED  → crea recordatori amb link a la plataforma
//   C) MANUAL_REVIEW  → crea recordatori de revisió manual
//   NOT_INVOICE       → ignora (marca com vist)
// ===========================================

let isRunning = false;
let runStartedAt = null;
const MAX_RUN_MINUTES = 10; // Safety timeout
const PER_EMAIL_TIMEOUT_MS = 30000; // 30s timeout per email

/**
 * Executa una funció amb timeout.
 * Si la funció tarda més de `ms`, rebutja amb error.
 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms}ms) processant: ${label}`)), ms)
    ),
  ]);
}

/**
 * Busca un proveïdor a la BD pel remitent del correu.
 * Primer per email exacte, després per domini.
 */
async function findSupplierByEmail(fromAddress) {
  if (!fromAddress) return null;
  const emailLower = fromAddress.toLowerCase().trim();
  const domain = emailLower.split('@')[1];

  const supplier = await prisma.supplier.findFirst({
    where: {
      isActive: true,
      OR: [
        { email: { equals: emailLower, mode: 'insensitive' } },
        ...(domain ? [{ email: { endsWith: `@${domain}`, mode: 'insensitive' } }] : []),
      ],
    },
    select: { id: true, name: true },
  });

  return supplier;
}

/**
 * Obté l'ID de l'admin actiu per crear recordatoris.
 */
async function getAdminId() {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    select: { id: true },
  });
  return admin?.id || null;
}

/**
 * Cas A: Correu amb PDF adjunt.
 * Descarrega el PDF i puja a GDrive factures-rebudes/inbox/.
 * Marca el correu com a llegit i el mou a FACTURA REBUDA.
 */
async function handlePdfAttached(email, supplier) {
  const fromAddress = email.emailMeta.from || '';
  let uploadedCount = 0;

  // Preparar carpeta GDrive inbox UNA sola vegada (no per cada attachment)
  const facturesId = await gdrive.getSubfolderId('factures-rebudes');
  const inboxFolder = await gdrive.findOrCreateFolder('inbox', facturesId);
  if (!inboxFolder || !inboxFolder.id) {
    throw new Error('No s\'ha pogut obtenir la carpeta inbox a GDrive');
  }

  const drive = gdrive.getDriveClient();
  const tmpDir = path.join(os.tmpdir(), 'seitocamera-zoho');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // Noms de fitxer que NO són factures (pressupostos, gear lists, CVs, etc.)
  const NON_INVOICE_PATTERNS = [
    /quotation/i, /pressupost/i, /gear\s*list/i, /camera\s*list/i,
    /^cv[_\s.-]/i, /curriculum/i, /planols/i, /certificad/i,
  ];

  for (const att of email.pdfAttachments) {
    let tmpPath = null;
    try {
      // Filtrar PDFs que clarament no són factures pel nom
      const fileName = att.fileName || '';
      const isNonInvoice = NON_INVOICE_PATTERNS.some(p => p.test(fileName));
      if (isNonInvoice) {
        logger.info(`Zoho cron [A]: Saltant ${fileName} (no és factura pel nom)`);
        continue;
      }

      // Descarregar attachment de Zoho
      logger.info(`Zoho cron [A]: Descarregant ${att.fileName} (${att.size || '?'} bytes) de ${fromAddress} [compte: ${email.accountId || '?'}]...`);
      const buffer = await zohoMail.downloadAttachment(email.folderId, email.messageId, att.attachmentId, email.accountId);

      // Validar que el buffer no està buit i sembla un PDF
      if (!buffer || buffer.length < 100) {
        logger.warn(`Zoho cron [A]: Buffer buit o massa petit per ${att.fileName} (${buffer?.length || 0} bytes), saltant`);
        continue;
      }

      // Comprovar signatura PDF (%PDF-)
      const header = buffer.slice(0, 5).toString('utf-8');
      if (header !== '%PDF-') {
        // Pot ser que Zoho hagi retornat un error JSON en lloc del PDF
        const bodyStr = buffer.slice(0, 200).toString('utf-8');
        if (bodyStr.includes('"error"') || bodyStr.includes('"errorCode"')) {
          logger.warn(`Zoho cron [A]: Zoho ha retornat error en lloc de PDF per ${att.fileName}: ${bodyStr.substring(0, 150)}`);
          continue;
        }
        logger.warn(`Zoho cron [A]: ${att.fileName} no té signatura PDF (header: ${header}), pujant igualment`);
      }

      // Escriure a temporal
      const safeName = att.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);
      fs.writeFileSync(tmpPath, buffer);

      // Pujar a factures-rebudes/inbox/
      const uploadResult = await drive.files.create({
        resource: { name: att.fileName, parents: [inboxFolder.id] },
        media: { mimeType: 'application/pdf', body: fs.createReadStream(tmpPath) },
        fields: 'id, name',
        supportsAllDrives: true,
      });

      logger.info(`Zoho cron [A]: PDF pujat a inbox: ${att.fileName} → GDrive ID: ${uploadResult.data.id} (de: ${fromAddress}${supplier ? `, proveïdor: ${supplier.name}` : ''})`);
      uploadedCount++;

    } catch (attErr) {
      logger.error(`Zoho cron [A]: Error amb attachment ${att.fileName}: ${attErr.message}`);
    } finally {
      // Netejar temporal
      if (tmpPath) {
        setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
      }
    }
  }

  if (uploadedCount === 0) {
    logger.warn(`Zoho cron [A]: Cap PDF pujat de ${email.pdfAttachments.length} attachments per ${fromAddress}`);
    return;
  }

  // Marcar com a llegit
  try {
    await zohoMail.markAsRead(email.messageId, email.accountId);
    logger.info(`Zoho cron [A]: Email marcat com a llegit (${fromAddress})`);
  } catch (readErr) {
    logger.warn(`Zoho cron [A]: No s'ha pogut marcar com a llegit: ${readErr.message}`);
  }

  // Moure a carpeta FACTURA REBUDA si no hi és ja
  if (!email.folderPath?.toUpperCase().includes('FACTURA')) {
    try {
      const facturaFolderId = await zohoMail.getFolderId('FACTURA REBUDA', email.accountId);
      await zohoMail.moveMessage(email.messageId, facturaFolderId, email.accountId);
      logger.info(`Zoho cron [A]: Email mogut a FACTURA REBUDA (de: ${fromAddress})`);
    } catch (moveErr) {
      logger.warn(`Zoho cron [A]: No s'ha pogut moure a FACTURA REBUDA: ${moveErr.message}`);
    }
  }
}

/**
 * Cas B: Correu sense PDF però amb plataforma coneguda o link detectat.
 * Crea un recordatori amb instruccions específiques.
 */
async function handleLinkDetected(email, supplier, adminId) {
  if (!adminId) return;

  const from = email.emailMeta.from || 'desconegut';
  const subject = email.emailMeta.subject || 'sense assumpte';
  const platform = email.platform;
  const date = email.emailMeta.date ? email.emailMeta.date.toISOString().split('T')[0] : 'data desconeguda';

  const platformName = platform?.name || (supplier?.name || from);
  const title = `Descarregar factura: ${platformName} — ${date}`;

  let description = `Correu de factura detectat SENSE PDF adjunt.\n`;
  description += `De: ${from}\n`;
  description += `Assumpte: ${subject}\n`;
  description += `Data: ${date}\n`;
  description += `Score: ${email.scoring?.score || '?'} (${email.scoring?.reasons?.join(', ') || ''})\n\n`;

  if (platform) {
    description += `--- PLATAFORMA CONEGUDA ---\n`;
    description += `Plataforma: ${platform.name}\n`;
    description += `URL facturació: ${platform.billingUrl}\n`;
    description += `Instruccions: ${platform.instructions}\n`;
  } else {
    description += `--- LINK DETECTAT ---\n`;
    description += `El correu conté un link de descàrrega de factura.\n`;
    description += `Revisar el correu original per trobar l'enllaç.\n`;
  }

  await prisma.reminder.create({
    data: {
      title,
      description,
      dueAt: new Date(Date.now() + 2 * 24 * 3600 * 1000), // 2 dies
      priority: 'HIGH',
      entityType: 'zoho_email',
      entityId: email.messageId,
      authorId: adminId,
    },
  });

  // Marcar com a llegit
  try { await zohoMail.markAsRead(email.messageId, email.accountId); } catch {}

  logger.info(`Zoho cron [B]: Recordatori creat per ${platformName} (${from})`);
}

/**
 * Cas C: Correu probable factura sense PDF ni link clar.
 * Crea un recordatori de revisió manual.
 */
async function handleManualReview(email, supplier, adminId) {
  if (!adminId) return;

  const from = email.emailMeta.from || 'desconegut';
  const subject = email.emailMeta.subject || 'sense assumpte';
  const date = email.emailMeta.date ? email.emailMeta.date.toISOString().split('T')[0] : 'data desconeguda';

  const title = `Revisar possible factura: ${supplier?.name || from} — ${date}`;

  let description = `Correu que PODRIA ser una factura (sense PDF adjunt).\n`;
  description += `De: ${from}\n`;
  description += `Assumpte: ${subject}\n`;
  description += `Data: ${date}\n`;
  description += `Score: ${email.scoring?.score || '?'} (${email.scoring?.reasons?.join(', ') || ''})\n\n`;
  description += `Revisar el correu manualment per determinar si és una factura\n`;
  description += `i, si cal, descarregar el PDF de la plataforma corresponent.\n`;

  await prisma.reminder.create({
    data: {
      title,
      description,
      dueAt: new Date(Date.now() + 3 * 24 * 3600 * 1000), // 3 dies
      priority: 'NORMAL',
      entityType: 'zoho_email',
      entityId: email.messageId,
      authorId: adminId,
    },
  });

  // Marcar com a llegit
  try { await zohoMail.markAsRead(email.messageId, email.accountId); } catch {}

  logger.info(`Zoho cron [C]: Revisió manual per ${from} — ${subject}`);
}

// ===========================================
// Sincronització principal
// ===========================================

async function syncZohoEmails() {
  if (isRunning) {
    const minutesRunning = runStartedAt ? (Date.now() - runStartedAt) / 60000 : 0;
    if (minutesRunning > MAX_RUN_MINUTES) {
      logger.warn(`Zoho sync: Forçant reset del lock (portava ${Math.round(minutesRunning)} min)`);
      isRunning = false;
    } else {
      logger.info('Zoho sync: Ja s\'està executant, s\'omet');
      return;
    }
  }

  // Acceptar ZOHO_ACCOUNT_IDS (multi-compte) o ZOHO_ACCOUNT_ID (single)
  const hasAccounts = process.env.ZOHO_ACCOUNT_IDS || process.env.ZOHO_ACCOUNT_ID;
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET || !process.env.ZOHO_REFRESH_TOKEN || !hasAccounts) {
    return;
  }

  isRunning = true;
  runStartedAt = Date.now();

  try {
    const lastSync = await redis.get('zoho:lastSync');
    const since = lastSync
      ? new Date(parseInt(lastSync))
      : new Date(Date.now() - 24 * 3600 * 1000);

    logger.info(`Zoho cron sync: Buscant correus des de ${since.toISOString()}`);

    // Escanejar TOTS els comptes configurats (multi-compte o single)
    const results = await zohoMail.scanAllAccounts({ since, limit: 50 });

    const stats = { pdfAttached: 0, linkDetected: 0, manualReview: 0, notInvoice: 0, skipped: 0, errors: 0 };
    const adminId = await getAdminId();

    for (const email of results) {
      // Saltar si ja processat
      const alreadyProcessed = await redis.get(`zoho:processed:${email.messageId}`);
      if (alreadyProcessed) {
        stats.skipped++;
        continue;
      }

      try {
        const classification = email.classification || 'NOT_INVOICE';
        const emailLabel = `${email.emailMeta.from} — ${email.emailMeta.subject || '?'}`;

        // Detectar proveïdor
        const supplier = await findSupplierByEmail(email.emailMeta.from);

        switch (classification) {
          case 'PDF_ATTACHED':
            // A: descarregar PDF → GDrive inbox (amb timeout)
            await withTimeout(handlePdfAttached(email, supplier), PER_EMAIL_TIMEOUT_MS, emailLabel);
            await redis.set(`zoho:processed:${email.messageId}`, 'pdf_uploaded', 'EX', 90 * 24 * 3600);
            stats.pdfAttached++;
            break;

          case 'LINK_DETECTED':
            // B: recordatori amb instruccions de plataforma
            await withTimeout(handleLinkDetected(email, supplier, adminId), PER_EMAIL_TIMEOUT_MS, emailLabel);
            await redis.set(`zoho:processed:${email.messageId}`, 'link_reminder', 'EX', 90 * 24 * 3600);
            stats.linkDetected++;
            break;

          case 'MANUAL_REVIEW':
            // C: recordatori de revisió manual
            await withTimeout(handleManualReview(email, supplier, adminId), PER_EMAIL_TIMEOUT_MS, emailLabel);
            await redis.set(`zoho:processed:${email.messageId}`, 'manual_review', 'EX', 90 * 24 * 3600);
            stats.manualReview++;
            break;

          default:
            // NOT_INVOICE: marcar com a vist sense fer res
            await redis.set(`zoho:processed:${email.messageId}`, 'not_invoice', 'EX', 30 * 24 * 3600);
            stats.notInvoice++;
            break;
        }

      } catch (err) {
        logger.error(`Zoho cron: Error processant correu ${email.messageId} (${email.emailMeta.from}): ${err.message}`);
        stats.errors++;
      }
    }

    // Actualitzar timestamp
    await redis.set('zoho:lastSync', Date.now().toString());

    const total = stats.pdfAttached + stats.linkDetected + stats.manualReview + stats.notInvoice;
    if (total > 0 || stats.errors > 0) {
      logger.info(
        `Zoho cron sync completat: ` +
        `${stats.pdfAttached} PDFs pujats (A), ` +
        `${stats.linkDetected} amb link/plataforma (B), ` +
        `${stats.manualReview} revisió manual (C), ` +
        `${stats.notInvoice} descartats, ` +
        `${stats.skipped} ja processats, ` +
        `${stats.errors} errors ` +
        `(de ${results.length} escanejats)`
      );
    }
  } catch (error) {
    logger.error(`Zoho cron sync error: ${error.message}`);
  } finally {
    isRunning = false;
  }
}

/**
 * Inicialitza els cron jobs de sincronització
 * - Cada 15 minuts, de 8h a 20h, de dilluns a dissabte (horari laboral)
 * - Cada 2 hores fora d'aquest horari (nits + diumenges)
 */
function startZohoEmailSync() {
  const hasAccounts = process.env.ZOHO_ACCOUNT_IDS || process.env.ZOHO_ACCOUNT_ID;
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET || !process.env.ZOHO_REFRESH_TOKEN || !hasAccounts) {
    logger.info('Zoho Mail sync: No configurat, cron desactivat');
    return null;
  }

  const accountIds = zohoMail.getConfiguredAccountIds();
  logger.info(`Zoho Mail sync: ${accountIds.length} comptes configurats`);

  const opts = { timezone: 'Europe/Madrid' };

  // Horari laboral: cada 15 min, 8h-20h, dl-ds
  const taskPeak = cron.schedule('*/15 8-20 * * 1-6', syncZohoEmails, opts);

  // Fora d'horari: cada 2h, nits (21h-7h) dl-ds + tot el diumenge
  const taskOffNight = cron.schedule('0 0,2,4,6,21,23 * * 1-6', syncZohoEmails, opts);
  const taskOffSunday = cron.schedule('0 */2 * * 0', syncZohoEmails, opts);

  logger.info('Zoho Mail sync: Cron activat (cada 15 min 8h-20h dl-ds + cada 2h fora horari)');
  return { taskPeak, taskOffNight, taskOffSunday };
}

module.exports = { startZohoEmailSync, syncZohoEmails };
