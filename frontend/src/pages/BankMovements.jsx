import { useState } from 'react';
import { Plus, Search, ArrowUpCircle, ArrowDownCircle, Trash2 } from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import Modal from '../components/shared/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import ExportButtons from '../components/shared/ExportButtons';

export default function BankMovements() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [conciliatedFilter, setConciliatedFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ date: '', description: '', amount: '', type: 'EXPENSE', reference: '' });

  const { data, loading, refetch } = useApiGet('/bank', { search, type: typeFilter || undefined, conciliated: conciliatedFilter || undefined, page, limit: 50 });
  const { mutate } = useApiMutation();

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await mutate('post', '/bank', {
        ...form,
        date: new Date(form.date).toISOString(),
        amount: parseFloat(form.amount),
      });
      setShowModal(false);
      refetch();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Eliminar aquest moviment?')) return;
    await mutate('delete', `/bank/${id}`);
    refetch();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Moviments bancaris</h2>
        <div className="flex items-center gap-3">
          <ExportButtons
            endpoint="/export/bank-movements"
            filters={{ search: search || undefined, type: typeFilter || undefined, conciliated: conciliatedFilter || undefined }}
            filenameBase="moviments-bancaris"
          />
          <button onClick={() => { setForm({ date: '', description: '', amount: '', type: 'EXPENSE', reference: '' }); setShowModal(true); }} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
            <Plus size={16} /> Nou moviment
          </button>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Cercar per descripció o referència..." className="w-full pl-10 pr-4 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Tots els tipus</option>
          <option value="INCOME">Ingressos</option>
          <option value="EXPENSE">Despeses</option>
          <option value="TRANSFER">Transferències</option>
        </select>
        <select value={conciliatedFilter} onChange={(e) => { setConciliatedFilter(e.target.value); setPage(1); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Tots</option>
          <option value="false">Sense conciliar</option>
          <option value="true">Conciliats</option>
        </select>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Data</th>
              <th className="text-left p-3 font-medium">Descripció</th>
              <th className="text-left p-3 font-medium">Referència</th>
              <th className="text-right p-3 font-medium">Import</th>
              <th className="text-center p-3 font-medium">Conciliat</th>
              <th className="text-right p-3 font-medium">Accions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Carregant...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Cap moviment trobat</td></tr>
            ) : (
              data?.data?.map((m) => (
                <tr key={m.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 text-muted-foreground">{formatDate(m.date)}</td>
                  <td className="p-3">{m.description}</td>
                  <td className="p-3 text-muted-foreground text-xs">{m.reference || '—'}</td>
                  <td className={`p-3 text-right font-medium ${parseFloat(m.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    <span className="inline-flex items-center gap-1">
                      {parseFloat(m.amount) >= 0 ? <ArrowUpCircle size={14} /> : <ArrowDownCircle size={14} />}
                      {formatCurrency(Math.abs(parseFloat(m.amount)))}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${m.isConciliated ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {m.isConciliated ? 'Sí' : 'No'}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleDelete(m.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t text-sm">
            <span className="text-muted-foreground">{data.pagination.total} moviments</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1 rounded border disabled:opacity-50">Anterior</button>
              <span className="px-3 py-1">{page} / {data.pagination.totalPages}</span>
              <button onClick={() => setPage(Math.min(data.pagination.totalPages, page + 1))} disabled={page >= data.pagination.totalPages} className="px-3 py-1 rounded border disabled:opacity-50">Següent</button>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Nou moviment bancari">
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Data *</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tipus *</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="EXPENSE">Despesa</option>
                <option value="INCOME">Ingrés</option>
                <option value="TRANSFER">Transferència</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Descripció *</label>
              <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Import *</label>
              <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Referència</label>
              <input type="text" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
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
