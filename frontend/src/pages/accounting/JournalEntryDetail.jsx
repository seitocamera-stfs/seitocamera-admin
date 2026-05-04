import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { CheckCircle, RotateCcw, Edit2, Trash2, ArrowLeft } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';
import { formatDate } from '../../lib/utils';

const STATUS_LABELS = {
  DRAFT: { label: 'Esborrany', className: 'bg-gray-100 text-gray-700' },
  POSTED: { label: 'Comptabilitzat', className: 'bg-green-100 text-green-700' },
  REVERSED: { label: 'Anul·lat', className: 'bg-rose-100 text-rose-700' },
};

export default function JournalEntryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: entry, refetch, loading } = useApiGet(`/journal/${id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (loading || !entry) return <div className="p-6">Carregant...</div>;

  const totals = entry.lines.reduce(
    (a, l) => ({ d: a.d + Number(l.debit), c: a.c + Number(l.credit) }),
    { d: 0, c: 0 },
  );
  const st = STATUS_LABELS[entry.status] || STATUS_LABELS.DRAFT;

  const onPost = async () => {
    if (!confirm('Comptabilitzar aquest assentament? Després ja no es podrà editar (només anul·lar).')) return;
    setBusy(true); setError(null);
    try { await api.patch(`/journal/${id}/post`); refetch(); }
    catch (err) { setError(err.response?.data?.error || 'Error'); }
    finally { setBusy(false); }
  };
  const onReverse = async () => {
    const reason = prompt('Motiu de l\'anul·lació (opcional):') ?? null;
    if (reason === null && !confirm('Anul·lar aquest assentament generant-ne un d\'inversió?')) return;
    setBusy(true); setError(null);
    try { await api.patch(`/journal/${id}/reverse`, { reason }); refetch(); }
    catch (err) { setError(err.response?.data?.error || 'Error'); }
    finally { setBusy(false); }
  };
  const onDelete = async () => {
    if (!confirm('Eliminar aquest esborrany? Aquesta acció no es pot desfer.')) return;
    setBusy(true); setError(null);
    try { await api.delete(`/journal/${id}`); navigate('/journal'); }
    catch (err) { setError(err.response?.data?.error || 'Error'); setBusy(false); }
  };

  return (
    <div className="p-6 max-w-5xl">
      <button onClick={() => navigate('/journal')} className="text-sm text-muted-foreground inline-flex items-center gap-1 mb-4 hover:underline">
        <ArrowLeft size={14} /> Tornar al llibre diari
      </button>

      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">Assentament #{entry.entryNumber} <span className="text-muted-foreground font-normal text-sm">· {formatDate(entry.date)}</span></h1>
          <p className="text-muted-foreground mt-1">{entry.description}</p>
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <span className={`px-2 py-0.5 rounded-full ${st.className}`}>{st.label}</span>
            <span>·</span>
            <span>Exercici {entry.fiscalYear?.year}</span>
            <span>·</span>
            <span>Tipus: {entry.type}</span>
            <span>·</span>
            <span>Origen: {entry.source}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {entry.status === 'DRAFT' && (
            <>
              <button onClick={() => navigate(`/journal/${id}/edit`)} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border hover:bg-muted disabled:opacity-50">
                <Edit2 size={14} /> Editar
              </button>
              <button onClick={onDelete} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                <Trash2 size={14} /> Eliminar
              </button>
              <button onClick={onPost} disabled={busy}
                className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">
                <CheckCircle size={14} /> Comptabilitzar
              </button>
            </>
          )}
          {entry.status === 'POSTED' && (
            <button onClick={onReverse} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-50">
              <RotateCcw size={14} /> Anul·lar
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded p-3">{error}</div>}

      {entry.reverses && (
        <div className="mb-4 text-sm bg-amber-50 border border-amber-200 rounded p-3">
          Aquest assentament és l'<b>inversió</b> de <Link to={`/journal/${entry.reverses.id}`} className="underline">#{entry.reverses.entryNumber}</Link>.
        </div>
      )}
      {entry.reversedBy && (
        <div className="mb-4 text-sm bg-amber-50 border border-amber-200 rounded p-3">
          Aquest assentament <b>està anul·lat</b> per <Link to={`/journal/${entry.reversedBy.id}`} className="underline">#{entry.reversedBy.entryNumber}</Link>.
        </div>
      )}

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 w-32">Compte</th>
              <th className="text-left px-3 py-2">Concepte de la línia</th>
              <th className="text-right px-3 py-2 w-32">Deure</th>
              <th className="text-right px-3 py-2 w-32">Haver</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{l.account?.code} <span className="text-muted-foreground">{l.account?.name}</span></td>
                <td className="px-3 py-2">{l.description}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(l.debit) ? Number(l.debit).toFixed(2) : ''}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(l.credit) ? Number(l.credit).toFixed(2) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold">
              <td colSpan={2} className="px-3 py-2 text-right">Total</td>
              <td className="px-3 py-2 text-right font-mono">{totals.d.toFixed(2)}</td>
              <td className="px-3 py-2 text-right font-mono">{totals.c.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4 text-xs text-muted-foreground">
        Creat per {entry.createdBy?.name || '—'} el {formatDate(entry.createdAt)}
        {entry.postedBy && <> · Comptabilitzat per {entry.postedBy.name} el {formatDate(entry.postedAt)}</>}
      </div>
    </div>
  );
}
