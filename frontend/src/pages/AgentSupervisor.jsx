import { useState, useEffect, useCallback } from 'react';
import {
  Activity, Play, Pause, RefreshCw, Clock, CheckCircle2,
  XCircle, AlertTriangle, BarChart3, Layers, GitCompare,
  FileText, Zap, Settings, History, TrendingUp, Warehouse,
} from 'lucide-react';
import api from '../lib/api';
import { invalidateAgentToggles } from '../hooks/useAgentToggles';

// ===========================================
// Constants
// ===========================================

const JOB_META = {
  classify: { label: 'Classificar factures', icon: Layers, color: 'text-blue-600 bg-blue-50' },
  anomalies: { label: 'Detectar anomalies', icon: AlertTriangle, color: 'text-amber-600 bg-amber-50' },
  duplicates: { label: 'Detectar duplicats', icon: FileText, color: 'text-red-600 bg-red-50' },
  overdue: { label: 'Venciments propers', icon: Clock, color: 'text-orange-600 bg-orange-50' },
  conciliation: { label: 'Proposar conciliació', icon: GitCompare, color: 'text-emerald-600 bg-emerald-50' },
  warehouse_agent: { label: 'Magatzem IA', icon: Warehouse, color: 'text-indigo-600 bg-indigo-50' },
};

const STATUS_BADGE = {
  completed: { label: 'Completat', icon: CheckCircle2, cls: 'text-green-700 bg-green-50' },
  running: { label: 'Executant...', icon: RefreshCw, cls: 'text-blue-700 bg-blue-50' },
  failed: { label: 'Error', icon: XCircle, cls: 'text-red-700 bg-red-50' },
};

function formatDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDateTime(iso) {
  if (!iso) return 'Mai';
  const d = new Date(iso);
  const day = d.toLocaleDateString('ca-ES', { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

// ===========================================
// Components
// ===========================================

function JobConfigCard({ config, onToggle, onRun, running }) {
  const meta = JOB_META[config.jobType] || { label: config.label, icon: Zap, color: 'text-gray-600 bg-gray-50' };
  const Icon = meta.icon;

  return (
    <div className={`rounded-lg border p-4 ${config.isEnabled ? 'bg-white' : 'bg-gray-50 opacity-75'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-lg ${meta.color}`}>
            <Icon size={18} />
          </div>
          <div>
            <div className="font-medium text-sm">{meta.label}</div>
            <div className="text-xs text-muted-foreground">{config.description || config.cronSchedule}</div>
          </div>
        </div>
        <button
          onClick={() => onToggle(config.jobType, !config.isEnabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.isEnabled ? 'bg-[#00617F]' : 'bg-gray-300'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.isEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Clock size={12} />
          <span>Cron: {config.cronSchedule}</span>
        </div>
        <div>Última: {formatDateTime(config.lastRunAt)}</div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onRun(config.jobType)}
          disabled={running === config.jobType}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-[#00617F] text-white hover:bg-[#004d66] disabled:opacity-50 transition-colors"
        >
          {running === config.jobType ? (
            <><RefreshCw size={12} className="animate-spin" /> Executant...</>
          ) : (
            <><Play size={12} /> Executar ara</>
          )}
        </button>
      </div>
    </div>
  );
}

function JobHistoryRow({ job }) {
  const meta = JOB_META[job.jobType] || { label: job.jobType, icon: Zap, color: 'text-gray-600 bg-gray-50' };
  const Icon = meta.icon;
  const status = STATUS_BADGE[job.status] || STATUS_BADGE.failed;
  const StatusIcon = status.icon;

  return (
    <tr className="border-b last:border-0 hover:bg-gray-50/50">
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2">
          <Icon size={14} className={meta.color.split(' ')[0]} />
          <span className="text-sm">{meta.label}</span>
        </div>
      </td>
      <td className="py-2.5 px-3">
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${status.cls}`}>
          <StatusIcon size={12} className={job.status === 'running' ? 'animate-spin' : ''} />
          {status.label}
        </span>
      </td>
      <td className="py-2.5 px-3 text-sm text-right">{job.itemsProcessed}</td>
      <td className="py-2.5 px-3 text-sm text-right">{job.itemsCreated}</td>
      <td className="py-2.5 px-3 text-sm text-muted-foreground">{formatDuration(job.durationMs)}</td>
      <td className="py-2.5 px-3 text-xs text-muted-foreground">{formatDateTime(job.startedAt)}</td>
      <td className="py-2.5 px-3 text-sm text-muted-foreground max-w-[200px] truncate">
        {job.error || job.summary || '—'}
      </td>
    </tr>
  );
}

function StatsCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} className={color} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// ===========================================
// Pàgina principal
// ===========================================

// ===========================================
// AI Review — passades puntuals manuals
// ===========================================
function AiReviewPanel({ onComplete }) {
  const [running, setRunning] = useState(null);  // 'duplicates' | 'conciliation' | null
  const [lastResult, setLastResult] = useState(null);  // { type, stats, error }

  const runReview = async (kind) => {
    if (running) return;
    setRunning(kind);
    setLastResult(null);
    try {
      const r = await api.post(`/agent/ai-review/${kind}`);
      setLastResult({ type: kind, stats: r.data });
      onComplete?.();
    } catch (err) {
      setLastResult({ type: kind, error: err.response?.data?.error || err.message });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div>
      <h2 className="text-base font-medium flex items-center gap-2 mb-3">
        <Zap size={16} /> Passades puntuals amb IA
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded-lg p-4 bg-white">
          <div className="flex items-start gap-3 mb-2">
            <FileText size={18} className="text-red-600 mt-0.5" />
            <div>
              <h3 className="font-medium">Repas de duplicats</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                IA repassa factures dels últims 90 dies per supplier i detecta duplicats que SQL exacte no captura
                (OCR misreads, descripcions equivalents). Crea suggeriments PENDING per revisar.
              </p>
            </div>
          </div>
          <button
            onClick={() => runReview('duplicates')}
            disabled={!!running}
            className="mt-2 px-3 py-1.5 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {running === 'duplicates' ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {running === 'duplicates' ? 'Revisant…' : 'Llançar repas IA'}
          </button>
        </div>

        <div className="border rounded-lg p-4 bg-white">
          <div className="flex items-start gap-3 mb-2">
            <GitCompare size={18} className="text-emerald-600 mt-0.5" />
            <div>
              <h3 className="font-medium">Repas de conciliació</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                IA proposa matches banc↔factura per casos que SQL exacte no captura (parcials, agrupats, comissions).
                Crea suggeriments CONCILIATION_MATCH PENDING.
              </p>
            </div>
          </div>
          <button
            onClick={() => runReview('conciliation')}
            disabled={!!running}
            className="mt-2 px-3 py-1.5 rounded-md text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {running === 'conciliation' ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {running === 'conciliation' ? 'Revisant…' : 'Llançar repas IA'}
          </button>
        </div>
      </div>

      {lastResult && (
        <div className={`mt-3 p-3 rounded-md border text-sm ${lastResult.error ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
          <strong>Resultat {lastResult.type}:</strong>{' '}
          {lastResult.error
            ? lastResult.error
            : lastResult.type === 'duplicates'
              ? `${lastResult.stats.suppliersChecked || 0} proveïdors revisats · ${lastResult.stats.totalInvoicesScanned || 0} factures · ${lastResult.stats.suggestionsCreated || 0} suggeriments creats · ${lastResult.stats.errors || 0} errors`
              : `${lastResult.stats.batchesProcessed || 0} lots · ${lastResult.stats.matchesProposed || 0} matches proposats · ${lastResult.stats.suggestionsCreated || 0} suggeriments creats · ${lastResult.stats.errors || 0} errors`}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground mt-2">
        ⚠ Cada passada pot trigar 2-10 min depenent del volum. Usa Qwen3:32b local (cost €0). Revisa els suggeriments creats al final d'aquesta pàgina o al Gestor IA.
      </p>
    </div>
  );
}

export default function AgentSupervisor() {
  const [configs, setConfigs] = useState([]);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(null);
  const [historyFilter, setHistoryFilter] = useState('all');

  const fetchAll = useCallback(async () => {
    try {
      const [cfgRes, histRes, statsRes] = await Promise.all([
        api.get('/agent/jobs/config'),
        api.get('/agent/jobs/history?limit=50'),
        api.get('/agent/jobs/stats'),
      ]);
      setConfigs(cfgRes.data);
      setHistory(histRes.data);
      setStats(statsRes.data);
    } catch (err) {
      console.error('Error carregant dades supervisor:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh cada 30s
  useEffect(() => {
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const handleToggle = async (jobType, isEnabled) => {
    try {
      await api.put(`/agent/jobs/config/${jobType}`, { isEnabled });
      setConfigs((prev) => prev.map((c) => (c.jobType === jobType ? { ...c, isEnabled } : c)));
      // Invalida cache compartida perquè Sidebar/Dashboard mostrin el canvi sense recarregar
      invalidateAgentToggles();
    } catch (err) {
      console.error('Error toggling job:', err);
    }
  };

  const handleRun = async (jobType) => {
    setRunning(jobType);
    try {
      await api.post(`/agent/jobs/run/${jobType}`);
      // Esperar un moment i refrescar
      setTimeout(fetchAll, 1500);
    } catch (err) {
      console.error('Error executant job:', err);
    } finally {
      setTimeout(() => setRunning(null), 2000);
    }
  };

  const filteredHistory = historyFilter === 'all'
    ? history
    : history.filter((h) => h.jobType === historyFilter);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <RefreshCw size={24} className="animate-spin text-[#00617F]" />
      </div>
    );
  }

  const totalRuns = stats?.totalRuns || 0;
  const totalSuggestions = stats?.totalSuggestions || 0;
  const failedRuns = stats?.failedRuns || 0;
  const enabledJobs = configs.filter((c) => c.isEnabled).length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Activity size={22} className="text-[#00617F]" />
            Supervisor de l'Agent
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Monitora i controla els treballs automàtics de l'agent comptable
          </p>
        </div>
        <button
          onClick={fetchAll}
          className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 transition-colors"
        >
          <RefreshCw size={14} /> Refrescar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard icon={Zap} label="Jobs actius" value={enabledJobs} sub={`de ${configs.length} totals`} color="text-[#00617F]" />
        <StatsCard icon={TrendingUp} label="Execucions totals" value={totalRuns} color="text-blue-600" />
        <StatsCard icon={CheckCircle2} label="Suggeriments creats" value={totalSuggestions} color="text-green-600" />
        <StatsCard icon={XCircle} label="Errors" value={failedRuns} color="text-red-500" />
      </div>

      {/* Passades puntuals amb IA */}
      <AiReviewPanel onComplete={fetchAll} />

      {/* Job Configs */}
      <div>
        <h2 className="text-base font-medium flex items-center gap-2 mb-3">
          <Settings size={16} /> Configuració de Jobs
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {configs.map((config) => (
            <JobConfigCard
              key={config.jobType}
              config={config}
              onToggle={handleToggle}
              onRun={handleRun}
              running={running}
            />
          ))}
          {configs.length === 0 && (
            <div className="col-span-3 text-center text-muted-foreground py-8">
              Cap job configurat. S'inicialitzaran automàticament al reiniciar el servidor.
            </div>
          )}
        </div>
      </div>

      {/* History */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-medium flex items-center gap-2">
            <History size={16} /> Historial d'execucions
          </h2>
          <select
            value={historyFilter}
            onChange={(e) => setHistoryFilter(e.target.value)}
            className="text-sm border rounded-md px-2 py-1"
          >
            <option value="all">Tots</option>
            {Object.entries(JOB_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        {filteredHistory.length > 0 ? (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50/80">
                <tr className="text-xs text-muted-foreground">
                  <th className="py-2 px-3 font-medium">Job</th>
                  <th className="py-2 px-3 font-medium">Estat</th>
                  <th className="py-2 px-3 font-medium text-right">Processats</th>
                  <th className="py-2 px-3 font-medium text-right">Creats</th>
                  <th className="py-2 px-3 font-medium">Duració</th>
                  <th className="py-2 px-3 font-medium">Inici</th>
                  <th className="py-2 px-3 font-medium">Resum/Error</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((job) => (
                  <JobHistoryRow key={job.id} job={job} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-8 border rounded-lg">
            Encara no hi ha execucions registrades
          </div>
        )}
      </div>
    </div>
  );
}
