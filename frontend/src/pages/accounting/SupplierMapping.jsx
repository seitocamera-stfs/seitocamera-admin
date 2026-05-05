import { useState, useMemo, useEffect } from 'react';
import { Truck, Search, Wand2, AlertCircle, Check, X, ArrowRight } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

const fmtEUR = (n) => Number(n || 0).toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' });

export default function SupplierMapping() {
  const { data: company } = useApiGet('/companies');
  const { data: suppliers, loading, refetch } = useApiGet('/supplier-mapping');
  const { data: accounts } = useApiGet(
    company ? '/chart-of-accounts' : null,
    company ? { companyId: company.id, leafOnly: 'true' } : {},
  );

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL'); // ALL | MISSING | SET
  const [editing, setEditing] = useState(null); // supplier id being edited
  const [newAccountId, setNewAccountId] = useState('');
  const [accSearch, setAccSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [reclassifyAfterSave, setReclassifyAfterSave] = useState(true);
  const [autoFillRunning, setAutoFillRunning] = useState(false);

  // Només comptes de despesa (6xx) i alguns útils
  const expenseAccounts = useMemo(() => {
    if (!accounts) return [];
    return accounts.filter((a) => a.code?.startsWith('6') || a.code?.startsWith('21') || a.code?.startsWith('22'));
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    if (!accSearch) return expenseAccounts.slice(0, 50);
    const s = accSearch.toLowerCase();
    return expenseAccounts.filter((a) => a.code.includes(s) || a.name.toLowerCase().includes(s)).slice(0, 50);
  }, [expenseAccounts, accSearch]);

  const filteredSuppliers = useMemo(() => {
    if (!suppliers) return [];
    let list = suppliers;
    if (filter === 'MISSING') list = list.filter((s) => !s.defaultAccount);
    if (filter === 'SET') list = list.filter((s) => s.defaultAccount);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((x) => x.name.toLowerCase().includes(s) || (x.nif || '').toLowerCase().includes(s));
    }
    return list;
  }, [suppliers, search, filter]);

  const stats = useMemo(() => {
    if (!suppliers) return { total: 0, set: 0, missing: 0 };
    const set = suppliers.filter((s) => s.defaultAccount).length;
    return { total: suppliers.length, set, missing: suppliers.length - set };
  }, [suppliers]);

  const startEdit = (s) => {
    setEditing(s.id);
    setNewAccountId(s.defaultAccount?.id || s.topAccount?.accountId || '');
    setAccSearch('');
    setReclassifyAfterSave(false);
  };

  const cancelEdit = () => {
    setEditing(null);
    setNewAccountId('');
    setAccSearch('');
  };

  const saveEdit = async (supplier) => {
    if (busy) return;
    setBusy(true);
    try {
      // 1) Fixar default
      await api.patch(`/supplier-mapping/${supplier.id}`, { accountId: newAccountId || null });

      // 2) Si hi ha canvi i checkbox marcat → crear suggeriments per factures existents
      if (newAccountId && reclassifyAfterSave) {
        const r = await api.post(`/supplier-mapping/${supplier.id}/suggest-reclassify`, { accountId: newAccountId });
        if (r.data.created > 0) {
          alert(`Default fixat. ${r.data.created} suggeriments creats al supervisor IA per revisar.`);
        } else {
          alert('Default fixat. Cap factura existent necessita reclassificar.');
        }
      }
      cancelEdit();
      refetch();
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setBusy(false);
    }
  };

  const removeDefault = async (supplier) => {
    if (!confirm(`Treure el compte default de "${supplier.name}"?`)) return;
    try {
      await api.patch(`/supplier-mapping/${supplier.id}`, { accountId: null });
      refetch();
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    }
  };

  const runAutoFill = async () => {
    if (!confirm('Auto-omplir el default de tots els proveïdors SENSE default usant el compte més utilitzat històricament. Procedir?')) return;
    setAutoFillRunning(true);
    try {
      const r = await api.post('/supplier-mapping/auto-fill');
      alert(`Auto-fill: ${r.data.updated} proveïdors actualitzats de ${r.data.totalCandidates} candidats.`);
      refetch();
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setAutoFillRunning(false);
    }
  };

  if (loading || !suppliers) return <div className="p-6">Carregant...</div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Truck size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Mapatge proveïdor → compte</h1>
        </div>
        <button
          onClick={runAutoFill}
          disabled={autoFillRunning}
          className="px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-2 disabled:opacity-50"
        >
          <Wand2 size={16} />
          {autoFillRunning ? 'Omplint...' : 'Auto-omplir des d\'historial'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="border rounded-lg p-3 bg-card">
          <div className="text-xs text-muted-foreground">Total proveïdors</div>
          <div className="text-2xl font-semibold">{stats.total}</div>
        </div>
        <div className="border rounded-lg p-3 bg-green-50 border-green-200">
          <div className="text-xs text-green-700">Amb default assignat</div>
          <div className="text-2xl font-semibold text-green-700">{stats.set}</div>
        </div>
        <div className="border rounded-lg p-3 bg-amber-50 border-amber-200">
          <div className="text-xs text-amber-700">Sense default</div>
          <div className="text-2xl font-semibold text-amber-700">{stats.missing}</div>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca proveïdor o NIF..."
            className="w-full pl-9 pr-3 py-2 border rounded-md text-sm"
          />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="px-3 py-2 border rounded-md text-sm">
          <option value="ALL">Tots</option>
          <option value="MISSING">Sense default</option>
          <option value="SET">Amb default</option>
        </select>
      </div>

      {/* Taula */}
      <div className="border rounded-lg overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Proveïdor</th>
              <th className="px-3 py-2 text-right font-medium">Factures</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-left font-medium">Comptes utilitzats (top 3)</th>
              <th className="px-3 py-2 text-left font-medium">Default actual</th>
              <th className="px-3 py-2 text-right font-medium">Acció</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filteredSuppliers.map((s) => (
              <tr key={s.id} className={editing === s.id ? 'bg-blue-50' : 'hover:bg-muted/30'}>
                <td className="px-3 py-2">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.nif || '—'}</div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.invoiceCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtEUR(s.totalAmount)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-0.5 text-xs">
                    {s.usage.slice(0, 3).map((u) => (
                      <div key={u.accountId} className="flex items-center gap-1">
                        <span className="font-mono text-muted-foreground">{u.code}</span>
                        <span className="truncate max-w-[180px]">{u.name}</span>
                        <span className="text-muted-foreground">({u.count})</span>
                      </div>
                    ))}
                    {s.usage.length === 0 && <span className="text-muted-foreground italic">Sense historial</span>}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {editing === s.id ? (
                    <div className="flex flex-col gap-1">
                      <input
                        value={accSearch}
                        onChange={(e) => setAccSearch(e.target.value)}
                        placeholder="Cerca compte..."
                        className="px-2 py-1 border rounded text-xs"
                      />
                      <select
                        value={newAccountId}
                        onChange={(e) => setNewAccountId(e.target.value)}
                        size={6}
                        className="border rounded text-xs font-mono"
                      >
                        <option value="">— sense default —</option>
                        {filteredAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={reclassifyAfterSave}
                          onChange={(e) => setReclassifyAfterSave(e.target.checked)}
                        />
                        Crear suggeriments per factures existents amb compte diferent
                      </label>
                    </div>
                  ) : s.defaultAccount ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded">{s.defaultAccount.code}</span>
                      <span className="text-xs">{s.defaultAccount.name}</span>
                    </div>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-amber-700">
                      <AlertCircle size={12} />
                      Sense default
                      {s.topAccount && (
                        <>
                          <ArrowRight size={10} />
                          <span className="font-mono">{s.topAccount.code}</span> més usat
                        </>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {editing === s.id ? (
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => saveEdit(s)}
                        disabled={busy}
                        className="px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                        title="Desar"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={busy}
                        className="px-2 py-1 rounded border hover:bg-muted disabled:opacity-50"
                        title="Cancel·lar"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => startEdit(s)}
                        className="px-2 py-1 rounded border text-xs hover:bg-muted"
                      >
                        Editar
                      </button>
                      {s.defaultAccount && (
                        <button
                          onClick={() => removeDefault(s)}
                          className="px-2 py-1 rounded border text-xs hover:bg-rose-50 hover:text-rose-700"
                          title="Treure default"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filteredSuppliers.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Cap proveïdor</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        Quan un proveïdor té un compte per defecte assignat, les factures noves es comptabilitzen directament en aquest compte
        sense passar per l'agent IA. Per factures ja comptabilitzades, marca la casella per crear suggeriments al supervisor IA.
      </p>
    </div>
  );
}
