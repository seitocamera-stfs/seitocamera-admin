import { useEffect, useState, useCallback } from 'react';
import {
  User as UserIcon, Send, Bell, ExternalLink, Copy, Check,
  Loader2, AlertCircle, Trash2, MessageCircle,
} from 'lucide-react';
import api from '../lib/api';
import useAuthStore from '../stores/authStore';

export default function Profile() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <UserIcon size={22} />
          {user?.name}
        </h1>
        <p className="text-sm text-muted-foreground">{user?.email} · {user?.role}</p>
      </header>

      <TelegramSection />

      {/* Aquí podrem afegir més seccions: notificacions push, password, etc. */}
    </div>
  );
}

// ============================================================
// Telegram — vinculació + preferències
// ============================================================
function TelegramSection() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [linkData, setLinkData] = useState(null);
  const [pulling, setPulling] = useState(false);
  const [copiedField, setCopiedField] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/telegram/status');
      setStatus(res.data);
      // Si ja hi ha codi pendent, mostrem-lo
      if (res.data.pendingCode && new Date(res.data.pendingExpires) > new Date()) {
        setLinkData({
          linkCode: res.data.pendingCode,
          expires: res.data.pendingExpires,
          url: `https://t.me/${res.data.botUsername}?start=${res.data.pendingCode}`,
          botUsername: res.data.botUsername,
        });
      } else {
        setLinkData(null);
      }
    } catch (err) {
      console.error('Error carregant estat Telegram:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Polling cada 3s mentre tinguem un codi pendent — perquè quan l'usuari
  // confirmi al bot, l'UI ho detecti automàticament.
  useEffect(() => {
    if (!linkData || status?.linked) return;
    const id = setInterval(reload, 3000);
    return () => clearInterval(id);
  }, [linkData, status?.linked, reload]);

  const handleStartLink = async () => {
    setPulling(true);
    try {
      const res = await api.post('/telegram/link/start');
      setLinkData(res.data);
      reload();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setPulling(false);
    }
  };

  const handleUnlink = async () => {
    if (!confirm('Segur que vols desvincular Telegram?')) return;
    try {
      await api.post('/telegram/link/cancel');
      setLinkData(null);
      reload();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleSendTest = async () => {
    try {
      await api.post('/telegram/test');
      alert('✓ Missatge de prova enviat — revisa el teu Telegram');
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleToggleNotifications = async (enabled) => {
    try {
      await api.post('/telegram/preferences', { notifyTelegram: enabled });
      reload();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  const copy = (text, field) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  if (loading) {
    return (
      <section className="bg-card border rounded-lg p-6 flex justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </section>
    );
  }

  if (!status?.enabled) {
    return (
      <section className="bg-card border rounded-lg p-4">
        <div className="flex items-start gap-3 text-sm">
          <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="font-medium">Telegram no està configurat</h2>
            <p className="text-xs text-muted-foreground mt-1">
              L'administrador encara no ha activat el bot de Telegram al servidor.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-card border rounded-lg overflow-hidden">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <h2 className="font-medium flex items-center gap-2">
            <MessageCircle size={18} className="text-blue-500" />
            Notificacions per Telegram
          </h2>
          {status.linked && (
            <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
              Vinculat
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Rep recordatoris de tasques al teu xat personal de Telegram.
        </p>
      </div>

      <div className="p-4 space-y-4">
        {!status.linked && !linkData && (
          <div className="text-center space-y-3 py-6">
            <p className="text-sm text-muted-foreground">
              No tens cap compte de Telegram vinculat.
            </p>
            <button
              onClick={handleStartLink}
              disabled={pulling}
              className="inline-flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50"
            >
              {pulling ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Vincular el meu Telegram
            </button>
          </div>
        )}

        {!status.linked && linkData && (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded p-3 space-y-2">
              <p className="text-xs text-amber-800 font-medium">
                Pendent de confirmació al bot de Telegram
              </p>
              <p className="text-[11px] text-amber-700">
                Caduca: {new Date(linkData.expires).toLocaleString('ca-ES')}
              </p>
            </div>

            <ol className="text-xs space-y-2 list-decimal list-inside">
              <li>
                <a
                  href={linkData.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline inline-flex items-center gap-1"
                >
                  Obre <code className="bg-muted px-1.5 py-0.5 rounded">@{linkData.botUsername}</code> a Telegram
                  <ExternalLink size={10} />
                </a>
              </li>
              <li>Apreta el botó <strong>START</strong> (o envia <code className="bg-muted px-1 rounded">/start {linkData.linkCode}</code>)</li>
              <li>Espera fins que el bot et confirmi la vinculació (~2s)</li>
            </ol>

            <div className="flex items-center gap-2 bg-muted/50 rounded p-2">
              <code className="text-[10px] flex-1 truncate">{linkData.url}</code>
              <button
                onClick={() => copy(linkData.url, 'url')}
                className="text-muted-foreground hover:text-foreground p-1"
                title="Copiar"
              >
                {copiedField === 'url' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <p className="text-[10px] text-muted-foreground italic">
                S'actualitzarà automàticament en confirmar...
              </p>
              <button
                onClick={handleUnlink}
                className="text-[11px] text-red-500 hover:underline"
              >
                Cancel·lar
              </button>
            </div>
          </div>
        )}

        {status.linked && (
          <div className="space-y-3">
            <div className="bg-green-50 border border-green-200 rounded p-3 text-sm">
              <p className="font-medium text-green-800">✓ Telegram vinculat correctament</p>
              {status.telegramUsername && (
                <p className="text-xs text-green-700 mt-1">
                  Compte: <strong>@{status.telegramUsername}</strong>
                </p>
              )}
              {status.linkedAt && (
                <p className="text-xs text-green-600 mt-1">
                  Des de: {new Date(status.linkedAt).toLocaleDateString('ca-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}
            </div>

            <label className="flex items-center justify-between gap-3 p-3 bg-muted/30 rounded">
              <div className="flex items-center gap-2 text-sm">
                <Bell size={14} className="text-muted-foreground" />
                <span>Rebre recordatoris de tasques per Telegram</span>
              </div>
              <input
                type="checkbox"
                checked={status.notifyTelegram}
                onChange={(e) => handleToggleNotifications(e.target.checked)}
                className="w-4 h-4 cursor-pointer"
              />
            </label>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSendTest}
                className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs border rounded px-3 py-2 hover:bg-muted/50"
              >
                <Send size={12} />
                Enviar missatge de prova
              </button>
              <button
                onClick={handleUnlink}
                className="inline-flex items-center justify-center gap-1.5 text-xs border border-red-200 text-red-600 hover:bg-red-50 rounded px-3 py-2"
              >
                <Trash2 size={12} />
                Desvincular
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
