/**
 * marketingBudgetService — control de cost del subprojecte marketing.
 *
 * Llegeix els fitxers `out/full_run_*.json` (i altres `executive_report.json`)
 * del mes en curs i suma `summary.spent_usd`. Bloca nous runs si superen el
 * cap mensual configurable.
 *
 * Cap configurable via env `MARKETING_MAX_USD_PER_MONTH` (default 25 €/mes
 * — referim el pricing intern d'Anthropic en USD i comparem amb el cap en EUR
 * com a aproximació; la conversió real seria 1 USD ≈ 0.92 EUR però la
 * volatilitat fa que mantinguem la unitat USD a tot el codi i tractem el
 * cap com a "pressupost mensual en USD"). Si necessites EUR, multiplica
 * mentalment per ~0.92.
 *
 * El cap és reset automàticament cada canvi de mes (no cal cron, només
 * comparar contra el sumatori del mes en curs).
 */
const fs = require('fs');
const path = require('path');
const { logger } = require('../config/logger');

const MARKETING_DIR = path.resolve(__dirname, '../../../marketing');
const OUT_DIR = path.join(MARKETING_DIR, 'out');

// Cap mensual en USD (mateixa unitat que el budget tracker del Python)
const MONTHLY_CAP_USD = parseFloat(process.env.MARKETING_MAX_USD_PER_MONTH || '25');

// Cache 60s — recomptar fitxers cada cop és OK però prefereixo no escanejar
// el directori a cada GET de la UI.
let _cache = null; // { yearMonth, totalUsd, runs, perAgent, t }
const TTL_MS = 60_000;

function _yearMonthOf(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function _isFullRunFile(filename) {
  return /^full_run_.*\.json$/.test(filename) || filename === 'executive_report.json';
}

/**
 * Escaneja els fitxers full_run del mes indicat (default = mes en curs UTC)
 * i retorna { totalUsd, runs[] }.
 */
function _scanMonth(yearMonth) {
  const result = { totalUsd: 0, runs: [], perAgent: {}, fallbackModels: new Set() };
  if (!fs.existsSync(OUT_DIR)) return result;

  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!_isFullRunFile(f)) continue;
    const full = path.join(OUT_DIR, f);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (_yearMonthOf(stat.mtime) !== yearMonth) continue;

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      logger.warn(`marketingBudget: error llegint ${f}: ${e.message}`);
      continue;
    }

    const summary = parsed?.summary || {};
    const spent = Number(summary.spent_usd || 0);
    if (!Number.isFinite(spent) || spent < 0) continue;

    result.totalUsd += spent;
    result.runs.push({
      filename: f,
      created_at: stat.mtime.toISOString(),
      spent_usd: spent,
      tokens_used: summary.tokens_used || 0,
      verification_rate: summary.verification_rate ?? null,
      stages_completed: summary.stages_completed || [],
    });

    for (const [agent, cost] of Object.entries(summary.per_agent_usd || {})) {
      result.perAgent[agent] = (result.perAgent[agent] || 0) + Number(cost || 0);
    }
    for (const m of summary.fallback_models || []) result.fallbackModels.add(m);
  }

  // Ordena descendentment per data
  result.runs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  result.fallbackModels = [...result.fallbackModels];
  return result;
}

/**
 * Status del pressupost del mes en curs. Cache 60s.
 */
function getMonthStatus(force = false) {
  const now = new Date();
  const yearMonth = _yearMonthOf(now);
  if (!force && _cache && _cache.yearMonth === yearMonth && Date.now() - _cache.t < TTL_MS) {
    return { ..._cache, cap_usd: MONTHLY_CAP_USD };
  }
  const scan = _scanMonth(yearMonth);
  _cache = {
    yearMonth,
    totalUsd: Math.round(scan.totalUsd * 10000) / 10000,
    runs: scan.runs,
    perAgent: scan.perAgent,
    fallbackModels: scan.fallbackModels,
    t: Date.now(),
  };
  return { ..._cache, cap_usd: MONTHLY_CAP_USD };
}

/**
 * Comprova si es pot llançar un nou run. Llença `BudgetExceededError` si
 * el cap mensual ja està exhaurit.
 *
 * `expectedUsd` és l'estimació pessimista del proper run (default = max_usd_per_run
 * del Python, hardcodat a 3$ — config compartida via env). Si el spent + estimat
 * > cap, blocca.
 */
class BudgetExceededError extends Error {
  constructor(message, status) {
    super(message);
    this.code = 'MARKETING_BUDGET_EXCEEDED';
    this.status = status;
  }
}

function assertCanLaunchRun(expectedUsd = parseFloat(process.env.MAX_USD_PER_RUN || '3')) {
  const status = getMonthStatus();
  const projected = status.totalUsd + expectedUsd;
  if (status.totalUsd >= status.cap_usd) {
    throw new BudgetExceededError(
      `Cap mensual de marketing exhaurit ($${status.totalUsd.toFixed(2)} / $${status.cap_usd.toFixed(2)}). Espera al pròxim mes o augmenta MARKETING_MAX_USD_PER_MONTH.`,
      status
    );
  }
  if (projected > status.cap_usd) {
    throw new BudgetExceededError(
      `Run bloquejat: gastat $${status.totalUsd.toFixed(2)} + estimat $${expectedUsd.toFixed(2)} = $${projected.toFixed(2)} > cap $${status.cap_usd.toFixed(2)} per al mes ${status.yearMonth}.`,
      status
    );
  }
  return status;
}

function clearCache() {
  _cache = null;
}

module.exports = {
  getMonthStatus,
  assertCanLaunchRun,
  clearCache,
  BudgetExceededError,
  MONTHLY_CAP_USD,
};
