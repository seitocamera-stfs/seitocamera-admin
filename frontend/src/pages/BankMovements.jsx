import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Search, ArrowUpCircle, ArrowDownCircle, Trash2, RefreshCw, CheckCircle2, AlertCircle, MessageSquare, Send, X, Settings, Upload, Building2, Wifi, WifiOff, Link, Unlink, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import Modal from '../components/shared/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import api from '../lib/api';
import ExportButtons from '../components/shared/ExportButtons';

function SyncStatus({ lastSync, onSync, syncing }) {
  if (!lastSync && !syncing) {
    return (
      <button onClick={onSync} className="flex items-center gap-2 px-3 py-2 rounded-md border text-sm hover:bg-muted">
        <RefreshCw size={14} /> Sincronitzar
      </button>
    );
  }

  const timeAgo = lastSync?.timestamp ? getTimeAgo(lastSync.timestamp) : null;

  return (
    <div className="flex items-center gap-2">
      {lastSync?.success === true && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground" title={`${lastSync.created || 0} nous, ${lastSync.skipped || 0} omesos`}>
          <CheckCircle2 size={12} className="text-green-500" />
          Sync {timeAgo}
          {lastSync.created > 0 && <span className="text-green-600 font-medium">+{lastSync.created}</span>}
        </span>
      )}
      {lastSync?.success === false && (
        <span className="flex items-center gap-1 text-xs text-red-500" title={lastSync.error}>
          <AlertCircle size={12} /> Error sync {timeAgo}
        </span>
      )}
      <button
        onClick={onSync}
        disabled={syncing}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs hover:bg-muted disabled:opacity-50"
        title="Sincronitzar moviments bancaris"
      >
        <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
        {syncing ? 'Sincronitzant...' : 'Sync'}
      </button>
    </div>
  );
}

function getTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ara';
  if (mins < 60) return `fa ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `fa ${hours}h`;
  const days = Math.floor(hours / 24);
  return `fa ${days}d`;
}

// ===========================================
// Gestió comptes bancaris
// ===========================================
function BankAccountsModal({ isOpen, onClose, accounts, onRefresh }) {
  const [form, setForm] = useState({ name: '', iban: '', bankEntity: '', syncType: 'MANUAL', color: '#2390A0' });
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [connectingId, setConnectingId] = useState(null);
  const [connectForm, setConnectForm] = useState({});
  const [connectStatus, setConnectStatus] = useState({});
  const [showSecret, setShowSecret] = useState({});

  const COLORS = ['#6C5CE7', '#2390A0', '#E17055', '#00B894', '#FDCB6E', '#636E72', '#0984E3', '#D63031'];

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/bank-accounts/${editing}`, form);
      } else {
        await api.post('/bank-accounts', form);
      }
      setForm({ name: '', iban: '', bankEntity: '', syncType: 'MANUAL', color: '#2390A0' });
      setEditing(null);
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || 'Error');
    }
    setSaving(false);
  };

  const handleEdit = (acc) => {
    setEditing(acc.id);
    setForm({ name: acc.name, iban: acc.iban || '', bankEntity: acc.bankEntity || '', syncType: acc.syncType, color: acc.color });
  };

  const handleDelete = async (id) => {
    if (!confirm('Desactivar aquest compte bancari?')) return;
    try {
      await api.delete(`/bank-accounts/${id}`);
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || 'Error');
    }
  };

  // Connexió API
  const handleConnect = async (accId, syncType) => {
    try {
      setConnectStatus((s) => ({ ...s, [accId]: { loading: true } }));

      if (syncType === 'QONTO') {
        const { data } = await api.post(`/bank-accounts/${accId}/connect`, {
          syncType: 'QONTO',
          config: { orgSlug: connectForm[accId]?.orgSlug, secretKey: connectForm[accId]?.secretKey },
        });
        setConnectStatus((s) => ({ ...s, [accId]: { success: true, message: data.message } }));
        onRefresh();
      } else if (syncType === 'OPEN_BANKING') {
        // Plaid Link flow
        await openPlaidLink(accId);
      }
    } catch (err) {
      setConnectStatus((s) => ({ ...s, [accId]: { error: err.response?.data?.error || err.message } }));
    }
  };

  // Plaid Link: obre el widget per vincular un compte bancari
  const openPlaidLink = async (bankAccountId) => {
    try {
      setConnectStatus((s) => ({ ...s, [bankAccountId]: { loading: true, message: 'Carregant Plaid Link...' } }));

      // 1. Obtenir link_token del backend
      const { data: linkData } = await api.post('/connections/plaid/link-token');
      const linkToken = linkData.linkToken;

      // 2. Carregar l'script de Plaid Link si no existeix
      if (!window.Plaid) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
          script.onload = resolve;
          script.onerror = () => reject(new Error('No s\'ha pogut carregar Plaid Link'));
          document.head.appendChild(script);
        });
      }

      // 3. Obrir Plaid Link
      const handler = window.Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken, metadata) => {
          try {
            setConnectStatus((s) => ({ ...s, [bankAccountId]: { loading: true, message: 'Vinculant compte...' } }));
            // Intercanviar public_token per access_token al backend
            const { data: exchangeData } = await api.post('/connections/plaid/exchange', {
              publicToken,
              bankAccountId,
            });
            setConnectStatus((s) => ({ ...s, [bankAccountId]: { success: true, message: 'Compte vinculat correctament!' } }));
            onRefresh();
          } catch (err) {
            setConnectStatus((s) => ({ ...s, [bankAccountId]: { error: err.response?.data?.error || err.message } }));
          }
        },
        onExit: (err) => {
          if (err) {
            setConnectStatus((s) => ({ ...s, [bankAccountId]: { error: err.display_message || 'L\'usuari ha cancel·lat' } }));
          } else {
            setConnectStatus((s) => ({ ...s, [bankAccountId]: {} }));
          }
        },
        onEvent: (eventName) => {
          console.log('Plaid Link event:', eventName);
        },
      });

      handler.open();
    } catch (err) {
      setConnectStatus((s) => ({ ...s, [bankAccountId]: { error: err.response?.data?.error || err.message } }));
    }
  };

  const handleDisconnect = async (accId) => {
    if (!confirm('Desconnectar aquest compte de l\'API?')) return;
    try {
      await api.post(`/bank-accounts/${accId}/disconnect`);
      setConnectStatus((s) => ({ ...s, [accId]: { success: true, message: 'Desconnectat' } }));
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || 'Error');
    }
  };

  const checkConnection = async (accId) => {
    try {
      const { data } = await api.post(`/bank-accounts/${accId}/check-connection`);
      setConnectStatus((s) => ({ ...s, [accId]: { info: true, ...data } }));
    } catch (err) {
      setConnectStatus((s) => ({ ...s, [accId]: { error: err.response?.data?.error || err.message } }));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Gestionar comptes bancaris">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto">
        {/* Llistat */}
        <div className="space-y-2">
          {accounts.map((acc) => (
            <div key={acc.id} className="rounded-md border">
              <div className="flex items-center gap-3 p-3">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: acc.color }} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm flex items-center gap-2">
                    {acc.name}
                    {acc.isDefault && <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">Per defecte</span>}
                    {acc.syncType !== 'MANUAL' && acc.syncType !== 'CSV' && (
                      <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                        <Wifi size={8} /> {acc.syncType}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {acc.bankEntity || 'Manual'} · {acc._count?.movements || 0} moviments
                    {acc.iban && <span> · {acc.iban}</span>}
                    {acc.currentBalance != null && (
                      <span className="ml-2 font-medium text-foreground">Saldo: {formatCurrency(parseFloat(acc.currentBalance))}</span>
                    )}
                    {acc.lastSyncAt && (
                      <span className="ml-2">· Última sync: {getTimeAgo(acc.lastSyncAt)}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleEdit(acc)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted">Editar</button>
                  {!acc.isDefault && (
                    <button onClick={() => handleDelete(acc.id)} className="text-xs text-destructive hover:text-destructive/80 px-2 py-1 rounded hover:bg-destructive/10">Eliminar</button>
                  )}
                </div>
              </div>

              {/* Info API: link a Connexions + Vincular Plaid */}
              {(acc.syncType === 'QONTO' || acc.syncType === 'OPEN_BANKING') && (
                <div className="border-t p-2 bg-muted/20 text-xs text-muted-foreground space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Wifi size={10} />
                    <span>Credencials API configurades a</span>
                    <a href="/settings/connections" className="text-primary underline hover:text-primary/80">Connexions</a>
                  </div>
                  {acc.syncType === 'OPEN_BANKING' && (
                    <div className="flex items-center gap-2">
                      {acc.syncConfig?.plaidAccessToken ? (
                        <span className="text-green-600 flex items-center gap-1">
                          <CheckCircle2 size={12} /> Vinculat via Plaid
                        </span>
                      ) : (
                        <button
                          onClick={() => openPlaidLink(acc.id)}
                          disabled={connectStatus[acc.id]?.loading}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-600 text-white rounded text-xs font-medium hover:bg-teal-700 disabled:opacity-50"
                        >
                          {connectStatus[acc.id]?.loading ? (
                            <><RefreshCw size={10} className="animate-spin" /> {connectStatus[acc.id]?.message || 'Connectant...'}</>
                          ) : (
                            <><Link size={10} /> Vincular amb Plaid</>
                          )}
                        </button>
                      )}
                      {connectStatus[acc.id]?.error && (
                        <span className="text-destructive text-[10px]">{connectStatus[acc.id].error}</span>
                      )}
                      {connectStatus[acc.id]?.success && (
                        <span className="text-green-600 text-[10px]">{connectStatus[acc.id].message}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Formulari */}
        <form onSubmit={handleSave} className="border-t pt-4 space-y-3">
          <p className="text-sm font-medium">{editing ? 'Editar compte' : 'Nou compte bancari'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Nom *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sabadell Empresa" className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Entitat bancària</label>
              <input type="text" value={form.bankEntity} onChange={(e) => setForm({ ...form, bankEntity: e.target.value })} placeholder="Banc Sabadell" className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">IBAN</label>
              <input type="text" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="ES12 3456 7890 1234 5678 90" className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Tipus sync</label>
              <select value={form.syncType} onChange={(e) => setForm({ ...form, syncType: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="MANUAL">Manual</option>
                <option value="CSV">CSV</option>
                <option value="QONTO">Qonto (API directa)</option>
                <option value="OPEN_BANKING">Open Banking (Plaid)</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1">Color</label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${form.color === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {editing && <button type="button" onClick={() => { setEditing(null); setForm({ name: '', iban: '', bankEntity: '', syncType: 'MANUAL', color: '#2390A0' }); }} className="px-3 py-1.5 rounded border text-sm">Cancel·lar</button>}
            <button type="submit" disabled={saving} className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {saving ? 'Guardant...' : editing ? 'Actualitzar' : 'Crear compte'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

// ===========================================
// Import CSV Modal
// ===========================================
function ImportCsvModal({ isOpen, onClose, accounts, onSuccess }) {
  const [accountId, setAccountId] = useState('');
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!isOpen) { setCsvText(''); setPreview([]); setResult(null); setAccountId(''); }
  }, [isOpen]);

  const parseCsv = (text) => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    // Detectar separador
    const sep = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(sep).map(h => h.trim().replace(/"/g, '').toLowerCase());

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(sep).map(v => v.trim().replace(/"/g, ''));
      const row = {};
      headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });

      // Mapatge flexible de camps
      const date = row.date || row.fecha || row.data || row['fecha operación'] || row['fecha valor'] || '';
      const description = row.description || row.descripcion || row.concepto || row.concept || row.descripció || '';
      const amount = row.amount || row.importe || row.import || '';
      const balance = row.balance || row.saldo || '';
      const reference = row.reference || row.referencia || row.referència || '';
      const counterparty = row.counterparty || row.beneficiario || row.ordenante || '';

      if (date && (description || amount)) {
        rows.push({ date, description, amount, balance, reference, counterparty });
      }
    }
    return rows;
  };

  const handleParse = () => {
    const parsed = parseCsv(csvText);
    setPreview(parsed.slice(0, 10));
    setResult(null);
  };

  const handleImport = async () => {
    if (!accountId) { alert('Selecciona un compte bancari'); return; }
    const movements = parseCsv(csvText);
    if (!movements.length) { alert('No s\'han trobat moviments al CSV'); return; }

    setImporting(true);
    try {
      const { data } = await api.post(`/bank-accounts/${accountId}/import-csv`, { movements });
      setResult(data);
      onSuccess();
    } catch (err) {
      alert(err.response?.data?.error || 'Error important');
    }
    setImporting(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Importar moviments des de CSV">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Compte bancari *</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
            <option value="">Selecciona compte...</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Enganxa el CSV aquí</label>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={"date;description;amount;balance\n01/04/2026;Pagament factura;-150.00;1234.56"}
            rows={6}
            className="w-full rounded-md border bg-background px-3 py-2 text-xs font-mono"
          />
          <button onClick={handleParse} disabled={!csvText.trim()} className="mt-2 px-3 py-1.5 rounded border text-xs hover:bg-muted disabled:opacity-50">
            Previsualitzar
          </button>
        </div>

        {preview.length > 0 && (
          <div className="border rounded-md overflow-auto max-h-48">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="p-2 text-left">Data</th>
                  <th className="p-2 text-left">Descripció</th>
                  <th className="p-2 text-right">Import</th>
                  <th className="p-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{r.date}</td>
                    <td className="p-2 max-w-[200px] truncate">{r.description}</td>
                    <td className="p-2 text-right">{r.amount}</td>
                    <td className="p-2 text-right">{r.balance || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-2 text-xs text-muted-foreground border-t">
              Mostrant {preview.length} de {parseCsv(csvText).length} files
            </div>
          </div>
        )}

        {result && (
          <div className="bg-green-50 text-green-800 rounded-md p-3 text-sm">
            {result.message}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md border text-sm">Tancar</button>
          <button onClick={handleImport} disabled={importing || !csvText.trim() || !accountId}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {importing ? 'Important...' : 'Importar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ===========================================
// Pàgina principal
// ===========================================
export default function BankMovements() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [conciliatedFilter, setConciliatedFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [form, setForm] = useState({ date: '', description: '', amount: '', type: 'EXPENSE', reference: '', bankAccountId: '' });
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [notesOpen, setNotesOpen] = useState(null);
  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Comptes bancaris
  const [bankAccounts, setBankAccounts] = useState([]);
  const [accountSummary, setAccountSummary] = useState(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const { data } = await api.get('/bank-accounts');
      setBankAccounts(data);
    } catch {}
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await api.get('/bank-accounts/summary');
      setAccountSummary(data);
    } catch {}
  }, []);

  useEffect(() => { fetchAccounts(); fetchSummary(); }, [fetchAccounts, fetchSummary]);

  const { data, loading, refetch } = useApiGet('/bank', {
    search,
    type: typeFilter || undefined,
    conciliated: conciliatedFilter || undefined,
    bankAccountId: accountFilter || undefined,
    page,
    limit: 50,
  });
  const { mutate } = useApiMutation();

  // Carregar últim sync al muntar
  const fetchLastSync = useCallback(async () => {
    try {
      const { data: syncData } = await api.get('/bank/qonto/last-sync');
      setLastSync(syncData);
    } catch {}
  }, []);

  useEffect(() => {
    fetchLastSync();
  }, [fetchLastSync]);

  // Notes
  const openNotes = async (movementId) => {
    if (notesOpen === movementId) { setNotesOpen(null); return; }
    setNotesOpen(movementId);
    setLoadingNotes(true);
    try {
      const { data: notesData } = await api.get('/notes', { params: { entityType: 'bank_movement', entityId: movementId } });
      setNotes(notesData);
    } catch { setNotes([]); }
    setLoadingNotes(false);
  };

  const addNote = async (movementId) => {
    if (!newNote.trim()) return;
    try {
      const { data: note } = await api.post('/notes', { content: newNote.trim(), entityType: 'bank_movement', entityId: movementId });
      setNotes((prev) => [note, ...prev]);
      setNewNote('');
    } catch {}
  };

  const deleteNote = async (noteId) => {
    try {
      await api.delete(`/notes/${noteId}`);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch {}
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      // Sincronitzar tots els comptes amb sync automàtic
      const apiAccounts = bankAccounts.filter(a => a.syncType === 'QONTO' || a.syncType === 'OPEN_BANKING');
      const results = [];
      for (const acc of apiAccounts) {
        try {
          const { data: result } = await api.post(`/bank-accounts/${acc.id}/sync`);
          results.push({ ...result, accountName: acc.name });
        } catch (err) {
          results.push({ success: false, accountName: acc.name, error: err.response?.data?.error || err.message });
        }
      }
      // Si no hi ha comptes API, provar sync antic
      if (apiAccounts.length === 0) {
        try {
          const { data: result } = await api.post('/bank/qonto/sync');
          results.push(result);
        } catch (err) {
          results.push({ success: false, error: err.response?.data?.error || err.message });
        }
      }
      const totalCreated = results.reduce((s, r) => s + (r.created || 0), 0);
      const totalSkipped = results.reduce((s, r) => s + (r.skipped || 0), 0);
      const hasErrors = results.some(r => r.success === false);
      setLastSync({ success: !hasErrors, created: totalCreated, skipped: totalSkipped, timestamp: new Date().toISOString(), accounts: results });
      refetch();
      fetchSummary();
      fetchAccounts();
    } catch (err) {
      setLastSync({ success: false, error: err.response?.data?.error || err.message, timestamp: new Date().toISOString() });
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await mutate('post', '/bank', {
        ...form,
        date: new Date(form.date).toISOString(),
        amount: parseFloat(form.amount),
        bankAccountId: form.bankAccountId || undefined,
      });
      setShowModal(false);
      refetch();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Eliminar aquest moviment?')) return;
    await mutate('delete', `/bank/${id}`);
    refetch();
  };

  // Mostrar sync si hi ha algun compte amb API
  const hasApiAccounts = bankAccounts.some(a => a.syncType === 'QONTO' || a.syncType === 'OPEN_BANKING');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Moviments bancaris</h2>
        <div className="flex items-center gap-2">
          {hasApiAccounts && <SyncStatus lastSync={lastSync} onSync={handleSync} syncing={syncing} />}
          <ExportButtons
            endpoint="/export/bank-movements"
            filters={{ search: search || undefined, type: typeFilter || undefined, conciliated: conciliatedFilter || undefined, bankAccountId: accountFilter || undefined }}
            filenameBase="moviments-bancaris"
          />
          <button onClick={() => setShowImportModal(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm hover:bg-muted" title="Importar CSV">
            <Upload size={14} /> CSV
          </button>
          <button onClick={() => setShowAccountsModal(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm hover:bg-muted" title="Gestionar comptes">
            <Settings size={14} /> Comptes
          </button>
          <button onClick={() => { setForm({ date: '', description: '', amount: '', type: 'EXPENSE', reference: '', bankAccountId: '' }); setShowModal(true); }} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
            <Plus size={16} /> Nou moviment
          </button>
        </div>
      </div>

      {/* Resum comptes */}
      {accountSummary && (
        <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: `repeat(${Math.min(accountSummary.accounts.length + (accountSummary.accounts.length > 1 ? 1 : 0), 4)}, 1fr)` }}>
          {accountSummary.accounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => { setAccountFilter(accountFilter === acc.id ? '' : acc.id); setPage(1); }}
              className={`bg-card border rounded-lg p-4 text-left transition-all hover:shadow-sm ${accountFilter === acc.id ? 'ring-2 ring-primary' : ''}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: acc.color }} />
                <span className="text-sm font-medium truncate">{acc.name}</span>
                {acc.syncType !== 'MANUAL' && (
                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded ml-auto">{acc.syncType}</span>
                )}
              </div>
              {acc.currentBalance != null && (
                <div className="text-lg font-bold mb-1">{formatCurrency(parseFloat(acc.currentBalance))}</div>
              )}
              {acc.syncConfig?.subAccounts && acc.syncConfig.subAccounts.length > 1 && (
                <div className="mb-2 space-y-0.5">
                  {acc.syncConfig.subAccounts.map((sub) => (
                    <div key={sub.slug} className="flex justify-between text-[11px] text-muted-foreground">
                      <span>{sub.name}</span>
                      <span className="font-medium">{formatCurrency(sub.balance)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-xs text-muted-foreground mb-1">Últims 30 dies</div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-600 font-medium">+{formatCurrency(acc.incomeMonth)}</span>
                <span className="text-red-600 font-medium">-{formatCurrency(acc.expenseMonth)}</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-2">
                {acc.movementCount} moviments totals
                {acc.lastSyncAt && <span> · Sync {getTimeAgo(acc.lastSyncAt)}</span>}
              </div>
            </button>
          ))}
          {accountSummary.accounts.length > 1 && (
            <button
              onClick={() => { setAccountFilter(''); setPage(1); }}
              className={`bg-card border rounded-lg p-4 text-left transition-all hover:shadow-sm ${!accountFilter ? 'ring-2 ring-primary' : ''}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Building2 size={14} className="text-muted-foreground" />
                <span className="text-sm font-medium">Total</span>
              </div>
              <div className="text-xs text-muted-foreground mb-1">Últims 30 dies</div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-600 font-medium">+{formatCurrency(accountSummary.totals.incomeMonth)}</span>
                <span className="text-red-600 font-medium">-{formatCurrency(accountSummary.totals.expenseMonth)}</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-2">
                {accountSummary.totals.movementCount} moviments totals
              </div>
            </button>
          )}
        </div>
      )}

      {/* Filtres */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Cercar per descripció o referència..." className="w-full pl-10 pr-4 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        {bankAccounts.length > 1 && (
          <select value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setPage(1); }} className="rounded-md border bg-background px-3 py-2 text-sm">
            <option value="">Tots els comptes</option>
            {bankAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Tots els tipus</option>
          <option value="INCOME">Ingressos</option>
          <option value="EXPENSE">Despeses</option>
          <option value="TRANSFER">Transferències</option>
        </select>
        <select value={conciliatedFilter} onChange={(e) => { setConciliatedFilter(e.target.value); setPage(1); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Tots</option>
          <option value="false">Sense conciliar</option>
          <option value="true">Conciliats</option>
        </select>
      </div>

      {/* Badges comptes actius */}
      {bankAccounts.length > 1 && (
        <div className="flex gap-2 mb-3">
          {bankAccounts.map(a => (
            <button
              key={a.id}
              onClick={() => { setAccountFilter(accountFilter === a.id ? '' : a.id); setPage(1); }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border transition-colors ${accountFilter === a.id ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted'}`}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: a.color }} />
              {a.name}
              <span className="text-[10px] opacity-60">{a._count?.movements || 0}</span>
            </button>
          ))}
        </div>
      )}

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Data</th>
              {bankAccounts.length > 1 && <th className="text-left p-3 font-medium">Compte</th>}
              <th className="text-left p-3 font-medium">Descripció</th>
              <th className="text-left p-3 font-medium">Referència</th>
              <th className="text-right p-3 font-medium">Import</th>
              <th className="text-center p-3 font-medium">Conciliat</th>
              <th className="text-center p-3 font-medium">Notes</th>
              <th className="text-right p-3 font-medium">Accions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={bankAccounts.length > 1 ? 8 : 7} className="p-8 text-center text-muted-foreground">Carregant...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={bankAccounts.length > 1 ? 8 : 7} className="p-8 text-center text-muted-foreground">Cap moviment trobat</td></tr>
            ) : (
              data?.data?.map((m) => (
                <React.Fragment key={m.id}>
                <tr className="border-t hover:bg-muted/30">
                  <td className="p-3 text-muted-foreground">{formatDate(m.date)}</td>
                  {bankAccounts.length > 1 && (
                    <td className="p-3">
                      {m.bankAccountRef ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.bankAccountRef.color }} />
                          {m.bankAccountRef.name}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  <td className="p-3">
                    <div>{m.description}</div>
                    {m.counterparty && m.counterparty !== m.description && (
                      <div className="text-xs text-muted-foreground">{m.counterparty}</div>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground text-xs">{m.reference || '—'}</td>
                  <td className={`p-3 text-right font-medium ${parseFloat(m.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    <span className="inline-flex items-center gap-1">
                      {parseFloat(m.amount) >= 0 ? <ArrowUpCircle size={14} /> : <ArrowDownCircle size={14} />}
                      {formatCurrency(Math.abs(parseFloat(m.amount)))}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${m.isConciliated ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {m.isConciliated ? 'Sí' : 'No'}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <button
                      onClick={() => openNotes(m.id)}
                      className={`p-1.5 rounded hover:bg-muted ${notesOpen === m.id ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
                      title="Notes"
                    >
                      <MessageSquare size={14} />
                    </button>
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleDelete(m.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive"><Trash2 size={14} /></button>
                  </td>
                </tr>
                {notesOpen === m.id && (
                  <tr className="bg-muted/20">
                    <td colSpan={bankAccounts.length > 1 ? 8 : 7} className="p-3">
                      <div className="max-w-2xl">
                        <div className="flex items-center gap-2 mb-2">
                          <input
                            type="text"
                            value={newNote}
                            onChange={(e) => setNewNote(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addNote(m.id)}
                            placeholder="Afegir nota..."
                            className="flex-1 px-3 py-1.5 border rounded text-sm bg-background"
                          />
                          <button onClick={() => addNote(m.id)} disabled={!newNote.trim()} className="p-1.5 rounded bg-primary text-primary-foreground disabled:opacity-50"><Send size={14} /></button>
                        </div>
                        {loadingNotes ? (
                          <p className="text-xs text-muted-foreground">Carregant...</p>
                        ) : notes.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Cap nota encara</p>
                        ) : (
                          <div className="space-y-1.5">
                            {notes.map((n) => (
                              <div key={n.id} className="flex items-start gap-2 text-xs bg-background rounded p-2 border">
                                <div className="flex-1">
                                  <span className="font-medium">{n.author?.name || 'Usuari'}</span>
                                  <span className="text-muted-foreground ml-2">{formatDate(n.createdAt)}</span>
                                  <p className="mt-0.5">{n.content}</p>
                                </div>
                                <button onClick={() => deleteNote(n.id)} className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"><X size={12} /></button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
              ))
            )}
          </tbody>
        </table>

        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t text-sm">
            <span className="text-muted-foreground">{data.pagination.total} moviments</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1 rounded border disabled:opacity-50">Anterior</button>
              <span className="px-3 py-1">{page} / {data.pagination.totalPages}</span>
              <button onClick={() => setPage(Math.min(data.pagination.totalPages, page + 1))} disabled={page >= data.pagination.totalPages} className="px-3 py-1 rounded border disabled:opacity-50">Següent</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal nou moviment */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Nou moviment bancari">
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Data *</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tipus *</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="EXPENSE">Despesa</option>
                <option value="INCOME">Ingrés</option>
                <option value="TRANSFER">Transferència</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Compte bancari</label>
              <select value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">Selecciona compte...</option>
                {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Descripció *</label>
              <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Import *</label>
              <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Referència</label>
              <input type="text" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md border text-sm">Cancel·lar</button>
            <button type="submit" className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium">Guardar</button>
          </div>
        </form>
      </Modal>

      {/* Modal gestió comptes */}
      <BankAccountsModal
        isOpen={showAccountsModal}
        onClose={() => setShowAccountsModal(false)}
        accounts={bankAccounts}
        onRefresh={fetchAccounts}
      />

      {/* Modal importar CSV */}
      <ImportCsvModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        accounts={bankAccounts}
        onSuccess={() => { refetch(); fetchAccounts(); fetchSummary(); }}
      />
    </div>
  );
}
