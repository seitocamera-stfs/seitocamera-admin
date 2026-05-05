/**
 * bankPostingService — Comptabilització de moviments bancaris (Sprint 4).
 *
 * Genera assentaments des de conciliacions confirmades:
 *   - Conciliació amb factura rebuda (PAYMENT):
 *       Deure  410xxx (proveïdor)        importMovement
 *         Haver 572xxx (banc)            importMovement
 *
 *   - Conciliació amb factura emesa (COLLECTION):
 *       Deure  572xxx (banc)             importMovement
 *         Haver 430xxx (client)          importMovement
 *
 *   - Multi-match (un mateix movement conciliat amb N factures):
 *       Deure/Haver banc                  totalMovement
 *         Línies múltiples per cada contrapart amb el seu import individual
 *
 * Per a moviments NO conciliats (comissions, transferències internes, ingressos
 * varis), el MVP no genera assentament automàticament: l'usuari els ha de fer
 * manualment al Llibre Diari. Pendent post-MVP.
 */
const { prisma } = require('../config/database');
const journalService = require('./journalService');

const TOLERANCE = 0.01;

function n(v) { return v == null ? 0 : Number(v); }
function round2(v) { return Math.round(v * 100) / 100; }

async function resolveCompany() {
  const c = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!c) throw new Error('Cap empresa configurada');
  return c;
}

/**
 * Resol el subcompte 572 d'un BankMovement.
 * Prioritat: bankAccount.accountId → primer 572xxxx genèric → error.
 */
async function resolveBankAccount(movement, companyId) {
  if (movement.bankAccountId) {
    const ba = await prisma.bankAccount.findUnique({
      where: { id: movement.bankAccountId },
      select: { accountId: true, name: true },
    });
    if (ba?.accountId) return ba.accountId;
  }
  // Fallback: busca el primer 572xxxx leaf
  const fallback = await prisma.chartOfAccount.findFirst({
    where: { companyId, code: { startsWith: '572' }, isLeaf: true },
    orderBy: { code: 'asc' },
  });
  if (!fallback) throw new Error('No hi ha cap subcompte 572xxxx definit. Executa generateCounterpartyAccounts.js');
  return fallback.id;
}

/**
 * Comptabilitza tots els assentaments derivats d'un BankMovement amb
 * conciliacions CONFIRMED.
 */
async function postBankMovement(movementId, userId) {
  const movement = await prisma.bankMovement.findUnique({
    where: { id: movementId },
    include: {
      conciliations: {
        where: { status: 'CONFIRMED' },
        include: {
          receivedInvoice: { include: { supplier: true } },
          issuedInvoice: { include: { client: true } },
        },
      },
    },
  });
  if (!movement) throw new Error('Moviment no trobat');
  if (movement.journalEntryId) throw new Error('Aquest moviment ja està comptabilitzat');
  if (movement.isDismissed) throw new Error('Moviment descartat: no es comptabilitza');
  if (!movement.conciliations.length) {
    throw new Error('Aquest moviment no té cap conciliació confirmada. Comptabilitza-ho manualment al Llibre Diari.');
  }

  const company = await resolveCompany();
  const bankAccountId = await resolveBankAccount(movement, company.id);

  // Determinar tipus i preparar línies
  const movementAmount = round2(Math.abs(n(movement.amount)));
  const lines = [];

  // Casos: tots PAYMENT (rebudes), tots COLLECTION (emeses), o mixt
  let collections = 0, payments = 0;
  for (const c of movement.conciliations) {
    if (c.receivedInvoiceId) payments++;
    if (c.issuedInvoiceId) collections++;
  }
  if (collections > 0 && payments > 0) {
    throw new Error('Moviment vinculat alhora a factures rebudes i emeses: cas no suportat. Resol manualment.');
  }
  const entryType = collections > 0 ? 'COLLECTION' : 'PAYMENT';

  // Sumes per validar que el total de les contraparts = movement
  let counterpartyTotal = 0;

  for (const c of movement.conciliations) {
    const inv = c.receivedInvoice || c.issuedInvoice;
    if (!inv) continue;
    if (!inv.counterpartyAccountId) {
      const partyName = c.receivedInvoice?.supplier?.name || c.issuedInvoice?.client?.name || '?';
      throw new Error(`La factura ${inv.invoiceNumber} (${partyName}) no té subcompte de contrapart assignat. Comptabilitza-la primer.`);
    }
    // Multi-match parcial: si la conciliació té `appliedAmount`, l'usem; sino
    // assumim totalAmount (compatibilitat). Així una factura pagada en 2
    // cobraments es pot conciliar correctament.
    const amount = round2(n(c.appliedAmount ?? inv.totalAmount));
    counterpartyTotal += amount;

    if (entryType === 'COLLECTION') {
      // Cobrament: Haver 430xxx (client)
      lines.push({
        accountId: inv.counterpartyAccountId,
        debit: 0,
        credit: amount,
        description: `Cobrament factura ${inv.invoiceNumber}`,
        counterpartyId: c.issuedInvoice.clientId,
        counterpartyType: 'CLIENT',
        sortOrder: lines.length + 1,
      });
    } else {
      // Pagament: Deure 410xxx (proveïdor)
      lines.push({
        accountId: inv.counterpartyAccountId,
        debit: amount,
        credit: 0,
        description: `Pagament factura ${inv.invoiceNumber}`,
        counterpartyId: c.receivedInvoice.supplierId,
        counterpartyType: 'SUPPLIER',
        sortOrder: lines.length + 1,
      });
    }
  }

  // Validar que les contraparts sumen el moviment (toleramos cèntim)
  if (Math.abs(counterpartyTotal - movementAmount) > TOLERANCE) {
    throw new Error(`Total contraparts (${counterpartyTotal.toFixed(2)}) no coincideix amb moviment (${movementAmount.toFixed(2)}). Si és parcial, cal fer la conciliació amb factura partida.`);
  }

  // Línia del banc al sortOrder 0 perquè surti primera al diari
  lines.unshift(
    entryType === 'COLLECTION'
      ? { accountId: bankAccountId, debit: movementAmount, credit: 0, description: movement.description?.slice(0, 200), sortOrder: 0 }
      : { accountId: bankAccountId, debit: 0, credit: movementAmount, description: movement.description?.slice(0, 200), sortOrder: 0 }
  );

  // Determinar la part contrària per descripció més llegible
  const partyNames = movement.conciliations
    .map((c) => c.receivedInvoice?.supplier?.name || c.issuedInvoice?.client?.name)
    .filter(Boolean)
    .join(', ');
  const desc = entryType === 'COLLECTION'
    ? `Cobrament ${partyNames || ''}`.trim()
    : `Pagament ${partyNames || ''}`.trim();

  const draft = await journalService.createDraft({
    companyId: company.id,
    date: movement.date,
    description: desc.slice(0, 200) || movement.description?.slice(0, 200) || `Moviment bancari`,
    type: entryType,
    source: 'AUTO_BANK',
    sourceRef: movement.id,
    lines,
    createdById: userId,
  });
  const posted = await journalService.post(draft.id, userId);

  const updated = await prisma.bankMovement.update({
    where: { id: movement.id },
    data: {
      companyId: company.id,
      accountId: bankAccountId,
      journalEntryId: posted.id,
      postedAt: new Date(),
    },
    include: { account: true, journalEntry: { include: { lines: true } } },
  });

  return { movement: updated, journalEntry: posted };
}

/**
 * Anul·la la comptabilització d'un moviment bancari (genera assentament d'inversió).
 */
async function unpostBankMovement(movementId, userId, reason) {
  const movement = await prisma.bankMovement.findUnique({ where: { id: movementId } });
  if (!movement) throw new Error('Moviment no trobat');
  if (!movement.journalEntryId) throw new Error('Aquest moviment no està comptabilitzat');

  await journalService.reverse(movement.journalEntryId, userId, reason || 'Anul·lació de la comptabilització del moviment bancari');

  const updated = await prisma.bankMovement.update({
    where: { id: movement.id },
    data: { journalEntryId: null, postedAt: null },
  });
  return updated;
}

/**
 * Helper segur per cridar des de routes/conciliation.js: intenta postar i si
 * falla NO bloqueja l'operació de conciliació (només loga warning).
 */
async function tryPostFromConciliation(conciliationId, userId, logger) {
  let bankMovementId = null;
  try {
    const c = await prisma.conciliation.findUnique({
      where: { id: conciliationId },
      select: { bankMovementId: true, status: true },
    });
    if (!c || c.status !== 'CONFIRMED') return null;
    bankMovementId = c.bankMovementId;
    const movement = await prisma.bankMovement.findUnique({
      where: { id: c.bankMovementId },
      select: { journalEntryId: true },
    });
    if (movement?.journalEntryId) return null;  // ja comptabilitzat
    const result = await postBankMovement(c.bankMovementId, userId);
    // Èxit — netejem qualsevol error anterior
    await prisma.bankMovement.update({
      where: { id: c.bankMovementId },
      data: { lastPostError: null, lastPostAttemptAt: new Date() },
    }).catch(() => {});
    return result;
  } catch (err) {
    logger?.warn?.(`bankPostingService: tryPost falla per conciliació ${conciliationId}: ${err.message}`);
    // Persistir l'error perquè la UI el pugui mostrar (#24)
    if (bankMovementId) {
      await prisma.bankMovement.update({
        where: { id: bankMovementId },
        data: { lastPostError: err.message.slice(0, 500), lastPostAttemptAt: new Date() },
      }).catch(() => {});
    }
    return null;
  }
}

module.exports = {
  postBankMovement,
  unpostBankMovement,
  tryPostFromConciliation,
  resolveBankAccount,
};
