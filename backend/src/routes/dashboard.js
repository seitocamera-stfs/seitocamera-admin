const express = require('express');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');
const { logger } = require('../config/logger');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('dashboard'));

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

    // ----- 1. Evolució mensual de facturació -----
    // Agrupat per mes (YYYY-MM) des de received/issued invoices
    const [monthlyReceivedRaw, monthlyIssuedRaw] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          TO_CHAR(DATE_TRUNC('month', "issueDate"), 'YYYY-MM') AS month,
          SUM("totalAmount")::float AS total,
          COUNT(*)::int AS count
        FROM "received_invoices"
        WHERE "issueDate" >= ${from} AND "issueDate" <= ${to}
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
    ]);

    // Fusionar els dos arrays per mes
    const monthsMap = new Map();
    for (const r of monthlyReceivedRaw) {
      monthsMap.set(r.month, { month: r.month, received: r.total || 0, issued: 0, receivedCount: r.count, issuedCount: 0 });
    }
    for (const r of monthlyIssuedRaw) {
      const existing = monthsMap.get(r.month);
      if (existing) {
        existing.issued = r.total || 0;
        existing.issuedCount = r.count;
      } else {
        monthsMap.set(r.month, { month: r.month, received: 0, issued: r.total || 0, receivedCount: 0, issuedCount: r.count });
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
        where: { issueDate: { gte: from, lte: to } },
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

    // ----- 6. Totals generals (per cards de resum) -----
    const [totalReceived, totalIssued, unconciliatedCount] = await Promise.all([
      prisma.receivedInvoice.aggregate({
        where: { issueDate: { gte: from, lte: to } },
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
    });
  } catch (error) {
    logger.error(`Dashboard stats error: ${error.message}`);
    next(error);
  }
});

module.exports = router;
