const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { prisma } = require('../config/database');
const { redis } = require('../config/redis');
const gdrive = require('../services/gdriveService');
const pdfExtract = require('../services/pdfExtractService');
const { logger } = require('../config/logger');

// ===========================================
// Cron Job: Sincronització Google Drive → Factures
// ===========================================
//
// FLUX:
//   1. L'usuari puja PDFs manualment a:
//      SeitoCamera/factures-rebudes/inbox/
//
//   2. Cada 10 min el cron revisa la carpeta inbox
//
//   3. Per cada PDF:
//      a) Descarrega i analitza contingut (nº factura, NIF, import, data)
//      b) Comprova duplicats pel nº de factura
//      c) Si NO és duplicat:
//         → Mou el PDF a factures-rebudes/2026/T2/04/
//         → Crea la factura a la BD (source: GDRIVE_SYNC)
//         → Recordatori per completar dades si falten
//      d) Si ÉS duplicat:
//         → Mou el PDF a factures-rebudes/duplicades/
//         → Crea informe de duplicat a la BD
//         → Recordatori urgent
//
//   4. La carpeta inbox queda buida després de processar
//
// ===========================================

let isRunning = false;

// Cache dels IDs de carpetes per no buscar-los cada cop
let inboxFolderId = null;
let duplicadesFolderId = null;

/**
 * Obté l'ID de la carpeta inbox dins de factures-rebudes/
 */
async function getInboxFolderId() {
  if (inboxFolderId) return inboxFolderId;
  const facturesRebudesId = await gdrive.getSubfolderId('factures-rebudes');
  const inbox = await gdrive.findOrCreateFolder('inbox', facturesRebudesId);
  inboxFolderId = inbox.id;
  return inboxFolderId;
}

/**
 * Obté l'ID de la carpeta duplicades dins de factures-rebudes/
 */
async function getDuplicadesFolderId() {
  if (duplicadesFolderId) return duplicadesFolderId;
  const facturesRebudesId = await gdrive.getSubfolderId('factures-rebudes');
  const dup = await gdrive.findOrCreateFolder('duplicades', facturesRebudesId);
  duplicadesFolderId = dup.id;
  return duplicadesFolderId;
}

/**
 * Sincronització principal: processa els PDFs de la carpeta inbox
 */
async function syncGdriveFiles() {
  if (isRunning) {
    logger.info('GDrive sync: Ja s\'està executant, s\'omet');
    return { processed: 0, duplicates: 0, errors: 0 };
  }

  // Comprovar que GDrive està configurat
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY && !process.env.GOOGLE_CREDENTIALS_JSON && !process.env.GOOGLE_REFRESH_TOKEN) {
    return { processed: 0, duplicates: 0, errors: 0, message: 'GDrive no configurat' };
  }

  isRunning = true;
  const results = { processed: 0, duplicates: 0, errors: 0, details: [] };

  try {
    const inboxId = await getInboxFolderId();

    // Llistar fitxers a la carpeta inbox
    const drive = gdrive.getDriveClient();
    const res = await drive.files.list({
      q: `'${inboxId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime)',
      orderBy: 'createdTime asc',
    });

    const files = res.data.files || [];

    if (!files.length) {
      logger.debug('GDrive sync: Carpeta inbox buida');
      isRunning = false;
      return results;
    }

    // Filtrar PDFs
    const pdfFiles = files.filter((f) => {
      const name = (f.name || '').toLowerCase();
      const mime = (f.mimeType || '').toLowerCase();
      return name.endsWith('.pdf') || mime === 'application/pdf';
    });

    if (!pdfFiles.length) {
      logger.info(`GDrive sync: ${files.length} fitxers a inbox però cap PDF`);
      isRunning = false;
      return results;
    }

    logger.info(`GDrive sync: ${pdfFiles.length} PDFs trobats a inbox, processant...`);

    // Obtenir admin per recordatoris
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true },
    });

    for (const file of pdfFiles) {
      try {
        // Comprovar si ja processat (per si falla a mig)
        const alreadyProcessed = await redis.get(`gdrive:processed:${file.id}`);
        if (alreadyProcessed) continue;

        // Descarregar PDF temporalment per analitzar
        let pdfAnalysis = { hasText: false, invoiceNumber: null, nifCif: [], totalAmount: null, invoiceDate: null };
        let tmpPath = null;

        try {
          const tmpDir = path.join(os.tmpdir(), 'seitocamera-gdrive');
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);

          await gdrive.downloadFile(file.id, tmpPath);
          pdfAnalysis = await pdfExtract.analyzePdf(tmpPath);

          logger.info(`GDrive sync: Analitzat ${file.name} → nº: ${pdfAnalysis.invoiceNumber || '-'}, NIF: ${pdfAnalysis.nifCif.join(',') || '-'}, total: ${pdfAnalysis.totalAmount || '-'}`);
        } catch (dlErr) {
          logger.warn(`GDrive sync: No s'ha pogut analitzar ${file.name}: ${dlErr.message}`);
        } finally {
          if (tmpPath) setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
        }

        // Trobar o crear proveïdor (NIF → nom → crear)
        const supplierResult = await pdfExtract.findOrCreateSupplier(pdfAnalysis.nifCif, pdfAnalysis.supplierName);
        const matchedSupplier = supplierResult;
        if (supplierResult?.created) {
          logger.info(`GDrive sync: Nou proveïdor creat: ${supplierResult.name} (${supplierResult.nif || 'sense NIF'})`);
        } else if (supplierResult) {
          logger.info(`GDrive sync: Proveïdor existent: ${supplierResult.name}`);
        }

        // Comprovar duplicat pel número de factura
        let isDuplicate = false;
        let duplicateOf = null;

        if (pdfAnalysis.invoiceNumber) {
          duplicateOf = await pdfExtract.checkDuplicateByContent(
            pdfAnalysis.invoiceNumber,
            matchedSupplier?.id || null
          );
          if (duplicateOf) {
            isDuplicate = true;
            logger.warn(`GDrive sync: DUPLICAT! ${file.name} (nº ${pdfAnalysis.invoiceNumber}) = factura ${duplicateOf.id}`);
          }
        }

        // Dades de la factura
        const invoiceNumber = pdfAnalysis.invoiceNumber || `GDRIVE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const totalAmount = pdfAnalysis.totalAmount || 0;
        const taxRate = 21;
        const subtotal = totalAmount > 0 ? Math.round((totalAmount / (1 + taxRate / 100)) * 100) / 100 : 0;
        const taxAmount = Math.round((totalAmount - subtotal) * 100) / 100;
        const issueDate = pdfAnalysis.invoiceDate || (file.createdTime ? new Date(file.createdTime) : new Date());

        if (isDuplicate) {
          // ===== DUPLICAT: primer crear a BD, després moure =====
          const dupFolderId = await getDuplicadesFolderId();

          // Crear registre de duplicat a la BD PRIMER (si falla, el fitxer queda a inbox)
          // Afegir sufix per evitar violació del unique constraint [invoiceNumber, supplierId]
          const dupSuffix = `-DUP-${Date.now().toString(36)}`;
          const invoice = await prisma.receivedInvoice.create({
            data: {
              invoiceNumber: invoiceNumber + dupSuffix,
              source: 'GDRIVE_SYNC',
              status: 'PENDING',
              gdriveFileId: file.id,
              originalFileName: file.name,
              supplierId: matchedSupplier?.id || null,
              isDuplicate: true,
              duplicateOfId: duplicateOf.id,
              description: `⚠️ DUPLICAT detectat: ${file.name} (nº ${pdfAnalysis.invoiceNumber}). Original: factura ${duplicateOf.id}. PDF mogut a carpeta duplicades.`,
              issueDate,
              subtotal,
              taxRate,
              taxAmount,
              totalAmount: Math.round(totalAmount * 100) / 100,
              currency: 'EUR',
            },
          });

          // Moure a carpeta duplicades DESPRÉS de crear a BD
          await gdrive.moveFile(file.id, dupFolderId, inboxId);

          // Recordatori urgent (dins try/catch per no trencar el flux)
          try {
            if (admin) {
              await prisma.reminder.create({
                data: {
                  title: `DUPLICAT: ${pdfAnalysis.invoiceNumber} (${file.name})`,
                  description: `S'ha detectat una factura duplicada a la carpeta inbox de Google Drive.\n\n` +
                    `Fitxer: ${file.name}\n` +
                    `Número factura: ${pdfAnalysis.invoiceNumber}\n` +
                    `Proveïdor: ${matchedSupplier?.name || duplicateOf.supplier?.name || 'Desconegut'}\n` +
                    `Import: ${totalAmount}€\n\n` +
                    `Ja existeix la factura ${duplicateOf.invoiceNumber} (${duplicateOf.status}) per ${duplicateOf.totalAmount}€.\n\n` +
                    `El PDF s'ha mogut a la carpeta "duplicades". Cal decidir si eliminar-lo o si és una factura diferent.`,
                  dueAt: new Date(Date.now() + 1 * 24 * 3600 * 1000),
                  priority: 'HIGH',
                  entityType: 'received_invoice',
                  entityId: invoice.id,
                  authorId: admin.id,
                },
              });
            }
          } catch (remErr) {
            logger.warn(`GDrive sync: Error creant recordatori duplicat per ${file.name}: ${remErr.message}`);
          }

          results.duplicates++;
          results.details.push({
            file: file.name,
            status: 'duplicate',
            invoiceNumber: pdfAnalysis.invoiceNumber,
            duplicateOf: duplicateOf.id,
            movedTo: 'duplicades',
          });
        } else {
          // ===== NO DUPLICAT: primer crear a BD, després moure =====
          const destFolderId = await gdrive.getDateBasedFolderId('factures-rebudes', issueDate);

          const invoice = await prisma.receivedInvoice.create({
            data: {
              invoiceNumber,
              source: 'GDRIVE_SYNC',
              status: 'PENDING',
              gdriveFileId: file.id,
              originalFileName: file.name,
              supplierId: matchedSupplier?.id || null,
              isDuplicate: false,
              description: pdfAnalysis.hasText
                ? `PDF processat des d'inbox: ${file.name}` + (pdfAnalysis.invoiceNumber ? ` (nº ${pdfAnalysis.invoiceNumber})` : '')
                : `PDF processat des d'inbox: ${file.name} (sense text, pot ser escanejat)`,
              issueDate,
              subtotal,
              taxRate,
              taxAmount,
              totalAmount: Math.round(totalAmount * 100) / 100,
              currency: 'EUR',
            },
          });

          // Moure a carpeta organitzada DESPRÉS de crear a BD
          await gdrive.moveFile(file.id, destFolderId, inboxId);

          // Recordatori adaptat (dins try/catch per no trencar el flux)
          try {
            if (admin) {
              const missingFields = [];
              if (!pdfAnalysis.invoiceNumber) missingFields.push('número de factura');
              if (!matchedSupplier) missingFields.push('proveïdor');
              if (!pdfAnalysis.totalAmount) missingFields.push('imports');
              if (!pdfAnalysis.hasText) missingFields.push('(PDF escanejat sense text)');

              if (missingFields.length > 0) {
                await prisma.reminder.create({
                  data: {
                    title: `Completar factura: ${file.name}`,
                    description: `PDF processat des d'inbox i organitzat a Google Drive.\n\nCal completar: ${missingFields.join(', ')}.`,
                    dueAt: new Date(Date.now() + 2 * 24 * 3600 * 1000),
                    priority: 'NORMAL',
                    entityType: 'received_invoice',
                    entityId: invoice.id,
                    authorId: admin.id,
                  },
                });
              }
            }
          } catch (remErr) {
            logger.warn(`GDrive sync: Error creant recordatori per ${file.name}: ${remErr.message}`);
          }

          const m = issueDate.getMonth() + 1;
          const destPath = `${issueDate.getFullYear()}/T${Math.ceil(m / 3)}/${m.toString().padStart(2, '0')}`;

          results.processed++;
          results.details.push({
            file: file.name,
            status: 'processed',
            invoiceNumber,
            invoiceId: invoice.id,
            supplier: matchedSupplier?.name || null,
            totalAmount: Math.round(totalAmount * 100) / 100,
            movedTo: destPath,
            autoFilled: {
              invoiceNumber: !!pdfAnalysis.invoiceNumber,
              supplier: !!matchedSupplier,
              amount: !!pdfAnalysis.totalAmount,
              date: !!pdfAnalysis.invoiceDate,
            },
          });
        }

        // Marcar com processat a Redis
        await redis.set(`gdrive:processed:${file.id}`, 'done', 'EX', 90 * 24 * 3600);

      } catch (err) {
        logger.error(`GDrive sync: Error processant ${file.name}: ${err.message}`);
        results.errors++;
        results.details.push({
          file: file.name,
          status: 'error',
          error: err.message,
        });
      }
    }

    // Guardar informe de l'última sincronització a Redis
    await redis.set('gdrive:lastSync', Date.now().toString());
    await redis.set('gdrive:lastSyncReport', JSON.stringify({
      timestamp: new Date().toISOString(),
      ...results,
    }), 'EX', 30 * 24 * 3600); // Guardar 30 dies

    if (results.processed > 0 || results.duplicates > 0 || results.errors > 0) {
      logger.info(`GDrive sync completat: ${results.processed} processats, ${results.duplicates} duplicats, ${results.errors} errors`);
    }

    return results;
  } catch (error) {
    logger.error(`GDrive sync error: ${error.message}`);
    return { ...results, error: error.message };
  } finally {
    isRunning = false;
  }
}

/**
 * Inicialitza el cron job de sincronització GDrive
 * Cada 10 minuts, en horari laboral (7h-22h, cada dia)
 */
function startGdriveSyncJob() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY && !process.env.GOOGLE_CREDENTIALS_JSON && !process.env.GOOGLE_REFRESH_TOKEN) {
    logger.info('GDrive sync: No configurat, cron desactivat');
    return null;
  }

  const task = cron.schedule('*/10 7-22 * * *', syncGdriveFiles, {
    timezone: 'Europe/Madrid',
  });

  logger.info('GDrive sync: Cron activat (cada 10 min, 7h-22h)');
  return task;
}

module.exports = { startGdriveSyncJob, syncGdriveFiles };
