import { useState } from 'react';
import { Receipt, Download } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';

const TABS = [
  { key: 'INPUT', label: 'IVA suportat', endpoint: '/fiscal/vat-book', extraParams: { type: 'INPUT' } },
  { key: 'OUTPUT', label: 'IVA repercutit', endpoint: '/fiscal/vat-book', extraParams: { type: 'OUTPUT' } },
  { key: 'IRPF', label: 'Retencions IRPF', endpoint: '/fiscal/irpf-book', extraParams: {} },
];

export default function VatBooks() {
  const [tab, setTab] = useState('INPUT');
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState('');

  const active = TABS.find((t) => t.key === tab);
  const params = { year, ...(quarter && { quarter: parseInt(quarter, 10) }), ...active.extraParams };
  const { data, loading } = useApiGet(active.endpoint, params);

  const exportCSV = () => {
    if (!data?.rows?.length) return;
    const headers = Object.keys(data.rows[0]);
    const rows = [headers, ...data.rows.map((r) => headers.map((h) => r[h]))];
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `llibre-${tab.toLowerCase()}-${data.period.replace(/\s/g, '_')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Receipt size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Llibres IVA i IRPF</h1>
        </div>
        <button
          onClick={exportCSV}
          disabled={!data?.rows?.length}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm border hover:bg-muted disabled:opacity-50"
        >
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      <div className="flex gap-1 mb-4 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-card border rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Any</span>
          <input className="input-field" type="number" min="2000" max="2100" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10) || new Date().getFullYear())} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Trimestre</span>
          <select className="input-field" value={quarter} onChange={(e) => setQuarter(e.target.value)}>
            <option value="">Any sencer</option>
            <option value="1">1T (gen-mar)</option>
            <option value="2">2T (abr-jun)</option>
            <option value="3">3T (jul-set)</option>
            <option value="4">4T (oct-des)</option>
          </select>
        </label>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Carregant...</div>}

      {data && (
        <div className="bg-card border rounded-lg overflow-x-auto">
          <div className="px-4 py-3 border-b bg-muted/20">
            <h2 className="font-semibold">{active.label} · {data.period}</h2>
            <p className="text-xs text-muted-foreground">
              {data.totals.count} factures
              {data.totals.base !== undefined && <> · Base {data.totals.base.toFixed(2)} €</>}
              {data.totals.vatAmount !== undefined && <> · IVA {data.totals.vatAmount.toFixed(2)} €</>}
              {data.totals.irpfAmount !== undefined && <> · IRPF {data.totals.irpfAmount.toFixed(2)} €</>}
              {data.totals.total !== undefined && <> · Total {data.totals.total.toFixed(2)} €</>}
            </p>
          </div>

          {tab === 'INPUT' && <VatInputTable rows={data.rows} totals={data.totals} />}
          {tab === 'OUTPUT' && <VatOutputTable rows={data.rows} totals={data.totals} />}
          {tab === 'IRPF' && <IrpfTable rows={data.rows} totals={data.totals} />}
        </div>
      )}
    </div>
  );
}

function VatInputTable({ rows, totals }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
        <tr>
          <th className="text-left px-3 py-2">Data</th>
          <th className="text-right px-3 py-2">Núm. assent.</th>
          <th className="text-left px-3 py-2">Núm. factura</th>
          <th className="text-left px-3 py-2">Proveïdor</th>
          <th className="text-left px-3 py-2">NIF</th>
          <th className="text-right px-3 py-2">Base</th>
          <th className="text-right px-3 py-2">% IVA</th>
          <th className="text-right px-3 py-2">Quota IVA</th>
          <th className="text-right px-3 py-2">% IRPF</th>
          <th className="text-right px-3 py-2">Quota IRPF</th>
          <th className="text-right px-3 py-2">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t">
            <td className="px-3 py-1.5 text-muted-foreground">{r.date}</td>
            <td className="px-3 py-1.5 text-right font-mono text-xs">#{r.entryNumber}</td>
            <td className="px-3 py-1.5">{r.invoiceNumber}</td>
            <td className="px-3 py-1.5">{r.supplierName}</td>
            <td className="px-3 py-1.5 font-mono text-xs">{r.supplierNif}</td>
            <td className="px-3 py-1.5 text-right font-mono">{r.base.toFixed(2)}</td>
            <td className="px-3 py-1.5 text-right">{r.vatRate.toFixed(0)}%</td>
            <td className="px-3 py-1.5 text-right font-mono">{r.vatAmount.toFixed(2)}</td>
            <td className="px-3 py-1.5 text-right">{r.irpfRate ? r.irpfRate.toFixed(0) + '%' : ''}</td>
            <td className="px-3 py-1.5 text-right font-mono">{r.irpfAmount ? r.irpfAmount.toFixed(2) : ''}</td>
            <td className="px-3 py-1.5 text-right font-mono font-medium">{r.total.toFixed(2)}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={11} className="text-center text-muted-foreground py-6">Sense factures comptabilitzades al període.</td></tr>}
      </tbody>
      {rows.length > 0 && (
        <tfoot className="bg-muted/20 font-semibold">
          <tr className="border-t-2">
            <td colSpan={5} className="px-3 py-2 text-right">Totals</td>
            <td className="px-3 py-2 text-right font-mono">{totals.base.toFixed(2)}</td>
            <td></td>
            <td className="px-3 py-2 text-right font-mono">{totals.vatAmount.toFixed(2)}</td>
            <td></td>
            <td className="px-3 py-2 text-right font-mono">{totals.irpfAmount.toFixed(2)}</td>
            <td className="px-3 py-2 text-right font-mono">{totals.total.toFixed(2)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function VatOutputTable({ rows, totals }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
        <tr>
          <th className="text-left px-3 py-2">Data</th>
          <th className="text-right px-3 py-2">Núm. assent.</th>
          <th className="text-left px-3 py-2">Núm. factura</th>
          <th className="text-left px-3 py-2">Client</th>
          <th className="text-left px-3 py-2">NIF</th>
          <th className="text-right px-3 py-2">Base</th>
          <th className="text-right px-3 py-2">% IVA</th>
          <th className="text-right px-3 py-2">Quota IVA</th>
          <th className="text-right px-3 py-2">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t">
            <td className="px-3 py-1.5 text-muted-foreground">{r.date}</td>
            <td className="px-3 py-1.5 text-right font-mono text-xs">#{r.entryNumber}</td>
            <td className="px-3 py-1.5">{r.invoiceNumber}</td>
            <td className="px-3 py-1.5">{r.clientName}</td>
            <td className="px-3 py-1.5 font-mono text-xs">{r.clientNif}</td>
            <td className="px-3 py-1.5 text-right font-mono">{r.base.toFixed(2)}</td>
            <td className="px-3 py-1.5 text-right">{r.vatRate.toFixed(0)}%</td>
            <td className="px-3 py-1.5 text-right font-mono">{r.vatAmount.toFixed(2)}</td>
            <td className="px-3 py-1.5 text-right font-mono font-medium">{r.total.toFixed(2)}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={9} className="text-center text-muted-foreground py-6">Sense factures comptabilitzades al període.</td></tr>}
      </tbody>
      {rows.length > 0 && (
        <tfoot className="bg-muted/20 font-semibold">
          <tr className="border-t-2">
            <td colSpan={5} className="px-3 py-2 text-right">Totals</td>
            <td className="px-3 py-2 text-right font-mono">{totals.base.toFixed(2)}</td>
            <td></td>
            <td className="px-3 py-2 text-right font-mono">{totals.vatAmount.toFixed(2)}</td>
            <td className="px-3 py-2 text-right font-mono">{totals.total.toFixed(2)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function IrpfTable({ rows, totals }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
        <tr>
          <th className="text-left px-3 py-2">Data</th>
          <th className="text-right px-3 py-2">Núm. assent.</th>
          <th className="text-left px-3 py-2">Núm. factura</th>
          <th className="text-left px-3 py-2">Perceptor</th>
          <th className="text-left px-3 py-2">NIF</th>
          <th className="text-right px-3 py-2">Base</th>
          <th className="text-right px-3 py-2">% IRPF</th>
          <th className="text-right px-3 py-2">Quota IRPF</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t">
            <td className="px-3 py-1.5 text-muted-foreground">{r.date}</td>
            <td className="px-3 py-1.5 text-right font-mono text-xs">#{r.entryNumber}</td>
            <td className="px-3 py-1.5">{r.invoiceNumber}</td>
            <td className="px-3 py-1.5">{r.perceptor}</td>
            <td className="px-3 py-1.5 font-mono text-xs">{r.perceptorNif}</td>
            <td className="px-3 py-1.5 text-right font-mono">{r.base.toFixed(2)}</td>
            <td className="px-3 py-1.5 text-right">{r.irpfRate.toFixed(0)}%</td>
            <td className="px-3 py-1.5 text-right font-mono font-medium">{r.irpfAmount.toFixed(2)}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={8} className="text-center text-muted-foreground py-6">Sense retencions practicades al període.</td></tr>}
      </tbody>
      {rows.length > 0 && (
        <tfoot className="bg-muted/20 font-semibold">
          <tr className="border-t-2">
            <td colSpan={5} className="px-3 py-2 text-right">Totals</td>
            <td className="px-3 py-2 text-right font-mono">{totals.base.toFixed(2)}</td>
            <td></td>
            <td className="px-3 py-2 text-right font-mono">{totals.irpfAmount.toFixed(2)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
