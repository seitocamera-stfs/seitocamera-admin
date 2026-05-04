import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronDown, ChevronRight, FileText, Search } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import { formatDate } from '../../lib/utils';

const TYPE_LABELS = {
  RECEIVED_INVOICE: 'Factura rebuda',
  ISSUED_INVOICE: 'Factura emesa',
  PAYMENT: 'Pagament',
  COLLECTION: 'Cobrament',
  BANK_TRANSFER: 'Transf. interna',
  BANK_FEE: 'Comissió',
  AMORTIZATION: 'Amortització',
  PAYROLL: 'Nòmina',
  TAX_PAYMENT: 'Pagament d\'impost',
  TAX_ACCRUAL: 'Devengament d\'impost',
  YEAR_CLOSING: 'Tancament',
  YEAR_OPENING: 'Obertura',
  ADJUSTMENT: 'Ajust',
  OTHER: 'Altre',
};

const STATUS_LABELS = {
  DRAFT: { label: 'Esborrany', className: 'bg-gray-100 text-gray-700' },
  POSTED: { label: 'Comptabilitzat', className: 'bg-green-100 text-green-700' },
  REVERSED: { label: 'Anul·lat', className: 'bg-rose-100 text-rose-700' },
};

export default function Journal() {
  const navigate = useNavigate();
  const { data: company } = useApiGet('/companies');
  const [filters, setFilters] = useState({ status: '', type: '', from: '', to: '', page: 1 });
  const [expanded, setExpanded] = useState(new Set());

  const params = { ...(company && { companyId: company.id }), ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v !== '')) };
  const { data, loading } = useApiGet(company ? '/journal' : null, params);

  const toggle = (id) => {
    const n = new Set(expanded);
    n.has(id) ? n.delete(id) : n.add(id);
    setExpanded(n);
  };

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Llibre diari</h1>
        </div>
        <button
          onClick={() => navigate('/journal/new')}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90"
        >
          <Plus size={16} /> Nou assentament
        </button>
      </div>

      <div className="bg-card border rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <FilterField label="Estat">
          <select className="input-field" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}>
            <option value="">Tots</option>
            <option value="DRAFT">Esborranys</option>
            <option value="POSTED">Comptabilitzats</option>
            <option value="REVERSED">Anul·lats</option>
          </select>
        </FilterField>
        <FilterField label="Tipus">
          <select className="input-field" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value, page: 1 })}>
            <option value="">Tots</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </FilterField>
        <FilterField label="Des de">
          <input className="input-field" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value, page: 1 })} />
        </FilterField>
        <FilterField label="Fins a">
          <input className="input-field" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value, page: 1 })} />
        </FilterField>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Carregant...</div>}

      {data && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-8"></th>
                <th className="text-right px-3 py-2 w-16">Núm.</th>
                <th className="text-left px-3 py-2 w-28">Data</th>
                <th className="text-left px-3 py-2">Concepte</th>
                <th className="text-left px-3 py-2 w-32">Tipus</th>
                <th className="text-left px-3 py-2 w-28">Estat</th>
                <th className="text-right px-3 py-2 w-28">Import</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <EntryRow key={e.id} entry={e} expanded={expanded.has(e.id)} onToggle={() => toggle(e.id)} onView={() => navigate(`/journal/${e.id}`)} />
              ))}
              {data.items.length === 0 && (
                <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Cap assentament amb aquests filtres.</td></tr>
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t text-sm">
              <span className="text-muted-foreground">{data.total} assentaments · pàgina {filters.page} de {totalPages}</span>
              <div className="flex gap-2">
                <button disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })} className="px-3 py-1 rounded border disabled:opacity-50">Anterior</button>
                <button disabled={filters.page >= totalPages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })} className="px-3 py-1 rounded border disabled:opacity-50">Següent</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilterField({ label, children }) {
  return <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">{label}</span>{children}</label>;
}

function EntryRow({ entry, expanded, onToggle, onView }) {
  const st = STATUS_LABELS[entry.status] || STATUS_LABELS.DRAFT;
  const total = (entry.lines || []).reduce((a, l) => a + Number(l.debit || 0), 0);

  return (
    <>
      <tr className="border-t hover:bg-muted/30">
        <td className="px-2"><button onClick={onToggle} className="p-1">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
        <td className="px-3 py-2 text-right font-mono text-xs">#{entry.entryNumber}</td>
        <td className="px-3 py-2 text-muted-foreground">{formatDate(entry.date)}</td>
        <td className="px-3 py-2">
          <button onClick={onView} className="text-left hover:underline">{entry.description}</button>
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">{TYPE_LABELS[entry.type] || entry.type}</td>
        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs ${st.className}`}>{st.label}</span></td>
        <td className="px-3 py-2 text-right font-mono">{total.toFixed(2)}</td>
      </tr>
      {expanded && (
        <tr className="bg-muted/10 border-t">
          <td></td>
          <td colSpan={6} className="p-2">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-1 w-24">Compte</th>
                  <th className="text-left px-2 py-1">Concepte</th>
                  <th className="text-right px-2 py-1 w-24">Deure</th>
                  <th className="text-right px-2 py-1 w-24">Haver</th>
                </tr>
              </thead>
              <tbody>
                {(entry.lines || []).map((l) => (
                  <tr key={l.id} className="border-t border-muted">
                    <td className="px-2 py-1 font-mono">{l.account?.code} <span className="text-muted-foreground">{l.account?.name}</span></td>
                    <td className="px-2 py-1">{l.description}</td>
                    <td className="px-2 py-1 text-right font-mono">{Number(l.debit) ? Number(l.debit).toFixed(2) : ''}</td>
                    <td className="px-2 py-1 text-right font-mono">{Number(l.credit) ? Number(l.credit).toFixed(2) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
