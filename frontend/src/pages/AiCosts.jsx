import { useState, useEffect, useCallback } from 'react';
import { BrainCircuit, ChevronLeft, ChevronRight, TrendingUp, Zap, Mail, FileText, Bot, Package, GitCompare, MessageSquare, AlertTriangle, Camera } from 'lucide-react';
import api from '../lib/api';

const SERVICE_LABELS = {
  email_classification: { label: 'Classificació emails', icon: Mail, color: 'text-blue-600 bg-blue-50' },
  invoice_extraction: { label: 'Extracció factures', icon: FileText, color: 'text-emerald-600 bg-emerald-50' },
  accounting_agent: { label: 'Agent comptable', icon: Bot, color: 'text-purple-600 bg-purple-50' },
  accounting_agent_chat: { label: 'Agent comptable (xat)', icon: MessageSquare, color: 'text-purple-600 bg-purple-50' },
  accounting_agent_classify: { label: 'Agent comptable (classificació)', icon: Bot, color: 'text-violet-600 bg-violet-50' },
  accounting_agent_anomalies: { label: 'Agent comptable (anomalies)', icon: AlertTriangle, color: 'text-amber-600 bg-amber-50' },
  equipment_extraction: { label: 'Extracció equips', icon: Camera, color: 'text-orange-600 bg-orange-50' },
  conciliation: { label: 'Conciliació IA', icon: GitCompare, color: 'text-teal-600 bg-teal-50' },
};

// Tipus de canvi USD → EUR (actualitzar periòdicament)
const USD_TO_EUR = 0.88;

function toEur(usd) {
  return (usd || 0) * USD_TO_EUR;
}

function formatCost(usd) {
  const eur = toEur(usd);
  if (!eur || eur === 0) return '0,00 €';
  if (eur < 0.01) return `${eur.toFixed(4)} €`;
  return `${eur.toFixed(2)} €`;
}

function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function AiCosts() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summary, setSummary] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);

  const monthName = new Date(year, month - 1).toLocaleDateString('ca-ES', { month: 'long', year: 'numeric' });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, overRes] = await Promise.all([
        api.get(`/ai-costs/summary?year=${year}&month=${month}`),
        api.get('/ai-costs/overview'),
      ]);
      setSummary(sumRes.data);
      setOverview(overRes.data);
    } catch (err) {
      console.error('Error fetching AI costs:', err);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const total = summary?.total || { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, errors: 0 };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrainCircuit size={28} className="text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Costos IA</h1>
            <p className="text-sm text-muted-foreground">Seguiment de l'ús de Claude API</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 rounded hover:bg-accent"><ChevronLeft size={18} /></button>
          <span className="font-medium text-sm min-w-[140px] text-center capitalize">{monthName}</span>
          <button onClick={nextMonth} className="p-2 rounded hover:bg-accent"><ChevronRight size={18} /></button>
        </div>
      </div>

      {/* Cards resum */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Cost total</p>
          <p className="text-2xl font-bold text-primary">{formatCost(total.costUsd)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Crides totals</p>
          <p className="text-2xl font-bold">{total.calls.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Tokens entrada</p>
          <p className="text-2xl font-bold">{formatTokens(total.inputTokens)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Tokens sortida</p>
          <p className="text-2xl font-bold">{formatTokens(total.outputTokens)}</p>
        </div>
      </div>

      {/* Desglossament per servei */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <h2 className="font-semibold flex items-center gap-2"><Zap size={16} /> Per servei</h2>
        </div>
        <div className="divide-y">
          {(summary?.byService || []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Cap ús registrat aquest mes</p>
          ) : (
            summary.byService.map((s) => {
              const svc = SERVICE_LABELS[s.service] || { label: s.service, icon: Zap, color: 'text-gray-600 bg-gray-50' };
              const Icon = svc.icon;
              const pct = total.costUsd > 0 ? ((s.costUsd / total.costUsd) * 100).toFixed(0) : 0;
              return (
                <div key={s.service} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${svc.color}`}><Icon size={18} /></div>
                    <div>
                      <p className="font-medium text-sm">{svc.label}</p>
                      <p className="text-xs text-muted-foreground">{s.calls} crides · {formatTokens(s.inputTokens + s.outputTokens)} tokens</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatCost(s.costUsd)}</p>
                    <p className="text-xs text-muted-foreground">{pct}%</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Desglossament per model */}
      {(summary?.byModel || []).length > 0 && (
        <div className="rounded-lg border bg-card">
          <div className="p-4 border-b">
            <h2 className="font-semibold flex items-center gap-2"><BrainCircuit size={16} /> Per model</h2>
          </div>
          <div className="divide-y">
            {summary.byModel.map((m) => {
              const modelName = m.model.includes('haiku') ? 'Claude Haiku' : m.model.includes('sonnet') ? 'Claude Sonnet' : m.model.includes('opus') ? 'Claude Opus' : m.model;
              const pct = total.costUsd > 0 ? ((m.costUsd / total.costUsd) * 100).toFixed(0) : 0;
              return (
                <div key={m.model} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{modelName}</p>
                    <p className="text-xs text-muted-foreground">{m.calls} crides · {formatTokens(m.inputTokens)} in / {formatTokens(m.outputTokens)} out</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatCost(m.costUsd)}</p>
                    <p className="text-xs text-muted-foreground">{pct}%</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Evolució 6 mesos */}
      {overview?.months && (
        <div className="rounded-lg border bg-card">
          <div className="p-4 border-b">
            <h2 className="font-semibold flex items-center gap-2"><TrendingUp size={16} /> Evolució (últims 6 mesos)</h2>
          </div>
          <div className="p-4">
            <div className="flex items-end gap-2 h-40">
              {overview.months.map((m) => {
                const maxCost = Math.max(...overview.months.map(x => x.costUsd), 0.01);
                const height = maxCost > 0 ? Math.max((m.costUsd / maxCost) * 100, 2) : 2;
                return (
                  <div key={m.period} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs font-medium">{formatCost(m.costUsd)}</span>
                    <div
                      className="w-full bg-primary/80 rounded-t transition-all"
                      style={{ height: `${height}%` }}
                      title={`${m.calls} crides`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {new Date(m.period + '-01').toLocaleDateString('ca-ES', { month: 'short' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Detall diari */}
      {(summary?.dailyBreakdown || []).length > 0 && (
        <div className="rounded-lg border bg-card">
          <div className="p-4 border-b">
            <h2 className="font-semibold">Detall diari</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Dia</th>
                  <th className="p-3 text-left font-medium">Servei</th>
                  <th className="p-3 text-right font-medium">Crides</th>
                  <th className="p-3 text-right font-medium">Tokens</th>
                  <th className="p-3 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {summary.dailyBreakdown.map((row, i) => {
                  const svc = SERVICE_LABELS[row.service] || { label: row.service };
                  const dateStr = new Date(row.date).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' });
                  return (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="p-3">{dateStr}</td>
                      <td className="p-3">{svc.label}</td>
                      <td className="p-3 text-right">{row.calls}</td>
                      <td className="p-3 text-right">{formatTokens(row.inputTokens + row.outputTokens)}</td>
                      <td className="p-3 text-right font-medium">{formatCost(parseFloat(row.costUsd))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Info preus */}
      <div className="text-xs text-muted-foreground text-center space-y-1">
        <p>Preus: Haiku $1/$5 · Sonnet $3/$15 · Opus $15/$75 (per 1M tokens entrada/sortida)</p>
        <p>Conversió: 1 USD = {USD_TO_EUR} EUR · Els costos es calculen a partir dels tokens reportats per l'API</p>
      </div>
    </div>
  );
}
