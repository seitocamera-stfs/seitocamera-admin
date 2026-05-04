import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Lock, CheckCircle2, AlertCircle, Calculator, FileLock, Calendar, Receipt } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

export default function YearClosing() {
  const { data: years } = useApiGet('/fiscal-years');
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const checklist = useApiGet(`/closing/${year}/checklist`);
  const taxPreview = useApiGet(`/closing/${year}/corporate-tax-preview`);

  const [adjustments, setAdjustments] = useState(0);
  const [deductions, setDeductions] = useState(0);

  const refresh = () => {
    checklist.refetch();
    taxPreview.refetch();
  };

  const action = async (label, fn) => {
    setBusy(label); setError(null); setFeedback(null);
    try {
      const result = await fn();
      setFeedback(`${label} OK${result?.entryNumber ? ` (assentament #${result.entryNumber})` : ''}`);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(null);
    }
  };

  const fy = years?.find((y) => y.year === year);
  const isLocked = fy?.locked;

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Lock size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Tancament d'exercici</h1>
        </div>
        <select className="input-field w-40" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}>
          {(years || []).map((y) => (
            <option key={y.id} value={y.year}>{y.year} {y.locked ? '🔒' : ''}</option>
          ))}
        </select>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded p-3">{error}</div>}
      {feedback && <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-100 rounded p-3">{feedback}</div>}

      {isLocked && (
        <div className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm">
          🔒 L'exercici {year} està <strong>tancat</strong>. Per generar-hi assentaments cal desbloquejar-lo des d'<Link to="/company/fiscal-years" className="underline">Empresa → Exercicis</Link>.
        </div>
      )}

      {/* PAS 1 — CHECKLIST */}
      <Section
        icon={<CheckCircle2 size={18} />}
        title="1. Verificacions prèvies"
        subtitle="Comprova que tot està en ordre abans de regularitzar."
      >
        {checklist.loading && <div className="text-sm text-muted-foreground">Carregant...</div>}
        {checklist.data && (
          <ul className="space-y-2">
            {checklist.data.items.map((it) => (
              <li key={it.id} className="flex items-start gap-2 text-sm">
                {it.ok ? <CheckCircle2 size={16} className="text-green-600 mt-0.5" /> : <AlertCircle size={16} className="text-rose-600 mt-0.5" />}
                <div className="flex-1">
                  <div className={it.ok ? '' : 'text-rose-700 font-medium'}>{it.label}</div>
                  {!it.ok && (
                    <div className="text-xs text-muted-foreground">
                      {it.count !== undefined && <>Pendents: <strong>{it.count}</strong>. </>}
                      {it.id === 'balance' && it.debit !== undefined && <>Deure: {it.debit.toFixed(2)} ≠ Haver: {it.credit.toFixed(2)}. </>}
                      {it.hint}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* PAS 2 — IVA */}
      <Section
        icon={<Receipt size={18} />}
        title="2. Regularització de l'IVA del Q4"
        subtitle="Tanca el 472 i 477 i mou el saldo a 4750 (a pagar) o 4709 (a compensar)."
      >
        <button
          disabled={!checklist.data?.allOk || isLocked || busy === 'iva'}
          onClick={() => action('Regularització IVA', () => api.post(`/closing/${year}/regularize-vat`).then((r) => r.data))}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'iva' ? 'Regularitzant...' : 'Regularitzar IVA'}
        </button>
      </Section>

      {/* PAS 3 — IS */}
      <Section
        icon={<Calculator size={18} />}
        title="3. Impost de societats"
        subtitle="Càlcul automàtic sobre el resultat comptable amb tipus i ajustos manuals."
      >
        {taxPreview.data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Ingressos" value={`${taxPreview.data.totalIncomes.toFixed(2)} €`} />
            <Stat label="Despeses (sense 630)" value={`${taxPreview.data.totalExpenses.toFixed(2)} €`} />
            <Stat label="Resultat" value={`${taxPreview.data.resultBeforeTax.toFixed(2)} €`} highlight={taxPreview.data.resultBeforeTax !== 0} />
            <Stat label="Quota IS" value={`${taxPreview.data.grossTax.toFixed(2)} €`} sub={`${taxPreview.data.taxRate}%`} />
          </div>
        )}
        {taxPreview.data?.note && (
          <div className="mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded p-2">{taxPreview.data.note}</div>
        )}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Ajustos a la base (BIN, etc.)</span>
            <input className="input-field" type="number" step="0.01" value={adjustments} onChange={(e) => setAdjustments(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Deduccions sobre la quota</span>
            <input className="input-field" type="number" step="0.01" value={deductions} onChange={(e) => setDeductions(parseFloat(e.target.value) || 0)} />
          </label>
        </div>
        <button
          disabled={isLocked || busy === 'is' || !taxPreview.data?.grossTax}
          onClick={() => action('Comptabilitzar IS', () => api.post(`/closing/${year}/post-corporate-tax`, { adjustments, deductions }).then((r) => r.data.journalEntry))}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'is' ? 'Comptabilitzant...' : 'Comptabilitzar IS'}
        </button>
      </Section>

      {/* PAS 4 — TANCAMENT */}
      <Section
        icon={<FileLock size={18} />}
        title="4. Tancament definitiu"
        subtitle="Regularitza grups 6 i 7 → 129 i bloqueja l'exercici. Procés irreversible (només es pot desfer desbloquejant-lo)."
      >
        <button
          disabled={isLocked || busy === 'close'}
          onClick={() => {
            if (!confirm(`Tancar definitivament l'exercici ${year}? Després cal desbloquejar-lo per fer-hi qualsevol canvi.`)) return;
            action('Tancament', () => api.post(`/closing/${year}/close`).then((r) => r.data.closingEntry));
          }}
          className="inline-flex items-center gap-2 bg-rose-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-rose-700 disabled:opacity-50"
        >
          {busy === 'close' ? 'Tancant...' : 'Tancar exercici'}
        </button>
      </Section>

      {/* PAS 5 — OBERTURA */}
      <Section
        icon={<Calendar size={18} />}
        title="5. Obertura de l'exercici següent"
        subtitle="Crea l'exercici {{year+1}} (si no existeix) i genera l'assentament d'obertura amb saldos d'actius/passius/PN."
      >
        <button
          disabled={!isLocked || busy === 'open'}
          onClick={() => action(`Obertura ${year + 1}`, () => api.post(`/closing/${year}/open-next`).then((r) => r.data.openingEntry))}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'open' ? 'Obrint...' : `Obrir exercici ${year + 1}`}
        </button>
      </Section>
    </div>
  );
}

function Section({ icon, title, subtitle, children }) {
  return (
    <div className="bg-card border rounded-lg p-5 mb-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="text-primary mt-0.5">{icon}</div>
        <div className="flex-1">
          <h2 className="font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Stat({ label, value, sub, highlight }) {
  return (
    <div className={`p-3 rounded-lg border ${highlight ? 'bg-primary/5 border-primary/20' : 'bg-muted/20'}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${highlight ? 'text-primary' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
