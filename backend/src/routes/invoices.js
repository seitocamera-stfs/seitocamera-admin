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
    const { search, status, source, supplierId, conciliated, dateFrom, dateTo, page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

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
      where.conciliations = { some: { status: 'CONFIRMED' } };
    } else if (conciliated === 'false') {
      where.conciliations = { none: {} };
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

    // Enriquir cada factura amb l'estat de conciliació
    const enriched = invoices.map((inv) => {
      const confirmed = inv.conciliations.find((c) => c.status === 'CONFIRMED');
      const autoMatched = inv.conciliations.find((c) => c.status === 'AUTO_MATCHED');
      return {
        ...inv,
        conciliation: confirmed
          ? { status: 'CONFIRMED', bankMovement: confirmed.bankMovement }
          : autoMatched
            ? { status: 'PENDING_CONFIRM', bankMovement: autoMatched.bankMovement, confidence: autoMatched.confidence }
            : { status: 'NOT_MATCHED' },
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
          { fileId: invoice.gdriveFileId, alt: 'media' },
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
        const taxRate = 21;
        updateData.totalAmount = Math.round(pdfAnalysis.totalAmount * 100) / 100;
        updateData.subtotal = Math.round((pdfAnalysis.totalAmount / (1 + taxRate / 100)) * 100) / 100;
        updateData.taxAmount = Math.round((updateData.totalAmount - updateData.subtotal) * 100) / 100;
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
    const data = { ...req.body };
    if (data.issueDate) data.issueDate = new Date(data.issueDate);
    if (data.dueDate) data.dueDate = new Date(data.dueDate);
    if (typeof data.subtotal === 'string') data.subtotal = parseFloat(data.subtotal);
    if (typeof data.taxRate === 'string') data.taxRate = parseFloat(data.taxRate);
    if (typeof data.taxAmount === 'string') data.taxAmount = parseFloat(data.taxAmount);
    if (typeof data.totalAmount === 'string') data.totalAmount = parseFloat(data.totalAmount);

    const invoice = await prisma.receivedInvoice.update({
      where: { id: req.params.id },
      data,
      include: { supplier: { select: { id: true, name: true } } },
    });

    res.json(invoice);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Factura no trobada' });
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

router.delete('/received/:id', requireLevel('receivedInvoices', 'admin'), async (req, res, next) => {
  try {
    await prisma.receivedInvoice.delete({ where: { id: req.params.id } });
    res.json({ message: 'Factura eliminada' });
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
    const { search, status, clientId, dateFrom, dateTo, page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};
    if (status) where.status = status;
    if (clientId) where.clientId = clientId;
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
