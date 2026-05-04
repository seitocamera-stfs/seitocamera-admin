import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, RotateCcw, AlertTriangle, Send } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

const STATUS_LABELS = {
  ACTIVE: { label: 'Actiu', className: 'bg-green-100 text-green-700' },
  FULLY_AMORTIZED: { label: 'Amortitzat', className: 'bg-gray-200 text-gray-700' },
  DISPOSED: { label: 'Donat de baixa', className: 'bg-rose-100 text-rose-700' },
};

const MONTHS = ['Gen', 'Feb', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Des'];

export default function FixedAssetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: fa, loading, refetch } = useApiGet(`/fixed-assets/${id}`);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  if (loading || !fa) return <div className="p-6">Carregant...</div>;
  const st = STATUS_LABELS[fa.status] || STATUS_LABELS.ACTIVE;

  const handlePostEntry = async (entryId) => {
    setBusy(entryId); setError(null);
    try { await api.post(`/fixed-assets/amortizations/${entryId}/post`); refetch(); }
    catch (err) { setError(err.response?.data?.error || 'Error'); }
    finally { setBusy(null); }
  };
  const handleUnpostEntry = async (entryId) => {
    if (!confirm('Anul·lar aquesta amortització?')) return;
    setBusy(entryId); setError(null);
    try { await api.post(`/fixed-assets/amortizations/${entryId}/unpost`); refetch(); }
    catch (err) { setError(err.response?.data?.error || 'Error'); }
    finally { setBusy(null); }
  };
  const handleDispose = async () => {
    const notes = prompt('Notes de la baixa (opcional):') ?? '';
    if (!confirm('Donar de baixa aquest immobilitzat? L\'amortització pendent quedarà sense aplicar.')) return;
    setBusy('dispose'); setError(null);
    try { await api.post(`/fixed-assets/${id}/dispose`, { notes }); refetch(); }
    catch (err) { setError(err.response?.data?.error || 'Error'); }
    finally { setBusy(null); }
  };

  const totals = fa.amortizationEntries.reduce((acc, e) => {
    acc.amount += Number(e.amount);
    if (e.status === 'POSTED') acc.posted += Number(e.amount);
    return acc;
  }, { amount: 0, posted: 0 });
  const netValue = Math.round((Number(fa.acquisitionValue) - totals.posted) * 100) / 100;

  return (
    <div className="p-6 max-w-6xl">
      <button onClick={() => navigate('/fixed-assets')} className="text-sm text-muted-foreground inline-flex items-center gap-1 mb-4 hover:underline">
        <ArrowLeft size={14} /> Tornar a immobilitzat
      </button>

      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">{fa.code} · {fa.name}</h1>
          {fa.description && <p className="text-muted-foreground text-sm mt-1">{fa.description}</p>}
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <span className={`px-2 py-0.5 rounded-full ${st.className}`}>{st.label}</span>
            <span>·</span>
            <span>Compte {fa.account.code} ({fa.account.name})</span>
            {fa.equipment && <><span>·</span><span>Equipament: {fa.equipment.name}</span></>}
            {fa.receivedInvoice && <><span>·</span><Link to="/invoices/received" className="hover:underline">Factura {fa.receivedInvoice.invoiceNumber}</Link></>}
          </div>
        </div>
        <div className="flex gap-2">
          {fa.status !== 'DISPOSED' && (
            <button onClick={handleDispose} disabled={busy === 'dispose'}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50">
              <AlertTriangle size={14} /> Donar de baixa
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded p-3">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Adquisició" value={`${Number(fa.acquisitionValue).toFixed(2)} €`} sub={new Date(fa.acquisitionDate).toLocaleDateString('ca-ES')} />
        <Stat label="Acumulada" value={`${totals.posted.toFixed(2)} €`} sub={`${fa.amortizationEntries.filter(e => e.status === 'POSTED').length}/${fa.amortizationEntries.length} mesos`} />
        <Stat label="Valor net" value={`${netValue.toFixed(2)} €`} highlight />
        <Stat label="Quota mensual" value={`${Number(fa.monthlyAmortization).toFixed(2)} €`} sub={`Vida útil ${Number(fa.usefulLifeYears).toFixed(2)} anys`} />
      </div>

      <h2 className="text-sm font-semibold mb-2 mt-6">Calendari d'amortitzacions</h2>
      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Període</th>
              <th className="text-right px-3 py-2">Quota</th>
              <th className="text-right px-3 py-2">Acumulat</th>
              <th className="text-right px-3 py-2">Valor net</th>
              <th className="text-center px-3 py-2">Estat</th>
              <th className="text-right px-3 py-2">Acció</th>
            </tr>
          </thead>
          <tbody>
            {fa.amortizationEntries.map((e) => (
              <tr key={e.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-1.5">{MONTHS[e.month - 1]} {e.year}</td>
                <td className="px-3 py-1.5 text-right font-mono">{Number(e.amount).toFixed(2)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{Number(e.accumulated).toFixed(2)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{Number(e.netValue).toFixed(2)}</td>
                <td className="px-3 py-1.5 text-center">
                  {e.status === 'POSTED' ? (
                    <Link to={`/journal/${e.journalEntry?.id}`} className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                      Comp. #{e.journalEntry?.entryNumber}
                    </Link>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">Pendent</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {e.status === 'PENDING' ? (
                    <button onClick={() => handlePostEntry(e.id)} disabled={busy === e.id} className="p-1 rounded hover:bg-indigo-50 text-indigo-700 disabled:opacity-50" title="Comptabilitzar">
                      <Send size={13} className={busy === e.id ? 'animate-pulse' : ''} />
                    </button>
                  ) : (
                    <button onClick={() => handleUnpostEntry(e.id)} disabled={busy === e.id} className="p-1 rounded hover:bg-amber-50 text-amber-700 disabled:opacity-50" title="Anul·lar">
                      <RotateCcw size={13} className={busy === e.id ? 'animate-spin' : ''} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, highlight }) {
  return (
    <div className={`p-4 rounded-lg border ${highlight ? 'bg-primary/5 border-primary/20' : 'bg-card'}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${highlight ? 'text-primary' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
