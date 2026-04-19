const express = require('express');
const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireSection, requireLevel } = require('../middleware/sectionAccess');
const { upload } = require('../config/upload');
const gdrive = require('../services/gdriveService');
const pdfExtract = require('../services/pdfExtractService');
const templateLearning = require('../services/templateLearningService');
const { logger } = require('../config/logger');

const router = express.Router();

router.use(authenticate);

// Protecció per secció
router.use('/received', requireSection('receivedInvoices'));
router.use('/issued', requireSection('issuedInvoices'));
router.use('/stats', (req, res, next) => {
  const { hasLevel } = require('../middleware/sectionAccess');
  if (!hasLevel(req.user, 'receivedInvoices') && !hasLevel(req.user, 'issuedInvoices')) {
    return res.status(403).json({ error: 'No tens accés a estadístiques de factures' });
  }
  next();
});

// ===========================================
// Schemas de validació
// ===========================================

const receivedInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1, 'Número de factura requerit'),
  supplierId: z.string().min(1, 'Proveïdor requerit'),
  issueDate: z.string().transform((s) => new Date(s)),
  dueDate: z.string().transform((s) => new Date(s)).optional().nullable(),
  subtotal: z.number().or(z.string().transform(Number)),
  taxRate: z.number().or(z.string().transform(Number)).default(21),
  taxAmount: z.number().or(z.string().transform(Number)),
  totalAmount: z.number().or(z.string().transform(Number)),
  currency: z.string().default('EUR'),
  status: z.enum(['PENDING', 'REVIEWED', 'APPROVED', 'REJECTED', 'PAID', 'PARTIALLY_PAID']).optional(),
  source: z.enum(['MANUAL', 'EMAIL_WITH_PDF', 'EMAIL_NO_PDF', 'GDRIVE_SYNC', 'BANK_DETECTED']).optional(),
  category: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

const issuedInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1, 'Número de factura requerit'),
  clientId: z.string().min(1, 'Client requerit'),
  issueDate: z.string().transform((s) => new Date(s)),
  dueDate: z.string().transform((s) => new Date(s)).optional().nullable(),
  subtotal: z.number().or(z.string().transform(Number)),
  taxRate: z.number().or(z.string().transform(Number)).default(21),
  taxAmount: z.number().or(z.string().transform(Number)),
  totalAmount: z.number().or(z.string().transform(Number)),
  currency: z.string().default('EUR'),
  status: z.enum(['PENDING', 'REVIEWED', 'APPROVED', 'REJECTED', 'PAID', 'PARTIALLY_PAID']).optional(),
  category: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

const statusUpdateSchema = z.object({
  status: z.enum(['PENDING', 'REVIEWED', 'APPROVED', 'REJECTED', 'PAID', 'PARTIALLY_PAID']),
});

// =============================================
// FACTURES REBUDES — LLISTAT (amb conciliació)
// =============================================

/**
 * GET /api/invoices/received — Llistar amb info de conciliació
 */
router.get('/received', async (req, res, next) => {
  try {
    const { search, status, source, supplierId, conciliated, paid, dateFrom, dateTo, deleted, page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

    // Per defecte, excloure factures a la paperera (deletedAt != null)
    // Amb ?deleted=true es mostren NOMÉS les de la paperera
    // Amb ?deleted=all es mostren totes
    if (deleted === 'true') {
      where.deletedAt = { not: null };
    } else if (deleted !== 'all') {
      where.deletedAt = null;
    }

    if (status) where.status = status;
    if (source) where.source = source;
    if (supplierId) where.supplierId = supplierId;

    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) where.issueDate.gte = new Date(dateFrom);
      if (dateTo) where.issueDate.lte = new Date(dateTo);
    }

    // Filtre per conciliació
    if (conciliated === 'true') {
      where.conciliations = { some: { status: { in: ['CONFIRMED', 'MANUAL_MATCHED'] } } };
    } else if (conciliated === 'false') {
      where.conciliations = { none: {} };
    }

    // Filtre per pagament (pagada = conciliació confirmada O status PAID)
    if (paid === 'true') {
      where.OR = [
        { status: 'PAID' },
        { conciliations: { some: { status: { in: ['CONFIRMED', 'MANUAL_MATCHED'] } } } },
      ];
    } else if (paid === 'false') {
      where.status = { not: 'PAID' };
      where.conciliations = { none: { status: { in: ['CONFIRMED', 'MANUAL_MATCHED'] } } };
    }

    if (search) {
      const searchConditions = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
      ];
      // Si el terme de cerca és un número, buscar també per import
      const searchNum = parseFloat(search.replace(',', '.'));
      if (!isNaN(searchNum) && searchNum > 0) {
        searchConditions.push({ totalAmount: { gte: searchNum - 0.02, lte: searchNum + 0.02 } });
      }
      where.OR = searchConditions;
    }

    const [invoices, total] = await Promise.all([
      prisma.receivedInvoice.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { issueDate: 'desc' },
        include: {
          supplier: { select: { id: true, name: true, nif: true } },
          conciliations: {
            include: {
              bankMovement: {
                select: { id: true, date: true, description: true, amount: true },
              },
            },
          },
        },
      }),
      prisma.receivedInvoice.count({ where }),
    ]);

    // Enriquir cada factura amb l'estat de conciliació i pagament
    const enriched = invoices.map((inv) => {
      const confirmed = inv.conciliations.find((c) => c.status === 'CONFIRMED');
      const manualMatched = inv.conciliations.find((c) => c.status === 'MANUAL_MATCHED');
      const autoMatched = inv.conciliations.find((c) => c.status === 'AUTO_MATCHED');

      // Conciliació: CONFIRMED i MANUAL_MATCHED són equivalents (pagada)
      // AUTO_MATCHED amb alta confiança (>=0.8) també es considera pagada
      const matchedConciliation = confirmed || manualMatched;
      const highConfidenceAuto = autoMatched && (autoMatched.confidence || 0) >= 0.8;

      const conciliation = matchedConciliation
        ? { status: 'CONFIRMED', bankMovement: matchedConciliation.bankMovement, matchType: matchedConciliation.status }
        : autoMatched
          ? { status: highConfidenceAuto ? 'AUTO_CONFIRMED' : 'PENDING_CONFIRM', bankMovement: autoMatched.bankMovement, confidence: autoMatched.confidence }
          : { status: 'NOT_MATCHED' };

      // Pagament: pagada si té conciliació confirmada, auto-match d'alta confiança, O status PAID
      const isPaid = inv.status === 'PAID' || !!matchedConciliation || !!highConfidenceAuto;

      return {
        ...inv,
        conciliation,
        isPaid,
        hasPdf: !!inv.filePath || !!inv.gdriveFileId,
      };
    });

    res.json({
      data: enriched,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// =============================================
// DETECCIÓ DE DUPLICATS
// =============================================

/**
 * GET /api/invoices/received/check-duplicate?invoiceNumber=X&supplierId=Y
 * Comprova si ja existeix una factura amb el mateix número
 */
router.get('/received/check-duplicate', async (req, res, next) => {
  try {
    const { invoiceNumber, supplierId } = req.query;
    if (!invoiceNumber) {
      return res.status(400).json({ error: 'invoiceNumber requerit' });
    }

    const where = {
      invoiceNumber: { equals: invoiceNumber, mode: 'insensitive' },
    };
    if (supplierId) where.supplierId = supplierId;

    const existing = await prisma.receivedInvoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        status: true,
        issueDate: true,
        supplier: { select: { name: true } },
      },
    });

    res.json({
      isDuplicate: existing.length > 0,
      matches: existing,
    });
  } catch (error) {
    next(error);
  }
});

// =============================================
// ===========================================
// POST /api/invoices/received/learn-templates — Reconstruir plantilles de TOTS els proveïdors
// ===========================================
router.post('/received/learn-templates', authorize('ADMIN'), async (req, res, next) => {
  try {
    // Buscar tots els proveïdors amb factures correctes (no provisionals)
    const suppliers = await prisma.receivedInvoice.groupBy({
      by: ['supplierId'],
      where: {
        supplierId: { not: null },
        deletedAt: null,
        isDuplicate: false,
        status: { notIn: ['NOT_INVOICE'] },
        invoiceNumber: { not: { startsWith: 'PROV-' } },
      },
      _count: { _all: true },
      having: { _all: { _count: { gte: 2 } } }, // mínim 2 factures per aprendre
    });

    const results = [];
    for (const s of suppliers) {
      const template = await templateLearning.rebuildTemplateFromHistory(s.supplierId);
      if (template) {
        const supplier = await prisma.supplier.findUnique({
          where: { id: s.supplierId },
          select: { name: true },
        });
        results.push({
          supplierId: s.supplierId,
          name: supplier?.name || 'Desconegut',
          invoiceCount: s._count._all,
          patterns: template.invoicePatterns,
          prefix: template.invoicePrefix,
          confidence: template.confidence,
        });
      }
    }

    res.json({
      message: `Plantilles reconstruïdes per ${results.length} proveïdors`,
      templates: results,
    });
  } catch (error) {
    logger.error(`Learn templates error: ${error.message}`);
    next(error);
  }
});

// ===========================================
// POST /api/invoices/received/learn-template/:supplierId — Reconstruir plantilla d'UN proveïdor
// ===========================================
router.post('/received/learn-template/:supplierId', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { supplierId } = req.params;
    const template = await templateLearning.rebuildTemplateFromHistory(supplierId);

    if (!template) {
      return res.status(404).json({ error: 'No hi ha prou factures per generar una plantilla (mínim 2)' });
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { name: true },
    });

    res.json({
      message: `Plantilla reconstruïda per ${supplier?.name || supplierId}`,
      template: {
        invoicePatterns: template.invoicePatterns,
        invoicePrefix: template.invoicePrefix,
        filePatterns: template.filePatterns,
        knownNifs: template.knownNifs,
        avgAmount: template.avgAmount,
        minAmount: template.minAmount,
        maxAmount: template.maxAmount,
        commonTaxRate: template.commonTaxRate,
        sampleCount: template.sampleCount,
        confidence: template.confidence,
      },
    });
  } catch (error) {
    logger.error(`Learn template error: ${error.message}`);
    next(error);
  }
});

// ===========================================
// GET /api/invoices/received/audit — Diagnòstic: duplicats, orfes, no-factures
// ===========================================
router.get('/received/audit', authorize('admin'), async (req, res, next) => {
  try {
    const results = {
      duplicates: [],
      orphanDb: [],
      orphanGdrive: [],
      noGdrive: [],
      inflatedAmounts: [],
      summary: {},
    };

    // 1. Duplicats: mateixa invoiceNumber + supplierId (excloent paperera i provisionals)
    const dupsRaw = await prisma.$queryRaw`
      SELECT "invoiceNumber", "supplierId", COUNT(*)::int AS cnt,
             ARRAY_AGG("id") AS ids,
             ARRAY_AGG("totalAmount"::float) AS amounts,
             ARRAY_AGG("status") AS statuses
      FROM "received_invoices"
      WHERE "deletedAt" IS NULL
        AND "isDuplicate" = false
        AND "invoiceNumber" NOT LIKE 'PROV-%'
        AND "invoiceNumber" NOT LIKE 'GDRIVE-%'
        AND "invoiceNumber" NOT LIKE 'ZOHO-%'
      GROUP BY "invoiceNumber", "supplierId"
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
    `;
    results.duplicates = dupsRaw.map((d) => ({
      invoiceNumber: d.invoiceNumber,
      supplierId: d.supplierId,
      count: d.cnt,
      ids: d.ids,
      amounts: d.amounts,
      statuses: d.statuses,
    }));

    // 2. Registres sense PDF (ni GDrive ni local)
    const noPdf = await prisma.receivedInvoice.findMany({
      where: { deletedAt: null, gdriveFileId: null, filePath: null },
      select: { id: true, invoiceNumber: true, totalAmount: true, status: true, source: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    results.noGdrive = noPdf;

    // 3. Imports inflats (>100k€)
    const inflated = await prisma.receivedInvoice.findMany({
      where: { deletedAt: null, totalAmount: { gt: 100000 } },
      select: { id: true, invoiceNumber: true, totalAmount: true, status: true, originalFileName: true, gdriveFileId: true },
      orderBy: { totalAmount: 'desc' },
      take: 50,
    });
    results.inflatedAmounts = inflated;

    // 4. Orfes GDrive ↔ BD
    try {
      const threeYearsAgo = new Date();
      threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
      const gdriveFiles = await gdrive.getNewFilesRecursive('factures-rebudes', threeYearsAgo);
      const gdriveFileIds = new Set(gdriveFiles.map((f) => f.id));

      // 4a. Orfes BD: gdriveFileId no trobat al GDrive
      const dbWithGdrive = await prisma.receivedInvoice.findMany({
        where: { deletedAt: null, gdriveFileId: { not: null } },
        select: { id: true, invoiceNumber: true, gdriveFileId: true, originalFileName: true, totalAmount: true },
      });
      results.orphanDb = dbWithGdrive.filter((inv) => !gdriveFileIds.has(inv.gdriveFileId)).slice(0, 100);

      // 4b. Orfes GDrive: fitxers sense registre BD
      const dbGdriveIds = new Set(dbWithGdrive.map((inv) => inv.gdriveFileId));
      results.orphanGdrive = gdriveFiles
        .filter((f) => !dbGdriveIds.has(f.id))
        .map((f) => ({ id: f.id, name: f.name, size: f.size, createdTime: f.createdTime, webViewLink: f.webViewLink }))
        .slice(0, 100);
    } catch (gdriveError) {
      logger.error(`Audit: error accedint a GDrive: ${gdriveError.message}`);
      results.gdriveError = gdriveError.message;
    }

    results.summary = {
      totalDuplicateGroups: results.duplicates.length,
      totalOrphanDb: results.orphanDb.length,
      totalOrphanGdrive: results.orphanGdrive.length,
      totalNoPdf: results.noGdrive.length,
      totalInflated: results.inflatedAmounts.length,
    };

    res.json(results);
  } catch (error) {
    logger.error(`Audit error: ${error.message}`);
    next(error);
  }
});

// =============================================
// DETALL amb conciliació completa
// =============================================

/**
 * GET /api/invoices/received/:id
 */
router.get('/received/:id', async (req, res, next) => {
  try {
    const invoice = await prisma.receivedInvoice.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        conciliations: {
          include: { bankMovement: true },
        },
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Factura no trobada' });
    }

    res.json(invoice);
  } catch (error) {
    next(error);
  }
});

// =============================================
// PREVIEW PDF
// =============================================

/**
 * GET /api/invoices/received/:id/pdf — Servir PDF per previsualització
 */
router.get('/received/:id/pdf', async (req, res, next) => {
  try {
    const invoice = await prisma.receivedInvoice.findUnique({
      where: { id: req.params.id },
      select: { filePath: true, gdriveFileId: true, originalFileName: true },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Factura no trobada' });
    }

    // Opció 1: fitxer local
    if (invoice.filePath && fs.existsSync(invoice.filePath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${invoice.originalFileName || 'factura.pdf'}"`);
      return fs.createReadStream(invoice.filePath).pipe(res);
    }

    // Opció 2: fitxer a Google Drive — descarregar i servir directament
    if (invoice.gdriveFileId) {
      try {
        const drive = gdrive.getDriveClient();
        const fileRes = await drive.files.get(
          { fileId: invoice.gdriveFileId, alt: 'media', supportsAllDrives: true },
          { responseType: 'stream' }
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${invoice.originalFileName || 'factura.pdf'}"`);
        return fileRes.data.pipe(res);
      } catch (err) {
        logger.warn(`Error descarregant PDF de Google Drive: ${err.message}`);
      }
    }

    res.status(404).json({ error: 'PDF no disponible' });
  } catch (error) {
    next(error);
  }
});

// =============================================
// RE-ESCANEJAR FACTURA (re-llegir PDF i extreure totes les dades)
// =============================================

/**
 * POST /api/invoices/received/:id/relocate — Mou el fitxer GDrive a la carpeta correcta segons la data
 * Accepta opcionalment { issueDate } per forçar una data diferent
 */
router.post('/received/:id/relocate', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const invoice = await prisma.receivedInvoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, gdriveFileId: true, issueDate: true, originalFileName: true },
    });
    if (!invoice) return res.status(404).json({ error: 'Factura no trobada' });
    if (!invoice.gdriveFileId) return res.status(400).json({ error: 'Factura sense fitxer GDrive' });

    // Data objectiu: la que ve al body, o la issueDate actual
    const targetDate = req.body.issueDate ? new Date(req.body.issueDate) : invoice.issueDate;
    if (!targetDate || isNaN(targetDate.getTime())) {
      return res.status(400).json({ error: 'Data no vàlida' });
    }

    // Obtenir la carpeta destí correcta
    const destFolderId = await gdrive.getDateBasedFolderId('factures-rebudes', targetDate);

    // Moure el fitxer
    await gdrive.moveFile(invoice.gdriveFileId, destFolderId);

    // Calcular la ruta per retornar-la
    const month = targetDate.getMonth() + 1;
    const quarter = Math.ceil(month / 3);
    const newPath = `${targetDate.getFullYear()}/T${quarter}/${month.toString().padStart(2, '0')}/`;

    logger.info(`Factura ${invoice.id} reubicada a GDrive: ${newPath}${invoice.originalFileName || ''}`);

    res.json({ success: true, newPath, fileName: invoice.originalFileName });
  } catch (error) {
    logger.error(`Relocate error: ${error.message}`);
    next(error);
  }
});

/**
 * POST /api/invoices/received/:id/rescan — Re-analitza el PDF d'una factura existent
 * Retorna les dades extretes SENSE guardar, perquè l'usuari les revisi al formulari.
 */
router.post('/received/:id/rescan', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const invoice = await prisma.receivedInvoice.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        filePath: true,
        gdriveFileId: true,
        originalFileName: true,
        supplierId: true,
        ocrRawData: true,
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Factura no trobada' });
    }

    // Obtenir el PDF (local o GDrive)
    let pdfBuffer = null;

    if (invoice.filePath && fs.existsSync(invoice.filePath)) {
      pdfBuffer = fs.readFileSync(invoice.filePath);
    } else if (invoice.gdriveFileId) {
      try {
        const drive = gdrive.getDriveClient();
        const fileRes = await drive.files.get(
          { fileId: invoice.gdriveFileId, alt: 'media', supportsAllDrives: true },
          { responseType: 'arraybuffer' }
        );
        pdfBuffer = Buffer.from(fileRes.data);
      } catch (err) {
        logger.warn(`Rescan: Error descarregant PDF de GDrive: ${err.message}`);
      }
    }

    if (!pdfBuffer) {
      return res.status(400).json({ error: 'Aquesta factura no té PDF associat. No es pot re-escanejar.' });
    }

    // Analitzar el PDF
    const analysis = await pdfExtract.analyzePdf(pdfBuffer);

    if (!analysis.hasText) {
      return res.status(400).json({ error: 'No s\'ha pogut extreure text del PDF (ni natiu ni OCR).' });
    }

    // Buscar proveïdor per NIF detectat
    let matchedSupplier = null;
    if (analysis.nifCif?.length > 0) {
      matchedSupplier = await pdfExtract.findSupplierByNif(analysis.nifCif);
    }

    // Si no trobem per NIF, intentar per nom
    if (!matchedSupplier && analysis.supplierName) {
      matchedSupplier = await pdfExtract.findSupplierByName(analysis.supplierName);
    }

    // Si no trobem per nom, intentar per nom de fitxer
    if (!matchedSupplier && invoice.originalFileName) {
      matchedSupplier = await pdfExtract.findSupplierByFileName(invoice.originalFileName);
    }

    // Si no trobem per cap via, intentar per NIF a plantilles
    if (!matchedSupplier && analysis.nifCif?.length > 0) {
      matchedSupplier = await pdfExtract.findSupplierByTemplateNif(analysis.nifCif);
    }

    // Calcular subtotal i IVA a partir del total detectat
    let suggestedSubtotal = null;
    let suggestedTaxRate = 21;
    let suggestedTaxAmount = null;
    if (analysis.totalAmount) {
      if (analysis.baseAmount && analysis.baseAmount < analysis.totalAmount) {
        // Tenim base imposable detectada del PDF — usar-la directament
        suggestedSubtotal = parseFloat(analysis.baseAmount.toFixed(2));
        suggestedTaxAmount = parseFloat((analysis.totalAmount - suggestedSubtotal).toFixed(2));
        // Calcular el % d'IVA real
        if (suggestedSubtotal > 0) {
          suggestedTaxRate = Math.round((suggestedTaxAmount / suggestedSubtotal) * 100);
        }
        logger.info(`Rescan: base detectada del PDF → subtotal=${suggestedSubtotal}, IVA=${suggestedTaxRate}%`);
      } else {
        // Fallback: assumir IVA 21%
        suggestedSubtotal = parseFloat((analysis.totalAmount / 1.21).toFixed(2));
        suggestedTaxAmount = parseFloat((analysis.totalAmount - suggestedSubtotal).toFixed(2));
      }
    }

    // Comprovar duplicat
    let duplicate = null;
    if (analysis.invoiceNumber) {
      duplicate = await pdfExtract.checkDuplicateByContent(
        analysis.invoiceNumber,
        matchedSupplier?.id || invoice.supplierId || null,
        analysis.totalAmount
      );
      // No comptar la pròpia factura com a duplicat
      if (duplicate && duplicate.id === invoice.id) duplicate = null;
    }

    res.json({
      hasText: analysis.hasText,
      ocrUsed: analysis.ocrUsed,
      documentType: analysis.documentType,
      baseAmount: analysis.baseAmount,
      // Dades extretes
      invoiceNumber: analysis.invoiceNumber,
      totalAmount: analysis.totalAmount,
      subtotal: suggestedSubtotal,
      taxRate: suggestedTaxRate,
      taxAmount: suggestedTaxAmount,
      invoiceDate: analysis.invoiceDate,
      // Proveïdor detectat
      nifCif: analysis.nifCif,
      supplierName: analysis.supplierName,
      matchedSupplier,
      // Duplicat
      isDuplicate: !!duplicate,
      duplicateInvoice: duplicate,
      // Debug: línies rellevants del PDF (per diagnosticar detecció)
      textLength: analysis.text?.length || 0,
      debugLines: analysis.text
        ? analysis.text.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .filter(l => /invoice|factura|número|number|n[ºúo°]|receipt|bill|ref\b/i.test(l))
            .slice(0, 15)
        : [],
    });
  } catch (error) {
    logger.error(`Rescan error: ${error.message}`);
    next(error);
  }
});

// =============================================
// ANALITZAR PDF (extreure número factura, etc.)
// =============================================

/**
 * POST /api/invoices/received/analyze-pdf — Analitza un PDF i retorna dades extretes
 * Útil per pre-omplir el formulari de nova factura
 */
router.post('/received/analyze-pdf', authorize('ADMIN', 'EDITOR'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Cap fitxer enviat' });
    }

    const analysis = await pdfExtract.analyzePdf(req.file.path);

    // Buscar proveïdor pel NIF
    const matchedSupplier = await pdfExtract.findSupplierByNif(analysis.nifCif);

    // Comprovar duplicat pel número de factura
    let duplicate = null;
    if (analysis.invoiceNumber) {
      duplicate = await pdfExtract.checkDuplicateByContent(
        analysis.invoiceNumber,
        matchedSupplier?.id || null
      );
    }

    // Netejar fitxer temporal
    setTimeout(() => { try { fs.unlinkSync(req.file.path); } catch {} }, 10000);

    res.json({
      hasText: analysis.hasText,
      invoiceNumber: analysis.invoiceNumber,
      nifCif: analysis.nifCif,
      totalAmount: analysis.totalAmount,
      invoiceDate: analysis.invoiceDate,
      matchedSupplier,
      isDuplicate: !!duplicate,
      duplicateInvoice: duplicate,
    });
  } catch (error) {
    next(error);
  }
});

// =============================================
// CREAR FACTURA REBUDA (amb duplicat check)
// =============================================

/**
 * POST /api/invoices/received — Crear amb detecció de duplicats
 */
router.post('/received', authorize('ADMIN', 'EDITOR'), upload.single('file'), async (req, res, next) => {
  try {
    const data = { ...req.body };

    // Parsejar números
    if (typeof data.subtotal === 'string') data.subtotal = parseFloat(data.subtotal);
    if (typeof data.taxRate === 'string') data.taxRate = parseFloat(data.taxRate);
    if (typeof data.taxAmount === 'string') data.taxAmount = parseFloat(data.taxAmount);
    if (typeof data.totalAmount === 'string') data.totalAmount = parseFloat(data.totalAmount);
    if (data.issueDate) data.issueDate = new Date(data.issueDate);
    if (data.dueDate) data.dueDate = new Date(data.dueDate);

    // Detecció de duplicats pel número de factura
    const duplicateCheck = await prisma.receivedInvoice.findFirst({
      where: {
        invoiceNumber: { equals: data.invoiceNumber, mode: 'insensitive' },
        supplierId: data.supplierId,
      },
      select: { id: true, invoiceNumber: true, totalAmount: true, status: true },
    });

    if (duplicateCheck) {
      // Si forceDuplicate=true, permetre però marcar
      if (req.body.forceDuplicate === 'true' || req.body.forceDuplicate === true) {
        data.isDuplicate = true;
        data.duplicateOfId = duplicateCheck.id;
        logger.warn(`Factura duplicada forçada: ${data.invoiceNumber} (original: ${duplicateCheck.id})`);
      } else {
        return res.status(409).json({
          error: 'Possible duplicat detectat',
          code: 'DUPLICATE_INVOICE',
          existing: duplicateCheck,
          message: `Ja existeix la factura ${duplicateCheck.invoiceNumber} amb import ${duplicateCheck.totalAmount}€. Vols crear-la igualment?`,
        });
      }
    }

    // Gestió del PDF
    if (req.file) {
      data.filePath = req.file.path;
      data.originalFileName = req.file.originalname;
      if (!data.source) data.source = 'MANUAL';
    } else if (!data.filePath && !data.pcloudPath) {
      data.status = 'PDF_PENDING';
      if (!data.source) data.source = 'MANUAL';
    }

    const invoice = await prisma.receivedInvoice.create({
      data,
      include: {
        supplier: { select: { id: true, name: true } },
      },
    });

    // Pujar PDF a Google Drive en segon pla
    if (req.file && (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_CREDENTIALS_JSON || process.env.GOOGLE_REFRESH_TOKEN)) {
      gdrive.uploadFile(req.file.path, 'factures-rebudes', req.file.originalname, invoice.issueDate || new Date())
        .then((gFile) => {
          prisma.receivedInvoice.update({
            where: { id: invoice.id },
            data: { gdriveFileId: gFile.id },
          }).catch(() => {});
          logger.info(`PDF pujat a Google Drive: ${req.file.originalname} (${gFile.id})`);
        })
        .catch((err) => {
          logger.warn(`Error pujant PDF a Google Drive: ${err.message}`);
        });
    }

    // Recordatori si no té PDF
    if (invoice.status === 'PDF_PENDING') {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 3);

      await prisma.reminder.create({
        data: {
          title: `Baixar PDF: ${invoice.invoiceNumber} (${invoice.supplier?.name || 'proveïdor'})`,
          description: `Factura rebuda sense PDF adjunt. Cal descarregar-la manualment de la plataforma del proveïdor.`,
          dueAt: dueDate,
          priority: 'HIGH',
          entityType: 'received_invoice',
          entityId: invoice.id,
          authorId: req.user.id,
        },
      });
    }

    res.status(201).json(invoice);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Ja existeix una factura amb aquest número per aquest proveïdor' });
    }
    if (error.code === 'P2003') {
      return res.status(400).json({ error: 'Proveïdor no trobat' });
    }
    next(error);
  }
});

// =============================================
// ADJUNTAR PDF a factura existent
// =============================================

/**
 * POST /api/invoices/received/:id/attach-pdf — Afegir PDF a una factura
 * Per quan es descarrega manualment o es puja des de pCloud
 */
router.post('/received/:id/attach-pdf', authorize('ADMIN', 'EDITOR'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Cap fitxer enviat' });
    }

    const invoice = await prisma.receivedInvoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, invoiceNumber: true, supplierId: true, totalAmount: true },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Factura no trobada' });
    }

    const updateData = {
      filePath: req.file.path,
      originalFileName: req.file.originalname,
    };

    // Analitzar contingut del PDF per extreure dades i detectar duplicats
    let pdfAnalysis = null;
    try {
      pdfAnalysis = await pdfExtract.analyzePdf(req.file.path);
      if (pdfAnalysis.hasText) {
        logger.info(`PDF analitzat (attach): nº ${pdfAnalysis.invoiceNumber || '-'}, total: ${pdfAnalysis.totalAmount || '-'}`);
      }
    } catch (parseErr) {
      logger.warn(`Error analitzant PDF adjunt: ${parseErr.message}`);
    }

    // Comprovar duplicat pel número de factura extret del PDF
    if (pdfAnalysis?.invoiceNumber) {
      const duplicate = await pdfExtract.checkDuplicateByContent(
        pdfAnalysis.invoiceNumber,
        invoice.supplierId
      );
      // Si hi ha duplicat i NO és la mateixa factura, avisar
      if (duplicate && duplicate.id !== invoice.id) {
        // No bloquejar, però retornar avís
        updateData.isDuplicate = true;
        updateData.duplicateOfId = duplicate.id;
      }

      // Actualitzar número de factura si encara té el provisional
      if (invoice.invoiceNumber.startsWith('ZOHO-') || invoice.invoiceNumber.startsWith('GDRIVE-')) {
        updateData.invoiceNumber = pdfAnalysis.invoiceNumber;
      }
    }

    // Actualitzar imports si estan a 0 i el PDF en té
    if (pdfAnalysis?.totalAmount && pdfAnalysis.totalAmount > 0) {
      const currentInvoice = await prisma.receivedInvoice.findUnique({
        where: { id: req.params.id },
        select: { totalAmount: true },
      });
      if (!currentInvoice.totalAmount || currentInvoice.totalAmount === 0) {
        updateData.totalAmount = Math.round(pdfAnalysis.totalAmount * 100) / 100;
        if (pdfAnalysis.baseAmount && pdfAnalysis.baseAmount < pdfAnalysis.totalAmount) {
          // Base imposable detectada del PDF
          updateData.subtotal = parseFloat(pdfAnalysis.baseAmount.toFixed(2));
          updateData.taxAmount = Math.round((updateData.totalAmount - updateData.subtotal) * 100) / 100;
        } else {
          const taxRate = 21;
          updateData.subtotal = Math.round((pdfAnalysis.totalAmount / (1 + taxRate / 100)) * 100) / 100;
          updateData.taxAmount = Math.round((updateData.totalAmount - updateData.subtotal) * 100) / 100;
        }
      }
    }

    // Trobar proveïdor si no en té
    if (!invoice.supplierId && pdfAnalysis?.nifCif) {
      const matchedSupplier = await pdfExtract.findSupplierByNif(pdfAnalysis.nifCif);
      if (matchedSupplier) updateData.supplierId = matchedSupplier.id;
    }

    // Si estava en PDF_PENDING, canviar a PENDING
    if (invoice.status === 'PDF_PENDING') {
      updateData.status = 'PENDING';
    }

    const updated = await prisma.receivedInvoice.update({
      where: { id: req.params.id },
      data: updateData,
      include: { supplier: { select: { id: true, name: true } } },
    });

    // Afegir info de duplicat a la resposta si n'hi ha
    if (updateData.isDuplicate) {
      updated._duplicateWarning = {
        message: `Possible duplicat: nº factura ${pdfAnalysis.invoiceNumber} ja existeix`,
        duplicateOfId: updateData.duplicateOfId,
      };
    }

    // Pujar a Google Drive en segon pla
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_CREDENTIALS_JSON || process.env.GOOGLE_REFRESH_TOKEN) {
      gdrive.uploadFile(req.file.path, 'factures-rebudes', req.file.originalname, updated.issueDate || new Date())
        .then((gFile) => {
          prisma.receivedInvoice.update({
            where: { id: req.params.id },
            data: { gdriveFileId: gFile.id },
          }).catch(() => {});
          logger.info(`PDF adjuntat i pujat a Google Drive: ${req.file.originalname} (${gFile.id})`);
        })
        .catch((err) => {
          logger.warn(`Error pujant PDF a Google Drive: ${err.message}`);
        });
    }

    // Marcar recordatoris de PDF_PENDING com a completats
    await prisma.reminder.updateMany({
      where: {
        entityType: 'received_invoice',
        entityId: req.params.id,
        title: { startsWith: 'Baixar PDF:' },
        isCompleted: false,
      },
      data: {
        isCompleted: true,
        completedAt: new Date(),
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// =============================================
// ACTUALITZAR / CANVIAR ESTAT / ELIMINAR
// =============================================

router.put('/received/:id', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const body = req.body;
    const invoiceId = req.params.id;

    // Whitelist de camps editables — no passar camps extra a Prisma
    const data = {};
    if (body.invoiceNumber !== undefined) data.invoiceNumber = String(body.invoiceNumber).trim();
    if (body.description !== undefined) data.description = body.description || null;
    if (body.category !== undefined) data.category = body.category || null;

    // Proveïdor: string buit → null
    if (body.supplierId !== undefined) {
      data.supplierId = body.supplierId || null;
    }

    // Dates: string buit → null (dueDate és opcional, issueDate obligatori)
    if (body.issueDate !== undefined) {
      data.issueDate = body.issueDate ? new Date(body.issueDate) : undefined; // no tocar si buit
    }
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }

    // Imports numèrics
    if (body.subtotal !== undefined) data.subtotal = parseFloat(body.subtotal) || 0;
    if (body.taxRate !== undefined) data.taxRate = parseFloat(body.taxRate) || 0;
    if (body.taxAmount !== undefined) data.taxAmount = parseFloat(body.taxAmount) || 0;
    if (body.totalAmount !== undefined) data.totalAmount = parseFloat(body.totalAmount) || 0;

    // Netejar camps amb valor undefined (no enviar-los a Prisma)
    for (const key of Object.keys(data)) {
      if (data[key] === undefined) delete data[key];
    }

    // Comprovar si el nº factura + proveïdor xoca amb una ALTRA factura
    if (data.invoiceNumber || data.supplierId !== undefined) {
      const current = await prisma.receivedInvoice.findUnique({
        where: { id: invoiceId },
        select: { invoiceNumber: true, supplierId: true },
      });
      const finalNumber = data.invoiceNumber || current?.invoiceNumber;
      const finalSupplier = data.supplierId !== undefined ? data.supplierId : current?.supplierId;

      if (finalNumber && finalSupplier) {
        const conflict = await prisma.receivedInvoice.findFirst({
          where: {
            invoiceNumber: { equals: finalNumber, mode: 'insensitive' },
            supplierId: finalSupplier,
            id: { not: invoiceId }, // excloure la pròpia factura
            deletedAt: null,
          },
          select: { id: true, invoiceNumber: true, totalAmount: true },
        });

        if (conflict) {
          if (body.mergeDuplicate) {
            // FUSIONAR: eliminar la factura actual (la DUP) i mantenir l'original
            // Si la DUP té millors dades, actualitzar l'original primer
            const currentFull = await prisma.receivedInvoice.findUnique({
              where: { id: invoiceId },
              select: { gdriveFileId: true, totalAmount: true, issueDate: true, description: true },
            });

            // Actualitzar l'original amb les dades editades (si l'usuari ha canviat algo)
            const mergeData = {};
            if (data.totalAmount && data.totalAmount > 0 && (!conflict.totalAmount || parseFloat(conflict.totalAmount) === 0)) {
              mergeData.totalAmount = data.totalAmount;
            }
            if (data.subtotal) mergeData.subtotal = data.subtotal;
            if (data.taxRate !== undefined) mergeData.taxRate = data.taxRate;
            if (data.taxAmount) mergeData.taxAmount = data.taxAmount;
            if (data.issueDate) mergeData.issueDate = data.issueDate;
            if (data.description) mergeData.description = data.description;

            if (Object.keys(mergeData).length > 0) {
              await prisma.receivedInvoice.update({
                where: { id: conflict.id },
                data: mergeData,
              });
            }

            // Soft-delete la factura duplicada
            await prisma.receivedInvoice.update({
              where: { id: invoiceId },
              data: { deletedAt: new Date(), description: `Fusionada amb factura ${conflict.invoiceNumber} (${conflict.id})` },
            });

            logger.info(`Merge: factura DUP ${invoiceId} fusionada amb original ${conflict.id} (${conflict.invoiceNumber})`);

            return res.json({
              merged: true,
              deletedId: invoiceId,
              keptId: conflict.id,
              message: `Factura duplicada eliminada. S'ha mantingut la factura original ${conflict.invoiceNumber}.`,
            });
          }

          if (!body.forceOverwrite) {
            return res.status(409).json({
              code: 'DUPLICATE_INVOICE',
              error: `Ja existeix la factura ${conflict.invoiceNumber} (${conflict.totalAmount}€) amb aquest proveïdor`,
              conflictId: conflict.id,
            });
          }
        }
      }
    }

    // Guardar dades anteriors per aprenentatge (abans del update)
    const oldInvoice = await prisma.receivedInvoice.findUnique({
      where: { id: invoiceId },
      select: { invoiceNumber: true, supplierId: true, totalAmount: true, taxRate: true },
    });

    const invoice = await prisma.receivedInvoice.update({
      where: { id: invoiceId },
      data,
      include: { supplier: { select: { id: true, name: true } } },
    });

    // Aprenentatge automàtic: si ha canviat el número de factura, aprendre del canvi
    const finalSupplierId = invoice.supplierId;
    const oldNumber = oldInvoice?.invoiceNumber;
    const newNumber = invoice.invoiceNumber;
    if (finalSupplierId && oldNumber !== newNumber) {
      // Fire-and-forget: no bloquejar la resposta
      templateLearning.learnFromCorrection({
        supplierId: finalSupplierId,
        oldInvoiceNumber: oldNumber,
        newInvoiceNumber: newNumber,
        totalAmount: parseFloat(invoice.totalAmount) || 0,
        taxRate: parseFloat(invoice.taxRate) || 0,
      }).catch(err => logger.error(`Template learning error: ${err.message}`));
    }

    res.json(invoice);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Factura no trobada' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'Ja existeix una factura amb aquest número per aquest proveïdor' });
    next(error);
  }
});

router.patch('/received/:id/status', authorize('ADMIN', 'EDITOR'), validate(statusUpdateSchema), async (req, res, next) => {
  try {
    const invoice = await prisma.receivedInvoice.update({
      where: { id: req.params.id },
      data: { status: req.body.status },
    });
    res.json(invoice);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Factura no trobada' });
    next(error);
  }
});

/**
 * DELETE /api/invoices/received/:id — Soft delete (mou a paperera)
 * La factura es marca amb deletedAt i es pot recuperar durant 30 dies.
 */
router.delete('/received/:id', requireLevel('receivedInvoices', 'admin'), async (req, res, next) => {
  try {
    const invoice = await prisma.receivedInvoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ error: 'Factura no trobada' });

    if (invoice.deletedAt) {
      // Ja a la paperera → eliminació definitiva
      await prisma.receivedInvoice.delete({ where: { id: req.params.id } });
      res.json({ message: 'Factura eliminada definitivament' });
    } else {
      // Soft delete → moure a paperera
      await prisma.receivedInvoice.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date() },
      });
      res.json({ message: 'Factura moguda a la paperera' });
    }
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Factura no trobada' });
    next(error);
  }
});

/**
 * POST /api/invoices/received/:id/restore — Restaurar de la paperera
 */
router.post('/received/:id/restore', requireLevel('receivedInvoices', 'admin'), async (req, res, next) => {
  try {
    await prisma.receivedInvoice.update({
      where: { id: req.params.id },
      data: { deletedAt: null },
    });
    res.json({ message: 'Factura restaurada' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Factura no trobada' });
    next(error);
  }
});

// =============================================
// FACTURES EMESES (a clients)
// =============================================

router.get('/issued', async (req, res, next) => {
  try {
    const { search, status, clientId, conciliated, dateFrom, dateTo, page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};
    if (status) where.status = status;
    if (clientId) where.clientId = clientId;
    // Filtre per conciliació
    if (conciliated === 'true') {
      where.conciliations = { some: { status: 'CONFIRMED' } };
    } else if (conciliated === 'false') {
      where.conciliations = { none: {} };
    }
    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) where.issueDate.gte = new Date(dateFrom);
      if (dateTo) where.issueDate.lte = new Date(dateTo);
    }
    if (search) {
      const searchConditions = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { client: { name: { contains: search, mode: 'insensitive' } } },
      ];
      const searchNum = parseFloat(search.replace(',', '.'));
      if (!isNaN(searchNum) && searchNum > 0) {
        searchConditions.push({ totalAmount: { gte: searchNum - 0.02, lte: searchNum + 0.02 } });
      }
      where.OR = searchConditions;
    }
    const [invoices, total] = await Promise.all([
      prisma.issuedInvoice.findMany({ where, skip, take: parseInt(limit), orderBy: { issueDate: 'desc' }, include: { client: { select: { id: true, name: true, nif: true } } } }),
      prisma.issuedInvoice.count({ where }),
    ]);
    res.json({ data: invoices, pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) { next(error); }
});

router.get('/issued/:id', async (req, res, next) => {
  try {
    const invoice = await prisma.issuedInvoice.findUnique({ where: { id: req.params.id }, include: { client: true, conciliations: { include: { bankMovement: true } } } });
    if (!invoice) return res.status(404).json({ error: 'Factura no trobada' });
    res.json(invoice);
  } catch (error) { next(error); }
});

router.post('/issued', authorize('ADMIN', 'EDITOR'), validate(issuedInvoiceSchema), async (req, res, next) => {
  try {
    const invoice = await prisma.issuedInvoice.create({ data: req.body, include: { client: { select: { id: true, name: true } } } });
    res.status(201).json(invoice);
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Ja existeix una factura amb aquest número' });
    if (error.code === 'P2003') return res.status(400).json({ error: 'Client no trobat' });
    next(error);
  }
});

router.put('/issued/:id', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const data = { ...req.body };
    if (data.issueDate) data.issueDate = new Date(data.issueDate);
    if (data.dueDate) data.dueDate = new Date(data.dueDate);
    const invoice = await prisma.issuedInvoice.update({ where: { id: req.params.id }, data, include: { client: { select: { id: true, name: true } } } });
    res.json(invoice);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Factura no trobada' });
    next(error);
  }
});

router.patch('/issued/:id/status', authorize('ADMIN', 'EDITOR'), validate(statusUpdateSchema), async (req, res, next) => {
  try {
    const invoice = await prisma.issuedInvoice.update({ where: { id: req.params.id }, data: { status: req.body.status } });
    res.json(invoice);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Factura no trobada' });
    next(error);
  }
});

router.delete('/issued/:id', requireLevel('issuedInvoices', 'admin'), async (req, res, next) => {
  try {
    await prisma.issuedInvoice.delete({ where: { id: req.params.id } });
    res.json({ message: 'Factura eliminada' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Factura no trobada' });
    next(error);
  }
});

// =============================================
// ESTADÍSTIQUES
// =============================================

router.get('/stats', async (req, res, next) => {
  try {
    const [receivedStats, issuedStats] = await Promise.all([
      prisma.receivedInvoice.groupBy({ by: ['status'], _count: true, _sum: { totalAmount: true } }),
      prisma.issuedInvoice.groupBy({ by: ['status'], _count: true, _sum: { totalAmount: true } }),
    ]);
    res.json({ received: receivedStats, issued: issuedStats });
  } catch (error) { next(error); }
});

module.exports = router;
