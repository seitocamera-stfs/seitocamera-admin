/**
 * fixedAssetService — Gestió d'immobilitzat (Sprint 6).
 *
 * Quan una factura rebuda es comptabilitza amb un compte del grup 2 (ASSET),
 * l'invoicePostingService crida `createFromInvoice()` per generar
 * automàticament el FixedAsset i el seu calendari d'amortització.
 *
 * Vida útil per defecte segons taula AEAT simplificada:
 *   213 (Maquinària)         → 12% lineal anual → ~8.33 anys
 *   216 (Mobiliari)          → 10% → 10 anys
 *   217 (Equips informàtics) → 25% → 4 anys
 *   218 (Elements transport) → 16% → 6.25 anys
 *   219 (Altre immobilitzat) → 10% → 10 anys
 *
 * Mapping de comptes contraparts (immobilitzat → amortització acumulada → despesa):
 *   213 → 2813 → 6813
 *   216 → 2816 → 6816
 *   217 → 2817 → 6817
 *   218 → 2818 → 6818
 *   219 → 2819 → 6819
 */
const { prisma } = require('../config/database');

// Vida útil (anys) per cada subgrup d'immobilitzat material
const DEFAULT_USEFUL_LIFE = {
  '213': 8.33,
  '216': 10,
  '217': 4,
  '218': 6.25,
  '219': 10,
};

function n(v) { return v == null ? 0 : Number(v); }
function round2(v) { return Math.round(v * 100) / 100; }

async function resolveCompanyId() {
  const c = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  return c?.id || null;
}

/**
 * Per un compte d'immobilitzat (213/216/217/218/219), retorna els subcomptes
 * d'amortització acumulada i despesa corresponents (281x i 681x).
 */
async function getAmortizationAccounts(companyId, assetAccountCode) {
  const subgroup = assetAccountCode.substring(0, 3);  // p.ex. "213"
  const amortCode = '281' + subgroup.charAt(2);       // 213 → 2813
  const expenseCode = '681' + subgroup.charAt(2);     // 213 → 6813

  const [amort, expense] = await Promise.all([
    prisma.chartOfAccount.findUnique({ where: { companyId_code: { companyId, code: amortCode } } }),
    prisma.chartOfAccount.findUnique({ where: { companyId_code: { companyId, code: expenseCode } } }),
  ]);
  if (!amort)   throw new Error(`Falta el compte d'amortització acumulada ${amortCode}. Executa el seed PGC.`);
  if (!expense) throw new Error(`Falta el compte de despesa amortització ${expenseCode}. Executa el seed PGC.`);
  return { amortizationAccount: amort, expenseAccount: expense };
}

/**
 * Genera el codi correlatiu d'un FixedAsset: FA-{YYYY}-{NNN}.
 */
async function nextCode(companyId, year) {
  const prefix = `FA-${year}-`;
  const last = await prisma.fixedAsset.findFirst({
    where: { companyId, code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const n = last ? parseInt(last.code.split('-')[2], 10) + 1 : 1;
  return prefix + String(n).padStart(3, '0');
}

/**
 * Calcula la quota mensual d'amortització lineal.
 */
function calculateMonthlyAmortization(acquisitionValue, residualValue, usefulLifeYears) {
  return round2((Number(acquisitionValue) - Number(residualValue)) / (Number(usefulLifeYears) * 12));
}

/**
 * Genera totes les AmortizationEntry pendents per a un FixedAsset:
 * un registre per cada mes des del mes d'adquisició fins al final de la vida útil.
 * Idempotent: no crea entries que ja existeixin.
 */
async function generateAmortizationSchedule(fixedAssetId) {
  const fa = await prisma.fixedAsset.findUnique({ where: { id: fixedAssetId } });
  if (!fa) throw new Error('Immobilitzat no trobat');

  const totalMonths = Math.ceil(Number(fa.usefulLifeYears) * 12);
  const startDate = new Date(fa.acquisitionDate);
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1;
  const monthly = Number(fa.monthlyAmortization);
  const acquisition = Number(fa.acquisitionValue);
  const residual = Number(fa.residualValue);
  const totalAmortizable = round2(acquisition - residual);

  let accumulated = 0;
  const entries = [];

  for (let i = 0; i < totalMonths; i++) {
    const monthIndex = startMonth - 1 + i;
    const year = startYear + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;

    let amount = monthly;
    // Última quota: ajusta per evitar errors d'arredoniment
    if (i === totalMonths - 1) {
      amount = round2(totalAmortizable - accumulated);
    }
    accumulated = round2(accumulated + amount);
    const netValue = round2(acquisition - accumulated);

    entries.push({
      fixedAssetId: fa.id,
      year, month,
      amount, accumulated, netValue,
      status: 'PENDING',
    });
  }

  // Esborra entries PENDING existents per a aquest FA i recrea (per re-generació)
  await prisma.amortizationEntry.deleteMany({
    where: { fixedAssetId: fa.id, status: 'PENDING' },
  });
  if (entries.length) {
    await prisma.amortizationEntry.createMany({
      data: entries,
      skipDuplicates: true,
    });
  }
  return entries.length;
}

/**
 * Crea un FixedAsset des d'una factura rebuda comptabilitzada amb compte
 * de l'immobilitzat. Pensat per ser cridat des d'invoicePostingService.
 *
 * Si ja existeix un FA per aquesta factura, no en crea un altre (idempotent).
 */
async function createFromInvoice({ invoiceId, accountCode, name }) {
  const companyId = await resolveCompanyId();
  if (!companyId) throw new Error('Cap empresa configurada');

  const invoice = await prisma.receivedInvoice.findUnique({
    where: { id: invoiceId },
    include: { account: true },
  });
  if (!invoice) throw new Error('Factura no trobada');

  // Idempotència
  const existing = await prisma.fixedAsset.findFirst({ where: { receivedInvoiceId: invoiceId } });
  if (existing) return existing;

  const code3 = (accountCode || invoice.account?.code || '').substring(0, 3);
  if (!DEFAULT_USEFUL_LIFE[code3]) {
    throw new Error(`No hi ha vida útil definida per al compte ${code3}. Edita manualment l'immobilitzat.`);
  }
  const accounts = await getAmortizationAccounts(companyId, code3);

  const acquisitionValue = round2(Number(invoice.subtotal));  // Sense IVA (l'IVA es separa al 472)
  const usefulLifeYears = DEFAULT_USEFUL_LIFE[code3];
  const monthlyAmort = calculateMonthlyAmortization(acquisitionValue, 0, usefulLifeYears);

  const code = await nextCode(companyId, new Date(invoice.issueDate).getFullYear());

  const created = await prisma.fixedAsset.create({
    data: {
      companyId,
      code,
      name: (name || invoice.description || `${invoice.supplier?.name || 'Proveïdor'} ${invoice.invoiceNumber}`).slice(0, 200),
      description: invoice.description?.slice(0, 1000) || null,
      receivedInvoiceId: invoice.id,
      accountId: invoice.accountId,
      amortizationAccountId: accounts.amortizationAccount.id,
      expenseAccountId: accounts.expenseAccount.id,
      acquisitionDate: invoice.issueDate,
      acquisitionValue,
      residualValue: 0,
      usefulLifeYears,
      amortizationMethod: 'LINEAR',
      monthlyAmortization: monthlyAmort,
      status: 'ACTIVE',
    },
  });

  await generateAmortizationSchedule(created.id);
  return created;
}

/**
 * Crea manualment un FixedAsset (UI).
 */
async function createManual(input) {
  const companyId = input.companyId || await resolveCompanyId();
  if (!companyId) throw new Error('Cap empresa configurada');

  const account = await prisma.chartOfAccount.findUnique({ where: { id: input.accountId } });
  if (!account) throw new Error('Compte d\'immobilitzat no trobat');
  const code3 = account.code.substring(0, 3);
  const accounts = await getAmortizationAccounts(companyId, code3);

  const acquisitionValue = round2(Number(input.acquisitionValue));
  const residualValue = round2(Number(input.residualValue || 0));
  const usefulLifeYears = Number(input.usefulLifeYears || DEFAULT_USEFUL_LIFE[code3] || 5);
  const monthly = calculateMonthlyAmortization(acquisitionValue, residualValue, usefulLifeYears);

  const code = input.code || await nextCode(companyId, new Date(input.acquisitionDate).getFullYear());

  const created = await prisma.fixedAsset.create({
    data: {
      companyId,
      code,
      name: input.name,
      description: input.description || null,
      equipmentId: input.equipmentId || null,
      receivedInvoiceId: input.receivedInvoiceId || null,
      accountId: input.accountId,
      amortizationAccountId: accounts.amortizationAccount.id,
      expenseAccountId: accounts.expenseAccount.id,
      acquisitionDate: new Date(input.acquisitionDate),
      acquisitionValue,
      residualValue,
      usefulLifeYears,
      amortizationMethod: 'LINEAR',
      monthlyAmortization: monthly,
    },
  });

  await generateAmortizationSchedule(created.id);
  return created;
}

/**
 * Marca com a DISPOSED (donat de baixa). No genera cap assentament al MVP —
 * la baixa comptable definitiva (amortització anticipada + retirada del compte
 * d'immobilitzat) es farà manualment al Llibre Diari fins que ho automatitzem.
 */
async function dispose(fixedAssetId, { date, notes }) {
  return prisma.fixedAsset.update({
    where: { id: fixedAssetId },
    data: {
      status: 'DISPOSED',
      disposalDate: date ? new Date(date) : new Date(),
      disposalNotes: notes || null,
    },
  });
}

module.exports = {
  DEFAULT_USEFUL_LIFE,
  createFromInvoice,
  createManual,
  generateAmortizationSchedule,
  calculateMonthlyAmortization,
  dispose,
  getAmortizationAccounts,
};
