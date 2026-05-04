import { useState } from 'react';
import { Calendar, Lock, Unlock, Plus } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';
import { formatDate } from '../../lib/utils';

const STATUS_LABELS = {
  OPEN: { label: 'Obert', className: 'bg-green-100 text-green-700' },
  CLOSING: { label: 'En tancament', className: 'bg-amber-100 text-amber-700' },
  CLOSED: { label: 'Tancat', className: 'bg-gray-200 text-gray-700' },
};

export default function FiscalYears() {
  const { data: company } = useApiGet('/companies');
  const { data: years, loading, refetch } = useApiGet(
    company ? '/fiscal-years' : null,
    company ? { companyId: company.id } : {},
  );
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const handleCreate = async () => {
    if (!company) return;
    const year = parseInt(prompt('Any del nou exercici (ex: 2027)'), 10);
    if (!year || year < 2000 || year > 2100) return;
    setCreating(true);
    setError(null);
    try {
      await api.post('/fiscal-years', { companyId: company.id, year });
      refetch();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear');
    } finally {
      setCreating(false);
    }
  };

  const handleLock = async (id, locked) => {
    if (!confirm(locked ? 'Desbloquejar exercici?' : 'Bloquejar definitivament l\'exercici? Després no es podran editar assentaments d\'aquest any sense desbloqueig explícit.')) return;
    setBusy(id);
    setError(null);
    try {
      await api.patch(`/fiscal-years/${id}/${locked ? 'unlock' : 'lock'}`);
      refetch();
    } catch (err) {
      setError(err.response?.data?.error || 'Error');
    } finally {
      setBusy(null);
    }
  };

  if (loading || !years) return <div className="p-6">Carregant...</div>;

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Calendar size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Exercicis comptables</h1>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating || !company}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Plus size={16} />
          Nou exercici
        </button>
      </div>

      {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Any</th>
              <th className="text-left px-4 py-3">Període</th>
              <th className="text-left px-4 py-3">Estat</th>
              <th className="text-left px-4 py-3">Bloquejat per</th>
              <th className="text-right px-4 py-3">Accions</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const st = STATUS_LABELS[y.status] || STATUS_LABELS.OPEN;
              return (
                <tr key={y.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{y.year}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(y.startDate)} → {formatDate(y.endDate)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.className}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {y.locked && y.lockedBy ? `${y.lockedBy.name} · ${formatDate(y.lockedAt)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleLock(y.id, y.locked)}
                      disabled={busy === y.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border hover:bg-muted disabled:opacity-50"
                    >
                      {y.locked ? <Unlock size={14} /> : <Lock size={14} />}
                      {y.locked ? 'Desbloquejar' : 'Bloquejar'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {years.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Cap exercici creat encara.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
