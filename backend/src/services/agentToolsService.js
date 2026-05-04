/**
 * agentToolsService — Conjunt de tools que el gestor IA pot invocar.
 *
 * Filosofia: l'agent NO executa accions destructives (POST/REVERSE/DELETE/CLOSE)
 * directament. Per a aquestes accions, retorna un objecte de proposta (`proposal`)
 * que el frontend mostra com a botó d'aprovació explícita. Així l'usuari sempre
 * autoritza els canvis irreversibles.
 *
 * Tools de LECTURA (executen lliurement):
 *   - get_overview              Resum global de l'estat
 *   - list_pending_postings     Factures REVIEWED no comptabilitzades
 *   - list_overdue              Factures vençudes
 *   - get_balance_sheet         Balanç a una data
 *   - get_profit_loss           Compte P&G d'un període
 *   - get_tax_summary           303 + 111 + IVA pendent del trimestre
 *   - search_accounts           Cercar comptes del pla
 *   - get_invoice_detail        Detall d'una factura
 *
 * Tools de PROPOSTA (no executen, retornen draft):
 *   - propose_post_invoice      Proposa comptabilitzar una factura
 *   - propose_journal_entry     Proposa un assentament manual
 */
const { prisma } = require('../config/database');
const fiscalService = require('./fiscalService');
const reportsService = require('./financialReportsService');
const scanService = require('./agentScanService');

const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

// ============================================================
// TOOL DEFINITIONS (format Anthropic Messages API)
// ============================================================
const TOOLS = [
  {
    name: 'get_overview',
    description: 'Retorna un resum general de l\'estat de la comptabilitat: factures pendents, sumes i saldos, venciments imminents i altres alertes proactives. Sempre cridar primer per situar-se.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_pending_postings',
    description: 'Llista factures que estan REVIEWED/APPROVED/PAID però sense assentament generat al diari. Útil per saber què cal comptabilitzar.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['received', 'issued', 'all'], description: 'Tipus de factura' },
        limit: { type: 'integer', default: 20 },
      },
      required: ['type'],
    },
  },
  {
    name: 'list_overdue',
    description: 'Llista factures emeses vençudes (cobraments pendents) o rebudes vençudes (pagaments pendents).',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['received', 'issued'] },
        limit: { type: 'integer', default: 20 },
      },
      required: ['type'],
    },
  },
  {
    name: 'get_balance_sheet',
    description: 'Calcula el balanç de situació (actiu / passiu+PN) a una data tall específica.',
    input_schema: {
      type: 'object',
      properties: { atDate: { type: 'string', description: 'Data en format YYYY-MM-DD' } },
      required: ['atDate'],
    },
  },
  {
    name: 'get_profit_loss',
    description: 'Calcula el compte de pèrdues i guanys d\'un període. Per defecte l\'any en curs.',
    input_schema: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'YYYY-MM-DD' },
        toDate: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['fromDate', 'toDate'],
    },
  },
  {
    name: 'get_tax_summary',
    description: 'Resum dels impostos del trimestre actual: 303 (IVA) i 111 (IRPF) amb el saldo a ingressar.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer' },
        quarter: { type: 'integer', minimum: 1, maximum: 4 },
      },
      required: ['year', 'quarter'],
    },
  },
  {
    name: 'search_accounts',
    description: 'Cerca subcomptes del pla comptable per codi o nom. Útil per saber a quin compte assignar una despesa.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text a cercar (codi o nom)' },
        leafOnly: { type: 'boolean', default: true },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_invoice_detail',
    description: 'Detall complet d\'una factura: imports, proveïdor/client, estat comptable i de pagament.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        type: { type: 'string', enum: ['received', 'issued'] },
      },
      required: ['id', 'type'],
    },
  },
  {
    name: 'propose_post_invoice',
    description: 'PROPOSA comptabilitzar una factura. NO executa: retorna un draft amb l\'assentament que es generaria perquè l\'usuari el pugui aprovar des de la UI.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        type: { type: 'string', enum: ['received', 'issued'] },
        accountCode: { type: 'string', description: 'Codi de compte de despesa/ingrés a usar (opcional, sino el detecta)' },
      },
      required: ['id', 'type'],
    },
  },
  {
    name: 'propose_journal_entry',
    description: 'PROPOSA un assentament manual al llibre diari. NO executa: retorna el draft per aprovació.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        description: { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              accountCode: { type: 'string' },
              debit: { type: 'number' },
              credit: { type: 'number' },
              description: { type: 'string' },
            },
            required: ['accountCode'],
          },
        },
      },
      required: ['date', 'description', 'lines'],
    },
  },
];

// ============================================================
// HANDLERS
// ============================================================
const HANDLERS = {
  get_overview: async () => {
    const scan = await scanService.scan();
    return {
      generatedAt: scan.generatedAt,
      companyName: scan.companyName,
      pendingItems: scan.items.length,
      items: scan.items.map((i) => ({
        id: i.id, severity: i.severity, category: i.category,
        title: i.title, description: i.description, count: i.count,
        actionLabel: i.actionLabel, actionUrl: i.actionUrl,
      })),
    };
  },

  list_pending_postings: async ({ type, limit = 20 }) => {
    const result = {};
    if (type === 'received' || type === 'all') {
      result.received = await prisma.receivedInvoice.findMany({
        where: {
          deletedAt: null, journalEntryId: null,
          origin: { not: 'LOGISTIK' },
          status: { in: ['REVIEWED', 'APPROVED', 'PAID', 'PARTIALLY_PAID'] },
        },
        select: {
          id: true, invoiceNumber: true, issueDate: true, totalAmount: true, status: true,
          accountId: true, pgcAccount: true,
          supplier: { select: { name: true, nif: true } },
        },
        orderBy: { issueDate: 'desc' },
        take: limit,
      });
    }
    if (type === 'issued' || type === 'all') {
      result.issued = await prisma.issuedInvoice.findMany({
        where: { journalEntryId: null, status: { in: ['PENDING', 'APPROVED', 'PAID', 'PARTIALLY_PAID'] } },
        select: {
          id: true, invoiceNumber: true, issueDate: true, totalAmount: true, status: true,
          client: { select: { name: true, nif: true } },
        },
        orderBy: { issueDate: 'desc' },
        take: limit,
      });
    }
    return result;
  },

  list_overdue: async ({ type, limit = 20 }) => {
    const today = new Date();
    if (type === 'issued') {
      const items = await prisma.issuedInvoice.findMany({
        where: { dueDate: { lte: today, not: null }, status: { notIn: ['PAID'] } },
        select: { id: true, invoiceNumber: true, dueDate: true, totalAmount: true, paidAmount: true, client: { select: { name: true } } },
        orderBy: { dueDate: 'asc' }, take: limit,
      });
      return { items: items.filter((i) => Number(i.totalAmount) > Number(i.paidAmount || 0)) };
    } else {
      const items = await prisma.receivedInvoice.findMany({
        where: {
          deletedAt: null, isDuplicate: false,
          dueDate: { lte: today, not: null },
          status: { notIn: ['PAID', 'REJECTED', 'NOT_INVOICE'] },
        },
        select: { id: true, invoiceNumber: true, dueDate: true, totalAmount: true, paidAmount: true, supplier: { select: { name: true } } },
        orderBy: { dueDate: 'asc' }, take: limit,
      });
      return { items: items.filter((i) => Number(i.totalAmount) > Number(i.paidAmount || 0)) };
    }
  },

  get_balance_sheet: async ({ atDate }) => {
    const data = await reportsService.getBalanceSheet({ atDate });
    return {
      atDate: data.atDate,
      balanced: data.totals.balanced,
      totalAsset: data.totals.asset,
      totalLiabilityEquity: data.totals.liabilityEquity,
      assetSummary: data.asset.map((s) => ({ section: s.section, total: s.total })),
      liabilityEquitySummary: data.liabilityEquity.map((s) => ({ section: s.section, total: s.total })),
    };
  },

  get_profit_loss: async ({ fromDate, toDate }) => {
    const data = await reportsService.getProfitAndLoss({ fromDate, toDate });
    return {
      fromDate: data.fromDate,
      toDate: data.toDate,
      operatingResult: data.subtotals["A.1) Resultat d'explotació"].value,
      financialResult: data.subtotals["A.2) Resultat financer"].value,
      resultBeforeTax: data.subtotals["A.3) Resultat abans d'impostos"].value,
      netResult: data.subtotals["A.4) Resultat de l'exercici"].value,
      epigrafs: [...data.operating, ...data.financial, ...data.tax].map((e) => ({
        epigraf: e.epigraf, total: e.total * e.sign,
      })),
    };
  },

  get_tax_summary: async ({ year, quarter }) => {
    const [m303, m111] = await Promise.all([
      fiscalService.calculateModel303(year, quarter),
      fiscalService.calculateModel111(year, quarter),
    ]);
    return {
      period: `Q${quarter} ${year}`,
      iva: {
        repercutit: m303.totalIvaRepercutit,
        suportat: m303.totalIvaSuportat,
        resultat: m303.resultado,
        aPagar: m303.aPagar,
        facturesEmeses: m303.facturesEmeses,
        facturesRebudes: m303.facturesRebudes,
      },
      irpf: {
        totalRetencions: m111.resultado,
        numPerceptors: m111.numPerceptors,
      },
    };
  },

  search_accounts: async ({ query, leafOnly = true }) => {
    const company = await prisma.company.findFirst();
    if (!company) return { items: [] };
    const items = await prisma.chartOfAccount.findMany({
      where: {
        companyId: company.id,
        ...(leafOnly && { isLeaf: true }),
        OR: [
          { code: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: 'asc' },
      take: 30,
    });
    return { items };
  },

  get_invoice_detail: async ({ id, type }) => {
    const model = type === 'received' ? 'receivedInvoice' : 'issuedInvoice';
    const partyKey = type === 'received' ? 'supplier' : 'client';
    const inv = await prisma[model].findUnique({
      where: { id },
      include: {
        [partyKey]: { select: { name: true, nif: true } },
        account: { select: { code: true, name: true } },
        journalEntry: { select: { id: true, entryNumber: true } },
      },
    });
    if (!inv) return { error: 'No trobada' };
    return {
      id: inv.id,
      type,
      invoiceNumber: inv.invoiceNumber,
      issueDate: inv.issueDate?.toISOString().slice(0, 10),
      dueDate: inv.dueDate?.toISOString().slice(0, 10),
      [partyKey]: inv[partyKey],
      subtotal: round2(inv.subtotal),
      taxRate: round2(inv.taxRate),
      taxAmount: round2(inv.taxAmount),
      irpfAmount: type === 'received' ? round2(inv.irpfAmount) : 0,
      totalAmount: round2(inv.totalAmount),
      paidAmount: round2(inv.paidAmount),
      status: inv.status,
      account: inv.account,
      pgcAccount: inv.pgcAccount,
      journalEntry: inv.journalEntry,
      comptabilitzada: !!inv.journalEntryId,
    };
  },

  propose_post_invoice: async ({ id, type, accountCode }) => {
    // No executa: només retorna una proposta perquè la UI mostri un botó d'aprovar
    const detail = await HANDLERS.get_invoice_detail({ id, type });
    if (detail.error) return detail;
    return {
      proposal: {
        kind: 'POST_INVOICE',
        invoiceType: type,
        invoiceId: id,
        invoiceNumber: detail.invoiceNumber,
        party: detail.supplier?.name || detail.client?.name,
        amount: detail.totalAmount,
        accountCode,
        actionLabel: `Comptabilitzar ${detail.invoiceNumber} (${detail.totalAmount} €)`,
        actionEndpoint: `/api/invoice-posting/${type}/${id}/post`,
        actionMethod: 'POST',
      },
      summary: `Es generaria un assentament tipus ${type === 'received' ? 'RECEIVED_INVOICE' : 'ISSUED_INVOICE'} pel total de ${detail.totalAmount} €. Toca el botó d'aprovació per executar-ho.`,
    };
  },

  propose_journal_entry: async ({ date, description, lines }) => {
    return {
      proposal: {
        kind: 'CREATE_JOURNAL_ENTRY',
        date, description, lines,
        actionLabel: `Crear assentament del ${date}`,
        actionEndpoint: '/api/journal',
        actionMethod: 'POST',
      },
      summary: `Es crearia un assentament manual del ${date} amb ${lines.length} línies. La UI mostrarà un editor on podràs revisar-lo abans de comptabilitzar-lo.`,
    };
  },
};

async function executeTool(name, input) {
  const handler = HANDLERS[name];
  if (!handler) return { error: `Tool desconegut: ${name}` };
  try {
    return await handler(input || {});
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { TOOLS, HANDLERS, executeTool };
