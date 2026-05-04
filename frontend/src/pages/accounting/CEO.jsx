import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Crown, Send, RefreshCw, AlertTriangle, Sparkles, TrendingUp, TrendingDown, DollarSign, Wallet, Target, Briefcase } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

const LEVEL = {
  3: { label: 'Decisió crítica', className: 'bg-rose-50 border-rose-300 text-rose-900', badgeClass: 'bg-rose-600 text-white' },
  2: { label: 'Recomanació', className: 'bg-amber-50 border-amber-300 text-amber-900', badgeClass: 'bg-amber-500 text-white' },
  1: { label: 'Informatiu', className: 'bg-sky-50 border-sky-300 text-sky-900', badgeClass: 'bg-sky-500 text-white' },
};

const RISK_LEVEL = {
  3: { color: 'text-rose-700', bg: 'bg-rose-50 border-rose-200' },
  2: { color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  1: { color: 'text-sky-700',   bg: 'bg-sky-50 border-sky-200' },
};

export default function CEO() {
  const { data: scan, loading, refetch } = useApiGet('/ceo/strategic-scan');
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: message }]);
    setSending(true);
    try {
      const { data } = await api.post('/ceo/chat', { message, history });
      setHistory(data.history);
      setMessages((m) => [...m, { role: 'assistant', text: data.reply, toolCalls: data.toolCalls, proposals: data.proposals }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: `❌ Error: ${err.response?.data?.error || err.message}` }]);
    } finally {
      setSending(false);
    }
  };

  const QUICK_PROMPTS = [
    'Fes-me un anàlisi estratègic de l\'empresa',
    'Quins són els meus 5 clients més valuosos?',
    'Quina és la salut financera ara mateix?',
    'On hauríem de millorar marges?',
    'Tinc problemes de tresoreria a la vista?',
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Crown size={26} className="text-amber-600" />
          <div>
            <h1 className="text-xl font-semibold">CEO IA estratègic</h1>
            <p className="text-xs text-muted-foreground">Visió global i executiva. Detecta riscos, oportunitats i proposa decisions amb impacte econòmic mesurable.</p>
          </div>
        </div>
        <button onClick={refetch} disabled={loading} className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm border hover:bg-muted disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualitzar
        </button>
      </div>

      {/* KPI cards */}
      {scan && <KpiCards scan={scan} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* ANÀLISI */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Anàlisi del moment</h2>
          {loading && <div className="text-sm text-muted-foreground">Analitzant...</div>}

          {scan && scan.risks.length === 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-emerald-800 text-sm">
              ✓ No es detecten riscos estratègics significatius. Tot dins de paràmetres normals.
            </div>
          )}

          {scan?.risks?.length > 0 && (
            <div className="space-y-2 mb-4">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">Riscos detectats</h3>
              {scan.risks.map((r, i) => {
                const lvl = RISK_LEVEL[r.level] || RISK_LEVEL[1];
                return (
                  <div key={i} className={`${lvl.bg} border rounded-lg p-3`}>
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className={`${lvl.color} mt-0.5`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium ${lvl.color} uppercase`}>Nivell {r.level} · {r.category}</span>
                        </div>
                        <h4 className="font-medium text-sm mt-0.5">{r.title}</h4>
                        <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                        <button
                          onClick={() => send(`Explica'm el risc "${r.title}" i què faries.`)}
                          className="text-xs mt-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-700 text-white hover:bg-amber-800"
                        >
                          <Sparkles size={11} /> Demanar al CEO
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {scan && (
            <div className="bg-card border rounded-lg p-3 mb-3">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Top 5 clients ({scan.kpi.year})</h3>
              {scan.topClients.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sense dades.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {scan.topClients.map((c) => (
                    <li key={c.clientId} className="flex items-center justify-between">
                      <span className="truncate flex-1 mr-2">{c.name}</span>
                      <span className="text-xs text-muted-foreground mr-2">{c.sharePct}%</span>
                      <span className="font-mono text-xs">{c.totalBilled.toFixed(2)} €</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {scan && scan.cashflow && (
            <div className={`bg-card border rounded-lg p-3 ${scan.cashflow.risk === 'CRITICAL' ? 'border-rose-300' : scan.cashflow.risk === 'TENSE' ? 'border-amber-300' : ''}`}>
              <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Projecció de tresoreria (60 dies)</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Saldo actual: <strong>{scan.cashflow.cashBalance.toFixed(2)} €</strong></div>
                <div>+ Cobraments: <strong className="text-emerald-700">{scan.cashflow.expectedCollections.toFixed(2)} €</strong></div>
                <div>- Pagaments: <strong className="text-rose-700">{scan.cashflow.expectedPayments.toFixed(2)} €</strong></div>
                <div>= Projecció: <strong className={scan.cashflow.projectedBalance < 0 ? 'text-rose-700' : ''}>{scan.cashflow.projectedBalance.toFixed(2)} €</strong></div>
              </div>
            </div>
          )}
        </div>

        {/* XAT */}
        <div className="flex flex-col h-[calc(100vh-360px)] min-h-[500px]">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Xat amb el CEO</h2>
          <div ref={scrollRef} className="flex-1 overflow-y-auto bg-card border rounded-lg p-4 space-y-3 mb-2">
            {messages.length === 0 && (
              <div>
                <p className="text-sm text-muted-foreground mb-3">Pregunta o demana al teu CEO IA. Exemples:</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_PROMPTS.map((q) => (
                    <button key={q} onClick={() => send(q)} className="text-xs px-3 py-1.5 rounded-full border hover:bg-muted text-left">{q}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => <ChatMessage key={i} msg={msg} />)}
            {sending && <div className="text-xs text-muted-foreground italic">El CEO està analitzant...</div>}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2">
            <input className="input-field flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Pregunta el CEO..." disabled={sending} />
            <button type="submit" disabled={sending || !input.trim()} className="px-4 py-2 rounded-md bg-amber-600 text-white disabled:opacity-50">
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function KpiCards({ scan }) {
  const k = scan.kpi;
  const marginColor = k.marginPct < 0 ? 'text-rose-600' : k.marginPct < 10 ? 'text-amber-600' : 'text-emerald-600';
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Kpi icon={DollarSign} label={`Facturació ${k.year}`} value={`${k.facturacioTotal.toFixed(2)} €`} sub={`${k.nFactures} factures · ${k.collectionRate}% cobrat`} color="text-sky-600" />
      <Kpi icon={k.marginPct < 0 ? TrendingDown : TrendingUp} label="Marge brut" value={`${k.grossMargin.toFixed(2)} €`} sub={`${k.marginPct}% sobre ingressos`} color={marginColor} />
      <Kpi icon={Wallet} label="Tresoreria" value={`${k.cashBalance.toFixed(2)} €`} sub={`Liquiditat neta ${k.netLiquidity.toFixed(2)} €`} color={k.cashBalance < 0 ? 'text-rose-600' : 'text-primary'} />
      <Kpi icon={Target} label="Pendent cobrar" value={`${k.pendingCollect.toFixed(2)} €`} sub={`Pendent pagar ${k.pendingPay.toFixed(2)} €`} color="text-violet-600" />
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon size={14} /> {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function ChatMessage({ msg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-amber-600 text-white rounded-lg px-3 py-2 max-w-[85%] text-sm whitespace-pre-wrap">{msg.text}</div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="bg-muted/30 rounded-lg px-3 py-3 max-w-[95%] text-sm whitespace-pre-wrap leading-relaxed">{msg.text}</div>
      {msg.toolCalls?.length > 0 && (
        <details className="text-xs text-muted-foreground ml-3">
          <summary className="cursor-pointer">🔧 Tools usades ({msg.toolCalls.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {msg.toolCalls.map((t, i) => (<li key={i}><code className="bg-muted px-1 rounded">{t.name}</code></li>))}
          </ul>
        </details>
      )}
      {msg.proposals?.filter((p) => p.kind === 'ACTION_PLAN').map((p, i) => (
        <ActionPlanCard key={i} plan={p} />
      ))}
    </div>
  );
}

function ActionPlanCard({ plan }) {
  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 ml-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 mb-2">
        <Briefcase size={14} /> Pla d'acció proposat ({plan.totalActions} accions)
      </div>
      <div className="text-xs text-amber-800 mb-3">
        Nivell 1 (informatiu): <strong>{plan.byLevel[1] || 0}</strong> · Nivell 2 (recomanació): <strong>{plan.byLevel[2] || 0}</strong> · Nivell 3 (decisió crítica): <strong>{plan.byLevel[3] || 0}</strong>
      </div>
      <ul className="space-y-2">
        {plan.actions.map((a, i) => {
          const lvl = LEVEL[a.level] || LEVEL[1];
          return (
            <li key={i} className={`${lvl.className} border rounded p-3`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`${lvl.badgeClass} text-[10px] font-bold rounded-full px-2 py-0.5 uppercase`}>Nivell {a.level}</span>
                <span className="text-[10px] text-muted-foreground uppercase">{a.category}</span>
              </div>
              <h5 className="font-semibold text-sm">{a.title}</h5>
              <p className="text-xs mt-1">{a.description}</p>
              {a.estimatedImpact && <p className="text-xs italic mt-1">Impacte: {a.estimatedImpact}</p>}
              {a.actionUrl && <Link to={a.actionUrl} className="text-xs underline mt-1 inline-block">Anar a la pantalla</Link>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
