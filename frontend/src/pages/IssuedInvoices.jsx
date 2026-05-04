import { useState } from 'react';
import { Plus, Search, Check, X as XIcon, Trash2, Eye, RefreshCw, Download as DownloadIcon, CircleDollarSign, Mail, Send, BookText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import api from '../lib/api';
import { StatusBadge } from '../components/shared/StatusBadge';
import Modal from '../components/shared/Modal';
import IssuedInvoiceDetailModal from '../components/shared/IssuedInvoiceDetailModal';
import { formatCurrency, formatDate } from '../lib/utils';
import ExportButtons from '../components/shared/ExportButtons';
import SortableHeader from '../components/shared/SortableHeader';
import IssuedInvoicesReport from '../components/shared/IssuedInvoicesReport';
import useAuthStore from '../stores/authStore';

export default function IssuedInvoices() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('issueDate');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showModal, setShowModal] = useState(false);
  const [detailInvoice, setDetailInvoice] = useState(null);
  const [backfilling, setBackfilling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [form, setForm] = useState({ invoiceNumber: '', clientId: '', issueDate: '', dueDate: '', subtotal: '', taxRate: '21', taxAmount: '', totalAmount: '', description: '' });
  const [reminderModal, setReminderModal] = useState(null);
  const [reminderLoading, setReminderLoading] = useState(false);

  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role === 'ADMIN';

  const { data, loading, refetch } = useApiGet('/invoices/issued', { search, status: statusFilter || undefined, sortBy, sortOrder: sortDir, page, limit: pageSize });
  const { data: clientsData } = useApiGet('/clients', { limit: 100 });
  const { mutate } = useApiMutation();

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
    setPage(1);
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
      // Deseleccionar els visibles (mantenint altres pàgines si hi havia)
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      // Afegir tots els visibles
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const clearSelection = () => setSelectedIds([]);

  // L'ordenació es fa al backend — les dades ja venen ordenades
  const sortedData = data?.data || [];

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
    try {
      await mutate('patch', `/invoices/issued/${id}/status`, { status });
      refetch();
    } catch (err) {
      alert(err.message || 'Error canviant estat');
    }
  };

  // Recordatori de pagament
  const handlePaymentReminder = async (invoiceId) => {
    setReminderLoading(true);
    try {
      const res = await api.get(`/invoices/issued/${invoiceId}/payment-reminder`);
      setReminderModal({ ...res.data, invoiceId });
    } catch (err) {
      alert('Error generant el recordatori: ' + (err.response?.data?.error || err.message));
    } finally {
      setReminderLoading(false);
    }
  };

  const handleSendReminder = async () => {
    if (!reminderModal) return;
    setReminderLoading(true);
    try {
      const { data: result } = await api.post(`/invoices/issued/${reminderModal.invoiceId}/send-reminder`, {
        to: reminderModal.to,
        subject: reminderModal.subject,
        body: reminderModal.body,
      });
      if (result.fallback === 'mailto' && result.mailtoUrl) {
        // Zoho no disponible → obrir client de correu
        window.open(result.mailtoUrl, '_blank');
        alert(`S'ha obert el client de correu per enviar a ${reminderModal.to}.\n(Zoho Mail API no disponible, s'ha registrat igualment)`);
      } else {
        alert(`Recordatori enviat correctament a ${reminderModal.to}`);
      }
      setReminderModal(null);
      refetch();
    } catch (err) {
      alert('Error enviant el recordatori: ' + (err.response?.data?.error || err.message));
    } finally {
      setReminderLoading(false);
    }
  };

  const handleBulkStatusChange = async (status) => {
    if (selectedIds.length === 0) return;
    const label = status === 'PAID' ? 'pagades' : status === 'APPROVED' ? 'aprovades' : status.toLowerCase();
    const confirmed = window.confirm(`Marcar ${selectedIds.length} factures com a ${label}?`);
    if (!confirmed) return;
    try {
      const { data: result } = await api.patch('/invoices/issued/bulk-status', { ids: selectedIds, status });
      clearSelection();
      refetch();
      alert(`${result.updated} factures marcades com a ${label}`);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    }
  };

  const [postingId, setPostingId] = useState(null);
  const [bulkPostRunning, setBulkPostRunning] = useState(false);
  const [bulkPostResult, setBulkPostResult] = useState(null);

  const handlePost = async (id, invoiceNumber) => {
    setPostingId(id);
    try {
      const { data } = await api.post(`/invoice-posting/issued/${id}/post`);
      alert(`${invoiceNumber} comptabilitzada (assentament #${data.journalEntry.entryNumber})`);
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
      await api.post(`/invoice-posting/issued/${id}/unpost`);
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error');
    } finally {
      setPostingId(null);
    }
  };

  const handleBulkPost = async () => {
    if (!confirm(`Comptabilitzar ${selectedIds.length} factures emeses?`)) return;
    setBulkPostRunning(true);
    setBulkPostResult(null);
    try {
      const { data } = await api.post('/invoice-posting/issued/post-bulk', { ids: selectedIds });
      setBulkPostResult(data);
      refetch();
      clearSelection();
    } catch (err) {
      setBulkPostResult({ error: err.response?.data?.error || 'Error' });
    } finally {
      setBulkPostRunning(false);
    }
  };

  const handleViewDetails = async (id) => {
    try {
      const { data: invoice } = await api.get(`/invoices/issued/${id}`);
      setDetailInvoice(invoice);
    } catch (err) {
      alert('Error carregant detalls: ' + err.message);
    }
  };

  const handleSyncRentman = async () => {
    const confirmed = window.confirm(
      'Sincronitzar ara amb Rentman? Importarà factures noves i actualitzarà canvis (estat, venciment, imports). Pot tardar uns minuts.'
    );
    if (!confirmed) return;

    setSyncing(true);
    try {
      // Sync de últims 30 dies amb projectes (ràpid i útil)
      const { data } = await api.post('/rentman/sync/invoices?recentDays=30');
      alert(
        `Sync Rentman completat (${data.durationSec}s):\n` +
        `• Creades: ${data.created}\n` +
        `• Actualitzades: ${data.updated}\n` +
        `• Sense canvis: ${data.unchanged}\n` +
        `• Errors: ${data.errors}`
      );
      refetch();
    } catch (err) {
      alert('Error durant el sync: ' + (err.response?.data?.error || err.message));
    }
    setSyncing(false);
  };

  const handleBackfillProjectRefs = async () => {
    const confirmed = window.confirm(
      'Això consultarà Rentman per omplir la referència de projecte a totes les factures que encara no la tenen. Pot tardar uns minuts. Continuar?'
    );
    if (!confirmed) return;

    setBackfilling(true);
    try {
      const { data } = await api.post('/rentman/backfill/project-references');
      alert(
        `Backfill completat:\n` +
        `• Processades: ${data.processed}\n` +
        `• Actualitzades amb referència: ${data.updated}\n` +
        `• Errors: ${data.errors}`
      );
      refetch();
    } catch (err) {
      alert('Error durant el backfill: ' + (err.response?.data?.error || err.message));
    }
    setBackfilling(false);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Factures emeses</h2>
          <p className="text-sm text-muted-foreground mt-1">{data?.pagination?.total || 0} factures en total</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <>
              <button
                onClick={handleSyncRentman}
                disabled={syncing}
                className="flex items-center gap-2 border border-teal-300 text-teal-700 bg-teal-50 hover:bg-teal-100 px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                title="Sync amb Rentman (últims 30 dies): crea noves i actualitza canvis"
              >
                <DownloadIcon size={14} className={syncing ? 'animate-pulse' : ''} />
                {syncing ? 'Sincronitzant…' : 'Sync Rentman ara'}
              </button>
              <button
                onClick={handleBackfillProjectRefs}
                disabled={backfilling}
                className="flex items-center gap-2 border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                title="Consultar Rentman i omplir referències de projecte a les factures que encara no en tenen"
              >
                <RefreshCw size={14} className={backfilling ? 'animate-spin' : ''} />
                {backfilling ? 'Carregant referències…' : 'Omplir refs. projecte'}
              </button>
            </>
          )}
          <ExportButtons
            endpoint="/export/issued-invoices"
            filters={{ search: search || undefined, status: statusFilter || undefined }}
            filenameBase="factures-emeses"
            selectedIds={selectedIds}
          />
          <button onClick={() => { setForm({ invoiceNumber: '', clientId: '', issueDate: '', dueDate: '', subtotal: '', taxRate: '21', taxAmount: '', totalAmount: '', description: '' }); setShowModal(true); }} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
            <Plus size={16} /> Nova factura
          </button>
        </div>
      </div>

      <IssuedInvoicesReport />

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); clearSelection(); }} placeholder="Cercar..." className="w-full pl-10 pr-4 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); clearSelection(); }} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Tots els estats</option>
          <option value="PENDING">Pendent</option>
          <option value="APPROVED">Aprovada</option>
          <option value="PAID">Pagada</option>
        </select>
      </div>

      {/* Barra de selecció */}
      {selectedIds.length > 0 && (
        <div className="mb-3 flex items-center justify-between bg-teal-50 border border-teal-200 rounded-lg px-4 py-2">
          <span className="text-sm text-teal-800">
            <strong>{selectedIds.length}</strong> factures seleccionades
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBulkStatusChange('PAID')}
              className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-emerald-700"
            >
              <CircleDollarSign size={13} />
              Marcar com a pagades
            </button>
            <button
              onClick={() => handleBulkStatusChange('APPROVED')}
              className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-green-700"
            >
              <Check size={13} />
              Aprovar
            </button>
            <button
              onClick={handleBulkPost}
              disabled={bulkPostRunning}
              className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
              title="Generar l'assentament comptable per cada factura seleccionada"
            >
              <Send size={13} className={bulkPostRunning ? 'animate-pulse' : ''} />
              {bulkPostRunning ? 'Comptabilitzant...' : 'Comptabilitzar'}
            </button>
            <button
              onClick={clearSelection}
              className="text-xs text-teal-700 hover:text-teal-900 underline ml-2"
            >
              Netejar selecció
            </button>
          </div>
        </div>
      )}

      {bulkPostResult && (
        <div className={`mb-3 rounded-lg border p-3 ${bulkPostResult.error ? 'bg-red-50 border-red-200' : 'bg-indigo-50 border-indigo-200'}`}>
          {bulkPostResult.error ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-red-700">Error: {bulkPostResult.error}</span>
              <button onClick={() => setBulkPostResult(null)} className="text-red-500 hover:text-red-700"><XIcon size={16} /></button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-indigo-800">
                Comptabilització: {bulkPostResult.ok?.length || 0} OK · {bulkPostResult.failed?.length || 0} fallades · {bulkPostResult.total} totals
              </span>
              <button onClick={() => setBulkPostResult(null)} className="text-indigo-600 hover:text-indigo-800"><XIcon size={16} /></button>
            </div>
          )}
          {bulkPostResult.failed?.length > 0 && (
            <details className="mt-2 text-xs text-red-600">
              <summary className="cursor-pointer font-medium">{bulkPostResult.failed.length} errors</summary>
              <ul className="mt-1 space-y-0.5 ml-4">
                {bulkPostResult.failed.map((d) => <li key={d.invoiceId}><strong>{d.invoiceNumber}</strong>: {d.error}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

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
              <SortableHeader label="Client" field="client" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Data emissió" field="issueDate" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Venciment" field="dueDate" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Import" field="totalAmount" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Estat" field="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <th className="text-center p-3 font-medium text-xs text-muted-foreground uppercase">Comptabilitat</th>
              <th className="text-center p-3 font-medium text-xs text-muted-foreground uppercase">Últim rec.</th>
              <th className="text-right p-3 font-medium text-xs text-muted-foreground uppercase">Accions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">Carregant...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">Cap factura trobada</td></tr>
            ) : (
              sortedData.map((inv) => (
                <tr
                  key={inv.id}
                  className={`border-t hover:bg-muted/30 ${selectedIds.includes(inv.id) ? 'bg-teal-50/60' : ''}`}
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(inv.id)}
                      onChange={() => toggleSelect(inv.id)}
                      className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                    />
                  </td>
                  <td className="p-3 font-medium">
                    <button
                      onClick={() => handleViewDetails(inv.id)}
                      className="text-primary hover:underline text-left"
                    >
                      {inv.invoiceNumber}
                    </button>
                  </td>
                  <td className="p-3">{inv.client?.name}</td>
                  <td className="p-3 text-muted-foreground">{formatDate(inv.issueDate)}</td>
                  <td className="p-3 text-muted-foreground">{inv.dueDate ? formatDate(inv.dueDate) : '—'}</td>
                  <td className="p-3 text-right font-medium">{formatCurrency(inv.totalAmount)}</td>
                  <td className="p-3 text-center"><StatusBadge status={inv.status} /></td>
                  <td className="p-3 text-center">
                    {inv.journalEntryId ? (
                      <Link to={`/journal/${inv.journalEntryId}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200" title="Veure assentament">
                        <BookText size={11} /> Comptabilitzada
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    {inv.paymentReminders?.[0] ? (
                      <span className="text-xs text-muted-foreground" title={`Enviat a ${inv.paymentReminders[0].sentTo}`}>
                        {formatDate(inv.paymentReminders[0].createdAt)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {inv.journalEntryId ? (
                        <button
                          onClick={() => handleUnpost(inv.id)}
                          disabled={postingId === inv.id}
                          className="p-1.5 rounded hover:bg-amber-50 text-amber-700 disabled:opacity-50"
                          title="Anul·lar comptabilització"
                        >
                          <RefreshCw size={14} className={postingId === inv.id ? 'animate-spin' : ''} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handlePost(inv.id, inv.invoiceNumber)}
                          disabled={postingId === inv.id}
                          className="p-1.5 rounded hover:bg-indigo-50 text-indigo-700 disabled:opacity-50"
                          title="Comptabilitzar (genera assentament)"
                        >
                          <Send size={14} className={postingId === inv.id ? 'animate-pulse' : ''} />
                        </button>
                      )}
                      <button
                        onClick={() => handleViewDetails(inv.id)}
                        className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                        title="Veure detalls"
                      >
                        <Eye size={14} />
                      </button>
                      {inv.status === 'PENDING' && (
                        <button onClick={() => handleStatusChange(inv.id, 'APPROVED')} className="p-1.5 rounded hover:bg-green-50 text-green-600" title="Aprovar"><Check size={14} /></button>
                      )}
                      {inv.status !== 'PAID' && (
                        <>
                          <button
                            onClick={() => handlePaymentReminder(inv.id)}
                            disabled={reminderLoading}
                            className="p-1.5 rounded hover:bg-amber-50 text-amber-600"
                            title="Enviar recordatori de pagament"
                          >
                            <Mail size={14} />
                          </button>
                          <button onClick={() => handleStatusChange(inv.id, 'PAID')} className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600" title="Marcar com a pagada">
                            <CircleDollarSign size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Paginació */}
        {data?.pagination && (
          <div className="flex items-center justify-between p-3 border-t text-sm">
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground">{data.pagination.total} factures</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Per pàgina:</span>
                <select value={pageSize} onChange={(e) => { setPageSize(parseInt(e.target.value)); setPage(1); clearSelection(); }} className="rounded border bg-background px-2 py-1 text-xs">
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>
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

      {/* Popup detall factura emesa */}
      <IssuedInvoiceDetailModal
        isOpen={!!detailInvoice}
        onClose={() => setDetailInvoice(null)}
        invoice={detailInvoice}
      />

      {/* Modal recordatori de pagament */}
      {reminderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-lg border shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2">
                <Mail size={18} className="text-amber-500" />
                <h3 className="font-semibold">Recordatori de pagament</h3>
              </div>
              <button onClick={() => setReminderModal(null)} className="p-1 rounded hover:bg-muted">
                <XIcon size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Destinatari</label>
                <input
                  type="email"
                  value={reminderModal.to || ''}
                  onChange={(e) => setReminderModal({ ...reminderModal, to: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Assumpte</label>
                <input
                  type="text"
                  value={reminderModal.subject}
                  onChange={(e) => setReminderModal({ ...reminderModal, subject: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Cos del missatge</label>
                <textarea
                  value={reminderModal.body}
                  onChange={(e) => setReminderModal({ ...reminderModal, body: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
                  rows={12}
                />
              </div>
              <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground space-y-1">
                <p><strong>Client:</strong> {reminderModal.clientName}</p>
                <p><strong>Factura:</strong> {reminderModal.invoiceNumber} — {formatCurrency(reminderModal.totalAmount)}</p>
                <p><strong>Dies pendents:</strong> {reminderModal.daysPending}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
              <button
                onClick={() => setReminderModal(null)}
                className="px-4 py-2 rounded-md border text-sm"
              >
                Cancel·lar
              </button>
              <button
                onClick={handleSendReminder}
                disabled={reminderLoading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50"
              >
                <Mail size={14} />
                {reminderLoading ? 'Enviant…' : 'Enviar des de rental@seitocamera.com'}
              </button>
            </div>
          </div>
        </div>
      )}

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
