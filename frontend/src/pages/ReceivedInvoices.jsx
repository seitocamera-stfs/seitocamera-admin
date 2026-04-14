import { useState } from 'react';
import {
  Plus, Search, Trash2, Check, X as XIcon,
  FileText, Upload, Eye, Link2, AlertTriangle,
  ChevronRight, Paperclip, Pencil,
} from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import { StatusBadge } from '../components/shared/StatusBadge';
import Modal from '../components/shared/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import api from '../lib/api';
import ExportButtons from '../components/shared/ExportButtons';
import SortableHeader from '../components/shared/SortableHeader';

// Etiquetes de la font d'entrada
const SOURCE_LABELS = {
  MANUAL: { label: 'Manual', color: 'bg-gray-100 text-gray-700' },
  EMAIL_WITH_PDF: { label: 'Email+PDF', color: 'bg-blue-100 text-blue-700' },
  EMAIL_NO_PDF: { label: 'Email', color: 'bg-amber-100 text-amber-700' },
  GDRIVE_SYNC: { label: 'GDrive', color: 'bg-green-100 text-green-700' },
  BANK_DETECTED: { label: 'Banc', color: 'bg-orange-100 text-orange-700' },
};

// Badge de conciliació
function ConciliationBadge({ conciliation }) {
  if (!conciliation) return <span className="text-xs text-muted-foreground">—</span>;

  if (conciliation.status === 'CONFIRMED') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">
        <Link2 size={10} /> Conciliada
      </span>
    );
  }
  if (conciliation.status === 'PENDING_CONFIRM') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700" title={`Confiança: ${Math.round((conciliation.confidence || 0) * 100)}%`}>
        <Link2 size={10} /> Per confirmar
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-50 text-red-500">
      <XIcon size={10} /> Sense conciliar
    </span>
  );
}

export default function ReceivedInvoices() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [conciliatedFilter, setConciliatedFilter] = useState('');
  const [sortBy, setSortBy] = useState('issueDate');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [uploadFile, setUploadFile] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [form, setForm] = useState({
    invoiceNumber: '', supplierId: '', issueDate: '', dueDate: '',
    subtotal: '', taxRate: '21', taxAmount: '', totalAmount: '', description: '',
  });

  const params = {
    search: search || undefined,
    status: statusFilter || undefined,
    source: sourceFilter || undefined,
    conciliated: conciliatedFilter || undefined,
    page,
    limit: 25,
  };
  const { data, loading, refetch } = useApiGet('/invoices/received', params);
  const { data: suppliersData } = useApiGet('/suppliers', { limit: 100 });
  const { mutate } = useApiMutation();

  // Ordenació
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
        case 'supplier':
          valA = (a.supplier?.name || '').toLowerCase();
          valB = (b.supplier?.name || '').toLowerCase();
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
        case 'source':
          valA = a.source || '';
          valB = b.source || '';
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

  // Càlcul IVA automàtic
  const calcTax = (subtotal, rate) => {
    const s = parseFloat(subtotal) || 0;
    const r = parseFloat(rate) || 0;
    const tax = s * r / 100;
    return { taxAmount: tax.toFixed(2), totalAmount: (s + tax).toFixed(2) };
  };

  const handleSubtotalChange = (val) => {
    const { taxAmount, totalAmount } = calcTax(val, form.taxRate);
    setForm({ ...form, subtotal: val, taxAmount, totalAmount });
  };

  // Guardar factura nova (amb check de duplicats)
  const handleSave = async (e, forceDuplicate = false) => {
    e?.preventDefault();
    try {
      const body = {
        ...form,
        subtotal: parseFloat(form.subtotal),
        taxRate: parseFloat(form.taxRate),
        taxAmount: parseFloat(form.taxAmount),
        totalAmount: parseFloat(form.totalAmount),
      };
      if (forceDuplicate) body.forceDuplicate = true;

      await mutate('post', '/invoices/received', body);
      setShowModal(false);
      setShowDuplicateWarning(null);
      refetch();
    } catch (err) {
      // Si és un duplicat, mostrar avís
      if (err.message?.includes('duplicat') || err.message?.includes('DUPLICATE')) {
        try {
          const response = await api.post('/invoices/received', {
            ...form,
            subtotal: parseFloat(form.subtotal),
            taxRate: parseFloat(form.taxRate),
            taxAmount: parseFloat(form.taxAmount),
            totalAmount: parseFloat(form.totalAmount),
          });
        } catch (dupErr) {
          const data = dupErr.response?.data;
          if (data?.code === 'DUPLICATE_INVOICE') {
            setShowDuplicateWarning(data);
            return;
          }
        }
      }
      alert(err.message);
    }
  };

  // Forçar creació de duplicat
  const handleForceDuplicate = async () => {
    try {
      await mutate('post', '/invoices/received', {
        ...form,
        subtotal: parseFloat(form.subtotal),
        taxRate: parseFloat(form.taxRate),
        taxAmount: parseFloat(form.taxAmount),
        totalAmount: parseFloat(form.totalAmount),
        forceDuplicate: true,
      });
      setShowModal(false);
      setShowDuplicateWarning(null);
      refetch();
    } catch (err) {
      alert(err.message);
    }
  };

  // Veure PDF
  const handleViewPdf = async (inv) => {
    setSelectedInvoice(inv);
    try {
      const { data } = await api.get(`/invoices/received/${inv.id}/pdf`);
      if (data.type === 'redirect') {
        setPdfUrl(data.url);
      }
    } catch {
      // Si retorna el fitxer directament, construir URL
      setPdfUrl(`${api.defaults.baseURL}/invoices/received/${inv.id}/pdf`);
    }
    setShowPdfModal(true);
  };

  // Adjuntar PDF a factura existent
  const handleAttachPdf = async (e) => {
    e.preventDefault();
    if (!uploadFile || !selectedInvoice) return;

    const formData = new FormData();
    formData.append('file', uploadFile);

    try {
      await api.post(`/invoices/received/${selectedInvoice.id}/attach-pdf`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setShowUploadModal(false);
      setUploadFile(null);
      setSelectedInvoice(null);
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error pujant PDF');
    }
  };

  const openEditModal = (inv) => {
    setEditForm({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber || '',
      supplierId: inv.supplierId || '',
      issueDate: inv.issueDate ? new Date(inv.issueDate).toISOString().slice(0, 10) : '',
      dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : '',
      subtotal: inv.subtotal || '',
      taxRate: inv.taxRate || '21',
      taxAmount: inv.taxAmount || '',
      totalAmount: inv.totalAmount || '',
      description: inv.description || '',
    });
    setShowEditModal(true);
  };

  const handleEditSave = async (e) => {
    e.preventDefault();
    try {
      const { id, ...data } = editForm;
      await mutate('put', `/invoices/received/${id}`, {
        ...data,
        subtotal: parseFloat(data.subtotal) || 0,
        taxRate: parseFloat(data.taxRate) || 21,
        taxAmount: parseFloat(data.taxAmount) || 0,
        totalAmount: parseFloat(data.totalAmount) || 0,
        supplierId: data.supplierId || null,
      });
      setShowEditModal(false);
      setEditForm(null);
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error guardant');
    }
  };

  const handleEditCalc = (field, value) => {
    const updated = { ...editForm, [field]: value };
    if (field === 'subtotal' || field === 'taxRate') {
      const s = parseFloat(field === 'subtotal' ? value : updated.subtotal) || 0;
      const r = parseFloat(field === 'taxRate' ? value : updated.taxRate) || 0;
      updated.taxAmount = (s * r / 100).toFixed(2);
      updated.totalAmount = (s + s * r / 100).toFixed(2);
    }
    setEditForm(updated);
  };

  const handleStatusChange = async (id, status) => {
    await mutate('patch', `/invoices/received/${id}/status`, { status });
    refetch();
  };

  const handleDelete = async (id) => {
    if (!confirm('Eliminar aquesta factura?')) return;
    await mutate('delete', `/invoices/received/${id}`);
    refetch();
  };

  const resetForm = () => {
    setForm({ invoiceNumber: '', supplierId: '', issueDate: '', dueDate: '', subtotal: '', taxRate: '21', taxAmount: '', totalAmount: '', description: '' });
    setShowDuplicateWarning(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Factures rebudes</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.pagination?.total || 0} factures en total
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportButtons
            endpoint="/export/received-invoices"
            filters={{ search: search || undefined, status: statusFilter || undefined, source: sourceFilter || undefined, conciliated: conciliatedFilter || undefined }}
            filenameBase="factures-rebudes"
          />
          <button onClick={() => { resetForm(); setShowModal(true); }} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
            <Plus size={16} /> Nova factura
          </button>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Cercar per número, descripció o proveïdor..." className="w-full pl-10 pr-4 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Tots els estats</option>
          <option value="PENDING">Pendent</option>
          <option value="PDF_PENDING">Falta PDF</option>
          <option value="APPROVED">Aprovada</option>
          <option value="PAID">Pagada</option>
          <option value="REJECTED">Rebutjada</option>
        </select>
        <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Totes les fonts</option>
          <option value="MANUAL">Manual</option>
          <option value="EMAIL_WITH_PDF">Email+PDF</option>
          <option value="EMAIL_NO_PDF">Email</option>
          <option value="PCLOUD_SYNC">pCloud</option>
          <option value="BANK_DETECTED">Banc</option>
        </select>
        <select value={conciliatedFilter} onChange={(e) => { setConciliatedFilter(e.target.value); setPage(1); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Conciliació: totes</option>
          <option value="true">Conciliades</option>
          <option value="false">Sense conciliar</option>
        </select>
      </div>

      {/* Taula */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <SortableHeader label="Número" field="invoiceNumber" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Proveïdor" field="supplier" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Data" field="issueDate" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Import" field="totalAmount" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Estat" field="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Font" field="source" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <th className="text-center p-3 font-medium text-xs text-muted-foreground uppercase">Banc</th>
              <th className="text-center p-3 font-medium text-xs text-muted-foreground uppercase">PDF</th>
              <th className="text-right p-3 font-medium text-xs text-muted-foreground uppercase">Accions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Carregant...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Cap factura trobada</td></tr>
            ) : (
              sortedData.map((inv) => {
                const src = SOURCE_LABELS[inv.source] || SOURCE_LABELS.MANUAL;
                return (
                  <tr key={inv.id} className={`border-t hover:bg-muted/30 ${inv.isDuplicate ? 'bg-amber-50/50' : ''}`}>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <span className="font-medium">{inv.invoiceNumber}</span>
                        {inv.isDuplicate && (
                          <AlertTriangle size={14} className="text-amber-500" title="Possible duplicat" />
                        )}
                      </div>
                    </td>
                    <td className="p-3">{inv.supplier?.name}</td>
                    <td className="p-3 text-muted-foreground">{formatDate(inv.issueDate)}</td>
                    <td className="p-3 text-right font-medium">{formatCurrency(inv.totalAmount)}</td>
                    <td className="p-3 text-center"><StatusBadge status={inv.status} /></td>
                    <td className="p-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${src.color}`}>
                        {src.label}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <ConciliationBadge conciliation={inv.conciliation} />
                    </td>
                    <td className="p-3 text-center">
                      {inv.hasPdf ? (
                        <button onClick={() => handleViewPdf(inv)} className="p-1 rounded hover:bg-blue-50 text-blue-600" title="Veure PDF">
                          <Eye size={16} />
                        </button>
                      ) : (
                        <button onClick={() => { setSelectedInvoice(inv); setShowUploadModal(true); }} className="p-1 rounded hover:bg-amber-50 text-amber-600" title="Adjuntar PDF">
                          <Upload size={16} />
                        </button>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEditModal(inv)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Editar"><Pencil size={14} /></button>
                        {inv.status === 'PENDING' && (
                          <>
                            <button onClick={() => handleStatusChange(inv.id, 'APPROVED')} className="p-1.5 rounded hover:bg-green-50 text-green-600" title="Aprovar"><Check size={14} /></button>
                            <button onClick={() => handleStatusChange(inv.id, 'REJECTED')} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Rebutjar"><XIcon size={14} /></button>
                          </>
                        )}
                        <button onClick={() => handleDelete(inv.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive" title="Eliminar"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t text-sm">
            <span className="text-muted-foreground">{data.pagination.total} factures</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1 rounded border disabled:opacity-50">Anterior</button>
              <span className="px-3 py-1">{page} / {data.pagination.totalPages}</span>
              <button onClick={() => setPage(Math.min(data.pagination.totalPages, page + 1))} disabled={page >= data.pagination.totalPages} className="px-3 py-1 rounded border disabled:opacity-50">Següent</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Nova factura */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setShowDuplicateWarning(null); }} title="Nova factura rebuda" size="lg">
        {showDuplicateWarning ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={20} />
              <div>
                <p className="font-medium text-amber-800">Possible duplicat detectat</p>
                <p className="text-sm text-amber-700 mt-1">
                  Ja existeix la factura <strong>{showDuplicateWarning.existing?.invoiceNumber}</strong> amb
                  import <strong>{formatCurrency(showDuplicateWarning.existing?.totalAmount)}</strong> i
                  estat <strong>{showDuplicateWarning.existing?.status}</strong>.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDuplicateWarning(null)} className="px-4 py-2 rounded-md border text-sm">Tornar a editar</button>
              <button onClick={handleForceDuplicate} className="px-4 py-2 rounded-md bg-amber-500 text-white text-sm font-medium hover:bg-amber-600">Crear igualment</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Número factura *</label>
                <input type="text" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Proveïdor *</label>
                <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required>
                  <option value="">Selecciona...</option>
                  {suppliersData?.data?.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Data emissió *</label>
                <input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Data venciment</label>
                <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Base imposable *</label>
                <input type="number" step="0.01" value={form.subtotal} onChange={(e) => handleSubtotalChange(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">% IVA</label>
                <input type="number" step="0.01" value={form.taxRate} onChange={(e) => { const { taxAmount, totalAmount } = calcTax(form.subtotal, e.target.value); setForm({ ...form, taxRate: e.target.value, taxAmount, totalAmount }); }} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">IVA</label>
                <input type="number" step="0.01" value={form.taxAmount} readOnly className="w-full rounded-md border bg-muted px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Total</label>
                <input type="number" step="0.01" value={form.totalAmount} readOnly className="w-full rounded-md border bg-muted px-3 py-2 text-sm font-bold" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">Descripció</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Si no adjuntes PDF, la factura es crearà com a "Falta PDF" amb un recordatori automàtic.</p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md border text-sm">Cancel·lar</button>
              <button type="submit" className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium">Guardar</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Preview PDF */}
      <Modal isOpen={showPdfModal} onClose={() => { setShowPdfModal(false); setPdfUrl(null); }} title={`PDF — ${selectedInvoice?.invoiceNumber || ''}`} size="xl">
        {pdfUrl ? (
          <div className="h-[70vh]">
            <iframe src={pdfUrl} className="w-full h-full rounded border" title="Preview PDF" />
          </div>
        ) : (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            <FileText size={32} className="mr-2" />
            <span>Carregant PDF...</span>
          </div>
        )}
      </Modal>

      {/* Modal: Adjuntar PDF */}
      <Modal isOpen={showUploadModal} onClose={() => { setShowUploadModal(false); setUploadFile(null); }} title={`Adjuntar PDF — ${selectedInvoice?.invoiceNumber || ''}`}>
        <form onSubmit={handleAttachPdf} className="space-y-4">
          <div className="border-2 border-dashed border-muted rounded-lg p-8 text-center">
            <Paperclip size={32} className="mx-auto mb-3 text-muted-foreground" />
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setUploadFile(e.target.files[0])}
              className="block mx-auto text-sm"
            />
            {uploadFile && (
              <p className="text-sm text-green-600 mt-2">{uploadFile.name}</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowUploadModal(false)} className="px-4 py-2 rounded-md border text-sm">Cancel·lar</button>
            <button type="submit" disabled={!uploadFile} className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">Pujar PDF</button>
          </div>
        </form>
      </Modal>

      {/* Modal: Editar factura */}
      <Modal isOpen={showEditModal} onClose={() => { setShowEditModal(false); setEditForm(null); }} title="Editar factura rebuda" size="lg">
        {editForm && (
          <form onSubmit={handleEditSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Número factura *</label>
                <input type="text" value={editForm.invoiceNumber} onChange={(e) => setEditForm({ ...editForm, invoiceNumber: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Proveïdor</label>
                <select value={editForm.supplierId} onChange={(e) => setEditForm({ ...editForm, supplierId: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="">— Sense proveïdor —</option>
                  {suppliersData?.data?.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Data emissió *</label>
                <input type="date" value={editForm.issueDate} onChange={(e) => setEditForm({ ...editForm, issueDate: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Data venciment</label>
                <input type="date" value={editForm.dueDate} onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Base imposable</label>
                <input type="number" step="0.01" value={editForm.subtotal} onChange={(e) => handleEditCalc('subtotal', e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">% IVA</label>
                <input type="number" step="0.01" value={editForm.taxRate} onChange={(e) => handleEditCalc('taxRate', e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">IVA</label>
                <input type="number" step="0.01" value={editForm.taxAmount} onChange={(e) => setEditForm({ ...editForm, taxAmount: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm bg-muted/30" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Total *</label>
                <input type="number" step="0.01" value={editForm.totalAmount} onChange={(e) => setEditForm({ ...editForm, totalAmount: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm font-semibold" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Descripció</label>
              <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" rows={2} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 rounded-md border text-sm">Cancel·lar</button>
              <button type="submit" className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium">Guardar</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
