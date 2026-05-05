/**
 * marketingRunService — capa de persistència sobre `MarketingRun`.
 *
 * Substitueix l'estat global `activeRun` del route per consultes a la DB,
 * sobreviu reinicis del backend i permet:
 *   - Recovery a startup (marca com `abandoned` runs amb PID mort)
 *   - Reconciliation lazy a cada GET (detecta completion/failure)
 *   - Kill manual (signal SIGTERM al PID + marca `killed`)
 *
 * Estratègia de reconciliation:
 *   1. Si `hostname !== os.hostname()`, no toquem (procés en altre host)
 *   2. Si `pid` viu → segueix `running`
 *   3. Si `pid` mort + qualsevol fitxer `out/{prefix}_*.json` modificat
 *      després de `startedAt` → `completed` (i guardem el path)
 *   4. Si `pid` mort sense output → `failed`
 *
 * Concurrència: només permetem 1 run actiu alhora; comprovacions a `findActive`
 * fan reconciliation abans de retornar.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

const MARKETING_DIR = path.resolve(__dirname, '../../../marketing');
const OUT_DIR = path.join(MARKETING_DIR, 'out');

// Mapeig agent → prefix de fitxer d'output esperat (per detectar completion)
const OUTPUT_PREFIX_BY_AGENT = {
  investigator: 'investigator',
  strategist:   'strategist',
  lead_hunter:  'leads',
  fact_checker: 'fact_check',
  full_run:     'full_run',
};

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0); // signal 0 → check existence
    return true;
  } catch {
    return false;
  }
}

/**
 * Busca el fitxer d'output més recent que coincideix amb el prefix de l'agent
 * i té mtime ≥ startedAt. Retorna path o null.
 */
function findOutputFor(agent, startedAt) {
  const prefix = OUTPUT_PREFIX_BY_AGENT[agent];
  if (!prefix || !fs.existsSync(OUT_DIR)) return null;
  const startedMs = new Date(startedAt).getTime();
  const candidates = [];
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!f.startsWith(prefix) || !f.endsWith('.json')) continue;
    try {
      const stat = fs.statSync(path.join(OUT_DIR, f));
      if (stat.mtimeMs >= startedMs) candidates.push({ f, mtime: stat.mtimeMs });
    } catch { /* ignore */ }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return path.join(OUT_DIR, candidates[0].f);
}

/**
 * Llegeix el `summary` de l'output JSON (si existeix) per persistir cost.
 */
function _readSummary(outputFile) {
  try {
    const json = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    return json?.summary || null;
  } catch {
    return null;
  }
}

/**
 * Reconcilia l'estat d'un run a la DB. Retorna el run actualitzat (o el mateix
 * si no calia tocar res).
 */
async function reconcile(run) {
  if (!run || run.status !== 'running') return run;

  // Procés d'altre host → no podem decidir des d'aquí
  if (run.hostname && run.hostname !== os.hostname()) return run;

  if (isProcessAlive(run.pid)) return run;

  // Procés mort. Cerca output per decidir completed vs failed.
  const outputFile = findOutputFor(run.agent, run.startedAt);
  if (outputFile) {
    const summary = _readSummary(outputFile);
    const spentUsd = summary?.spent_usd != null ? Number(summary.spent_usd) : null;
    return await prisma.marketingRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        outputFile,
        endedAt: new Date(),
        summary: summary || undefined,
        spentUsd: spentUsd != null && Number.isFinite(spentUsd) ? spentUsd : undefined,
      },
    });
  }

  return await prisma.marketingRun.update({
    where: { id: run.id },
    data: {
      status: 'failed',
      endedAt: new Date(),
      error: 'Procés mort sense generar output',
    },
  });
}

/**
 * Retorna el run actiu (status `running`) reconciliat. Null si cap.
 * Si hi ha múltiples (no hauria de passar) reconcilia tots i retorna el
 * primer que segueixi running, o null.
 */
async function findActive() {
  const candidates = await prisma.marketingRun.findMany({
    where: { status: 'running' },
    orderBy: { startedAt: 'desc' },
  });
  for (const c of candidates) {
    const updated = await reconcile(c);
    if (updated.status === 'running') return updated;
  }
  return null;
}

/**
 * Crea un nou run a la DB.
 */
async function create({ agent, script, pid, logFile, triggeredById }) {
  return await prisma.marketingRun.create({
    data: {
      agent,
      script,
      pid,
      hostname: os.hostname(),
      logFile,
      status: 'running',
      triggeredById: triggeredById || null,
    },
  });
}

/**
 * Llistat de runs per a la UI. Per defecte últims 50.
 */
async function listRecent(limit = 50) {
  const runs = await prisma.marketingRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
  // Reconcilia silenciosament qualsevol "running" obsolet per no enganyar la UI
  const reconciled = await Promise.all(runs.map(reconcile));
  return reconciled;
}

/**
 * Mata el run actiu. Envia SIGTERM al PID si encara és viu. Marca `killed`.
 * Retorna el run actualitzat o null si no hi ha actiu.
 */
async function killActive() {
  const active = await findActive();
  if (!active) return null;
  if (active.hostname && active.hostname !== os.hostname()) {
    throw new Error(`Run en host diferent (${active.hostname}); no es pot matar des d'aquí`);
  }
  if (active.pid && isProcessAlive(active.pid)) {
    try { process.kill(active.pid, 'SIGTERM'); } catch (e) {
      logger.warn(`marketingRun: SIGTERM a PID ${active.pid} fallit: ${e.message}`);
    }
    // Donem 2s per a un cleanup gentil; si segueix viu, SIGKILL
    await new Promise((r) => setTimeout(r, 2000));
    if (isProcessAlive(active.pid)) {
      try { process.kill(active.pid, 'SIGKILL'); } catch { /* ignore */ }
    }
  }
  return await prisma.marketingRun.update({
    where: { id: active.id },
    data: {
      status: 'killed',
      endedAt: new Date(),
      error: 'Aturat manualment per usuari',
    },
  });
}

/**
 * Recovery a startup: marca com `abandoned` qualsevol `running` que no es
 * pugui reconciliar (PID mort sense output). Crida-ho un cop al boot.
 */
async function recoverOrphans() {
  const orphans = await prisma.marketingRun.findMany({
    where: { status: 'running' },
  });
  let abandoned = 0, completed = 0, failed = 0;
  for (const o of orphans) {
    // Si és d'altre host, no toquem
    if (o.hostname && o.hostname !== os.hostname()) continue;
    if (isProcessAlive(o.pid)) continue; // segueix viu, OK

    const outputFile = findOutputFor(o.agent, o.startedAt);
    if (outputFile) {
      const summary = _readSummary(outputFile);
      const spentUsd = summary?.spent_usd != null ? Number(summary.spent_usd) : null;
      await prisma.marketingRun.update({
        where: { id: o.id },
        data: {
          status: 'completed',
          outputFile,
          endedAt: new Date(),
          summary: summary || undefined,
          spentUsd: spentUsd != null && Number.isFinite(spentUsd) ? spentUsd : undefined,
        },
      });
      completed++;
    } else {
      await prisma.marketingRun.update({
        where: { id: o.id },
        data: {
          status: 'abandoned',
          endedAt: new Date(),
          error: 'Backend reiniciat amb procés perdut (recovery startup)',
        },
      });
      abandoned++;
    }
  }
  if (orphans.length) {
    logger.info(`[Marketing Run Recovery] Reconciliats ${orphans.length}: ${completed} completed, ${failed} failed, ${abandoned} abandoned`);
  }
  return { scanned: orphans.length, completed, failed, abandoned };
}

module.exports = {
  findActive,
  create,
  listRecent,
  reconcile,
  killActive,
  recoverOrphans,
  isProcessAlive,
  findOutputFor,
};
