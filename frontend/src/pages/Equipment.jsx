import { useState } from 'react';
import {
  Search, Plus, Camera, Pencil, Trash2, Package,
  Sparkles, RefreshCw, ExternalLink,
} from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import Modal from '../components/shared/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import api from '../lib/api';

const CATEGORY_LABELS = {
  camera: { label: 'Càmera', color: 'bg-blue-100 text-blue-700' },
  lens: { label: 'Objectiu', color: 'bg-purple-100 text-purple-700' },
  lighting: { label: 'Il·luminació', color: 'bg-amber-100 text-amber-700' },
  audio: { label: 'Àudio', color: 'bg-green-100 text-green-700' },
  monitor: { label: 'Monitor', color: 'bg-cyan-100 text-cyan-700' },
  tripod: { label: 'Trípode', color: 'bg-orange-100 text-orange-700' },
  stabilizer: { label: 'Estabilitzador', color: 'bg-pink-100 text-pink-700' },
  storage: { label: 'Emmagatzematge', color: 'bg-indigo-100 text-indigo-700' },
  accessory: { label: 'Accessori', color: 'bg-gray-100 text-gray-700' },
  cable: { label: 'Cable', color: 'bg-gray-100 text-gray-600' },
  power: { label: 'Alimentació', color: 'bg-red-100 text-red-700' },
  case: { label: 'Maleta/Funda', color: 'bg-stone-100 text-stone-700' },
  other: { label: 'Altre', color: 'bg-gray-100 text-gray-500' },
};

const STATUS_LABELS = {
  ACTIVE: { label: 'Actiu', color: 'bg-green-100 text-green-700' },
  SOLD: { label: 'Venut', color: 'bg-blue-100 text-blue-700' },
  BROKEN: { label: 'Avariat', color: 'bg-red-100 text-red-700' },
  LOST: { label: 'Perdut', color: 'bg-gray-100 text-gray-500' },
};

export default function Equipment() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [form, setForm] = useState({
    name: '', serialNumber: '', category: 'other', brand: '', model: '',
    purchasePrice: '', status: 'ACTIVE', notes: '',
  });

  const { data, loading, refetch } = useApiGet('/equipment', {
    search: search || undefined,
    category: categoryFilter || undefined,
    status: statusFilter || undefined,
    page,
    limit: 50,
  });
  const { data: stats } = useApiGet('/equipment/stats');
  const { mutate } = useApiMutation();

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editItem) {
        await mutate('put', `/equipment/${editItem.id}`, form);
      } else {
        await mutate('post', '/equipment', form);
      }
      setShowModal(false);
      setEditItem(null);
      refetch();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Eliminar aquest equip?')) return;
    await mutate('delete', `/equipment/${id}`);
    refetch();
  };

  const openEdit = (item) => {
    setEditItem(item);
    setForm({
      name: item.name || '',
      serialNumber: item.serialNumber || '',
      category: item.category || 'other',
      brand: item.brand || '',
      model: item.model || '',
      purchasePrice: item.purchasePrice || '',
      status: item.status || 'ACTIVE',
      notes: item.notes || '',
    });
    setShowModal(true);
  };

  const openNew = () => {
    setEditItem(null);
    setForm({ name: '', serialNumber: '', category: 'other', brand: '', model: '', purchasePrice: '', status: 'ACTIVE', notes: '' });
    setShowModal(true);
  };

  const handleExtractBatch = async () => {
    setExtracting(true);
    try {
      const { data: result } = await api.post('/equipment/extract-batch');
      alert(result.message);
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Inventari d'equips</h2>
          {stats && (
            <p className="text-sm text-muted-foreground mt-1">
              {stats.total} equips · Valor total: {formatCurrency(stats.totalValue)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExtractBatch}
            disabled={extracting}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm hover:bg-muted disabled:opacity-50"
          >
            <Sparkles size={14} className={extracting ? 'animate-spin' : ''} />
            {extracting ? 'Extraient...' : 'Extreure de factures'}
          </button>
          <button
            onClick={openNew}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90"
          >
            <Plus size={16} /> Nou equip
          </button>
        </div>
      </div>

      {/* Estadístiques per categoria */}
      {stats?.byCategory?.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {stats.byCategory.map((c) => {
            const cat = CATEGORY_LABELS[c.category] || CATEGORY_LABELS.other;
            return (
              <button
                key={c.category}
                onClick={() => { setCategoryFilter(categoryFilter === c.category ? '' : c.category); setPage(1); }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  categoryFilter === c.category ? 'ring-2 ring-primary ring-offset-1' : ''
                } ${cat.color}`}
              >
                {cat.label} ({c.count})
              </button>
            );
          })}
        </div>
      )}

      {/* Filtres */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Cercar per nom, S/N, marca o model..."
            className="w-full pl-10 pr-4 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Tots els estats</option>
          <option value="ACTIVE">Actius</option>
          <option value="SOLD">Venuts</option>
          <option value="BROKEN">Avariats</option>
          <option value="LOST">Perduts</option>
        </select>
      </div>

      {/* Taula */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Equip</th>
              <th className="text-left p-3 font-medium">S/N</th>
              <th className="text-center p-3 font-medium">Categoria</th>
              <th className="text-left p-3 font-medium">Proveïdor</th>
              <th className="text-left p-3 font-medium">Factura</th>
              <th className="text-right p-3 font-medium">Preu</th>
              <th className="text-center p-3 font-medium">Estat</th>
              <th className="text-right p-3 font-medium">Accions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Carregant...</td></tr>
            ) : !data?.data?.length ? (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Cap equip trobat</td></tr>
            ) : (
              data.data.map((item) => {
                const cat = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.other;
                const st = STATUS_LABELS[item.status] || STATUS_LABELS.ACTIVE;
                return (
                  <tr key={item.id} className="border-t hover:bg-muted/30">
                    <td className="p-3">
                      <div className="font-medium">{item.name}</div>
                      {(item.brand || item.model) && (
                        <div className="text-xs text-muted-foreground">{[item.brand, item.model].filter(Boolean).join(' ')}</div>
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs">{item.serialNumber || '—'}</td>
                    <td className="p-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${cat.color}`}>{cat.label}</span>
                    </td>
                    <td className="p-3 text-muted-foreground text-xs">{item.supplier?.name || '—'}</td>
                    <td className="p-3 text-xs">
                      {item.receivedInvoice ? (
                        <div className="flex items-center gap-1.5">
                          <div>
                            <span className="text-muted-foreground">{item.receivedInvoice.invoiceNumber}</span>
                            <span className="ml-1 text-muted-foreground/60">{formatDate(item.receivedInvoice.issueDate)}</span>
                          </div>
                          {item.receivedInvoice.gdriveFileId && (
                            <a
                              href={`https://drive.google.com/file/d/${item.receivedInvoice.gdriveFileId}/view`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:text-blue-700 shrink-0"
                              title="Obrir factura al Drive"
                            >
                              <ExternalLink size={13} />
                            </a>
                          )}
                        </div>
                      ) : '—'}
                    </td>
                    <td className="p-3 text-right font-medium">{item.purchasePrice ? formatCurrency(item.purchasePrice) : '—'}</td>
                    <td className="p-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${st.color}`}>{st.label}</span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(item)} className="p-1.5 rounded hover:bg-muted text-muted-foreground"><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(item.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {data?.pagination?.totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t text-sm">
            <span className="text-muted-foreground">{data.pagination.total} equips</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1 rounded border disabled:opacity-50">Anterior</button>
              <span className="px-3 py-1">{page} / {data.pagination.totalPages}</span>
              <button onClick={() => setPage(Math.min(data.pagination.totalPages, page + 1))} disabled={page >= data.pagination.totalPages} className="px-3 py-1 rounded border disabled:opacity-50">Següent</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal crear/editar */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditItem(null); }} title={editItem ? 'Editar equip' : 'Nou equip'}>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Nom/Descripció *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required placeholder="Sony PXW-FX6 Full Frame Cinema Camera" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Marca</label>
              <input type="text" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Sony" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <input type="text" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="PXW-FX6" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Número de sèrie</label>
              <input type="text" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono" placeholder="S/N 1234567" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Categoria</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {Object.entries(CATEGORY_LABELS).map(([key, { label }]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Preu compra</label>
              <input type="number" step="0.01" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Estat</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {Object.entries(STATUS_LABELS).map(([key, { label }]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => { setShowModal(false); setEditItem(null); }} className="px-4 py-2 rounded-md border text-sm">Cancel·lar</button>
            <button type="submit" className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium">Guardar</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
