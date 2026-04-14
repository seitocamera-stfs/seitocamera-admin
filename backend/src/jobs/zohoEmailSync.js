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
        let gdriveFileId = null;
        let filePath = null;
        let originalFileName = null;
        let source = email.hasPdf ? 'EMAIL_WITH_PDF' : 'EMAIL_NO_PDF';
        let pdfAnalysis = null;

        // Descarregar PDF
        if (email.hasPdf && email.pdfAttachments[0]) {
          const att = email.pdfAttachments[0];
          try {
            const buffer = await zohoMail.downloadAttachment(email.folderId, email.messageId, att.attachmentId);
            const tmpDir = path.join(os.tmpdir(), 'seitocamera-zoho');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

            const safeName = att.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
            const tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);
            fs.writeFileSync(tmpPath, buffer);

            filePath = tmpPath;
            originalFileName = att.fileName;

            // Pujar a GDrive
            try {
              const gFile = await gdrive.uploadFile(tmpPath, 'factures-rebudes', att.fileName, email.emailMeta.date || new Date());
              gdriveFileId = gFile.id;
            } catch (gErr) {
              logger.warn(`Zoho cron: Error pujant a GDrive: ${gErr.message}`);
            }

            // Analitzar contingut del PDF
            try {
              const analysis = await pdfExtract.analyzePdf(tmpPath);
              if (analysis.hasText) {
                pdfAnalysis = analysis;
                logger.info(`Zoho cron: PDF analitzat ${att.fileName} → nº: ${analysis.invoiceNumber || '-'}, total: ${analysis.totalAmount || '-'}`);
              }
            } catch (parseErr) {
              logger.warn(`Zoho cron: Error analitzant PDF: ${parseErr.message}`);
            }

            // Netejar temporal
            setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
          } catch (dlErr) {
            logger.warn(`Zoho cron: Error descarregant PDF: ${dlErr.message}`);
            source = 'EMAIL_NO_PDF';
          }
        }

        // Detecció de duplicats pel número de factura del PDF
        let isDuplicate = false;
        let duplicateOfId = null;
        if (pdfAnalysis?.invoiceNumber) {
          const dup = await pdfExtract.checkDuplicateByContent(pdfAnalysis.invoiceNumber);
          if (dup) {
            isDuplicate = true;
            duplicateOfId = dup.id;
            logger.warn(`Zoho cron: DUPLICAT detectat! ${pdfAnalysis.invoiceNumber} ja existeix (${dup.id})`);
          }
        }

        // Trobar proveïdor pel NIF
        const matchedSupplier = pdfAnalysis?.nifCif ? await pdfExtract.findSupplierByNif(pdfAnalysis.nifCif) : null;

        // Dades extretes del PDF
        const invoiceNumber = pdfAnalysis?.invoiceNumber || `ZOHO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const totalAmount = pdfAnalysis?.totalAmount || 0;
        const taxRate = 21;
        const subtotal = totalAmount > 0 ? totalAmount / (1 + taxRate / 100) : 0;
        const taxAmount = totalAmount - subtotal;

        // Crear factura
        const invoice = await prisma.receivedInvoice.create({
          data: {
            invoiceNumber,
            source,
            status: source === 'EMAIL_WITH_PDF' ? 'PENDING' : 'PDF_PENDING',
            filePath,
            originalFileName,
            gdriveFileId,
            supplierId: matchedSupplier?.id || null,
            isDuplicate,
            duplicateOfId,
            description: `[Auto] ${email.emailMeta.from} — ${email.emailMeta.subject}`,
            issueDate: pdfAnalysis?.invoiceDate || email.emailMeta.date || new Date(),
            subtotal: Math.round(subtotal * 100) / 100,
            taxRate,
            taxAmount: Math.round(taxAmount * 100) / 100,
            totalAmount: Math.round(totalAmount * 100) / 100,
            currency: 'EUR',
          },
        });

        // Recordatori si no té PDF
        if (source === 'EMAIL_NO_PDF') {
          // Obtenir el primer admin per l'authorId del recordatori
          const admin = await prisma.user.findFirst({
            where: { role: 'ADMIN', isActive: true },
            select: { id: true },
          });

          if (admin) {
            await prisma.reminder.create({
              data: {
                title: `Completar factura: ${invoice.invoiceNumber}`,
                description: `Factura detectada automàticament per email.\nDe: ${email.emailMeta.from}\nAssumpte: ${email.emailMeta.subject}`,
                dueAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
                priority: 'HIGH',
                entityType: 'received_invoice',
                entityId: invoice.id,
                authorId: admin.id,
              },
            });
          }
        }

        // Marcar com a processat i llegit
        await redis.set(`zoho:processed:${email.messageId}`, invoice.id, 'EX', 90 * 24 * 3600);
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
