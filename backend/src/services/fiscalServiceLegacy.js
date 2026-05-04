/**
 * SERVEI DE CÀLCUL FISCAL
 *
 * Calcula els models tributaris a partir de les factures:
 *   - Model 303: Autoliquidació IVA trimestral
 *   - Model 111: Retencions IRPF trimestral
 *   - Model 347: Operacions amb tercers >3.005,06€ (anual)
 *   - Model 349: Operacions intracomunitàries (trimestral)
 *
 * Tots els càlculs es fan sobre factures NO eliminades i NO duplicades.
 */

const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

// Països UE (sense ES) per detectar intracomunitàries
const EU_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'SE',
];

/**
 * Retorna el rang de dates per un trimestre.
 * @param {number} year - Any (ex: 2026)
 * @param {number} quarter - Trimestre (1-4)
 * @returns {{ from: Date, to: Date }}
 */
function getQuarterDates(year, quarter) {
  const startMonth = (quarter - 1) * 3;
  const from = new Date(year, startMonth, 1);
  const to = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  return { from, to };
}

/**
 * Recull factures rebudes del període (no eliminades, no duplicades, no NOT_INVOICE).
 */
async function getReceivedInvoices(from, to) {
  return prisma.receivedInvoice.findMany({
    where: {
      issueDate: { gte: from, lte: to },
      deletedAt: null,
      isDuplicate: false,
      status: { notIn: ['NOT_INVOICE'] },
    },
    include: {
      supplier: { select: { id: true, name: true, nif: true, country: true } },
    },
    orderBy: { issueDate: 'asc' },
  });
}

/**
 * Recull factures emeses del període.
 */
async function getIssuedInvoices(from, to) {
  return prisma.issuedInvoice.findMany({
    where: {
      issueDate: { gte: from, lte: to },
    },
    include: {
      client: { select: { id: true, name: true, nif: true, country: true } },
    },
    orderBy: { issueDate: 'asc' },
  });
}

// ===========================================
// MODEL 303 — Autoliquidació IVA
// ===========================================

/**
 * Calcula el Model 303 (IVA) per un trimestre.
 *
 * IVA Repercutit = IVA de les factures emeses (vendes)
 * IVA Suportat = IVA de les factures rebudes (compres)
 * Resultat = Repercutit - Suportat
 *   Si positiu → a pagar a Hisenda
 *   Si negatiu → a compensar o sol·licitar devolució
 */
async function calculateModel303(year, quarter) {
  const { from, to } = getQuarterDates(year, quarter);

  const [received, issued] = await Promise.all([
    getReceivedInvoices(from, to),
    getIssuedInvoices(from, to),
  ]);

  // IVA Repercutit (vendes) — agrupar per tipus d'IVA
  const repercutit = {};
  let totalBaseRepercutit = 0;
  let totalIvaRepercutit = 0;

  for (const inv of issued) {
    const rate = parseFloat(inv.taxRate) || 0;
    const base = parseFloat(inv.subtotal) || 0;
    const iva = parseFloat(inv.taxAmount) || 0;
    const key = rate.toFixed(0);

    if (!repercutit[key]) repercutit[key] = { rate, base: 0, iva: 0, count: 0 };
    repercutit[key].base += base;
    repercutit[key].iva += iva;
    repercutit[key].count++;
    totalBaseRepercutit += base;
    totalIvaRepercutit += iva;
  }

  // IVA Suportat (compres) — agrupar per tipus d'IVA
  // Excloure proveïdors UE (intracomunitàries no porten IVA espanyol)
  const suportat = {};
  let totalBaseSuportat = 0;
  let totalIvaSuportat = 0;

  for (const inv of received) {
    const supplierCountry = inv.supplier?.country || 'ES';
    // Les factures intracomunitàries no computen IVA suportat normal
    // (es declaren al 349 i amb inversió de subjecte passiu)
    if (EU_COUNTRIES.includes(supplierCountry)) continue;

    const rate = parseFloat(inv.taxRate) || 0;
    const base = parseFloat(inv.subtotal) || 0;
    const iva = parseFloat(inv.taxAmount) || 0;
    const key = rate.toFixed(0);

    if (!suportat[key]) suportat[key] = { rate, base: 0, iva: 0, count: 0 };
    suportat[key].base += base;
    suportat[key].iva += iva;
    suportat[key].count++;
    totalBaseSuportat += base;
    totalIvaSuportat += iva;
  }

  // Inversió subjecte passiu (compres intracomunitàries)
  // S'ha d'incloure com a repercutit I suportat simultàniament (neutralitza)
  let baseIntracomunitaria = 0;
  let ivaIntracomunitaria = 0;
  for (const inv of received) {
    const supplierCountry = inv.supplier?.country || 'ES';
    if (EU_COUNTRIES.includes(supplierCountry)) {
      const base = parseFloat(inv.subtotal) || 0;
      // IVA al 21% per inversió de subjecte passiu
      const iva = base * 0.21;
      baseIntracomunitaria += base;
      ivaIntracomunitaria += iva;
    }
  }

  const resultado = totalIvaRepercutit + ivaIntracomunitaria - totalIvaSuportat - ivaIntracomunitaria;

  return {
    model: '303',
    year,
    quarter,
    period: `${quarter}T ${year}`,
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],

    // IVA Repercutit (Caselles 01-09)
    repercutit: Object.values(repercutit).sort((a, b) => b.rate - a.rate),
    totalBaseRepercutit: round2(totalBaseRepercutit),
    totalIvaRepercutit: round2(totalIvaRepercutit),

    // IVA Suportat (Caselles 28-39)
    suportat: Object.values(suportat).sort((a, b) => b.rate - a.rate),
    totalBaseSuportat: round2(totalBaseSuportat),
    totalIvaSuportat: round2(totalIvaSuportat),

    // Adquisicions intracomunitàries (Casella 10-11)
    intracomunitari: {
      base: round2(baseIntracomunitaria),
      iva: round2(ivaIntracomunitaria),
    },

    // Resultat
    resultado: round2(resultado),
    aPagar: resultado > 0,
    aCompensar: resultado < 0,

    // Estadístiques
    facturesEmeses: issued.length,
    facturesRebudes: received.length,
  };
}

// ===========================================
// MODEL 111 — Retencions IRPF
// ===========================================

/**
 * Calcula el Model 111 (retencions IRPF) per un trimestre.
 *
 * Recull totes les factures rebudes amb IRPF > 0.
 * L'empresa ha de pagar les retencions practicades a Hisenda.
 */
async function calculateModel111(year, quarter) {
  const { from, to } = getQuarterDates(year, quarter);

  const received = await getReceivedInvoices(from, to);

  // Només factures amb retenció IRPF
  const withIrpf = received.filter(inv => parseFloat(inv.irpfAmount) > 0);

  // Agrupar per tipus de retenció
  const retentions = {};
  let totalBase = 0;
  let totalIrpf = 0;

  for (const inv of withIrpf) {
    const rate = parseFloat(inv.irpfRate) || 0;
    const base = parseFloat(inv.subtotal) || 0;
    const irpf = parseFloat(inv.irpfAmount) || 0;
    const key = rate.toFixed(0);

    if (!retentions[key]) retentions[key] = { rate, base: 0, irpf: 0, count: 0, suppliers: new Set() };
    retentions[key].base += base;
    retentions[key].irpf += irpf;
    retentions[key].count++;
    if (inv.supplier?.name) retentions[key].suppliers.add(inv.supplier.name);
    totalBase += base;
    totalIrpf += irpf;
  }

  // Convertir Sets a arrays
  const retentionsList = Object.values(retentions).map(r => ({
    ...r,
    base: round2(r.base),
    irpf: round2(r.irpf),
    suppliers: Array.from(r.suppliers),
  })).sort((a, b) => b.rate - a.rate);

  // Detall per proveïdor
  const bySupplier = {};
  for (const inv of withIrpf) {
    const suppId = inv.supplier?.id || 'desconegut';
    const suppName = inv.supplier?.name || 'Desconegut';
    const suppNif = inv.supplier?.nif || '';
    if (!bySupplier[suppId]) {
      bySupplier[suppId] = { name: suppName, nif: suppNif, base: 0, irpf: 0, count: 0 };
    }
    bySupplier[suppId].base += parseFloat(inv.subtotal) || 0;
    bySupplier[suppId].irpf += parseFloat(inv.irpfAmount) || 0;
    bySupplier[suppId].count++;
  }

  return {
    model: '111',
    year,
    quarter,
    period: `${quarter}T ${year}`,
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],

    // Retencions per tipus
    retentions: retentionsList,
    totalBase: round2(totalBase),
    totalIrpf: round2(totalIrpf),

    // Perceptors (per casella 01 del 111)
    numPerceptors: Object.keys(bySupplier).length,
    perceptors: Object.values(bySupplier).map(s => ({
      ...s,
      base: round2(s.base),
      irpf: round2(s.irpf),
    })).sort((a, b) => b.base - a.base),

    // Total a ingressar
    resultado: round2(totalIrpf),
    facturesAmbIrpf: withIrpf.length,
  };
}

// ===========================================
// MODEL 347 — Operacions amb tercers >3.005,06€
// ===========================================

/**
 * Calcula el Model 347 (anual).
 * Declara operacions amb qualsevol tercer que superin 3.005,06€ l'any.
 */
async function calculateModel347(year) {
  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31, 23, 59, 59, 999);

  const [received, issued] = await Promise.all([
    getReceivedInvoices(from, to),
    getIssuedInvoices(from, to),
  ]);

  const THRESHOLD = 3005.06;

  // Agrupar compres per proveïdor (NIF)
  const suppliers = {};
  for (const inv of received) {
    const nif = inv.supplier?.nif || '';
    if (!nif) continue; // Sense NIF no es pot declarar
    const name = inv.supplier?.name || 'Desconegut';

    if (!suppliers[nif]) {
      suppliers[nif] = {
        nif, name, type: 'B', // B = compres
        total: 0, count: 0,
        q1: 0, q2: 0, q3: 0, q4: 0,
      };
    }
    const total = parseFloat(inv.totalAmount) || 0;
    suppliers[nif].total += total;
    suppliers[nif].count++;

    // Distribuir per trimestre
    const month = new Date(inv.issueDate).getMonth();
    if (month < 3) suppliers[nif].q1 += total;
    else if (month < 6) suppliers[nif].q2 += total;
    else if (month < 9) suppliers[nif].q3 += total;
    else suppliers[nif].q4 += total;
  }

  // Agrupar vendes per client (NIF)
  const clients = {};
  for (const inv of issued) {
    const nif = inv.client?.nif || '';
    if (!nif) continue;
    const name = inv.client?.name || 'Desconegut';

    if (!clients[nif]) {
      clients[nif] = {
        nif, name, type: 'A', // A = vendes
        total: 0, count: 0,
        q1: 0, q2: 0, q3: 0, q4: 0,
      };
    }
    const total = parseFloat(inv.totalAmount) || 0;
    clients[nif].total += total;
    clients[nif].count++;

    const month = new Date(inv.issueDate).getMonth();
    if (month < 3) clients[nif].q1 += total;
    else if (month < 6) clients[nif].q2 += total;
    else if (month < 9) clients[nif].q3 += total;
    else clients[nif].q4 += total;
  }

  // Filtrar per llindar
  const declarables = [
    ...Object.values(suppliers).filter(s => Math.abs(s.total) >= THRESHOLD),
    ...Object.values(clients).filter(c => Math.abs(c.total) >= THRESHOLD),
  ].map(d => ({
    ...d,
    total: round2(d.total),
    q1: round2(d.q1),
    q2: round2(d.q2),
    q3: round2(d.q3),
    q4: round2(d.q4),
  })).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  // Resum de qui no arriba al llindar (per informació)
  const belowThreshold = {
    suppliers: Object.values(suppliers).filter(s => Math.abs(s.total) < THRESHOLD).length,
    clients: Object.values(clients).filter(c => Math.abs(c.total) < THRESHOLD).length,
  };

  return {
    model: '347',
    year,
    period: `Anual ${year}`,

    declarables,
    numDeclarables: declarables.length,
    totalCompres: round2(declarables.filter(d => d.type === 'B').reduce((s, d) => s + d.total, 0)),
    totalVendes: round2(declarables.filter(d => d.type === 'A').reduce((s, d) => s + d.total, 0)),
    belowThreshold,
  };
}

// ===========================================
// MODEL 349 — Operacions intracomunitàries
// ===========================================

/**
 * Calcula el Model 349 (trimestral).
 * Declara compres i vendes a/de empreses de la UE.
 */
async function calculateModel349(year, quarter) {
  const { from, to } = getQuarterDates(year, quarter);

  const [received, issued] = await Promise.all([
    getReceivedInvoices(from, to),
    getIssuedInvoices(from, to),
  ]);

  // Compres intracomunitàries (proveïdors UE)
  const acquisitions = {};
  for (const inv of received) {
    const country = inv.supplier?.country || 'ES';
    if (!EU_COUNTRIES.includes(country)) continue;

    const nif = inv.supplier?.nif || '';
    const name = inv.supplier?.name || 'Desconegut';
    const key = nif || name;

    if (!acquisitions[key]) {
      acquisitions[key] = {
        nif, name, country,
        type: 'A', // A = Adquisicions intracomunitàries de béns
        base: 0, count: 0,
      };
    }
    acquisitions[key].base += parseFloat(inv.subtotal) || 0;
    acquisitions[key].count++;
  }

  // Vendes intracomunitàries (clients UE)
  const deliveries = {};
  for (const inv of issued) {
    const country = inv.client?.country || 'ES';
    if (!EU_COUNTRIES.includes(country)) continue;

    const nif = inv.client?.nif || '';
    const name = inv.client?.name || 'Desconegut';
    const key = nif || name;

    if (!deliveries[key]) {
      deliveries[key] = {
        nif, name, country,
        type: 'E', // E = Lliuraments intracomunitaris de béns
        base: 0, count: 0,
      };
    }
    deliveries[key].base += parseFloat(inv.subtotal) || 0;
    deliveries[key].count++;
  }

  const allOps = [
    ...Object.values(acquisitions),
    ...Object.values(deliveries),
  ].map(d => ({ ...d, base: round2(d.base) }))
    .sort((a, b) => Math.abs(b.base) - Math.abs(a.base));

  return {
    model: '349',
    year,
    quarter,
    period: `${quarter}T ${year}`,
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],

    operations: allOps,
    numOperations: allOps.length,
    totalAdquisicions: round2(allOps.filter(o => o.type === 'A').reduce((s, o) => s + o.base, 0)),
    totalLliuraments: round2(allOps.filter(o => o.type === 'E').reduce((s, o) => s + o.base, 0)),
  };
}

// ===========================================
// Resum fiscal trimestral
// ===========================================

/**
 * Calcula un resum de tots els models per un trimestre.
 */
async function calculateQuarterSummary(year, quarter) {
  const [m303, m111, m349] = await Promise.all([
    calculateModel303(year, quarter),
    calculateModel111(year, quarter),
    calculateModel349(year, quarter),
  ]);

  return {
    year,
    quarter,
    period: `${quarter}T ${year}`,
    models: {
      m303: {
        resultado: m303.resultado,
        aPagar: m303.aPagar,
        facturesEmeses: m303.facturesEmeses,
        facturesRebudes: m303.facturesRebudes,
      },
      m111: {
        resultado: m111.resultado,
        facturesAmbIrpf: m111.facturesAmbIrpf,
        numPerceptors: m111.numPerceptors,
      },
      m349: {
        numOperations: m349.numOperations,
        totalAdquisicions: m349.totalAdquisicions,
        totalLliuraments: m349.totalLliuraments,
      },
    },
  };
}

/**
 * Resum anual amb tots els trimestres + Model 347.
 */
async function calculateYearSummary(year) {
  const quarters = await Promise.all([1, 2, 3, 4].map(q => calculateQuarterSummary(year, q)));
  const m347 = await calculateModel347(year);

  return {
    year,
    quarters,
    m347: {
      numDeclarables: m347.numDeclarables,
      totalCompres: m347.totalCompres,
      totalVendes: m347.totalVendes,
    },
  };
}

// ===========================================
// Utils
// ===========================================

function round2(num) {
  return Math.round(num * 100) / 100;
}

module.exports = {
  calculateModel303,
  calculateModel111,
  calculateModel347,
  calculateModel349,
  calculateQuarterSummary,
  calculateYearSummary,
  getQuarterDates,
};
