const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');
const zohoMail = require('../services/zohoMailService');
const gdrive = require('../services/gdriveService');
const { logger } = require('../config/logger');
const { redis } = require('../config/redis');

const router = express.Router();

router.use(authenticate);

// ===========================================
// ESTAT DE CONNEXIÓ
// ===========================================

/**
 * GET /api/zoho/status — Comprovar connexió amb Zoho Mail
 * Només ADMIN
 */
router.get('/status', authorize('ADMIN'), async (req, res, next) => {
  try {
    const accountIds = zohoMail.getConfiguredAccountIds();
    if (accountIds.length <= 1) {
      // Single account — comportament original
      const result = await zohoMail.testConnection();
      res.json(result);
    } else {
      // Multi-compte: testejar cadascun
      const results = [];
      for (const accId of accountIds) {
        const result = await zohoMail.testConnection(accId);
        results.push(result);
      }
      res.json({ multiAccount: true, accounts: results });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/zoho/folders — Llista de carpetes del compte
 * Només ADMIN
 */
router.get('/folders', authorize('ADMIN'), async (req, res, next) => {
  try {
    const folders = await zohoMail.getFolders();
    res.json({ data: folders });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/zoho/debug/inbox — Diagnòstic: mostra els correus RAW de la safata
 * Sense cap filtre de data ni keywords, per comprovar que l'API respon bé
 * Només ADMIN
 */
router.get('/debug/inbox', authorize('ADMIN'), async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    // 1. Obtenir carpetes
    const foldersRaw = await zohoMail.getFolders();
    const folders = Array.isArray(foldersRaw) ? foldersRaw : [];
    const inbox = folders.find((f) =>
      f.folderName?.toLowerCase() === 'inbox' || f.path?.toLowerCase() === 'inbox'
    );
    if (!inbox) {
      return res.json({
        error: 'Carpeta Inbox no trobada',
        foldersRaw: typeof foldersRaw === 'object' ? foldersRaw : String(foldersRaw),
        folderNames: folders.map((f) => f.folderName),
      });
    }

    // 2. Obtenir correus RAW (sense filtre) — retorna la resposta sencera
    const rawResponse = await zohoMail.getRawMessages(inbox.folderId, { limit });

    // 3. Intentar extreure els missatges de la resposta
    let messages = [];
    if (Array.isArray(rawResponse)) {
      messages = rawResponse;
    } else if (rawResponse && Array.isArray(rawResponse.data)) {
      messages = rawResponse.data;
    }

    res.json({
      inboxId: inbox.folderId,
      inboxName: inbox.folderName,
      inboxMeta: {
        messageCount: inbox.messageCount,
        unreadCount: inbox.unreadCount,
      },
      rawResponseType: typeof rawResponse,
      rawResponseIsArray: Array.isArray(rawResponse),
      rawResponseKeys: rawResponse && typeof rawResponse === 'object' ? Object.keys(rawResponse) : null,
      rawResponseSample: rawResponse && typeof rawResponse === 'object' && !Array.isArray(rawResponse)
        ? JSON.stringify(rawResponse).substring(0, 500)
        : null,
      fetchedCount: messages.length,
      messages: messages.slice(0, limit).map((m) => ({
        messageId: m.messageId,
        from: m.fromAddress || m.sender,
        subject: m.subject,
        receivedTime: m.receivedTime ? new Date(parseInt(m.receivedTime)).toISOString() : null,
        hasAttachment: m.hasAttachment || false,
        status: m.status,
        flagid: m.flagid,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack?.split('\n').slice(0, 5) });
  }
});

/**
 * GET /api/zoho/debug/message/:messageId — Prova múltiples endpoints per obtenir un missatge
 */
router.get('/debug/message/:messageId', authorize('ADMIN'), async (req, res) => {
  try {
    const { messageId } = req.params;
    const folderId = req.query.folderId || '6925168000000002014'; // Inbox per defecte
    const token = await zohoMail.getAccessToken();
    const accountId = process.env.ZOHO_ACCOUNT_ID;

    // Provar múltiples endpoints (el correcte hauria de ser /details)
    const endpoints = [
      { name: 'folders/{fid}/messages/{id}/details', path: `/api/accounts/${accountId}/folders/${folderId}/messages/${messageId}/details` },
      { name: 'folders/{fid}/messages/{id}/content', path: `/api/accounts/${accountId}/folders/${folderId}/messages/${messageId}/content` },
      { name: 'messages/{id}', path: `/api/accounts/${accountId}/messages/${messageId}` },
      { name: 'folders/{fid}/messages/{id}', path: `/api/accounts/${accountId}/folders/${folderId}/messages/${messageId}` },
    ];

    const results = {};
    const https = require('https');

    for (const ep of endpoints) {
      try {
        const data = await new Promise((resolve, reject) => {
          const opts = {
            hostname: 'mail.zoho.eu',
            path: ep.path,
            method: 'GET',
            headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/json' },
          };
          const r = https.request(opts, (response) => {
            let body = '';
            response.on('data', (c) => { body += c; });
            response.on('end', () => {
              try { resolve(JSON.parse(body)); } catch { resolve({ raw: body.substring(0, 300) }); }
            });
          });
          r.on('error', (e) => resolve({ error: e.message }));
          r.setTimeout(10000, () => { r.destroy(); resolve({ error: 'timeout' }); });
          r.end();
        });
        results[ep.name] = {
          statusCode: data.status?.code,
          hasData: !!data.data,
          dataType: typeof data.data,
          isError: !!data.data?.errorCode,
          sample: JSON.stringify(data).substring(0, 300),
        };
      } catch (err) {
        results[ep.name] = { error: err.message };
      }
    }

    res.json({ messageId, folderId, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===========================================
// ESCANEIG DE CORREUS
// ===========================================

/**
 * GET /api/zoho/scan — Escaneja correus nous buscant factures
 * Retorna classificació A/B/C sense crear res a la BD
 *
 * Query params:
 *   - since: data ISO des d'on buscar
 *   - limit: nombre de correus (default 50)
 *
 * Classificacions:
 *   A) PDF_ATTACHED  → Factura amb PDF adjunt
 *   B) LINK_DETECTED → Sense PDF, plataforma coneguda o link de descàrrega
 *   C) MANUAL_REVIEW → Probable factura, revisió manual necessària
 *   NOT_INVOICE      → No sembla factura
 */
router.get('/scan', authorize('ADMIN', 'EDITOR'), requireSection('receivedInvoices'), async (req, res, next) => {
  try {
    const { since, limit = 50 } = req.query;

    const options = { limit: parseInt(limit) };
    if (since) options.since = new Date(since);

    // Escaneja totes les carpetes de TOTS els comptes configurats
    const results = await zohoMail.scanAllAccounts(options);

    // Classificar per categoria A/B/C
    const pdfAttached = results.filter((r) => r.classification === 'PDF_ATTACHED');
    const linkDetected = results.filter((r) => r.classification === 'LINK_DETECTED');
    const manualReview = results.filter((r) => r.classification === 'MANUAL_REVIEW');
    const notInvoice = results.filter((r) => r.classification === 'NOT_INVOICE');

    // Agrupar per carpeta
    const byFolder = {};
    for (const r of results) {
      const key = r.folderPath || 'Desconegut';
      if (!byFolder[key]) byFolder[key] = 0;
      byFolder[key]++;
    }

    // Format compacte per la resposta
    const formatEmail = (r) => ({
      messageId: r.messageId,
      folderId: r.folderId,
      folderPath: r.folderPath,
      accountId: r.accountId || null,
      classification: r.classification,
      from: r.emailMeta.from,
      subject: r.emailMeta.subject,
      date: r.emailMeta.date,
      score: r.scoring?.score,
      scoreReasons: r.scoring?.reasons,
      platform: r.platform?.name || null,
      platformUrl: r.platform?.billingUrl || null,
      platformInstructions: r.platform?.instructions || null,
      hasPdf: r.hasPdf,
      pdfCount: r.pdfAttachments?.length || 0,
      pdfFiles: r.pdfAttachments?.map((a) => a.fileName) || [],
    });

    res.json({
      summary: {
        total: results.length,
        pdfAttached: pdfAttached.length,
        linkDetected: linkDetected.length,
        manualReview: manualReview.length,
        notInvoice: notInvoice.length,
        byFolder,
      },
      pdfAttached: pdfAttached.map(formatEmail),
      linkDetected: linkDetected.map(formatEmail),
      manualReview: manualReview.map(formatEmail),
      notInvoice: notInvoice.map(formatEmail),
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// PROCESSAMENT DE CORREUS → FACTURES
// ===========================================

/**
 * POST /api/zoho/process — Processa un correu i crea la factura rebuda
 *
 * Body:
 *   - messageId: ID del correu
 *   - folderId: ID de la carpeta
 *   - supplierId: ID del proveïdor (opcional, per mapejar manualment)
 *   - invoiceNumber: número de factura (si es coneix)
 *   - totalAmount: import (si es coneix)
 *   - attachmentId: ID del PDF a descarregar (si n'hi ha diversos)
 *   - markAsRead: true/false (default true)
 *
 * Comportament:
 *   - Si el correu té PDF → el descarrega, puja a GDrive, crea factura amb source EMAIL_WITH_PDF
 *   - Si no té PDF → crea factura amb source EMAIL_NO_PDF, status PDF_PENDING, + recordatori
 */
router.post('/process', authorize('ADMIN', 'EDITOR'), requireSection('receivedInvoices'), async (req, res, next) => {
  try {
    const {
      messageId,
      folderId,
      accountId,
      supplierId,
      invoiceNumber,
      totalAmount,
      subtotal,
      taxRate = 21,
      taxAmount,
      issueDate,
      dueDate,
      attachmentId,
      markAsRead: shouldMark = true,
      description,
      category,
    } = req.body;

    if (!messageId || !folderId) {
      return res.status(400).json({ error: 'messageId i folderId són requerits' });
    }

    // Analitzar el correu (amb accountId si proporcionat)
    const analysis = await zohoMail.analyzeInvoiceEmail(folderId, messageId, { accountId });
    if (!analysis) {
      return res.status(404).json({ error: 'Correu no trobat' });
    }

    let gdriveFileId = null;
    let filePath = null;
    let originalFileName = null;
    let source = 'EMAIL_NO_PDF';

    // Si té PDFs, descarregar el seleccionat (o el primer)
    if (analysis.hasPdf && analysis.pdfAttachments.length > 0) {
      const targetAtt = attachmentId
        ? analysis.pdfAttachments.find((a) => a.attachmentId === attachmentId)
        : analysis.pdfAttachments[0];

      if (targetAtt) {
        try {
          // Descarregar PDF a un fitxer temporal
          const buffer = await zohoMail.downloadAttachment(folderId, messageId, targetAtt.attachmentId, accountId);
          const tmpDir = path.join(os.tmpdir(), 'seitocamera-zoho');
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

          const safeName = targetAtt.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);
          fs.writeFileSync(tmpPath, buffer);

          filePath = tmpPath;
          originalFileName = targetAtt.fileName;
          source = 'EMAIL_WITH_PDF';

          // Pujar a Google Drive
          try {
            const gFile = await gdrive.uploadFile(tmpPath, 'factures-rebudes', targetAtt.fileName, invoiceData?.issueDate || analysis.emailMeta.date || new Date());
            gdriveFileId = gFile.id;
            logger.info(`PDF de Zoho pujat a GDrive: ${targetAtt.fileName} (${gFile.id})`);
          } catch (gErr) {
            logger.warn(`Error pujant PDF de Zoho a GDrive: ${gErr.message}`);
          }

          // Netejar fitxer temporal després de pujar
          setTimeout(() => {
            try { fs.unlinkSync(tmpPath); } catch {}
          }, 5000);
        } catch (dlErr) {
          logger.warn(`Error descarregant PDF de Zoho: ${dlErr.message}`);
          // Continuar sense PDF
          source = 'EMAIL_NO_PDF';
        }
      }
    }

    // Detectar duplicat pel número de factura
    let isDuplicate = false;
    let duplicateOfId = null;

    if (invoiceNumber && supplierId) {
      const existing = await prisma.receivedInvoice.findFirst({
        where: {
          invoiceNumber: { equals: invoiceNumber, mode: 'insensitive' },
          supplierId,
        },
      });
      if (existing) {
        isDuplicate = true;
        duplicateOfId = existing.id;
        logger.warn(`Factura duplicada detectada des de Zoho: ${invoiceNumber}`);
      }
    }

    // Construir dades de la factura
    const invoiceData = {
      invoiceNumber: invoiceNumber || `ZOHO-${Date.now()}`,
      supplierId: supplierId || null,
      source,
      status: source === 'EMAIL_WITH_PDF' ? 'PENDING' : 'PDF_PENDING',
      filePath,
      originalFileName,
      gdriveFileId,
      isDuplicate,
      duplicateOfId,
      description: description || `Correu de: ${analysis.emailMeta.from} — ${analysis.emailMeta.subject}`,
      category: category || null,
      issueDate: issueDate ? new Date(issueDate) : (analysis.emailMeta.date || new Date()),
      dueDate: dueDate ? new Date(dueDate) : null,
      subtotal: subtotal ? parseFloat(subtotal) : (totalAmount ? parseFloat(totalAmount) / (1 + taxRate / 100) : 0),
      taxRate: parseFloat(taxRate),
      taxAmount: taxAmount ? parseFloat(taxAmount) : (totalAmount ? parseFloat(totalAmount) - parseFloat(totalAmount) / (1 + taxRate / 100) : 0),
      totalAmount: totalAmount ? parseFloat(totalAmount) : 0,
      currency: 'EUR',
    };

    // Crear factura
    const invoice = await prisma.receivedInvoice.create({
      data: invoiceData,
      include: {
        supplier: { select: { id: true, name: true } },
      },
    });

    // Si no té PDF → crear recordatori
    if (source === 'EMAIL_NO_PDF') {
      const reminderDue = new Date();
      reminderDue.setDate(reminderDue.getDate() + 3);

      await prisma.reminder.create({
        data: {
          title: `Baixar PDF: ${invoice.invoiceNumber} (${invoice.supplier?.name || analysis.emailMeta.from})`,
          description: `Factura rebuda per email sense PDF. Cal descarregar-la manualment de la plataforma.\nCorreu: ${analysis.emailMeta.subject}\nDe: ${analysis.emailMeta.from}`,
          dueAt: reminderDue,
          priority: 'HIGH',
          entityType: 'received_invoice',
          entityId: invoice.id,
          authorId: req.user.id,
        },
      });
    }

    // Marcar correu com a llegit
    if (shouldMark) {
      try {
        await zohoMail.markAsRead(messageId, accountId);
      } catch (markErr) {
        logger.warn(`Error marcant correu com a llegit: ${markErr.message}`);
      }
    }

    // Guardar referència del correu processat a Redis (per evitar reprocessar)
    try {
      await redis.set(`zoho:processed:${messageId}`, invoice.id, 'EX', 90 * 24 * 3600); // 90 dies
    } catch {}

    res.status(201).json({
      invoice,
      emailMeta: analysis.emailMeta,
      source,
      hasPdf: analysis.hasPdf,
      gdriveFileId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/zoho/process-batch — Processa múltiples correus d'un cop
 *
 * Body:
 *   - emails: [{messageId, folderId, supplierId?, invoiceNumber?, totalAmount?, attachmentId?}]
 */
router.post('/process-batch', authorize('ADMIN', 'EDITOR'), requireSection('receivedInvoices'), async (req, res, next) => {
  try {
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'Cal un array d\'emails a processar' });
    }

    if (emails.length > 20) {
      return res.status(400).json({ error: 'Màxim 20 correus per lot' });
    }

    const results = [];
    const errors = [];

    for (const email of emails) {
      try {
        // Comprovar si ja processat
        const alreadyProcessed = await redis.get(`zoho:processed:${email.messageId}`);
        if (alreadyProcessed) {
          results.push({
            messageId: email.messageId,
            status: 'skipped',
            reason: 'Ja processat anteriorment',
            invoiceId: alreadyProcessed,
          });
          continue;
        }

        // Simular la petició del process individual
        const analysis = await zohoMail.analyzeInvoiceEmail(email.folderId, email.messageId, { accountId: email.accountId });
        if (!analysis) {
          errors.push({ messageId: email.messageId, error: 'Correu no trobat' });
          continue;
        }

        let gdriveFileId = null;
        let filePath = null;
        let originalFileName = null;
        let source = 'EMAIL_NO_PDF';

        if (analysis.hasPdf && analysis.pdfAttachments.length > 0) {
          const targetAtt = email.attachmentId
            ? analysis.pdfAttachments.find((a) => a.attachmentId === email.attachmentId)
            : analysis.pdfAttachments[0];

          if (targetAtt) {
            try {
              const buffer = await zohoMail.downloadAttachment(email.folderId, email.messageId, targetAtt.attachmentId, email.accountId);
              const tmpDir = path.join(os.tmpdir(), 'seitocamera-zoho');
              if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

              const safeName = targetAtt.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
              const tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);
              fs.writeFileSync(tmpPath, buffer);

              filePath = tmpPath;
              originalFileName = targetAtt.fileName;
              source = 'EMAIL_WITH_PDF';

              try {
                const gFile = await gdrive.uploadFile(tmpPath, 'factures-rebudes', targetAtt.fileName, invoiceData?.issueDate || analysis.emailMeta.date || new Date());
                gdriveFileId = gFile.id;
              } catch {}

              setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
            } catch {
              source = 'EMAIL_NO_PDF';
            }
          }
        }

        const invoiceData = {
          invoiceNumber: email.invoiceNumber || `ZOHO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          supplierId: email.supplierId || null,
          source,
          status: source === 'EMAIL_WITH_PDF' ? 'PENDING' : 'PDF_PENDING',
          filePath,
          originalFileName,
          gdriveFileId,
          description: `Correu de: ${analysis.emailMeta.from} — ${analysis.emailMeta.subject}`,
          issueDate: analysis.emailMeta.date || new Date(),
          subtotal: email.totalAmount ? parseFloat(email.totalAmount) / 1.21 : 0,
          taxRate: 21,
          taxAmount: email.totalAmount ? parseFloat(email.totalAmount) - parseFloat(email.totalAmount) / 1.21 : 0,
          totalAmount: email.totalAmount ? parseFloat(email.totalAmount) : 0,
          currency: 'EUR',
        };

        const invoice = await prisma.receivedInvoice.create({ data: invoiceData });

        // Recordatori si no té PDF
        if (source === 'EMAIL_NO_PDF') {
          await prisma.reminder.create({
            data: {
              title: `Baixar PDF: ${invoice.invoiceNumber}`,
              description: `Factura rebuda per email sense PDF.\nCorreu: ${analysis.emailMeta.subject}\nDe: ${analysis.emailMeta.from}`,
              dueAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
              priority: 'HIGH',
              entityType: 'received_invoice',
              entityId: invoice.id,
              authorId: req.user.id,
            },
          });
        }

        await redis.set(`zoho:processed:${email.messageId}`, invoice.id, 'EX', 90 * 24 * 3600);

        try { await zohoMail.markAsRead(email.messageId, email.accountId); } catch {}

        results.push({
          messageId: email.messageId,
          status: 'created',
          invoiceId: invoice.id,
          source,
          hasPdf: analysis.hasPdf,
        });
      } catch (err) {
        errors.push({ messageId: email.messageId, error: err.message });
      }
    }

    logger.info(`Zoho batch: ${results.length} processats, ${errors.length} errors`);

    res.json({
      processed: results.length,
      errors: errors.length,
      results,
      errors,
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// SINCRONITZACIÓ AUTOMÀTICA
// ===========================================

/**
 * POST /api/zoho/sync — Executar sincronització manual
 * Busca correus nous des de l'última sincronització i els processa
 */
router.post('/sync', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { dryRun = false } = req.body;

    // Obtenir última sincronització
    const lastSync = await redis.get('zoho:lastSync');
    const since = lastSync ? new Date(parseInt(lastSync)) : new Date(Date.now() - 7 * 24 * 3600 * 1000); // 7 dies per defecte

    logger.info(`Zoho sync: Buscant correus nous des de ${since.toISOString()}`);

    // Escanejar totes les carpetes de TOTS els comptes configurats
    const results = await zohoMail.scanAllAccounts({
      since,
      limit: 100,
    });

    // Filtrar correus ja processats
    const toProcess = [];
    for (const r of results) {
      const alreadyProcessed = await redis.get(`zoho:processed:${r.messageId}`);
      if (!alreadyProcessed && (r.hasPdf || r.isRelevantByKeyword)) {
        toProcess.push(r);
      }
    }

    if (dryRun) {
      return res.json({
        dryRun: true,
        since: since.toISOString(),
        found: results.length,
        toProcess: toProcess.length,
        emails: toProcess.map((r) => ({
          messageId: r.messageId,
          from: r.emailMeta.from,
          subject: r.emailMeta.subject,
          hasPdf: r.hasPdf,
          pdfCount: r.pdfAttachments.length,
        })),
      });
    }

    // Processar correus nous
    const processed = [];
    const syncErrors = [];

    for (const email of toProcess) {
      try {
        let gdriveFileId = null;
        let filePath = null;
        let originalFileName = null;
        let source = email.hasPdf ? 'EMAIL_WITH_PDF' : 'EMAIL_NO_PDF';

        // Descarregar primer PDF si n'hi ha
        if (email.hasPdf && email.pdfAttachments[0]) {
          const att = email.pdfAttachments[0];
          try {
            const buffer = await zohoMail.downloadAttachment(email.folderId, email.messageId, att.attachmentId, email.accountId);
            const tmpDir = path.join(os.tmpdir(), 'seitocamera-zoho');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

            const safeName = att.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
            const tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);
            fs.writeFileSync(tmpPath, buffer);

            filePath = tmpPath;
            originalFileName = att.fileName;

            try {
              const gFile = await gdrive.uploadFile(tmpPath, 'factures-rebudes', att.fileName);
              gdriveFileId = gFile.id;
            } catch {}

            setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
          } catch {
            source = 'EMAIL_NO_PDF';
          }
        }

        const invoice = await prisma.receivedInvoice.create({
          data: {
            invoiceNumber: `ZOHO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            source,
            status: source === 'EMAIL_WITH_PDF' ? 'PENDING' : 'PDF_PENDING',
            filePath,
            originalFileName,
            gdriveFileId,
            description: `[Auto-sync] ${email.emailMeta.from} — ${email.emailMeta.subject}`,
            issueDate: email.emailMeta.date || new Date(),
            subtotal: 0,
            taxRate: 21,
            taxAmount: 0,
            totalAmount: 0,
            currency: 'EUR',
          },
        });

        if (source === 'EMAIL_NO_PDF') {
          await prisma.reminder.create({
            data: {
              title: `Completar factura: ${invoice.invoiceNumber}`,
              description: `Factura detectada per email. Cal completar dades i descarregar PDF.\nDe: ${email.emailMeta.from}\nAssumpte: ${email.emailMeta.subject}`,
              dueAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
              priority: 'HIGH',
              entityType: 'received_invoice',
              entityId: invoice.id,
              authorId: req.user.id,
            },
          });
        }

        await redis.set(`zoho:processed:${email.messageId}`, invoice.id, 'EX', 90 * 24 * 3600);
        try { await zohoMail.markAsRead(email.messageId, email.accountId); } catch {}

        processed.push({
          messageId: email.messageId,
          invoiceId: invoice.id,
          source,
          from: email.emailMeta.from,
          subject: email.emailMeta.subject,
          accountId: email.accountId || null,
        });
      } catch (err) {
        syncErrors.push({
          messageId: email.messageId,
          error: err.message,
        });
      }
    }

    // Guardar timestamp de l'última sincronització
    await redis.set('zoho:lastSync', Date.now().toString());

    logger.info(`Zoho sync complet: ${processed.length} processats, ${syncErrors.length} errors`);

    res.json({
      since: since.toISOString(),
      scanned: results.length,
      processed: processed.length,
      errors: syncErrors.length,
      details: processed,
      syncErrors,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/zoho/sync-status — Estat de l'última sincronització
 */
router.get('/sync-status', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const lastSync = await redis.get('zoho:lastSync');

    res.json({
      lastSync: lastSync ? new Date(parseInt(lastSync)).toISOString() : null,
      configured: !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_ACCOUNT_ID),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/zoho/rescan
 * Repassa el correu en un rang de dates concret per detectar factures que
 * potser s'han perdut (no s'han processat per error de connexió, filtres,
 * o que es van marcar com "no factura" erròniament).
 *
 * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", ignoreProcessed?: bool }
 *
 * Retorna stats + detall per correu trobat (per al report a la UI).
 */
router.post('/rescan', authorize('ADMIN', 'EDITOR'), requireSection('receivedInvoices'), async (req, res, next) => {
  try {
    const { from, to, ignoreProcessed = false } = req.body || {};
    if (!from || !to) {
      return res.status(400).json({ error: 'Falten camps `from` i/o `to` (format YYYY-MM-DD)' });
    }
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (isNaN(fromDate) || isNaN(toDate)) {
      return res.status(400).json({ error: 'Format de data invàlid (usa YYYY-MM-DD)' });
    }
    // Cap superior de seguretat: max 90 dies per evitar timeouts
    const diffDays = (toDate - fromDate) / 86400000;
    if (diffDays < 0) return res.status(400).json({ error: '`from` ha de ser anterior a `to`' });
    if (diffDays > 90) {
      return res.status(400).json({ error: 'Rang massa ample (màxim 90 dies). Divideix en trams.' });
    }

    const { rescanZohoRange } = require('../jobs/zohoEmailSync');
    const report = await rescanZohoRange({
      from: fromDate,
      to: toDate,
      ignoreProcessed: !!ignoreProcessed,
    });

    res.json(report);
  } catch (err) {
    logger.error(`Zoho rescan error: ${err.message}`);
    next(err);
  }
});

module.exports = router;
