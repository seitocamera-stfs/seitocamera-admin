/**
 * Marketing AI routes — UI per al sistema multi-agent que viu a `marketing/`.
 *
 * Aquest fitxer NO conté lògica d'agents — només orquestra el subprocess
 * Python (script `smoke_investigator.py` per ara) i serveix els fitxers
 * d'output que el Python escriu a `marketing/out/`.
 *
 * Endpoints:
 *   GET   /context/business         → marketingContext de la Company
 *   PATCH /context/business         → actualitza marketingContext
 *   GET   /runs                     → llistar fitxers a marketing/out/
 *   GET   /runs/:filename           → contingut d'un run JSON
 *   POST  /runs                     → llança Investigator (body: { agent: 'investigator' })
 *   GET   /runs/active              → status del run actiu (si n'hi ha)
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');
const { authenticate, authorize } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');
const marketingBudget = require('../services/marketingBudgetService');
const marketingRunService = require('../services/marketingRunService');

const router = express.Router();
router.use(authenticate);
router.use(requireSection('agent'));

const MARKETING_DIR = path.resolve(__dirname, '../../../marketing');
const OUT_DIR = path.join(MARKETING_DIR, 'out');
const VENV_PYTHON = path.join(MARKETING_DIR, '.venv/bin/python');

// L'estat dels runs viu a la taula `marketing_runs` (vegeu marketingRunService).
// No més estat global — sobreviuen reinicis del backend i es poden matar.

// Feature flag MARKETING_ENABLED — controla si es poden llançar runs des del
// servidor. A producció el VPS no té Ollama, així que llançar-hi un run
// petaria. Mantenim marketing com a eina LOCAL del Mac (qwen3:32b gratuit) i
// importem leads finals a producció via /import-external-leads.
function marketingEnabled() {
  return process.env.MARKETING_ENABLED === 'true';
}

function requireMarketingEnabled(req, res, next) {
  if (!marketingEnabled()) {
    return res.status(503).json({
      error: 'Marketing desactivat en aquest entorn (MARKETING_ENABLED=false). '
        + 'Executa marketing localment al Mac amb Ollama; importa els leads a '
        + 'producció via POST /api/marketing/import-external-leads.',
      code: 'MARKETING_DISABLED',
    });
  }
  next();
}

function listRunFiles() {
  if (!fs.existsSync(OUT_DIR)) return [];
  return fs.readdirSync(OUT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const full = path.join(OUT_DIR, f);
      const stat = fs.statSync(full);
      // Inferir agent del nom del fitxer (e.g. investigator_smoke_*.json o investigator_*.json)
      const agent = f.startsWith('investigator') ? 'investigator'
        : f.startsWith('strategist') ? 'strategist'
        : f.startsWith('leads') || f.startsWith('lead_hunter') ? 'lead_hunter'
        : f.startsWith('fact_check') ? 'fact_checker'
        : f.startsWith('full_run') || f.startsWith('executive') ? 'full_run'
        : 'unknown';
      return {
        filename: f,
        agent,
        size_bytes: stat.size,
        created_at: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// ===========================================
// Context (marketing brand/marketing data)
// ===========================================

router.get('/context/business', async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!company) return res.status(404).json({ error: 'Cap empresa configurada' });
    res.json(company.marketingContext || {});
  } catch (err) { next(err); }
});

router.patch('/context/business', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!company) return res.status(404).json({ error: 'Cap empresa' });
    // Replace strategy: el body substitueix completament el context (no merge)
    const updated = await prisma.company.update({
      where: { id: company.id },
      data: { marketingContext: req.body || {} },
      select: { marketingContext: true },
    });
    res.json(updated.marketingContext);
  } catch (err) { next(err); }
});

// ===========================================
// Runs
// ===========================================

router.get('/runs', async (req, res, next) => {
  try {
    const active = await marketingRunService.findActive();
    res.json({
      active: active ? sanitizeActive(active) : null,
      runs: listRunFiles(),
    });
  } catch (err) { next(err); }
});

router.get('/runs/active', async (req, res, next) => {
  try {
    const active = await marketingRunService.findActive();
    res.json({ active: active ? sanitizeActive(active) : null });
  } catch (err) { next(err); }
});

/**
 * GET /api/marketing/runs/history — històric de runs persistits a la DB
 * (last 50 by default). Útil per veure runs killed/abandoned/failed.
 */
router.get('/runs/history', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const runs = await marketingRunService.listRecent(limit);
    res.json({ runs: runs.map(sanitizeActive) });
  } catch (err) { next(err); }
});

/**
 * POST /api/marketing/runs/active/kill — atura el run actiu (SIGTERM, després SIGKILL).
 */
router.post('/runs/active/kill', authorize('ADMIN', 'EDITOR'), requireMarketingEnabled, async (req, res, next) => {
  try {
    const killed = await marketingRunService.killActive();
    if (!killed) return res.status(404).json({ error: 'Cap run actiu' });
    logger.info(`Marketing run ${killed.id} matat per ${req.user?.name || req.user?.id}`);
    res.json({ killed: sanitizeActive(killed) });
  } catch (err) {
    next(err);
  }
});

router.get('/runs/:filename', async (req, res, next) => {
  try {
    const filename = req.params.filename;
    if (!/^[a-zA-Z0-9_.-]+\.json$/.test(filename)) {
      return res.status(400).json({ error: 'Nom de fitxer invàlid' });
    }
    const full = path.join(OUT_DIR, filename);
    if (!full.startsWith(OUT_DIR)) return res.status(400).json({ error: 'Path invàlid' });
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Run no trobat' });
    const content = JSON.parse(fs.readFileSync(full, 'utf8'));
    res.json({
      filename,
      created_at: fs.statSync(full).mtime.toISOString(),
      content,
    });
  } catch (err) { next(err); }
});

router.post('/runs', authorize('ADMIN', 'EDITOR'), requireMarketingEnabled, async (req, res, next) => {
  try {
    const existing = await marketingRunService.findActive();
    if (existing) {
      return res.status(409).json({ error: 'Ja hi ha un run actiu', active: sanitizeActive(existing) });
    }

    // Cap mensual de cost — bloca si el mes en curs ja ha exhaurit el pressupost
    try {
      marketingBudget.assertCanLaunchRun();
    } catch (e) {
      if (e.code === 'MARKETING_BUDGET_EXCEEDED') {
        return res.status(402).json({
          error: e.message,
          code: e.code,
          status: e.status,
        });
      }
      throw e;
    }

    const agent = (req.body?.agent || 'investigator').toLowerCase();
    const SCRIPT_BY_AGENT = {
      investigator:  'scripts/smoke_investigator.py',
      strategist:    'scripts/smoke_strategist.py',
      lead_hunter:   'scripts/smoke_lead_hunter.py',
      fact_checker:  'scripts/smoke_fact_checker.py',
      full_run:      'scripts/full_run.py',
    };
    const script = SCRIPT_BY_AGENT[agent];
    if (!script) {
      return res.status(400).json({ error: `Agent '${agent}' no suportat. Disponibles: ${Object.keys(SCRIPT_BY_AGENT).join(', ')}` });
    }

    if (!fs.existsSync(VENV_PYTHON)) {
      return res.status(500).json({ error: `No es troba .venv del marketing: ${VENV_PYTHON}` });
    }

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    const tempId = `run_${Date.now()}`;
    const logFile = path.join(OUT_DIR, `${tempId}.log`);
    const logFd = fs.openSync(logFile, 'w');

    // Spawn Python detached (segueix corrent encara que tanquem la connexió HTTP).
    // Forcem provider local via LLM_PROVIDER=ollama (té prioritat al settings.py).
    // Buidar ANTHROPIC_API_KEY no funcionava perquè dotenv del marketing
    // sobrescrivia l'env injectat aquí amb el valor del seu propi .env.
    const proc = spawn(
      VENV_PYTHON,
      [script],
      {
        cwd: MARKETING_DIR,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, LLM_PROVIDER: 'ollama' },
      }
    );
    proc.unref();

    const run = await marketingRunService.create({
      agent,
      script,
      pid: proc.pid,
      logFile,
      triggeredById: req.user?.id || null,
    });

    res.status(202).json({
      message: 'Run llançat',
      active: sanitizeActive(run),
    });
  } catch (err) { next(err); }
});

/**
 * Lògica compartida d'ingestió de leads. Accepta el `LeadList` parsejat i
 * un `sourceTag` (filename del run o "external") per traçar a `prospectMetadata`.
 */
async function ingestLeadList(leadList, sourceTag) {
  if (!Array.isArray(leadList?.leads)) {
    throw Object.assign(new Error('LeadList invàlid (camp `leads` no és array)'), { status: 400 });
  }
  const stats = { created: 0, skipped_duplicates: 0, skipped_no_contact: 0, total: leadList.leads.length };

  for (const L of leadList.leads) {
    const name = (L.company_name || '').trim();
    if (!name) { stats.skipped_no_contact++; continue; }

    const firstEmail = (L.contacts || []).find((c) => c.email)?.email || null;
    const website = L.website || null;

    if (!firstEmail && !website) { stats.skipped_no_contact++; continue; }

    const existing = await prisma.client.findFirst({
      where: {
        OR: [
          { name: { equals: name, mode: 'insensitive' } },
          firstEmail ? { email: { equals: firstEmail, mode: 'insensitive' } } : { id: '__never__' },
        ],
      },
      select: { id: true },
    });
    if (existing) { stats.skipped_duplicates++; continue; }

    await prisma.client.create({
      data: {
        name,
        email: firstEmail,
        notes: L.suggested_outreach
          ? `[Marketing AI prospect]\nSuggeriment d'outreach:\n${L.suggested_outreach}`
          : '[Marketing AI prospect]',
        isActive: true,
        isProspect: true,
        source: 'marketing_ai',
        prospectImportedAt: new Date(),
        prospectMetadata: {
          run_filename: sourceTag,
          fit_score: L.fit_score,
          why_good_fit: L.why_good_fit,
          description: L.description,
          location: L.location,
          size_hint: L.size_hint,
          website: L.website,
          evidence: L.evidence || [],
          contacts: L.contacts || [],
          validation_checks: L.validation_checks || {},
        },
      },
    });
    stats.created++;
  }
  return stats;
}

/**
 * POST /api/marketing/runs/:filename/ingest-leads
 * Llegeix una LeadList JSON local (executat al mateix host) i crea Client
 * records amb isProspect=true. Només té sentit on marketing està activat.
 */
router.post('/runs/:filename/ingest-leads', authorize('ADMIN', 'EDITOR'), requireMarketingEnabled, async (req, res, next) => {
  try {
    const filename = req.params.filename;
    if (!/^[a-zA-Z0-9_.-]+\.json$/.test(filename)) {
      return res.status(400).json({ error: 'Nom de fitxer invàlid' });
    }
    const full = path.join(OUT_DIR, filename);
    if (!full.startsWith(OUT_DIR) || !fs.existsSync(full)) {
      return res.status(404).json({ error: 'Run no trobat' });
    }

    const leadList = JSON.parse(fs.readFileSync(full, 'utf8'));
    const stats = await ingestLeadList(leadList, filename);
    res.json(stats);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

/**
 * POST /api/marketing/import-external-leads
 *
 * Bridge Mac → Producció: accepta un LeadList JSON al body (no fitxer) i
 * crea els prospects. Pensat per quan tu executes marketing al Mac amb
 * Ollama i vols pujar els leads al servidor sense ZIP/SCP.
 *
 * Body: { leads: [...] }  (mateix shape que el fitxer leads_*.json)
 * Optional: { source: "leads_20260505_120000.json" }  (per traceability)
 *
 * Funciona encara que MARKETING_ENABLED=false — és el bridge per disseny.
 *
 * Exemple:
 *   curl -X POST https://admin.seito.camera/api/marketing/import-external-leads \
 *     -H "Authorization: Bearer $JWT" \
 *     -H "Content-Type: application/json" \
 *     -d @marketing/out/leads_20260505_120000.json
 */
router.post('/import-external-leads', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const leadList = req.body || {};
    const sourceTag = (req.query?.source || req.body?._source || 'external_upload').toString().slice(0, 200);
    const stats = await ingestLeadList(leadList, sourceTag);
    logger.info(`[Marketing import-external] ${stats.created} creats, ${stats.skipped_duplicates} duplicats, ${stats.skipped_no_contact} sense contacte (de ${stats.total}) — source=${sourceTag} per ${req.user?.name || req.user?.id}`);
    res.json(stats);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

/**
 * GET /api/marketing/status
 * Endpoint públic (només auth) que indica si marketing està activat en
 * aquest entorn. El frontend l'usa per amagar links si OFF.
 */
router.get('/status', async (req, res) => {
  res.json({
    enabled: marketingEnabled(),
    monthly_cap_usd: marketingBudget.MONTHLY_CAP_USD,
    import_endpoint: '/api/marketing/import-external-leads', // accessible encara que enabled=false
  });
});

router.get('/runs/active/log', async (req, res, next) => {
  try {
    const active = await marketingRunService.findActive();
    if (!active?.logFile || !fs.existsSync(active.logFile)) {
      return res.json({ log: '' });
    }
    const log = fs.readFileSync(active.logFile, 'utf8');
    res.json({ log: log.slice(-10000) }); // últim 10k chars
  } catch (err) { next(err); }
});

// Helpers ----------------------------------------------------------------

function sanitizeActive(a) {
  if (!a) return null;
  return {
    id: a.id,
    agent: a.agent,
    pid: a.pid,
    startedAt: a.startedAt instanceof Date ? a.startedAt.toISOString() : a.startedAt,
    endedAt: a.endedAt instanceof Date ? a.endedAt.toISOString() : (a.endedAt || null),
    status: a.status,
    error: a.error || null,
    spent_usd: a.spentUsd != null ? Number(a.spentUsd) : null,
    elapsed_seconds: Math.floor((Date.now() - new Date(a.startedAt).getTime()) / 1000),
  };
}

/**
 * GET /api/marketing/budget — estat del cap mensual de cost.
 * Retorna { yearMonth, totalUsd, cap_usd, runs: [...], perAgent: {}, fallbackModels: [] }
 */
router.get('/budget', async (req, res, next) => {
  try {
    const status = marketingBudget.getMonthStatus(req.query?.refresh === '1');
    res.json({
      yearMonth: status.yearMonth,
      total_usd: status.totalUsd,
      cap_usd: status.cap_usd,
      remaining_usd: Math.max(0, status.cap_usd - status.totalUsd),
      utilization_pct: status.cap_usd > 0 ? Math.min(100, (status.totalUsd / status.cap_usd) * 100) : 0,
      runs_count: status.runs.length,
      runs: status.runs,
      per_agent_usd: status.perAgent,
      fallback_models: status.fallbackModels,
    });
  } catch (err) { next(err); }
});

module.exports = router;
