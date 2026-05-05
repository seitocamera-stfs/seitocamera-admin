import { useState, useRef, useEffect } from 'react';
import { Warehouse, Send, RefreshCw, Wrench, Bell, ListTodo, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';

const SUGGESTED_PROMPTS = [
  { icon: ListTodo,    label: "Què s'ha de preparar avui?" },
  { icon: AlertTriangle, label: 'Tinc conflictes d\'equipament?' },
  { icon: Wrench,      label: 'Crea les tasques de prep dels projectes d\'avui' },
  { icon: Bell,        label: 'Avisa els responsables de les devolucions endarrerides' },
];

export default function WarehouseAgent() {
  const [messages, setMessages] = useState([]);  // {role, text, toolCalls?}
  const [history, setHistory] = useState([]);    // anthropic-style messages
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const send = async (text) => {
    const userMsg = (text || input || '').trim();
    if (!userMsg || sending) return;
    setMessages((m) => [...m, { role: 'user', text: userMsg }]);
    setInput('');
    setSending(true);
    try {
      const r = await api.post('/warehouse-agent/chat', { message: userMsg, history });
      setMessages((m) => [...m, { role: 'assistant', text: r.data.reply, toolCalls: r.data.toolCalls || [] }]);
      setHistory(r.data.history || []);
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      setMessages((m) => [...m, { role: 'assistant', text: `❌ Error: ${errMsg}`, toolCalls: [] }]);
    } finally { setSending(false); }
  };

  const reset = () => {
    setMessages([]);
    setHistory([]);
    setInput('');
  };

  return (
    <div className="p-6 max-w-4xl flex flex-col" style={{ height: 'calc(100vh - 4rem)' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Warehouse size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Magatzem IA</h1>
          <span className="text-xs text-muted-foreground">Operatiu · pot crear tasques i notificar</span>
        </div>
        {messages.length > 0 && (
          <button onClick={reset} className="px-3 py-1.5 rounded-md text-sm border hover:bg-muted flex items-center gap-2">
            <RefreshCw size={14} /> Nova conversa
          </button>
        )}
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 overflow-auto border rounded-lg p-4 mb-3 bg-card space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <Warehouse size={48} className="mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              Pregunta sobre l'estat del magatzem, conflictes d'equipament, devolucions, o demana al Magatzem IA que creï tasques i notifiqui l'equip.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-2xl mx-auto">
              {SUGGESTED_PROMPTS.map((p) => {
                const I = p.icon;
                return (
                  <button
                    key={p.label}
                    onClick={() => send(p.label)}
                    className="text-left px-3 py-2 rounded-md border hover:bg-muted text-sm flex items-center gap-2"
                  >
                    <I size={14} className="text-primary flex-shrink-0" />
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/40 border'
              }`}>
                {m.text}
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <details className="mt-2 text-xs opacity-70">
                    <summary className="cursor-pointer">Tool calls ({m.toolCalls.length})</summary>
                    <ul className="ml-3 mt-1 space-y-0.5">
                      {m.toolCalls.map((tc, j) => (
                        <li key={j}>
                          <code>{tc.name}</code>
                          {tc.result?.error && <span className="text-rose-600 ml-2">⚠ {tc.result.error}</span>}
                          {tc.result?.notified && <span className="text-green-700 ml-2">✓ {tc.result.notified} notif</span>}
                          {tc.result?.task && <span className="text-green-700 ml-2">✓ tasca creada</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw size={14} className="animate-spin" /> Pensant...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !sending && send()}
          placeholder="Pregunta al Magatzem IA..."
          disabled={sending}
          className="flex-1 px-3 py-2 border rounded-md text-sm disabled:opacity-50"
        />
        <button
          onClick={() => send()}
          disabled={sending || !input.trim()}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
        >
          <Send size={14} /> Enviar
        </button>
      </div>

      <p className="text-xs text-muted-foreground mt-2">
        ℹ️ Aquest agent pot crear tasques reals i enviar notificacions a l'equip. Cada acció executada es marca als detalls.
      </p>
    </div>
  );
}
