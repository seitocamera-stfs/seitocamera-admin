/**
 * vatBookService — Llibres registre d'IVA i IRPF.
 *
 * Genera els llibres oficials a partir de les invoices comptabilitzades:
 *   - VAT_INPUT  (IVA suportat):  1 fila per cada ReceivedInvoice POSTED
 *   - VAT_OUTPUT (IVA repercutit): 1 fila per cada IssuedInvoice POSTED
 *   - IRPF: 1 fila per cada ReceivedInvoice POSTED amb irpfAmount > 0
 *
 * Format pensat per ser exportat a Excel/CSV i complir el format de llibres
 * registre que la AEAT pot demanar (ordenats per data, número factura, NIF
 * proveïdor/client, base, tipus IVA, quota IVA, total).
 */
const { prisma } = require('../config/database');

function n(v) { return v == null ? 0 : Number(v); }
function round2(v) { return Math.round(v * 100) / 100; }

/**
 * Llibre IVA Suportat — factures rebudes comptabilitzades.
 */
async function getVatBookInput({ year, quarter, from, to }) {
  const range = resolveRange({ year, quarter, from, to });
  const invoices = await prisma.receivedInvoice.findMany({
    where: {
      issueDate: { gte: range.from, lte: range.to },
      deletedAt: null,
      isDuplicate: false,
      journalEntryId: { not: null },
    },
    include: {
      supplier: { select: { name: true, nif: true, country: true } },
      journalEntry: { select: { entryNumber: true } },
    },
    orderBy: { issueDate: 'asc' },
  });

  let totalBase = 0, totalIva = 0, totalIrpf = 0, totalTotal = 0;
  const rows = invoices.map((inv) => {
    const base = n(inv.subtotal);
    const iva  = n(inv.taxAmount);
    const irpf = n(inv.irpfAmount);
    const total = n(inv.totalAmount);
    totalBase  += base;
    totalIva   += iva;
    totalIrpf  += irpf;
    totalTotal += total;
    return {
      date: inv.issueDate.toISOString().slice(0, 10),
      entryNumber: inv.journalEntry?.entryNumber || null,
      invoiceNumber: inv.invoiceNumber,
      supplierName: inv.supplier?.name || '',
      supplierNif:  inv.supplier?.nif || '',
      supplierCountry: inv.supplier?.country || 'ES',
      base: round2(base),
      vatRate: n(inv.taxRate),
      vatAmount: round2(iva),
      irpfRate: n(inv.irpfRate),
      irpfAmount: round2(irpf),
      total: round2(total),
    };
  });

  return {
    type: 'VAT_INPUT',
    period: rangeLabel(range),
    from: range.from.toISOString().slice(0, 10),
    to:   range.to.toISOString().slice(0, 10),
    rows,
    totals: {
      count: rows.length,
      base: round2(totalBase),
      vatAmount: round2(totalIva),
      irpfAmount: round2(totalIrpf),
      total: round2(totalTotal),
    },
  };
}

/**
 * Llibre IVA Repercutit — factures emeses comptabilitzades.
 */
async function getVatBookOutput({ year, quarter, from, to }) {
  const range = resolveRange({ year, quarter, from, to });
  const invoices = await prisma.issuedInvoice.findMany({
    where: {
      issueDate: { gte: range.from, lte: range.to },
      journalEntryId: { not: null },
    },
    include: {
      client: { select: { name: true, nif: true, country: true } },
      journalEntry: { select: { entryNumber: true } },
    },
    orderBy: { issueDate: 'asc' },
  });

  let totalBase = 0, totalIva = 0, totalTotal = 0;
  const rows = invoices.map((inv) => {
    const base = n(inv.subtotal);
    const iva  = n(inv.taxAmount);
    const total = n(inv.totalAmount);
    totalBase  += base;
    totalIva   += iva;
    totalTotal += total;
    return {
      date: inv.issueDate.toISOString().slice(0, 10),
      entryNumber: inv.journalEntry?.entryNumber || null,
      invoiceNumber: inv.invoiceNumber,
      clientName: inv.client?.name || '',
      clientNif:  inv.client?.nif || '',
      clientCountry: inv.client?.country || 'ES',
      base: round2(base),
      vatRate: n(inv.taxRate),
      vatAmount: round2(iva),
      total: round2(total),
    };
  });

  return {
    type: 'VAT_OUTPUT',
    period: rangeLabel(range),
    from: range.from.toISOString().slice(0, 10),
    to:   range.to.toISOString().slice(0, 10),
    rows,
    totals: {
      count: rows.length,
      base: round2(totalBase),
      vatAmount: round2(totalIva),
      total: round2(totalTotal),
    },
  };
}

/**
 * Llibre de retencions IRPF practicades — factures rebudes amb IRPF > 0.
 */
async function getIrpfBook({ year, quarter, from, to }) {
  const range = resolveRange({ year, quarter, from, to });
  const invoices = await prisma.receivedInvoice.findMany({
    where: {
      issueDate: { gte: range.from, lte: range.to },
      deletedAt: null,
      isDuplicate: false,
      journalEntryId: { not: null },
      irpfAmount: { gt: 0 },
    },
    include: {
      supplier: { select: { name: true, nif: true } },
      journalEntry: { select: { entryNumber: true } },
    },
    orderBy: { issueDate: 'asc' },
  });

  let totalBase = 0, totalIrpf = 0;
  const rows = invoices.map((inv) => {
    const base = n(inv.subtotal);
    const irpf = n(inv.irpfAmount);
    totalBase += base;
    totalIrpf += irpf;
    return {
      date: inv.issueDate.toISOString().slice(0, 10),
      entryNumber: inv.journalEntry?.entryNumber || null,
      invoiceNumber: inv.invoiceNumber,
      perceptor: inv.supplier?.name || '',
      perceptorNif: inv.supplier?.nif || '',
      base: round2(base),
      irpfRate: n(inv.irpfRate),
      irpfAmount: round2(irpf),
    };
  });

  return {
    type: 'IRPF',
    period: rangeLabel(range),
    from: range.from.toISOString().slice(0, 10),
    to:   range.to.toISOString().slice(0, 10),
    rows,
    totals: {
      count: rows.length,
      base: round2(totalBase),
      irpfAmount: round2(totalIrpf),
    },
  };
}

function resolveRange({ year, quarter, from, to }) {
  if (from || to) {
    return { from: from ? new Date(from) : new Date('2000-01-01'), to: to ? new Date(to) : new Date('2099-12-31') };
  }
  if (quarter) {
    const startMonth = (quarter - 1) * 3;
    return {
      from: new Date(year, startMonth, 1),
      to:   new Date(year, startMonth + 3, 0, 23, 59, 59, 999),
    };
  }
  if (year) {
    return { from: new Date(year, 0, 1), to: new Date(year, 11, 31, 23, 59, 59, 999) };
  }
  const now = new Date();
  return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999) };
}

function rangeLabel(range) {
  const fromY = range.from.getFullYear();
  const toY = range.to.getFullYear();
  if (fromY === toY) {
    const fromM = range.from.getMonth();
    const toM = range.to.getMonth();
    if (fromM === 0 && toM === 11) return `Anual ${fromY}`;
    if (toM - fromM === 2) return `${Math.floor(fromM / 3) + 1}T ${fromY}`;
    return `${range.from.toISOString().slice(0,10)} → ${range.to.toISOString().slice(0,10)}`;
  }
  return `${range.from.toISOString().slice(0,10)} → ${range.to.toISOString().slice(0,10)}`;
}

module.exports = { getVatBookInput, getVatBookOutput, getIrpfBook };
