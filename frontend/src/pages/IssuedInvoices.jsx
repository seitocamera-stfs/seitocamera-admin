import { useState } from 'react';
import { Plus, Search, Check, X as XIcon, Trash2 } from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import { StatusBadge } from '../components/shared/StatusBadge';
import Modal from '../components/shared/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import ExportButtons from '../components/shared/ExportButtons';
import SortableHeader from '../components/shared/SortableHeader';

export default function IssuedInvoices() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('issueDate');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ invoiceNumber: '', clientId: '', issueDate: '', dueDate: '', subtotal: '', taxRate: '21', taxAmount: '', totalAmount: '', description: '' });

  const { data, loading, refetch } = useApiGet('/invoices/issued', { search, status: statusFilter || undefined, page, limit: 25 });
  const { data: clientsData } = useApiGet('/clients', { limit: 100 });
  const { mutate } = useApiMutation();

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
        case 'invoiceNumber':
          valA = (a.invoiceNumber || '').toLowerCase();
          valB = (b.invoiceNumber || '').toLowerCase();
          break;
        case 'client':
          valA = (a.client?.name || '').toLowerCase();
          valB = (b.client?.name || '').toLowerCase();
          break;
        case 'issueDate':
          valA = new Date(a.issueDate || 0).getTime();
          valB = new Date(b.issueDate || 0).getTime();
          break;
        case 'totalAmount':
          valA = parseFloat(a.totalAmount) || 0;
          valB = parseFloat(b.totalAmount) || 0;
          break;
        case 'status':
          valA = a.status || '';
          valB = b.status || '';
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

  const calcTax = (subtotal, rate) => {
    const s = parseFloat(subtotal) || 0;
    const r = parseFloat(rate) || 0;
    const tax = s * r / 100;
    return { taxAmount: tax.toFixed(2), totalAmount: (s + tax).toFixed(2) };
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await mutate('post', '/invoices/issued', {
        ...form,
        subtotal: parseFloat(form.subtotal),
        taxRate: parseFloat(form.taxRate),
        taxAmount: parseFloat(form.taxAmount),
        totalAmount: parseFloat(form.totalAmount),
      });
      setShowModal(false);
      refetch();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleStatusChange = async (id, status) => {
    await mutate('patch', `/invoices/issued/${id}/status`, { status });
    refetch();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Factures emeses</h2>
        <div className="flex items-center gap-3">
          <ExportButtons
            endpoint="/export/issued-invoices"
            filters={{ search: search || undefined, status: statusFilter || undefined }}
            filenameBase="factures-emeses"
          />
          <button onClick={() => { setForm({ invoiceNumber: '', clientId: '', issueDate: '', dueDate: '', subtotal: '', taxRate: '21', taxAmount: '', totalAmount: '', description: '' }); setShowModal(true); }} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
            <Plus size={16} /> Nova factura
          </button>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Cercar..." className="w-full pl-10 pr-4 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Tots els estats</option>
          <option value="PENDING">Pendent</option>
          <option value="APPROVED">Aprovada</option>
          <option value="PAID">Pagada</option>
        </select>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <SortableHeader label="Número" field="invoiceNumber" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Client" field="client" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Data" field="issueDate" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Import" field="totalAmount" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Estat" field="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <th className="text-right p-3 font-medium text-xs text-muted-foreground uppercase">Accions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Carregant...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Cap factura trobada</td></tr>
            ) : (
              sortedData.map((inv) => (
                <tr key={inv.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-medium">{inv.invoiceNumber}</td>
                  <td className="p-3">{inv.client?.name}</td>
                  <td className="p-3 text-muted-foreground">{formatDate(inv.issueDate)}</td>
                  <td className="p-3 text-right font-medium">{formatCurrency(inv.totalAmount)}</td>
                  <td className="p-3 text-center"><StatusBadge status={inv.status} /></td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {inv.status === 'PENDING' && (
                        <button onClick={() => handleStatusChange(inv.id, 'APPROVED')} className="p-1.5 rounded hover:bg-green-50 text-green-600"><Check size={14} /></button>
                      )}
                      {inv.status === 'APPROVED' && (
                        <button onClick={() => handleStatusChange(inv.id, 'PAID')} className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600 text-xs font-medium">Pagada</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Nova factura emesa" size="lg">
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Número factura *</label>
              <input type="text" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Client *</label>
              <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required>
                <option value="">Selecciona...</option>
                {clientsData?.data?.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Data emissió *</label>
              <input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Base imposable *</label>
              <input type="number" step="0.01" value={form.subtotal} onChange={(e) => { const { taxAmount, totalAmount } = calcTax(e.target.value, form.taxRate); setForm({ ...form, subtotal: e.target.value, taxAmount, totalAmount }); }} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">% IVA</label>
              <input type="number" value={form.taxRate} readOnly className="w-full rounded-md border bg-muted px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Total</label>
              <input type="number" value={form.totalAmount} readOnly className="w-full rounded-md border bg-muted px-3 py-2 text-sm font-bold" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Descripció</label>
              <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md border text-sm">Cancel·lar</button>
            <button type="submit" className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium">Guardar</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
