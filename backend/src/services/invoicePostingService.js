/**
 * invoicePostingService — Comptabilització de factures (Sprint 3).
 *
 * Genera el JournalEntry corresponent a una factura rebuda o emesa, vinculant
 * els subcomptes adequats (despesa/ingrés, IVA suportat/repercutit, retenció
 * IRPF, contrapart 410/430).
 *
 * Decisions clau:
 *   - Excloem `origin = 'LOGISTIK'` (factures pujades manualment a "Compartides"
 *     que reflecteixen factures que paga Logistik, no Seito).
 *   - Si la factura no té `accountId` però té `pgcAccount` text llegible,
 *     intentem resoldre'l per codi (autoresolveByCode).
 *   - Si la factura no té compte resolt en absolut, llencem error per
 *     que el caller decideixi si crida l'agent IA.
 *   - El subcompte 410/430 individual del proveïdor/client es crea automàticament
 *     si no existeix (i es guarda a Supplier/Client per a futures factures).
 */
const { prisma } = require('../config/database');
const journalService = require('./journalService');
const fixedAssetService = require('./fixedAssetService');

// 2 cèntims — algunes factures de l'OCR del proveïdor arrosseguen errors
// d'arrodoniment doble (subtotal mostrat + IVA mostrat ≠ total mostrat).
// Real-world: 47.105 vs 47.11, 10654.485 vs 10654.49.
const TOLERANCE = 0.02;

function n(v) { return v == null ? 0 : Number(v); }
function round2(v) { return Math.round(v * 100) / 100; }

/**
 * Resol l'empresa per defecte (al MVP n'hi ha una sola).
 */
async function resolveCompany() {
  const c = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!c) throw new Error('Cap empresa configurada. Cal executar el seed o crear-la des de la UI.');
  return c;
}

/**
 * Cerca un compte mestre del sistema per codi exacte (ex: "472000", "4751", "705000").
 */
async function getSystemAccount(companyId, code) {
  const acc = await prisma.chartOfAccount.findUnique({
    where: { companyId_code: { companyId, code } },
  });
  if (!acc) throw new Error(`Falta el compte ${code} al pla. Executa el seed PGC.`);
  return acc;
}

/**
 * Si la factura porta `pgcAccount` text (ex. "629" o "629000"), prova de mapejar-ho
 * a un subcompte real del pla (afegint "000" si cal).
 */
async function autoresolveAccountFromText(companyId, pgcAccountText) {
  if (!pgcAccountText) return null;
  const txt = String(pgcAccountText).trim();
  // Probar codi exacte i, si no existeix, codi + "000"
  const candidates = [txt, txt + '000', txt + '00', txt + '0'];
  for (const code of candidates) {
    const acc = await prisma.chartOfAccount.findUnique({
      where: { companyId_code: { companyId, code } },
    });
    if (acc?.isLeaf) return acc;
  }
  return null;
}

/**
 * Genera el següent codi correlatiu de subcompte sota un parent. Format: parent + 4 dígits.
 */
async function nextCounterpartyCode(companyId, prefix) {
  const all = await prisma.chartOfAccount.findMany({
    where: { companyId, code: { startsWith: prefix } },
    select: { code: true },
  });
  let max = 0;
  for (const a of all) {
    if (a.code.length !== prefix.length + 4) continue;
    const tail = parseInt(a.code.slice(prefix.length), 10);
    if (!Number.isNaN(tail) && tail > max) max = tail;
  }
  return prefix + String(max + 1).padStart(4, '0');
}

/**
 * Garanteix que un Supplier/Client té el seu subcompte 410/430. Si no, el crea
 * i el guarda a la fitxa.
 */
async function ensureCounterpartyAccount(party, type /* 'SUPPLIER' | 'CLIENT' */) {
  if (party.counterpartyAccountId) {
    return prisma.chartOfAccount.findUnique({ where: { id: party.counterpartyAccountId } });
  }

  const company = await resolveCompany();
  const cfg = type === 'SUPPLIER'
    ? { prefix: '410', parentCode: '410', accType: 'LIABILITY', subtype: 'CREDITOR', table: 'supplier' }
    : { prefix: '430', parentCode: '430', accType: 'ASSET', subtype: 'CLIENT', table: 'client' };

  const parent = await getSystemAccount(company.id, cfg.parentCode);
  const code = await nextCounterpartyCode(company.id, cfg.prefix);

  const created = await prisma.chartOfAccount.create({
    data: {
      companyId: company.id,
      code,
      name: party.name.slice(0, 200),
      type: cfg.accType,
      level: 3,
      isLeaf: true,
      parentId: parent.id,
      isSystem: false,
      subtype: cfg.subtype,
    },
  });

  await prisma[cfg.table].update({
    where: { id: party.id },
    data: { counterpartyAccountId: created.id },
  });

  return created;
}

/**
 * Construeix les línies de l'assentament d'una factura rebuda.
 *
 *  Deure  6xx (despesa) o 2xx (immobilitzat)   subtotal
 *  Deure  472 (IVA suportat)                   taxAmount      (si > 0)
 *    Haver 410xxx (proveïdor)                  totalAmount    (= subtotal + IVA - IRPF)
 *    Haver 4751 (H.P. retencions IRPF)         irpfAmount     (si > 0)
 */
function buildReceivedLines({ accountId, vatAccountId, irpfAccountId, counterpartyAccountId, supplierId, invoice }) {
  const subtotal = n(invoice.subtotal);
  const tax = n(invoice.taxAmount);
  const irpf = n(invoice.irpfAmount);
  const total = n(invoice.totalAmount);

  // Notes de crèdit / abonaments: total < 0. Inverteixim deure↔haver per
  // mantenir el contracte `xor_debit_credit` (cap línia amb import negatiu).
  // Semàntica: "li devem MENYS al proveïdor + ens torna l'IVA suportat".
  const isCreditNote = total < 0;
  const D = (val) => round2(Math.abs(val));  // helper: import absolut arrodonit
  const lines = [];

  lines.push({
    accountId,
    debit: isCreditNote ? 0 : D(subtotal),
    credit: isCreditNote ? D(subtotal) : 0,
    description: invoice.description || `${isCreditNote ? 'Abonament' : 'Factura'} ${invoice.invoiceNumber}`,
    counterpartyId: supplierId,
    counterpartyType: 'SUPPLIER',
    sortOrder: 0,
  });
  if (Math.abs(tax) > 0.005) {
    lines.push({
      accountId: vatAccountId,
      debit: isCreditNote ? 0 : D(tax),
      credit: isCreditNote ? D(tax) : 0,
      description: `IVA suportat ${n(invoice.taxRate)}%${isCreditNote ? ' (abonament)' : ''}`,
      vatRate: n(invoice.taxRate),
      vatBase: D(subtotal),
      sortOrder: 1,
    });
  }
  lines.push({
    accountId: counterpartyAccountId,
    debit: isCreditNote ? D(total) : 0,
    credit: isCreditNote ? 0 : D(total),
    description: invoice.description || `${isCreditNote ? 'Abonament' : 'Factura'} ${invoice.invoiceNumber}`,
    counterpartyId: supplierId,
    counterpartyType: 'SUPPLIER',
    sortOrder: 2,
  });
  if (Math.abs(irpf) > 0.005) {
    lines.push({
      accountId: irpfAccountId,
      debit: isCreditNote ? D(irpf) : 0,
      credit: isCreditNote ? 0 : D(irpf),
      description: `Retenció IRPF ${n(invoice.irpfRate)}%${isCreditNote ? ' (abonament)' : ''}`,
      irpfRate: n(invoice.irpfRate),
      irpfBase: D(subtotal),
      sortOrder: 3,
    });
  }
  return lines;
}

/**
 * Construeix les línies de l'assentament d'una factura emesa.
 *
 *  Deure  430xxx (client)                  totalAmount
 *    Haver 70x / 75x (ingrés)              subtotal
 *    Haver 477 (IVA repercutit)            taxAmount   (si > 0)
 */
function buildIssuedLines({ accountId, vatAccountId, counterpartyAccountId, clientId, invoice }) {
  const subtotal = n(invoice.subtotal);
  const tax = n(invoice.taxAmount);
  const total = n(invoice.totalAmount);

  // Notes de crèdit / abonaments emesos (rectificatives): total < 0.
  // Invertim deure↔haver per evitar imports negatius a journal_lines.
  const isCreditNote = total < 0;
  const D = (val) => round2(Math.abs(val));
  const lines = [];

  lines.push({
    accountId: counterpartyAccountId,
    debit: isCreditNote ? 0 : D(total),
    credit: isCreditNote ? D(total) : 0,
    description: invoice.description || `${isCreditNote ? 'Abonament' : 'Factura'} ${invoice.invoiceNumber}`,
    counterpartyId: clientId,
    counterpartyType: 'CLIENT',
    sortOrder: 0,
  });
  lines.push({
    accountId,
    debit: isCreditNote ? D(subtotal) : 0,
    credit: isCreditNote ? 0 : D(subtotal),
    description: invoice.description || `${isCreditNote ? 'Abonament' : 'Factura'} ${invoice.invoiceNumber}`,
    counterpartyId: clientId,
    counterpartyType: 'CLIENT',
    sortOrder: 1,
  });
  if (Math.abs(tax) > 0.005) {
    lines.push({
      accountId: vatAccountId,
      debit: isCreditNote ? D(tax) : 0,
      credit: isCreditNote ? 0 : D(tax),
      description: `IVA repercutit ${n(invoice.taxRate)}%${isCreditNote ? ' (abonament)' : ''}`,
      vatRate: n(invoice.taxRate),
      vatBase: D(subtotal),
      sortOrder: 2,
    });
  }
  return lines;
}

// ====================================================================
// Comptabilització de factures rebudes
// ====================================================================
async function postReceivedInvoice(invoiceId, { userId, agent } = {}) {
  const invoice = await prisma.receivedInvoice.findUnique({
    where: { id: invoiceId },
    include: { supplier: true, account: true, counterpartyAccount: true },
  });
  if (!invoice) throw new Error('Factura no trobada');
  if (invoice.deletedAt) throw new Error('Factura eliminada (paperera)');
  if (invoice.journalEntryId) throw new Error('Aquesta factura ja està comptabilitzada');
  if (invoice.origin === 'LOGISTIK') {
    throw new Error('Factura amb origin=LOGISTIK: no es comptabilitza a Seito (factura de Compartides pujada manualment)');
  }
  if (!invoice.supplier) throw new Error('Cal vincular un proveïdor abans de comptabilitzar');

  const company = await resolveCompany();

  // 1. Resoldre accountId
  let accountId = invoice.accountId;
  let resolvedByAgent = false;
  let agentSuggestionId = null;

  if (!accountId) {
    // Mira al default del proveïdor
    if (invoice.supplier.defaultExpenseAccountId) {
      accountId = invoice.supplier.defaultExpenseAccountId;
    } else {
      // Mira si hi ha pgcAccount text (legacy)
      const found = await autoresolveAccountFromText(company.id, invoice.pgcAccount);
      if (found) accountId = found.id;
    }
  }

  if (!accountId && agent && typeof agent.classifyForAccount === 'function') {
    const result = await agent.classifyForAccount(invoiceId);
    accountId = result?.accountId;
    agentSuggestionId = result?.suggestionId || null;
    resolvedByAgent = Boolean(accountId);
  }

  if (!accountId) {
    throw new Error('No es pot resoldre el compte de despesa. Tria\'n un manualment o classifica la factura amb l\'agent.');
  }

  // 2. Resoldre counterparty del proveïdor (subcompte 410xxxx)
  const counterpartyAccount = await ensureCounterpartyAccount(invoice.supplier, 'SUPPLIER');

  // 3. Comptes del sistema (IVA suportat, IRPF practicat) — usem Math.abs
  // perquè abonaments tenen taxAmount/irpfAmount negatius
  const vatAccount  = Math.abs(n(invoice.taxAmount))  > 0.005 ? await getSystemAccount(company.id, '472000') : null;
  const irpfAccount = Math.abs(n(invoice.irpfAmount)) > 0.005 ? await getSystemAccount(company.id, '4751')   : null;

  // 4. Validació numèrica abans de cridar el diari
  const sumDeure  = round2(n(invoice.subtotal) + n(invoice.taxAmount));
  const sumHaver  = round2(n(invoice.totalAmount) + n(invoice.irpfAmount));
  if (Math.abs(sumDeure - sumHaver) > TOLERANCE) {
    throw new Error(`Factura desquadrada: subtotal + IVA (${sumDeure.toFixed(2)}) ≠ total + IRPF (${sumHaver.toFixed(2)})`);
  }

  // 5. Construir línies + crear assentament en DRAFT i fer POST
  const lines = buildReceivedLines({
    accountId,
    vatAccountId: vatAccount?.id,
    irpfAccountId: irpfAccount?.id,
    counterpartyAccountId: counterpartyAccount.id,
    supplierId: invoice.supplierId,
    invoice,
  });

  const draft = await journalService.createDraft({
    companyId: company.id,
    date: invoice.issueDate,
    description: `Factura ${invoice.invoiceNumber} — ${invoice.supplier.name}`,
    type: 'RECEIVED_INVOICE',
    source: resolvedByAgent ? 'AGENT' : 'AUTO_INVOICE',
    sourceRef: invoice.id,
    lines,
    createdById: userId,
  });
  const posted = await journalService.post(draft.id, userId);

  // 6. Vincular factura amb assentament i compte
  const updated = await prisma.receivedInvoice.update({
    where: { id: invoice.id },
    data: {
      companyId: company.id,
      accountId,
      counterpartyAccountId: counterpartyAccount.id,
      journalEntryId: posted.id,
      postedAt: new Date(),
    },
    include: { account: true, counterpartyAccount: true, journalEntry: { include: { lines: true } } },
  });

  // 7. Si el compte és d'immobilitzat amortizable, crear FixedAsset + calendari.
  // Cobertura: 206 (aplicacions informàtiques), 207 (drets traspàs), 21x sencer
  // (instal·lacions, maquinària, mobiliari, EPI, transport...). Excloem 210 (terrenys)
  // perquè no s'amortitzen i 211 (construccions) que tenen lògica separada.
  let fixedAsset = null;
  const code = updated.account?.code || '';
  const isAmortizableAsset = updated.account?.type === 'ASSET' && (
    /^20[67]/.test(code) ||
    /^21[2-9]/.test(code)
  );
  if (isAmortizableAsset) {
    try {
      fixedAsset = await fixedAssetService.createFromInvoice({
        invoiceId: updated.id,
        accountCode: updated.account.code,
      });
    } catch (e) {
      // No bloqueja la comptabilització si la generació de FA falla
      // (només es queda sense calendari, l'usuari ho pot crear manualment després)
    }
  }

  return { invoice: updated, journalEntry: posted, resolvedByAgent, agentSuggestionId, fixedAsset };
}

// ====================================================================
// Comptabilització de factures emeses
// ====================================================================
async function postIssuedInvoice(invoiceId, { userId } = {}) {
  const invoice = await prisma.issuedInvoice.findUnique({
    where: { id: invoiceId },
    include: { client: true, account: true, counterpartyAccount: true },
  });
  if (!invoice) throw new Error('Factura no trobada');
  if (invoice.journalEntryId) throw new Error('Aquesta factura ja està comptabilitzada');
  if (!invoice.client) throw new Error('Cal vincular un client');

  const company = await resolveCompany();

  // 1. Resoldre accountId d'ingrés
  let accountId = invoice.accountId
    || invoice.client.defaultRevenueAccountId
    || (await getSystemAccount(company.id, '705000')).id;  // Per defecte: prestacions de serveis (Seito = lloguer d'equip)

  // 2. Resoldre counterparty del client (subcompte 430xxxx)
  const counterpartyAccount = await ensureCounterpartyAccount(invoice.client, 'CLIENT');

  // 3. Comptes del sistema (IVA repercutit)
  const vatAccount = Math.abs(n(invoice.taxAmount)) > 0.005 ? await getSystemAccount(company.id, '477000') : null;

  // 4. Validació numèrica
  const sumDeure  = round2(n(invoice.totalAmount));
  const sumHaver  = round2(n(invoice.subtotal) + n(invoice.taxAmount));
  if (Math.abs(sumDeure - sumHaver) > TOLERANCE) {
    throw new Error(`Factura desquadrada: total (${sumDeure.toFixed(2)}) ≠ subtotal + IVA (${sumHaver.toFixed(2)})`);
  }

  const lines = buildIssuedLines({
    accountId,
    vatAccountId: vatAccount?.id,
    counterpartyAccountId: counterpartyAccount.id,
    clientId: invoice.clientId,
    invoice,
  });

  const draft = await journalService.createDraft({
    companyId: company.id,
    date: invoice.issueDate,
    description: `Factura ${invoice.invoiceNumber} a ${invoice.client.name}`,
    type: 'ISSUED_INVOICE',
    source: 'AUTO_INVOICE',
    sourceRef: invoice.id,
    lines,
    createdById: userId,
  });
  const posted = await journalService.post(draft.id, userId);

  const updated = await prisma.issuedInvoice.update({
    where: { id: invoice.id },
    data: {
      companyId: company.id,
      accountId,
      counterpartyAccountId: counterpartyAccount.id,
      journalEntryId: posted.id,
      postedAt: new Date(),
    },
    include: { account: true, counterpartyAccount: true, journalEntry: { include: { lines: true } } },
  });

  return { invoice: updated, journalEntry: posted };
}

// ====================================================================
// Reverteix la comptabilització: anul·la l'assentament i desvincula la factura
// ====================================================================
async function unpostInvoice(invoiceType /* 'RECEIVED' | 'ISSUED' */, invoiceId, { userId, reason } = {}) {
  const model = invoiceType === 'RECEIVED' ? 'receivedInvoice' : 'issuedInvoice';
  const invoice = await prisma[model].findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new Error('Factura no trobada');
  if (!invoice.journalEntryId) throw new Error('Aquesta factura no està comptabilitzada');

  await journalService.reverse(invoice.journalEntryId, userId, reason || 'Anul·lació de la comptabilització de la factura');

  const updated = await prisma[model].update({
    where: { id: invoiceId },
    data: { journalEntryId: null, postedAt: null },
  });

  return updated;
}

module.exports = {
  postReceivedInvoice,
  postIssuedInvoice,
  unpostInvoice,
  // Exposar helpers per als tests / backfill
  resolveCompany,
  getSystemAccount,
  autoresolveAccountFromText,
  ensureCounterpartyAccount,
};
