import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Play, RefreshCw, Clock, FileText, AlertCircle, CheckCircle2, XCircle, Euro, StopCircle } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import { useMarketingStatus } from '../../hooks/useMarketingStatus';
import api from '../../lib/api';

const STATUS_BADGES = {
  running:   { label: 'Corrent', className: 'bg-blue-100 text-blue-800', icon: RefreshCw },
  completed: { label: 'Completat', className: 'bg-green-100 text-green-800', icon: CheckCircle2 },
  failed:    { label: 'Fallat', className: 'bg-rose-100 text-rose-800', icon: XCircle },
  killed:    { label: 'Aturat', className: 'bg-slate-100 text-slate-800', icon: StopCircle },
  abandoned: { label: 'Abandonat', className: 'bg-amber-100 text-amber-800', icon: AlertCircle },
};

function fmtDate(s) { return new Date(s).toLocaleString('ca-ES'); }
function fmtBytes(n) { return n > 1024 ? `${(n/1024).toFixed(1)} KB` : `${n} B`; }
function fmtElapsed(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export default function MarketingRuns() {
  const marketingStatus = useMarketingStatus();
  const { data, loading, refetch } = useApiGet('/marketing/runs');
  const { data: budget, refetch: refetchBudget } = useApiGet('/marketing/budget');
  const [launching, setLaunching] = useState(false);
  const [logTail, setLogTail] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('investigator');
  const [budgetError, setBudgetError] = useState(null);

  // Auto-refresh quan hi ha run actiu
  useEffect(() => {
    const active = data?.active;
    if (!active || active.status !== 'running') return;
    const interval = setInterval(() => {
      refetch();
      api.get('/marketing/runs/active/log').then((r) => {
        const log = r.data?.log || '';
        setLogTail(log.split('\n').slice(-15).join('\n'));
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [data, refetch]);

  const launch = async () => {
    setLaunching(true);
    setBudgetError(null);
    try {
      await api.post('/marketing/runs', { agent: selectedAgent });
      refetch();
      refetchBudget();
    } catch (err) {
      const code = err.response?.data?.code;
      const msg = err.response?.data?.error || err.message;
      if (code === 'MARKETING_BUDGET_EXCEEDED') {
        setBudgetError(msg);
      } else {
        alert('Error: ' + msg);
      }
    } finally { setLaunching(false); }
  };

  const killActive = async () => {
    if (!window.confirm('Aturar el run actiu? El procés rebrà SIGTERM (i SIGKILL si no respon en 2s).')) return;
    try {
      await api.post('/marketing/runs/active/kill');
      refetch();
    } catch (err) {
      alert('Error aturant: ' + (err.response?.data?.error || err.message));
    }
  };

  // Si marketing està OFF a aquest entorn (típicament producció), mostra un
  // missatge clar i no carreguem res més.
  if (marketingStatus.loaded && marketingStatus.enabled === false) {
    return (
      <div className="p-6 max-w-2xl">
        <div className="border rounded-lg p-6 bg-amber-50 border-amber-200 text-sm">
          <h2 className="font-semibold text-base mb-2 flex items-center gap-2">
            <AlertCircle size={18} className="text-amber-600" /> Marketing AI desactivat
          </h2>
          <p className="text-amber-900 mb-3">
            En aquest entorn el mòdul de marketing està desactivat (<code className="text-xs bg-white border rounded px-1 py-0.5">MARKETING_ENABLED=false</code>).
            Executa marketing localment al Mac amb Ollama (qwen3:32b, gratuït) i importa els leads aquí via:
          </p>
          <pre className="text-[11px] bg-white border rounded p-2 overflow-x-auto whitespace-pre-wrap">
{`curl -X POST ${window.location.origin}/api/marketing/import-external-leads \\
  -H "Authorization: Bearer <JWT>" \\
  -H "Content-Type: application/json" \\
  -d @marketing/out/leads_AAAAMMDD_HHMMSS.json`}
          </pre>
          <p className="text-[11px] text-amber-800 mt-3">
            Per activar al servidor cal Ollama instal·lat i <code className="bg-white border rounded px-1">MARKETING_ENABLED=true</code>.
          </p>
        </div>
      </div>
    );
  }

  if (loading || !data) return <div className="p-6">Carregant...</div>;

  const { active, runs } = data;
  const isRunning = active && active.status === 'running';

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Sparkles size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Marketing AI · Runs</h1>
        </div>
        <div className="flex gap-2 items-center">
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            disabled={launching || isRunning}
            className="px-3 py-2 border rounded-md text-sm bg-card"
          >
            <option value="investigator">Investigator (estudi de mercat)</option>
            <option value="strategist">Strategist (estratègia campanya)</option>
            <option value="lead_hunter">Lead Hunter (cerca leads)</option>
            <option value="fact_checker">Fact-Checker (verificar claims)</option>
            <option value="full_run">⭐ Estudi complet (tots en cadena)</option>
          </select>
          <button
            onClick={launch}
            disabled={launching || isRunning}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            <Play size={16} />
            {launching ? 'Llançant...' : isRunning ? 'Ja n\'hi ha un actiu' : 'Llançar'}
          </button>
        </div>
      </div>

      {/* Pressupost mensual */}
      {budget && (
        <div className={`border rounded-lg p-3 mb-4 flex items-center gap-3 ${budget.utilization_pct >= 100 ? 'bg-rose-50 border-rose-200' : budget.utilization_pct >= 80 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
          <Euro size={18} className={budget.utilization_pct >= 100 ? 'text-rose-600' : budget.utilization_pct >= 80 ? 'text-amber-600' : 'text-slate-600'} />
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs font-medium">
              <span>Cap mensual ({budget.yearMonth}) · {budget.runs_count} run{budget.runs_count === 1 ? '' : 's'}</span>
              <span className={budget.utilization_pct >= 100 ? 'text-rose-700' : 'text-slate-700'}>
                ${budget.total_usd.toFixed(2)} / ${budget.cap_usd.toFixed(2)} ({budget.utilization_pct.toFixed(0)}%)
              </span>
            </div>
            <div className="h-2 bg-white rounded mt-1.5 overflow-hidden border">
              <div
                className={`h-full transition-all ${budget.utilization_pct >= 100 ? 'bg-rose-500' : budget.utilization_pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(100, budget.utilization_pct)}%` }}
              />
            </div>
            {budget.fallback_models?.length > 0 && (
              <div className="text-[10px] text-amber-700 mt-1">
                ⚠ Models sense pricing exacte (fallback Sonnet): {budget.fallback_models.join(', ')}
              </div>
            )}
          </div>
        </div>
      )}

      {budgetError && (
        <div className="border border-rose-200 bg-rose-50 rounded-lg p-3 mb-4 text-sm text-rose-800 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium">Pressupost mensual exhaurit</div>
            <div className="text-xs mt-1">{budgetError}</div>
          </div>
        </div>
      )}

      {active && (
        <div className="border rounded-lg p-4 mb-5 bg-blue-50 border-blue-200">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {(() => {
                const b = STATUS_BADGES[active.status] || STATUS_BADGES.running;
                const Icon = b.icon;
                return (
                  <>
                    <Icon size={16} className={isRunning ? 'animate-spin' : ''} />
                    <span>Run actiu — {active.agent}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${b.className}`}>{b.label}</span>
                  </>
                );
              })()}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock size={12} /> {fmtElapsed(active.elapsed_seconds)}
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-2 flex items-center justify-between">
            <span>Iniciat: {fmtDate(active.startedAt)} · PID {active.pid}</span>
            {isRunning && (
              <button
                onClick={killActive}
                className="text-rose-600 hover:text-rose-800 inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-rose-50 text-[11px] font-medium"
                title="Atura el run (SIGTERM → SIGKILL si no respon)"
              >
                <StopCircle size={12} /> Aturar
              </button>
            )}
          </div>
          {active.error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded px-2 py-1 mb-2">
              {active.error}
            </div>
          )}
          {logTail && (
            <pre className="text-[11px] bg-white border rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap">
              {logTail}
            </pre>
          )}
          {isRunning && (
            <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <AlertCircle size={12} />
              Els runs d'Investigator amb qwen3:32b triguen ~18 min. Pots tancar la pàgina i tornar.
            </div>
          )}
        </div>
      )}

      <div className="border rounded-lg overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Fitxer</th>
              <th className="px-3 py-2 text-left font-medium">Agent</th>
              <th className="px-3 py-2 text-right font-medium">Mida</th>
              <th className="px-3 py-2 text-left font-medium">Data</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {runs.map((r) => (
              <tr key={r.filename} className="hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{r.filename}</td>
                <td className="px-3 py-2 capitalize">{r.agent}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtBytes(r.size_bytes)}</td>
                <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.created_at)}</td>
                <td className="px-3 py-2 text-right">
                  <Link
                    to={`/marketing/runs/${encodeURIComponent(r.filename)}`}
                    className="px-2 py-1 rounded border text-xs hover:bg-muted inline-flex items-center gap-1"
                  >
                    <FileText size={12} /> Veure
                  </Link>
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Encara cap run</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
