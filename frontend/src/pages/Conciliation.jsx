import { useState } from 'react';
import { Zap, Check, X as XIcon, Trash2 } from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import { StatusBadge } from '../components/shared/StatusBadge';
import { formatCurrency, formatDate } from '../lib/utils';
import ExportButtons from '../components/shared/ExportButtons';
import SortableHeader from '../components/shared/SortableHeader';

export default function Conciliation() {
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('movementDate');
  const [sortDir, setSortDir] = useState('desc');
  const { data, loading, refetch } = useApiGet('/conciliation', { status: statusFilter || undefined, limit: 50 });
  const { mutate, loading: mutating } = useApiMutation();

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  const sortedData = (() => {
    if (!data?.data) return [];
    const items = [...data.data];
    items.sort((a, b) => {
      let valA, valB;
      switch (sortBy) {
        case 'movementDate':
          valA = new Date(a.bankMovement?.date || 0).getTime();
          valB = new Date(b.bankMovement?.date || 0).getTime();
          break;
        case 'movementAmount':
          valA = parseFloat(a.bankMovement?.amount) || 0;
          valB = parseFloat(b.bankMovement?.amount) || 0;
          break;
        case 'invoice':
          valA = (a.receivedInvoice?.invoiceNumber || a.issuedInvoice?.invoiceNumber || '').toLowerCase();
          valB = (b.receivedInvoice?.invoiceNumber || b.issuedInvoice?.invoiceNumber || '').toLowerCase();
          break;
        case 'status':
          valA = a.status || '';
          valB = b.status || '';
          break;
        case 'confidence':
          valA = a.confidence || 0;
          valB = b.confidence || 0;
          break;
        default:
          return 0;
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return items;
  })();

  const handleAutoMatch = async () => {
    try {
      const result = await mutate('post', '/conciliation/auto');
      alert(`Processats: ${result.processed} | Conciliats: ${result.matched} | Sense match: ${result.unmatched}`);
      refetch();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleConfirm = async (id) => {
    await mutate('patch', `/conciliation/${id}/confirm`);
    refetch();
  };

  const handleReject = async (id) => {
    await mutate('patch', `/conciliation/${id}/reject`);
    refetch();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Conciliació</h2>
        <div className="flex items-center gap-3">
          <ExportButtons
            endpoint="/export/conciliations"
            filters={{ status: statusFilter || undefined }}
            filenameBase="conciliacions"
          />
          <button onClick={handleAutoMatch} disabled={mutating} className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            <Zap size={16} /> {mutating ? 'Processant...' : 'Auto-conciliar'}
          </button>
        </div>
      </div>

      <div className="mb-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Tots els estats</option>
          <option value="AUTO_MATCHED">Auto-conciliades</option>
          <option value="MANUAL_MATCHED">Manuals</option>
          <option value="CONFIRMED">Confirmades</option>
          <option value="REJECTED">Rebutjades</option>
        </select>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <SortableHeader label="Moviment bancari" field="movementDate" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Import" field="movementAmount" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Factura vinculada" field="invoice" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Estat" field="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Confiança" field="confidence" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <th className="text-right p-3 font-medium text-xs text-muted-foreground uppercase">Accions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Carregant...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Cap conciliació trobada. Prem "Auto-conciliar" per començar.</td></tr>
            ) : (
              sortedData.map((c) => {
                const invoice = c.receivedInvoice || c.issuedInvoice;
                const invoiceLabel = c.receivedInvoice
                  ? `${c.receivedInvoice.invoiceNumber} (${c.receivedInvoice.supplier?.name})`
                  : c.issuedInvoice
                    ? `${c.issuedInvoice.invoiceNumber} (${c.issuedInvoice.client?.name})`
                    : '—';

                return (
                  <tr key={c.id} className="border-t hover:bg-muted/30">
                    <td className="p-3">
                      <div className="font-medium">{c.bankMovement?.description}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(c.bankMovement?.date)}</div>
                    </td>
                    <td className={`p-3 text-right font-medium ${parseFloat(c.bankMovement?.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(Math.abs(parseFloat(c.bankMovement?.amount || 0)))}
                    </td>
                    <td className="p-3">{invoiceLabel}</td>
                    <td className="p-3 text-center"><StatusBadge status={c.status} /></td>
                    <td className="p-3 text-center">
                      {c.confidence ? `${Math.round(c.confidence * 100)}%` : '—'}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {(c.status === 'AUTO_MATCHED' || c.status === 'MANUAL_MATCHED') && (
                          <>
                            <button onClick={() => handleConfirm(c.id)} className="p-1.5 rounded hover:bg-green-50 text-green-600" title="Confirmar"><Check size={14} /></button>
                            <button onClick={() => handleReject(c.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Rebutjar"><XIcon size={14} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
