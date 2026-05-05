/**
 * fiscalService — Càlcul dels models tributaris (Sprint 5).
 *
 * Reescrit per agafar les dades del **Llibre Diari** (journal_lines amb
 * assentaments POSTED) en lloc de directament de les factures, com a font
 * única de veritat per a la comptabilitat formal.
 *
 *   - 303 (IVA trimestral):  línies amb account.code que comença per 472
 *                            (suportat) o 477 (repercutit).
 *   - 390 (IVA anual):       agregació dels 4 trimestres del 303.
 *   - 111 (IRPF trimestral): línies amb account.code 4751 (retencions
 *                            practicades) o irpfBase > 0.
 *   - 347 (operacions amb tercers > 3.005,06€): des de invoices
 *                            comptabilitzades (necessita NIF/nom).
 *   - 349 (intracomunitàries): des de invoices comptabilitzades amb
 *                            supplier/client de país UE.
 *
 * Una factura no comptabilitzada NO surt als models — és el comportament
 * correcte d'una comptabilitat formal.
 *
 * Manteniment del fiscalServiceLegacy.js (basat en factures directes) per
 * a verificació creuada durant la transició.
 */

const { prisma } = require('../config/database');

// Països UE (sense ES) per detectar intracomunitàries
const EU_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'SE',
];

const ACCOUNT_PREFIX_VAT_INPUT  = '472';
const ACCOUNT_PREFIX_VAT_OUTPUT = '477';
const ACCOUNT_CODE_IRPF         = '4751';

function round2(num) { return Math.round(num * 100) / 100; }
function n(v) { return v == null ? 0 : Number(v); }

function getQuarterDates(year, quarter) {
  const startMonth = (quarter - 1) * 3;
  const from = new Date(year, startMonth, 1);
  const to = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  return { from, to };
}

/**
 * Resol l'empresa per defecte (al MVP n'hi ha una sola).
 */
async function resolveCompanyId() {
  const c = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  return c?.id || null;
}

/**
 * Llegeix les línies POSTED d'un període que toquen comptes de IVA o IRPF.
 */
async function getFiscalLines(companyId, from, to, prefixOrCode) {
  return prisma.journalLine.findMany({
    where: {
      account: {
        companyId,
        OR: prefixOrCode.map((p) => p.length === 4
          ? { code: p }
          : { code: { startsWith: p } }),
      },
      journalEntry: {
        status: 'POSTED',
        date: { gte: from, lte: to },
      },
    },
    include: {
      account: { select: { code: true, name: true } },
      journalEntry: { select: { id: true, entryNumber: true, date: true, description: true, sourceRef: true, type: true } },
    },
    orderBy: [{ journalEntry: { date: 'asc' } }, { sortOrder: 'asc' }],
  });
}

/**
 * Recull factures comptabilitzades del període (per al 347/349).
 */
async function getPostedReceivedInvoices(from, to) {
  return prisma.receivedInvoice.findMany({
    where: {
      issueDate: { gte: from, lte: to },
      deletedAt: null,
      isDuplicate: false,
      journalEntryId: { not: null },
    },
    include: { supplier: { select: { id: true, name: true, nif: true, country: true } } },
    orderBy: { issueDate: 'asc' },
  });
}

async function getPostedIssuedInvoices(from, to) {
  return prisma.issuedInvoice.findMany({
    where: {
      issueDate: { gte: from, lte: to },
      journalEntryId: { not: null },
    },
    include: { client: { select: { id: true, name: true, nif: true, country: true } } },
    orderBy: { issueDate: 'asc' },
  });
}

// =========================================================================
// MODEL 303 — Autoliquidació IVA trimestral
// =========================================================================
async function calculateModel303(year, quarter) {
  const { from, to } = getQuarterDates(year, quarter);
  const companyId = await resolveCompanyId();
  if (!companyId) return emptyModel303(year, quarter, from, to);

  // IVA repercutit (vendes): línies amb compte 477xxx
  const linesOutput = await getFiscalLines(companyId, from, to, [ACCOUNT_PREFIX_VAT_OUTPUT]);

  const repercutit = {};
  let totalBaseRepercutit = 0;
  let totalIvaRepercutit = 0;
  for (const l of linesOutput) {
    const rate = n(l.vatRate);
    const base = n(l.vatBase);
    const iva  = n(l.credit) - n(l.debit);  // per repercutit = haver
    if (base === 0 && iva === 0) continue;
    const key = rate.toFixed(0);
    if (!repercutit[key]) repercutit[key] = { rate, base: 0, iva: 0, count: 0 };
    repercutit[key].base += base;
    repercutit[key].iva += iva;
    repercutit[key].count++;
    totalBaseRepercutit += base;
    totalIvaRepercutit  += iva;
  }

  // IVA suportat (compres): línies amb compte 472xxx
  const linesInput = await getFiscalLines(companyId, from, to, [ACCOUNT_PREFIX_VAT_INPUT]);

  const suportat = {};
  let totalBaseSuportat = 0;
  let totalIvaSuportat  = 0;
  for (const l of linesInput) {
    const rate = n(l.vatRate);
    const base = n(l.vatBase);
    const iva  = n(l.debit) - n(l.credit);  // per suportat = deure
    if (base === 0 && iva === 0) continue;
    const key = rate.toFixed(0);
    if (!suportat[key]) suportat[key] = { rate, base: 0, iva: 0, count: 0 };
    suportat[key].base += base;
    suportat[key].iva += iva;
    suportat[key].count++;
    totalBaseSuportat += base;
    totalIvaSuportat  += iva;
  }

  // Adquisicions intracomunitàries (inversió subjecte passiu):
  // des de invoices comptabilitzades amb proveïdor UE.
  // L'IVA s'autoliquida al tipus que correspongui al producte (21% general,
  // 10% reduït, 4% superreduït). Si la factura té `taxRate` el respectem;
  // sino caiem a 21% per defecte (tipus general).
  const received = await getPostedReceivedInvoices(from, to);
  let baseIntracomunitaria = 0;
  let ivaIntracomunitaria  = 0;
  for (const inv of received) {
    const country = inv.supplier?.country || 'ES';
    if (!EU_COUNTRIES.includes(country)) continue;
    const base = n(inv.subtotal);
    const rate = n(inv.taxRate) > 0 ? n(inv.taxRate) / 100 : 0.21;
    baseIntracomunitaria += base;
    ivaIntracomunitaria  += base * rate;
  }

  // Resultat = repercutit - suportat
  // L'inversió de subjecte passiu suma a tots dos i es neutralitza
  const resultado = totalIvaRepercutit - totalIvaSuportat;

  // Comptabilitzar nº factures POSTED del període per estadística
  const issuedCount = await prisma.issuedInvoice.count({
    where: { issueDate: { gte: from, lte: to }, journalEntryId: { not: null } },
  });
  const receivedCount = received.length;

  return {
    model: '303',
    year, quarter,
    period: `${quarter}T ${year}`,
    from: from.toISOString().split('T')[0],
    to:   to.toISOString().split('T')[0],
    repercutit: Object.values(repercutit).map((r) => ({
      ...r, base: round2(r.base), iva: round2(r.iva),
    })).sort((a, b) => b.rate - a.rate),
    totalBaseRepercutit: round2(totalBaseRepercutit),
    totalIvaRepercutit:  round2(totalIvaRepercutit),
    suportat: Object.values(suportat).map((s) => ({
      ...s, base: round2(s.base), iva: round2(s.iva),
    })).sort((a, b) => b.rate - a.rate),
    totalBaseSuportat: round2(totalBaseSuportat),
    totalIvaSuportat:  round2(totalIvaSuportat),
    intracomunitari: {
      base: round2(baseIntracomunitaria),
      iva:  round2(ivaIntracomunitaria),
    },
    resultado: round2(resultado),
    aPagar:    resultado > 0,
    aCompensar: resultado < 0,
    facturesEmeses:  issuedCount,
    facturesRebudes: receivedCount,
    source: 'JOURNAL',
  };
}

function emptyModel303(year, quarter, from, to) {
  return {
    model: '303', year, quarter,
    period: `${quarter}T ${year}`,
    from: from.toISOString().split('T')[0],
    to:   to.toISOString().split('T')[0],
    repercutit: [], totalBaseRepercutit: 0, totalIvaRepercutit: 0,
    suportat: [],   totalBaseSuportat: 0,   totalIvaSuportat: 0,
    intracomunitari: { base: 0, iva: 0 },
    resultado: 0, aPagar: false, aCompensar: false,
    facturesEmeses: 0, facturesRebudes: 0,
    source: 'JOURNAL',
    note: 'Sense empresa configurada o sense assentaments al període',
  };
}

// =========================================================================
// MODEL 390 — Resum anual IVA (4 trimestres del 303)
// =========================================================================
async function calculateModel390(year) {
  const quarters = await Promise.all([1, 2, 3, 4].map((q) => calculateModel303(year, q)));

  // Agregar tots els tipus d'IVA
  const aggBy = (key) => {
    const map = {};
    for (const q of quarters) {
      for (const r of q[key]) {
        const k = r.rate.toFixed(0);
        if (!map[k]) map[k] = { rate: r.rate, base: 0, iva: 0, count: 0 };
        map[k].base += r.base;
        map[k].iva  += r.iva;
        map[k].count += r.count;
      }
    }
    return Object.values(map).map((r) => ({
      ...r, base: round2(r.base), iva: round2(r.iva),
    })).sort((a, b) => b.rate - a.rate);
  };

  const repercutit = aggBy('repercutit');
  const suportat   = aggBy('suportat');

  const totalBaseRepercutit = round2(repercutit.reduce((s, r) => s + r.base, 0));
  const totalIvaRepercutit  = round2(repercutit.reduce((s, r) => s + r.iva,  0));
  const totalBaseSuportat   = round2(suportat.reduce(  (s, r) => s + r.base, 0));
  const totalIvaSuportat    = round2(suportat.reduce(  (s, r) => s + r.iva,  0));
  const totalIntracomBase   = round2(quarters.reduce(  (s, q) => s + q.intracomunitari.base, 0));
  const totalIntracomIva    = round2(quarters.reduce(  (s, q) => s + q.intracomunitari.iva,  0));
  const resultado           = round2(totalIvaRepercutit - totalIvaSuportat);

  return {
    model: '390',
    year,
    period: `Anual ${year}`,
    quarters: quarters.map((q) => ({
      quarter: q.quarter,
      totalIvaRepercutit: q.totalIvaRepercutit,
      totalIvaSuportat:  q.totalIvaSuportat,
      resultado: q.resultado,
    })),
    repercutit, suportat,
    totalBaseRepercutit, totalIvaRepercutit,
    totalBaseSuportat,   totalIvaSuportat,
    intracomunitari: { base: totalIntracomBase, iva: totalIntracomIva },
    resultado,
    aPagar: resultado > 0,
    source: 'JOURNAL',
  };
}

// =========================================================================
// MODEL 111 — Retencions IRPF trimestral
// =========================================================================
async function calculateModel111(year, quarter) {
  const { from, to } = getQuarterDates(year, quarter);
  const companyId = await resolveCompanyId();
  if (!companyId) return emptyModel111(year, quarter, from, to);

  // Línies amb compte 4751 (H.P. retencions practicades) — generalment al haver
  const lines = await getFiscalLines(companyId, from, to, [ACCOUNT_CODE_IRPF]);

  const retentions = {};
  let totalBase = 0;
  let totalIrpf = 0;

  for (const l of lines) {
    const rate = n(l.irpfRate);
    const base = n(l.irpfBase);
    const irpf = n(l.credit) - n(l.debit);  // retencions practicades = haver
    if (base === 0 && irpf === 0) continue;
    const key = rate.toFixed(0);
    if (!retentions[key]) retentions[key] = { rate, base: 0, irpf: 0, count: 0 };
    retentions[key].base += base;
    retentions[key].irpf += irpf;
    retentions[key].count++;
    totalBase += base;
    totalIrpf += irpf;
  }

  // Detall per perceptor (proveïdor): incloem invoices comptabilitzades amb IRPF > 0
  const received = await getPostedReceivedInvoices(from, to);
  const bySupplier = {};
  for (const inv of received) {
    if (n(inv.irpfAmount) <= 0) continue;
    const sid = inv.supplier?.id || 'desconegut';
    if (!bySupplier[sid]) {
      bySupplier[sid] = { name: inv.supplier?.name || 'Desconegut', nif: inv.supplier?.nif || '', base: 0, irpf: 0, count: 0 };
    }
    bySupplier[sid].base += n(inv.subtotal);
    bySupplier[sid].irpf += n(inv.irpfAmount);
    bySupplier[sid].count++;
  }

  return {
    model: '111',
    year, quarter,
    period: `${quarter}T ${year}`,
    from: from.toISOString().split('T')[0],
    to:   to.toISOString().split('T')[0],
    retentions: Object.values(retentions).map((r) => ({
      ...r, base: round2(r.base), irpf: round2(r.irpf),
    })).sort((a, b) => b.rate - a.rate),
    totalBase: round2(totalBase),
    totalIrpf: round2(totalIrpf),
    numPerceptors: Object.keys(bySupplier).length,
    perceptors: Object.values(bySupplier).map((s) => ({
      ...s, base: round2(s.base), irpf: round2(s.irpf),
    })).sort((a, b) => b.base - a.base),
    resultado: round2(totalIrpf),
    facturesAmbIrpf: Object.values(bySupplier).reduce((s, p) => s + p.count, 0),
    source: 'JOURNAL',
  };
}

function emptyModel111(year, quarter, from, to) {
  return {
    model: '111', year, quarter,
    period: `${quarter}T ${year}`,
    from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0],
    retentions: [], totalBase: 0, totalIrpf: 0,
    numPerceptors: 0, perceptors: [],
    resultado: 0, facturesAmbIrpf: 0,
    source: 'JOURNAL',
    note: 'Sense empresa configurada',
  };
}

// =========================================================================
// MODEL 347 — Operacions amb tercers > 3.005,06€ (anual)
// =========================================================================
async function calculateModel347(year) {
  const from = new Date(year, 0, 1);
  const to   = new Date(year, 11, 31, 23, 59, 59, 999);

  const [received, issued] = await Promise.all([
    getPostedReceivedInvoices(from, to),
    getPostedIssuedInvoices(from, to),
  ]);

  const THRESHOLD = 3005.06;

  const suppliers = {};
  for (const inv of received) {
    const nif = inv.supplier?.nif || ''; if (!nif) continue;
    if (!suppliers[nif]) suppliers[nif] = { nif, name: inv.supplier.name, type: 'B', total: 0, count: 0, q1: 0, q2: 0, q3: 0, q4: 0 };
    const total = n(inv.totalAmount);
    suppliers[nif].total += total;
    suppliers[nif].count++;
    const m = inv.issueDate.getMonth();
    if (m < 3) suppliers[nif].q1 += total;
    else if (m < 6) suppliers[nif].q2 += total;
    else if (m < 9) suppliers[nif].q3 += total;
    else suppliers[nif].q4 += total;
  }

  const clients = {};
  for (const inv of issued) {
    const nif = inv.client?.nif || ''; if (!nif) continue;
    if (!clients[nif]) clients[nif] = { nif, name: inv.client.name, type: 'A', total: 0, count: 0, q1: 0, q2: 0, q3: 0, q4: 0 };
    const total = n(inv.totalAmount);
    clients[nif].total += total;
    clients[nif].count++;
    const m = inv.issueDate.getMonth();
    if (m < 3) clients[nif].q1 += total;
    else if (m < 6) clients[nif].q2 += total;
    else if (m < 9) clients[nif].q3 += total;
    else clients[nif].q4 += total;
  }

  const declarables = [
    ...Object.values(suppliers).filter((s) => Math.abs(s.total) >= THRESHOLD),
    ...Object.values(clients).filter((c) => Math.abs(c.total) >= THRESHOLD),
  ].map((d) => ({
    ...d,
    total: round2(d.total),
    q1: round2(d.q1), q2: round2(d.q2), q3: round2(d.q3), q4: round2(d.q4),
  })).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  return {
    model: '347', year,
    period: `Anual ${year}`,
    declarables,
    numDeclarables: declarables.length,
    totalCompres: round2(declarables.filter((d) => d.type === 'B').reduce((s, d) => s + d.total, 0)),
    totalVendes:  round2(declarables.filter((d) => d.type === 'A').reduce((s, d) => s + d.total, 0)),
    belowThreshold: {
      suppliers: Object.values(suppliers).filter((s) => Math.abs(s.total) < THRESHOLD).length,
      clients:   Object.values(clients).filter((c) => Math.abs(c.total) < THRESHOLD).length,
    },
    source: 'JOURNAL',
  };
}

// =========================================================================
// MODEL 349 — Operacions intracomunitàries (trimestral)
// =========================================================================
async function calculateModel349(year, quarter) {
  const { from, to } = getQuarterDates(year, quarter);
  const [received, issued] = await Promise.all([
    getPostedReceivedInvoices(from, to),
    getPostedIssuedInvoices(from, to),
  ]);

  const acquisitions = {};
  for (const inv of received) {
    const country = inv.supplier?.country || 'ES';
    if (!EU_COUNTRIES.includes(country)) continue;
    const key = inv.supplier?.nif || inv.supplier?.name || 'desconegut';
    if (!acquisitions[key]) acquisitions[key] = { nif: inv.supplier?.nif || '', name: inv.supplier?.name || 'Desconegut', country, type: 'A', base: 0, count: 0 };
    acquisitions[key].base += n(inv.subtotal);
    acquisitions[key].count++;
  }

  const deliveries = {};
  for (const inv of issued) {
    const country = inv.client?.country || 'ES';
    if (!EU_COUNTRIES.includes(country)) continue;
    const key = inv.client?.nif || inv.client?.name || 'desconegut';
    if (!deliveries[key]) deliveries[key] = { nif: inv.client?.nif || '', name: inv.client?.name || 'Desconegut', country, type: 'E', base: 0, count: 0 };
    deliveries[key].base += n(inv.subtotal);
    deliveries[key].count++;
  }

  const allOps = [...Object.values(acquisitions), ...Object.values(deliveries)]
    .map((d) => ({ ...d, base: round2(d.base) }))
    .sort((a, b) => Math.abs(b.base) - Math.abs(a.base));

  return {
    model: '349', year, quarter,
    period: `${quarter}T ${year}`,
    from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0],
    operations: allOps,
    numOperations: allOps.length,
    totalAdquisicions: round2(allOps.filter((o) => o.type === 'A').reduce((s, o) => s + o.base, 0)),
    totalLliuraments: round2(allOps.filter((o) => o.type === 'E').reduce((s, o) => s + o.base, 0)),
    source: 'JOURNAL',
  };
}

// =========================================================================
// Resums
// =========================================================================
async function calculateQuarterSummary(year, quarter) {
  const [m303, m111, m349] = await Promise.all([
    calculateModel303(year, quarter),
    calculateModel111(year, quarter),
    calculateModel349(year, quarter),
  ]);
  return {
    year, quarter, period: `${quarter}T ${year}`,
    models: {
      m303: { resultado: m303.resultado, aPagar: m303.aPagar, facturesEmeses: m303.facturesEmeses, facturesRebudes: m303.facturesRebudes },
      m111: { resultado: m111.resultado, facturesAmbIrpf: m111.facturesAmbIrpf, numPerceptors: m111.numPerceptors },
      m349: { numOperations: m349.numOperations, totalAdquisicions: m349.totalAdquisicions, totalLliuraments: m349.totalLliuraments },
    },
  };
}

async function calculateYearSummary(year) {
  const quarters = await Promise.all([1, 2, 3, 4].map((q) => calculateQuarterSummary(year, q)));
  const m347 = await calculateModel347(year);
  return {
    year, quarters,
    m347: { numDeclarables: m347.numDeclarables, totalCompres: m347.totalCompres, totalVendes: m347.totalVendes },
  };
}

module.exports = {
  calculateModel303,
  calculateModel390,
  calculateModel111,
  calculateModel347,
  calculateModel349,
  calculateQuarterSummary,
  calculateYearSummary,
  getQuarterDates,
};
