/**
 * agentScanService — Detecció proactiva (Sprint Agent IA).
 *
 * Recorre l'estat del sistema i retorna observacions ordenades per
 * urgència que l'agent gestor pot proposar a l'usuari. No fa cap canvi:
 * només detecta i descriu.
 *
 * Cada observació té:
 *   - id           identificador estable per evitar duplicats al frontend
 *   - severity     'urgent' | 'high' | 'normal' | 'info'
 *   - category     'POSTING' | 'BANK' | 'OVERDUE' | 'TAX' | 'AMORTIZATION' | 'CLOSING' | 'DATA_QUALITY'
 *   - title        text curt humanitzat
 *   - description  detalls + suggeriment d'acció
 *   - count        nombre d'elements afectats (si aplica)
 *   - actionLabel  text del botó suggerit
 *   - actionUrl    URL relativa de la pàgina on actuar
 *   - actionPayload (opcional) dades per cridar un endpoint d'acció directa
 */
const { prisma } = require('../config/database');

const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

async function scan(opts = {}) {
  const company = await prisma.company.findFirst();
  if (!company) {
    return { items: [{ id: 'no-company', severity: 'urgent', category: 'DATA_QUALITY',
      title: 'Cap empresa configurada', description: 'Cal omplir les dades fiscals abans de fer res més.',
      actionLabel: 'Configurar empresa', actionUrl: '/company/settings' }] };
  }

  const today = new Date();
  const items = [];

  await Promise.all([
    detectPendingReceivedInvoicePostings(company, items),
    detectPendingIssuedInvoicePostings(company, items),
    detectPendingBankPostings(company, items),
    detectDraftJournalEntries(company, items),
    detectOverdueIssuedInvoices(company, today, items),
    detectOverdueReceivedInvoices(company, today, items),
    detectPendingAmortizations(company, today, items),
    detectVatPeriodsToFile(company, today, items),
    detectFiscalYearReadyToClose(company, today, items),
    detectInvoicesWithoutSupplier(company, items),
    detectFixedAssetCandidates(company, items),
  ]);

  // Ordenar per severitat
  const order = { urgent: 0, high: 1, normal: 2, info: 3 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);

  return { generatedAt: today.toISOString(), companyName: company.legalName, items };
}

// ----------------------- DETECTORS -----------------------

async function detectPendingReceivedInvoicePostings(company, items) {
  const count = await prisma.receivedInvoice.count({
    where: {
      deletedAt: null,
      journalEntryId: null,
      origin: { not: 'LOGISTIK' },
      status: { in: ['REVIEWED', 'APPROVED', 'PAID', 'PARTIALLY_PAID'] },
    },
  });
  if (count > 0) {
    items.push({
      id: 'pending-received-postings',
      severity: count > 20 ? 'high' : 'normal',
      category: 'POSTING',
      title: `${count} factures rebudes per comptabilitzar`,
      description: `Tens ${count} factures revisades pendents de generar el seu assentament al Llibre Diari. Sense això no apareixen al balanç ni als models AEAT.`,
      count,
      actionLabel: 'Comptabilitzar totes',
      actionUrl: '/invoices/received',
    });
  }
}

async function detectPendingIssuedInvoicePostings(company, items) {
  const count = await prisma.issuedInvoice.count({
    where: { journalEntryId: null, status: { in: ['PENDING', 'APPROVED', 'PAID', 'PARTIALLY_PAID'] } },
  });
  if (count > 0) {
    items.push({
      id: 'pending-issued-postings',
      severity: count > 20 ? 'high' : 'normal',
      category: 'POSTING',
      title: `${count} factures emeses per comptabilitzar`,
      description: `Tens ${count} factures emeses pendents de generar l'assentament. Afecta els ingressos del Compte P&G i el càlcul del 303.`,
      count,
      actionLabel: 'Comptabilitzar emeses',
      actionUrl: '/invoices/issued',
    });
  }
}

async function detectPendingBankPostings(company, items) {
  const count = await prisma.bankMovement.count({
    where: {
      journalEntryId: null,
      isDismissed: false,
      conciliations: { some: { status: 'CONFIRMED' } },
    },
  });
  if (count > 0) {
    items.push({
      id: 'pending-bank-postings',
      severity: 'normal',
      category: 'BANK',
      title: `${count} cobraments/pagaments per comptabilitzar`,
      description: `Hi ha ${count} moviments bancaris ja conciliats amb factures però que no han generat l'assentament. El saldo del compte 572 no quadra amb el banc.`,
      count,
      actionLabel: 'Veure moviments',
      actionUrl: '/bank',
    });
  }
}

async function detectDraftJournalEntries(company, items) {
  const count = await prisma.journalEntry.count({
    where: { companyId: company.id, status: 'DRAFT' },
  });
  if (count > 0) {
    items.push({
      id: 'draft-journal-entries',
      severity: 'normal',
      category: 'POSTING',
      title: `${count} assentaments en esborrany`,
      description: `Hi ha ${count} assentaments al diari encara en estat DRAFT. Cal comptabilitzar-los o esborrar-los, sobretot si penses tancar exercici.`,
      count,
      actionLabel: 'Veure llibre diari',
      actionUrl: '/journal?status=DRAFT',
    });
  }
}

async function detectOverdueIssuedInvoices(company, today, items) {
  const limit = new Date(today); limit.setDate(today.getDate() - 7);  // venciments fa més de 7 dies
  const overdue = await prisma.issuedInvoice.findMany({
    where: { dueDate: { lte: today, not: null }, status: { notIn: ['PAID'] }, paidAmount: { lt: prisma.issuedInvoice.fields.totalAmount } },
    select: { id: true, invoiceNumber: true, totalAmount: true, paidAmount: true, dueDate: true, client: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
    take: 20,
  });
  if (overdue.length > 0) {
    const totalUnpaid = round2(overdue.reduce((s, i) => s + (Number(i.totalAmount) - Number(i.paidAmount || 0)), 0));
    items.push({
      id: 'overdue-issued',
      severity: overdue.length > 5 ? 'urgent' : 'high',
      category: 'OVERDUE',
      title: `${overdue.length} factures emeses vençudes (${totalUnpaid.toFixed(2)} €)`,
      description: `Hi ha clients que t'han de pagar ${totalUnpaid.toFixed(2)} € amb venciment passat. Considera enviar recordatoris.`,
      count: overdue.length,
      actionLabel: 'Veure factures emeses',
      actionUrl: '/invoices/issued?status=PENDING',
      details: overdue.slice(0, 5).map((i) => ({
        text: `${i.client?.name || '?'} · ${i.invoiceNumber} · ${(Number(i.totalAmount) - Number(i.paidAmount || 0)).toFixed(2)} € · venç ${i.dueDate.toISOString().slice(0, 10)}`,
      })),
    });
  }
}

async function detectOverdueReceivedInvoices(company, today, items) {
  const overdue = await prisma.receivedInvoice.findMany({
    where: {
      deletedAt: null, isDuplicate: false,
      dueDate: { lte: today, not: null },
      status: { notIn: ['PAID', 'REJECTED', 'NOT_INVOICE'] },
      paidAmount: { lt: prisma.receivedInvoice.fields.totalAmount },
    },
    select: { id: true, invoiceNumber: true, totalAmount: true, paidAmount: true, dueDate: true, supplier: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
    take: 20,
  });
  if (overdue.length > 0) {
    const totalUnpaid = round2(overdue.reduce((s, i) => s + (Number(i.totalAmount) - Number(i.paidAmount || 0)), 0));
    items.push({
      id: 'overdue-received',
      severity: overdue.length > 5 ? 'high' : 'normal',
      category: 'OVERDUE',
      title: `${overdue.length} factures rebudes vençudes (${totalUnpaid.toFixed(2)} €)`,
      description: `Tens ${totalUnpaid.toFixed(2)} € pendents de pagar a proveïdors amb venciment passat.`,
      count: overdue.length,
      actionLabel: 'Veure factures rebudes',
      actionUrl: '/invoices/received',
      details: overdue.slice(0, 5).map((i) => ({
        text: `${i.supplier?.name || '?'} · ${i.invoiceNumber} · ${(Number(i.totalAmount) - Number(i.paidAmount || 0)).toFixed(2)} € · venç ${i.dueDate.toISOString().slice(0, 10)}`,
      })),
    });
  }
}

async function detectPendingAmortizations(company, today, items) {
  const lastMonth = today.getMonth() === 0 ? 12 : today.getMonth();
  const yearOfLast = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
  const count = await prisma.amortizationEntry.count({
    where: { year: yearOfLast, month: lastMonth, status: 'PENDING', fixedAsset: { status: 'ACTIVE' } },
  });
  if (count > 0) {
    items.push({
      id: 'pending-amortizations',
      severity: 'normal',
      category: 'AMORTIZATION',
      title: `${count} amortitzacions del mes ${String(lastMonth).padStart(2, '0')}/${yearOfLast} pendents`,
      description: `Hi ha ${count} quotes mensuals d'amortització ja generades al calendari però no comptabilitzades. La despesa d'amortització no apareix al P&G.`,
      count,
      actionLabel: 'Comptabilitzar mes',
      actionUrl: '/amortization-calendar',
    });
  }
}

async function detectVatPeriodsToFile(company, today, items) {
  // Quins trimestres del passat tenen activitat sense regularitzar?
  // MVP: avisem si estem dins els 20 dies següents al final d'un trimestre
  const month = today.getMonth() + 1;
  const day = today.getDate();
  // Q1 (gener-març) → declaració abans del 20 abril
  // Q2 → 20 juliol; Q3 → 20 octubre; Q4 → 30 gener (any següent)
  const upcomingDeclarations = [
    { quarter: 1, deadline: new Date(today.getFullYear(), 3, 20) },
    { quarter: 2, deadline: new Date(today.getFullYear(), 6, 20) },
    { quarter: 3, deadline: new Date(today.getFullYear(), 9, 20) },
    { quarter: 4, deadline: new Date(today.getFullYear() + 1, 0, 30) },
  ];
  for (const d of upcomingDeclarations) {
    const daysToDeadline = Math.ceil((d.deadline - today) / (1000 * 60 * 60 * 24));
    if (daysToDeadline >= 0 && daysToDeadline <= 30) {
      items.push({
        id: `vat-q${d.quarter}-${today.getFullYear()}`,
        severity: daysToDeadline <= 7 ? 'urgent' : 'high',
        category: 'TAX',
        title: `Declaració d'IVA Q${d.quarter} ${today.getFullYear()} en ${daysToDeadline} dies`,
        description: `Termini per presentar el Model 303 del Q${d.quarter}: ${d.deadline.toISOString().slice(0, 10)}. Revisa que totes les factures estiguin comptabilitzades.`,
        actionLabel: 'Veure Model 303',
        actionUrl: `/fiscal?quarter=${d.quarter}&year=${today.getFullYear()}`,
      });
    }
  }
}

async function detectFiscalYearReadyToClose(company, today, items) {
  // Avisar a partir de gener si l'exercici anterior encara no està tancat
  const prevYear = today.getMonth() < 3 ? today.getFullYear() - 1 : null;
  if (!prevYear) return;
  const fy = await prisma.fiscalYear.findUnique({ where: { companyId_year: { companyId: company.id, year: prevYear } } });
  if (fy && !fy.locked) {
    items.push({
      id: `close-${prevYear}`,
      severity: 'high',
      category: 'CLOSING',
      title: `L'exercici ${prevYear} encara no està tancat`,
      description: `Estem a Q1 i l'exercici ${prevYear} segueix obert. Cal regularitzar IVA Q4, comptabilitzar IS i tancar.`,
      actionLabel: 'Iniciar tancament',
      actionUrl: '/year-closing',
    });
  }
}

async function detectInvoicesWithoutSupplier(company, items) {
  const count = await prisma.receivedInvoice.count({
    where: { deletedAt: null, isDuplicate: false, supplierId: null, status: { notIn: ['NOT_INVOICE', 'REJECTED'] } },
  });
  if (count > 0) {
    items.push({
      id: 'invoices-no-supplier',
      severity: 'normal',
      category: 'DATA_QUALITY',
      title: `${count} factures rebudes sense proveïdor assignat`,
      description: `Aquestes factures no es poden comptabilitzar fins que tinguin un proveïdor vinculat (per a la contrapart 410xxxx).`,
      count,
      actionLabel: 'Revisar factures',
      actionUrl: '/invoices/received',
    });
  }
}

async function detectFixedAssetCandidates(company, items) {
  // Factures de subgrup 21x ja comptabilitzades però sense FixedAsset associat
  const candidates = await prisma.receivedInvoice.findMany({
    where: {
      journalEntryId: { not: null },
      account: { code: { startsWith: '21' } },
      fixedAssets: { none: {} },
    },
    select: { id: true, invoiceNumber: true, totalAmount: true, supplier: { select: { name: true } } },
    take: 10,
  });
  if (candidates.length > 0) {
    items.push({
      id: 'missing-fixed-assets',
      severity: 'normal',
      category: 'DATA_QUALITY',
      title: `${candidates.length} factures d'inversió sense fitxa d'immobilitzat`,
      description: `Aquestes factures s'han comptabilitzat com a inversió però no tenen FixedAsset creat. Sense fitxa no es pot generar el calendari d'amortitzacions.`,
      count: candidates.length,
      actionLabel: 'Crear immobilitzats',
      actionUrl: '/fixed-assets',
      details: candidates.slice(0, 5).map((c) => ({
        text: `${c.supplier?.name || '?'} · ${c.invoiceNumber} · ${Number(c.totalAmount).toFixed(2)} €`,
      })),
    });
  }
}

module.exports = { scan };
