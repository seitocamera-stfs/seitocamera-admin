const cron = require('node-cron');
const { prisma } = require('../config/database');
const { redis } = require('../config/redis');
const zohoMail = require('../services/zohoMailService');
const gdrive = require('../services/gdriveService');
const pdfExtract = require('../services/pdfExtractService');
const { logger } = require('../config/logger');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ===========================================
// Cron Job: Sincronització Zoho Mail → Factures
// ===========================================
// Cada 15 minuts busca correus nous a la safata d'entrada
// i crea factures automàticament si detecta PDFs de factura.
// ===========================================

let isRunning = false;

async function syncZohoEmails() {
  // Evitar execucions solapades
  if (isRunning) {
    logger.info('Zoho sync: Ja s\'està executant, s\'omet');
    return;
  }

  // Comprovar que Zoho està configurat
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET || !process.env.ZOHO_REFRESH_TOKEN || !process.env.ZOHO_ACCOUNT_ID) {
    return; // Zoho no configurat, no fer res
  }

  isRunning = true;

  try {
    // Obtenir última sincronització
    const lastSync = await redis.get('zoho:lastSync');
    const since = lastSync
      ? new Date(parseInt(lastSync))
      : new Date(Date.now() - 24 * 3600 * 1000); // 24h per defecte

    logger.info(`Zoho cron sync: Buscant correus des de ${since.toISOString()}`);

    // Escanejar correus
    const results = await zohoMail.scanForInvoices({
      folderName: 'Inbox',
      since,
      limit: 50,
    });

    let processedCount = 0;
    let errorCount = 0;

    for (const email of results) {
      // Saltar si ja processat
      const alreadyProcessed = await redis.get(`zoho:processed:${email.messageId}`);
      if (alreadyProcessed) continue;

      // Només processar si té PDF o és rellevant per paraules clau
      if (!email.hasPdf && !email.isRelevantByKeyword) continue;

      try {
        // Si té PDF → pujar a inbox de GDrive (el gdriveSyncJob s'encarregarà de tot)
        if (email.hasPdf && email.pdfAttachments[0]) {
          const att = email.pdfAttachments[0];
          try {
            const buffer = await zohoMail.downloadAttachment(email.folderId, email.messageId, att.attachmentId);
            const tmpDir = path.join(os.tmpdir(), 'seitocamera-zoho');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

            const safeName = att.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
            const tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);
            fs.writeFileSync(tmpPath, buffer);

            // Pujar a factures-rebudes/inbox/ → el gdriveSyncJob l'analitzarà i organitzarà
            const facturesId = await gdrive.getSubfolderId('factures-rebudes');
            const inboxFolder = await gdrive.findOrCreateFolder('inbox', facturesId);
            const drive = gdrive.getDriveClient();
            await drive.files.create({
              resource: { name: att.fileName, parents: [inboxFolder.id] },
              media: { mimeType: 'application/pdf', body: fs.createReadStream(tmpPath) },
              fields: 'id',
            });

            logger.info(`Zoho cron: PDF pujat a inbox: ${att.fileName}`);

            // Netejar temporal
            setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
          } catch (dlErr) {
            logger.warn(`Zoho cron: Error descarregant/pujant PDF: ${dlErr.message}`);
          }
        } else {
          // Sense PDF → crear factura amb estat PDF_PENDING + recordatori
          const invoiceNumber = `ZOHO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const invoice = await prisma.receivedInvoice.create({
            data: {
              invoiceNumber,
              source: 'EMAIL_NO_PDF',
              status: 'PDF_PENDING',
              description: `[Auto] ${email.emailMeta.from} — ${email.emailMeta.subject}`,
              issueDate: email.emailMeta.date || new Date(),
              subtotal: 0,
              taxRate: 21,
              taxAmount: 0,
              totalAmount: 0,
              currency: 'EUR',
            },
          });

          // Recordatori per completar
          try {
            const admin = await prisma.user.findFirst({
              where: { role: 'ADMIN', isActive: true },
              select: { id: true },
            });
            if (admin) {
              await prisma.reminder.create({
                data: {
                  title: `Completar factura: ${invoice.invoiceNumber}`,
                  description: `Factura detectada per email sense PDF.\nDe: ${email.emailMeta.from}\nAssumpte: ${email.emailMeta.subject}`,
                  dueAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
                  priority: 'HIGH',
                  entityType: 'received_invoice',
                  entityId: invoice.id,
                  authorId: admin.id,
                },
              });
            }
          } catch (remErr) {
            logger.warn(`Zoho cron: Error creant recordatori: ${remErr.message}`);
          }
        }

        // Marcar com a processat i llegit
        await redis.set(`zoho:processed:${email.messageId}`, 'done', 'EX', 90 * 24 * 3600);
        try { await zohoMail.markAsRead(email.messageId); } catch {}

        processedCount++;
      } catch (err) {
        logger.error(`Zoho cron: Error processant correu ${email.messageId}: ${err.message}`);
        errorCount++;
      }
    }

    // Actualitzar timestamp
    await redis.set('zoho:lastSync', Date.now().toString());

    if (processedCount > 0 || errorCount > 0) {
      logger.info(`Zoho cron sync completat: ${processedCount} processats, ${errorCount} errors (de ${results.length} escanejats)`);
    }
  } catch (error) {
    logger.error(`Zoho cron sync error: ${error.message}`);
  } finally {
    isRunning = false;
  }
}

/**
 * Inicialitza el cron job de sincronització
 * Cada 15 minuts, en horari laboral (8h-20h, dilluns a dissabte)
 */
function startZohoEmailSync() {
  // Comprovar que Zoho està configurat
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET || !process.env.ZOHO_REFRESH_TOKEN || !process.env.ZOHO_ACCOUNT_ID) {
    logger.info('Zoho Mail sync: No configurat, cron desactivat');
    return null;
  }

  // Cada 15 minuts, de 8h a 20h, de dilluns a dissabte
  const task = cron.schedule('*/15 8-20 * * 1-6', syncZohoEmails, {
    timezone: 'Europe/Madrid',
  });

  logger.info('Zoho Mail sync: Cron activat (cada 15 min, 8h-20h, dl-ds)');
  return task;
}

module.exports = { startZohoEmailSync, syncZohoEmails };
