import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Send } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

const MONTH_LABELS = ['Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny', 'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre'];

export default function AmortizationCalendar() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, loading, refetch } = useApiGet('/fixed-assets/amortizations/calendar', { year });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const handleRunMonth = async (month) => {
    if (!confirm(`Comptabilitzar totes les amortitzacions pendents de ${MONTH_LABELS[month - 1]} ${year}?`)) return;
    setBusy(month); setError(null);
    try {
      const r = await api.post('/fixed-assets/amortizations/run-month', { year, month });
      alert(`${r.data.ok.length} OK · ${r.data.failed.length} fallades`);
      refetch();
    } catch (err) { setError(err.response?.data?.error || 'Error'); }
    finally { setBusy(null); }
  };

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Calendar size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Calendari d'amortitzacions</h1>
        </div>
        <input type="number" min="2000" max="2100" className="input-field w-28" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10) || new Date().getFullYear())} />
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded p-3">{error}</div>}
      {loading && <div className="text-sm text-muted-foreground">Carregant...</div>}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.months.map((m) => {
            const isEmpty = m.entries.length === 0;
            return (
              <div key={m.month} className={`bg-card border rounded-lg p-4 ${isEmpty ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">{MONTH_LABELS[m.month - 1]} {year}</h3>
                  {m.pending > 0 && (
                    <button onClick={() => handleRunMonth(m.month)} disabled={busy === m.month}
                      className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
                      <Send size={11} className={busy === m.month ? 'animate-pulse' : ''} />
                      {busy === m.month ? 'Comptabilitzant...' : `Comptabilitzar (${m.pending})`}
                    </button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mb-3">
                  {m.entries.length} quotes · {m.posted} comptabilitzades · {m.pending} pendents · Total {m.totalAmount.toFixed(2)} €
                </div>
                {!isEmpty && (
                  <ul className="space-y-1 text-xs max-h-48 overflow-y-auto">
                    {m.entries.map((e) => (
                      <li key={e.id} className="flex items-center justify-between border-b last:border-b-0 py-1">
                        <Link to={`/fixed-assets/${e.fixedAsset.id}`} className="hover:underline truncate flex-1 mr-2">
                          {e.fixedAsset.code} {e.fixedAsset.name}
                        </Link>
                        <span className="font-mono whitespace-nowrap">{Number(e.amount).toFixed(2)} €</span>
                        <span className={`ml-2 inline-block w-2 h-2 rounded-full ${e.status === 'POSTED' ? 'bg-emerald-500' : 'bg-gray-400'}`} title={e.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
