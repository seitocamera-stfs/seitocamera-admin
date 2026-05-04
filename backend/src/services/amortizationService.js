/**
 * amortizationService — Comptabilització de quotes mensuals d'amortització.
 *
 * Per cada AmortizationEntry status=PENDING, genera l'assentament:
 *   Deure  681x (despesa amortització)        amount
 *     Haver 281x (amortització acumulada)     amount
 *
 * runMonth(year, month) processa totes les entries pendents d'aquell mes.
 * Pensat per un cron mensual (1r de cada mes processa el mes anterior),
 * però al MVP s'invoca manualment des de la UI.
 */
const { prisma } = require('../config/database');
const journalService = require('./journalService');

function n(v) { return v == null ? 0 : Number(v); }
function round2(v) { return Math.round(v * 100) / 100; }

async function postEntry(entryId, userId) {
  const entry = await prisma.amortizationEntry.findUnique({
    where: { id: entryId },
    include: {
      fixedAsset: { include: { expenseAccount: true, amortizationAccount: true } },
    },
  });
  if (!entry) throw new Error('Quota no trobada');
  if (entry.status === 'POSTED') return entry;
  if (entry.fixedAsset.status === 'DISPOSED') {
    throw new Error('Aquest immobilitzat està donat de baixa');
  }

  const amount = round2(n(entry.amount));
  if (amount <= 0) throw new Error('Quota nul·la');

  // Construir data: últim dia del mes
  const date = new Date(entry.year, entry.month, 0, 23, 59, 59, 999);

  const draft = await journalService.createDraft({
    companyId: entry.fixedAsset.companyId,
    date,
    description: `Amortització ${entry.fixedAsset.code} — ${String(entry.month).padStart(2, '0')}/${entry.year}`,
    type: 'AMORTIZATION',
    source: 'AUTO_AMORTIZATION',
    sourceRef: entry.id,
    lines: [
      {
        accountId: entry.fixedAsset.expenseAccountId,
        debit: amount, credit: 0,
        description: `Quota mensual ${entry.fixedAsset.name}`,
        sortOrder: 0,
      },
      {
        accountId: entry.fixedAsset.amortizationAccountId,
        debit: 0, credit: amount,
        description: `Amortització acumulada ${entry.fixedAsset.code}`,
        sortOrder: 1,
      },
    ],
    createdById: userId,
  });
  const posted = await journalService.post(draft.id, userId);

  await prisma.amortizationEntry.update({
    where: { id: entry.id },
    data: { status: 'POSTED', journalEntryId: posted.id, postedAt: new Date() },
  });

  // Si era l'última quota, marcar FA com FULLY_AMORTIZED
  if (round2(n(entry.netValue)) <= round2(n(entry.fixedAsset.residualValue))) {
    await prisma.fixedAsset.update({
      where: { id: entry.fixedAssetId },
      data: { status: 'FULLY_AMORTIZED' },
    });
  }

  return posted;
}

async function unpostEntry(entryId, userId, reason) {
  const entry = await prisma.amortizationEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new Error('Quota no trobada');
  if (!entry.journalEntryId) throw new Error('Aquesta quota no està comptabilitzada');

  await journalService.reverse(entry.journalEntryId, userId, reason || 'Anul·lació de l\'amortització');

  await prisma.amortizationEntry.update({
    where: { id: entry.id },
    data: { status: 'PENDING', journalEntryId: null, postedAt: null },
  });

  // Reactivar el FA si estava FULLY_AMORTIZED
  await prisma.fixedAsset.update({
    where: { id: entry.fixedAssetId },
    data: { status: 'ACTIVE' },
  });

  return { success: true };
}

/**
 * Comptabilitza totes les quotes PENDING d'un mes concret.
 */
async function runMonth(year, month, userId) {
  const pending = await prisma.amortizationEntry.findMany({
    where: { year, month, status: 'PENDING', fixedAsset: { status: 'ACTIVE' } },
    select: { id: true, fixedAsset: { select: { code: true, name: true } } },
  });

  const results = { ok: [], failed: [] };
  for (const e of pending) {
    try {
      const j = await postEntry(e.id, userId);
      results.ok.push({ entryId: e.id, code: e.fixedAsset.code, journalEntryNumber: j.entryNumber });
    } catch (err) {
      results.failed.push({ entryId: e.id, code: e.fixedAsset.code, error: err.message });
    }
  }
  return { year, month, total: pending.length, ...results };
}

module.exports = { postEntry, unpostEntry, runMonth };
