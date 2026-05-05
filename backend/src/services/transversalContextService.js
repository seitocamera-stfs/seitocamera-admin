/**
 * transversalContextService — funcions read que cobreixen els dominis
 * "no comptables" per donar visió 360 al CEO IA: marketing i magatzem.
 *
 * Reusa endpoints existents (companyContext, marketing/runs, warehouse) però
 * exposats com a funcions per ser cridades directament des del agent loop.
 */
const path = require('path');
const fs = require('fs');
const { prisma } = require('../config/database');

const MARKETING_OUT_DIR = path.resolve(__dirname, '../../../marketing/out');

// ===========================================
// Marketing
// ===========================================

/**
 * Retorna el marketingContext de la Company (perfil de marca, posicionament,
 * competidors coneguts, etc.). El que els agents marketing fan servir.
 */
async function getMarketingContext() {
  const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) return { error: 'Cap empresa configurada' };
  return {
    company: company.commercialName || company.legalName,
    marketing_context: company.marketingContext || null,
    has_context: Boolean(company.marketingContext),
  };
}

function _listOutputFiles(prefix) {
  if (!fs.existsSync(MARKETING_OUT_DIR)) return [];
  return fs.readdirSync(MARKETING_OUT_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(MARKETING_OUT_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
}

function _readLatest(prefix) {
  const files = _listOutputFiles(prefix);
  if (!files.length) return null;
  const full = path.join(MARKETING_OUT_DIR, files[0].name);
  return { filename: files[0].name, mtime: files[0].mtime, content: JSON.parse(fs.readFileSync(full, 'utf8')) };
}

/** Últim Investigator (MarketResearch) — resum compacte */
async function getLatestMarketResearch() {
  const r = _readLatest('investigator_smoke_');
  if (!r) return { error: 'Cap estudi de mercat encara' };
  const c = r.content;
  return {
    filename: r.filename,
    generated_at: r.mtime,
    business: c.business,
    geography: c.geography,
    competitors: (c.competitors || []).map((x) => ({
      name: x.name,
      website: x.website,
      positioning: x.positioning?.slice(0, 200),
      observed_strengths: (x.observed_strengths || []).slice(0, 3),
      observed_weaknesses: (x.observed_weaknesses || []).slice(0, 3),
    })),
    price_summary: c.price_summary,
    channel_summary: c.channel_summary,
    opportunities: (c.opportunities || []).map((o) => ({
      description: o.description,
      rationale: o.rationale?.slice(0, 200),
    })),
    risks: c.risks || [],
    open_questions: c.open_questions || [],
  };
}

/** Última CampaignStrategy — resum compacte */
async function getLatestCampaignStrategy() {
  const r = _readLatest('strategist_smoke_');
  if (!r) return { error: 'Cap estratègia generada encara' };
  const s = r.content;
  return {
    filename: r.filename,
    generated_at: r.mtime,
    chosen_angle: s.chosen_angle ? {
      label: s.chosen_angle.label,
      pitch: s.chosen_angle.pitch,
      differentiation: s.chosen_angle.differentiation_vs_competitors?.slice(0, 200),
    } : null,
    key_message: s.key_message,
    target_segments: s.target_segments,
    channels: (s.channels || []).map((c) => ({ channel: c.channel, format: c.format, cadence: c.cadence, kpi: c.primary_kpi })),
    budget_tier: s.budget_tier,
    timing: s.timing,
    success_metrics: s.success_metrics,
    creativity_notes: s.creativity_notes?.slice(0, 300),
  };
}

/** Prospects (Clients amb isProspect=true) — leads pendents de processar */
async function getMarketingProspects({ limit = 20, minFitScore = 0 } = {}) {
  const prospects = await prisma.client.findMany({
    where: { isProspect: true, isActive: true },
    select: {
      id: true, name: true, email: true, source: true,
      prospectImportedAt: true, prospectMetadata: true,
    },
    orderBy: { prospectImportedAt: 'desc' },
    take: limit,
  });
  const filtered = prospects.filter((p) => {
    const fit = p.prospectMetadata?.fit_score || 0;
    return fit >= minFitScore;
  });
  return {
    total: filtered.length,
    prospects: filtered.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      source: p.source,
      imported_at: p.prospectImportedAt,
      fit_score: p.prospectMetadata?.fit_score,
      why_good_fit: p.prospectMetadata?.why_good_fit,
      website: p.prospectMetadata?.website,
    })),
  };
}

/** Historial breu de runs marketing (què s'ha fet quan) */
async function getMarketingRunsSummary({ limit = 10 } = {}) {
  if (!fs.existsSync(MARKETING_OUT_DIR)) return { runs: [] };
  const files = fs.readdirSync(MARKETING_OUT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const stat = fs.statSync(path.join(MARKETING_OUT_DIR, f));
      const agent = f.startsWith('investigator') ? 'investigator'
        : f.startsWith('strategist') ? 'strategist'
        : f.startsWith('leads') ? 'lead_hunter'
        : f.startsWith('fact_check') ? 'fact_checker'
        : f.startsWith('full_run') ? 'full_run'
        : 'unknown';
      return { filename: f, agent, generated_at: stat.mtime, size_bytes: stat.size };
    })
    .sort((a, b) => b.generated_at - a.generated_at)
    .slice(0, limit);

  // Comptatge per agent
  const all = fs.readdirSync(MARKETING_OUT_DIR).filter((f) => f.endsWith('.json'));
  const counts = {};
  for (const f of all) {
    const a = f.startsWith('investigator') ? 'investigator'
      : f.startsWith('strategist') ? 'strategist'
      : f.startsWith('leads') ? 'lead_hunter'
      : f.startsWith('fact_check') ? 'fact_checker'
      : f.startsWith('full_run') ? 'full_run'
      : 'unknown';
    counts[a] = (counts[a] || 0) + 1;
  }
  return { totals_by_agent: counts, recent: files };
}

// ===========================================
// Warehouse
// ===========================================

function _localToday() {
  const now = new Date();
  const off = now.getTimezoneOffset() * 60000;
  const todayStr = new Date(now.getTime() - off).toISOString().slice(0, 10);
  return new Date(`${todayStr}T12:00:00Z`);
}

/**
 * Briefing del magatzem per avui — resum compacte (només counts + alertes,
 * no llistats sencers per estalviar tokens).
 */
async function getWarehouseBriefing() {
  const today = _localToday();

  const [prepToday, returnsToday, overdue, shootingNow, pendingItems, brokenEquip] = await Promise.all([
    prisma.rentalProject.count({
      where: { checkDate: today, status: { in: ['PENDING_PREP', 'IN_PREPARATION', 'READY'] } },
    }),
    prisma.rentalProject.count({
      where: { returnDate: today, actualReturnDate: null },
    }),
    prisma.rentalProject.findMany({
      where: { returnDate: { lt: today }, actualReturnDate: null, status: { not: 'CLOSED' } },
      select: { id: true, name: true, returnDate: true, departureDate: true, clientName: true },
      orderBy: { returnDate: 'asc' },
      take: 10,
    }),
    prisma.rentalProject.count({
      where: {
        departureDate: { lte: today },
        OR: [{ shootEndDate: { gte: today } }, { shootEndDate: null }],
        status: { in: ['OUT', 'READY'] },
      },
    }),
    prisma.projectEquipment.count({
      where: {
        isReturned: false,
        project: {
          OR: [{ actualReturnDate: { not: null } }, { status: 'CLOSED' }],
        },
      },
    }),
    prisma.equipment.count({
      where: { status: { in: ['BROKEN', 'LOST'] } },
    }),
  ]);

  // Conflictes d'equipament (mateix Equipment a 2+ projectes solapats)
  const conflictsRaw = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT pe1."equipmentId")::int AS n
    FROM project_equipment pe1
    JOIN project_equipment pe2
      ON pe2."equipmentId" = pe1."equipmentId"
     AND pe2.id <> pe1.id
    JOIN rental_projects p1 ON p1.id = pe1."projectId"
    JOIN rental_projects p2 ON p2.id = pe2."projectId"
    WHERE pe1."equipmentId" IS NOT NULL
      AND p1.status NOT IN ('CLOSED', 'RETURNED')
      AND p2.status NOT IN ('CLOSED', 'RETURNED')
      AND p1."departureDate" <= COALESCE(p2."returnDate", p2."departureDate")
      AND COALESCE(p1."returnDate", p1."departureDate") >= p2."departureDate"
  `);

  return {
    today: today.toISOString().slice(0, 10),
    prep_today: prepToday,
    shooting_now: shootingNow,
    returns_today: returnsToday,
    overdue_returns: overdue.length,
    overdue_returns_detail: overdue,
    equipment_conflicts: conflictsRaw[0]?.n || 0,
    pending_return_items: pendingItems,
    equipment_broken_or_lost: brokenEquip,
  };
}

module.exports = {
  getMarketingContext,
  getLatestMarketResearch,
  getLatestCampaignStrategy,
  getMarketingProspects,
  getMarketingRunsSummary,
  getWarehouseBriefing,
};
