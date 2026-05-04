/**
 * financialReportsService — Estats financers (Sprint 8).
 *
 *   Balanç de situació (PGC PYMES abreujat)
 *     ACTIU
 *       A) Actiu no corrent: 2xx (immobilitzat) - 28x (amort. acum.) - 29x (deteriorament)
 *       B) Actiu corrent: 3 (existències), 43 (clients), 44/47 deutors, 5xx tresoreria
 *     PATRIMONI NET I PASSIU
 *       A) Patrimoni net: 10 (capital), 11 (reserves), 12 (resultats)
 *       B) Passiu no corrent: 17/18 (deutes a llarg termini) — buit al MVP
 *       C) Passiu corrent: 40, 41, 47x creditor, 52 (deutes a curt)
 *
 *   Compte de pèrdues i guanys (PGC PYMES abreujat)
 *     A) Operacions continuades
 *       1. Import net xifra de negocis: 700, 705
 *       4. Aprovisionaments: 60, 61
 *       5. Altres ingressos d'explotació: 75
 *       6. Despeses de personal: 64
 *       7. Altres despeses d'explotació: 62, 631
 *       8. Amortització: 68
 *      A.1) Resultat d'explotació
 *       12. Ingressos financers: 76
 *       13. Despeses financeres: 66
 *      A.2) Resultat financer
 *      A.3) Resultat abans d'impostos = A.1 + A.2
 *       17. Impost sobre beneficis: 630
 *      A.4) Resultat de l'exercici
 */
const { prisma } = require('../config/database');

function n(v) { return v == null ? 0 : Number(v); }
function round2(v) { return Math.round(v * 100) / 100; }

/**
 * Categoritza un compte segons l'esquema del Balanç (signe esperat segons natura).
 *   ASSET → es presenta a actiu (saldo deutor positiu)
 *   LIABILITY/EQUITY → es presenta a passiu+PN (saldo creditor positiu)
 *
 * Retorna { side: 'ASSET'|'LIABILITY_EQUITY', section, group } o null si no
 * pertany al balanç (ingressos i despeses queden fora — van al P&G).
 */
function classifyForBalance(code) {
  const c = String(code);
  // Patrimoni Net (grup 10, 11, 12)
  if (/^(10|11|12)/.test(c)) return { side: 'LIABILITY_EQUITY', section: 'PATRIMONI_NET', group: 'A) Patrimoni net' };
  // Immobilitzat (grup 2)
  if (/^21/.test(c))  return { side: 'ASSET', section: 'NON_CURRENT', group: 'II. Immobilitzat material' };
  if (/^28/.test(c))  return { side: 'ASSET_CONTRA', section: 'NON_CURRENT', group: 'II. Immobilitzat material' };  // amort. acum (resta)
  if (/^29/.test(c))  return { side: 'ASSET_CONTRA', section: 'NON_CURRENT', group: 'Deterioraments' };
  if (/^2/.test(c))   return { side: 'ASSET', section: 'NON_CURRENT', group: 'IV. Inversions a llarg termini' };
  // Existències (grup 3)
  if (/^3/.test(c))   return { side: 'ASSET', section: 'CURRENT', group: 'I. Existències' };
  // Deutors / Creditors (grup 4)
  if (/^43/.test(c))  return { side: 'ASSET', section: 'CURRENT', group: 'II. Deutors comercials (clients)' };
  if (/^44/.test(c))  return { side: 'ASSET', section: 'CURRENT', group: 'II. Deutors comercials (altres)' };
  if (/^46[02]/.test(c)) return { side: 'ASSET', section: 'CURRENT', group: 'II. Deutors comercials (personal)' };
  if (/^4709/.test(c)) return { side: 'ASSET', section: 'CURRENT', group: 'II. Deutors comercials (HP IVA)' };
  if (/^472/.test(c))  return { side: 'ASSET', section: 'CURRENT', group: 'II. Deutors comercials (HP IVA suportat)' };
  if (/^40/.test(c))  return { side: 'LIABILITY_EQUITY', section: 'CURRENT_LIAB', group: 'III. Creditors comercials i altres (proveïdors)' };
  if (/^41/.test(c))  return { side: 'LIABILITY_EQUITY', section: 'CURRENT_LIAB', group: 'III. Creditors comercials i altres (creditors)' };
  if (/^465/.test(c)) return { side: 'LIABILITY_EQUITY', section: 'CURRENT_LIAB', group: 'III. Creditors comercials i altres (personal)' };
  if (/^4750/.test(c)) return { side: 'LIABILITY_EQUITY', section: 'CURRENT_LIAB', group: 'III. Creditors comercials i altres (HP IVA)' };
  if (/^4751/.test(c)) return { side: 'LIABILITY_EQUITY', section: 'CURRENT_LIAB', group: 'III. Creditors comercials i altres (HP IRPF)' };
  if (/^4752/.test(c)) return { side: 'LIABILITY_EQUITY', section: 'CURRENT_LIAB', group: 'III. Creditors comercials i altres (HP IS)' };
  if (/^476/.test(c)) return { side: 'LIABILITY_EQUITY', section: 'CURRENT_LIAB', group: 'III. Creditors comercials i altres (Seguretat Social)' };
  if (/^477/.test(c)) return { side: 'LIABILITY_EQUITY', section: 'CURRENT_LIAB', group: 'III. Creditors comercials i altres (HP IVA repercutit)' };
  if (/^48/.test(c))  return { side: 'ASSET', section: 'CURRENT', group: 'IV. Periodificacions' };
  if (/^4/.test(c))   return { side: 'LIABILITY_EQUITY', section: 'CURRENT_LIAB', group: 'III. Creditors comercials i altres' };
  // Comptes financers (grup 5)
  if (/^52/.test(c))  return { side: 'LIABILITY_EQUITY', section: 'CURRENT_LIAB', group: 'II. Deutes a curt termini' };
  if (/^57/.test(c))  return { side: 'ASSET', section: 'CURRENT', group: 'V. Efectiu i altres líquids equivalents' };
  if (/^5/.test(c))   return { side: 'ASSET', section: 'CURRENT', group: 'III. Inversions financeres a curt termini' };
  // Grups 6 i 7 no van al balanç (van al P&G); 17/18 (deutes l/p) tampoc cobertes al MVP
  return null;
}

/**
 * Categoritza un compte per al Compte P&G.
 * Retorna { epigraf, sign }. sign indica si va sumat (1) o restat (-1).
 */
function classifyForPL(code) {
  const c = String(code);
  if (/^(700|701|702|703|704|705|706|708|709)/.test(c))
    return { epigraf: '1. Import net xifra de negocis', section: 'OPERATING', sign: 1, side: 'INCOME' };
  if (/^7(20|21|22|23|24|25|26|27|28|29)/.test(c) || /^710|711/.test(c))
    return { epigraf: '2. Variació existències productes acabats', section: 'OPERATING', sign: 1, side: 'INCOME' };
  if (/^73/.test(c))
    return { epigraf: '3. Treballs realitzats per l\'empresa per al seu actiu', section: 'OPERATING', sign: 1, side: 'INCOME' };
  if (/^(60|61)/.test(c))
    return { epigraf: '4. Aprovisionaments', section: 'OPERATING', sign: -1, side: 'EXPENSE' };
  if (/^(75|759)/.test(c))
    return { epigraf: '5. Altres ingressos d\'explotació', section: 'OPERATING', sign: 1, side: 'INCOME' };
  if (/^64/.test(c))
    return { epigraf: '6. Despeses de personal', section: 'OPERATING', sign: -1, side: 'EXPENSE' };
  if (/^(62|631)/.test(c))
    return { epigraf: '7. Altres despeses d\'explotació', section: 'OPERATING', sign: -1, side: 'EXPENSE' };
  if (/^68/.test(c))
    return { epigraf: '8. Amortització de l\'immobilitzat', section: 'OPERATING', sign: -1, side: 'EXPENSE' };
  if (/^740/.test(c))
    return { epigraf: '9. Imputació de subvencions', section: 'OPERATING', sign: 1, side: 'INCOME' };
  if (/^(694|699|794|799|67|77)/.test(c))
    return { epigraf: '11. Deteriorament i resultat per alienacions', section: 'OPERATING', sign: 1, side: 'MIXED' };
  if (/^76/.test(c))
    return { epigraf: '12. Ingressos financers', section: 'FINANCIAL', sign: 1, side: 'INCOME' };
  if (/^66/.test(c))
    return { epigraf: '13. Despeses financeres', section: 'FINANCIAL', sign: -1, side: 'EXPENSE' };
  if (/^(630|6301|633|638)/.test(c))
    return { epigraf: '17. Impost sobre beneficis', section: 'TAX', sign: -1, side: 'EXPENSE' };
  return null;
}

/**
 * Llegeix totes les journal_lines POSTED fins a una data (inclosa).
 */
async function getLinesUntil(companyId, atDate, fiscalYearIds) {
  const where = {
    journalEntry: {
      companyId,
      status: 'POSTED',
      date: { lte: atDate },
      ...(fiscalYearIds?.length && { fiscalYearId: { in: fiscalYearIds } }),
    },
  };
  return prisma.journalLine.findMany({
    where,
    select: {
      debit: true, credit: true,
      account: { select: { id: true, code: true, name: true, type: true } },
    },
  });
}

/**
 * Llegeix totes les journal_lines POSTED en un rang [from, to].
 */
async function getLinesInRange(companyId, from, to) {
  return prisma.journalLine.findMany({
    where: {
      journalEntry: {
        companyId,
        status: 'POSTED',
        date: { gte: from, lte: to },
      },
    },
    select: {
      debit: true, credit: true,
      account: { select: { id: true, code: true, name: true, type: true } },
    },
  });
}

/**
 * Acumula saldo (debit-credit) per compte.
 */
function aggregateByAccount(lines) {
  const map = new Map();
  for (const l of lines) {
    const k = l.account.id;
    if (!map.has(k)) {
      map.set(k, { id: k, code: l.account.code, name: l.account.name, type: l.account.type, debit: 0, credit: 0 });
    }
    const r = map.get(k);
    r.debit += n(l.debit);
    r.credit += n(l.credit);
  }
  // Calcular saldo + arredonir
  for (const r of map.values()) {
    r.debit = round2(r.debit);
    r.credit = round2(r.credit);
    r.balance = round2(r.debit - r.credit);
  }
  return Array.from(map.values()).filter((r) => r.balance !== 0);
}

// =========================================================================
// BALANÇ DE SITUACIÓ
// =========================================================================
async function getBalanceSheet({ companyId, atDate, compareDate }) {
  const c = companyId || (await prisma.company.findFirst())?.id;
  if (!c) throw new Error('Cap empresa configurada');

  const lines = await getLinesUntil(c, new Date(atDate));
  const accounts = aggregateByAccount(lines);

  let comparativeAccounts = null;
  if (compareDate) {
    const linesPrev = await getLinesUntil(c, new Date(compareDate));
    comparativeAccounts = aggregateByAccount(linesPrev);
  }
  const prevMap = new Map((comparativeAccounts || []).map((a) => [a.id, a.balance]));

  // Estructura agrupada
  const sections = {
    ASSET: { NON_CURRENT: {}, CURRENT: {} },
    LIABILITY_EQUITY: { PATRIMONI_NET: {}, NON_CURRENT_LIAB: {}, CURRENT_LIAB: {} },
  };

  for (const acc of accounts) {
    const cl = classifyForBalance(acc.code);
    if (!cl) continue;

    let presentValue = acc.balance;
    if (cl.side === 'ASSET_CONTRA') {
      // Comptes amb saldo creditor que resten de l'actiu (ex: 281x amort. acum.)
      presentValue = -acc.balance;  // saldo positiu = resta del actiu
    } else if (cl.side === 'LIABILITY_EQUITY') {
      // Saldo creditor → positiu en presentació
      presentValue = -acc.balance;
    }

    const sideKey = cl.side === 'ASSET_CONTRA' ? 'ASSET' : cl.side;
    const sectionMap = sections[sideKey][cl.section] = sections[sideKey][cl.section] || {};
    if (!sectionMap[cl.group]) sectionMap[cl.group] = { group: cl.group, accounts: [], total: 0, prevTotal: 0 };

    const prevBalance = prevMap.get(acc.id) || 0;
    let prevPresentValue = prevBalance;
    if (cl.side === 'ASSET_CONTRA') prevPresentValue = -prevBalance;
    if (cl.side === 'LIABILITY_EQUITY') prevPresentValue = -prevBalance;

    sectionMap[cl.group].accounts.push({
      code: acc.code, name: acc.name,
      value: round2(presentValue),
      prevValue: round2(prevPresentValue),
    });
    sectionMap[cl.group].total = round2(sectionMap[cl.group].total + presentValue);
    sectionMap[cl.group].prevTotal = round2(sectionMap[cl.group].prevTotal + prevPresentValue);
  }

  function structureSide(sideMap, sectionLabels) {
    const out = [];
    for (const [secKey, secLabel] of sectionLabels) {
      const groups = Object.values(sideMap[secKey] || {});
      const total = round2(groups.reduce((s, g) => s + g.total, 0));
      const prevTotal = round2(groups.reduce((s, g) => s + g.prevTotal, 0));
      out.push({ section: secLabel, groups, total, prevTotal });
    }
    return out;
  }

  const asset = structureSide(sections.ASSET, [
    ['NON_CURRENT', 'A) Actiu no corrent'],
    ['CURRENT', 'B) Actiu corrent'],
  ]);
  const liabilityEquity = structureSide(sections.LIABILITY_EQUITY, [
    ['PATRIMONI_NET', 'A) Patrimoni net'],
    ['NON_CURRENT_LIAB', 'B) Passiu no corrent'],
    ['CURRENT_LIAB', 'C) Passiu corrent'],
  ]);

  const totalAsset = round2(asset.reduce((s, sec) => s + sec.total, 0));
  const totalLE = round2(liabilityEquity.reduce((s, sec) => s + sec.total, 0));
  const prevTotalAsset = round2(asset.reduce((s, sec) => s + sec.prevTotal, 0));
  const prevTotalLE = round2(liabilityEquity.reduce((s, sec) => s + sec.prevTotal, 0));

  return {
    atDate: new Date(atDate).toISOString().slice(0, 10),
    compareDate: compareDate ? new Date(compareDate).toISOString().slice(0, 10) : null,
    asset,
    liabilityEquity,
    totals: {
      asset: totalAsset,
      liabilityEquity: totalLE,
      balanced: Math.abs(totalAsset - totalLE) < 0.5,  // tolerància d'arredoniment
      difference: round2(totalAsset - totalLE),
    },
    comparative: compareDate ? {
      asset: prevTotalAsset,
      liabilityEquity: prevTotalLE,
    } : null,
  };
}

// =========================================================================
// COMPTE DE PÈRDUES I GUANYS
// =========================================================================
async function getProfitAndLoss({ companyId, fromDate, toDate, compareFromDate, compareToDate }) {
  const c = companyId || (await prisma.company.findFirst())?.id;
  if (!c) throw new Error('Cap empresa configurada');

  const lines = await getLinesInRange(c, new Date(fromDate), new Date(toDate));
  const accounts = aggregateByAccount(lines);

  let prevAccounts = null;
  if (compareFromDate && compareToDate) {
    const linesPrev = await getLinesInRange(c, new Date(compareFromDate), new Date(compareToDate));
    prevAccounts = aggregateByAccount(linesPrev);
  }
  const prevMap = new Map((prevAccounts || []).map((a) => [a.code, a.balance]));

  // Per cada compte, classificar a un epígraf
  const epigrafs = new Map();
  for (const acc of accounts) {
    const cl = classifyForPL(acc.code);
    if (!cl) continue;

    // Per ingressos (saldo creditor): valor presentat = -balance * sign = -(deure-haver) * sign
    // Per despeses (saldo deutor): valor presentat = balance * sign
    // Simplifiquem: el "valor net del compte" en el període és el sumatori que augmenta o disminueix el resultat.
    // Per a P&G, el resultat = SUM(ingressos haver) - SUM(despeses deure)
    const accValue = cl.side === 'INCOME' ? round2(acc.credit - acc.debit)
                   : cl.side === 'EXPENSE' ? round2(acc.debit - acc.credit)
                   : round2(acc.balance);  // MIXED

    const prevAccValue = (() => {
      const pb = prevMap.get(acc.code);
      if (pb == null) return 0;
      // Per a comparativa cal accedir al debit/credit comparatiu — per simplicitat usem el balance tal qual aplicat al sign
      return cl.side === 'INCOME' ? -round2(pb) : cl.side === 'EXPENSE' ? round2(pb) : round2(pb);
    })();

    if (!epigrafs.has(cl.epigraf)) {
      epigrafs.set(cl.epigraf, { epigraf: cl.epigraf, section: cl.section, sign: cl.sign, accounts: [], total: 0, prevTotal: 0 });
    }
    const e = epigrafs.get(cl.epigraf);
    e.accounts.push({ code: acc.code, name: acc.name, value: accValue, prevValue: prevAccValue });
    e.total = round2(e.total + accValue);
    e.prevTotal = round2(e.prevTotal + prevAccValue);
  }

  const allEpigrafs = Array.from(epigrafs.values()).sort((a, b) => {
    const numA = parseInt(a.epigraf.match(/^(\d+)/)?.[1] || '99', 10);
    const numB = parseInt(b.epigraf.match(/^(\d+)/)?.[1] || '99', 10);
    return numA - numB;
  });

  const operating = allEpigrafs.filter((e) => e.section === 'OPERATING');
  const financial = allEpigrafs.filter((e) => e.section === 'FINANCIAL');
  const tax = allEpigrafs.filter((e) => e.section === 'TAX');

  const operatingResult = round2(operating.reduce((s, e) => s + e.total * e.sign, 0));
  const financialResult = round2(financial.reduce((s, e) => s + e.total * e.sign, 0));
  const resultBeforeTax = round2(operatingResult + financialResult);
  const taxAmount = round2(tax.reduce((s, e) => s + e.total * e.sign, 0));
  const netResult = round2(resultBeforeTax + taxAmount);

  // Comparatives
  const operatingResultPrev = round2(operating.reduce((s, e) => s + e.prevTotal * e.sign, 0));
  const financialResultPrev = round2(financial.reduce((s, e) => s + e.prevTotal * e.sign, 0));
  const resultBeforeTaxPrev = round2(operatingResultPrev + financialResultPrev);
  const taxAmountPrev = round2(tax.reduce((s, e) => s + e.prevTotal * e.sign, 0));
  const netResultPrev = round2(resultBeforeTaxPrev + taxAmountPrev);

  return {
    fromDate: new Date(fromDate).toISOString().slice(0, 10),
    toDate: new Date(toDate).toISOString().slice(0, 10),
    compareRange: compareFromDate && compareToDate ? {
      fromDate: new Date(compareFromDate).toISOString().slice(0, 10),
      toDate: new Date(compareToDate).toISOString().slice(0, 10),
    } : null,
    operating,
    financial,
    tax,
    subtotals: {
      'A.1) Resultat d\'explotació': { value: operatingResult, prev: operatingResultPrev },
      'A.2) Resultat financer': { value: financialResult, prev: financialResultPrev },
      'A.3) Resultat abans d\'impostos': { value: resultBeforeTax, prev: resultBeforeTaxPrev },
      'A.4) Resultat de l\'exercici': { value: netResult, prev: netResultPrev },
    },
  };
}

module.exports = { getBalanceSheet, getProfitAndLoss, classifyForBalance, classifyForPL };
