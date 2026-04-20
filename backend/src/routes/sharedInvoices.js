const express = require('express');
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

module.exports = router;
