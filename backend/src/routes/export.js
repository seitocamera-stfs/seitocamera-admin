const express = require('express');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const exportService = require('../services/exportService');
const { logger } = require('../config/logger');
const company = require('../config/company');

const router = express.Router();

router.use(authenticate);

// ===========================================
// EXPORTACIÓ FACTURES REBUDES
// ===========================================

router.get('/received-invoices/:format', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { format } = req.params;
    if (!['csv', 'xlsx', 'pdf'].includes(format)) {
      return res.status(400).json({ error: 'Format no vàlid. Usa: csv, xlsx, pdf' });
    }

    const { search, status, source, supplierId, conciliated, dateFrom, dateTo, ids } = req.query;

    // Si s'han passat IDs concrets, prioritzar-los (selecció manual) i ignorar filtres
    const where = { deletedAt: null };
    if (ids) {
      const idList = String(ids).split(',').map((s) => s.trim()).filter(Boolean);
      if (idList.length === 0) {
        return res.status(400).json({ error: 'Cap ID vàlid' });
      }
      where.id = { in: idList };
    } else {
      // Construir where amb els filtres (mateixos que el llistat)
      if (status) where.status = status;
      if (source) where.source = source;
      if (supplierId) where.supplierId = supplierId;
      if (dateFrom || dateTo) {
        where.issueDate = {};
        if (dateFrom) where.issueDate.gte = new Date(dateFrom);
        if (dateTo) where.issueDate.lte = new Date(dateTo);
      }
      if (conciliated === 'true') {
        where.conciliations = { some: { status: 'CONFIRMED' } };
      } else if (conciliated === 'false') {
        where.conciliations = { none: {} };
      }
      if (search) {
        where.OR = [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { supplier: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }
    }

    const invoices = await prisma.receivedInvoice.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true, nif: true } },
        conciliations: { select: { status: true } },
      },
      orderBy: { issueDate: 'desc' },
    });

    const rows = invoices.map(exportService.transformReceivedInvoice);
    const columns = exportService.COLUMN_DEFS.receivedInvoices;
    const title = `Factures Rebudes — ${company.name}`;

    const filterParts = [];
    if (ids) {
      const count = String(ids).split(',').filter(Boolean).length;
      filterParts.push(`Selecció manual: ${count} factures`);
    } else {
      if (dateFrom) filterParts.push(`Des de: ${dateFrom}`);
      if (dateTo) filterParts.push(`Fins: ${dateTo}`);
      if (status) filterParts.push(`Estat: ${status}`);
      if (source) filterParts.push(`Font: ${source}`);
    }
    const filterDescription = filterParts.join(' | ') || 'Sense filtres';

    await sendExport(res, format, rows, columns, title, 'factures-rebudes', { filterDescription });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// EXPORTACIÓ FACTURES EMESES
// ===========================================

router.get('/issued-invoices/:format', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { format } = req.params;
    if (!['csv', 'xlsx', 'pdf'].includes(format)) {
      return res.status(400).json({ error: 'Format no vàlid. Usa: csv, xlsx, pdf' });
    }

    const { search, status, clientId, dateFrom, dateTo, ids } = req.query;

    const where = {};
    if (ids) {
      const idList = String(ids).split(',').map((s) => s.trim()).filter(Boolean);
      if (idList.length === 0) {
        return res.status(400).json({ error: 'Cap ID vàlid' });
      }
      where.id = { in: idList };
    } else {
      if (status) where.status = status;
      if (clientId) where.clientId = clientId;
      if (dateFrom || dateTo) {
        where.issueDate = {};
        if (dateFrom) where.issueDate.gte = new Date(dateFrom);
        if (dateTo) where.issueDate.lte = new Date(dateTo);
      }
      if (search) {
        where.OR = [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { client: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }
    }

    const invoices = await prisma.issuedInvoice.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, nif: true } },
      },
      orderBy: { issueDate: 'desc' },
    });

    const rows = invoices.map(exportService.transformIssuedInvoice);
    const columns = exportService.COLUMN_DEFS.issuedInvoices;
    const title = `Factures Emeses — ${company.name}`;

    const filterParts = [];
    if (ids) {
      const count = String(ids).split(',').filter(Boolean).length;
      filterParts.push(`Selecció manual: ${count} factures`);
    } else {
      if (dateFrom) filterParts.push(`Des de: ${dateFrom}`);
      if (dateTo) filterParts.push(`Fins: ${dateTo}`);
      if (status) filterParts.push(`Estat: ${status}`);
    }
    const filterDescription = filterParts.join(' | ') || 'Sense filtres';

    await sendExport(res, format, rows, columns, title, 'factures-emeses', { filterDescription });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// EXPORTACIÓ MOVIMENTS BANCARIS
// ===========================================

router.get('/bank-movements/:format', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { format } = req.params;
    if (!['csv', 'xlsx', 'pdf'].includes(format)) {
      return res.status(400).json({ error: 'Format no vàlid. Usa: csv, xlsx, pdf' });
    }

    const { search, type, conciliated, dateFrom, dateTo } = req.query;

    const where = {};
    if (type) where.type = type;
    if (conciliated !== undefined) where.isConciliated = conciliated === 'true';
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
    }

    const movements = await prisma.bankMovement.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    const rows = movements.map(exportService.transformBankMovement);
    const columns = exportService.COLUMN_DEFS.bankMovements;
    const title = `Moviments Bancaris — ${company.name}`;

    const filterParts = [];
    if (dateFrom) filterParts.push(`Des de: ${dateFrom}`);
    if (dateTo) filterParts.push(`Fins: ${dateTo}`);
    if (type) filterParts.push(`Tipus: ${type}`);
    const filterDescription = filterParts.join(' | ') || 'Sense filtres';

    await sendExport(res, format, rows, columns, title, 'moviments-bancaris', { filterDescription });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// EXPORTACIÓ CONCILIACIONS
// ===========================================

router.get('/conciliations/:format', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { format } = req.params;
    if (!['csv', 'xlsx', 'pdf'].includes(format)) {
      return res.status(400).json({ error: 'Format no vàlid. Usa: csv, xlsx, pdf' });
    }

    const { status } = req.query;

    const where = {};
    if (status) where.status = status;

    const conciliations = await prisma.conciliation.findMany({
      where,
      include: {
        bankMovement: { select: { id: true, date: true, description: true, amount: true, type: true } },
        receivedInvoice: {
          select: { id: true, invoiceNumber: true, totalAmount: true, supplier: { select: { name: true } } },
        },
        issuedInvoice: {
          select: { id: true, invoiceNumber: true, totalAmount: true, client: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows = conciliations.map(exportService.transformConciliation);
    const columns = exportService.COLUMN_DEFS.conciliations;
    const title = `Conciliacions — ${company.name}`;

    const filterParts = [];
    if (status) filterParts.push(`Estat: ${status}`);
    const filterDescription = filterParts.join(' | ') || 'Sense filtres';

    await sendExport(res, format, rows, columns, title, 'conciliacions', { filterDescription });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// HELPER: Enviar resposta en el format correcte
// ===========================================

async function sendExport(res, format, rows, columns, title, filenameBase, options = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${filenameBase}_${date}`;

  switch (format) {
    case 'csv': {
      const csv = exportService.generateCsv(rows, columns);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(csv);
    }

    case 'xlsx': {
      const buffer = await exportService.generateExcel(rows, columns, title);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }

    case 'pdf': {
      const buffer = await exportService.generatePdf(rows, columns, title, options);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      return res.send(buffer);
    }

    default:
      return res.status(400).json({ error: 'Format no vàlid' });
  }
}

module.exports = router;
