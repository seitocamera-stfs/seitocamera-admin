const express = require('express');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');
const { logger } = require('../config/logger');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('dashboard'));

// ===========================================
// Constants
// ===========================================

// Límit raonable per excloure imports clarament erronis (mal extrets del PDF)
const MAX_REASONABLE_AMOUNT = 1_000_000; // 1M€

// ===========================================
// Helpers
// ===========================================

/**
 * Parseja el rang de dates de query params.
 * Per defecte: últims 12 mesos (inici de mes) fins avui.
 */
function parseDateRange(req) {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 11, 1); // fa 11 mesos (12 mesos incloent actual)
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59); // final del mes actual

  const from = req.query.from ? new Date(req.query.from) : defaultFrom;
  const to = req.query.to ? new Date(req.query.to) : defaultTo;

  // Si el 'to' no té hora, posar final del dia
  if (req.query.to && !req.query.to.includes('T')) {
    to.setHours(23, 59, 59, 999);
  }

  return { from, to };
}

// ===========================================
// GET /api/dashboard/stats — Totes les dades dels gràfics
// ===========================================
router.get('/stats', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req);

    // ----- 1. Evolució mensual de facturació (+ any anterior per comparar) -----
    // Agrupat per mes (YYYY-MM) des de received/issued invoices
    // Excloem: esborrades (deletedAt), duplicats, import 0, AMOUNT_PENDING
    // També carreguem el mateix rang desplaçat -1 any per comparativa
    const prevFrom = new Date(from);
    prevFrom.setFullYear(prevFrom.getFullYear() - 1);
    const prevTo = new Date(to);
    prevTo.setFullYear(prevTo.getFullYear() - 1);

    const [monthlyReceivedRaw, monthlyIssuedRaw, prevReceivedRaw, prevIssuedRaw] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          TO_CHAR(DATE_TRUNC('month', "issueDate"), 'YYYY-MM') AS month,
          SUM("totalAmount")::float AS total,
          COUNT(*)::int AS count
        FROM "received_invoices"
        WHERE "issueDate" >= ${from} AND "issueDate" <= ${to}
          AND "deletedAt" IS NULL
          AND "isDuplicate" = false
          AND "totalAmount" > 0
          AND "totalAmount" < ${MAX_REASONABLE_AMOUNT}
          AND "status" NOT IN ('AMOUNT_PENDING', 'NOT_INVOICE')
        GROUP BY DATE_TRUNC('month', "issueDate")
        ORDER BY DATE_TRUNC('month', "issueDate") ASC
      `,
      prisma.$queryRaw`
        SELECT
          TO_CHAR(DATE_TRUNC('month', "issueDate"), 'YYYY-MM') AS month,
          SUM("totalAmount")::float AS total,
          COUNT(*)::int AS count
        FROM "issued_invoices"
        WHERE "issueDate" >= ${from} AND "issueDate" <= ${to}
        GROUP BY DATE_TRUNC('month', "issueDate")
        ORDER BY DATE_TRUNC('month', "issueDate") ASC
      `,
      // Any anterior — rebudes
      prisma.$queryRaw`
        SELECT
          TO_CHAR(DATE_TRUNC('month', "issueDate"), 'YYYY-MM') AS month,
          SUM("totalAmount")::float AS total,
          COUNT(*)::int AS count
        FROM "received_invoices"
        WHERE "issueDate" >= ${prevFrom} AND "issueDate" <= ${prevTo}
          AND "deletedAt" IS NULL
          AND "isDuplicate" = false
          AND "totalAmount" > 0
          AND "totalAmount" < ${MAX_REASONABLE_AMOUNT}
          AND "status" NOT IN ('AMOUNT_PENDING', 'NOT_INVOICE')
        GROUP BY DATE_TRUNC('month', "issueDate")
        ORDER BY DATE_TRUNC('month', "issueDate") ASC
      `,
      // Any anterior — emeses
      prisma.$queryRaw`
        SELECT
          TO_CHAR(DATE_TRUNC('month', "issueDate"), 'YYYY-MM') AS month,
          SUM("totalAmount")::float AS total,
          COUNT(*)::int AS count
        FROM "issued_invoices"
        WHERE "issueDate" >= ${prevFrom} AND "issueDate" <= ${prevTo}
        GROUP BY DATE_TRUNC('month', "issueDate")
        ORDER BY DATE_TRUNC('month', "issueDate") ASC
      `,
    ]);

    // Indexar any anterior per mes (MM) per poder-lo mapejar al mes actual
    const prevReceivedByMM = new Map();
    for (const r of prevReceivedRaw) {
      const mm = r.month.slice(5); // "YYYY-MM" → "MM"
      prevReceivedByMM.set(mm, r.total || 0);
    }
    const prevIssuedByMM = new Map();
    for (const r of prevIssuedRaw) {
      const mm = r.month.slice(5);
      prevIssuedByMM.set(mm, r.total || 0);
    }

    // Fusionar els arrays per mes (actual + any anterior)
    const monthsMap = new Map();
    for (const r of monthlyReceivedRaw) {
      const mm = r.month.slice(5);
      monthsMap.set(r.month, {
        month: r.month,
        received: r.total || 0,
        issued: 0,
        receivedCount: r.count,
        issuedCount: 0,
        prevReceived: prevReceivedByMM.get(mm) || 0,
        prevIssued: prevIssuedByMM.get(mm) || 0,
      });
    }
    for (const r of monthlyIssuedRaw) {
      const mm = r.month.slice(5);
      const existing = monthsMap.get(r.month);
      if (existing) {
        existing.issued = r.total || 0;
        existing.issuedCount = r.count;
      } else {
        monthsMap.set(r.month, {
          month: r.month,
          received: 0,
          issued: r.total || 0,
          receivedCount: 0,
          issuedCount: r.count,
          prevReceived: prevReceivedByMM.get(mm) || 0,
          prevIssued: prevIssuedByMM.get(mm) || 0,
        });
      }
    }
    const monthlyBilling = Array.from(monthsMap.values()).sort((a, b) => a.month.localeCompare(b.month));

    // ----- 2. Saldo bancari històric -----
    // Últim moviment per dia i per compte
    const bankBalanceRaw = await prisma.$queryRaw`
      SELECT DISTINCT ON (DATE("date"), "accountName")
        DATE("date") AS date,
        "accountName",
        "balance"::float AS balance
      FROM "bank_movements"
      WHERE "date" >= ${from} AND "date" <= ${to} AND "balance" IS NOT NULL
      ORDER BY DATE("date") ASC, "accountName" ASC, "date" DESC
    `;

    // Pivotar: agrupar per data, amb un camp per cada compte
    const bankBalanceByDate = new Map();
    for (const row of bankBalanceRaw) {
      const dateKey = row.date.toISOString().split('T')[0];
      const accountKey = row.accountName || 'Altres';
      if (!bankBalanceByDate.has(dateKey)) {
        bankBalanceByDate.set(dateKey, { date: dateKey });
      }
      bankBalanceByDate.get(dateKey)[accountKey] = row.balance;
    }
    const bankBalance = Array.from(bankBalanceByDate.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Detectar noms de compte únics per saber quines línies pintar
    const accountNames = [...new Set(bankBalanceRaw.map((r) => r.accountName || 'Altres'))];

    // ----- 3. Top clients (per facturació) -----
    const topClientsAgg = await prisma.issuedInvoice.groupBy({
      by: ['clientId'],
      where: { issueDate: { gte: from, lte: to } },
      _sum: { totalAmount: true },
      _count: { _all: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 10,
    });

    const clientIds = topClientsAgg.map((c) => c.clientId).filter(Boolean);
    const clientsInfo = clientIds.length
      ? await prisma.client.findMany({
          where: { id: { in: clientIds } },
          select: { id: true, name: true },
        })
      : [];
    const clientsMap = new Map(clientsInfo.map((c) => [c.id, c.name]));

    const topClients = topClientsAgg.map((c) => ({
      clientId: c.clientId,
      name: clientsMap.get(c.clientId) || 'Desconegut',
      total: parseFloat(c._sum.totalAmount) || 0,
      count: c._count._all,
    }));

    // ----- 4. Top proveïdors (per despesa) -----
    const topSuppliersAgg = await prisma.receivedInvoice.groupBy({
      by: ['supplierId'],
      where: {
        issueDate: { gte: from, lte: to },
        supplierId: { not: null },
        deletedAt: null,
        isDuplicate: false,
        totalAmount: { gt: 0, lt: MAX_REASONABLE_AMOUNT },
        status: { notIn: ['AMOUNT_PENDING', 'NOT_INVOICE'] },
      },
      _sum: { totalAmount: true },
      _count: { _all: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 10,
    });

    const supplierIds = topSuppliersAgg.map((s) => s.supplierId).filter(Boolean);
    const suppliersInfo = supplierIds.length
      ? await prisma.supplier.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, name: true },
        })
      : [];
    const suppliersMap = new Map(suppliersInfo.map((s) => [s.id, s.name]));

    const topSuppliers = topSuppliersAgg.map((s) => ({
      supplierId: s.supplierId,
      name: suppliersMap.get(s.supplierId) || 'Desconegut',
      total: parseFloat(s._sum.totalAmount) || 0,
      count: s._count._all,
    }));

    // ----- 5. Distribució per estat de factures -----
    const [receivedStatusAgg, issuedStatusAgg] = await Promise.all([
      prisma.receivedInvoice.groupBy({
        by: ['status'],
        where: {
          issueDate: { gte: from, lte: to },
          deletedAt: null,
          isDuplicate: false,
        },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      prisma.issuedInvoice.groupBy({
        by: ['status'],
        where: { issueDate: { gte: from, lte: to } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
    ]);

    const invoiceStatusDistribution = {
      received: receivedStatusAgg.map((s) => ({
        status: s.status,
        count: s._count._all,
        total: parseFloat(s._sum.totalAmount) || 0,
      })),
      issued: issuedStatusAgg.map((s) => ({
        status: s.status,
        count: s._count._all,
        total: parseFloat(s._sum.totalAmount) || 0,
      })),
    };

    // ----- 6. Factures pendents de pagament (últims 6 mesos) -----
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const pendingPayments = await prisma.receivedInvoice.findMany({
      where: {
        deletedAt: null,
        isDuplicate: false,
        status: { notIn: ['PAID', 'NOT_INVOICE', 'AMOUNT_PENDING'] },
        totalAmount: { gt: 0, lt: MAX_REASONABLE_AMOUNT },
        issueDate: { gte: sixMonthsAgo },
      },
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        dueDate: true,
        totalAmount: true,
        status: true,
        supplier: { select: { id: true, name: true } },
      },
      orderBy: [
        { dueDate: { sort: 'asc', nulls: 'last' } },
        { issueDate: 'asc' },
      ],
      take: 50,
    });

    // Calcular totals pendents i vençudes
    const now = new Date();
    let pendingTotal = 0;
    let overdueTotal = 0;
    let overdueCount = 0;
    for (const inv of pendingPayments) {
      const amount = parseFloat(inv.totalAmount) || 0;
      pendingTotal += amount;
      if (inv.dueDate && new Date(inv.dueDate) < now) {
        overdueTotal += amount;
        overdueCount++;
      }
    }

    // ----- 7. Factures emeses pendents de cobrament (des de 2025) -----
    const overdueIssuedInvoices = await prisma.issuedInvoice.findMany({
      where: {
        status: { notIn: ['PAID'] },
        issueDate: { gte: new Date('2025-01-01') },
      },
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        dueDate: true,
        totalAmount: true,
        status: true,
        client: { select: { id: true, name: true } },
      },
      orderBy: { issueDate: 'asc' },
      take: 50,
    });

    // ----- 8. Totals generals (per cards de resum) -----
    const [totalReceived, totalIssued, unconciliatedCount] = await Promise.all([
      prisma.receivedInvoice.aggregate({
        where: {
          issueDate: { gte: from, lte: to },
          deletedAt: null,
          isDuplicate: false,
          totalAmount: { gt: 0, lt: MAX_REASONABLE_AMOUNT },
          status: { notIn: ['AMOUNT_PENDING', 'NOT_INVOICE'] },
        },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      prisma.issuedInvoice.aggregate({
        where: { issueDate: { gte: from, lte: to } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      prisma.bankMovement.count({
        where: {
          date: { gte: from, lte: to },
          isConciliated: false,
        },
      }),
    ]);

    res.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        totalReceived: parseFloat(totalReceived._sum.totalAmount) || 0,
        totalReceivedCount: totalReceived._count._all,
        totalIssued: parseFloat(totalIssued._sum.totalAmount) || 0,
        totalIssuedCount: totalIssued._count._all,
        unconciliatedCount,
      },
      monthlyBilling,
      bankBalance,
      bankAccountNames: accountNames,
      topClients,
      topSuppliers,
      invoiceStatusDistribution,
      pendingPayments: {
        invoices: pendingPayments.map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          totalAmount: parseFloat(inv.totalAmount) || 0,
          status: inv.status,
          supplierName: inv.supplier?.name || 'Desconegut',
          supplierId: inv.supplier?.id,
          isOverdue: inv.dueDate ? new Date(inv.dueDate) < now : false,
        })),
        total: pendingTotal,
        count: pendingPayments.length,
        overdueTotal,
        overdueCount,
      },
      overdueIssuedInvoices: {
        invoices: overdueIssuedInvoices.map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          totalAmount: parseFloat(inv.totalAmount) || 0,
          status: inv.status,
          clientName: inv.client?.name || 'Desconegut',
          clientId: inv.client?.id,
          daysPending: Math.floor((now - new Date(inv.issueDate)) / (1000 * 60 * 60 * 24)),
        })),
        total: overdueIssuedInvoices.reduce((sum, inv) => sum + (parseFloat(inv.totalAmount) || 0), 0),
        count: overdueIssuedInvoices.length,
      },
    });
  } catch (error) {
    logger.error(`Dashboard stats error: ${error.message}`);
    next(error);
  }
});

// ===========================================
// GET /api/dashboard/top — Top clients i proveïdors amb rang independent
// ===========================================
router.get('/top', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req);

    // Top clients
    const topClientsAgg = await prisma.issuedInvoice.groupBy({
      by: ['clientId'],
      where: { issueDate: { gte: from, lte: to } },
      _sum: { totalAmount: true },
      _count: { _all: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 10,
    });

    const clientIds = topClientsAgg.map((c) => c.clientId).filter(Boolean);
    const clientsInfo = clientIds.length
      ? await prisma.client.findMany({
          where: { id: { in: clientIds } },
          select: { id: true, name: true },
        })
      : [];
    const clientsMap = new Map(clientsInfo.map((c) => [c.id, c.name]));

    const topClients = topClientsAgg.map((c) => ({
      clientId: c.clientId,
      name: clientsMap.get(c.clientId) || 'Desconegut',
      total: parseFloat(c._sum.totalAmount) || 0,
      count: c._count._all,
    }));

    // Top proveïdors
    const topSuppliersAgg = await prisma.receivedInvoice.groupBy({
      by: ['supplierId'],
      where: {
        issueDate: { gte: from, lte: to },
        supplierId: { not: null },
        deletedAt: null,
        isDuplicate: false,
        totalAmount: { gt: 0, lt: MAX_REASONABLE_AMOUNT },
        status: { notIn: ['AMOUNT_PENDING', 'NOT_INVOICE'] },
      },
      _sum: { totalAmount: true },
      _count: { _all: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 10,
    });

    const supplierIds = topSuppliersAgg.map((s) => s.supplierId).filter(Boolean);
    const suppliersInfo = supplierIds.length
      ? await prisma.supplier.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, name: true },
        })
      : [];
    const suppliersMap = new Map(suppliersInfo.map((s) => [s.id, s.name]));

    const topSuppliers = topSuppliersAgg.map((s) => ({
      supplierId: s.supplierId,
      name: suppliersMap.get(s.supplierId) || 'Desconegut',
      total: parseFloat(s._sum.totalAmount) || 0,
      count: s._count._all,
    }));

    res.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      topClients,
      topSuppliers,
    });
  } catch (error) {
    logger.error(`Dashboard top error: ${error.message}`);
    next(error);
  }
});

module.exports = router;
