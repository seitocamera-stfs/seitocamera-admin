/**
 * strategicAnalysisService — Anàlisi transversal per al CEO IA.
 *
 * Calcula KPIs, rendibilitat i riscos a nivell d'empresa: facturació, marge,
 * tresoreria, top clients/proveïdors, cobraments vençuts, projecció de
 * tresoreria i alertes estratègiques.
 *
 * Tot s'agrega sobre les dades comptables formals (factures comptabilitzades,
 * journal_lines POSTED) per garantir coherència amb informes financers.
 */
const { prisma } = require('../config/database');

const n = (v) => (v == null ? 0 : Number(v));
const round2 = (v) => Math.round(v * 100) / 100;

const yearStart = (year) => new Date(year, 0, 1);
const yearEnd = (year) => new Date(year, 11, 31, 23, 59, 59, 999);

async function resolveCompany() {
  const c = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!c) throw new Error('Cap empresa configurada');
  return c;
}

// ------------------------------------------------------------------
// KPI overview de l'any en curs
// ------------------------------------------------------------------
async function getKpiOverview(year) {
  const company = await resolveCompany();
  const y = year || new Date().getFullYear();
  const from = yearStart(y);
  const to = yearEnd(y);

  // Facturació de l'any (issued POSTED)
  const issued = await prisma.issuedInvoice.aggregate({
    where: { issueDate: { gte: from, lte: to }, journalEntryId: { not: null } },
    _sum: { subtotal: true, totalAmount: true, paidAmount: true },
    _count: true,
  });
  // Despeses (rebudes POSTED, no LOGISTIK, no compres d'immobilitzat = només grup 6)
  const expensesByGroup = await prisma.$queryRawUnsafe(`
    SELECT SUM(jl.debit - jl.credit)::float AS total
    FROM journal_lines jl
    JOIN journal_entries je ON jl."journalEntryId" = je.id
    JOIN chart_of_accounts a ON jl."accountId" = a.id
    WHERE je."companyId" = $1
      AND je.status = 'POSTED'
      AND je.date >= $2 AND je.date <= $3
      AND a.code LIKE '6%'
      AND a.code NOT LIKE '630%'
  `, company.id, from, to);
  const totalExpenses = round2(expensesByGroup[0]?.total || 0);

  // Ingressos (grup 7)
  const incomesByGroup = await prisma.$queryRawUnsafe(`
    SELECT SUM(jl.credit - jl.debit)::float AS total
    FROM journal_lines jl
    JOIN journal_entries je ON jl."journalEntryId" = je.id
    JOIN chart_of_accounts a ON jl."accountId" = a.id
    WHERE je."companyId" = $1
      AND je.status = 'POSTED'
      AND je.date >= $2 AND je.date <= $3
      AND a.code LIKE '7%'
  `, company.id, from, to);
  const totalIncomes = round2(incomesByGroup[0]?.total || 0);

  const grossMargin = round2(totalIncomes - totalExpenses);
  const marginPct = totalIncomes > 0 ? round2((grossMargin / totalIncomes) * 100) : 0;

  // Saldo actual de tots els comptes 572 (tresoreria)
  const cash = await prisma.$queryRawUnsafe(`
    SELECT SUM(jl.debit - jl.credit)::float AS total
    FROM journal_lines jl
    JOIN journal_entries je ON jl."journalEntryId" = je.id
    JOIN chart_of_accounts a ON jl."accountId" = a.id
    WHERE je."companyId" = $1
      AND je.status = 'POSTED'
      AND a.code LIKE '572%'
  `, company.id);
  const cashBalance = round2(cash[0]?.total || 0);

  // Pendent de cobrar (clients 430xxx)
  const pendingCollection = await prisma.$queryRawUnsafe(`
    SELECT SUM(jl.debit - jl.credit)::float AS total
    FROM journal_lines jl
    JOIN journal_entries je ON jl."journalEntryId" = je.id
    JOIN chart_of_accounts a ON jl."accountId" = a.id
    WHERE je."companyId" = $1
      AND je.status = 'POSTED'
      AND a.code LIKE '430%'
  `, company.id);
  const pendingCollect = round2(pendingCollection[0]?.total || 0);

  // Pendent de pagar (proveïdors/creditors 400, 410)
  const pendingPayment = await prisma.$queryRawUnsafe(`
    SELECT SUM(jl.credit - jl.debit)::float AS total
    FROM journal_lines jl
    JOIN journal_entries je ON jl."journalEntryId" = je.id
    JOIN chart_of_accounts a ON jl."accountId" = a.id
    WHERE je."companyId" = $1
      AND je.status = 'POSTED'
      AND (a.code LIKE '400%' OR a.code LIKE '410%')
  `, company.id);
  const pendingPay = round2(pendingPayment[0]?.total || 0);

  // Cobrats / Pendents de l'any (de IssuedInvoice)
  const issuedTotal = round2(n(issued._sum.totalAmount));
  const issuedPaid = round2(n(issued._sum.paidAmount));
  const collectionRate = issuedTotal > 0 ? round2((issuedPaid / issuedTotal) * 100) : 0;

  return {
    year: y,
    facturacio: round2(n(issued._sum.subtotal)),
    facturacioTotal: issuedTotal,
    facturacioCobrada: issuedPaid,
    collectionRate,
    nFactures: issued._count,
    totalIncomes,
    totalExpenses,
    grossMargin,
    marginPct,
    cashBalance,
    pendingCollect,
    pendingPay,
    netLiquidity: round2(cashBalance + pendingCollect - pendingPay),
  };
}

// ------------------------------------------------------------------
// Top clients per facturació (any)
// ------------------------------------------------------------------
async function getTopClients(year, limit = 10) {
  const y = year || new Date().getFullYear();
  const result = await prisma.issuedInvoice.groupBy({
    by: ['clientId'],
    where: {
      issueDate: { gte: yearStart(y), lte: yearEnd(y) },
    },
    _sum: { subtotal: true, totalAmount: true, paidAmount: true },
    _count: true,
    orderBy: { _sum: { totalAmount: 'desc' } },
    take: limit,
  });

  const clientIds = result.map((r) => r.clientId);
  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds } },
    select: { id: true, name: true, nif: true },
  });
  const byId = new Map(clients.map((c) => [c.id, c]));

  const total = result.reduce((s, r) => s + n(r._sum.totalAmount), 0);

  return result.map((r) => {
    const c = byId.get(r.clientId);
    return {
      clientId: r.clientId,
      name: c?.name || '?',
      nif: c?.nif || '',
      invoices: r._count,
      revenue: round2(n(r._sum.subtotal)),
      totalBilled: round2(n(r._sum.totalAmount)),
      paid: round2(n(r._sum.paidAmount)),
      outstanding: round2(n(r._sum.totalAmount) - n(r._sum.paidAmount)),
      sharePct: total > 0 ? round2((n(r._sum.totalAmount) / total) * 100) : 0,
    };
  });
}

// ------------------------------------------------------------------
// Top proveïdors per despesa (any)
// ------------------------------------------------------------------
async function getTopSuppliers(year, limit = 10) {
  const y = year || new Date().getFullYear();
  const result = await prisma.receivedInvoice.groupBy({
    by: ['supplierId'],
    where: {
      issueDate: { gte: yearStart(y), lte: yearEnd(y) },
      deletedAt: null, isDuplicate: false,
      origin: { not: 'LOGISTIK' },
      status: { notIn: ['NOT_INVOICE', 'REJECTED'] },
      supplierId: { not: null },
    },
    _sum: { subtotal: true, totalAmount: true },
    _count: true,
    orderBy: { _sum: { totalAmount: 'desc' } },
    take: limit,
  });
  const supplierIds = result.map((r) => r.supplierId);
  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: supplierIds } },
    select: { id: true, name: true, nif: true, isPublicAdmin: true },
  });
  const byId = new Map(suppliers.map((s) => [s.id, s]));

  const total = result.reduce((s, r) => s + n(r._sum.totalAmount), 0);

  return result.map((r) => {
    const s = byId.get(r.supplierId);
    return {
      supplierId: r.supplierId,
      name: s?.name || '?',
      nif: s?.nif || '',
      isPublicAdmin: s?.isPublicAdmin || false,
      invoices: r._count,
      cost: round2(n(r._sum.subtotal)),
      totalBilled: round2(n(r._sum.totalAmount)),
      sharePct: total > 0 ? round2((n(r._sum.totalAmount) / total) * 100) : 0,
    };
  });
}

// ------------------------------------------------------------------
// Cobraments vençuts amb impacte
// ------------------------------------------------------------------
async function getOverdueCollections() {
  const today = new Date();
  const overdue = await prisma.issuedInvoice.findMany({
    where: { dueDate: { lte: today, not: null } },
    select: {
      id: true, invoiceNumber: true, dueDate: true, totalAmount: true, paidAmount: true,
      client: { select: { id: true, name: true } },
    },
    orderBy: { dueDate: 'asc' },
  });
  const items = overdue
    .filter((i) => Number(i.totalAmount) > Number(i.paidAmount || 0))
    .map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      dueDate: i.dueDate,
      daysOverdue: Math.ceil((today - i.dueDate) / (1000 * 60 * 60 * 24)),
      client: i.client?.name || '?',
      clientId: i.client?.id,
      outstanding: round2(n(i.totalAmount) - n(i.paidAmount)),
    }));
  const total = round2(items.reduce((s, i) => s + i.outstanding, 0));

  // Agregar per client
  const byClient = {};
  for (const i of items) {
    if (!byClient[i.clientId]) byClient[i.clientId] = { client: i.client, count: 0, total: 0, oldest: 0 };
    byClient[i.clientId].count++;
    byClient[i.clientId].total += i.outstanding;
    if (i.daysOverdue > byClient[i.clientId].oldest) byClient[i.clientId].oldest = i.daysOverdue;
  }
  const topDebtors = Object.values(byClient)
    .map((c) => ({ ...c, total: round2(c.total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return { total, count: items.length, items: items.slice(0, 30), topDebtors };
}

// ------------------------------------------------------------------
// Cash flow: tresoreria actual vs cobraments/pagaments dels propers 60 dies
// ------------------------------------------------------------------
async function getCashFlowProjection(daysAhead = 60) {
  const company = await resolveCompany();
  const today = new Date();
  const horizon = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  // Saldo actual
  const cash = await prisma.$queryRawUnsafe(`
    SELECT SUM(jl.debit - jl.credit)::float AS total
    FROM journal_lines jl
    JOIN journal_entries je ON jl."journalEntryId" = je.id
    JOIN chart_of_accounts a ON jl."accountId" = a.id
    WHERE je."companyId" = $1
      AND je.status = 'POSTED'
      AND a.code LIKE '572%'
  `, company.id);
  const cashBalance = round2(cash[0]?.total || 0);

  // Cobraments previstos: factures emeses no pagades amb dueDate dins l'horitzó
  const collectionsExpected = await prisma.issuedInvoice.findMany({
    where: { dueDate: { lte: horizon, not: null }, status: { notIn: ['PAID'] } },
    select: { totalAmount: true, paidAmount: true, dueDate: true },
  });
  const expectedCollections = round2(collectionsExpected.reduce((s, i) => s + (n(i.totalAmount) - n(i.paidAmount)), 0));

  // Pagaments previstos: factures rebudes no pagades amb dueDate dins l'horitzó
  const paymentsExpected = await prisma.receivedInvoice.findMany({
    where: {
      deletedAt: null, isDuplicate: false,
      origin: { not: 'LOGISTIK' },
      dueDate: { lte: horizon, not: null },
      status: { notIn: ['PAID', 'REJECTED', 'NOT_INVOICE'] },
    },
    select: { totalAmount: true, paidAmount: true, dueDate: true },
  });
  const expectedPayments = round2(paymentsExpected.reduce((s, i) => s + (n(i.totalAmount) - n(i.paidAmount)), 0));

  const projectedBalance = round2(cashBalance + expectedCollections - expectedPayments);

  return {
    daysAhead,
    today: today.toISOString().slice(0, 10),
    horizon: horizon.toISOString().slice(0, 10),
    cashBalance,
    expectedCollections,
    expectedPayments,
    projectedBalance,
    risk: projectedBalance < 0 ? 'CRITICAL' : projectedBalance < cashBalance * 0.3 ? 'TENSE' : 'OK',
  };
}

// ------------------------------------------------------------------
// Resum projectes Rentman: actius, ingressos associats per projectReference
// ------------------------------------------------------------------
async function getProjectsSummary(year) {
  const y = year || new Date().getFullYear();
  // Comptem RentalProjects actius (status no CLOSED)
  const active = await prisma.rentalProject.count({
    where: { status: { notIn: ['CLOSED'] } },
  });
  const total = await prisma.rentalProject.count({});

  // Facturació associada a projectes (per projectReference)
  const projectInvoices = await prisma.issuedInvoice.findMany({
    where: {
      issueDate: { gte: yearStart(y), lte: yearEnd(y) },
      projectReference: { not: null },
    },
    select: { projectReference: true, projectName: true, totalAmount: true, paidAmount: true },
  });

  const byRef = {};
  for (const inv of projectInvoices) {
    const k = inv.projectReference;
    if (!byRef[k]) byRef[k] = { reference: k, name: inv.projectName || k, totalBilled: 0, paid: 0, count: 0 };
    byRef[k].totalBilled += n(inv.totalAmount);
    byRef[k].paid += n(inv.paidAmount);
    byRef[k].count++;
  }
  const topProjects = Object.values(byRef)
    .map((p) => ({ ...p, totalBilled: round2(p.totalBilled), paid: round2(p.paid), outstanding: round2(p.totalBilled - p.paid) }))
    .sort((a, b) => b.totalBilled - a.totalBilled)
    .slice(0, 10);

  return {
    activeCount: active,
    totalCount: total,
    invoicedProjectsCount: Object.keys(byRef).length,
    topProjects,
  };
}

// ------------------------------------------------------------------
// Resum d'inventari: nombre d'equips, valor net immobilitzat actiu
// ------------------------------------------------------------------
async function getInventorySummary() {
  const equipmentCount = await prisma.equipment.count({ where: { status: { not: 'DECOMMISSIONED' } } });
  const fixedAssets = await prisma.fixedAsset.findMany({
    where: { status: { in: ['ACTIVE', 'FULLY_AMORTIZED'] } },
    select: {
      acquisitionValue: true, monthlyAmortization: true, status: true,
      amortizationEntries: { where: { status: 'POSTED' }, select: { amount: true } },
    },
  });
  const totalAcquisition = round2(fixedAssets.reduce((s, f) => s + n(f.acquisitionValue), 0));
  const totalAmortAccum = round2(fixedAssets.reduce((s, f) => s + f.amortizationEntries.reduce((s2, e) => s2 + n(e.amount), 0), 0));
  const totalNetValue = round2(totalAcquisition - totalAmortAccum);
  const monthlyAmortBurden = round2(fixedAssets.filter((f) => f.status === 'ACTIVE').reduce((s, f) => s + n(f.monthlyAmortization), 0));

  return {
    equipmentCount,
    fixedAssetsCount: fixedAssets.length,
    totalAcquisitionValue: totalAcquisition,
    totalAmortizedValue: totalAmortAccum,
    totalNetValue,
    monthlyAmortBurden,
  };
}

// ------------------------------------------------------------------
// Riscos estratègics — observacions de nivell directiu
// ------------------------------------------------------------------
async function getStrategicRisks() {
  const kpi = await getKpiOverview();
  const cashflow = await getCashFlowProjection(60);
  const overdue = await getOverdueCollections();
  const topClients = await getTopClients(undefined, 5);

  const risks = [];

  // Risc 1: Marge baix
  if (kpi.totalIncomes > 0 && kpi.marginPct < 10) {
    risks.push({
      level: kpi.marginPct < 0 ? 3 : 2,
      category: 'MARGIN',
      title: kpi.marginPct < 0 ? `Marge negatiu: ${kpi.marginPct}%` : `Marge molt baix: ${kpi.marginPct}%`,
      description: `Ingressos ${kpi.totalIncomes.toFixed(2)} € vs despeses ${kpi.totalExpenses.toFixed(2)} €. ${kpi.marginPct < 0 ? 'L\'empresa està perdent diners.' : 'Cal pujar preus o reduir costos.'}`,
      impact: kpi.grossMargin,
    });
  }

  // Risc 2: Tresoreria tensa
  if (cashflow.risk === 'CRITICAL') {
    risks.push({
      level: 3,
      category: 'CASH',
      title: 'Tresoreria projectada NEGATIVA en 60 dies',
      description: `Saldo actual ${cashflow.cashBalance.toFixed(2)} € + cobraments ${cashflow.expectedCollections.toFixed(2)} € - pagaments ${cashflow.expectedPayments.toFixed(2)} € = ${cashflow.projectedBalance.toFixed(2)} €. Risc d'impagament.`,
      impact: cashflow.projectedBalance,
    });
  } else if (cashflow.risk === 'TENSE') {
    risks.push({
      level: 2,
      category: 'CASH',
      title: 'Tresoreria tensa en 60 dies',
      description: `El saldo projectat (${cashflow.projectedBalance.toFixed(2)} €) baixa per sota del 30% del saldo actual. Vigila els grans pagaments.`,
      impact: cashflow.projectedBalance,
    });
  }

  // Risc 3: Cobraments vençuts grans
  if (kpi.totalIncomes > 0 && (overdue.total / kpi.totalIncomes) > 0.15) {
    risks.push({
      level: 2,
      category: 'COLLECTION',
      title: `Cobraments vençuts (${overdue.total.toFixed(2)} €) representen ${round2((overdue.total / kpi.totalIncomes) * 100)}% de la facturació`,
      description: `Tens ${overdue.count} factures vençudes pendents. Considera enviar recordatoris o restringir crèdit a clients reincidents.`,
      impact: overdue.total,
    });
  }

  // Risc 4: Concentració de clients
  if (topClients.length > 0 && topClients[0].sharePct > 30) {
    risks.push({
      level: 2,
      category: 'CONCENTRATION',
      title: `Concentració de risc: ${topClients[0].name} representa el ${topClients[0].sharePct}% de la facturació`,
      description: `Si aquest client deixa de comprar, l'empresa perd ${topClients[0].totalBilled.toFixed(2)} €/any. Estratègia: diversificar cartera.`,
      impact: topClients[0].totalBilled,
    });
  }

  return risks.sort((a, b) => b.level - a.level);
}

module.exports = {
  getKpiOverview,
  getTopClients,
  getTopSuppliers,
  getOverdueCollections,
  getCashFlowProjection,
  getProjectsSummary,
  getInventorySummary,
  getStrategicRisks,
};
