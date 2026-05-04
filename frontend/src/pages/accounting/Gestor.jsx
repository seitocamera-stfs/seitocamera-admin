import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Send, RefreshCw, AlertCircle, AlertTriangle, Info, CheckCircle2, ChevronRight, Sparkles } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

const SEVERITY = {
  urgent: { icon: AlertTriangle, color: 'text-rose-700', bg: 'bg-rose-50 border-rose-200', label: 'Urgent' },
  high:   { icon: AlertCircle,   color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', label: 'Important' },
  normal: { icon: Info,          color: 'text-sky-700',   bg: 'bg-sky-50 border-sky-200', label: 'Normal' },
  info:   { icon: CheckCircle2,  color: 'text-gray-700',  bg: 'bg-gray-50 border-gray-200', label: 'Informació' },
};

export default function Gestor() {
  const { data: scan, loading: scanLoading, refetch: refetchScan } = useApiGet('/gestor/scan');
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);  // historial Anthropic per al tool-use loop
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [executing, setExecuting] = useState(null);
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
      const { data } = await api.post('/gestor/chat', { message, history });
      setHistory(data.history);
      setMessages((m) => [...m, {
        role: 'assistant', text: data.reply, toolCalls: data.toolCalls, proposals: data.proposals,
      }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: `❌ Error: ${err.response?.data?.error || err.message}` }]);
    } finally {
      setSending(false);
    }
  };

  const executeProposal = async (proposal) => {
    setExecuting(proposal.actionEndpoint);
    try {
      const method = (proposal.actionMethod || 'POST').toLowerCase();
      const r = await api[method](proposal.actionEndpoint, proposal.payload || {});
      setMessages((m) => [...m, { role: 'system', text: `✅ ${proposal.actionLabel} OK` + (r.data?.journalEntry?.entryNumber ? ` (assentament #${r.data.journalEntry.entryNumber})` : '') }]);
      refetchScan();
    } catch (err) {
      setMessages((m) => [...m, { role: 'system', text: `❌ ${proposal.actionLabel}: ${err.response?.data?.error || err.message}` }]);
    } finally {
      setExecuting(null);
    }
  };

  const QUICK_PROMPTS = [
    'Resum-me l\'estat de la comptabilitat',
    'Quines factures tinc per cobrar vençudes?',
    'Quin és el resultat de l\'any fins ara?',
    'Quanta IVA he de pagar aquest trimestre?',
    'Què em queda per fer per tancar l\'exercici?',
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bot size={26} className="text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Gestor IA</h1>
            <p className="text-xs text-muted-foreground">Et porta de la mà i assumeix la feina comptable. Tu només aportes documents i confirmes decisions importants.</p>
          </div>
        </div>
        <button onClick={refetchScan} disabled={scanLoading} className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm border hover:bg-muted disabled:opacity-50">
          <RefreshCw size={14} className={scanLoading ? 'animate-spin' : ''} /> Escanejar
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* TAULER PROACTIU */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Què cal mirar ara</h2>
          {scanLoading && <div className="text-sm text-muted-foreground">Escanejant...</div>}
          {scan && scan.items.length === 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-emerald-800 text-sm flex items-center gap-2">
              <CheckCircle2 size={18} /> Tot al dia. No hi ha res pendent que requereixi la teva atenció.
            </div>
          )}
          {scan && scan.items.length > 0 && (
            <div className="space-y-2">
              {scan.items.map((it) => {
                const sev = SEVERITY[it.severity] || SEVERITY.normal;
                const Icon = sev.icon;
                return (
                  <div key={it.id} className={`${sev.bg} border rounded-lg p-3`}>
                    <div className="flex items-start gap-2">
                      <Icon size={18} className={`${sev.color} mt-0.5 shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium ${sev.color} uppercase`}>{sev.label}</span>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground">{it.category}</span>
                        </div>
                        <h3 className="font-medium text-sm mt-0.5">{it.title}</h3>
                        <p className="text-xs text-muted-foreground mt-1">{it.description}</p>
                        {it.details && it.details.length > 0 && (
                          <ul className="mt-2 space-y-0.5 text-xs">
                            {it.details.map((d, i) => (
                              <li key={i} className="text-muted-foreground">· {d.text}</li>
                            ))}
                          </ul>
                        )}
                        <div className="flex gap-2 mt-2">
                          {it.actionUrl && (
                            <Link to={it.actionUrl} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border hover:bg-white/60">
                              {it.actionLabel} <ChevronRight size={12} />
                            </Link>
                          )}
                          <button
                            onClick={() => send(`Ajuda'm amb això: "${it.title}"`)}
                            className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
                          >
                            <Sparkles size={11} /> Encarrega-li al gestor
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* XAT */}
        <div className="flex flex-col h-[calc(100vh-180px)]">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Xat amb el Gestor</h2>
          <div ref={scrollRef} className="flex-1 overflow-y-auto bg-card border rounded-lg p-4 space-y-3 mb-2">
            {messages.length === 0 && (
              <div>
                <p className="text-sm text-muted-foreground mb-3">Pregunta o demana al teu Gestor IA. Exemples:</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_PROMPTS.map((q) => (
                    <button key={q} onClick={() => send(q)} className="text-xs px-3 py-1.5 rounded-full border hover:bg-muted">{q}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => <ChatMessage key={i} msg={msg} executing={executing} onExecute={executeProposal} />)}
            {sending && (
              <div className="text-xs text-muted-foreground italic">El gestor està pensant...</div>
            )}
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="flex gap-2"
          >
            <input
              className="input-field flex-1"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escriu la teva consulta..."
              disabled={sending}
            />
            <button type="submit" disabled={sending || !input.trim()} className="px-4 py-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50">
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ msg, executing, onExecute }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 max-w-[85%] text-sm whitespace-pre-wrap">{msg.text}</div>
      </div>
    );
  }
  if (msg.role === 'system') {
    return <div className="text-xs text-center text-muted-foreground italic py-1">{msg.text}</div>;
  }
  return (
    <div className="space-y-2">
      <div className="bg-muted/30 rounded-lg px-3 py-2 max-w-[90%] text-sm whitespace-pre-wrap">{msg.text}</div>
      {msg.toolCalls?.length > 0 && (
        <details className="text-xs text-muted-foreground ml-3">
          <summary className="cursor-pointer">🔧 Tools usades ({msg.toolCalls.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {msg.toolCalls.map((t, i) => (
              <li key={i}><code className="bg-muted px-1 rounded">{t.name}</code></li>
            ))}
          </ul>
        </details>
      )}
      {msg.proposals?.length > 0 && (
        <div className="space-y-2 ml-3">
          {msg.proposals.map((p, i) => (
            <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-800 mb-1">
                <Sparkles size={12} /> PROPOSTA · {p.kind}
              </div>
              <p className="text-sm">{p.actionLabel}</p>
              <button
                onClick={() => onExecute(p)}
                disabled={executing === p.actionEndpoint}
                className="mt-2 inline-flex items-center gap-1 text-xs px-3 py-1 rounded bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50"
              >
                {executing === p.actionEndpoint ? 'Executant...' : '✓ Aprovar i executar'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
