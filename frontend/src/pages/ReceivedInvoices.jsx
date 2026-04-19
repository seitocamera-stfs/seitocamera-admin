import { useState, useEffect } from 'react';
import {
  Plus, Search, Trash2, Check, X as XIcon,
  FileText, Upload, Eye, Link2, AlertTriangle, Ban,
  ChevronRight, Paperclip, Pencil, RefreshCw,
} from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import { StatusBadge } from '../components/shared/StatusBadge';
import Modal from '../components/shared/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import api from '../lib/api';
import ExportButtons from '../components/shared/ExportButtons';
import SortableHeader from '../components/shared/SortableHeader';

// Ruta GDrive calculada a partir de la data de factura
function getGdrivePath(inv) {
  if (!inv.gdriveFileId) return null;
  if (!inv.issueDate) return 'inbox/';
  const d = new Date(inv.issueDate);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  const mm = month.toString().padStart(2, '0');
  return `${year}/T${quarter}/${mm}/`;
}

// Etiquetes de la font d'entrada
const SOURCE_LABELS = {
  MANUAL: { label: 'Manual', color: 'bg-gray-100 text-gray-700' },
  EMAIL_WITH_PDF: { label: 'Email+PDF', color: 'bg-blue-100 text-blue-700' },
  EMAIL_NO_PDF: { label: 'Email', color: 'bg-amber-100 text-amber-700' },
  GDRIVE_SYNC: { label: 'GDrive', color: 'bg-green-100 text-green-700' },
  BANK_DETECTED: { label: 'Banc', color: 'bg-orange-100 text-orange-700' },
};

// Badge de pagament (basat en conciliació amb moviments bancaris)
function PaymentBadge({ isPaid, conciliation }) {
  if (isPaid) {
    const bankInfo = conciliation?.bankMovement;
    const isAuto = conciliation?.status === 'AUTO_MATCHED';
    const title = bankInfo
      ? `${isAuto ? 'Pagament detectat automàticament' : 'Pagat'}: ${bankInfo.description || ''} (${bankInfo.date ? new Date(bankInfo.date).toLocaleDateString('ca-ES') : ''})`
      : 'Pagada';
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700" title={title}>
        <Check size={10} /> Pagada
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-50 text-red-500">
      <XIcon size={10} /> No pagada
    </span>
  );
}

// Secció d'equips dins el modal d'edició de factura
function EquipmentSection({ invoiceId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    if (!invoiceId) return;
    api.get(`/equipment?invoiceId=${invoiceId}&limit=100`)
      .then(({ data }) => setItems(data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [invoiceId]);

  const handleExtract = async () => {
    setExtracting(true);
    try {
      const { data } = await api.post(`/equipment/extract/${invoiceId}`, { force: items.length > 0 });
      if (data.items?.length > 0) {
        setItems((prev) => [...prev, ...data.items]);
      }
      alert(data.message || `${data.items?.length || 0} equips extrets`);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setExtracting(false);
    }
  };

  if (loading) return null;

  return (
    <div className="border-t pt-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Paperclip size={14} /> Equips ({items.length})
        </label>
        <button
          type="button"
          onClick={handleExtract}
          disabled={extracting}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs hover:bg-muted disabled:opacity-50"
        >
          {extracting ? (
            <><FileText size={12} className="animate-pulse" /> Extraient...</>
          ) : (
            <><FileText size={12} /> {items.length > 0 ? 'Re-extreure equips' : 'Extreure equips del PDF'}</>
          )}
        </button>
      </div>
      {items.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {items.map((eq) => (
            <div key={eq.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-muted/50 text-xs">
              <div>
                <span className="font-medium">{eq.name}</span>
                {eq.serialNumber && <span className="ml-2 font-mono text-muted-foreground">S/N: {eq.serialNumber}</span>}
              </div>
              {eq.purchasePrice && <span className="text-muted-foreground">{formatCurrency(eq.purchasePrice)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReceivedInvoices() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [paidFilter, setPaidFilter] = useState('');
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
  const [selectedIds, setSelectedIds] = useState([]);
  const [showTrash, setShowTrash] = useState(false);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierForm, setNewSupplierForm] = useState({ name: '', nif: '', email: '' });
  const [newSupplierLoading, setNewSupplierLoading] = useState(false);
  const [tempSupplier, setTempSupplier] = useState(null);
  const [form, setForm] = useState({
    invoiceNumber: '', supplierId: '', issueDate: '', dueDate: '',
    subtotal: '', taxRate: '21', taxAmount: '', totalAmount: '', description: '',
  });

  const params = {
    search: search || undefined,
    status: statusFilter || undefined,
    source: sourceFilter || undefined,
    paid: paidFilter || undefined,
    deleted: showTrash ? 'true' : undefined,
    page,
    limit: 25,
  };
  const { data, loading, refetch } = useApiGet('/invoices/received', params);
  const { data: suppliersData, refetch: refetchSuppliers } = useApiGet('/suppliers', { limit: 500 });
  const { mutate } = useApiMutation();

  // Llista de proveïdors amb el temporal inclòs (per evitar que el select quedi buit)
  const suppliersList = (() => {
    const list = suppliersData?.data || [];
    if (tempSupplier && !list.find((s) => s.id === tempSupplier.id)) {
      return [...list, tempSupplier].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  })();

  // Netejar tempSupplier quan el refetch ja l'ha inclòs a la llista real
  useEffect(() => {
    if (tempSupplier && suppliersData?.data?.find((s) => s.id === tempSupplier.id)) {
      setTempSupplier(null);
    }
  }, [suppliersData, tempSupplier]);

  // Ordenació
  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  // Gestió selecció
  const toggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = sortedData.map((inv) => inv.id);
    const allSelected = visibleIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const clearSelection = () => setSelectedIds([]);

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
    setPdfUrl(null);
    setShowPdfModal(true);
    try {
      const response = await api.get(`/invoices/received/${inv.id}/pdf`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch (err) {
      console.error('Error carregant PDF:', err);
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
    setRescanResult(null);
    setRelocateResult(null);
    setEditPdfUrl(null);
    setShowEditPdf(false);
    setEditForm({
      id: inv.id,
      currentStatus: inv.status,
      currentInvoiceNumber: inv.invoiceNumber || '', // número original per detectar DUP
      hasPdf: !!inv.filePath || !!inv.gdriveFileId || inv.hasPdf,
      gdriveFileId: inv.gdriveFileId || null,
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

  // Crear proveïdor nou des del formulari inline
  const handleCreateSupplier = async (targetForm = 'edit') => {
    if (!newSupplierForm.name.trim()) return;
    setNewSupplierLoading(true);
    try {
      const newSupplier = await mutate('post', '/suppliers', newSupplierForm);
      // mutate retorna directament l'objecte supplier { id, name, ... }
      const newId = newSupplier?.id;
      if (!newId) {
        console.error('No s\'ha obtingut ID del nou proveïdor:', newSupplier);
        alert('Error: no s\'ha pogut obtenir l\'ID del proveïdor creat');
        return;
      }

      // Guardar referència temporal perquè aparegui al select immediatament
      setTempSupplier({ id: newId, name: newSupplierForm.name.trim() });

      // Assignar el nou proveïdor al formulari actiu
      if (targetForm === 'edit' && editForm) {
        setEditForm((prev) => ({ ...prev, supplierId: newId }));
      } else {
        setForm((prev) => ({ ...prev, supplierId: newId }));
      }

      setShowNewSupplier(false);
      setNewSupplierForm({ name: '', nif: '', email: '' });

      // Refetch — només netejar tempSupplier si el refetch ha anat bé
      // i el nou proveïdor realment apareix a la llista
      try {
        await refetchSuppliers();
        // Nota: no netejem tempSupplier aquí; el suppliersList ja el filtra
        // si existeix a la llista real. Així mai desapareix del dropdown.
      } catch {
        // Si falla el refetch, tempSupplier segueix actiu — cap problema
      }
    } catch (err) {
      alert(err.message || 'Error creant proveïdor');
    } finally {
      setNewSupplierLoading(false);
    }
  };

  const handleEditSave = async (e, forceOverwrite = false) => {
    e?.preventDefault();
    try {
      const { id, currentStatus, ...data } = editForm;
      // Validació bàsica
      if (!data.invoiceNumber?.trim()) return alert('El número de factura és obligatori');
      if (!data.issueDate) return alert('La data d\'emissió és obligatòria');

      const payload = {
        invoiceNumber: data.invoiceNumber.trim(),
        description: data.description || null,
        subtotal: parseFloat(data.subtotal) || 0,
        taxRate: parseFloat(data.taxRate) || 21,
        taxAmount: parseFloat(data.taxAmount) || 0,
        totalAmount: parseFloat(data.totalAmount) || 0,
        supplierId: data.supplierId || null,
        issueDate: data.issueDate,
        dueDate: data.dueDate || null,
      };
      if (forceOverwrite) payload.forceOverwrite = true;

      await mutate('put', `/invoices/received/${id}`, payload);

      // Si era PDF_PENDING o AMOUNT_PENDING, al guardar l'edició passa a PENDING (ja revisada)
      if (currentStatus === 'PDF_PENDING' || currentStatus === 'AMOUNT_PENDING') {
        await mutate('patch', `/invoices/received/${id}/status`, { status: 'PENDING' });
      }
      setShowEditModal(false);
      setEditForm(null);
      refetch();
    } catch (err) {
      const errData = err.response?.data;
      // Si és duplicat, preguntar si vol sobreescriure
      if (errData?.code === 'DUPLICATE_INVOICE') {
        const isDup = editForm.invoiceNumber?.includes('-DUP-') ||
          editForm.currentInvoiceNumber?.includes('-DUP-');
        if (isDup) {
          // La factura actual és un DUP — oferir fusionar (eliminar la DUP)
          if (confirm(
            `${errData.error}\n\n` +
            `Aquesta factura és un duplicat. Vols FUSIONAR?\n` +
            `→ S'eliminarà aquesta entrada duplicada\n` +
            `→ Es mantindrà la factura original`
          )) {
            try {
              const { id, currentStatus, ...data } = editForm;
              const mergePayload = {
                invoiceNumber: data.invoiceNumber.trim(),
                totalAmount: parseFloat(data.totalAmount) || 0,
                subtotal: parseFloat(data.subtotal) || 0,
                taxRate: parseFloat(data.taxRate) || 21,
                taxAmount: parseFloat(data.taxAmount) || 0,
                issueDate: data.issueDate,
                description: data.description || null,
                supplierId: data.supplierId || null,
                mergeDuplicate: true,
              };
              await mutate('put', `/invoices/received/${id}`, mergePayload);
              setShowEditModal(false);
              setEditForm(null);
              refetch();
            } catch (mergeErr) {
              alert(mergeErr.response?.data?.error || 'Error fusionant');
            }
            return;
          }
        } else {
          if (confirm(`${errData.error}\n\nVols guardar igualment?`)) {
            handleEditSave(null, true);
          }
        }
        return;
      }
      const msg = errData?.error || err.message || 'Error guardant';
      alert(msg);
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

  // Re-escanejar PDF: rellegir i extreure totes les dades
  const [rescanning, setRescanning] = useState(false);
  const [rescanResult, setRescanResult] = useState(null);

  // Previsualització PDF dins el modal d'edició
  const [showEditPdf, setShowEditPdf] = useState(false);
  const [editPdfUrl, setEditPdfUrl] = useState(null);
  const [editPdfLoading, setEditPdfLoading] = useState(false);

  const handleToggleEditPdf = async () => {
    if (showEditPdf) {
      // Tancar
      setShowEditPdf(false);
      if (editPdfUrl) { window.URL.revokeObjectURL(editPdfUrl); setEditPdfUrl(null); }
      return;
    }
    // Obrir i carregar
    setShowEditPdf(true);
    if (editPdfUrl) return; // ja carregat
    setEditPdfLoading(true);
    try {
      const response = await api.get(`/invoices/received/${editForm.id}/pdf`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      setEditPdfUrl(window.URL.createObjectURL(blob));
    } catch {
      setEditPdfUrl(null);
    } finally {
      setEditPdfLoading(false);
    }
  };

  const handleRescan = async () => {
    if (!editForm?.id) return;
    setRescanning(true);
    setRescanResult(null);
    try {
      const { data: scan } = await api.post(`/invoices/received/${editForm.id}/rescan`);
      setRescanResult(scan);

      // Omplir el formulari amb les dades detectades (només si s'han trobat)
      const updates = {};
      if (scan.invoiceNumber) updates.invoiceNumber = scan.invoiceNumber;
      if (scan.invoiceDate) updates.issueDate = new Date(scan.invoiceDate).toISOString().slice(0, 10);
      if (scan.totalAmount) updates.totalAmount = String(scan.totalAmount);
      if (scan.subtotal) updates.subtotal = String(scan.subtotal);
      if (scan.taxRate) updates.taxRate = String(scan.taxRate);
      if (scan.taxAmount) updates.taxAmount = String(scan.taxAmount);
      if (scan.matchedSupplier?.id) updates.supplierId = scan.matchedSupplier.id;

      setEditForm((prev) => ({ ...prev, ...updates }));
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Error re-escanejant';
      setRescanResult({ error: msg });
    } finally {
      setRescanning(false);
    }
  };

  const [relocating, setRelocating] = useState(false);
  const [relocateResult, setRelocateResult] = useState(null);

  const handleRelocate = async () => {
    if (!editForm?.id || !editForm?.hasPdf) return;
    if (!editForm.issueDate) { alert('Cal una data per reubicar'); return; }
    setRelocating(true);
    setRelocateResult(null);
    try {
      const { data } = await api.post(`/invoices/received/${editForm.id}/relocate`, {
        issueDate: editForm.issueDate,
      });
      setRelocateResult(data);
    } catch (err) {
      setRelocateResult({ error: err.response?.data?.error || err.message });
    } finally {
      setRelocating(false);
    }
  };

  const handleStatusChange = async (id, status) => {
    await mutate('patch', `/invoices/received/${id}/status`, { status });
    refetch();
  };

  const handleDelete = async (id) => {
    if (!confirm('Moure a la paperera? (Es pot restaurar durant 30 dies)')) return;
    await mutate('delete', `/invoices/received/${id}`);
    refetch();
  };

  // Eliminar múltiples factures seleccionades (moure a paperera)
  const handleBulkDelete = async () => {
    if (!confirm(`Moure ${selectedIds.length} factures a la paperera?`)) return;
    try {
      for (const id of selectedIds) {
        await mutate('delete', `/invoices/received/${id}`);
      }
      setSelectedIds([]);
      refetch();
    } catch (err) {
      alert(err.message || 'Error eliminant factures');
      refetch();
    }
  };

  const handleRestore = async (id) => {
    await mutate('post', `/invoices/received/${id}/restore`);
    refetch();
  };

  const handlePermanentDelete = async (id) => {
    if (!confirm('ELIMINAR DEFINITIVAMENT? Aquesta acció NO es pot desfer.')) return;
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
          <h2 className="text-2xl font-bold">{showTrash ? '🗑️ Paperera' : 'Factures rebudes'}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.pagination?.total || 0} {showTrash ? 'factures a la paperera' : 'factures en total'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportButtons
            endpoint="/export/received-invoices"
            filters={{ search: search || undefined, status: statusFilter || undefined, source: sourceFilter || undefined, paid: paidFilter || undefined }}
            filenameBase="factures-rebudes"
            selectedIds={selectedIds}
          />
          <button onClick={() => { setShowTrash(!showTrash); setPage(1); }} className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border ${showTrash ? 'bg-destructive text-destructive-foreground' : 'hover:bg-muted'}`}>
            <Trash2 size={16} /> {showTrash ? 'Tornar a factures' : 'Paperera'}
          </button>
          {!showTrash && (
            <button onClick={() => { resetForm(); setShowModal(true); }} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
              <Plus size={16} /> Nova factura
            </button>
          )}
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); clearSelection(); }} placeholder="Cercar per número, descripció o proveïdor..." className="w-full pl-10 pr-4 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); clearSelection(); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Tots els estats</option>
          <option value="PENDING">Pendent</option>
          <option value="PDF_PENDING">Cal revisar</option>
          <option value="APPROVED">Aprovada</option>
          <option value="PAID">Pagada</option>
          <option value="REJECTED">Rebutjada</option>
          <option value="NOT_INVOICE">No és factura</option>
        </select>
        <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); clearSelection(); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Totes les fonts</option>
          <option value="MANUAL">Manual</option>
          <option value="EMAIL_WITH_PDF">Email+PDF</option>
          <option value="EMAIL_NO_PDF">Email</option>
          <option value="PCLOUD_SYNC">pCloud</option>
          <option value="BANK_DETECTED">Banc</option>
        </select>
        <select value={paidFilter} onChange={(e) => { setPaidFilter(e.target.value); setPage(1); clearSelection(); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Pagament: totes</option>
          <option value="true">Pagades</option>
          <option value="false">No pagades</option>
        </select>
      </div>

      {/* Barra de selecció */}
      {selectedIds.length > 0 && (
        <div className="mb-3 flex items-center justify-between bg-teal-50 border border-teal-200 rounded-lg px-4 py-2">
          <span className="text-sm text-teal-800">
            <strong>{selectedIds.length}</strong> factures seleccionades
          </span>
          <div className="flex items-center gap-3">
            {!showTrash && (
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-xs font-medium hover:opacity-90"
              >
                <Trash2 size={13} /> Moure a la paperera
              </button>
            )}
            <button
              onClick={clearSelection}
              className="text-xs text-teal-700 hover:text-teal-900 underline"
            >
              Netejar selecció
            </button>
          </div>
        </div>
      )}

      {/* Taula */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 w-10">
                <input
                  type="checkbox"
                  checked={sortedData.length > 0 && sortedData.every((inv) => selectedIds.includes(inv.id))}
                  onChange={toggleSelectAllVisible}
                  className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                  title="Seleccionar totes les visibles"
                />
              </th>
              <SortableHeader label="Número" field="invoiceNumber" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Proveïdor" field="supplier" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Data" field="issueDate" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Import" field="totalAmount" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Estat" field="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Font" field="source" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <th className="p-3 font-medium text-xs text-muted-foreground uppercase">Ubicació GDrive</th>
              <th className="text-center p-3 font-medium text-xs text-muted-foreground uppercase">Comptabilitat</th>
              <th className="text-center p-3 font-medium text-xs text-muted-foreground uppercase">Pagament</th>
              <th className="text-center p-3 font-medium text-xs text-muted-foreground uppercase">PDF</th>
              <th className="text-right p-3 font-medium text-xs text-muted-foreground uppercase">Accions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="p-8 text-center text-muted-foreground">Carregant...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={12} className="p-8 text-center text-muted-foreground">Cap factura trobada</td></tr>
            ) : (
              sortedData.map((inv) => {
                const src = SOURCE_LABELS[inv.source] || SOURCE_LABELS.MANUAL;
                const isSelected = selectedIds.includes(inv.id);
                return (
                  <tr
                    key={inv.id}
                    className={`border-t hover:bg-muted/30 ${isSelected ? 'bg-teal-50/60' : inv.isDuplicate ? 'bg-amber-50/50' : ''}`}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(inv.id)}
                        className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                      />
                    </td>
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
                    <td className="p-3">
                      {inv.gdriveFileId ? (
                        <a
                          href={`https://drive.google.com/file/d/${inv.gdriveFileId}/view`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                          title={inv.originalFileName || 'Obrir a GDrive'}
                        >
                          <Link2 size={12} />
                          {getGdrivePath(inv)}
                        </a>
                      ) : inv.filePath ? (
                        <span className="text-xs text-muted-foreground" title={inv.filePath}>📁 Local</span>
                      ) : (
                        <span className="text-xs text-red-500">⚠ Sense PDF</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {inv.pgcAccount ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${inv.accountingType === 'INVESTMENT' ? 'bg-purple-100 text-purple-700' : 'bg-sky-100 text-sky-700'}`} title={`${inv.pgcAccount} ${inv.pgcAccountName || ''}`}>
                          {inv.pgcAccount}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <PaymentBadge isPaid={inv.isPaid} conciliation={inv.conciliation} />
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
                        {/* PDF_PENDING: cal revisar → marcar com a Pendent (revisada) */}
                        {inv.status === 'PDF_PENDING' && (
                          <button onClick={() => handleStatusChange(inv.id, 'PENDING')} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Marcar com revisada"><Check size={14} /></button>
                        )}
                        {/* PENDING o REVIEWED: es pot aprovar o rebutjar */}
                        {(inv.status === 'PENDING' || inv.status === 'REVIEWED') && (
                          <>
                            <button onClick={() => handleStatusChange(inv.id, 'APPROVED')} className="p-1.5 rounded hover:bg-green-50 text-green-600" title="Aprovar"><Check size={14} /></button>
                            <button onClick={() => handleStatusChange(inv.id, 'REJECTED')} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Rebutjar"><XIcon size={14} /></button>
                          </>
                        )}
                        {/* APPROVED: es pot marcar com pagada */}
                        {inv.status === 'APPROVED' && (
                          <button onClick={() => handleStatusChange(inv.id, 'PAID')} className="p-1.5 rounded hover:bg-emerald-50 text-emerald-700" title="Marcar com pagada">€</button>
                        )}
                        {/* REJECTED: es pot reobrir */}
                        {inv.status === 'REJECTED' && (
                          <button onClick={() => handleStatusChange(inv.id, 'PENDING')} className="p-1.5 rounded hover:bg-yellow-50 text-yellow-600" title="Reobrir">↩</button>
                        )}
                        {inv.status !== 'NOT_INVOICE' && !showTrash && (
                          <button onClick={() => handleStatusChange(inv.id, 'NOT_INVOICE')} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Marcar com 'no és factura'"><Ban size={14} /></button>
                        )}
                        {inv.status === 'NOT_INVOICE' && !showTrash && (
                          <button onClick={() => handleStatusChange(inv.id, 'PENDING')} className="p-1.5 rounded hover:bg-yellow-50 text-yellow-600" title="Tornar a marcar com a factura">↩</button>
                        )}
                        {showTrash ? (
                          <>
                            <button onClick={() => handleRestore(inv.id)} className="p-1.5 rounded hover:bg-green-50 text-green-600" title="Restaurar">↩</button>
                            <button onClick={() => handlePermanentDelete(inv.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive" title="Eliminar definitivament"><Trash2 size={14} /></button>
                          </>
                        ) : (
                          <button onClick={() => handleDelete(inv.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive" title="Eliminar"><Trash2 size={14} /></button>
                        )}
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
              <button onClick={() => { setPage(Math.max(1, page - 1)); clearSelection(); }} disabled={page === 1} className="px-3 py-1 rounded border disabled:opacity-50">Anterior</button>
              <span className="px-3 py-1">{page} / {data.pagination.totalPages}</span>
              <button onClick={() => { setPage(Math.min(data.pagination.totalPages, page + 1)); clearSelection(); }} disabled={page >= data.pagination.totalPages} className="px-3 py-1 rounded border disabled:opacity-50">Següent</button>
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
                <div className="flex gap-2">
                  <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} className="flex-1 min-w-0 rounded-md border bg-background px-3 py-2 text-sm" required>
                    <option value="">Selecciona...</option>
                    {suppliersList.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => { setShowNewSupplier(true); setNewSupplierForm({ name: '', nif: '', email: '' }); }} className="shrink-0 px-2.5 py-2 rounded-md border bg-background text-sm hover:bg-muted" title="Nou proveïdor">
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>
            {showNewSupplier && (
              <div className="p-3 border rounded-md bg-muted/30 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Nou proveïdor</p>
                <div className="grid grid-cols-3 gap-2">
                  <input type="text" placeholder="Nom *" value={newSupplierForm.name} onChange={(e) => setNewSupplierForm({ ...newSupplierForm, name: e.target.value })} className="w-full rounded-md border bg-background px-3 py-1.5 text-sm" autoFocus />
                  <input type="text" placeholder="NIF" value={newSupplierForm.nif} onChange={(e) => setNewSupplierForm({ ...newSupplierForm, nif: e.target.value })} className="w-full rounded-md border bg-background px-3 py-1.5 text-sm" />
                  <input type="email" placeholder="Email" value={newSupplierForm.email} onChange={(e) => setNewSupplierForm({ ...newSupplierForm, email: e.target.value })} className="w-full rounded-md border bg-background px-3 py-1.5 text-sm" />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowNewSupplier(false)} className="px-3 py-1.5 rounded-md border text-xs">Cancel·lar</button>
                  <button type="button" onClick={() => handleCreateSupplier('create')} disabled={!newSupplierForm.name.trim() || newSupplierLoading} className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50">
                    {newSupplierLoading ? 'Creant...' : 'Crear'}
                  </button>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
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
      <Modal isOpen={showPdfModal} onClose={() => { setShowPdfModal(false); if (pdfUrl) window.URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }} title={`PDF — ${selectedInvoice?.invoiceNumber || ''}`} size="xl">
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
            {/* Botons: previsualitzar PDF + re-escanejar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {editForm.hasPdf && (
                  <button
                    type="button"
                    onClick={handleToggleEditPdf}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm font-medium transition-colors ${showEditPdf ? 'bg-blue-50 border-blue-300 text-blue-700' : 'hover:bg-muted'}`}
                  >
                    <Eye size={15} />
                    {showEditPdf ? 'Amagar PDF' : 'Veure PDF'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleRescan}
                  disabled={rescanning || !editForm.hasPdf}
                  className="flex items-center gap-2 px-3 py-2 rounded-md border text-sm font-medium hover:bg-muted disabled:opacity-50 transition-colors"
                  title={!editForm.hasPdf ? 'Aquesta factura no té PDF' : ''}
                >
                  <RefreshCw size={15} className={rescanning ? 'animate-spin' : ''} />
                  {rescanning ? 'Escanejant...' : 'Re-escanejar'}
                </button>
                {editForm.hasPdf && editForm.gdriveFileId && (
                  <button
                    type="button"
                    onClick={handleRelocate}
                    disabled={relocating}
                    className="flex items-center gap-2 px-3 py-2 rounded-md border text-sm font-medium hover:bg-amber-50 hover:border-amber-300 disabled:opacity-50 transition-colors"
                    title="Mou el PDF a la carpeta GDrive correcta segons la data"
                  >
                    📂
                    {relocating ? 'Movent...' : 'Reubicar GDrive'}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {rescanResult && !rescanResult.error && (
                  <span className={`text-xs flex items-center gap-1 ${rescanResult.documentType?.type && rescanResult.documentType.type !== 'invoice' && rescanResult.documentType.type !== 'unknown' ? 'text-amber-600' : 'text-green-600'}`}>
                    {rescanResult.documentType?.type && rescanResult.documentType.type !== 'invoice' && rescanResult.documentType.type !== 'unknown' ? (
                      <><AlertTriangle size={13} /> Detectat: {rescanResult.documentType.label}</>
                    ) : (
                      <><Check size={13} /> Dades actualitzades{rescanResult.ocrUsed ? ' (via OCR)' : ''}</>
                    )}
                  </span>
                )}
                {relocateResult && !relocateResult.error && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <Check size={13} />
                    Mogut a {relocateResult.newPath}
                  </span>
                )}
                {relocateResult?.error && (
                  <span className="text-xs text-red-600">{relocateResult.error}</span>
                )}
              </div>
            </div>

            {/* Previsualització PDF inline */}
            {showEditPdf && (
              <div className="rounded-md border overflow-hidden bg-muted/20">
                {editPdfLoading ? (
                  <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                    <FileText size={20} className="mr-2 animate-pulse" /> Carregant PDF...
                  </div>
                ) : editPdfUrl ? (
                  <iframe src={editPdfUrl} className="w-full h-[45vh] rounded" title="Preview PDF" />
                ) : (
                  <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                    No s'ha pogut carregar el PDF
                  </div>
                )}
              </div>
            )}

            {/* Resultat del rescan */}
            {rescanResult?.error && (
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
                <AlertTriangle size={16} />
                <span>{rescanResult.error}</span>
              </div>
            )}
            {rescanResult && !rescanResult.error && (
              <div className="p-2.5 rounded-md bg-blue-50 border border-blue-200 text-sm space-y-1">
                <p className="font-medium text-blue-800 mb-1">Dades detectades al PDF:</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-blue-700 text-xs">
                  <span>Número: <strong>{rescanResult.invoiceNumber || '—'}</strong></span>
                  <span>Import: <strong>{rescanResult.totalAmount ? formatCurrency(rescanResult.totalAmount) : '—'}</strong></span>
                  <span>Data: <strong>{rescanResult.invoiceDate ? formatDate(rescanResult.invoiceDate) : '—'}</strong></span>
                  <span>Proveïdor: <strong>{rescanResult.matchedSupplier?.name || rescanResult.supplierName || '—'}</strong></span>
                  {rescanResult.nifCif?.length > 0 && (
                    <span className="col-span-2">NIF detectats: <strong>{rescanResult.nifCif.join(', ')}</strong></span>
                  )}
                  {rescanResult.isDuplicate && (
                    <span className="col-span-2 text-amber-700">
                      <AlertTriangle size={12} className="inline mr-1" />
                      Possible duplicat de {rescanResult.duplicateInvoice?.invoiceNumber}
                    </span>
                  )}
                  {rescanResult.documentType && (
                    <span className={`col-span-2 font-medium ${rescanResult.documentType.type !== 'invoice' && rescanResult.documentType.type !== 'unknown' ? 'text-red-600' : 'text-green-700'}`}>
                      Tipus document: <strong>{rescanResult.documentType.label}</strong>
                      {rescanResult.documentType.confidence > 0 && ` (confiança: ${Math.round(rescanResult.documentType.confidence * 100)}%)`}
                      {rescanResult.documentType.type !== 'invoice' && rescanResult.documentType.type !== 'unknown' && (
                        <> — <AlertTriangle size={12} className="inline mx-0.5" />No és una factura!</>
                      )}
                    </span>
                  )}
                  {rescanResult.baseAmount > 0 && (
                    <span>Base imposable: <strong>{formatCurrency(rescanResult.baseAmount)}</strong></span>
                  )}
                </div>
                {/* Debug: línies del PDF amb paraules clau */}
                {rescanResult.debugLines?.length > 0 && (
                  <details className="mt-1.5">
                    <summary className="text-xs text-blue-500 cursor-pointer">Línies rellevants del PDF ({rescanResult.debugLines.length})</summary>
                    <pre className="mt-1 text-[10px] leading-tight text-blue-600 bg-blue-100/50 rounded p-1.5 max-h-32 overflow-auto whitespace-pre-wrap">{rescanResult.debugLines.join('\n')}</pre>
                  </details>
                )}
              </div>
            )}

            {editForm.currentStatus === 'PDF_PENDING' && (
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <AlertTriangle size={16} />
                <span>Aquesta factura necessita revisió. En guardar passarà a &quot;Pendent&quot;.</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Número factura *</label>
                <input type="text" value={editForm.invoiceNumber} onChange={(e) => setEditForm({ ...editForm, invoiceNumber: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Proveïdor</label>
                <div className="flex gap-2">
                  <select value={editForm.supplierId} onChange={(e) => setEditForm({ ...editForm, supplierId: e.target.value })} className="flex-1 min-w-0 rounded-md border bg-background px-3 py-2 text-sm">
                    <option value="">— Sense proveïdor —</option>
                    {suppliersList.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => { setShowNewSupplier(true); setNewSupplierForm({ name: '', nif: '', email: '' }); }} className="shrink-0 px-2.5 py-2 rounded-md border bg-background text-sm hover:bg-muted" title="Nou proveïdor">
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>
            {showNewSupplier && (
              <div className="p-3 border rounded-md bg-muted/30 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Nou proveïdor</p>
                <div className="grid grid-cols-3 gap-2">
                  <input type="text" placeholder="Nom *" value={newSupplierForm.name} onChange={(e) => setNewSupplierForm({ ...newSupplierForm, name: e.target.value })} className="w-full rounded-md border bg-background px-3 py-1.5 text-sm" autoFocus />
                  <input type="text" placeholder="NIF" value={newSupplierForm.nif} onChange={(e) => setNewSupplierForm({ ...newSupplierForm, nif: e.target.value })} className="w-full rounded-md border bg-background px-3 py-1.5 text-sm" />
                  <input type="email" placeholder="Email" value={newSupplierForm.email} onChange={(e) => setNewSupplierForm({ ...newSupplierForm, email: e.target.value })} className="w-full rounded-md border bg-background px-3 py-1.5 text-sm" />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowNewSupplier(false)} className="px-3 py-1.5 rounded-md border text-xs">Cancel·lar</button>
                  <button type="button" onClick={() => handleCreateSupplier('edit')} disabled={!newSupplierForm.name.trim() || newSupplierLoading} className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50">
                    {newSupplierLoading ? 'Creant...' : 'Crear'}
                  </button>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
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
            {/* Secció equips extrets */}
            {editForm.id && (
              <EquipmentSection invoiceId={editForm.id} />
            )}
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
