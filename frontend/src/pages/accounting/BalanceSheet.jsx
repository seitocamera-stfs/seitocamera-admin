import { useState } from 'react';
import { Layers, Download } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';

export default function BalanceSheet() {
  const today = new Date().toISOString().slice(0, 10);
  const [atDate, setAtDate] = useState(today);
  const [compareDate, setCompareDate] = useState('');

  const { data, loading } = useApiGet('/reports/balance-sheet', {
    atDate,
    ...(compareDate && { compareDate }),
  });

  const exportCSV = () => {
    if (!data) return;
    const rows = [['Secció', 'Grup', 'Compte', 'Nom', 'Import', 'Anterior']];
    const dump = (sections, label) => {
      for (const sec of sections) {
        rows.push([label, sec.section, '', '', sec.total.toFixed(2), sec.prevTotal.toFixed(2)]);
        for (const g of sec.groups) {
          rows.push([label, sec.section, '', g.group, g.total.toFixed(2), g.prevTotal.toFixed(2)]);
          for (const a of g.accounts) {
            rows.push([label, sec.section, a.code, a.name, a.value.toFixed(2), a.prevValue.toFixed(2)]);
          }
        }
      }
    };
    dump(data.asset, 'ACTIU');
    dump(data.liabilityEquity, 'PATRIMONI NET I PASSIU');
    rows.push(['', '', '', 'TOTAL ACTIU', data.totals.asset.toFixed(2), data.comparative?.asset?.toFixed(2) || '']);
    rows.push(['', '', '', 'TOTAL PASSIU + PN', data.totals.liabilityEquity.toFixed(2), data.comparative?.liabilityEquity?.toFixed(2) || '']);
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `balanc-${atDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Layers size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Balanç de situació</h1>
        </div>
        <button onClick={exportCSV} disabled={!data} className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm border hover:bg-muted disabled:opacity-50">
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      <div className="bg-card border rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Data tall</span>
          <input className="input-field" type="date" value={atDate} onChange={(e) => setAtDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Comparativa amb (opcional)</span>
          <input className="input-field" type="date" value={compareDate} onChange={(e) => setCompareDate(e.target.value)} />
        </label>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Carregant...</div>}

      {data && (
        <>
          {!data.totals.balanced && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm">
              ⚠️ El balanç no quadra! Diferència: <strong>{data.totals.difference.toFixed(2)} €</strong>. Revisa el llibre diari.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SidePanel title="ACTIU" sections={data.asset} total={data.totals.asset} prevTotal={data.comparative?.asset} compareDate={compareDate} />
            <SidePanel title="PATRIMONI NET I PASSIU" sections={data.liabilityEquity} total={data.totals.liabilityEquity} prevTotal={data.comparative?.liabilityEquity} compareDate={compareDate} />
          </div>
        </>
      )}
    </div>
  );
}

function SidePanel({ title, sections, total, prevTotal, compareDate }) {
  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      <div className="bg-muted/30 px-4 py-2 font-semibold border-b">{title}</div>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground uppercase">
          <tr>
            <th className="text-left px-4 py-2">Concepte</th>
            <th className="text-right px-4 py-2">Import</th>
            {compareDate && <th className="text-right px-4 py-2">Anterior</th>}
          </tr>
        </thead>
        <tbody>
          {sections.map((sec) => (
            <SectionRows key={sec.section} sec={sec} compareDate={compareDate} />
          ))}
        </tbody>
        <tfoot className="bg-muted/20">
          <tr className="border-t-2 font-bold">
            <td className="px-4 py-2">TOTAL {title}</td>
            <td className="px-4 py-2 text-right font-mono">{total.toFixed(2)}</td>
            {compareDate && <td className="px-4 py-2 text-right font-mono text-muted-foreground">{prevTotal != null ? prevTotal.toFixed(2) : '—'}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SectionRows({ sec, compareDate }) {
  return (
    <>
      <tr className="bg-primary/5 font-semibold">
        <td className="px-4 py-1.5">{sec.section}</td>
        <td className="px-4 py-1.5 text-right font-mono">{sec.total.toFixed(2)}</td>
        {compareDate && <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">{sec.prevTotal.toFixed(2)}</td>}
      </tr>
      {sec.groups.map((g) => (
        <GroupRows key={g.group} g={g} compareDate={compareDate} />
      ))}
    </>
  );
}

function GroupRows({ g, compareDate }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-t hover:bg-muted/20 cursor-pointer" onClick={() => setOpen(!open)}>
        <td className="px-4 py-1.5 pl-8 text-sm">{open ? '▾' : '▸'} {g.group}</td>
        <td className="px-4 py-1.5 text-right font-mono">{g.total.toFixed(2)}</td>
        {compareDate && <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">{g.prevTotal.toFixed(2)}</td>}
      </tr>
      {open && g.accounts.map((a) => (
        <tr key={a.code} className="border-t bg-muted/10 text-xs">
          <td className="px-4 py-1 pl-14 text-muted-foreground"><span className="font-mono">{a.code}</span> {a.name}</td>
          <td className="px-4 py-1 text-right font-mono">{a.value.toFixed(2)}</td>
          {compareDate && <td className="px-4 py-1 text-right font-mono text-muted-foreground">{a.prevValue.toFixed(2)}</td>}
        </tr>
      ))}
    </>
  );
}
