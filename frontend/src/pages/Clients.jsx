import { useState } from 'react';
import { Plus, Search, Edit2, Trash2, Eye, FileText, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import { StatusBadge } from '../components/shared/StatusBadge';
import Modal from '../components/shared/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import api from '../lib/api';

export default function Clients() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', nif: '', email: '', phone: '', address: '', city: '', postalCode: '' });

  const handleViewPdf = async (invoiceId) => {
    try {
      const { data } = await api.get(`/invoices/issued/${invoiceId}/pdf`);
      if (data.type === 'redirect' && data.url) {
        window.open(data.url, '_blank');
      }
    } catch {
      // Factures emeses potser no tenen PDF
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(1);
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ArrowUpDown size={12} className="text-muted-foreground/40" />;
    return sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  const { data, loading, refetch } = useApiGet('/clients', { search, page, limit: pageSize, sortBy: sortField, sortOrder: sortDir });
  const { data: clientInvoices } = useApiGet(
    selectedClient ? '/invoices/issued' : null,
    selectedClient ? { clientId: selectedClient.id, limit: 100 } : {}
  );
  const { mutate } = useApiMutation();

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await mutate('put', `/clients/${editing}`, form);
      } else {
        await mutate('post', '/clients', form);
      }
      setShowModal(false);
      setEditing(null);
      setForm({ name: '', nif: '', email: '', phone: '', address: '', city: '', postalCode: '' });
      refetch();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleEdit = (client) => {
    setEditing(client.id);
    setForm({
      name: client.name || '',
      nif: client.nif || '',
      email: client.email || '',
      phone: client.phone || '',
      address: client.address || '',
      city: client.city || '',
      postalCode: client.postalCode || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Desactivar aquest client?')) return;
    try {
      await mutate('delete', `/clients/${id}`);
      refetch();
    } catch (err) {
      alert(err.message || 'Error desactivant client');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Clients</h2>
        <button onClick={() => { setEditing(null); setForm({ name: '', nif: '', email: '', phone: '', address: '', city: '', postalCode: '' }); setShowModal(true); }} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
          <Plus size={16} /> Nou client
        </button>
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Cercar per nom, NIF o email..." className="w-full pl-10 pr-4 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => handleSort('name')}><span className="flex items-center gap-1">Nom <SortIcon field="name" /></span></th>
              <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => handleSort('nif')}><span className="flex items-center gap-1">NIF <SortIcon field="nif" /></span></th>
              <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => handleSort('email')}><span className="flex items-center gap-1">Email <SortIcon field="email" /></span></th>
              <th className="text-left p-3 font-medium">Telèfon</th>
              <th className="text-center p-3 font-medium">Factures</th>
              <th className="text-right p-3 font-medium">Accions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Carregant...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Cap client trobat</td></tr>
            ) : (
              data?.data?.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3 text-muted-foreground">{c.nif || '—'}</td>
                  <td className="p-3 text-muted-foreground">{c.email || '—'}</td>
                  <td className="p-3 text-muted-foreground">{c.phone || '—'}</td>
                  <td className="p-3 text-center">{c._count?.issuedInvoices || 0}</td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => { setSelectedClient(c); setShowDetailModal(true); }} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Veure factures"><Eye size={14} /></button>
                      <button onClick={() => handleEdit(c)} className="p-1.5 rounded hover:bg-muted"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {data?.pagination && (
          <div className="flex items-center justify-between p-3 border-t text-sm">
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground">{data.pagination.total} clients</span>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="border rounded px-2 py-1 text-xs bg-background">
                {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / pàgina</option>)}
              </select>
            </div>
            {data.pagination.totalPages > 1 && (
              <div className="flex gap-2">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1 rounded border disabled:opacity-50">Anterior</button>
                <span className="px-3 py-1">{page} / {data.pagination.totalPages}</span>
                <button onClick={() => setPage(Math.min(data.pagination.totalPages, page + 1))} disabled={page >= data.pagination.totalPages} className="px-3 py-1 rounded border disabled:opacity-50">Següent</button>
              </div>
            )}
          </div>
        )}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar client' : 'Nou client'}>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Nom *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">NIF</label>
              <input type="text" value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Telèfon</label>
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ciutat</label>
              <input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Adreça</label>
              <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md border text-sm">Cancel·lar</button>
            <button type="submit" className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium">Guardar</button>
          </div>
        </form>
      </Modal>

      {/* Modal: Detall client amb factures */}
      <Modal isOpen={showDetailModal} onClose={() => { setShowDetailModal(false); setSelectedClient(null); }} title={`Client: ${selectedClient?.name || ''}`} size="lg">
        {selectedClient && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">NIF:</span> {selectedClient.nif || '—'}</div>
              <div><span className="text-muted-foreground">Email:</span> {selectedClient.email || '—'}</div>
              <div><span className="text-muted-foreground">Telèfon:</span> {selectedClient.phone || '—'}</div>
              <div><span className="text-muted-foreground">Ciutat:</span> {selectedClient.city || '—'}</div>
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2">Factures emeses ({clientInvoices?.data?.length || 0})</h3>
              {clientInvoices?.data?.length > 0 ? (
                <div className="border rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-medium">Número</th>
                        <th className="text-left p-2 font-medium">Data</th>
                        <th className="text-right p-2 font-medium">Import</th>
                        <th className="text-center p-2 font-medium">Estat</th>
                        <th className="text-center p-2 font-medium">PDF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientInvoices.data.map((inv) => (
                        <tr key={inv.id} className="border-t">
                          <td className="p-2">{inv.invoiceNumber}</td>
                          <td className="p-2 text-muted-foreground">{formatDate(inv.issueDate)}</td>
                          <td className="p-2 text-right font-medium">{formatCurrency(inv.totalAmount)}</td>
                          <td className="p-2 text-center"><StatusBadge status={inv.status} /></td>
                          <td className="p-2 text-center">
                            {inv.filePath ? (
                              <button onClick={() => handleViewPdf(inv.id)} className="p-1 rounded hover:bg-blue-50 text-blue-600" title="Veure PDF">
                                <FileText size={14} />
                              </button>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30">
                      <tr>
                        <td colSpan={2} className="p-2 font-semibold">Total</td>
                        <td className="p-2 text-right font-semibold">
                          {formatCurrency(clientInvoices.data.reduce((sum, inv) => sum + (parseFloat(inv.totalAmount) || 0), 0))}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Cap factura emesa per aquest client.</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
