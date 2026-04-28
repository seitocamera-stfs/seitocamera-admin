import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send, Bot, User, Plus, Trash2, MessageSquare, Sparkles,
  CheckCircle2, XCircle, ChevronRight, AlertTriangle, Lightbulb,
  BarChart3, RefreshCw, Check, X,
} from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import api from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';

// ===========================================
// Components auxiliars
// ===========================================

function SuggestionCard({ suggestion, onAccept, onReject, loading }) {
  const typeIcons = {
    CLASSIFICATION: Sparkles,
    PGC_ACCOUNT: BarChart3,
    ANOMALY: AlertTriangle,
    DUPLICATE: AlertTriangle,
    MISSING_DATA: AlertTriangle,
    TAX_WARNING: AlertTriangle,
  };
  const typeColors = {
    CLASSIFICATION: 'border-blue-200 bg-blue-50',
    PGC_ACCOUNT: 'border-indigo-200 bg-indigo-50',
    ANOMALY: 'border-amber-200 bg-amber-50',
    DUPLICATE: 'border-red-200 bg-red-50',
    MISSING_DATA: 'border-orange-200 bg-orange-50',
    TAX_WARNING: 'border-red-200 bg-red-50',
  };
  const Icon = typeIcons[suggestion.type] || Lightbulb;
  const colorClass = typeColors[suggestion.type] || 'border-gray-200 bg-gray-50';

  return (
    <div className={`rounded-lg border p-3 ${colorClass}`}>
      <div className="flex items-start gap-2">
        <Icon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{suggestion.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {suggestion.receivedInvoice?.invoiceNumber} — {suggestion.receivedInvoice?.supplier?.name || 'Sense proveïdor'}
            {suggestion.receivedInvoice?.totalAmount && ` — ${formatCurrency(suggestion.receivedInvoice.totalAmount)}`}
          </div>
          {suggestion.description && (
            <div className="text-xs text-muted-foreground mt-1">{suggestion.description}</div>
          )}
          {suggestion.confidence && (
            <div className="text-xs mt-1">
              Confiança: <span className={suggestion.confidence >= 0.8 ? 'text-green-600 font-medium' : 'text-amber-600'}>{Math.round(suggestion.confidence * 100)}%</span>
            </div>
          )}
        </div>
        {suggestion.status === 'PENDING' && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => onAccept(suggestion.id)}
              disabled={loading}
              className="p-1.5 rounded-md hover:bg-green-100 text-green-600 disabled:opacity-50"
              title="Acceptar"
            >
              <Check size={14} />
            </button>
            <button
              onClick={() => onReject(suggestion.id)}
              disabled={loading}
              className="p-1.5 rounded-md hover:bg-red-100 text-red-500 disabled:opacity-50"
              title="Rebutjar"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Bot size={16} className="text-primary" />
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        }`}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>
        {message.timestamp && (
          <div className={`text-xs mt-1 ${isUser ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
            {new Date(message.timestamp).toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
          <User size={16} className="text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

// ===========================================
// Component principal
// ===========================================

export default function AccountingAgent() {
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'suggestions'
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [chatId, setChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatList, setChatList] = useState([]);
  const [classifying, setClassifying] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const { data: suggestionsData, loading: suggestionsLoading, refetch: refetchSuggestions } = useApiGet(
    '/agent/suggestions', { status: 'PENDING', limit: 50 }
  );
  const { data: summaryData, refetch: refetchSummary } = useApiGet('/agent/suggestions/summary');

  // Carregar llista de xats
  const fetchChatList = useCallback(async () => {
    try {
      const { data } = await api.get('/agent/chats');
      setChatList(data);
    } catch {}
  }, []);

  useEffect(() => {
    fetchChatList();
  }, [fetchChatList]);

  // Scroll automàtic
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Enviar missatge
  const handleSend = async (e) => {
    e?.preventDefault();
    if (!message.trim() || sending) return;

    const userMsg = message.trim();
    setMessage('');
    setSending(true);

    // Afegir missatge de l'usuari immediatament
    setMessages((prev) => [...prev, { role: 'user', content: userMsg, timestamp: new Date().toISOString() }]);

    try {
      const { data } = await api.post('/agent/chat', {
        message: userMsg,
        chatId,
      });

      setChatId(data.chatId);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.response, timestamp: new Date().toISOString() }]);
      fetchChatList();
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `❌ Error: ${err.response?.data?.error || err.message}`,
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // Nova conversa
  const handleNewChat = () => {
    setChatId(null);
    setMessages([]);
    inputRef.current?.focus();
  };

  // Carregar conversa existent
  const handleLoadChat = async (id) => {
    try {
      const { data } = await api.get(`/agent/chats/${id}`);
      setChatId(data.id);
      setMessages(data.messages || []);
    } catch {}
  };

  // Eliminar conversa
  const handleDeleteChat = async (id) => {
    try {
      await api.delete(`/agent/chats/${id}`);
      if (chatId === id) handleNewChat();
      fetchChatList();
    } catch {}
  };

  // Acceptar/rebutjar suggeriment
  const handleSuggestionAction = async (suggestionId, action) => {
    setActionLoading(true);
    try {
      await api.patch(`/agent/suggestions/${suggestionId}`, { action });
      refetchSuggestions();
      refetchSummary();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Classificar totes les pendents
  const handleClassifyAll = async () => {
    setClassifying(true);
    try {
      const { data } = await api.post('/agent/classify-batch', { all: true });
      alert(data.message);
      refetchSuggestions();
      refetchSummary();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setClassifying(false);
    }
  };

  const pendingCount = summaryData?.pending || 0;

  // Suggeriments ràpids per començar conversa
  const quickPrompts = [
    'Quant hem gastat aquest trimestre per categories?',
    'Quines factures falten per classificar?',
    'Hi ha alguna anomalia a les últimes factures?',
    'Resum de despeses vs inversions aquest any',
    'Quines factures estan pendents de pagar?',
  ];

  return (
    <div className="p-6 h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Agent comptable</h2>
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              {pendingCount} suggeriments
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('chat')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'chat' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            <MessageSquare size={14} className="inline mr-1.5" />
            Xat
          </button>
          <button
            onClick={() => setActiveTab('suggestions')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'suggestions' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            <Lightbulb size={14} className="inline mr-1.5" />
            Suggeriments
            {pendingCount > 0 && <span className="ml-1.5 bg-amber-500 text-white rounded-full px-1.5 text-xs">{pendingCount}</span>}
          </button>
        </div>
      </div>

      {activeTab === 'chat' ? (
        /* ============================== XAT ============================== */
        <div className="flex gap-4 h-[calc(100%-3rem)]">
          {/* Llista de converses */}
          <div className="w-56 shrink-0 bg-card border rounded-lg flex flex-col">
            <div className="p-3 border-b">
              <button
                onClick={handleNewChat}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
              >
                <Plus size={14} /> Nova conversa
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {chatList.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-2 px-2.5 py-2 rounded-md text-xs cursor-pointer transition-colors ${chatId === c.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  <button onClick={() => handleLoadChat(c.id)} className="flex-1 text-left truncate">
                    {c.title || 'Conversa'}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteChat(c.id); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 text-destructive"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {chatList.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4">Cap conversa</div>
              )}
            </div>
          </div>

          {/* Àrea de xat */}
          <div className="flex-1 bg-card border rounded-lg flex flex-col">
            {/* Missatges */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Bot size={48} className="text-muted-foreground/30 mb-4" />
                  <h3 className="text-lg font-medium mb-2">Agent comptable</h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-md">
                    Pregunta'm sobre les teves factures, classificació comptable, anomalies, o qualsevol dubte de comptabilitat.
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                    {quickPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => { setMessage(prompt); inputRef.current?.focus(); }}
                        className="px-3 py-1.5 rounded-full border text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg, i) => <ChatMessage key={i} message={msg} />)
              )}
              {sending && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot size={16} className="text-primary animate-pulse" />
                  </div>
                  <div className="bg-muted rounded-lg px-4 py-2.5 text-sm text-muted-foreground">
                    Pensant...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSend} className="p-3 border-t">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Escriu una pregunta..."
                  disabled={sending}
                  className="flex-1 rounded-md border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!message.trim() || sending}
                  className="px-4 py-2.5 rounded-md bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 disabled:opacity-50"
                >
                  <Send size={16} />
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        /* ========================= SUGGERIMENTS ========================= */
        <div className="space-y-4">
          {/* Accions */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Suggeriments generats automàticament per l'agent comptable. Revisa i accepta o rebutja.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { refetchSuggestions(); refetchSummary(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs hover:bg-muted"
              >
                <RefreshCw size={12} /> Actualitzar
              </button>
              <button
                onClick={handleClassifyAll}
                disabled={classifying}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50"
              >
                <Sparkles size={12} className={classifying ? 'animate-spin' : ''} />
                {classifying ? 'Classificant...' : 'Classificar pendents'}
              </button>
            </div>
          </div>

          {/* Llista de suggeriments */}
          <div className="bg-card border rounded-lg p-4">
            {suggestionsLoading ? (
              <div className="text-center text-muted-foreground py-8 text-sm">Carregant suggeriments...</div>
            ) : !suggestionsData?.data?.length ? (
              <div className="text-center py-8">
                <CheckCircle2 size={32} className="mx-auto text-green-500 mb-2" />
                <p className="text-sm text-muted-foreground">Tot al dia! No hi ha suggeriments pendents.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {suggestionsData.data.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    onAccept={(id) => handleSuggestionAction(id, 'accept')}
                    onReject={(id) => handleSuggestionAction(id, 'reject')}
                    loading={actionLoading}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
