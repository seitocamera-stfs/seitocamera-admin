const express = require('express');
const PDFDocument = require('pdfkit');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

// ===========================================
// GET /api/shared-invoices — Factures compartides agrupades per mes/trimestre
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const { year, groupBy = 'month' } = req.query;
    const targetYear = parseInt(year) || new Date().getFullYear();

    const invoices = await prisma.receivedInvoice.findMany({
      where: {
        isShared: true,
        deletedAt: null,
        issueDate: {
          gte: new Date(`${targetYear}-01-01`),
          lt: new Date(`${targetYear + 1}-01-01`),
        },
      },
      orderBy: { issueDate: 'asc' },
      include: {
        supplier: { select: { id: true, name: true } },
      },
    });

    // Agrupar per mes o trimestre
    const groups = {};
    for (const inv of invoices) {
      const date = new Date(inv.issueDate);
      const month = date.getMonth() + 1; // 1-12
      let key, label;

      if (groupBy === 'quarter') {
        const q = Math.ceil(month / 3);
        key = `Q${q}`;
        label = `T${q} ${targetYear}`;
      } else {
        key = String(month).padStart(2, '0');
        const monthNames = ['Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny', 'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre'];
        label = `${monthNames[month - 1]} ${targetYear}`;
      }

      if (!groups[key]) {
        groups[key] = {
          key,
          label,
          invoices: [],
          totalAmount: 0,
          totalSeito: 0,
          totalLogistik: 0,
        };
      }

      const total = parseFloat(inv.totalAmount);
      const pSeito = parseFloat(inv.sharedPercentSeito) / 100;
      const pLogistik = parseFloat(inv.sharedPercentLogistik) / 100;

      groups[key].invoices.push({
        ...inv,
        paidBy: inv.paidBy || 'NONE',
        amountSeito: +(total * pSeito).toFixed(2),
        amountLogistik: +(total * pLogistik).toFixed(2),
      });
      groups[key].totalAmount += total;
      groups[key].totalSeito += +(total * pSeito).toFixed(2);
      groups[key].totalLogistik += +(total * pLogistik).toFixed(2);
    }

    // Arrodonir totals
    for (const g of Object.values(groups)) {
      g.totalAmount = +g.totalAmount.toFixed(2);
      g.totalSeito = +g.totalSeito.toFixed(2);
      g.totalLogistik = +g.totalLogistik.toFixed(2);
    }

    // Totals anuals
    const yearTotal = Object.values(groups).reduce((acc, g) => ({
      totalAmount: acc.totalAmount + g.totalAmount,
      totalSeito: acc.totalSeito + g.totalSeito,
      totalLogistik: acc.totalLogistik + g.totalLogistik,
      count: acc.count + g.invoices.length,
    }), { totalAmount: 0, totalSeito: 0, totalLogistik: 0, count: 0 });

    res.json({
      year: targetYear,
      groupBy,
      groups: Object.values(groups).sort((a, b) => a.key.localeCompare(b.key)),
      totals: {
        totalAmount: +yearTotal.totalAmount.toFixed(2),
        totalSeito: +yearTotal.totalSeito.toFixed(2),
        totalLogistik: +yearTotal.totalLogistik.toFixed(2),
        count: yearTotal.count,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// PATCH /api/shared-invoices/:id — Actualitzar percentatges d'una factura
// ===========================================
router.patch('/:id', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    // Comprovar si el període està bloquejat
    try {
      const existing = await prisma.receivedInvoice.findUnique({
        where: { id: req.params.id },
        select: { issueDate: true },
      });
      if (existing?.issueDate) {
        const d = new Date(existing.issueDate);
        const m = d.getMonth() + 1;
        const monthKey = String(m).padStart(2, '0');
        const quarterKey = `Q${Math.ceil(m / 3)}`;
        const yr = d.getFullYear();
        const locks = await prisma.sharedPeriodLock.findMany({
          where: {
            year: yr,
            locked: true,
            OR: [
              { period: monthKey, periodType: 'month' },
              { period: quarterKey, periodType: 'quarter' },
            ],
          },
        });
        if (locks.length > 0) {
          return res.status(403).json({ error: 'Període tancat. No es poden editar factures d\'un període bloquejat.' });
        }
      }
    } catch (lockErr) {
      // Si la taula encara no existeix (migració pendent), no bloquejar
    }

    const { sharedPercentSeito, sharedPercentLogistik, isShared } = req.body;
    const data = {};

    if (isShared !== undefined) data.isShared = Boolean(isShared);
    if (sharedPercentSeito !== undefined) {
      data.sharedPercentSeito = parseFloat(sharedPercentSeito);
      // Auto-calcular l'altre si no s'ha passat
      if (sharedPercentLogistik === undefined) {
        data.sharedPercentLogistik = 100 - data.sharedPercentSeito;
      }
    }
    if (sharedPercentLogistik !== undefined) {
      data.sharedPercentLogistik = parseFloat(sharedPercentLogistik);
      if (sharedPercentSeito === undefined) {
        data.sharedPercentSeito = 100 - data.sharedPercentLogistik;
      }
    }
    if (req.body.paidBy !== undefined) {
      const validPaidBy = ['NONE', 'SEITO', 'LOGISTIK'];
      if (validPaidBy.includes(req.body.paidBy)) {
        data.paidBy = req.body.paidBy;
      }
    }

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

// ===========================================
// POST /api/shared-invoices/extract-pdf — Generar extracte PDF de factures seleccionades
// ===========================================
router.post('/extract-pdf', async (req, res, next) => {
  try {
    const { invoiceIds, year, title } = req.body;

    if (!invoiceIds?.length) {
      return res.status(400).json({ error: 'Cal seleccionar almenys una factura' });
    }

    const invoices = await prisma.receivedInvoice.findMany({
      where: { id: { in: invoiceIds }, isShared: true, deletedAt: null },
      orderBy: { issueDate: 'asc' },
      include: { supplier: { select: { name: true } } },
    });

    if (!invoices.length) {
      return res.status(404).json({ error: 'Cap factura trobada' });
    }

    // Calcular imports
    const rows = invoices.map((inv) => {
      const total = parseFloat(inv.totalAmount);
      const pSeito = parseFloat(inv.sharedPercentSeito) / 100;
      const pLogistik = parseFloat(inv.sharedPercentLogistik) / 100;
      return {
        invoiceNumber: inv.invoiceNumber || '—',
        supplier: inv.supplier?.name || '—',
        issueDate: inv.issueDate,
        total,
        percentSeito: parseFloat(inv.sharedPercentSeito),
        percentLogistik: parseFloat(inv.sharedPercentLogistik),
        amountSeito: +(total * pSeito).toFixed(2),
        amountLogistik: +(total * pLogistik).toFixed(2),
        paidBy: inv.paidBy === 'SEITO' ? 'Seito' : inv.paidBy === 'LOGISTIK' ? 'Logistik' : 'Pendent',
      };
    });

    const totals = rows.reduce((acc, r) => ({
      total: acc.total + r.total,
      seito: acc.seito + r.amountSeito,
      logistik: acc.logistik + r.amountLogistik,
    }), { total: 0, seito: 0, logistik: 0 });

    // Generar PDF
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 40, bottom: 40, left: 30, right: 30 },
      info: { Title: title || 'Extracte factures compartides', Author: 'SeitoCamera Admin' },
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="extracte-compartides-${year || 'seleccio'}.pdf"`);
      res.send(buffer);
    });

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left;

    // Títol
    doc.fontSize(16).font('Helvetica-Bold').text(title || 'Extracte factures compartides', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor('#666666').text(
      `SEITO CAMERA · LA LOGISTIK FILM SERVICES — ${rows.length} factures — Generat: ${new Date().toLocaleDateString('ca-ES')}`,
      { align: 'center' }
    );
    doc.moveDown(0.8);
    doc.fillColor('#000000');

    // Columnes
    const columns = [
      { label: 'Factura', width: 1.3 },
      { label: 'Proveïdor', width: 2.2 },
      { label: 'Data', width: 1 },
      { label: 'Total', width: 1.2, align: 'right' },
      { label: '%', width: 0.7, align: 'center' },
      { label: 'Seito', width: 1.2, align: 'right' },
      { label: 'Logistik', width: 1.2, align: 'right' },
      { label: 'Pagat per', width: 1, align: 'center' },
    ];
    const totalWeight = columns.reduce((s, c) => s + c.width, 0);
    const colWidths = columns.map((c) => (c.width / totalWeight) * pageWidth);

    const rowHeight = 18;
    const headerHeight = 22;
    let y = doc.y;

    function fmtDate(d) {
      if (!d) return '';
      const dt = new Date(d);
      return `${dt.getDate().toString().padStart(2, '0')}/${(dt.getMonth() + 1).toString().padStart(2, '0')}/${dt.getFullYear()}`;
    }
    function fmtCurrency(n) {
      return parseFloat(n).toLocaleString('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    }

    function drawHeader() {
      doc.rect(startX, y, pageWidth, headerHeight).fill('#1F2937');
      let x = startX;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF');
      for (let i = 0; i < columns.length; i++) {
        doc.text(columns[i].label, x + 3, y + 6, { width: colWidths[i] - 6, height: headerHeight, ellipsis: true });
        x += colWidths[i];
      }
      y += headerHeight;
      doc.fillColor('#000000');
    }

    drawHeader();

    doc.font('Helvetica').fontSize(7);
    for (let r = 0; r < rows.length; r++) {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
        doc.font('Helvetica').fontSize(7);
      }

      if (r % 2 === 0) {
        doc.rect(startX, y, pageWidth, rowHeight).fill('#F9FAFB');
        doc.fillColor('#000000');
      }

      const row = rows[r];
      const vals = [
        row.invoiceNumber,
        row.supplier,
        fmtDate(row.issueDate),
        fmtCurrency(row.total),
        `${row.percentSeito}/${row.percentLogistik}`,
        fmtCurrency(row.amountSeito),
        fmtCurrency(row.amountLogistik),
        row.paidBy,
      ];

      let x = startX;
      for (let i = 0; i < vals.length; i++) {
        doc.text(String(vals[i]), x + 3, y + 5, { width: colWidths[i] - 6, height: rowHeight, ellipsis: true });
        x += colWidths[i];
      }

      doc.moveTo(startX, y + rowHeight).lineTo(startX + pageWidth, y + rowHeight).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
      y += rowHeight;
    }

    // Fila totals
    y += 5;
    if (y + 25 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    doc.rect(startX, y, pageWidth, 22).fill('#F3F4F6');
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8);

    let x = startX;
    const totalVals = [
      'TOTALS', '', `${rows.length} fact.`,
      fmtCurrency(totals.total), '',
      fmtCurrency(totals.seito), fmtCurrency(totals.logistik), '',
    ];
    for (let i = 0; i < totalVals.length; i++) {
      if (totalVals[i]) {
        doc.text(totalVals[i], x + 3, y + 6, { width: colWidths[i] - 6 });
      }
      x += colWidths[i];
    }

    // Resum balanç Seito vs Logistik
    y += 30;
    if (y + 60 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    doc.fontSize(10).font('Helvetica-Bold').text('Resum de balanç', startX, y);
    y += 18;
    doc.fontSize(9).font('Helvetica');

    const seitoPaid = rows.filter((r) => r.paidBy === 'Seito').reduce((s, r) => s + r.total, 0);
    const logistikPaid = rows.filter((r) => r.paidBy === 'Logistik').reduce((s, r) => s + r.total, 0);
    const pendingPaid = rows.filter((r) => r.paidBy === 'Pendent').reduce((s, r) => s + r.total, 0);

    doc.text(`Part Seito: ${fmtCurrency(totals.seito)}  |  Part Logistik: ${fmtCurrency(totals.logistik)}`, startX, y);
    y += 15;
    doc.text(`Pagat per Seito: ${fmtCurrency(seitoPaid)}  |  Pagat per Logistik: ${fmtCurrency(logistikPaid)}  |  Pendent: ${fmtCurrency(pendingPaid)}`, startX, y);
    y += 15;

    // Calcular qui deu a qui
    const seitoShouldPay = totals.seito;
    const logistikShouldPay = totals.logistik;
    const seitoActuallyPaid = seitoPaid;
    const logistikActuallyPaid = logistikPaid;
    const seitoBalance = seitoActuallyPaid - seitoShouldPay; // positiu = ha pagat de més
    const logistikBalance = logistikActuallyPaid - logistikShouldPay;

    doc.font('Helvetica-Bold');
    if (Math.abs(seitoBalance) > 0.01) {
      if (seitoBalance > 0) {
        doc.fillColor('#2563EB').text(`Logistik deu a Seito: ${fmtCurrency(seitoBalance)}`, startX, y);
      } else {
        doc.fillColor('#EA580C').text(`Seito deu a Logistik: ${fmtCurrency(Math.abs(seitoBalance))}`, startX, y);
      }
    } else {
      doc.fillColor('#16A34A').text('Balanç equilibrat — no hi ha deutes pendents', startX, y);
    }

    doc.end();
  } catch (error) {
    next(error);
  }
});

// ===========================================
// GET /api/shared-invoices/period-locks — Estat de bloqueig/compensació de tots els períodes d'un any
// ===========================================
router.get('/period-locks', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    let locks = [];
    try {
      locks = await prisma.sharedPeriodLock.findMany({
        where: { year },
        include: {
          lockedByUser: { select: { name: true } },
          compensatedByUser: { select: { name: true } },
        },
      });
    } catch { /* taula pot no existir encara */ }
    // Retorna un objecte indexat per "periodType:period" per fàcil consulta al frontend
    const map = {};
    for (const lock of locks) {
      map[`${lock.periodType}:${lock.period}`] = {
        id: lock.id,
        locked: lock.locked,
        lockedAt: lock.lockedAt,
        lockedByName: lock.lockedByUser?.name || null,
        compensated: lock.compensated,
        compensatedAt: lock.compensatedAt,
        compensatedByName: lock.compensatedByUser?.name || null,
        compensatedDirection: lock.compensatedDirection,
        compensatedAmount: lock.compensatedAmount ? parseFloat(lock.compensatedAmount) : null,
        balanceSeito: lock.balanceSeito ? parseFloat(lock.balanceSeito) : null,
        balanceLogistik: lock.balanceLogistik ? parseFloat(lock.balanceLogistik) : null,
      };
    }
    res.json(map);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/shared-invoices/lock — Bloquejar un període
// ===========================================
router.post('/lock', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { year, period, periodType } = req.body;
    if (!year || !period || !periodType) {
      return res.status(400).json({ error: 'Falten camps: year, period, periodType' });
    }
    const lock = await prisma.sharedPeriodLock.upsert({
      where: { year_period_periodType: { year: parseInt(year), period, periodType } },
      create: {
        year: parseInt(year),
        period,
        periodType,
        locked: true,
        lockedAt: new Date(),
        lockedBy: req.user.id,
      },
      update: {
        locked: true,
        lockedAt: new Date(),
        lockedBy: req.user.id,
      },
    });
    res.json({ success: true, lock });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/shared-invoices/unlock — Desbloquejar un període
// ===========================================
router.post('/unlock', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { year, period, periodType } = req.body;
    if (!year || !period || !periodType) {
      return res.status(400).json({ error: 'Falten camps: year, period, periodType' });
    }
    const lock = await prisma.sharedPeriodLock.upsert({
      where: { year_period_periodType: { year: parseInt(year), period, periodType } },
      create: {
        year: parseInt(year),
        period,
        periodType,
        locked: false,
      },
      update: {
        locked: false,
        lockedAt: null,
        lockedBy: null,
        // Si es desbloqueja, també es descompensa
        compensated: false,
        compensatedAt: null,
        compensatedBy: null,
        compensatedDirection: null,
        compensatedAmount: null,
        balanceSeito: null,
        balanceLogistik: null,
      },
    });
    res.json({ success: true, lock });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/shared-invoices/compensate — Compensar un període (liquidar balanç)
// ===========================================
router.post('/compensate', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { year, period, periodType } = req.body;
    if (!year || !period || !periodType) {
      return res.status(400).json({ error: 'Falten camps: year, period, periodType' });
    }

    const targetYear = parseInt(year);

    // Determinar rang de dates pel període
    let dateFrom, dateTo;
    if (periodType === 'quarter') {
      const q = parseInt(period.replace('Q', ''));
      const startMonth = (q - 1) * 3; // 0-indexed
      dateFrom = new Date(targetYear, startMonth, 1);
      dateTo = new Date(targetYear, startMonth + 3, 1);
    } else {
      // mes: period = "01".."12"
      const m = parseInt(period) - 1; // 0-indexed
      dateFrom = new Date(targetYear, m, 1);
      dateTo = new Date(targetYear, m + 1, 1);
    }

    // Obtenir factures compartides del període
    const invoices = await prisma.receivedInvoice.findMany({
      where: {
        isShared: true,
        deletedAt: null,
        issueDate: { gte: dateFrom, lt: dateTo },
      },
    });

    if (!invoices.length) {
      return res.status(400).json({ error: 'No hi ha factures compartides en aquest període' });
    }

    // Calcular balanç
    let totalSeito = 0;
    let totalLogistik = 0;
    let seitoPaid = 0;
    let logistikPaid = 0;
    let pendingCount = 0;

    for (const inv of invoices) {
      const total = parseFloat(inv.totalAmount);
      const pSeito = parseFloat(inv.sharedPercentSeito) / 100;
      const pLogistik = parseFloat(inv.sharedPercentLogistik) / 100;
      totalSeito += total * pSeito;
      totalLogistik += total * pLogistik;
      if (inv.paidBy === 'SEITO') seitoPaid += total;
      else if (inv.paidBy === 'LOGISTIK') logistikPaid += total;
      else pendingCount++;
    }

    if (pendingCount > 0) {
      return res.status(400).json({
        error: `Hi ha ${pendingCount} factures sense indicar qui les ha pagat. Cal assignar "Pagat per" a totes.`,
      });
    }

    // Balanç: qui ha pagat de més respecte la seva part
    const seitoBalance = seitoPaid - totalSeito; // positiu = Seito ha pagat de més
    let direction = null;
    let amount = 0;

    if (seitoBalance > 0.01) {
      direction = 'LOGISTIK_PAYS_SEITO';
      amount = Math.round(seitoBalance * 100) / 100;
    } else if (seitoBalance < -0.01) {
      direction = 'SEITO_PAYS_LOGISTIK';
      amount = Math.round(Math.abs(seitoBalance) * 100) / 100;
    }
    // Si seitoBalance ≈ 0, no cal compensar (direction queda null, amount 0)

    const lock = await prisma.sharedPeriodLock.upsert({
      where: { year_period_periodType: { year: targetYear, period, periodType } },
      create: {
        year: targetYear,
        period,
        periodType,
        locked: true,
        lockedAt: new Date(),
        lockedBy: req.user.id,
        compensated: true,
        compensatedAt: new Date(),
        compensatedBy: req.user.id,
        compensatedDirection: direction,
        compensatedAmount: amount,
        balanceSeito: Math.round(seitoPaid * 100) / 100,
        balanceLogistik: Math.round(logistikPaid * 100) / 100,
      },
      update: {
        locked: true,
        lockedAt: new Date(),
        lockedBy: req.user.id,
        compensated: true,
        compensatedAt: new Date(),
        compensatedBy: req.user.id,
        compensatedDirection: direction,
        compensatedAmount: amount,
        balanceSeito: Math.round(seitoPaid * 100) / 100,
        balanceLogistik: Math.round(logistikPaid * 100) / 100,
      },
    });

    res.json({
      success: true,
      lock,
      summary: {
        invoiceCount: invoices.length,
        totalSeito: Math.round(totalSeito * 100) / 100,
        totalLogistik: Math.round(totalLogistik * 100) / 100,
        seitoPaid: Math.round(seitoPaid * 100) / 100,
        logistikPaid: Math.round(logistikPaid * 100) / 100,
        direction,
        amount,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
