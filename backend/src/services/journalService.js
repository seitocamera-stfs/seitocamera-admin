/**
 * journalService — operacions sobre el Llibre Diari (partida doble).
 *
 * Convencions:
 *   - Deure i Haver com a strings/Number: el client Prisma retorna Decimal,
 *     el normalitzem amb toFixed(2) per evitar arrossegar errors d'arredoniment.
 *   - El número correlatiu (entryNumber) es genera DINS d'una transacció Prisma
 *     per evitar race conditions entre creacions concurrents.
 *   - Un assentament POSTED no es pot editar ni esborrar: només es pot REVERSAR
 *     amb un assentament d'inversió que el corregeix.
 *   - Un exercici locked bloqueja qualsevol operació d'escriptura sobre els seus
 *     assentaments.
 */
const { prisma } = require('../config/database');

const TOLERANCE = 0.005;  // ½ cèntim — per cobrir errors d'arredoniment

/**
 * Suma deure i haver d'una llista de línies.
 */
function totals(lines) {
  let debit = 0, credit = 0;
  for (const l of lines) {
    debit += Number(l.debit || 0);
    credit += Number(l.credit || 0);
  }
  return { debit: Math.round(debit * 100) / 100, credit: Math.round(credit * 100) / 100 };
}

/**
 * Verifica que les línies d'un assentament quadrin (Deure = Haver) i tinguin
 * almenys 2 línies amb import. Retorna { ok, message }.
 */
function validateBalanced(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    return { ok: false, message: 'Cal almenys 2 línies' };
  }
  for (const l of lines) {
    const d = Number(l.debit || 0);
    const c = Number(l.credit || 0);
    if (d < 0 || c < 0) return { ok: false, message: 'Imports negatius no permesos' };
    if (d > 0 && c > 0) return { ok: false, message: 'Una línia no pot tenir alhora deure i haver' };
    if (d === 0 && c === 0) return { ok: false, message: 'Línia sense import' };
  }
  const t = totals(lines);
  if (Math.abs(t.debit - t.credit) > TOLERANCE) {
    return { ok: false, message: `Assentament desquadrat: deure=${t.debit.toFixed(2)} ≠ haver=${t.credit.toFixed(2)}` };
  }
  return { ok: true, totals: t };
}

/**
 * Per a una data, retorna l'exercici fiscal corresponent (OPEN o CLOSING).
 * Llença error si la data cau fora de qualsevol exercici, o si l'exercici està
 * locked.
 */
async function resolveFiscalYear(companyId, date, { allowLocked = false } = {}) {
  const fy = await prisma.fiscalYear.findFirst({
    where: {
      companyId,
      startDate: { lte: date },
      endDate:   { gte: date },
    },
  });
  if (!fy) {
    throw new Error(`No hi ha cap exercici comptable definit per a la data ${date.toISOString().slice(0,10)}`);
  }
  if (fy.locked && !allowLocked) {
    throw new Error(`L'exercici ${fy.year} està bloquejat. Cal desbloquejar-lo abans de crear/editar assentaments.`);
  }
  return fy;
}

/**
 * Allotja el següent número correlatiu per un exercici. S'usa dins d'una
 * transacció per garantir unicitat en escenaris concurrents.
 */
async function nextEntryNumber(tx, companyId, fiscalYearId) {
  const last = await tx.journalEntry.findFirst({
    where: { companyId, fiscalYearId },
    orderBy: { entryNumber: 'desc' },
    select: { entryNumber: true },
  });
  return (last?.entryNumber || 0) + 1;
}

/**
 * Crea un assentament en estat DRAFT.
 *
 * @param {object} input
 * @param {string} input.companyId
 * @param {Date|string} input.date
 * @param {string} input.description
 * @param {string} [input.type] - JournalEntryType
 * @param {string} [input.source] - JournalEntrySource (default MANUAL)
 * @param {string} [input.sourceRef]
 * @param {Array<object>} input.lines - { accountId, debit, credit, description, projectId, vatRate, vatBase, irpfRate, irpfBase, sortOrder }
 * @param {string} input.createdById
 */
async function createDraft(input) {
  const date = new Date(input.date);
  const fy = await resolveFiscalYear(input.companyId, date);

  return prisma.$transaction(async (tx) => {
    const entryNumber = await nextEntryNumber(tx, input.companyId, fy.id);
    return tx.journalEntry.create({
      data: {
        companyId: input.companyId,
        fiscalYearId: fy.id,
        entryNumber,
        date,
        description: input.description,
        type: input.type || 'OTHER',
        source: input.source || 'MANUAL',
        sourceRef: input.sourceRef || null,
        status: 'DRAFT',
        createdById: input.createdById,
        lines: {
          create: (input.lines || []).map((l, idx) => ({
            accountId: l.accountId,
            debit: l.debit || 0,
            credit: l.credit || 0,
            description: l.description || null,
            counterpartyId: l.counterpartyId || null,
            counterpartyType: l.counterpartyType || null,
            projectId: l.projectId || null,
            vatRate: l.vatRate ?? null,
            vatBase: l.vatBase ?? null,
            irpfRate: l.irpfRate ?? null,
            irpfBase: l.irpfBase ?? null,
            sortOrder: l.sortOrder ?? idx,
          })),
        },
      },
      include: { lines: true },
    });
  });
}

/**
 * Actualitza un assentament. Només permès en estat DRAFT.
 * Substitueix totes les línies (delete + recreate) per simplicitat.
 */
async function update(id, patch, userId) {
  const existing = await prisma.journalEntry.findUnique({
    where: { id },
    include: { fiscalYear: true },
  });
  if (!existing) throw new Error('Assentament no trobat');
  if (existing.status !== 'DRAFT') {
    throw new Error('Només es poden editar assentaments en estat DRAFT. Per modificar un POSTED, fes un assentament d\'inversió.');
  }
  if (existing.fiscalYear.locked) {
    throw new Error(`L'exercici ${existing.fiscalYear.year} està bloquejat`);
  }

  const newDate = patch.date ? new Date(patch.date) : existing.date;
  // Si la data canvia, validem que el nou exercici és vàlid (i mantenim el mateix entryNumber només si l'exercici no canvia)
  let newFiscalYearId = existing.fiscalYearId;
  let newEntryNumber = existing.entryNumber;
  if (patch.date && newDate.getTime() !== existing.date.getTime()) {
    const fy = await resolveFiscalYear(existing.companyId, newDate);
    if (fy.id !== existing.fiscalYearId) {
      newFiscalYearId = fy.id;
      // Cal nou correlatiu si canvia d'exercici
      newEntryNumber = await prisma.$transaction(async (tx) => nextEntryNumber(tx, existing.companyId, fy.id));
    }
  }

  return prisma.$transaction(async (tx) => {
    if (Array.isArray(patch.lines)) {
      await tx.journalLine.deleteMany({ where: { journalEntryId: id } });
    }
    return tx.journalEntry.update({
      where: { id },
      data: {
        date: newDate,
        description: patch.description ?? existing.description,
        type: patch.type ?? existing.type,
        sourceRef: patch.sourceRef ?? existing.sourceRef,
        fiscalYearId: newFiscalYearId,
        entryNumber: newEntryNumber,
        ...(Array.isArray(patch.lines) && {
          lines: {
            create: patch.lines.map((l, idx) => ({
              accountId: l.accountId,
              debit: l.debit || 0,
              credit: l.credit || 0,
              description: l.description || null,
              counterpartyId: l.counterpartyId || null,
              counterpartyType: l.counterpartyType || null,
              projectId: l.projectId || null,
              vatRate: l.vatRate ?? null,
              vatBase: l.vatBase ?? null,
              irpfRate: l.irpfRate ?? null,
              irpfBase: l.irpfBase ?? null,
              sortOrder: l.sortOrder ?? idx,
            })),
          },
        }),
      },
      include: { lines: true },
    });
  });
}

/**
 * Comptabilitza un assentament: DRAFT → POSTED. Valida quadrament Deure=Haver
 * i que l'exercici no estigui bloquejat.
 */
async function post(id, userId) {
  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: { lines: true, fiscalYear: true },
  });
  if (!entry) throw new Error('Assentament no trobat');
  if (entry.status === 'POSTED') return entry;
  if (entry.status === 'REVERSED') throw new Error('Aquest assentament està anul·lat');
  if (entry.fiscalYear.locked) {
    throw new Error(`L'exercici ${entry.fiscalYear.year} està bloquejat`);
  }

  const v = validateBalanced(entry.lines);
  if (!v.ok) throw new Error(v.message);

  return prisma.journalEntry.update({
    where: { id },
    data: {
      status: 'POSTED',
      postedById: userId,
      postedAt: new Date(),
    },
    include: { lines: true },
  });
}

/**
 * Anul·la un assentament POSTED creant un assentament d'inversió que
 * inverteix les línies (debit ↔ credit). Marca l'original com REVERSED.
 */
async function reverse(id, userId, reason = '') {
  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: { lines: true, fiscalYear: true },
  });
  if (!entry) throw new Error('Assentament no trobat');
  if (entry.status !== 'POSTED') {
    throw new Error('Només es poden anul·lar assentaments POSTED');
  }
  if (entry.fiscalYear.locked) {
    throw new Error(`L'exercici ${entry.fiscalYear.year} està bloquejat`);
  }

  return prisma.$transaction(async (tx) => {
    const newNumber = await nextEntryNumber(tx, entry.companyId, entry.fiscalYearId);
    const reversal = await tx.journalEntry.create({
      data: {
        companyId: entry.companyId,
        fiscalYearId: entry.fiscalYearId,
        entryNumber: newNumber,
        date: new Date(),
        description: `Anul·lació #${entry.entryNumber}` + (reason ? ` — ${reason}` : ''),
        type: 'ADJUSTMENT',
        source: entry.source,
        sourceRef: entry.sourceRef,
        status: 'POSTED',
        reversesId: entry.id,
        createdById: userId,
        postedById: userId,
        postedAt: new Date(),
        lines: {
          create: entry.lines.map((l, idx) => ({
            accountId: l.accountId,
            debit: Number(l.credit) || 0,    // inverteixen
            credit: Number(l.debit) || 0,
            description: l.description ? `Anul·lació: ${l.description}` : null,
            counterpartyId: l.counterpartyId,
            counterpartyType: l.counterpartyType,
            projectId: l.projectId,
            vatRate: l.vatRate,
            vatBase: l.vatBase ? -Number(l.vatBase) : null,
            irpfRate: l.irpfRate,
            irpfBase: l.irpfBase ? -Number(l.irpfBase) : null,
            sortOrder: l.sortOrder ?? idx,
          })),
        },
      },
      include: { lines: true },
    });

    await tx.journalEntry.update({
      where: { id: entry.id },
      data: { status: 'REVERSED', reversedById: reversal.id },
    });

    return reversal;
  });
}

/**
 * Esborra un assentament. Només permès en estat DRAFT.
 */
async function remove(id) {
  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: { fiscalYear: true },
  });
  if (!entry) throw new Error('Assentament no trobat');
  if (entry.status !== 'DRAFT') {
    throw new Error('Només es poden esborrar assentaments DRAFT. Per anul·lar un POSTED, usa l\'opció Anul·lar.');
  }
  if (entry.fiscalYear.locked) {
    throw new Error(`L'exercici ${entry.fiscalYear.year} està bloquejat`);
  }
  await prisma.journalEntry.delete({ where: { id } });
}

module.exports = {
  totals,
  validateBalanced,
  resolveFiscalYear,
  nextEntryNumber,
  createDraft,
  update,
  post,
  reverse,
  remove,
};
