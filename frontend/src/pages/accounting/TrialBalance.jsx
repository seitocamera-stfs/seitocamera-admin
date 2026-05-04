import { useState } from 'react';
import { Scale, Download } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';

export default function TrialBalance() {
  const { data: company } = useApiGet('/companies');
  const { data: years } = useApiGet(company ? '/fiscal-years' : null, company ? { companyId: company.id } : {});
  const [fiscalYearId, setFiscalYearId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = {
    ...(company && { companyId: company.id }),
    ...(fiscalYearId && { fiscalYearId }),
    ...(from && { from }),
    ...(to && { to }),
  };
  const { data, loading } = useApiGet(company ? '/ledger/trial-balance' : null, params);

  const exportCSV = () => {
    if (!data) return;
    const rows = [['Codi', 'Nom', 'Tipus', 'Deure', 'Haver', 'Saldo']];
    for (const r of data.items) rows.push([r.code, r.name, r.type, r.debit.toFixed(2), r.credit.toFixed(2), r.balance.toFixed(2)]);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `sumes-i-saldos.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Scale size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Sumes i saldos</h1>
        </div>
        <button onClick={exportCSV} disabled={!data} className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm border hover:bg-muted disabled:opacity-50">
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      <div className="bg-card border rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Exercici</span>
          <select className="input-field" value={fiscalYearId} onChange={(e) => setFiscalYearId(e.target.value)}>
            <option value="">Tots els exercicis</option>
            {(years || []).map((y) => <option key={y.id} value={y.id}>{y.year}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Des de</span>
          <input className="input-field" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Fins a</span>
          <input className="input-field" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Carregant...</div>}

      {data && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 w-24">Codi</th>
                <th className="text-left px-3 py-2">Nom</th>
                <th className="text-left px-3 py-2 w-20">Tipus</th>
                <th className="text-right px-3 py-2 w-32">Deure</th>
                <th className="text-right px-3 py-2 w-32">Haver</th>
                <th className="text-right px-3 py-2 w-32">Saldo deutor</th>
                <th className="text-right px-3 py-2 w-32">Saldo creditor</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.accountId} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.type}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.debit.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.credit.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.balance > 0 ? r.balance.toFixed(2) : ''}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.balance < 0 ? Math.abs(r.balance).toFixed(2) : ''}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Sense apunts comptabilitzats al període.</td></tr>
              )}
            </tbody>
            <tfoot className="bg-muted/20 font-semibold">
              <tr className="border-t-2">
                <td colSpan={3} className="px-3 py-2 text-right">Totals</td>
                <td className="px-3 py-2 text-right font-mono">{data.totals.debit.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono">{data.totals.credit.toFixed(2)}</td>
                <td colSpan={2} className={`px-3 py-2 text-right ${data.totals.balanced ? 'text-green-700' : 'text-rose-700'}`}>
                  {data.totals.balanced ? 'Quadra ✓' : `Diferència: ${(data.totals.debit - data.totals.credit).toFixed(2)}`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
