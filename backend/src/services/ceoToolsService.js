/**
 * ceoToolsService — Tools del CEO IA estratègic.
 *
 * Read-tools transversals que cobreixen tots els àmbits de l'empresa
 * (facturació, despeses, tresoreria, clients, projectes, inventari, riscos).
 *
 * Una proposta única `propose_action_plan` retorna un pla d'accions
 * priortitzades classificat en 3 nivells de criticitat segons el system
 * prompt del CEO. Les accions concretes les executa el Gestor IA o l'usuari
 * des de les pantalles operatives — el CEO només recomana.
 */
const strategic = require('./strategicAnalysisService');
const reportsService = require('./financialReportsService');
const fiscalService = require('./fiscalService');

const TOOLS = [
  {
    name: 'get_kpi_overview',
    description: 'Retorna els KPI principals de l\'any: facturació, marge, tresoreria, % cobrament, pendent de cobrar/pagar i liquiditat neta.',
    input_schema: {
      type: 'object',
      properties: { year: { type: 'integer', description: 'Any (per defecte l\'any en curs)' } },
      required: [],
    },
  },
  {
    name: 'get_strategic_risks',
    description: 'Detecta riscos a nivell directiu: marge negatiu/baix, tresoreria tensa, cobraments vençuts grans, concentració de clients. Sempre cridar primer per situar-se.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_top_clients',
    description: 'Top clients per facturació de l\'any amb % sobre el total i pendent de cobrar.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer' },
        limit: { type: 'integer', default: 10 },
      },
      required: [],
    },
  },
  {
    name: 'get_top_suppliers',
    description: 'Top proveïdors per cost de l\'any.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer' },
        limit: { type: 'integer', default: 10 },
      },
      required: [],
    },
  },
  {
    name: 'get_overdue_collections',
    description: 'Cobraments vençuts amb impacte total i ranking de deutors.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_cash_flow_projection',
    description: 'Projecció de tresoreria a N dies (per defecte 60). Detecta risc d\'impagament.',
    input_schema: {
      type: 'object',
      properties: { daysAhead: { type: 'integer', default: 60 } },
      required: [],
    },
  },
  {
    name: 'get_projects_summary',
    description: 'Resum de projectes Rentman: actius, total, top per facturació.',
    input_schema: {
      type: 'object',
      properties: { year: { type: 'integer' } },
      required: [],
    },
  },
  {
    name: 'get_inventory_summary',
    description: 'Resum d\'immobilitzat: nombre d\'equips, valor brut/net, càrrega d\'amortització mensual.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_profit_loss',
    description: 'Compte de pèrdues i guanys complet d\'un període.',
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
    name: 'get_balance_sheet',
    description: 'Balanç de situació a una data tall.',
    input_schema: {
      type: 'object',
      properties: { atDate: { type: 'string' } },
      required: ['atDate'],
    },
  },
  {
    name: 'get_tax_summary',
    description: 'Estat fiscal del trimestre actual (303 IVA + 111 IRPF).',
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
    name: 'propose_action_plan',
    description: 'PROPOSA un pla d\'accions priortitzades. Cada acció classificada per nivell (1=Informatiu, 2=Recomanació revisable, 3=Decisió crítica que necessita validació). NO executa: només retorna el pla per a la UI.',
    input_schema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              level: { type: 'integer', enum: [1, 2, 3] },
              category: { type: 'string', enum: ['PRICE', 'COST', 'CASH', 'CLIENT', 'PROJECT', 'INVENTORY', 'TAX', 'PROCESS', 'COMMERCIAL'] },
              title: { type: 'string' },
              description: { type: 'string', description: 'Què cal fer i per què, en llenguatge clar' },
              estimatedImpact: { type: 'string', description: 'Impacte econòmic estimat (€/any o % marge)' },
              actionUrl: { type: 'string', description: 'Pantalla on executar l\'acció (opcional)' },
            },
            required: ['level', 'category', 'title', 'description'],
          },
        },
      },
      required: ['actions'],
    },
  },
];

const HANDLERS = {
  get_kpi_overview: async ({ year }) => strategic.getKpiOverview(year),
  get_strategic_risks: async () => ({ risks: await strategic.getStrategicRisks() }),
  get_top_clients: async ({ year, limit }) => ({ clients: await strategic.getTopClients(year, limit) }),
  get_top_suppliers: async ({ year, limit }) => ({ suppliers: await strategic.getTopSuppliers(year, limit) }),
  get_overdue_collections: async () => strategic.getOverdueCollections(),
  get_cash_flow_projection: async ({ daysAhead }) => strategic.getCashFlowProjection(daysAhead),
  get_projects_summary: async ({ year }) => strategic.getProjectsSummary(year),
  get_inventory_summary: async () => strategic.getInventorySummary(),
  get_profit_loss: async ({ fromDate, toDate }) => {
    const data = await reportsService.getProfitAndLoss({ fromDate, toDate });
    return {
      fromDate: data.fromDate, toDate: data.toDate,
      operatingResult: data.subtotals["A.1) Resultat d'explotació"].value,
      financialResult: data.subtotals["A.2) Resultat financer"].value,
      resultBeforeTax: data.subtotals["A.3) Resultat abans d'impostos"].value,
      netResult: data.subtotals["A.4) Resultat de l'exercici"].value,
    };
  },
  get_balance_sheet: async ({ atDate }) => {
    const data = await reportsService.getBalanceSheet({ atDate });
    return { atDate: data.atDate, totalAsset: data.totals.asset, totalLiabilityEquity: data.totals.liabilityEquity, balanced: data.totals.balanced };
  },
  get_tax_summary: async ({ year, quarter }) => {
    const m303 = await fiscalService.calculateModel303(year, quarter);
    const m111 = await fiscalService.calculateModel111(year, quarter);
    return {
      period: `Q${quarter} ${year}`,
      iva: { repercutit: m303.totalIvaRepercutit, suportat: m303.totalIvaSuportat, resultat: m303.resultado, aPagar: m303.aPagar },
      irpf: { totalRetencions: m111.resultado, numPerceptors: m111.numPerceptors },
    };
  },
  propose_action_plan: async ({ actions }) => {
    return {
      proposal: { kind: 'ACTION_PLAN', actions, totalActions: actions.length, byLevel: { 1: actions.filter((a) => a.level === 1).length, 2: actions.filter((a) => a.level === 2).length, 3: actions.filter((a) => a.level === 3).length } },
      summary: `Pla d'acció amb ${actions.length} accions classificades per criticitat. La UI les mostrarà perquè decideixis quines aprovar.`,
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
