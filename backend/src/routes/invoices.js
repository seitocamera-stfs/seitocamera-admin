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
const company = require('../config/company');

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
  irpfRate: z.number().or(z.string().transform(Number)).default(0),
  irpfAmount: z.number().or(z.string().transform(Number)).default(0),
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
    const { search, status, source, supplierId, conciliated, paid, dateFrom, dateTo, deleted, alerts, sortBy, sortOrder, page = 1, limit = 25 } = req.query;
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

    // Per defecte, excloure NOT_INVOICE (documents que no són factures)
    if (status === 'PENDING_ALL') {
      // Agrupa tots els estats "pendents" (PENDING, PDF_PENDING, AMOUNT_PENDING, REVIEWED)
      where.status = { in: ['PENDING', 'PDF_PENDING', 'AMOUNT_PENDING', 'REVIEWED'] };
    } else if (status) {
      where.status = status;
    } else {
      where.status = { not: 'NOT_INVOICE' };
    }
    if (source) where.source = source;
    if (supplierId) where.supplierId = supplierId;

    // Per defecte, excloure factures LOGISTIK (comptabilitat independent)
    // Amb ?origin=LOGISTIK es mostren NOMÉS les de Logistik
    // Amb ?origin=all es mostren totes
    const { origin } = req.query;
    if (origin === 'all') {
      // No filtrar per origin
    } else if (origin) {
      where.origin = origin;
    } else {
      where.origin = { not: 'LOGISTIK' };
    }

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
    // IMPORTANT: No sobreescriure where.status existent (pot venir del filtre d'status)
    if (paid === 'true') {
      where.OR = [
        { status: 'PAID' },
        { conciliations: { some: { status: { in: ['CONFIRMED', 'MANUAL_MATCHED'] } } } },
      ];
    } else if (paid === 'false') {
      // Combinar amb status existent usant AND per no sobreescriure
      const paidFilters = {
        status: { not: 'PAID' },
        conciliations: { none: { status: { in: ['CONFIRMED', 'MANUAL_MATCHED'] } } },
      };
      if (where.status) {
        // Ja hi ha un filtre d'status → combinar amb AND
        where.AND = [
          ...(where.AND || []),
          { status: where.status },
          paidFilters,
        ];
        delete where.status;
      } else {
        where.status = paidFilters.status;
        where.conciliations = paidFilters.conciliations;
      }
    }

    // Filtre per alertes — factures que necessiten revisió
    if (alerts === 'true') {
      where.OR = [
        { totalAmount: { equals: 0 } },                                     // Import 0€ (negatius són abonaments vàlids)
        { invoiceNumber: { startsWith: 'PROV-' } },                       // Número provisional
        { invoiceNumber: { startsWith: 'GDRIVE-' } },                     // Número provisional
        { invoiceNumber: { startsWith: 'ZOHO-' } },                       // Número provisional
        { invoiceNumber: { contains: '-DUP-' } },                         // Duplicat no resolt
        { supplierId: null },                                              // Sense proveïdor
        { status: 'PDF_PENDING' },                                        // Pendent de revisió PDF
        { status: 'AMOUNT_PENDING' },                                     // Pendent de revisió import
        { isDuplicate: true },                                             // Marcada com duplicat
        { gdriveFileId: null },                                              // Sense PDF al Drive
      ];
    }

    if (search) {
      const searchConditions = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
      ];
      const searchNum = parseFloat(search.replace(',', '.'));
      if (!isNaN(searchNum) && searchNum > 0) {
        searchConditions.push({ totalAmount: { gte: searchNum - 0.02, lte: searchNum + 0.02 } });
      }
      // Si ja tenim un OR (d'alerts), combinar amb AND per no sobreescriure
      if (where.OR) {
        where.AND = [
          { OR: where.OR },
          { OR: searchConditions },
        ];
        delete where.OR;
      } else {
        where.OR = searchConditions;
      }
    }

    // Ordenació dinàmica
    // Per issueDate: primer les dates reals, després les estimades (fallback de data de pujada)
    const dir = sortOrder === 'asc' ? 'asc' : 'desc';
    const orderByMap = {
      invoiceNumber: [{ invoiceNumber: dir }],
      supplier: [{ supplier: { name: dir } }],
      issueDate: [{ isDateEstimated: 'asc' }, { issueDate: dir }], // dates reals primer
      createdAt: [{ createdAt: dir }],
      totalAmount: [{ totalAmount: dir }],
      status: [{ status: dir }],
      source: [{ source: dir }],
    };
    const orderBy = orderByMap[sortBy] || [{ isDateEstimated: 'asc' }, { issueDate: 'desc' }];

    const [invoices, total] = await Promise.all([
      prisma.receivedInvoice.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy,
        include: {
          supplier: { select: { id: true, name: true, nif: true } },
          conciliations: {
            include: {
              bankMovement: {
                select: { id: true, date: true, description: true, amount: true },
              },
            },
          },
          _count: { select: { equipment: true } },
        },
      }),
      prisma.receivedInvoice.count({ where }),
    ]);

    // Enriquir cada factura amb l'estat de conciliació i pagament
    const enriched = invoices.map((inv) => {
      const confirmed = inv.conciliations.find((c) => c.status === 'CONFIRMED');
      const manualMatched = inv.conciliations.find((c) => c.status === 'MANUAL_MATCHED');
      const autoMatched = inv.conciliations.find((c) => c.status === 'AUTO_MATCHED');

      // Conciliació: qualsevol match (CONFIRMED, MANUAL_MATCHED, AUTO_MATCHED) és "pagada"
      const matchedConciliation = confirmed || manualMatched;
      const anyConciliation = matchedConciliation || autoMatched;

      const conciliation = matchedConciliation
        ? { status: 'CONFIRMED', bankMovement: matchedConciliation.bankMovement, matchType: matchedConciliation.status }
        : autoMatched
          ? { status: 'AUTO_MATCHED', bankMovement: autoMatched.bankMovement, confidence: autoMatched.confidence }
          : { status: 'NOT_MATCHED' };

      // Pagament: pagada si té QUALSEVOL conciliació (CONFIRMED, MANUAL_MATCHED o AUTO_MATCHED), O status PAID
      const isPaid = inv.status === 'PAID' || !!matchedConciliation || !!autoMatched;

      // Alertes: motius pels quals la factura necessita revisió
      const alertReasons = [];
      if (parseFloat(inv.totalAmount) === 0) alertReasons.push('Import 0€');
      if (/^(PROV-|GDRIVE-|ZOHO-)/.test(inv.invoiceNumber)) alertReasons.push('Nº provisional');
      if (inv.invoiceNumber.includes('-DUP-')) alertReasons.push('Duplicat');
      if (!inv.supplierId) alertReasons.push('Sense proveïdor');
      if (inv.status === 'PDF_PENDING') alertReasons.push('PDF pendent');
      if (inv.status === 'AMOUNT_PENDING') alertReasons.push('Import pendent');
      if (inv.isDuplicate) alertReasons.push('Marcat duplicat');
      if (!inv.gdriveFileId) alertReasons.push('Sense PDF');

      // Calcular remaining per pagaments parcials
      const paidAmt = parseFloat(inv.paidAmount || 0);
      const totalAmt = parseFloat(inv.totalAmount);
      const remainingAmount = Math.max(0, totalAmt - paidAmt);

      return {
        ...inv,
        conciliation,
        isPaid,
        remainingAmount,
        hasPdf: !!inv.filePath || !!inv.gdriveFileId,
        alerts: alertReasons,
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
router.get('/received/audit', authorize('ADMIN'), async (req, res, next) => {
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
// =============================================
// BULK RESCAN — Re-escanejar múltiples factures i aplicar canvis
// =============================================
router.post('/received/bulk-rescan', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Cal enviar un array d\'IDs' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ error: 'Màxim 200 factures per bulk rescan' });
    }

    const invoices = await prisma.receivedInvoice.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        invoiceNumber: true,
        filePath: true,
        gdriveFileId: true,
        originalFileName: true,
        supplierId: true,
        totalAmount: true,
        subtotal: true,
        taxRate: true,
        issueDate: true,
        status: true,
        isDuplicate: true,
      },
    });

    const results = { processed: 0, updated: 0, skipped: 0, errors: 0, details: [] };

    for (const invoice of invoices) {
      try {
        // Obtenir PDF
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
            logger.warn(`Bulk rescan: Error descarregant PDF ${invoice.id}: ${err.message}`);
          }
        }

        if (!pdfBuffer) {
          results.skipped++;
          results.details.push({ id: invoice.id, num: invoice.invoiceNumber, status: 'skipped', reason: 'Sense PDF' });
          continue;
        }

        // Analitzar
        const analysis = await pdfExtract.analyzePdf(pdfBuffer);
        results.processed++;

        if (!analysis.hasText) {
          results.skipped++;
          results.details.push({ id: invoice.id, num: invoice.invoiceNumber, status: 'skipped', reason: 'Sense text' });
          continue;
        }

        // Buscar proveïdor
        let matchedSupplier = null;
        if (analysis.nifCif?.length > 0) {
          matchedSupplier = await pdfExtract.findSupplierByNif(analysis.nifCif);
        }
        if (!matchedSupplier && analysis.supplierName) {
          matchedSupplier = await pdfExtract.findSupplierByName(analysis.supplierName);
        }
        if (!matchedSupplier && invoice.originalFileName) {
          matchedSupplier = await pdfExtract.findSupplierByFileName(invoice.originalFileName);
        }

        // Construir actualitzacions (només si millora)
        const updateData = {};
        const changes = [];

        // AUTO-CREAR proveïdor si tenim NIF i nom però no existeix
        if (!matchedSupplier && analysis.nifCif?.length > 0 && analysis.supplierName) {
          const nif = analysis.nifCif[0];
          try {
            const existingByNif = await prisma.supplier.findFirst({ where: { nif: { equals: nif, mode: 'insensitive' } } });
            if (existingByNif) {
              matchedSupplier = existingByNif;
            } else {
              matchedSupplier = await prisma.supplier.create({
                data: { name: analysis.supplierName, nif },
              });
              logger.info(`Bulk rescan: auto-creat proveïdor "${analysis.supplierName}" (NIF: ${nif})`);
              changes.push(`proveïdor creat: ${analysis.supplierName}`);
            }
          } catch (createErr) {
            if (createErr.code === 'P2002') {
              matchedSupplier = await prisma.supplier.findFirst({ where: { nif } });
            }
          }
        }

        // Número de factura: actualitzar si era provisional
        if (analysis.invoiceNumber && /^(PROV-|GDRIVE-|ZOHO-)/.test(invoice.invoiceNumber)) {
          updateData.invoiceNumber = analysis.invoiceNumber;
          changes.push(`nº: ${invoice.invoiceNumber} → ${analysis.invoiceNumber}`);
        }

        // Import: actualitzar si era 0 o no tenia
        if (analysis.totalAmount && analysis.totalAmount > 0 && (!invoice.totalAmount || parseFloat(invoice.totalAmount) === 0)) {
          updateData.totalAmount = Math.round(analysis.totalAmount * 100) / 100;
          if (analysis.aiExtracted && analysis.baseAmount && analysis.taxRate !== undefined) {
            updateData.subtotal = parseFloat(analysis.baseAmount.toFixed(2));
            updateData.taxRate = analysis.taxRate;
            updateData.taxAmount = analysis.taxAmount != null ? parseFloat(analysis.taxAmount.toFixed(2)) : parseFloat((updateData.subtotal * analysis.taxRate / 100).toFixed(2));
            if (analysis.irpfRate) updateData.irpfRate = analysis.irpfRate;
            if (analysis.irpfAmount) updateData.irpfAmount = parseFloat(analysis.irpfAmount.toFixed(2));
          } else if (analysis.baseAmount && analysis.baseAmount < analysis.totalAmount) {
            updateData.subtotal = parseFloat(analysis.baseAmount.toFixed(2));
            updateData.taxAmount = Math.round((updateData.totalAmount - updateData.subtotal) * 100) / 100;
            if (updateData.subtotal > 0) updateData.taxRate = Math.round((updateData.taxAmount / updateData.subtotal) * 100);
          } else {
            updateData.subtotal = Math.round((updateData.totalAmount / 1.21) * 100) / 100;
            updateData.taxAmount = Math.round((updateData.totalAmount - updateData.subtotal) * 100) / 100;
            updateData.taxRate = 21;
          }
          changes.push(`import: 0 → ${updateData.totalAmount}€`);
        }

        // Data: actualitzar si no en tenia o era la data de pujada
        if (analysis.invoiceDate && !invoice.issueDate) {
          updateData.issueDate = analysis.invoiceDate;
          changes.push(`data: → ${analysis.invoiceDate.toISOString().slice(0, 10)}`);
        }

        // Proveïdor: assignar si no en tenia
        if (matchedSupplier?.id && !invoice.supplierId) {
          updateData.supplierId = matchedSupplier.id;
          changes.push(`proveïdor: → ${matchedSupplier.name}`);
        }

        // Estat: si era AMOUNT_PENDING i ara tenim import, canviar a PENDING
        if (invoice.status === 'AMOUNT_PENDING' && updateData.totalAmount) {
          updateData.status = 'PENDING';
          changes.push('estat: AMOUNT_PENDING → PENDING');
        }
        if (invoice.status === 'PDF_PENDING' && analysis.invoiceNumber) {
          updateData.status = 'PENDING';
          changes.push('estat: PDF_PENDING → PENDING');
        }

        // Duplicat: comprovar amb el número extret
        if (analysis.invoiceNumber) {
          const duplicate = await pdfExtract.checkDuplicateByContent(
            analysis.invoiceNumber,
            matchedSupplier?.id || invoice.supplierId || null,
            analysis.totalAmount,
            analysis.invoiceDate || null
          );
          if (duplicate && duplicate.id !== invoice.id) {
            updateData.isDuplicate = true;
            updateData.duplicateOfId = duplicate.id;
            changes.push(`duplicat de ${duplicate.invoiceNumber}`);
          } else if (invoice.isDuplicate) {
            updateData.isDuplicate = false;
            updateData.duplicateOfId = null;
            changes.push('desmarcat duplicat');
          }
        }

        // Protecció: comprovar unique constraint (invoiceNumber + supplierId) abans d'actualitzar
        if (updateData.invoiceNumber || updateData.supplierId) {
          const finalNumber = updateData.invoiceNumber || invoice.invoiceNumber;
          const finalSupplier = updateData.supplierId || invoice.supplierId;
          if (finalNumber && finalSupplier) {
            const conflict = await prisma.receivedInvoice.findFirst({
              where: {
                invoiceNumber: { equals: finalNumber, mode: 'insensitive' },
                supplierId: finalSupplier,
                id: { not: invoice.id },
                deletedAt: null,
              },
              select: { id: true, invoiceNumber: true },
            });
            if (conflict) {
              // Ja existeix una factura amb el mateix número + proveïdor → marcar com duplicat
              updateData.isDuplicate = true;
              updateData.duplicateOfId = conflict.id;
              // No canviar invoiceNumber ni supplierId per evitar el constraint
              delete updateData.invoiceNumber;
              delete updateData.supplierId;
              changes.push(`duplicat de ${conflict.invoiceNumber} (constraint)`);
              logger.warn(`Bulk rescan: ${invoice.invoiceNumber} → constraint amb ${conflict.invoiceNumber}, marcat duplicat`);
            }
          }
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.receivedInvoice.update({
            where: { id: invoice.id },
            data: updateData,
          });
          results.updated++;
          results.details.push({
            id: invoice.id,
            num: updateData.invoiceNumber || invoice.invoiceNumber,
            status: 'updated',
            changes,
            aiExtracted: analysis.aiExtracted || false,
          });
        } else {
          results.details.push({
            id: invoice.id,
            num: invoice.invoiceNumber,
            status: 'unchanged',
            aiExtracted: analysis.aiExtracted || false,
          });
        }
      } catch (invErr) {
        results.errors++;
        results.details.push({ id: invoice.id, num: invoice.invoiceNumber, status: 'error', reason: invErr.message });
        logger.error(`Bulk rescan error (${invoice.id}): ${invErr.message}`);
      }
    }

    logger.info(`Bulk rescan completat: ${results.processed} processats, ${results.updated} actualitzats, ${results.skipped} saltats, ${results.errors} errors`);
    res.json(results);
  } catch (error) {
    next(error);
  }
});

// =============================================
// BULK EXTRACT EQUIPMENT — Extreure equips de múltiples factures
// =============================================
router.post('/received/bulk-extract-equipment', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Cal enviar un array d\'IDs' });
    }
    if (ids.length > 50) {
      return res.status(400).json({ error: 'Màxim 50 factures per extracció' });
    }

    const equipmentService = require('../services/equipmentExtractService');
    const results = { processed: 0, extracted: 0, skipped: 0, errors: 0, totalItems: 0, details: [] };

    for (const id of ids) {
      try {
        results.processed++;
        const result = await equipmentService.extractEquipmentFromInvoice(id, { force: true, manual: true });
        if (result.skipped) {
          results.skipped++;
          results.details.push({ id, status: 'skipped', reason: result.reason });
        } else {
          results.extracted++;
          results.totalItems += result.items.length;
          results.details.push({ id, status: 'ok', items: result.items.length });
        }
        // Pausa entre crides API
        await new Promise((r) => setTimeout(r, 1500));
      } catch (err) {
        results.errors++;
        results.details.push({ id, status: 'error', reason: err.message });
      }
    }

    res.json(results);
  } catch (error) {
    next(error);
  }
});

// =============================================
// BULK MARK PAID — Marcar múltiples factures com a pagades
// =============================================
router.patch('/received/bulk-mark-paid', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Cal enviar un array d\'IDs' });
    }

    const result = await prisma.receivedInvoice.updateMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        status: { not: 'PAID' },
      },
      data: { status: 'PAID' },
    });

    res.json({ message: `${result.count} factures marcades com a pagades`, count: result.count });
  } catch (error) {
    next(error);
  }
});

// =============================================
// RESCAN individual
// =============================================
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

    // AUTO-CREAR proveïdor si tenim NIF i nom però no existeix
    if (!matchedSupplier && analysis.nifCif?.length > 0 && analysis.supplierName) {
      const nif = analysis.nifCif[0];
      try {
        // Comprovar que el NIF no existeix ja (sense proveïdor associat)
        const existingByNif = await prisma.supplier.findFirst({ where: { nif: { equals: nif, mode: 'insensitive' } } });
        if (existingByNif) {
          matchedSupplier = existingByNif;
        } else {
          matchedSupplier = await prisma.supplier.create({
            data: { name: analysis.supplierName, nif },
          });
          logger.info(`Rescan: auto-creat proveïdor "${analysis.supplierName}" (NIF: ${nif})`);
        }
      } catch (createErr) {
        // Si falla per NIF duplicat (unique constraint), buscar el que existeix
        if (createErr.code === 'P2002') {
          matchedSupplier = await prisma.supplier.findFirst({ where: { nif } });
        } else {
          logger.warn(`Rescan: error creant proveïdor: ${createErr.message}`);
        }
      }
    }

    // Calcular subtotal i IVA a partir del total detectat
    let suggestedSubtotal = null;
    let suggestedTaxRate = 21;
    let suggestedTaxAmount = null;
    let suggestedIrpfRate = analysis.irpfRate || 0;
    let suggestedIrpfAmount = analysis.irpfAmount || 0;
    if (analysis.totalAmount) {
      if (analysis.aiExtracted && analysis.baseAmount && analysis.taxRate !== undefined) {
        // Claude ha extret tot: usar directament
        suggestedSubtotal = parseFloat(analysis.baseAmount.toFixed(2));
        suggestedTaxRate = analysis.taxRate;
        suggestedTaxAmount = analysis.taxAmount != null
          ? parseFloat(analysis.taxAmount.toFixed(2))
          : parseFloat((suggestedSubtotal * suggestedTaxRate / 100).toFixed(2));
        logger.info(`Rescan (AI): subtotal=${suggestedSubtotal}, IVA=${suggestedTaxRate}%, IRPF=${suggestedIrpfRate}%`);
      } else if (analysis.baseAmount && analysis.baseAmount < analysis.totalAmount) {
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
        analysis.totalAmount,
        analysis.invoiceDate || null
      );
      // No comptar la pròpia factura com a duplicat
      if (duplicate && duplicate.id === invoice.id) duplicate = null;
    }

    res.json({
      hasText: analysis.hasText,
      ocrUsed: analysis.ocrUsed,
      aiExtracted: analysis.aiExtracted || false,
      documentType: analysis.documentType,
      baseAmount: analysis.baseAmount,
      // Dades extretes
      invoiceNumber: analysis.invoiceNumber,
      totalAmount: analysis.totalAmount,
      subtotal: suggestedSubtotal,
      taxRate: suggestedTaxRate,
      taxAmount: suggestedTaxAmount,
      irpfRate: suggestedIrpfRate,
      irpfAmount: suggestedIrpfAmount,
      invoiceDate: analysis.invoiceDate,
      description: analysis.description || null,
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
        matchedSupplier?.id || null,
        analysis.totalAmount || null,
        analysis.invoiceDate || null
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

    // Detecció de duplicats pel número de factura (excloure factures a la paperera)
    const duplicateCheck = await prisma.receivedInvoice.findFirst({
      where: {
        invoiceNumber: { equals: data.invoiceNumber, mode: 'insensitive' },
        supplierId: data.supplierId,
        deletedAt: null,
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
        .then(async (gFile) => {
          try {
            await prisma.receivedInvoice.update({
              where: { id: invoice.id },
              data: { gdriveFileId: gFile.id },
            });
            logger.info(`PDF pujat a Google Drive: ${req.file.originalname} (${gFile.id})`);
          } catch (dbErr) {
            logger.error(`Error guardant gdriveFileId per factura ${invoice.id}: ${dbErr.message}`);
          }
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
        invoice.supplierId,
        null,
        pdfAnalysis.invoiceDate
      );
      // Si hi ha duplicat i NO és la mateixa factura, avisar
      if (duplicate && duplicate.id !== invoice.id) {
        // No bloquejar, però retornar avís
        updateData.isDuplicate = true;
        updateData.duplicateOfId = duplicate.id;
      } else if (invoice.isDuplicate) {
        // Si estava marcada com duplicat però amb el número real ja no ho és, desmarcar
        updateData.isDuplicate = false;
        updateData.duplicateOfId = null;
        logger.info(`Auto-desmarcat duplicat: ${invoice.id} (nº real: ${pdfAnalysis.invoiceNumber})`);
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
        .then(async (gFile) => {
          try {
            await prisma.receivedInvoice.update({
              where: { id: req.params.id },
              data: { gdriveFileId: gFile.id },
            });
            logger.info(`PDF adjuntat i pujat a Google Drive: ${req.file.originalname} (${gFile.id})`);
          } catch (dbErr) {
            logger.error(`Error guardant gdriveFileId per factura ${req.params.id}: ${dbErr.message}`);
          }
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
    if (body.irpfRate !== undefined) data.irpfRate = parseFloat(body.irpfRate) || 0;
    if (body.irpfAmount !== undefined) data.irpfAmount = parseFloat(body.irpfAmount) || 0;
    if (body.totalAmount !== undefined) data.totalAmount = parseFloat(body.totalAmount) || 0;

    // Factura compartida SEITO-LOGISTIK
    if (body.isShared !== undefined) data.isShared = Boolean(body.isShared);
    if (body.sharedPercentSeito !== undefined) {
      data.sharedPercentSeito = parseFloat(body.sharedPercentSeito) || 50;
      if (body.sharedPercentLogistik === undefined) {
        data.sharedPercentLogistik = 100 - data.sharedPercentSeito;
      }
    }
    if (body.sharedPercentLogistik !== undefined) {
      data.sharedPercentLogistik = parseFloat(body.sharedPercentLogistik) || 50;
      if (body.sharedPercentSeito === undefined) {
        data.sharedPercentSeito = 100 - data.sharedPercentLogistik;
      }
    }

    // Netejar camps amb valor undefined (no enviar-los a Prisma)
    for (const key of Object.keys(data)) {
      if (data[key] === undefined) delete data[key];
    }

    // Protecció: si la migració IRPF no s'ha executat, no enviar camps desconeguts
    try {
      // Intentar accedir al model per veure si els camps existeixen
      const testFields = await prisma.receivedInvoice.findFirst({
        where: { id: invoiceId },
        select: { irpfRate: true },
      });
    } catch (fieldErr) {
      // Si falla, els camps IRPF no existeixen encara → eliminar-los
      if (fieldErr.message?.includes('irpfRate') || fieldErr.code === 'P2009') {
        delete data.irpfRate;
        delete data.irpfAmount;
        logger.warn('PUT received: camps IRPF no disponibles (cal executar migració)');
      }
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
            // Transacció atòmica per garantir consistència del merge
            const currentFull = await prisma.receivedInvoice.findUnique({
              where: { id: invoiceId },
              select: { gdriveFileId: true, totalAmount: true, issueDate: true, description: true },
            });

            const mergeData = {};
            if (data.totalAmount && data.totalAmount > 0 && (!conflict.totalAmount || parseFloat(conflict.totalAmount) === 0)) {
              mergeData.totalAmount = data.totalAmount;
            }
            if (data.subtotal) mergeData.subtotal = data.subtotal;
            if (data.taxRate !== undefined) mergeData.taxRate = data.taxRate;
            if (data.taxAmount) mergeData.taxAmount = data.taxAmount;
            if (data.issueDate) mergeData.issueDate = data.issueDate;
            if (data.description) mergeData.description = data.description;

            // Operacions de BD atòmiques dins transacció
            await prisma.$transaction(async (tx) => {
              if (Object.keys(mergeData).length > 0) {
                await tx.receivedInvoice.update({
                  where: { id: conflict.id },
                  data: mergeData,
                });
              }
              await tx.receivedInvoice.update({
                where: { id: invoiceId },
                data: { deletedAt: new Date(), description: `Fusionada amb factura ${conflict.invoiceNumber} (${conflict.id})` },
              });
            });

            // Esborrar fitxer de Drive fora de la transacció (operació externa)
            if (currentFull?.gdriveFileId) {
              try {
                await gdrive.deleteFile(currentFull.gdriveFileId);
                logger.info(`Merge: fitxer DUP esborrat de Drive: ${currentFull.gdriveFileId}`);
              } catch (driveErr) {
                logger.warn(`Merge: no s'ha pogut esborrar de Drive ${currentFull.gdriveFileId}: ${driveErr.message}`);
              }
            }

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
    const newStatus = req.body.status;

    // Si es marca com NOT_INVOICE, esborrar del Drive
    if (newStatus === 'NOT_INVOICE') {
      const existing = await prisma.receivedInvoice.findUnique({
        where: { id: req.params.id },
        select: { gdriveFileId: true, invoiceNumber: true },
      });
      if (existing?.gdriveFileId) {
        try {
          await gdrive.deleteFile(existing.gdriveFileId);
          logger.info(`Fitxer esborrat de Drive (marcat com no-factura): ${existing.gdriveFileId} (${existing.invoiceNumber || req.params.id})`);
        } catch (driveErr) {
          logger.warn(`No s'ha pogut esborrar de Drive ${existing.gdriveFileId}: ${driveErr.message}`);
        }
      }
    }

    // NOTA: La còpia a Qonto Dropzone ara es fa automàticament via qontoDropzoneJob
    // quan el moviment bancari es concilia amb la factura (no depèn d'aprovació manual)

    const invoice = await prisma.receivedInvoice.update({
      where: { id: req.params.id },
      data: { status: newStatus },
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

    // Esborrar fitxer de Google Drive si existeix
    const deleteFromDrive = async () => {
      if (invoice.gdriveFileId) {
        try {
          await gdrive.deleteFile(invoice.gdriveFileId);
          logger.info(`Fitxer esborrat de Google Drive: ${invoice.gdriveFileId} (factura ${invoice.invoiceNumber || invoice.id})`);
        } catch (driveErr) {
          // No bloquejar l'eliminació si Drive falla (pot ser que ja no existeixi)
          logger.warn(`No s'ha pogut esborrar de Drive ${invoice.gdriveFileId}: ${driveErr.message}`);
        }
      }
    };

    if (invoice.deletedAt) {
      // Ja a la paperera → eliminació definitiva + esborrar de Drive
      await deleteFromDrive();
      await prisma.receivedInvoice.delete({ where: { id: req.params.id } });
      res.json({ message: 'Factura eliminada definitivament i esborrada de Google Drive' });
    } else {
      // Soft delete → moure a paperera (NO esborrar de Drive per permetre restaurar)
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
// POST /received/:id/unmark-duplicate — Desmarcar com a duplicat (fals positiu)
// =============================================
router.post('/received/:id/unmark-duplicate', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const invoice = await prisma.receivedInvoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, isDuplicate: true, invoiceNumber: true },
    });
    if (!invoice) return res.status(404).json({ error: 'Factura no trobada' });
    if (!invoice.isDuplicate) return res.json({ message: 'Factura ja no estava marcada com a duplicat' });

    await prisma.receivedInvoice.update({
      where: { id: req.params.id },
      data: {
        isDuplicate: false,
        duplicateOfId: null,
      },
    });

    logger.info(`Factura ${invoice.invoiceNumber} (${req.params.id}) desmarcada com a duplicat per ${req.user.email}`);
    res.json({ message: 'Factura desmarcada com a duplicat' });
  } catch (error) {
    next(error);
  }
});

// =============================================
// FACTURES EMESES (a clients)
// =============================================

router.get('/issued', async (req, res, next) => {
  try {
    const { search, status, clientId, conciliated, dateFrom, dateTo, sortBy, sortOrder, page = 1, limit = 25 } = req.query;
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

    // Ordenació dinàmica
    const dir = sortOrder === 'asc' ? 'asc' : 'desc';
    const orderByMap = {
      invoiceNumber: { invoiceNumber: dir },
      client: { client: { name: dir } },
      issueDate: { issueDate: dir },
      dueDate: { dueDate: dir },
      totalAmount: { totalAmount: dir },
      status: { status: dir },
    };
    const orderBy = orderByMap[sortBy] || { issueDate: 'desc' };

    // Include paymentReminders si la taula existeix (pot fallar si migració pendent)
    let includeFields = { client: { select: { id: true, name: true, nif: true } } };
    try {
      await prisma.paymentReminderLog.findFirst({ take: 1 });
      includeFields.paymentReminders = { select: { id: true, sentTo: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 };
    } catch { /* taula no existeix encara */ }

    const [invoices, total] = await Promise.all([
      prisma.issuedInvoice.findMany({ where, skip, take: parseInt(limit), orderBy, include: includeFields }),
      prisma.issuedInvoice.count({ where }),
    ]);

    res.json({ data: invoices, pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) { next(error); }
});

// =============================================
// GET /api/invoices/issued/report — Informe per període personalitzat
// =============================================
router.get('/issued/report', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'Cal indicar from i to (YYYY-MM-DD)' });

    const dateFrom = new Date(from + 'T00:00:00.000Z');
    const dateTo = new Date(to + 'T23:59:59.999Z');

    if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
      return res.status(400).json({ error: 'Format de data invàlid' });
    }

    const where = {
      issueDate: { gte: dateFrom, lte: dateTo },
    };

    const invoices = await prisma.issuedInvoice.findMany({
      where,
      include: { client: { select: { id: true, name: true, nif: true } } },
      orderBy: { issueDate: 'asc' },
    });

    // Totals per estat
    const byStatus = {};
    for (const inv of invoices) {
      if (!byStatus[inv.status]) byStatus[inv.status] = { count: 0, total: 0 };
      byStatus[inv.status].count += 1;
      byStatus[inv.status].total += parseFloat(inv.totalAmount) || 0;
    }

    // Totals per client
    const byClient = {};
    for (const inv of invoices) {
      const clientName = inv.client?.name || 'Sense client';
      const clientId = inv.client?.id || 'unknown';
      if (!byClient[clientId]) byClient[clientId] = { name: clientName, count: 0, total: 0, paid: 0, pending: 0 };
      byClient[clientId].count += 1;
      const amount = parseFloat(inv.totalAmount) || 0;
      byClient[clientId].total += amount;
      if (inv.status === 'PAID') byClient[clientId].paid += amount;
      else byClient[clientId].pending += amount;
    }

    // Totals per mes
    const byMonth = {};
    for (const inv of invoices) {
      const d = new Date(inv.issueDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = { month: key, count: 0, total: 0, paid: 0, pending: 0 };
      const amount = parseFloat(inv.totalAmount) || 0;
      byMonth[key].count += 1;
      byMonth[key].total += amount;
      if (inv.status === 'PAID') byMonth[key].paid += amount;
      else byMonth[key].pending += amount;
    }

    const grandTotal = invoices.reduce((s, inv) => s + (parseFloat(inv.totalAmount) || 0), 0);
    const paidTotal = invoices.filter(i => i.status === 'PAID').reduce((s, inv) => s + (parseFloat(inv.totalAmount) || 0), 0);
    const pendingTotal = grandTotal - paidTotal;

    res.json({
      from,
      to,
      summary: { count: invoices.length, total: grandTotal, paid: paidTotal, pending: pendingTotal },
      byStatus,
      byClient: Object.values(byClient).sort((a, b) => b.total - a.total),
      byMonth: Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)),
      invoices,
    });
  } catch (error) { next(error); }
});

router.get('/issued/:id', async (req, res, next) => {
  try {
    const invoice = await prisma.issuedInvoice.findUnique({ where: { id: req.params.id }, include: { client: true, conciliations: { include: { bankMovement: true } } } });
    if (!invoice) return res.status(404).json({ error: 'Factura no trobada' });
    res.json(invoice);
  } catch (error) { next(error); }
});

// =============================================
// PATCH /api/invoices/issued/bulk-status — Canvi d'estat massiu
// =============================================
router.patch('/issued/bulk-status', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { ids, status } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Cal proporcionar un array d\'ids' });
    }
    if (!['PENDING', 'APPROVED', 'PAID', 'REJECTED', 'PARTIALLY_PAID'].includes(status)) {
      return res.status(400).json({ error: 'Estat no vàlid' });
    }
    if (ids.length > 500) {
      return res.status(400).json({ error: 'Màxim 500 factures per operació' });
    }

    const result = await prisma.issuedInvoice.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });

    res.json({ updated: result.count, status });
  } catch (error) {
    next(error);
  }
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
// GET /api/invoices/issued/:id/payment-reminder — Generar mail recordatori cobrament
// =============================================
router.get('/issued/:id/payment-reminder', async (req, res, next) => {
  try {
    const invoice = await prisma.issuedInvoice.findUnique({
      where: { id: req.params.id },
      include: { client: true },
    });

    if (!invoice) return res.status(404).json({ error: 'Factura no trobada' });

    const daysPending = Math.floor((new Date() - new Date(invoice.issueDate)) / (1000 * 60 * 60 * 24));
    const totalAmount = parseFloat(invoice.totalAmount) || 0;
    const issueDate = new Date(invoice.issueDate).toLocaleDateString('ca-ES');
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('ca-ES') : null;

    const subject = `Recordatori de pagament - Factura ${invoice.invoiceNumber}`;
    const body = [
      `Benvolgut/da,`,
      ``,
      `Ens posem en contacte amb vosaltres per recordar-vos que la factura ${invoice.invoiceNumber} emesa el ${issueDate}${dueDate ? ` amb venciment ${dueDate}` : ''} per un import de ${totalAmount.toFixed(2)} € es troba pendent de pagament des de fa ${daysPending} dies.`,
      ``,
      `Us agrairíem que procedíssiu al pagament al més aviat possible o, si ja s'ha efectuat, ens ho feu saber per poder actualitzar els nostres registres.`,
      ``,
      `Per a qualsevol dubte o aclariment, no dubteu en contactar-nos.`,
      ``,
      `Cordialment,`,
      `${company.legalName}`,
    ].join('\n');

    res.json({
      to: invoice.client?.email || null,
      clientName: invoice.client?.name || 'Desconegut',
      subject,
      body,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount,
      daysPending,
      issueDate,
      dueDate,
    });
  } catch (error) {
    next(error);
  }
});

// =============================================
// POST /api/invoices/issued/:id/send-reminder — Enviar recordatori via Zoho Mail
// =============================================
router.post('/issued/:id/send-reminder', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { to, subject, body } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Cal indicar to, subject i body' });
    }

    const invoice = await prisma.issuedInvoice.findUnique({
      where: { id: req.params.id },
      include: { client: true },
    });
    if (!invoice) return res.status(404).json({ error: 'Factura no trobada' });

    // Intentar enviar via Zoho Mail, amb fallback a mailto:
    let sentViaZoho = false;
    let zohoError = null;
    try {
      const zohoMail = require('../services/zohoMailService');
      await zohoMail.sendEmail({ to, subject, body });
      sentViaZoho = true;
    } catch (err) {
      zohoError = err.message || String(err);
      logger.warn(`Zoho sendEmail fallit (fallback a mailto): ${zohoError}`);
    }

    // Registrar l'enviament/intent a la BD (sempre, tant si Zoho com mailto)
    let log = null;
    try {
      log = await prisma.paymentReminderLog.create({
        data: {
          issuedInvoiceId: req.params.id,
          sentTo: to,
          sentBy: req.user.id,
          subject,
          notes: sentViaZoho ? 'Enviat via Zoho Mail API' : `Obert via mailto (Zoho error: ${zohoError})`,
        },
        include: { user: { select: { name: true } } },
      });
    } catch (logErr) {
      logger.warn(`No s'ha pogut registrar el reminder log (taula pendent?): ${logErr.message}`);
    }

    if (sentViaZoho) {
      logger.info(`Recordatori pagament enviat via Zoho: factura ${invoice.invoiceNumber} → ${to} (per ${req.user.name})`);
      res.json({
        success: true,
        method: 'zoho',
        message: `Recordatori enviat a ${to}`,
        log,
      });
    } else {
      // Fallback: retornar mailto URL perquè el frontend l'obri
      const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      logger.info(`Recordatori pagament via mailto (fallback): factura ${invoice.invoiceNumber} → ${to} (per ${req.user.name})`);
      res.json({
        success: true,
        method: 'mailto',
        fallback: 'mailto',
        mailtoUrl,
        message: `No s'ha pogut enviar via Zoho (${zohoError}). S'obre el client de correu.`,
        log,
      });
    }
  } catch (error) {
    logger.error(`Error enviant recordatori: ${error.message}`);
    res.status(500).json({ error: `Error enviant el correu: ${error.message}` });
  }
});

// =============================================
// POST /api/invoices/issued/:id/payment-reminder-log — Registrar enviament recordatori
// =============================================
router.post('/issued/:id/payment-reminder-log', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { sentTo, subject, notes } = req.body;
    if (!sentTo) return res.status(400).json({ error: 'Cal indicar el destinatari (sentTo)' });

    const invoice = await prisma.issuedInvoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ error: 'Factura no trobada' });

    const log = await prisma.paymentReminderLog.create({
      data: {
        issuedInvoiceId: req.params.id,
        sentTo,
        sentBy: req.user.id,
        subject: subject || null,
        notes: notes || null,
      },
      include: { user: { select: { name: true } } },
    });

    res.status(201).json(log);
  } catch (error) { next(error); }
});

// =============================================
// GET /api/invoices/issued/:id/payment-reminder-logs — Historial de recordatoris
// =============================================
router.get('/issued/:id/payment-reminder-logs', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const logs = await prisma.paymentReminderLog.findMany({
      where: { issuedInvoiceId: req.params.id },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(logs);
  } catch (error) { next(error); }
});

// =============================================
// AUDITORIA GOOGLE DRIVE — Carpetes correctes
// =============================================

/**
 * GET /api/invoices/gdrive-audit
 * Llista totes les factures rebudes amb gdriveFileId i comprova
 * si estan a la carpeta correcta (any/trimestre/mes segons issueDate).
 * Mode dry-run: no mou res, només informa.
 */
router.get('/gdrive-audit', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    // 1. Obtenir totes les factures amb fitxer a Drive
    const invoices = await prisma.receivedInvoice.findMany({
      where: { gdriveFileId: { not: null }, deletedAt: null },
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        gdriveFileId: true,
        supplier: { select: { id: true, name: true } },
        totalAmount: true,
      },
      orderBy: { issueDate: 'asc' },
    });

    if (invoices.length === 0) {
      return res.json({ total: 0, correct: 0, misplaced: 0, errors: 0, details: [], errorDetails: [] });
    }

    const drive = gdrive.getDriveClient();
    const results = { correct: [], misplaced: [], errors: [] };

    // Cache de carpetes esperades per mes (clau: "YYYY-MM" → folderId)
    const expectedFolderCache = {};
    // Cache de noms de carpetes (clau: folderId → path string)
    const folderNameCache = {};

    async function getExpectedFolderId(issueDate) {
      const d = new Date(issueDate);
      const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
      if (!expectedFolderCache[key]) {
        expectedFolderCache[key] = await gdrive.getDateBasedFolderId('factures-rebudes', d);
      }
      return expectedFolderCache[key];
    }

    function getExpectedPath(issueDate) {
      const d = new Date(issueDate);
      const month = d.getMonth() + 1;
      const quarter = Math.ceil(month / 3);
      return `factures-rebudes/${d.getFullYear()}/T${quarter}/${month.toString().padStart(2, '0')}`;
    }

    async function getFolderPath(folderId) {
      if (!folderId) return 'desconeguda';
      if (folderNameCache[folderId]) return folderNameCache[folderId];
      try {
        const parentInfo = await drive.files.get({ fileId: folderId, fields: 'name, parents', supportsAllDrives: true });
        let pathParts = [parentInfo.data.name];
        let pid = parentInfo.data.parents ? parentInfo.data.parents[0] : null;
        for (let i = 0; i < 3 && pid; i++) {
          if (folderNameCache[pid]) { pathParts.unshift(folderNameCache[pid]); break; }
          const p = await drive.files.get({ fileId: pid, fields: 'name, parents', supportsAllDrives: true });
          pathParts.unshift(p.data.name);
          pid = p.data.parents ? p.data.parents[0] : null;
        }
        folderNameCache[folderId] = pathParts.join('/');
        return folderNameCache[folderId];
      } catch (e) {
        return `folder:${folderId}`;
      }
    }

    // 2. Pre-calcular totes les carpetes esperades (amb cache, seran poques crides)
    const uniqueMonths = [...new Set(invoices.map(inv => {
      const d = new Date(inv.issueDate);
      return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    }))];
    for (const key of uniqueMonths) {
      const [y, m] = key.split('-');
      expectedFolderCache[key] = await gdrive.getDateBasedFolderId('factures-rebudes', new Date(parseInt(y), parseInt(m) - 1, 15));
    }

    // 3. Processar en lots de 15 en paral·lel
    const BATCH_SIZE = 15;
    for (let i = 0; i < invoices.length; i += BATCH_SIZE) {
      const batch = invoices.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(batch.map(async (inv) => {
        const fileInfo = await drive.files.get({
          fileId: inv.gdriveFileId,
          fields: 'id, name, parents',
          supportsAllDrives: true,
        });

        const currentParentId = fileInfo.data.parents ? fileInfo.data.parents[0] : null;
        const expectedFolderId = await getExpectedFolderId(inv.issueDate);
        const expectedPath = getExpectedPath(inv.issueDate);

        if (currentParentId === expectedFolderId) {
          return { type: 'correct', data: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, supplier: inv.supplier?.name, issueDate: inv.issueDate, fileName: fileInfo.data.name, expectedPath } };
        } else {
          const currentPath = await getFolderPath(currentParentId);
          return { type: 'misplaced', data: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, supplier: inv.supplier?.name, issueDate: inv.issueDate, totalAmount: inv.totalAmount, fileName: fileInfo.data.name, gdriveFileId: inv.gdriveFileId, currentPath, currentFolderId: currentParentId, expectedPath, expectedFolderId } };
        }
      }));

      for (let j = 0; j < batchResults.length; j++) {
        const r = batchResults[j];
        if (r.status === 'fulfilled') {
          results[r.value.type].push(r.value.data);
        } else {
          results.errors.push({ invoiceId: batch[j].id, invoiceNumber: batch[j].invoiceNumber, gdriveFileId: batch[j].gdriveFileId, error: r.reason?.message || 'Error desconegut' });
        }
      }
    }

    logger.info(`Auditoria Drive: ${results.correct.length} correctes, ${results.misplaced.length} mal col·locades, ${results.errors.length} errors`);

    res.json({
      total: invoices.length,
      correct: results.correct.length,
      misplaced: results.misplaced.length,
      errors: results.errors.length,
      details: results.misplaced,
      errorDetails: results.errors,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/invoices/gdrive-audit/fix
 * Mou les factures mal col·locades a la carpeta correcta.
 * Body opcional: { invoiceIds: [...] } per moure només les seleccionades.
 * Si no es passa invoiceIds, mou totes les mal col·locades.
 */
router.post('/gdrive-audit/fix', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { invoiceIds } = req.body || {};

    // 1. Obtenir factures a processar
    const where = { gdriveFileId: { not: null }, isDeleted: false };
    if (invoiceIds && invoiceIds.length > 0) {
      where.id = { in: invoiceIds };
    }

    const invoices = await prisma.receivedInvoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        gdriveFileId: true,
        supplier: { select: { name: true } },
      },
    });

    const drive = gdrive.getDriveClient();
    const moved = [];
    const skipped = [];
    const errors = [];

    for (const inv of invoices) {
      try {
        const fileInfo = await drive.files.get({
          fileId: inv.gdriveFileId,
          fields: 'id, name, parents',
          supportsAllDrives: true,
        });

        const currentParentId = fileInfo.data.parents ? fileInfo.data.parents[0] : null;
        const issueDate = new Date(inv.issueDate);
        const expectedFolderId = await gdrive.getDateBasedFolderId('factures-rebudes', issueDate);

        if (currentParentId === expectedFolderId) {
          skipped.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, reason: 'ja correcte' });
          continue;
        }

        // Moure el fitxer
        await gdrive.moveFile(inv.gdriveFileId, expectedFolderId, currentParentId);

        const month = issueDate.getMonth() + 1;
        const quarter = Math.ceil(month / 3);
        const newPath = `factures-rebudes/${issueDate.getFullYear()}/T${quarter}/${month.toString().padStart(2, '0')}`;

        moved.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          supplier: inv.supplier?.name,
          fileName: fileInfo.data.name,
          movedTo: newPath,
        });

        logger.info(`Drive audit fix: ${inv.invoiceNumber} mogut a ${newPath}`);
      } catch (err) {
        errors.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          error: err.message,
        });
        logger.error(`Drive audit fix error: ${inv.invoiceNumber} — ${err.message}`);
      }
    }

    res.json({
      processed: invoices.length,
      moved: moved.length,
      skipped: skipped.length,
      errors: errors.length,
      movedDetails: moved,
      errorDetails: errors,
    });
  } catch (error) {
    next(error);
  }
});

// =============================================
// AUDITORIA DATES BD vs PDF — Verificar issueDate
// =============================================

/**
 * GET /api/invoices/date-audit
 * Per cada factura amb gdriveFileId, descarrega el PDF,
 * n'extreu la data real d'emissió i la compara amb la BD.
 * Retorna les discrepàncies.
 */
router.get('/date-audit', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    // Filtre: ?filter=non-ai (només les NO processades amb Claude IA)
    //         ?filter=all (totes)  — per defecte: non-ai
    const filter = req.query.filter || 'non-ai';
    const where = { gdriveFileId: { not: null }, deletedAt: null };
    if (filter === 'non-ai') {
      where.classifiedBy = null; // Només les que NO es van extreure amb IA
    }

    const invoices = await prisma.receivedInvoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        gdriveFileId: true,
        supplier: { select: { name: true } },
        totalAmount: true,
        classifiedBy: true,
      },
      orderBy: { issueDate: 'asc' },
    });

    if (invoices.length === 0) {
      return res.json({ total: 0, correct: 0, mismatched: 0, errors: 0, details: [], errorDetails: [] });
    }

    logger.info(`Date audit: processant ${invoices.length} factures (filtre: ${filter})`);

    const results = { correct: [], mismatched: [], errors: [] };
    const tmpDir = require('os').tmpdir();
    const BATCH_SIZE = 10;

    for (let i = 0; i < invoices.length; i += BATCH_SIZE) {
      const batch = invoices.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(batch.map(async (inv) => {
        // 1. Descarregar PDF del Drive a fitxer temporal
        const tmpPath = require('path').join(tmpDir, `audit_${inv.id}.pdf`);
        try {
          await gdrive.downloadFile(inv.gdriveFileId, tmpPath);
        } catch (dlErr) {
          throw new Error(`No es pot descarregar: ${dlErr.message}`);
        }

        // 2. Extreure text del PDF
        let text = '';
        try {
          text = await pdfExtract.extractText(tmpPath);
        } catch (e) {
          // Intentar OCR
          try { text = await pdfExtract.ocrPdf(tmpPath); } catch (e2) { /* ignorar */ }
        }

        // Netejar fitxer temporal
        try { require('fs').unlinkSync(tmpPath); } catch (e) { /* ignorar */ }

        if (!text || text.trim().length < 10) {
          throw new Error('No s\'ha pogut extreure text del PDF');
        }

        // 3. Detectar data real del PDF
        const detectedDate = pdfExtract.detectInvoiceDate(text);
        if (!detectedDate) {
          throw new Error('No s\'ha pogut detectar la data al PDF');
        }

        // 4. Comparar amb la BD
        const dbDate = new Date(inv.issueDate);
        const dbDateStr = dbDate.toISOString().split('T')[0];
        const pdfDateStr = detectedDate.toISOString().split('T')[0];

        if (dbDateStr === pdfDateStr) {
          return { type: 'correct', invoiceId: inv.id };
        } else {
          return {
            type: 'mismatched',
            data: {
              invoiceId: inv.id,
              invoiceNumber: inv.invoiceNumber,
              supplier: inv.supplier?.name,
              totalAmount: inv.totalAmount,
              dbDate: dbDateStr,
              pdfDate: pdfDateStr,
              gdriveFileId: inv.gdriveFileId,
            },
          };
        }
      }));

      for (let j = 0; j < batchResults.length; j++) {
        const r = batchResults[j];
        if (r.status === 'fulfilled') {
          if (r.value.type === 'correct') results.correct.push(r.value.invoiceId);
          else results.mismatched.push(r.value.data);
        } else {
          results.errors.push({
            invoiceId: batch[j].id,
            invoiceNumber: batch[j].invoiceNumber,
            error: r.reason?.message || 'Error desconegut',
          });
        }
      }

      logger.info(`Date audit: lot ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(invoices.length / BATCH_SIZE)} processat`);
    }

    logger.info(`Date audit: ${results.correct.length} correctes, ${results.mismatched.length} discrepàncies, ${results.errors.length} errors`);

    res.json({
      total: invoices.length,
      correct: results.correct.length,
      mismatched: results.mismatched.length,
      errors: results.errors.length,
      details: results.mismatched,
      errorDetails: results.errors,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/invoices/date-audit/fix
 * Corregeix les dates a la BD amb les dates detectades dels PDFs.
 * Body: { fixes: [{ invoiceId, newDate }] }
 */
router.post('/date-audit/fix', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { fixes } = req.body;
    if (!fixes || !Array.isArray(fixes) || fixes.length === 0) {
      return res.status(400).json({ error: 'Cal proporcionar un array de fixes: [{ invoiceId, newDate }]' });
    }

    const updated = [];
    const errors = [];

    for (const fix of fixes) {
      try {
        const newDate = new Date(fix.newDate + 'T12:00:00Z');
        if (isNaN(newDate.getTime())) throw new Error('Data invàlida');

        await prisma.receivedInvoice.update({
          where: { id: fix.invoiceId },
          data: { issueDate: newDate },
        });

        updated.push({ invoiceId: fix.invoiceId, newDate: fix.newDate });
      } catch (err) {
        errors.push({ invoiceId: fix.invoiceId, error: err.message });
      }
    }

    res.json({ updated: updated.length, errors: errors.length, updatedDetails: updated, errorDetails: errors });
  } catch (error) {
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
