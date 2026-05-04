import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Plus, Search } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

const STATUS_LABELS = {
  ACTIVE: { label: 'Actiu', className: 'bg-green-100 text-green-700' },
  FULLY_AMORTIZED: { label: 'Amortitzat', className: 'bg-gray-200 text-gray-700' },
  DISPOSED: { label: 'Donat de baixa', className: 'bg-rose-100 text-rose-700' },
};

export default function FixedAssets() {
  const navigate = useNavigate();
  const { data: company } = useApiGet('/companies');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const params = { ...(company && { companyId: company.id }), ...(status && { status }), ...(search && { search }) };
  const { data, loading, refetch } = useApiGet(company ? '/fixed-assets' : null, params);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Package size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Immobilitzat</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90"
        >
          <Plus size={16} /> Nou actiu
        </button>
      </div>

      <div className="bg-card border rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-muted-foreground">Cerca</span>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" />
            <input className="input-field pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Codi o nom..." />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Estat</span>
          <select className="input-field" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tots</option>
            <option value="ACTIVE">Actius</option>
            <option value="FULLY_AMORTIZED">Totalment amortitzats</option>
            <option value="DISPOSED">Donats de baixa</option>
          </select>
        </label>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Carregant...</div>}

      {data && (
        <div className="bg-card border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Codi</th>
                <th className="text-left px-3 py-2">Nom</th>
                <th className="text-left px-3 py-2">Compte</th>
                <th className="text-right px-3 py-2">Adq.</th>
                <th className="text-right px-3 py-2">Valor adq.</th>
                <th className="text-right px-3 py-2">Acumulada</th>
                <th className="text-right px-3 py-2">Valor net</th>
                <th className="text-right px-3 py-2">Quotes</th>
                <th className="text-center px-3 py-2">Estat</th>
              </tr>
            </thead>
            <tbody>
              {data.map((fa) => {
                const st = STATUS_LABELS[fa.status] || STATUS_LABELS.ACTIVE;
                return (
                  <tr key={fa.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/fixed-assets/${fa.id}`)}>
                    <td className="px-3 py-2 font-mono text-xs">{fa.code}</td>
                    <td className="px-3 py-2">{fa.name}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fa.account?.code} · {fa.account?.name}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground text-xs">{new Date(fa.acquisitionDate).toLocaleDateString('ca-ES')}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(fa.acquisitionValue).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fa.accumulatedAmort.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono font-medium">{fa.netValue.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">{fa.monthsPosted}/{fa.monthsTotal}</td>
                    <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${st.className}`}>{st.label}</span></td>
                  </tr>
                );
              })}
              {data.length === 0 && <tr><td colSpan={9} className="text-center text-muted-foreground py-6">Cap immobilitzat registrat encara.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateFixedAssetModal companyId={company?.id} onClose={() => setShowCreate(false)} onCreated={(fa) => { setShowCreate(false); refetch(); navigate(`/fixed-assets/${fa.id}`); }} />
      )}
    </div>
  );
}

function CreateFixedAssetModal({ companyId, onClose, onCreated }) {
  const { data: accounts } = useApiGet(companyId ? '/chart-of-accounts' : null, companyId ? { companyId, leafOnly: 'true', type: 'ASSET' } : {});
  const [form, setForm] = useState({
    name: '', accountId: '', acquisitionDate: new Date().toISOString().slice(0, 10),
    acquisitionValue: '', residualValue: 0, usefulLifeYears: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Filtrar a comptes 21x (immobilitzat material)
  const fixedAssetAccounts = (accounts || []).filter((a) => /^21[3-9]/.test(a.code));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const payload = {
        companyId,
        name: form.name,
        accountId: form.accountId,
        acquisitionDate: form.acquisitionDate,
        acquisitionValue: parseFloat(form.acquisitionValue),
        residualValue: parseFloat(form.residualValue) || 0,
        usefulLifeYears: form.usefulLifeYears ? parseFloat(form.usefulLifeYears) : undefined,
      };
      const { data } = await api.post('/fixed-assets', payload);
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md space-y-3">
        <h2 className="text-lg font-semibold">Nou immobilitzat</h2>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Nom</span>
          <input className="input-field" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Compte (subgrup 21x)</span>
          <select className="input-field" required value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
            <option value="">— Selecciona —</option>
            {fixedAssetAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Data adquisició</span>
            <input className="input-field" required type="date" value={form.acquisitionDate} onChange={(e) => setForm({ ...form, acquisitionDate: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Valor adquisició (€)</span>
            <input className="input-field" required type="number" step="0.01" value={form.acquisitionValue} onChange={(e) => setForm({ ...form, acquisitionValue: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Valor residual (€)</span>
            <input className="input-field" type="number" step="0.01" value={form.residualValue} onChange={(e) => setForm({ ...form, residualValue: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Vida útil (anys)</span>
            <input className="input-field" type="number" step="0.1" placeholder="Per defecte segons compte" value={form.usefulLifeYears} onChange={(e) => setForm({ ...form, usefulLifeYears: e.target.value })} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm border">Cancel·lar</button>
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-md text-sm bg-primary text-primary-foreground disabled:opacity-50">
            {busy ? 'Creant...' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}
