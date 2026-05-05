/**
 * closingService — Tancament d'exercici (Sprint 7).
 *
 * Procés guiat en 4 passos (es poden fer per separat):
 *   1. Checklist  — verificacions prèvies (factures comptabilitzades, conciliacions
 *                   pendents, amortitzacions del 12è mes, diari quadrat, no DRAFT).
 *   2. Regularització IVA Q4  — saldo 472/477 → 4750/4709 (segons resultat).
 *   3. Càlcul i comptabilització de l'Impost de societats  — Resultat × tipus + ajustos.
 *   4. Tancament definitiu  — regularització grups 6/7 → 129, traspàs a 120/121,
 *                              FiscalYear.locked=true, obertura del següent exercici.
 *
 * Tots els assentaments generats són POSTED amb type='YEAR_CLOSING' o 'TAX_ACCRUAL'
 * i source='AUTO_CLOSING'. L'obertura del següent exercici és type='YEAR_OPENING'.
 */
const { prisma } = require('../config/database');
const journalService = require('./journalService');

function n(v) { return v == null ? 0 : Number(v); }
function round2(v) { return Math.round(v * 100) / 100; }

async function resolveCompany() {
  const c = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!c) throw new Error('Cap empresa configurada');
  return c;
}

async function getFiscalYear(year, companyId) {
  const fy = await prisma.fiscalYear.findUnique({
    where: { companyId_year: { companyId, year } },
    include: { lockedBy: { select: { name: true } } },
  });
  if (!fy) throw new Error(`L'exercici ${year} no existeix. Crea'l primer.`);
  return fy;
}

async function getAccount(companyId, code) {
  const acc = await prisma.chartOfAccount.findUnique({ where: { companyId_code: { companyId, code } } });
  if (!acc) throw new Error(`Falta el compte ${code} al pla. Executa el seed PGC.`);
  return acc;
}

/**
 * Saldo (debit-credit) d'un compte al període [from, to] sumant només
 * journal_lines de assentaments POSTED.
 *
 * Si `from` és null/undefined, agafa des del principi (saldo acumulat fins
 * a `to`). Útil per regularitzacions on cal incloure saldos arrossegats
 * d'obertura encara que no caiguin dins el rang del FY.
 */
async function getAccountBalance(accountId, from, to) {
  const dateFilter = {};
  if (from) dateFilter.gte = from;
  if (to) dateFilter.lte = to;
  const lines = await prisma.journalLine.findMany({
    where: {
      accountId,
      journalEntry: {
        status: 'POSTED',
        ...(Object.keys(dateFilter).length > 0 && { date: dateFilter }),
      },
    },
    select: { debit: true, credit: true },
  });
  let debit = 0, credit = 0;
  for (const l of lines) {
    debit += n(l.debit);
    credit += n(l.credit);
  }
  return { debit: round2(debit), credit: round2(credit), balance: round2(debit - credit) };
}

/**
 * Saldos agrupats per compte per als comptes amb codi que comença per un prefix.
 * Retorna [{ accountId, code, name, debit, credit, balance }].
 */
async function getBalancesByPrefix(companyId, prefix, from, to) {
  const accounts = await prisma.chartOfAccount.findMany({
    where: { companyId, code: { startsWith: prefix }, isLeaf: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
  const out = [];
  for (const a of accounts) {
    const b = await getAccountBalance(a.id, from, to);
    if (b.debit !== 0 || b.credit !== 0) out.push({ accountId: a.id, code: a.code, name: a.name, ...b });
  }
  return out;
}

// =========================================================================
// PAS 1 — Checklist
// =========================================================================
async function getChecklist(year) {
  const company = await resolveCompany();
  const fy = await getFiscalYear(year, company.id);
  const from = fy.startDate;
  const to = fy.endDate;

  const [
    invoicesPendingPost,
    bankPendingPost,
    draftEntries,
    pendingAmortizationsLast,
    trialBalance,
  ] = await Promise.all([
    prisma.receivedInvoice.count({
      where: {
        deletedAt: null,
        journalEntryId: null,
        origin: { not: 'LOGISTIK' },
        status: { in: ['REVIEWED', 'APPROVED', 'PAID', 'PARTIALLY_PAID'] },
        issueDate: { gte: from, lte: to },
      },
    }),
    prisma.bankMovement.count({
      where: {
        journalEntryId: null,
        isDismissed: false,
        date: { gte: from, lte: to },
        conciliations: { some: { status: 'CONFIRMED' } },
      },
    }),
    prisma.journalEntry.count({
      where: { fiscalYearId: fy.id, status: 'DRAFT' },
    }),
    // Inclou amortitzacions pendents de qualsevol mes d'aquest any I anys
    // anteriors (poden quedar amortitzacions de novembre/desembre any
    // anterior pendents quan no es va tancar correctament).
    prisma.amortizationEntry.count({
      where: {
        OR: [
          { year, status: 'PENDING' },
          { year: { lt: year }, status: 'PENDING' },
        ],
        fixedAsset: { status: 'ACTIVE' },
      },
    }),
    computeTrialBalanceTotals(company.id, from, to),
  ]);

  const items = [
    { id: 'invoices', label: 'Totes les factures REVIEWED+ comptabilitzades', ok: invoicesPendingPost === 0, count: invoicesPendingPost, hint: 'Vés a Facturació → Factures rebudes i comptabilitza les pendents.' },
    { id: 'bank', label: 'Totes les conciliacions confirmades comptabilitzades', ok: bankPendingPost === 0, count: bankPendingPost, hint: 'Vés a Moviments bancaris i prem "Comptabilitzar" o reaplica les conciliacions.' },
    { id: 'drafts', label: 'No queden assentaments en esborrany', ok: draftEntries === 0, count: draftEntries, hint: 'Vés al Llibre Diari, filtra per estat DRAFT i comptabilitza\'ls o esborra\'ls.' },
    { id: 'amort', label: 'Totes les amortitzacions del desembre comptabilitzades', ok: pendingAmortizationsLast === 0, count: pendingAmortizationsLast, hint: 'Vés a Amortitzacions, mes 12, i clica "Comptabilitzar".' },
    { id: 'balance', label: 'Sumes i saldos del diari quadren', ok: trialBalance.balanced, debit: trialBalance.debit, credit: trialBalance.credit, hint: 'Si no quadra, hi ha un assentament malformat. Revisa el Llibre Diari.' },
  ];

  return {
    year,
    fiscalYearId: fy.id,
    locked: fy.locked,
    status: fy.status,
    allOk: items.every((i) => i.ok),
    items,
  };
}

async function computeTrialBalanceTotals(companyId, from, to) {
  const lines = await prisma.journalLine.findMany({
    where: {
      journalEntry: { companyId, status: 'POSTED', date: { gte: from, lte: to } },
    },
    select: { debit: true, credit: true },
  });
  let debit = 0, credit = 0;
  for (const l of lines) { debit += n(l.debit); credit += n(l.credit); }
  return { debit: round2(debit), credit: round2(credit), balanced: Math.abs(debit - credit) < 0.01 };
}

// =========================================================================
// PAS 2 — Regularització IVA del Q4
// =========================================================================
async function regularizeVat(year, userId) {
  const company = await resolveCompany();
  const fy = await getFiscalYear(year, company.id);
  if (fy.locked) throw new Error('Exercici bloquejat');

  // Comprovar si ja existeix una regularització anterior (sourceRef = 'YEAR_VAT_<year>')
  const existing = await prisma.journalEntry.findFirst({
    where: { companyId: company.id, fiscalYearId: fy.id, sourceRef: `YEAR_VAT_${year}` },
  });
  if (existing) throw new Error(`La regularització d'IVA del ${year} ja està feta (assentament #${existing.entryNumber})`);

  // Calcular saldos acumulats fins al 31/12 (passem null com a `from` per
  // capturar també saldos arrossegats d'obertura, que poden ser fora del rang
  // [fy.startDate, fy.endDate] però rellevants per la regularització).
  const acc472 = await getAccount(company.id, '472000');
  const acc477 = await getAccount(company.id, '477000');
  const bal472 = await getAccountBalance(acc472.id, null, fy.endDate);  // saldo deutor (suportat)
  const bal477 = await getAccountBalance(acc477.id, null, fy.endDate);  // saldo creditor (repercutit)

  const ivaSuportat   = round2(bal472.debit - bal472.credit);   // > 0 si encara hi ha IVA suportat
  const ivaRepercutit = round2(bal477.credit - bal477.debit);   // > 0 si encara hi ha IVA repercutit
  const diferencia    = round2(ivaRepercutit - ivaSuportat);

  if (Math.abs(ivaSuportat) < 0.01 && Math.abs(ivaRepercutit) < 0.01) {
    throw new Error('Sense moviments d\'IVA al període: no cal regularitzar.');
  }

  const lines = [];
  if (ivaRepercutit > 0) {
    lines.push({ accountId: acc477.id, debit: ivaRepercutit, credit: 0, description: `Regularització IVA repercutit ${year}`, sortOrder: 0 });
  }
  if (ivaSuportat > 0) {
    lines.push({ accountId: acc472.id, debit: 0, credit: ivaSuportat, description: `Regularització IVA suportat ${year}`, sortOrder: 1 });
  }
  if (diferencia > 0) {
    // A pagar: 4750 H.P. creditora per IVA
    const acc4750 = await getAccount(company.id, '4750');
    lines.push({ accountId: acc4750.id, debit: 0, credit: diferencia, description: `IVA a ingressar ${year}`, sortOrder: 2 });
  } else if (diferencia < 0) {
    // A tornar/compensar: 4709 H.P. deutora per IVA
    const acc4709 = await getAccount(company.id, '4709');
    lines.push({ accountId: acc4709.id, debit: -diferencia, credit: 0, description: `IVA a compensar/devolució ${year}`, sortOrder: 2 });
  }

  const draft = await journalService.createDraft({
    companyId: company.id,
    date: fy.endDate,
    description: `Regularització IVA exercici ${year}`,
    type: 'TAX_ACCRUAL',
    source: 'AUTO_CLOSING',
    sourceRef: `YEAR_VAT_${year}`,
    lines,
    createdById: userId,
  });
  return await journalService.post(draft.id, userId);
}

// =========================================================================
// PAS 3 — Impost de societats
// =========================================================================
async function previewCorporateTax(year) {
  const company = await resolveCompany();
  const fy = await getFiscalYear(year, company.id);

  // Resultat = SUM(Grup 7) - SUM(Grup 6 excloent 630)
  const incomes = await getBalancesByPrefix(company.id, '7', fy.startDate, fy.endDate);
  const expenses = await getBalancesByPrefix(company.id, '6', fy.startDate, fy.endDate);

  const totalIncomes  = round2(incomes.reduce((s, a) => s + (a.credit - a.debit), 0));
  const totalExpenses = round2(expenses
    .filter((a) => !a.code.startsWith('630'))   // excloem 630 (impost beneficis ja comptabilitzat)
    .reduce((s, a) => s + (a.debit - a.credit), 0));

  const resultBeforeTax = round2(totalIncomes - totalExpenses);

  // Càlcul simplificat: tipus IS de la company per defecte 25%
  const taxRate = n(company.corporateTaxRate);
  const taxBase = resultBeforeTax > 0 ? resultBeforeTax : 0;  // si pèrdua, no hi ha quota
  const grossTax = round2(taxBase * (taxRate / 100));

  return {
    year,
    fiscalYearId: fy.id,
    incomes,
    expenses: expenses.filter((a) => !a.code.startsWith('630')),
    totalIncomes,
    totalExpenses,
    resultBeforeTax,
    taxRate,
    taxBase,
    grossTax,
    note: resultBeforeTax <= 0 ? 'Resultat nul o negatiu: no es genera quota d\'IS.' : null,
  };
}

async function postCorporateTax(year, userId, opts = {}) {
  const company = await resolveCompany();
  const fy = await getFiscalYear(year, company.id);
  if (fy.locked) throw new Error('Exercici bloquejat');

  const existing = await prisma.journalEntry.findFirst({
    where: { companyId: company.id, fiscalYearId: fy.id, sourceRef: `YEAR_IS_${year}` },
  });
  if (existing) throw new Error(`L'IS del ${year} ja està comptabilitzat (assentament #${existing.entryNumber})`);

  const preview = await previewCorporateTax(year);
  // Permetre ajustos manuals (positius o negatius sobre la base, p.ex. BIN, deduccions)
  const adjustments = round2(n(opts.adjustments || 0));
  const deductions  = round2(n(opts.deductions || 0));
  const finalBase   = round2(preview.taxBase + adjustments);
  const grossTax    = round2(finalBase * (preview.taxRate / 100));
  const finalTax    = round2(grossTax - deductions);

  if (finalTax <= 0) {
    throw new Error('Quota d\'IS final ≤ 0: no es comptabilitza.');
  }

  const acc630  = await getAccount(company.id, '630000');
  const acc4752 = await getAccount(company.id, '4752');

  const draft = await journalService.createDraft({
    companyId: company.id,
    date: fy.endDate,
    description: `Impost de societats ${year} (base ${finalBase.toFixed(2)}, ${preview.taxRate}%)`,
    type: 'TAX_ACCRUAL',
    source: 'AUTO_CLOSING',
    sourceRef: `YEAR_IS_${year}`,
    lines: [
      { accountId: acc630.id, debit: finalTax, credit: 0, description: `IS exercici ${year}`, sortOrder: 0 },
      { accountId: acc4752.id, debit: 0, credit: finalTax, description: `H.P. creditora per IS ${year}`, sortOrder: 1 },
    ],
    createdById: userId,
  });
  return {
    journalEntry: await journalService.post(draft.id, userId),
    preview: { ...preview, adjustments, deductions, finalBase, finalTax },
  };
}

// =========================================================================
// PAS 4 — Tancament definitiu (regularització 6/7 → 129) + obertura
// =========================================================================
async function closeYear(year, userId) {
  const company = await resolveCompany();
  const fy = await getFiscalYear(year, company.id);
  if (fy.locked) throw new Error('Exercici ja tancat');

  // Comprovar que no hi ha DRAFT
  const drafts = await prisma.journalEntry.count({ where: { fiscalYearId: fy.id, status: 'DRAFT' } });
  if (drafts > 0) throw new Error(`Hi ha ${drafts} assentaments en esborrany. Comptabilitza\'ls o esborra\'ls primer.`);

  const existing = await prisma.journalEntry.findFirst({
    where: { companyId: company.id, fiscalYearId: fy.id, sourceRef: `YEAR_CLOSE_${year}` },
  });
  if (existing) throw new Error(`L'exercici ${year} ja té assentament de tancament (#${existing.entryNumber})`);

  // Saldos dels comptes 6 i 7 per regularitzar
  const incomes = await getBalancesByPrefix(company.id, '7', fy.startDate, fy.endDate);
  const expenses = await getBalancesByPrefix(company.id, '6', fy.startDate, fy.endDate);

  const totalIncomes  = round2(incomes.reduce((s, a) => s + (a.credit - a.debit), 0));
  const totalExpenses = round2(expenses.reduce((s, a) => s + (a.debit - a.credit), 0));
  const netResult     = round2(totalIncomes - totalExpenses);

  const acc129 = await getAccount(company.id, '129000');

  // Línies: tancar comptes 7 al deure, comptes 6 al haver, i 129 a la diferència
  const lines = [];
  let order = 0;
  for (const i of incomes) {
    const bal = round2(i.credit - i.debit);
    if (Math.abs(bal) < 0.01) continue;
    lines.push({ accountId: i.accountId, debit: bal, credit: 0, description: `Tancament ${i.code}`, sortOrder: order++ });
  }
  for (const e of expenses) {
    const bal = round2(e.debit - e.credit);
    if (Math.abs(bal) < 0.01) continue;
    lines.push({ accountId: e.accountId, debit: 0, credit: bal, description: `Tancament ${e.code}`, sortOrder: order++ });
  }
  // 129: si benefici → haver (resultat positiu); si pèrdua → deure (resultat negatiu)
  if (netResult > 0) {
    lines.push({ accountId: acc129.id, debit: 0, credit: netResult, description: `Resultat exercici ${year} (benefici)`, sortOrder: order++ });
  } else if (netResult < 0) {
    lines.push({ accountId: acc129.id, debit: -netResult, credit: 0, description: `Resultat exercici ${year} (pèrdua)`, sortOrder: order++ });
  }

  const draft = await journalService.createDraft({
    companyId: company.id,
    date: fy.endDate,
    description: `Tancament exercici ${year}`,
    type: 'YEAR_CLOSING',
    source: 'AUTO_CLOSING',
    sourceRef: `YEAR_CLOSE_${year}`,
    lines,
    createdById: userId,
  });
  const closingEntry = await journalService.post(draft.id, userId);

  // Marcar exercici CLOSED + locked
  const updated = await prisma.fiscalYear.update({
    where: { id: fy.id },
    data: {
      status: 'CLOSED',
      locked: true,
      lockedAt: new Date(),
      lockedById: userId,
      totalRevenue: totalIncomes,
      totalExpenses,
      netResult,
    },
  });

  return {
    fiscalYear: updated,
    closingEntry,
    netResult,
    totalIncomes,
    totalExpenses,
  };
}

/**
 * Crea l'exercici següent i genera l'assentament d'obertura amb saldos
 * d'actius/passius/PN del 31-12 anterior. El 129 es traspassa a 120 (Romanent)
 * o 121 (Resultats negatius d'exercicis anteriors) automàticament.
 */
async function openNextYear(year, userId) {
  const company = await resolveCompany();
  const fy = await getFiscalYear(year, company.id);
  if (!fy.locked) throw new Error('Cal tancar primer l\'exercici actual');

  const nextYear = year + 1;
  let nextFy = await prisma.fiscalYear.findUnique({
    where: { companyId_year: { companyId: company.id, year: nextYear } },
  });
  if (!nextFy) {
    nextFy = await prisma.fiscalYear.create({
      data: {
        companyId: company.id,
        year: nextYear,
        startDate: new Date(`${nextYear}-01-01T00:00:00Z`),
        endDate: new Date(`${nextYear}-12-31T23:59:59Z`),
        status: 'OPEN',
      },
    });
  }

  const existing = await prisma.journalEntry.findFirst({
    where: { companyId: company.id, fiscalYearId: nextFy.id, sourceRef: `YEAR_OPEN_${nextYear}` },
  });
  if (existing) throw new Error(`L'obertura del ${nextYear} ja està feta (#${existing.entryNumber})`);

  // Llegir saldos finals d'actius (1xx, 2xx, 3xx, 4xx, 5xx) — exclou 6 i 7 (ja regularitzats)
  const balances = await prisma.$queryRawUnsafe(`
    SELECT a.id as "accountId", a.code, a.name, a.type::text as type,
      SUM(jl.debit) as debit, SUM(jl.credit) as credit
    FROM journal_lines jl
    JOIN journal_entries je ON jl."journalEntryId" = je.id
    JOIN chart_of_accounts a ON jl."accountId" = a.id
    WHERE je.status = 'POSTED'
      AND je."fiscalYearId" = $1
      AND a."isLeaf" = true
      AND (a.code LIKE '1%' OR a.code LIKE '2%' OR a.code LIKE '3%' OR a.code LIKE '4%' OR a.code LIKE '5%')
    GROUP BY a.id, a.code, a.name, a.type
    HAVING SUM(jl.debit) <> SUM(jl.credit)
    ORDER BY a.code
  `, fy.id);

  const lines = [];
  let order = 0;
  let acc129Balance = 0;

  for (const b of balances) {
    const debit = n(b.debit), credit = n(b.credit);
    const balance = round2(debit - credit);
    if (Math.abs(balance) < 0.01) continue;

    if (b.code.startsWith('129')) {
      acc129Balance += balance;   // El 129 el traspassem a 120/121
      continue;
    }

    if (balance > 0) {
      // Saldo deutor (típicament actius): obertura al deure
      lines.push({ accountId: b.accountId, debit: balance, credit: 0, description: `Obertura ${b.code}`, sortOrder: order++ });
    } else {
      // Saldo creditor (típicament passius/PN): obertura al haver
      lines.push({ accountId: b.accountId, debit: 0, credit: -balance, description: `Obertura ${b.code}`, sortOrder: order++ });
    }
  }

  // Traspassar 129 a 120 (benefici) o 121 (pèrdua)
  if (Math.abs(acc129Balance) > 0.01) {
    if (acc129Balance < 0) {
      // Saldo creditor del 129 (benefici) → 120 Romanent al haver
      const acc120 = await getAccount(company.id, '120000');
      lines.push({ accountId: acc120.id, debit: 0, credit: -acc129Balance, description: `Traspàs resultat ${year} a Romanent`, sortOrder: order++ });
    } else {
      // Saldo deutor del 129 (pèrdua) → 121 Resultats negatius d'exercicis anteriors al deure
      const acc121 = await getAccount(company.id, '121000');
      lines.push({ accountId: acc121.id, debit: acc129Balance, credit: 0, description: `Traspàs pèrdua ${year} a Resultats negatius`, sortOrder: order++ });
    }
  }

  if (lines.length < 2) {
    throw new Error('No hi ha saldos d\'actius/passius/PN per obrir el nou exercici.');
  }

  const draft = await journalService.createDraft({
    companyId: company.id,
    date: nextFy.startDate,
    description: `Obertura exercici ${nextYear}`,
    type: 'YEAR_OPENING',
    source: 'AUTO_CLOSING',
    sourceRef: `YEAR_OPEN_${nextYear}`,
    lines,
    createdById: userId,
  });
  const openingEntry = await journalService.post(draft.id, userId);

  return { fiscalYear: nextFy, openingEntry };
}

module.exports = {
  getChecklist,
  regularizeVat,
  previewCorporateTax,
  postCorporateTax,
  closeYear,
  openNextYear,
};
