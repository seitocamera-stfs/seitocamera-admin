import { useState } from 'react';
import { TrendingUp, Download } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';

export default function ProfitAndLoss() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [compare, setCompare] = useState(false);

  const fromDate = `${year}-01-01`;
  const toDate = `${year}-12-31`;
  const compareFromDate = compare ? `${year - 1}-01-01` : '';
  const compareToDate = compare ? `${year - 1}-12-31` : '';

  const params = {
    fromDate, toDate,
    ...(compare && { compareFromDate, compareToDate }),
  };
  const { data, loading } = useApiGet('/reports/profit-loss', params);

  const exportCSV = () => {
    if (!data) return;
    const rows = [['Secció', 'Epígraf', 'Compte', 'Nom', 'Import', 'Anterior']];
    const dump = (arr, label) => {
      for (const e of arr) {
        rows.push([label, e.epigraf, '', '', (e.total * e.sign).toFixed(2), (e.prevTotal * e.sign).toFixed(2)]);
        for (const a of e.accounts) {
          rows.push([label, e.epigraf, a.code, a.name, (a.value * e.sign).toFixed(2), (a.prevValue * e.sign).toFixed(2)]);
        }
      }
    };
    dump(data.operating, 'EXPLOTACIÓ');
    rows.push(['', '', '', "A.1) Resultat d'explotació", data.subtotals["A.1) Resultat d'explotació"].value.toFixed(2), data.subtotals["A.1) Resultat d'explotació"].prev.toFixed(2)]);
    dump(data.financial, 'FINANCER');
    rows.push(['', '', '', "A.2) Resultat financer", data.subtotals["A.2) Resultat financer"].value.toFixed(2), data.subtotals["A.2) Resultat financer"].prev.toFixed(2)]);
    rows.push(['', '', '', "A.3) Resultat abans d'impostos", data.subtotals["A.3) Resultat abans d'impostos"].value.toFixed(2), data.subtotals["A.3) Resultat abans d'impostos"].prev.toFixed(2)]);
    dump(data.tax, 'IMPOST');
    rows.push(['', '', '', "A.4) Resultat de l'exercici", data.subtotals["A.4) Resultat de l'exercici"].value.toFixed(2), data.subtotals["A.4) Resultat de l'exercici"].prev.toFixed(2)]);
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `compte-pig-${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <TrendingUp size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Compte de pèrdues i guanys</h1>
        </div>
        <button onClick={exportCSV} disabled={!data} className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm border hover:bg-muted disabled:opacity-50">
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      <div className="bg-card border rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Exercici</span>
          <input className="input-field" type="number" min="2000" max="2100" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10) || currentYear)} />
        </label>
        <label className="flex items-center gap-2 mt-5">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="rounded border-gray-300" />
          <span className="text-sm">Comparar amb {year - 1}</span>
        </label>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Carregant...</div>}

      {data && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Concepte</th>
                <th className="text-right px-4 py-2 w-32">{year}</th>
                {compare && <th className="text-right px-4 py-2 w-32">{year - 1}</th>}
                {compare && <th className="text-right px-4 py-2 w-24">Δ</th>}
              </tr>
            </thead>
            <tbody>
              <SectionTitle title="A) OPERACIONS CONTINUADES" />
              {data.operating.map((e) => <EpigrafRows key={e.epigraf} e={e} compare={compare} />)}
              <SubtotalRow label="A.1) Resultat d'explotació" sub={data.subtotals["A.1) Resultat d'explotació"]} compare={compare} />

              {data.financial.length > 0 && (
                <>
                  <SectionTitle title="" />
                  {data.financial.map((e) => <EpigrafRows key={e.epigraf} e={e} compare={compare} />)}
                  <SubtotalRow label="A.2) Resultat financer" sub={data.subtotals["A.2) Resultat financer"]} compare={compare} />
                </>
              )}

              <SubtotalRow label="A.3) Resultat abans d'impostos" sub={data.subtotals["A.3) Resultat abans d'impostos"]} compare={compare} bold />

              {data.tax.length > 0 && data.tax.map((e) => <EpigrafRows key={e.epigraf} e={e} compare={compare} />)}

              <SubtotalRow label="A.4) Resultat de l'exercici" sub={data.subtotals["A.4) Resultat de l'exercici"]} compare={compare} bold highlight />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ title }) {
  if (!title) return <tr className="border-t-2"><td className="py-2"></td></tr>;
  return (
    <tr className="bg-primary/5">
      <td colSpan={4} className="px-4 py-2 font-semibold">{title}</td>
    </tr>
  );
}

function EpigrafRows({ e, compare }) {
  const [open, setOpen] = useState(false);
  const value = e.total * e.sign;
  const prevValue = e.prevTotal * e.sign;
  const diff = value - prevValue;
  return (
    <>
      <tr className="border-t hover:bg-muted/20 cursor-pointer" onClick={() => setOpen(!open)}>
        <td className="px-4 py-1.5 text-sm">{open ? '▾' : '▸'} {e.epigraf}</td>
        <td className={`px-4 py-1.5 text-right font-mono ${e.sign < 0 ? 'text-rose-600' : ''}`}>{value.toFixed(2)}</td>
        {compare && <td className={`px-4 py-1.5 text-right font-mono text-muted-foreground ${e.sign < 0 ? 'text-rose-400' : ''}`}>{prevValue.toFixed(2)}</td>}
        {compare && <td className="px-4 py-1.5 text-right font-mono text-xs text-muted-foreground">{diff >= 0 ? '+' : ''}{diff.toFixed(2)}</td>}
      </tr>
      {open && e.accounts.map((a) => (
        <tr key={a.code} className="border-t bg-muted/10 text-xs">
          <td className="px-4 py-1 pl-12 text-muted-foreground"><span className="font-mono">{a.code}</span> {a.name}</td>
          <td className="px-4 py-1 text-right font-mono">{(a.value * e.sign).toFixed(2)}</td>
          {compare && <td className="px-4 py-1 text-right font-mono text-muted-foreground">{(a.prevValue * e.sign).toFixed(2)}</td>}
          {compare && <td></td>}
        </tr>
      ))}
    </>
  );
}

function SubtotalRow({ label, sub, compare, bold, highlight }) {
  const diff = sub.value - sub.prev;
  return (
    <tr className={`border-t-2 ${bold ? 'font-bold' : 'font-semibold'} ${highlight ? 'bg-primary/10 text-primary' : 'bg-muted/30'}`}>
      <td className="px-4 py-2">{label}</td>
      <td className="px-4 py-2 text-right font-mono">{sub.value.toFixed(2)}</td>
      {compare && <td className="px-4 py-2 text-right font-mono">{sub.prev.toFixed(2)}</td>}
      {compare && <td className="px-4 py-2 text-right font-mono text-xs">{diff >= 0 ? '+' : ''}{diff.toFixed(2)}</td>}
    </tr>
  );
}
