import { useState, useEffect, useMemo } from 'react';
import {
  Plus, Search, Trash2, Check, X as XIcon, CheckCircle,
  FileText, Upload, Eye, Link2, AlertTriangle, Ban, Package, Sparkles, CreditCard,
  ChevronRight, Paperclip, Pencil, RefreshCw, GitMerge, Split, Send, BookText,
  Mail, AlertCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
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
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [paidFilter, setPaidFilter] = useState('');
  const [sortBy, setSortBy] = useState('issueDate');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
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
  const [showAlerts, setShowAlerts] = useState(false);
  const [bulkRescanRunning, setBulkRescanRunning] = useState(false);
  const [bulkRescanResult, setBulkRescanResult] = useState(null);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierForm, setNewSupplierForm] = useState({ name: '', nif: '', email: '' });
  const [newSupplierLoading, setNewSupplierLoading] = useState(false);
  const [tempSupplier, setTempSupplier] = useState(null);
  // Modal "Sync Zohomail" — repassar correu en un rang de dates
  const [showZohoRescan, setShowZohoRescan] = useState(false);
  const [zohoRescanForm, setZohoRescanForm] = useState(() => {
    // Default: últims 7 dies. Les carpetes s'auto-omplen quan es carrega la
    // llista real del Zoho (useEffect més avall) — auto-marca les que tenen
    // "factura"/"invoice"/"rebuda" al nom.
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const fmt = (d) => d.toISOString().slice(0, 10);
    return {
      from: fmt(weekAgo),
      to: fmt(today),
      ignoreProcessed: false,
      folders: [],
    };
  });

  // Carrega la llista real de carpetes Zoho quan s'obre el modal
  const { data: zohoFoldersData, loading: foldersLoading } = useApiGet(
    showZohoRescan ? '/zoho/folders' : null
  );
  const zohoFolders = useMemo(() => {
    const list = zohoFoldersData?.data || [];
    // Filtra carpetes "Sent", "Drafts", "Trash", etc. — només safates entrants
    return list.filter((f) => {
      const n = (f.folderName || '').toLowerCase();
      const p = (f.path || '').toLowerCase();
      const isSystemOut = /sent|enviat|drafts|borrad|trash|paperera|spam|junk/.test(n + ' ' + p);
      return !isSystemOut;
    });
  }, [zohoFoldersData]);

  // Auto-detect la carpeta principal de factures
  const isInvoiceFolder = (f) => /factur|invoice|rebud/i.test((f.folderName || '') + ' ' + (f.path || ''));

  // Auto-marca les carpetes de factures la primera vegada que es carreguen
  useEffect(() => {
    if (!showZohoRescan || zohoFolders.length === 0) return;
    if (zohoRescanForm.folders.length > 0) return; // l'usuari ja ha tocat alguna cosa
    const invoiceOnes = zohoFolders.filter(isInvoiceFolder);
    if (invoiceOnes.length > 0) {
      setZohoRescanForm((prev) => ({
        ...prev,
        folders: invoiceOnes.map((f) => f.path || f.folderName),
      }));
    }
  }, [zohoFolders, showZohoRescan]); // eslint-disable-line react-hooks/exhaustive-deps
  const [zohoRescanRunning, setZohoRescanRunning] = useState(false);
  const [zohoRescanResult, setZohoRescanResult] = useState(null);

  const [showDriveAudit, setShowDriveAudit] = useState(false);
  const [driveAuditData, setDriveAuditData] = useState(null);
  const [driveAuditLoading, setDriveAuditLoading] = useState(false);
  const [driveFixRunning, setDriveFixRunning] = useState(false);
  const [showDateAudit, setShowDateAudit] = useState(false);
  const [dateAuditData, setDateAuditData] = useState(null);
  const [dateAuditLoading, setDateAuditLoading] = useState(false);
  const [dateFixRunning, setDateFixRunning] = useState(false);
  const [form, setForm] = useState({
    invoiceNumber: '', supplierId: '', issueDate: '', dueDate: '',
    subtotal: '', taxRate: '21', taxAmount: '', totalAmount: '', description: '',
  });

  const params = {
    search: search || undefined,
    status: statusFilter || undefined,
    source: sourceFilter || undefined,
    paid: paidFilter || undefined,
    dateFrom: yearFilter ? `${yearFilter}-01-01` : undefined,
    dateTo: yearFilter ? `${yearFilter}-12-31` : undefined,
    deleted: showTrash ? 'true' : undefined,
    alerts: showAlerts ? 'true' : undefined,
    sortBy: sortBy || undefined,
    sortOrder: sortBy ? sortDir : undefined,
    page,
    limit: perPage,
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

  // Ordenació (server-side)
  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
    setPage(1);
  };

  // Sync Zohomail — repassa correu en un rang per detectar factures perdudes
  const handleZohoRescan = async () => {
    if (!zohoRescanForm.from || !zohoRescanForm.to) return;
    setZohoRescanRunning(true);
    setZohoRescanResult(null);
    try {
      const { data } = await api.post('/zoho/rescan', {
        from: zohoRescanForm.from,
        to: zohoRescanForm.to,
        ignoreProcessed: zohoRescanForm.ignoreProcessed,
        folders: zohoRescanForm.folders,
      });
      setZohoRescanResult(data);
      // Si hi ha hagut PDFs nous, refrescar la llista
      if (data.stats?.pdfAttached > 0) {
        setTimeout(() => refetch(), 1500);
      }
    } catch (err) {
      setZohoRescanResult({ error: err.response?.data?.error || err.message });
    } finally {
      setZohoRescanRunning(false);
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

  // Dades ja ordenades pel backend
  const sortedData = data?.data || [];

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
      const data = err.response?.data;
      if (data?.code === 'DUPLICATE_INVOICE' || err.message?.includes('duplicat') || err.message?.includes('DUPLICATE')) {
        setShowDuplicateWarning(data || { message: err.message });
        return;
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

  const [duplicateOriginal, setDuplicateOriginal] = useState(null);

  const openEditModal = async (inv) => {
    setRescanResult(null);
    setRelocateResult(null);
    setEditPdfUrl(null);
    setShowEditPdf(false);
    setDuplicateOriginal(null);
    setEditForm({
      id: inv.id,
      currentStatus: inv.status,
      currentInvoiceNumber: inv.invoiceNumber || '',
      hasPdf: !!inv.filePath || !!inv.gdriveFileId || inv.hasPdf,
      gdriveFileId: inv.gdriveFileId || null,
      invoiceNumber: inv.invoiceNumber || '',
      supplierId: inv.supplierId || '',
      issueDate: inv.issueDate ? new Date(inv.issueDate).toISOString().slice(0, 10) : '',
      dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : '',
      subtotal: inv.subtotal || '',
      taxRate: inv.taxRate || '21',
      taxAmount: inv.taxAmount || '',
      irpfRate: inv.irpfRate || '0',
      irpfAmount: inv.irpfAmount || '0',
      totalAmount: inv.totalAmount || '',
      description: inv.description || '',
      isDuplicate: inv.isDuplicate || false,
      duplicateOfId: inv.duplicateOfId || null,
      alerts: inv.alerts || [],
      isShared: inv.isShared || false,
      sharedPercentSeito: inv.sharedPercentSeito ?? 50,
      sharedPercentLogistik: inv.sharedPercentLogistik ?? 50,
    });
    setShowEditModal(true);

    // Si és duplicat o té número DUP, buscar l'original automàticament
    const isDup = inv.isDuplicate || inv.duplicateOfId || (inv.invoiceNumber || '').includes('-DUP-');
    if (isDup) {
      try {
        // Buscar per duplicateOfId directament, o per número sense -DUP-
        if (inv.duplicateOfId) {
          const { data: orig } = await api.get(`/invoices/received/${inv.duplicateOfId}`);
          setDuplicateOriginal(orig);
        } else {
          // Extreure el número base (sense -DUP-xxx)
          const baseNum = (inv.invoiceNumber || '').replace(/-DUP-.*$/, '');
          if (baseNum && baseNum !== inv.invoiceNumber) {
            const { data: searchResult } = await api.get(`/invoices/received`, { search: baseNum, limit: 5 });
            const original = searchResult?.data?.find(i => i.id !== inv.id && i.invoiceNumber === baseNum);
            if (original) setDuplicateOriginal(original);
          }
        }
      } catch (err) {
        // No pasa res si no trobem l'original
      }
    }
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
        irpfRate: parseFloat(data.irpfRate) || 0,
        irpfAmount: parseFloat(data.irpfAmount) || 0,
        totalAmount: parseFloat(data.totalAmount) || 0,
        supplierId: data.supplierId || null,
        issueDate: data.issueDate,
        dueDate: data.dueDate || null,
        isShared: data.isShared || false,
        sharedPercentSeito: parseFloat(data.sharedPercentSeito) || 50,
        sharedPercentLogistik: parseFloat(data.sharedPercentLogistik) || 50,
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
    if (['subtotal', 'taxRate', 'irpfRate'].includes(field)) {
      const s = parseFloat(field === 'subtotal' ? value : updated.subtotal) || 0;
      const r = parseFloat(field === 'taxRate' ? value : updated.taxRate) || 0;
      const irpf = parseFloat(field === 'irpfRate' ? value : updated.irpfRate) || 0;
      updated.taxAmount = (s * r / 100).toFixed(2);
      updated.irpfAmount = (s * irpf / 100).toFixed(2);
      updated.totalAmount = (s + parseFloat(updated.taxAmount) - parseFloat(updated.irpfAmount)).toFixed(2);
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
      if (scan.taxRate !== undefined) updates.taxRate = String(scan.taxRate);
      if (scan.taxAmount) updates.taxAmount = String(scan.taxAmount);
      if (scan.irpfRate) updates.irpfRate = String(scan.irpfRate);
      if (scan.irpfAmount) updates.irpfAmount = String(scan.irpfAmount);
      if (scan.matchedSupplier?.id) {
        updates.supplierId = scan.matchedSupplier.id;
        // Si és un proveïdor nou (auto-creat), refrescar la llista
        if (!suppliersList.find(s => s.id === scan.matchedSupplier.id)) {
          refetchSuppliers();
        }
      }
      if (scan.description && !editForm.description) updates.description = scan.description;

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
    try {
      await mutate('patch', `/invoices/received/${id}/status`, { status });
      refetch();
    } catch (err) {
      alert(err.message || 'Error canviant estat');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Moure a la paperera? (Es pot restaurar durant 30 dies)')) return;
    try {
      await mutate('delete', `/invoices/received/${id}`);
      refetch();
    } catch (err) {
      alert(err.message || 'Error eliminant factura');
    }
  };

  // Re-escanejar múltiples factures seleccionades
  const handleBulkRescan = async () => {
    if (!confirm(`Re-escanejar ${selectedIds.length} factures amb IA? Pot trigar uns segons per factura.`)) return;
    setBulkRescanRunning(true);
    setBulkRescanResult(null);
    try {
      const { data: result } = await api.post('/invoices/received/bulk-rescan', { ids: selectedIds });
      setBulkRescanResult(result);
      setSelectedIds([]);
      refetch();
    } catch (err) {
      setBulkRescanResult({ error: err.response?.data?.error || err.message });
    } finally {
      setBulkRescanRunning(false);
    }
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

  // Extreure equips de múltiples factures
  const [bulkExtractRunning, setBulkExtractRunning] = useState(false);
  const [bulkPostRunning, setBulkPostRunning] = useState(false);
  const [bulkPostResult, setBulkPostResult] = useState(null);
  const [postingId, setPostingId] = useState(null);

  const handlePost = async (id, invoiceNumber) => {
    setPostingId(id);
    try {
      const { data } = await api.post(`/invoice-posting/received/${id}/post`);
      const note = data.resolvedByAgent
        ? `${invoiceNumber} comptabilitzada amb subcompte suggerit per l'agent (revisa al Supervisor)`
        : `${invoiceNumber} comptabilitzada (assentament #${data.journalEntry.entryNumber})`;
      alert(note);
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error en comptabilitzar');
    } finally {
      setPostingId(null);
    }
  };

  const handleUnpost = async (id) => {
    if (!confirm('Anul·lar la comptabilització? Es generarà un assentament d\'inversió.')) return;
    setPostingId(id);
    try {
      await api.post(`/invoice-posting/received/${id}/unpost`);
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error');
    } finally {
      setPostingId(null);
    }
  };

  const handleBulkPost = async () => {
    if (!confirm(`Comptabilitzar ${selectedIds.length} factures? Pot trigar uns minuts si l'agent ha de classificar-ne algunes.`)) return;
    setBulkPostRunning(true);
    setBulkPostResult(null);
    try {
      const { data } = await api.post('/invoice-posting/received/post-bulk', { ids: selectedIds });
      setBulkPostResult(data);
      refetch();
      clearSelection();
    } catch (err) {
      setBulkPostResult({ error: err.response?.data?.error || 'Error' });
    } finally {
      setBulkPostRunning(false);
    }
  };
  const handleBulkExtractEquipment = async () => {
    if (!confirm(`Extreure equips de ${selectedIds.length} factures amb IA? Pot trigar uns segons per factura.`)) return;
    setBulkExtractRunning(true);
    try {
      const { data: result } = await api.post('/invoices/received/bulk-extract-equipment', { ids: selectedIds });
      alert(`Extracció completada: ${result.extracted} factures processades, ${result.totalItems} equips extrets, ${result.skipped} sense text, ${result.errors} errors`);
      setSelectedIds([]);
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setBulkExtractRunning(false);
    }
  };

  // Marcar múltiples factures com a pagades
  const handleBulkMarkPaid = async () => {
    if (!confirm(`Marcar ${selectedIds.length} factures com a pagades?`)) return;
    try {
      const { data: result } = await api.patch('/invoices/received/bulk-mark-paid', { ids: selectedIds });
      alert(result.message);
      setSelectedIds([]);
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
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

  // --- Auditoria Google Drive ---
  const handleDriveAudit = async () => {
    setDriveAuditLoading(true);
    setDriveAuditData(null);
    try {
      const { data } = await api.get('/invoices/gdrive-audit');
      setDriveAuditData(data);
      setShowDriveAudit(true);
    } catch (err) {
      alert('Error auditant Drive: ' + (err.response?.data?.error || err.message));
    } finally {
      setDriveAuditLoading(false);
    }
  };

  const handleDriveFix = async (invoiceIds = null) => {
    if (!confirm(invoiceIds ? `Moure ${invoiceIds.length} fitxers a la carpeta correcta?` : 'Moure TOTS els fitxers mal col·locats a la carpeta correcta?')) return;
    setDriveFixRunning(true);
    try {
      const body = invoiceIds ? { invoiceIds } : {};
      const { data } = await api.post('/invoices/gdrive-audit/fix', body);
      alert(`Fet! ${data.moved} fitxers moguts, ${data.skipped} ja correctes, ${data.errors} errors.`);
      // Refrescar auditoria
      handleDriveAudit();
    } catch (err) {
      alert('Error corregint: ' + (err.response?.data?.error || err.message));
    } finally {
      setDriveFixRunning(false);
    }
  };

  // --- Auditoria Dates BD vs PDF ---
  const handleDateAudit = async () => {
    setDateAuditLoading(true);
    setDateAuditData(null);
    try {
      const { data } = await api.get('/invoices/date-audit');
      setDateAuditData(data);
      setShowDateAudit(true);
    } catch (err) {
      alert('Error auditant dates: ' + (err.response?.data?.error || err.message));
    } finally {
      setDateAuditLoading(false);
    }
  };

  const handleDateFix = async (fixes) => {
    if (!confirm(`Corregir ${fixes.length} dates a la base de dades?`)) return;
    setDateFixRunning(true);
    try {
      const { data } = await api.post('/invoices/date-audit/fix', { fixes });
      alert(`Fet! ${data.updated} dates corregides, ${data.errors} errors.`);
      handleDateAudit();
      refetch();
    } catch (err) {
      alert('Error corregint dates: ' + (err.response?.data?.error || err.message));
    } finally {
      setDateFixRunning(false);
    }
  };

  const resetForm = () => {
    setForm({ invoiceNumber: '', supplierId: '', issueDate: '', dueDate: '', subtotal: '', taxRate: '21', taxAmount: '', totalAmount: '', description: '' });
    setShowDuplicateWarning(null);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">{showTrash ? '🗑️ Paperera' : showAlerts ? '⚠️ Alertes' : 'Factures rebudes'}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.pagination?.total || 0} {showTrash ? 'factures a la paperera' : showAlerts ? 'factures amb alertes' : 'factures en total'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportButtons
            endpoint="/export/received-invoices"
            filters={{ search: search || undefined, status: statusFilter || undefined, source: sourceFilter || undefined, paid: paidFilter || undefined }}
            filenameBase="factures-rebudes"
            selectedIds={selectedIds}
          />
          {/* Botons Auditoria Drive i Dates eliminats — ja no calen */}
          <button
            onClick={() => { setZohoRescanResult(null); setShowZohoRescan(true); }}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border hover:bg-muted"
            title="Repassar el correu per detectar factures que potser s'han perdut"
          >
            <Mail size={16} /> Sync Zohomail
          </button>
          <button onClick={() => { setShowAlerts(!showAlerts); setShowTrash(false); setPage(1); }} className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border ${showAlerts ? 'bg-amber-500 text-white' : 'hover:bg-muted'}`}>
            <AlertTriangle size={16} /> {showAlerts ? 'Tornar a factures' : 'Alertes'}
          </button>
          <button onClick={() => { setShowTrash(!showTrash); setShowAlerts(false); setPage(1); }} className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border ${showTrash ? 'bg-destructive text-destructive-foreground' : 'hover:bg-muted'}`}>
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
          <option value="PENDING_ALL">Pendents</option>
          <option value="APPROVED">Aprovades</option>
          <option value="PAID">Pagades</option>
          <option value="REJECTED">Rebutjades</option>
          <option value="NOT_INVOICE">No és factura</option>
        </select>
        <select value={paidFilter} onChange={(e) => { setPaidFilter(e.target.value); setPage(1); clearSelection(); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Pagament: totes</option>
          <option value="true">Pagades</option>
          <option value="false">No pagades</option>
        </select>
        <select value={yearFilter} onChange={(e) => { setYearFilter(e.target.value ? parseInt(e.target.value) : ''); setPage(1); clearSelection(); }} className="rounded-md border bg-background px-3 py-2 text-sm font-medium">
          <option value="">Tots els anys</option>
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
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
              <>
                <button
                  onClick={handleBulkRescan}
                  disabled={bulkRescanRunning}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 disabled:opacity-50"
                >
                  <RefreshCw size={13} className={bulkRescanRunning ? 'animate-spin' : ''} />
                  {bulkRescanRunning ? 'Re-escanejant...' : 'Re-escanejar'}
                </button>
                <button
                  onClick={handleBulkExtractEquipment}
                  disabled={bulkExtractRunning}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50"
                >
                  <Sparkles size={13} className={bulkExtractRunning ? 'animate-spin' : ''} />
                  {bulkExtractRunning ? 'Extraient...' : 'Extreure equips'}
                </button>
                <button
                  onClick={handleBulkMarkPaid}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-600 text-white text-xs font-medium hover:bg-green-700"
                >
                  <CreditCard size={13} /> Marcar pagada
                </button>
                <button
                  onClick={handleBulkPost}
                  disabled={bulkPostRunning}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                  title="Generar l'assentament comptable per cada factura seleccionada"
                >
                  <Send size={13} className={bulkPostRunning ? 'animate-pulse' : ''} />
                  {bulkPostRunning ? 'Comptabilitzant...' : 'Comptabilitzar'}
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-xs font-medium hover:opacity-90"
                >
                  <Trash2 size={13} /> Paperera
                </button>
              </>
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

      {/* Resultat del bulk post */}
      {bulkPostResult && (
        <div className={`mb-3 rounded-lg border p-3 ${bulkPostResult.error ? 'bg-red-50 border-red-200' : 'bg-indigo-50 border-indigo-200'}`}>
          {bulkPostResult.error ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-red-700">Error: {bulkPostResult.error}</span>
              <button onClick={() => setBulkPostResult(null)} className="text-red-500 hover:text-red-700"><XIcon size={16} /></button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-indigo-800">
                  Comptabilització: {bulkPostResult.ok?.length || 0} OK · {bulkPostResult.failed?.length || 0} fallades · {bulkPostResult.total} totals
                </span>
                <button onClick={() => setBulkPostResult(null)} className="text-indigo-600 hover:text-indigo-800"><XIcon size={16} /></button>
              </div>
              {bulkPostResult.failed?.length > 0 && (
                <details className="text-xs text-red-600">
                  <summary className="cursor-pointer font-medium">{bulkPostResult.failed.length} errors</summary>
                  <ul className="mt-1 space-y-0.5 ml-4">
                    {bulkPostResult.failed.map((d) => (
                      <li key={d.invoiceId}><strong>{d.invoiceNumber}</strong>: {d.error}</li>
                    ))}
                  </ul>
                </details>
              )}
              {bulkPostResult.ok?.filter((o) => o.resolvedByAgent).length > 0 && (
                <p className="text-xs text-indigo-700">
                  {bulkPostResult.ok.filter((o) => o.resolvedByAgent).length} factures classificades per l'agent — revisa-ho a Agent IA → Supervisor.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Resultat del bulk rescan */}
      {bulkRescanResult && (
        <div className={`mb-3 rounded-lg border p-3 ${bulkRescanResult.error ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
          {bulkRescanResult.error ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-red-700">Error: {bulkRescanResult.error}</span>
              <button onClick={() => setBulkRescanResult(null)} className="text-red-500 hover:text-red-700"><XIcon size={16} /></button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-green-800">
                  Re-scan completat: {bulkRescanResult.updated} actualitzades, {bulkRescanResult.processed - bulkRescanResult.updated - bulkRescanResult.errors} sense canvis, {bulkRescanResult.skipped} sense PDF, {bulkRescanResult.errors} errors
                </span>
                <button onClick={() => setBulkRescanResult(null)} className="text-green-600 hover:text-green-800"><XIcon size={16} /></button>
              </div>
              {bulkRescanResult.details?.filter(d => d.status === 'updated').length > 0 && (
                <details className="text-xs text-green-700">
                  <summary className="cursor-pointer font-medium">Detall de {bulkRescanResult.details.filter(d => d.status === 'updated').length} actualitzades</summary>
                  <ul className="mt-1 space-y-0.5 ml-4">
                    {bulkRescanResult.details.filter(d => d.status === 'updated').map(d => (
                      <li key={d.id}>
                        <strong>{d.num}</strong>: {d.changes?.join(', ')} {d.aiExtracted && <span className="text-teal-600">(AI)</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {bulkRescanResult.details?.filter(d => d.status === 'error').length > 0 && (
                <details className="text-xs text-red-600">
                  <summary className="cursor-pointer font-medium">{bulkRescanResult.details.filter(d => d.status === 'error').length} errors</summary>
                  <ul className="mt-1 space-y-0.5 ml-4">
                    {bulkRescanResult.details.filter(d => d.status === 'error').map(d => (
                      <li key={d.id}><strong>{d.num}</strong>: {d.reason}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* Taula */}
      <div className="bg-card border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[1200px]">
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
              <SortableHeader label="Data factura" field="issueDate" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Entrada" field="createdAt" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Import" field="totalAmount" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              {/* Estat eliminat — redundant amb Pagament */}
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
              <tr><td colSpan={13} className="p-8 text-center text-muted-foreground">Carregant...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={13} className="p-8 text-center text-muted-foreground">Cap factura trobada</td></tr>
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
                        {inv._count?.equipment > 0 && (
                          <span title={`${inv._count.equipment} equip${inv._count.equipment > 1 ? 's' : ''} a inventari`} className="text-violet-500">
                            <Package size={14} />
                          </span>
                        )}
                        {inv.isShared && (
                          <span title={`Compartida ${inv.sharedPercentSeito || 50}/${inv.sharedPercentLogistik || 50}`} className="text-blue-500">
                            <Split size={14} />
                          </span>
                        )}
                        {inv.isDuplicate && (
                          <AlertTriangle size={14} className="text-amber-500" title="Possible duplicat" />
                        )}
                      </div>
                      {inv.alerts?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {inv.alerts.map((a, i) => (
                            <span key={i} className="inline-block px-1.5 py-0 rounded text-[10px] bg-amber-100 text-amber-700">{a}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="p-3">{inv.supplier?.name || (<span className="text-xs text-red-400 italic">Sense proveïdor</span>)}</td>
                    <td className="p-3 text-muted-foreground">
                      {inv.isDateEstimated ? (
                        <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 text-xs" title="Data NO extreta del PDF — cal revisar manualment. La que es mostra és estimada (data del fitxer al Drive).">
                          <AlertTriangle size={10} /> {formatDate(inv.issueDate)} (estimada)
                        </span>
                      ) : (
                        formatDate(inv.issueDate)
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground text-xs">{formatDate(inv.createdAt)}</td>
                    <td className="p-3 text-right font-medium">{formatCurrency(inv.totalAmount)}</td>
                    {/* Estat eliminat — redundant amb Pagament */}
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
                      {inv.journalEntryId ? (
                        <Link to={`/journal/${inv.journalEntryId}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200" title="Veure assentament">
                          <BookText size={11} /> Comptabilitzada
                        </Link>
                      ) : inv.account ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-sky-100 text-sky-700" title={`${inv.account.code} ${inv.account.name}`}>
                          {inv.account.code}
                        </span>
                      ) : inv.pgcAccount ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${inv.accountingType === 'INVESTMENT' ? 'bg-purple-100 text-purple-700' : 'bg-sky-100 text-sky-700'}`} title={`${inv.pgcAccount} ${inv.pgcAccountName || ''} (legacy)`}>
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
                        {!showTrash && (
                          inv.journalEntryId ? (
                            <button
                              onClick={() => handleUnpost(inv.id)}
                              disabled={postingId === inv.id}
                              className="p-1.5 rounded hover:bg-amber-50 text-amber-700 disabled:opacity-50"
                              title="Anul·lar comptabilització"
                            >
                              <RefreshCw size={14} className={postingId === inv.id ? 'animate-spin' : ''} />
                            </button>
                          ) : (inv.status === 'REVIEWED' || inv.status === 'APPROVED' || inv.status === 'PAID') && inv.origin !== 'LOGISTIK' && (
                            <button
                              onClick={() => handlePost(inv.id, inv.invoiceNumber)}
                              disabled={postingId === inv.id}
                              className="p-1.5 rounded hover:bg-indigo-50 text-indigo-700 disabled:opacity-50"
                              title="Comptabilitzar (genera assentament)"
                            >
                              <Send size={14} className={postingId === inv.id ? 'animate-pulse' : ''} />
                            </button>
                          )
                        )}
                        <button onClick={() => openEditModal(inv)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Editar"><Pencil size={14} /></button>
                        {/* PDF_PENDING o AMOUNT_PENDING: cal revisar → marcar com a Pendent (revisada) */}
                        {(inv.status === 'PDF_PENDING' || inv.status === 'AMOUNT_PENDING') && (
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

        {data?.pagination && (
          <div className="flex items-center justify-between p-3 border-t text-sm">
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground">{data.pagination.total} factures</span>
              <select
                value={perPage}
                onChange={(e) => { setPerPage(parseInt(e.target.value)); setPage(1); clearSelection(); }}
                className="rounded border bg-background px-2 py-1 text-xs"
              >
                <option value={25}>25 / pàg</option>
                <option value={50}>50 / pàg</option>
                <option value={100}>100 / pàg</option>
                <option value={200}>200 / pàg</option>
              </select>
            </div>
            {data.pagination.totalPages > 1 && (
              <div className="flex gap-2">
                <button onClick={() => { setPage(Math.max(1, page - 1)); clearSelection(); }} disabled={page === 1} className="px-3 py-1 rounded border disabled:opacity-50">Anterior</button>
                <span className="px-3 py-1">{page} / {data.pagination.totalPages}</span>
                <button onClick={() => { setPage(Math.min(data.pagination.totalPages, page + 1)); clearSelection(); }} disabled={page >= data.pagination.totalPages} className="px-3 py-1 rounded border disabled:opacity-50">Següent</button>
              </div>
            )}
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
            {/* Banner de duplicat: comparació amb l'original */}
            {(editForm.isDuplicate || editForm.invoiceNumber?.includes('-DUP-') || duplicateOriginal) && (() => {
              // Detectar si és probablement un fals positiu
              const origDate = duplicateOriginal?.issueDate ? new Date(duplicateOriginal.issueDate).toISOString().slice(0, 10) : null;
              const thisDate = editForm.issueDate || null;
              const numbersDiffer = duplicateOriginal && editForm.invoiceNumber && duplicateOriginal.invoiceNumber
                && editForm.invoiceNumber.toLowerCase() !== duplicateOriginal.invoiceNumber.toLowerCase();
              const datesDiffer = duplicateOriginal && origDate && thisDate && origDate !== thisDate;
              const probablyNotDuplicate = numbersDiffer && datesDiffer;

              return (
              <div className={`rounded-lg border-2 p-3 space-y-2 ${probablyNotDuplicate ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
                <div className={`flex items-center gap-2 font-medium text-sm ${probablyNotDuplicate ? 'text-green-800' : 'text-amber-800'}`}>
                  <AlertTriangle size={16} />
                  {probablyNotDuplicate
                    ? 'Probablement NO és duplicat — número i data són diferents'
                    : `Factura duplicada ${duplicateOriginal ? '— original trobada' : '— buscant original...'}`
                  }
                </div>
                {duplicateOriginal && (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className={`font-medium ${probablyNotDuplicate ? 'text-green-700' : 'text-amber-700'}`}>Camp</div>
                      <div className={`font-medium ${probablyNotDuplicate ? 'text-green-700' : 'text-amber-700'}`}>Aquesta</div>
                      <div className="font-medium text-gray-600">Suposada original</div>

                      <div className="text-muted-foreground">Número</div>
                      <div className={numbersDiffer ? 'font-medium text-green-800' : ''}>{editForm.invoiceNumber}</div>
                      <div className={numbersDiffer ? 'font-medium text-green-800' : ''}>{duplicateOriginal.invoiceNumber}</div>

                      <div className="text-muted-foreground">Proveïdor</div>
                      <div>{suppliersList.find(s => s.id === editForm.supplierId)?.name || '—'}</div>
                      <div>{duplicateOriginal.supplier?.name || '—'}</div>

                      <div className="text-muted-foreground">Import</div>
                      <div className={String(editForm.totalAmount) !== String(duplicateOriginal.totalAmount) ? 'font-medium text-amber-800' : ''}>{formatCurrency(editForm.totalAmount)}</div>
                      <div>{formatCurrency(duplicateOriginal.totalAmount)}</div>

                      <div className="text-muted-foreground">Data</div>
                      <div className={datesDiffer ? 'font-medium text-green-800' : ''}>{editForm.issueDate || '—'}</div>
                      <div className={datesDiffer ? 'font-medium text-green-800' : ''}>{origDate || '—'}</div>

                      <div className="text-muted-foreground">Estat</div>
                      <div>{editForm.currentStatus}</div>
                      <div>{duplicateOriginal.status}</div>
                    </div>
                    <div className="flex gap-2 pt-1 flex-wrap">
                      {/* Botó principal: Desmarcar com a duplicat */}
                      <button
                        type="button"
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium ${
                          probablyNotDuplicate
                            ? 'bg-green-600 text-white hover:bg-green-700'
                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                        }`}
                        onClick={async () => {
                          try {
                            await mutate('post', `/invoices/received/${editForm.id}/unmark-duplicate`);
                            setEditForm(prev => ({ ...prev, isDuplicate: false }));
                            setDuplicateOriginal(null);
                            refetch();
                          } catch (err) {
                            alert(err.response?.data?.error || 'Error desmarcant duplicat');
                          }
                        }}
                      >
                        <CheckCircle size={12} /> No és duplicat
                      </button>
                      {!probablyNotDuplicate && (
                        <>
                          <button
                            type="button"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 text-xs font-medium"
                            onClick={async () => {
                              if (!confirm(`Eliminar AQUESTA factura (${editForm.invoiceNumber}) i quedar-se amb l'original (${duplicateOriginal.invoiceNumber})?`)) return;
                              try {
                                await mutate('delete', `/invoices/received/${editForm.id}`);
                                setShowEditModal(false);
                                setEditForm(null);
                                setDuplicateOriginal(null);
                                refetch();
                              } catch (err) {
                                alert(err.response?.data?.error || 'Error eliminant');
                              }
                            }}
                          >
                            <Trash2 size={12} /> Eliminar aquesta
                          </button>
                          <button
                            type="button"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-medium"
                            onClick={async () => {
                              if (!confirm(`Fusionar: traspassar les dades d'aquesta factura a l'original (${duplicateOriginal.invoiceNumber}) i eliminar aquesta entrada?`)) return;
                              try {
                                await mutate('put', `/invoices/received/${editForm.id}`, {
                                  invoiceNumber: duplicateOriginal.invoiceNumber,
                                  totalAmount: parseFloat(editForm.totalAmount) || 0,
                                  subtotal: parseFloat(editForm.subtotal) || 0,
                                  taxRate: parseFloat(editForm.taxRate) || 21,
                                  taxAmount: parseFloat(editForm.taxAmount) || 0,
                                  issueDate: editForm.issueDate,
                                  supplierId: editForm.supplierId || null,
                                  description: editForm.description || null,
                                  mergeDuplicate: true,
                                });
                                setShowEditModal(false);
                                setEditForm(null);
                                setDuplicateOriginal(null);
                                refetch();
                              } catch (err) {
                                alert(err.response?.data?.error || 'Error fusionant');
                              }
                            }}
                          >
                            <GitMerge size={12} /> Fusionar amb l'original
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs font-medium"
                        onClick={() => {
                          setShowEditModal(false);
                          setEditForm(null);
                          setDuplicateOriginal(null);
                          const origInv = data?.data?.find(i => i.id === duplicateOriginal.id);
                          if (origInv) {
                            openEditModal(origInv);
                          } else {
                            openEditModal({ ...duplicateOriginal, hasPdf: !!duplicateOriginal.filePath || !!duplicateOriginal.gdriveFileId });
                          }
                        }}
                      >
                        <Eye size={12} /> Veure l'original
                      </button>
                    </div>
                  </>
                )}
              </div>
              );
            })()}

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
                      <><Check size={13} /> Dades actualitzades{rescanResult.aiExtracted ? ' (via Claude AI)' : rescanResult.ocrUsed ? ' (via OCR)' : ''}</>
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
                  {rescanResult.isDuplicate && rescanResult.duplicateInvoice && (
                    <div className="col-span-2 mt-1 p-2 rounded-md bg-amber-50 border border-amber-300 text-amber-800 text-xs space-y-1.5">
                      <div className="flex items-center gap-1 font-medium">
                        <AlertTriangle size={13} />
                        Possible duplicat de <strong>{rescanResult.duplicateInvoice.invoiceNumber}</strong>
                        {rescanResult.duplicateInvoice.supplier?.name && (
                          <span className="text-amber-600">({rescanResult.duplicateInvoice.supplier.name})</span>
                        )}
                        {rescanResult.duplicateInvoice.totalAmount > 0 && (
                          <span>— {formatCurrency(rescanResult.duplicateInvoice.totalAmount)}</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="px-2.5 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 text-xs font-medium"
                          onClick={async () => {
                            if (!confirm(`Esborrar aquesta factura (${editForm.invoiceNumber}) i quedar-se amb l'original (${rescanResult.duplicateInvoice.invoiceNumber})?`)) return;
                            try {
                              await mutate('delete', `/invoices/received/${editForm.id}`);
                              setShowEditModal(false);
                              setEditForm(null);
                              refetch();
                            } catch (err) {
                              alert(err.response?.data?.error || 'Error esborrant');
                            }
                          }}
                        >
                          <Trash2 size={11} className="inline mr-1" />
                          Esborrar aquesta
                        </button>
                        <button
                          type="button"
                          className="px-2.5 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-medium"
                          onClick={async () => {
                            if (!confirm(
                              `Fusionar: copiar les dades d'aquesta factura a l'original (${rescanResult.duplicateInvoice.invoiceNumber}) i eliminar aquesta entrada?`
                            )) return;
                            try {
                              // Guardar amb mergeDuplicate per fusionar amb l'original
                              const payload = {
                                invoiceNumber: rescanResult.duplicateInvoice.invoiceNumber,
                                totalAmount: parseFloat(editForm.totalAmount) || 0,
                                subtotal: parseFloat(editForm.subtotal) || 0,
                                taxRate: parseFloat(editForm.taxRate) || 21,
                                taxAmount: parseFloat(editForm.taxAmount) || 0,
                                issueDate: editForm.issueDate,
                                description: editForm.description || null,
                                supplierId: editForm.supplierId || null,
                                mergeDuplicate: true,
                              };
                              await mutate('put', `/invoices/received/${editForm.id}`, payload);
                              setShowEditModal(false);
                              setEditForm(null);
                              refetch();
                            } catch (err) {
                              alert(err.response?.data?.error || 'Error fusionant');
                            }
                          }}
                        >
                          <GitMerge size={11} className="inline mr-1" />
                          Fusionar amb l'original
                        </button>
                      </div>
                    </div>
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
                <label className="block text-sm font-medium mb-1">% IRPF</label>
                <input type="number" step="0.01" value={editForm.irpfRate} onChange={(e) => handleEditCalc('irpfRate', e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="0" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">IRPF</label>
                <input type="number" step="0.01" value={editForm.irpfAmount} onChange={(e) => setEditForm({ ...editForm, irpfAmount: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm bg-muted/30" />
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
            {/* Factura compartida SEITO-LOGISTIK */}
            <div className="p-3 border rounded-md bg-muted/20 space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.isShared || false}
                  onChange={(e) => setEditForm({ ...editForm, isShared: e.target.checked })}
                  className="rounded"
                />
                Compartida SEITO · LOGISTIK
              </label>
              {editForm.isShared && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="text-blue-600 font-medium text-xs">Seito</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={editForm.sharedPercentSeito ?? 50}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value) || 0;
                        setEditForm({ ...editForm, sharedPercentSeito: v, sharedPercentLogistik: 100 - v });
                      }}
                      className="w-16 px-2 py-1 border rounded text-xs text-center"
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-orange-600 font-medium text-xs">Logistik</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={editForm.sharedPercentLogistik ?? 50}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value) || 0;
                        setEditForm({ ...editForm, sharedPercentLogistik: v, sharedPercentSeito: 100 - v });
                      }}
                      className="w-16 px-2 py-1 border rounded text-xs text-center"
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                  {editForm.totalAmount > 0 && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      ({formatCurrency(editForm.totalAmount * (editForm.sharedPercentSeito ?? 50) / 100)} / {formatCurrency(editForm.totalAmount * (editForm.sharedPercentLogistik ?? 50) / 100)})
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Secció equips extrets */}
            {editForm.id && (
              <EquipmentSection invoiceId={editForm.id} />
            )}
            <div className="flex justify-between pt-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm text-red-600 hover:bg-red-50 border border-red-200"
                  onClick={async () => {
                    if (!confirm('Moure a la paperera? (Es pot restaurar durant 30 dies)')) return;
                    try {
                      await mutate('delete', `/invoices/received/${editForm.id}`);
                      setShowEditModal(false);
                      setEditForm(null);
                      refetch();
                    } catch (err) {
                      alert(err.response?.data?.error || 'Error eliminant');
                    }
                  }}
                >
                  <Trash2 size={14} /> Eliminar
                </button>
                {editForm.currentStatus !== 'PAID' ? (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm text-green-700 hover:bg-green-50 border border-green-200"
                    onClick={async () => {
                      if (!confirm(`Marcar la factura ${editForm.invoiceNumber} com a pagada?`)) return;
                      try {
                        await mutate('patch', `/invoices/received/${editForm.id}/status`, { status: 'PAID' });
                        setShowEditModal(false);
                        setEditForm(null);
                        refetch();
                      } catch (err) {
                        alert(err.response?.data?.error || 'Error actualitzant');
                      }
                    }}
                  >
                    <CheckCircle size={14} /> Marcar pagada
                  </button>
                ) : (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm text-amber-700 hover:bg-amber-50 border border-amber-200"
                    onClick={async () => {
                      if (!confirm(`Desmarcar la factura ${editForm.invoiceNumber} com a pagada?`)) return;
                      try {
                        await mutate('patch', `/invoices/received/${editForm.id}/status`, { status: 'APPROVED' });
                        setShowEditModal(false);
                        setEditForm(null);
                        refetch();
                      } catch (err) {
                        alert(err.response?.data?.error || 'Error actualitzant');
                      }
                    }}
                  >
                    <XIcon size={14} /> Desmarcar pagada
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 rounded-md border text-sm">Cancel·lar</button>
                <button type="submit" className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium">Guardar</button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal Auditoria Google Drive */}
      <Modal isOpen={showDriveAudit} onClose={() => setShowDriveAudit(false)} title="Auditoria carpetes Google Drive" size="lg">
        {driveAuditData && (
          <div className="space-y-4">
            {/* Resum */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{driveAuditData.total}</div>
                <div className="text-xs text-muted-foreground">Total fitxers</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-700">{driveAuditData.correct}</div>
                <div className="text-xs text-green-600">Correctes</div>
              </div>
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-amber-700">{driveAuditData.misplaced}</div>
                <div className="text-xs text-amber-600">Mal col·locades</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-700">{driveAuditData.errors}</div>
                <div className="text-xs text-red-600">Errors</div>
              </div>
            </div>

            {/* Llista de mal col·locades */}
            {driveAuditData.misplaced > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Fitxers mal col·locats</h3>
                  <button
                    onClick={() => handleDriveFix()}
                    disabled={driveFixRunning}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={driveFixRunning ? 'animate-spin' : ''} />
                    {driveFixRunning ? 'Movent...' : `Corregir tots (${driveAuditData.misplaced})`}
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Factura</th>
                        <th className="text-left px-3 py-2 font-medium">Proveïdor</th>
                        <th className="text-left px-3 py-2 font-medium">Data factura</th>
                        <th className="text-left px-3 py-2 font-medium">Carpeta actual</th>
                        <th className="text-left px-3 py-2 font-medium">Carpeta correcta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {driveAuditData.details.map((item) => (
                        <tr key={item.invoiceId} className="hover:bg-muted/30">
                          <td className="px-3 py-2 font-mono text-xs">{item.invoiceNumber}</td>
                          <td className="px-3 py-2">{item.supplier || '—'}</td>
                          <td className="px-3 py-2">{new Date(item.issueDate).toLocaleDateString('ca-ES')}</td>
                          <td className="px-3 py-2 text-red-600 text-xs">{item.currentPath}</td>
                          <td className="px-3 py-2 text-green-600 text-xs">{item.expectedPath}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {driveAuditData.misplaced === 0 && (
              <div className="text-center py-8 text-green-600">
                <CheckCircle size={48} className="mx-auto mb-2" />
                <p className="font-medium">Totes les factures estan a la carpeta correcta!</p>
              </div>
            )}

            {/* Errors */}
            {driveAuditData.errors > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold text-sm text-red-600 mb-2">Errors ({driveAuditData.errors})</h3>
                <div className="space-y-1">
                  {driveAuditData.errorDetails.map((e) => (
                    <div key={e.invoiceId} className="text-xs bg-red-50 rounded p-2">
                      <span className="font-mono">{e.invoiceNumber}</span>: {e.error}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Modal Auditoria Dates BD vs PDF */}
      <Modal isOpen={showDateAudit} onClose={() => setShowDateAudit(false)} title="Auditoria dates BD vs PDF real" size="xl">
        {dateAuditData && (
          <div className="space-y-4">
            {/* Resum */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{dateAuditData.total}</div>
                <div className="text-xs text-muted-foreground">Total analitzades</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-700">{dateAuditData.correct}</div>
                <div className="text-xs text-green-600">Dates correctes</div>
              </div>
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-amber-700">{dateAuditData.mismatched}</div>
                <div className="text-xs text-amber-600">Dates incorrectes</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-700">{dateAuditData.errors}</div>
                <div className="text-xs text-red-600">Errors lectura</div>
              </div>
            </div>

            {/* Llista de discrepàncies */}
            {dateAuditData.mismatched > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Factures amb data incorrecta a la BD</h3>
                  <button
                    onClick={() => handleDateFix(dateAuditData.details.map(d => ({ invoiceId: d.invoiceId, newDate: d.pdfDate })))}
                    disabled={dateFixRunning}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={dateFixRunning ? 'animate-spin' : ''} />
                    {dateFixRunning ? 'Corregint...' : `Corregir totes (${dateAuditData.mismatched})`}
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Factura</th>
                        <th className="text-left px-3 py-2 font-medium">Proveïdor</th>
                        <th className="text-left px-3 py-2 font-medium">Import</th>
                        <th className="text-left px-3 py-2 font-medium">Data BD</th>
                        <th className="text-left px-3 py-2 font-medium">Data PDF real</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {dateAuditData.details.map((item) => (
                        <tr key={item.invoiceId} className="hover:bg-muted/30">
                          <td className="px-3 py-2 font-mono text-xs">{item.invoiceNumber}</td>
                          <td className="px-3 py-2">{item.supplier || '—'}</td>
                          <td className="px-3 py-2 text-right">{item.totalAmount ? formatCurrency(item.totalAmount) : '—'}</td>
                          <td className="px-3 py-2 text-red-600">{new Date(item.dbDate).toLocaleDateString('ca-ES')}</td>
                          <td className="px-3 py-2 text-green-600 font-medium">{new Date(item.pdfDate).toLocaleDateString('ca-ES')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {dateAuditData.mismatched === 0 && (
              <div className="text-center py-8 text-green-600">
                <CheckCircle size={48} className="mx-auto mb-2" />
                <p className="font-medium">Totes les dates de la BD coincideixen amb els PDFs!</p>
              </div>
            )}

            {/* Errors */}
            {dateAuditData.errors > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold text-sm text-red-600 mb-2">Errors de lectura ({dateAuditData.errors})</h3>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {dateAuditData.errorDetails.map((e) => (
                    <div key={e.invoiceId} className="text-xs bg-red-50 rounded p-2">
                      <span className="font-mono">{e.invoiceNumber}</span>: {e.error}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Modal Sync Zohomail — repassar correu en un rang de dates */}
      <Modal
        isOpen={showZohoRescan}
        onClose={() => { if (!zohoRescanRunning) { setShowZohoRescan(false); setZohoRescanResult(null); } }}
        title="Sync Zohomail — Repassar correu per rang"
        size="lg"
      >
        <div className="space-y-4">
          {!zohoRescanResult && (
            <>
              <p className="text-sm text-muted-foreground">
                Repassa els correus de les bústies configurades en un rang de dates concret per detectar
                factures que potser s'han perdut (errors de connexió, filtres, classificació errònia).
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Des de *</label>
                  <input
                    type="date"
                    value={zohoRescanForm.from}
                    onChange={(e) => setZohoRescanForm({ ...zohoRescanForm, from: e.target.value })}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    max={zohoRescanForm.to}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Fins a *</label>
                  <input
                    type="date"
                    value={zohoRescanForm.to}
                    onChange={(e) => setZohoRescanForm({ ...zohoRescanForm, to: e.target.value })}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    min={zohoRescanForm.from}
                    max={new Date().toISOString().slice(0, 10)}
                  />
                </div>
              </div>

              {/* Selector dinàmic de carpetes Zoho */}
              <div className="space-y-2 p-3 rounded border bg-blue-50/40 border-blue-200">
                <div className="text-xs font-medium text-blue-900 flex items-center gap-1.5">
                  <Mail size={13} /> Carpetes Zoho a revisar
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Per defecte auto-marquem la carpeta dedicada a factures (★) per fer una
                  passada profunda. Pots marcar altres bústies si vols incloure correus
                  que encara no s'han mogut allà.
                </p>

                {foldersLoading && (
                  <div className="text-[11px] text-muted-foreground text-center py-2">
                    <RefreshCw size={11} className="inline animate-spin mr-1" /> Carregant carpetes del Zoho…
                  </div>
                )}

                {!foldersLoading && zohoFolders.length === 0 && (
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    ⚠ No s'han pogut carregar les carpetes del Zoho. Comprova que estiguin
                    configurades les credencials a Connexions.
                  </div>
                )}

                {!foldersLoading && zohoFolders.length > 0 && (
                  <div className="max-h-64 overflow-y-auto space-y-0.5 bg-white rounded border p-1">
                    {[...zohoFolders]
                      .sort((a, b) => {
                        // Carpetes "factura" primer, després alfabèticament per path
                        const aFact = isInvoiceFolder(a) ? 0 : 1;
                        const bFact = isInvoiceFolder(b) ? 0 : 1;
                        if (aFact !== bFact) return aFact - bFact;
                        return (a.path || a.folderName || '').localeCompare(b.path || b.folderName || '');
                      })
                      .map((f) => {
                        const folderId = f.path || f.folderName;
                        const checked = zohoRescanForm.folders.includes(folderId);
                        const isInvoice = isInvoiceFolder(f);
                        return (
                          <label
                            key={folderId}
                            className={`flex items-center gap-2 text-xs cursor-pointer p-1.5 rounded hover:bg-blue-50 ${
                              checked ? 'bg-blue-50' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const folders = e.target.checked
                                  ? [...zohoRescanForm.folders, folderId]
                                  : zohoRescanForm.folders.filter((x) => x !== folderId);
                                setZohoRescanForm({ ...zohoRescanForm, folders });
                              }}
                            />
                            {isInvoice && <span className="text-amber-500 leading-none" title="Auto-detectada com a carpeta de factures">★</span>}
                            <span className={`flex-1 font-mono ${isInvoice ? 'font-semibold text-blue-900' : 'text-gray-700'}`}>
                              {f.path || f.folderName}
                            </span>
                            {f.unreadCount > 0 && (
                              <span className="text-[10px] text-gray-400">{f.unreadCount} no llegits</span>
                            )}
                          </label>
                        );
                      })}
                  </div>
                )}

                {zohoRescanForm.folders.length === 0 && !foldersLoading && zohoFolders.length > 0 && (
                  <p className="text-[11px] text-rose-600 mt-1">⚠ Selecciona almenys una carpeta</p>
                )}
                {zohoRescanForm.folders.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    {zohoRescanForm.folders.length} carpeta{zohoRescanForm.folders.length === 1 ? '' : 's'} seleccionada{zohoRescanForm.folders.length === 1 ? '' : 's'}
                    {zohoRescanForm.folders.length === 1 && ' · passada profunda (500 correus max)'}
                  </p>
                )}
              </div>

              <label className="flex items-start gap-2 text-sm cursor-pointer p-2 rounded border bg-amber-50/40 border-amber-200">
                <input
                  type="checkbox"
                  checked={zohoRescanForm.ignoreProcessed}
                  onChange={(e) => setZohoRescanForm({ ...zohoRescanForm, ignoreProcessed: e.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Ignorar correus ja processats</span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5">
                    Re-processa correus que el sistema ja havia vist (útil si es van marcar erròniament com a "no factura"). Per defecte només es processen els nous.
                  </span>
                </span>
              </label>

              <div className="text-[11px] text-muted-foreground bg-slate-50 border rounded p-2">
                ℹ️ Màxim 90 dies per evitar timeouts. Per rangs més grans, divideix en trams.
                El cron automàtic continua funcionant amb el seu propi puntejat.
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowZohoRescan(false)}
                  disabled={zohoRescanRunning}
                  className="px-4 py-2 rounded-md border text-sm"
                >
                  Cancel·lar
                </button>
                <button
                  type="button"
                  onClick={handleZohoRescan}
                  disabled={zohoRescanRunning || !zohoRescanForm.from || !zohoRescanForm.to}
                  className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                >
                  {zohoRescanRunning ? (
                    <><RefreshCw size={14} className="animate-spin" /> Repassant…</>
                  ) : (
                    <><Mail size={14} /> Repassar correu</>
                  )}
                </button>
              </div>
            </>
          )}

          {zohoRescanResult?.error && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">Error</div>
                  <div className="text-xs mt-1">{zohoRescanResult.error}</div>
                </div>
              </div>
              <button
                onClick={() => setZohoRescanResult(null)}
                className="mt-3 text-xs underline"
              >
                Tornar a provar
              </button>
            </div>
          )}

          {zohoRescanResult && !zohoRescanResult.error && (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  Rang: <span className="text-primary">{zohoRescanForm.from}</span> → <span className="text-primary">{zohoRescanForm.to}</span>
                  {zohoRescanResult.ignoreProcessed && <span className="ml-2 text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-800">re-processats</span>}
                </div>
                {zohoRescanResult.folders?.length > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    Carpetes: {zohoRescanResult.folders.map((f) => (
                      <code key={f} className="font-mono px-1 py-0.5 bg-blue-50 text-blue-800 rounded mx-0.5">{f}</code>
                    ))}
                  </div>
                )}
              </div>

              {/* Cards stats */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border p-3 bg-emerald-50/60 border-emerald-200">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-medium">PDFs nous descarregats</div>
                  <div className="text-2xl font-semibold text-emerald-900">{zohoRescanResult.stats?.pdfAttached || 0}</div>
                </div>
                <div className="rounded-lg border p-3 bg-blue-50/60 border-blue-200">
                  <div className="text-[10px] uppercase tracking-wide text-blue-700 font-medium">Links a plataformes</div>
                  <div className="text-2xl font-semibold text-blue-900">{zohoRescanResult.stats?.linkDetected || 0}</div>
                </div>
                <div className="rounded-lg border p-3 bg-amber-50/60 border-amber-200">
                  <div className="text-[10px] uppercase tracking-wide text-amber-700 font-medium">Revisió manual</div>
                  <div className="text-2xl font-semibold text-amber-900">{zohoRescanResult.stats?.manualReview || 0}</div>
                </div>
                <div className="rounded-lg border p-3 bg-slate-50 border-slate-200">
                  <div className="text-[10px] uppercase tracking-wide text-slate-600 font-medium">Descartats (no factura)</div>
                  <div className="text-2xl font-semibold text-slate-700">{zohoRescanResult.stats?.notInvoice || 0}</div>
                </div>
                <div className="rounded-lg border p-3 bg-slate-50 border-slate-200">
                  <div className="text-[10px] uppercase tracking-wide text-slate-600 font-medium">Ja processats abans</div>
                  <div className="text-2xl font-semibold text-slate-700">{zohoRescanResult.stats?.skipped || 0}</div>
                </div>
                <div className="rounded-lg border p-3 bg-rose-50/60 border-rose-200">
                  <div className="text-[10px] uppercase tracking-wide text-rose-700 font-medium">Errors</div>
                  <div className="text-2xl font-semibold text-rose-900">{zohoRescanResult.stats?.errors || 0}</div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Total escanejats: <strong>{zohoRescanResult.scanned}</strong>
                {zohoRescanResult.stats?.pdfAttached > 0 && (
                  <span className="ml-2 text-emerald-700">✓ Els PDFs nous estan a la carpeta inbox de Google Drive — apareixeran a la taula en uns segons.</span>
                )}
              </div>

              {/* Detall per correu */}
              {zohoRescanResult.items?.length > 0 && (
                <details className="border rounded-lg bg-white" open>
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium hover:bg-gray-50">
                    Detall ({zohoRescanResult.items.length} correus)
                  </summary>
                  <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-medium">Data</th>
                          <th className="text-left px-2 py-1.5 font-medium">De</th>
                          <th className="text-left px-2 py-1.5 font-medium">Assumpte</th>
                          <th className="text-left px-2 py-1.5 font-medium">Acció</th>
                        </tr>
                      </thead>
                      <tbody>
                        {zohoRescanResult.items.map((item, idx) => {
                          const actionStyles = {
                            pdf_uploaded:    'bg-emerald-100 text-emerald-800',
                            link_reminder:   'bg-blue-100 text-blue-800',
                            manual_review:   'bg-amber-100 text-amber-800',
                            not_invoice:     'bg-slate-100 text-slate-600',
                            error:           'bg-rose-100 text-rose-800',
                          };
                          const actionCls = item.action?.startsWith('skipped')
                            ? 'bg-slate-100 text-slate-500 italic'
                            : (actionStyles[item.action] || 'bg-gray-100 text-gray-700');
                          return (
                            <tr key={idx} className="border-t hover:bg-gray-50/50">
                              <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                                {item.date ? new Date(typeof item.date === 'number' ? item.date : item.date).toLocaleDateString('ca-ES') : '—'}
                              </td>
                              <td className="px-2 py-1.5 max-w-[160px] truncate" title={item.from}>
                                {item.supplierName ? (
                                  <span className="font-medium">{item.supplierName}</span>
                                ) : (
                                  <span className="text-gray-500">{item.from}</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 max-w-[280px] truncate" title={item.subject}>
                                {item.subject}
                              </td>
                              <td className="px-2 py-1.5">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${actionCls}`}>
                                  {item.action || '—'}
                                </span>
                                {item.error && <div className="text-[10px] text-rose-600 mt-0.5" title={item.error}>{item.error.slice(0, 80)}</div>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  onClick={() => setZohoRescanResult(null)}
                  className="px-4 py-2 rounded-md border text-sm"
                >
                  Nou rang
                </button>
                <button
                  onClick={() => { setShowZohoRescan(false); setZohoRescanResult(null); }}
                  className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
                >
                  Tancar
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
