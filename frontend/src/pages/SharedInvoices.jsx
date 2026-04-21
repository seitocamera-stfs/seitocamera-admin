import { useState, useMemo, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Pencil, Eye, Download, X, FileText, CheckSquare, Lock, Unlock, HandCoins, CheckCircle2, Upload } from 'lucide-react';
import { useRef } from 'react';
import { useApiGet } from '../hooks/useApi';
import { formatCurrency, formatDate } from '../lib/utils';
import api from '../lib/api';

export default function SharedInvoices() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [groupBy, setGroupBy] = useState('month');
  const [expanded, setExpanded] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editPercent, setEditPercent] = useState(50);

  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfInvoice, setPdfInvoice] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [extractLoading, setExtractLoading] = useState(false);

  // Upload PDF
  const [uploadLoading, setUploadLoading] = useState(false);
  const fileInputRef = useRef(null);

  // Estat de bloqueig/compensació
  const [locks, setLocks] = useState({});
  const [lockLoading, setLockLoading] = useState(null); // "periodType:period" que s'està processant
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'lock'|'unlock'|'compensate', group }

  const { data, loading, refetch } = useApiGet('/shared-invoices', { year, groupBy });

  // Carregar estat de bloqueig
  const fetchLocks = useCallback(async () => {
    try {
      const res = await api.get('/shared-invoices/period-locks', { params: { year } });
      setLocks(res.data || {});
    } catch {
      setLocks({});
    }
  }, [year]);

  useEffect(() => { fetchLocks(); }, [fetchLocks]);

  // Helper: obtenir estat de bloqueig d'un grup
  const getLockState = (group) => {
    const key = `${groupBy}:${group.key}`;
    return locks[key] || { locked: false, compensated: false };
  };

  // Totes les factures aplanades
  const allInvoices = useMemo(() => {
    if (!data?.groups) return [];
    return data.groups.flatMap((g) => g.invoices);
  }, [data]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === allInvoices.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allInvoices.map((inv) => inv.id));
    }
  };

  const toggleSelectGroup = (group) => {
    const groupIds = group.invoices.map((inv) => inv.id);
    const allSelected = groupIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !groupIds.includes(id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...groupIds])]);
    }
  };

  const handleExtractPdf = async () => {
    if (!selectedIds.length) return;
    setExtractLoading(true);
    try {
      const response = await api.post('/shared-invoices/extract-pdf', {
        invoiceIds: selectedIds,
        year,
        title: `Extracte factures compartides — ${year}`,
      }, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `extracte-compartides-${year}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Error generant l\'extracte PDF');
    } finally {
      setExtractLoading(false);
    }
  };

  const handleViewPdf = async (inv) => {
    setPdfInvoice(inv);
    setPdfUrl(null);
    try {
      const response = await api.get(`/invoices/received/${inv.id}/pdf`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      setPdfUrl(window.URL.createObjectURL(blob));
    } catch {
      alert('No s\'ha pogut carregar el PDF');
      setPdfInvoice(null);
    }
  };

  const handleDownloadPdf = async (inv) => {
    try {
      const response = await api.get(`/invoices/received/${inv.id}/pdf`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${inv.invoiceNumber || 'factura'}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('No s\'ha pogut descarregar el PDF');
    }
  };

  const closePdfModal = () => {
    if (pdfUrl) window.URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
    setPdfInvoice(null);
  };

  const toggleGroup = (key) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handlePercentSave = async (invoiceId) => {
    try {
      await api.patch(`/shared-invoices/${invoiceId}`, {
        sharedPercentSeito: editPercent,
        sharedPercentLogistik: 100 - editPercent,
      });
      setEditingId(null);
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error actualitzant');
    }
  };

  const handlePaidByChange = async (invoiceId, paidBy) => {
    try {
      await api.patch(`/shared-invoices/${invoiceId}`, { paidBy });
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error actualitzant el pagament');
    }
  };

  // === Accions de bloqueig i compensació ===
  const handleLock = async (group) => {
    const key = `${groupBy}:${group.key}`;
    setLockLoading(key);
    try {
      await api.post('/shared-invoices/lock', { year, period: group.key, periodType: groupBy });
      await fetchLocks();
    } catch (err) {
      alert(err.response?.data?.error || 'Error bloquejant');
    } finally {
      setLockLoading(null);
      setConfirmAction(null);
    }
  };

  const handleUnlock = async (group) => {
    const key = `${groupBy}:${group.key}`;
    setLockLoading(key);
    try {
      await api.post('/shared-invoices/unlock', { year, period: group.key, periodType: groupBy });
      await fetchLocks();
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error desbloquejant');
    } finally {
      setLockLoading(null);
      setConfirmAction(null);
    }
  };

  const handleCompensate = async (group) => {
    const key = `${groupBy}:${group.key}`;
    setLockLoading(key);
    try {
      const res = await api.post('/shared-invoices/compensate', { year, period: group.key, periodType: groupBy });
      await fetchLocks();
      const s = res.data.summary;
      let msg = `Compensació registrada: ${s.invoiceCount} factures.`;
      if (s.direction === 'LOGISTIK_PAYS_SEITO') {
        msg += `\nLogistik ha de pagar ${formatCurrency(s.amount)} a Seito.`;
      } else if (s.direction === 'SEITO_PAYS_LOGISTIK') {
        msg += `\nSeito ha de pagar ${formatCurrency(s.amount)} a Logistik.`;
      } else {
        msg += '\nBalanç equilibrat — no cal compensar.';
      }
      alert(msg);
    } catch (err) {
      alert(err.response?.data?.error || 'Error compensant');
    } finally {
      setLockLoading(null);
      setConfirmAction(null);
    }
  };

  const handleUploadPdf = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploadLoading(true);
    let successCount = 0;
    let errorCount = 0;
    for (const file of files) {
      if (file.type !== 'application/pdf') {
        alert(`${file.name} no és un PDF`);
        errorCount++;
        continue;
      }
      try {
        const formData = new FormData();
        formData.append('file', file);
        await api.post('/shared-invoices/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        successCount++;
      } catch (err) {
        errorCount++;
        alert(err.response?.data?.error || `Error pujant ${file.name}`);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    setUploadLoading(false);
    if (successCount > 0) {
      alert(`${successCount} PDF${successCount > 1 ? 's' : ''} pujat${successCount > 1 ? 's' : ''} a Google Drive (Seito-logistik/inbox). Es processaran automàticament amb el proper sync.`);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Factures compartides</h2>
          <p className="text-sm text-muted-foreground mt-1">SEITO · LOGISTIK — Repartiment de costos</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            onChange={handleUploadPdf}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadLoading}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border hover:bg-muted disabled:opacity-50"
            title="Pujar PDF a Google Drive (Seito-logistik/inbox)"
          >
            <Upload size={14} />
            {uploadLoading ? 'Pujant...' : 'Pujar factura'}
          </button>
          {selectedIds.length > 0 && (
            <button
              onClick={handleExtractPdf}
              disabled={extractLoading}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <FileText size={14} />
              {extractLoading ? 'Generant...' : `Extracte PDF (${selectedIds.length})`}
            </button>
          )}
          {allInvoices.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border ${selectedIds.length === allInvoices.length ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              title={selectedIds.length === allInvoices.length ? 'Deseleccionar tot' : 'Seleccionar tot'}
            >
              <CheckSquare size={14} />
              {selectedIds.length > 0 ? `${selectedIds.length} sel.` : 'Sel. tot'}
            </button>
          )}
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm">
            <option value="month">Per mes</option>
            <option value="quarter">Per trimestre</option>
          </select>
          <select value={year} onChange={(e) => { setYear(parseInt(e.target.value)); setSelectedIds([]); }} className="rounded-md border bg-background px-3 py-2 text-sm">
            {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Resum totals */}
      {data?.totals && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-card border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Total factures</p>
            <p className="text-2xl font-bold">{data.totals.count}</p>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Import total</p>
            <p className="text-2xl font-bold">{formatCurrency(data.totals.totalAmount)}</p>
          </div>
          <div className="bg-card border rounded-lg p-4 border-l-4 border-l-blue-500">
            <p className="text-xs text-muted-foreground">Seito Camera</p>
            <p className="text-2xl font-bold text-blue-600">{formatCurrency(data.totals.totalSeito)}</p>
          </div>
          <div className="bg-card border rounded-lg p-4 border-l-4 border-l-orange-500">
            <p className="text-xs text-muted-foreground">Logistik</p>
            <p className="text-2xl font-bold text-orange-600">{formatCurrency(data.totals.totalLogistik)}</p>
          </div>
        </div>
      )}

      {/* Registre de períodes */}
      {data?.groups?.length > 0 && (
        <div className="bg-card border rounded-lg overflow-hidden mb-6">
          <div className="px-4 py-3 border-b bg-muted/30">
            <h3 className="text-sm font-semibold">Registre per {groupBy === 'quarter' ? 'trimestre' : 'mes'}</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/20">
              <tr>
                <th className="text-left p-3 font-medium">Període</th>
                <th className="text-center p-3 font-medium">Factures</th>
                <th className="text-right p-3 font-medium">Total</th>
                <th className="text-right p-3 font-medium text-blue-600">Seito</th>
                <th className="text-right p-3 font-medium text-orange-600">Logistik</th>
                <th className="text-right p-3 font-medium">Pagat Seito</th>
                <th className="text-right p-3 font-medium">Pagat Logistik</th>
                <th className="text-center p-3 font-medium">Balanç</th>
                <th className="text-center p-3 font-medium">Estat</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((group) => {
                const lockState = getLockState(group);
                // Calcular pagat per Seito i Logistik dins el grup
                let paidSeito = 0, paidLogistik = 0, pendingCount = 0;
                for (const inv of group.invoices) {
                  const total = parseFloat(inv.totalAmount);
                  if (inv.paidBy === 'SEITO') paidSeito += total;
                  else if (inv.paidBy === 'LOGISTIK') paidLogistik += total;
                  else pendingCount++;
                }
                const balance = paidSeito - group.totalSeito;
                return (
                  <tr key={group.key} className="border-t hover:bg-muted/10">
                    <td className="p-3 font-medium">{group.label}</td>
                    <td className="p-3 text-center">{group.invoices.length}</td>
                    <td className="p-3 text-right">{formatCurrency(group.totalAmount)}</td>
                    <td className="p-3 text-right text-blue-600">{formatCurrency(group.totalSeito)}</td>
                    <td className="p-3 text-right text-orange-600">{formatCurrency(group.totalLogistik)}</td>
                    <td className="p-3 text-right">{formatCurrency(paidSeito)}</td>
                    <td className="p-3 text-right">{formatCurrency(paidLogistik)}</td>
                    <td className="p-3 text-center text-xs">
                      {pendingCount > 0 ? (
                        <span className="text-gray-400">{pendingCount} pendent{pendingCount > 1 ? 's' : ''}</span>
                      ) : balance > 0.01 ? (
                        <span className="text-orange-600 font-medium">Logistik → Seito {formatCurrency(balance)}</span>
                      ) : balance < -0.01 ? (
                        <span className="text-blue-600 font-medium">Seito → Logistik {formatCurrency(Math.abs(balance))}</span>
                      ) : (
                        <span className="text-emerald-600">Equilibrat</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {lockState.compensated ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                          <CheckCircle2 size={10} /> Compensat
                        </span>
                      ) : lockState.locked ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          <Lock size={10} /> Tancat
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                          Obert
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {/* Fila totals */}
              {(() => {
                let totPaidSeito = 0, totPaidLogistik = 0;
                for (const g of data.groups) {
                  for (const inv of g.invoices) {
                    const total = parseFloat(inv.totalAmount);
                    if (inv.paidBy === 'SEITO') totPaidSeito += total;
                    else if (inv.paidBy === 'LOGISTIK') totPaidLogistik += total;
                  }
                }
                const totBalance = totPaidSeito - data.totals.totalSeito;
                return (
                  <tr className="border-t-2 bg-muted/30 font-semibold">
                    <td className="p-3">Total {year}</td>
                    <td className="p-3 text-center">{data.totals.count}</td>
                    <td className="p-3 text-right">{formatCurrency(data.totals.totalAmount)}</td>
                    <td className="p-3 text-right text-blue-600">{formatCurrency(data.totals.totalSeito)}</td>
                    <td className="p-3 text-right text-orange-600">{formatCurrency(data.totals.totalLogistik)}</td>
                    <td className="p-3 text-right">{formatCurrency(totPaidSeito)}</td>
                    <td className="p-3 text-right">{formatCurrency(totPaidLogistik)}</td>
                    <td className="p-3 text-center text-xs">
                      {totBalance > 0.01 ? (
                        <span className="text-orange-600">Logistik → Seito {formatCurrency(totBalance)}</span>
                      ) : totBalance < -0.01 ? (
                        <span className="text-blue-600">Seito → Logistik {formatCurrency(Math.abs(totBalance))}</span>
                      ) : (
                        <span className="text-emerald-600">Equilibrat</span>
                      )}
                    </td>
                    <td className="p-3"></td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Grups */}
      {loading ? (
        <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">Carregant...</div>
      ) : !data?.groups?.length ? (
        <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">
          Cap factura compartida aquest any. Marca factures com a compartides des de l&apos;edició de factures rebudes.
        </div>
      ) : (
        <div className="space-y-3">
          {data.groups.map((group) => {
            const lockState = getLockState(group);
            const isLocked = lockState.locked;
            const isCompensated = lockState.compensated;
            const lockKey = `${groupBy}:${group.key}`;
            const isProcessing = lockLoading === lockKey;

            return (
            <div key={group.key} className={`bg-card border rounded-lg overflow-hidden ${isCompensated ? 'border-emerald-300' : isLocked ? 'border-amber-300' : ''}`}>
              {/* Capçalera del grup */}
              <div className="flex items-center p-4 hover:bg-muted/30 transition-colors">
                {!isLocked && (
                  <input
                    type="checkbox"
                    checked={group.invoices.every((inv) => selectedIds.includes(inv.id))}
                    onChange={() => toggleSelectGroup(group)}
                    className="mr-3 h-4 w-4 rounded border-gray-300 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="flex-1 flex items-center justify-between"
                >
                <div className="flex items-center gap-3">
                  {expanded[group.key] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="font-medium">{group.label}</span>
                  <span className="text-xs text-muted-foreground">({group.invoices.length} factures)</span>
                  {/* Badges d'estat */}
                  {isCompensated && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                      <CheckCircle2 size={11} />
                      Compensat
                      {lockState.compensatedDirection === 'LOGISTIK_PAYS_SEITO' && lockState.compensatedAmount
                        ? ` — Logistik → Seito ${formatCurrency(lockState.compensatedAmount)}`
                        : lockState.compensatedDirection === 'SEITO_PAYS_LOGISTIK' && lockState.compensatedAmount
                        ? ` — Seito → Logistik ${formatCurrency(lockState.compensatedAmount)}`
                        : ' — Equilibrat'}
                    </span>
                  )}
                  {isLocked && !isCompensated && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                      <Lock size={11} />
                      Tancat
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <span className="text-muted-foreground">{formatCurrency(group.totalAmount)}</span>
                  <span className="text-blue-600 font-medium">{formatCurrency(group.totalSeito)}</span>
                  <span className="text-orange-600 font-medium">{formatCurrency(group.totalLogistik)}</span>
                </div>
                </button>

                {/* Botons de bloqueig/compensació */}
                <div className="flex items-center gap-1 ml-3">
                  {!isLocked && !isCompensated && (
                    <>
                      <button
                        onClick={() => setConfirmAction({ type: 'lock', group })}
                        disabled={isProcessing}
                        className="p-1.5 rounded hover:bg-amber-50 text-amber-600 disabled:opacity-50"
                        title="Tancar període"
                      >
                        <Lock size={14} />
                      </button>
                      <button
                        onClick={() => setConfirmAction({ type: 'compensate', group })}
                        disabled={isProcessing}
                        className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600 disabled:opacity-50"
                        title="Compensar (liquidar balanç)"
                      >
                        <HandCoins size={14} />
                      </button>
                    </>
                  )}
                  {isLocked && !isCompensated && (
                    <>
                      <button
                        onClick={() => setConfirmAction({ type: 'unlock', group })}
                        disabled={isProcessing}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-50"
                        title="Desbloquejar"
                      >
                        <Unlock size={14} />
                      </button>
                      <button
                        onClick={() => setConfirmAction({ type: 'compensate', group })}
                        disabled={isProcessing}
                        className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600 disabled:opacity-50"
                        title="Compensar (liquidar balanç)"
                      >
                        <HandCoins size={14} />
                      </button>
                    </>
                  )}
                  {isCompensated && (
                    <button
                      onClick={() => setConfirmAction({ type: 'unlock', group })}
                      disabled={isProcessing}
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-50"
                      title="Reobrir període"
                    >
                      <Unlock size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Detall factures */}
              {expanded[group.key] && (
                <div className="border-t">
                  {/* Resum de compensació si existeix */}
                  {isCompensated && lockState.compensatedDirection && (
                    <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-200 text-sm">
                      <span className="font-medium text-emerald-800">
                        {lockState.compensatedDirection === 'LOGISTIK_PAYS_SEITO'
                          ? `Logistik compensa ${formatCurrency(lockState.compensatedAmount)} a Seito`
                          : lockState.compensatedDirection === 'SEITO_PAYS_LOGISTIK'
                          ? `Seito compensa ${formatCurrency(lockState.compensatedAmount)} a Logistik`
                          : 'Balanç equilibrat — no cal compensar'}
                      </span>
                      {lockState.compensatedByName && (
                        <span className="text-emerald-600 ml-2">
                          — per {lockState.compensatedByName} el {formatDate(lockState.compensatedAt)}
                        </span>
                      )}
                    </div>
                  )}
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr>
                        {!isLocked && <th className="p-3 w-8"></th>}
                        <th className="text-left p-3 font-medium">Factura</th>
                        <th className="text-left p-3 font-medium">Proveïdor</th>
                        <th className="text-left p-3 font-medium">Data</th>
                        <th className="text-right p-3 font-medium">Total</th>
                        <th className="text-right p-3 font-medium text-blue-600">Seito</th>
                        <th className="text-right p-3 font-medium text-orange-600">Logistik</th>
                        <th className="text-center p-3 font-medium">%</th>
                        <th className="text-center p-3 font-medium">Pagat per</th>
                        <th className="text-right p-3 font-medium">Accions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.invoices.map((inv) => (
                        <tr key={inv.id} className={`border-t hover:bg-muted/20 ${selectedIds.includes(inv.id) ? 'bg-primary/5' : ''}`}>
                          {!isLocked && (
                            <td className="p-3">
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(inv.id)}
                                onChange={() => toggleSelect(inv.id)}
                                className="h-4 w-4 rounded border-gray-300"
                              />
                            </td>
                          )}
                          <td className="p-3 font-mono text-xs">{inv.invoiceNumber}</td>
                          <td className="p-3 text-muted-foreground">{inv.supplier?.name || '—'}</td>
                          <td className="p-3 text-muted-foreground">{formatDate(inv.issueDate)}</td>
                          <td className="p-3 text-right font-medium">{formatCurrency(parseFloat(inv.totalAmount))}</td>
                          <td className="p-3 text-right text-blue-600">{formatCurrency(inv.amountSeito)}</td>
                          <td className="p-3 text-right text-orange-600">{formatCurrency(inv.amountLogistik)}</td>
                          <td className="p-3 text-center">
                            {!isLocked && editingId === inv.id ? (
                              <div className="flex items-center gap-1 justify-center">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={editPercent}
                                  onChange={(e) => setEditPercent(parseFloat(e.target.value))}
                                  onKeyDown={(e) => e.key === 'Enter' && handlePercentSave(inv.id)}
                                  className="w-14 px-1 py-0.5 border rounded text-xs text-center"
                                  autoFocus
                                />
                                <span className="text-xs text-muted-foreground">%</span>
                                <button onClick={() => handlePercentSave(inv.id)} className="text-xs text-primary font-medium ml-1">OK</button>
                                <button onClick={() => setEditingId(null)} className="text-xs text-muted-foreground ml-1">✕</button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {parseFloat(inv.sharedPercentSeito)}/{parseFloat(inv.sharedPercentLogistik)}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            {isLocked ? (
                              <span className={`text-xs px-2 py-1 rounded-full border font-medium ${
                                inv.paidBy === 'SEITO' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                inv.paidBy === 'LOGISTIK' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                'bg-gray-50 text-gray-500 border-gray-200'
                              }`}>
                                {inv.paidBy === 'SEITO' ? 'Seito' : inv.paidBy === 'LOGISTIK' ? 'Logistik' : 'Pendent'}
                              </span>
                            ) : (
                              <select
                                value={inv.paidBy || 'NONE'}
                                onChange={(e) => handlePaidByChange(inv.id, e.target.value)}
                                className={`text-xs px-2 py-1 rounded-full border font-medium ${
                                  inv.paidBy === 'SEITO' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                  inv.paidBy === 'LOGISTIK' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                  'bg-gray-50 text-gray-500 border-gray-200'
                                }`}
                              >
                                <option value="NONE">Pendent</option>
                                <option value="SEITO">Seito</option>
                                <option value="LOGISTIK">Logistik</option>
                              </select>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleViewPdf(inv)}
                                className="p-1 rounded hover:bg-blue-50 text-blue-600"
                                title="Veure PDF"
                              >
                                <Eye size={13} />
                              </button>
                              <button
                                onClick={() => handleDownloadPdf(inv)}
                                className="p-1 rounded hover:bg-green-50 text-green-600"
                                title="Descarregar PDF"
                              >
                                <Download size={13} />
                              </button>
                              {!isLocked && (
                                <button
                                  onClick={() => { setEditingId(inv.id); setEditPercent(parseFloat(inv.sharedPercentSeito)); }}
                                  className="p-1 rounded hover:bg-muted text-muted-foreground"
                                  title="Editar percentatge"
                                >
                                  <Pencil size={13} />
                                </button>
                              )}
                              {inv.gdriveFileId && (
                                <a
                                  href={`https://drive.google.com/file/d/${inv.gdriveFileId}/view`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1 rounded hover:bg-muted text-blue-500"
                                  title="Obrir al Drive"
                                >
                                  <ExternalLink size={13} />
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* Modal de confirmació */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmAction(null)}>
          <div className="bg-card rounded-lg shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            {confirmAction.type === 'lock' && (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-full bg-amber-100"><Lock size={20} className="text-amber-600" /></div>
                  <h3 className="text-lg font-semibold">Tancar {confirmAction.group.label}?</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Un cop tancat, no es podran editar els percentatges ni el camp &quot;Pagat per&quot; de les {confirmAction.group.invoices.length} factures d&apos;aquest període. Podràs desbloquejar-ho més tard si cal.
                </p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setConfirmAction(null)} className="px-4 py-2 rounded-md border text-sm hover:bg-muted">Cancel·lar</button>
                  <button onClick={() => handleLock(confirmAction.group)} className="px-4 py-2 rounded-md bg-amber-600 text-white text-sm hover:bg-amber-700">Tancar període</button>
                </div>
              </>
            )}
            {confirmAction.type === 'unlock' && (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-full bg-gray-100"><Unlock size={20} className="text-gray-600" /></div>
                  <h3 className="text-lg font-semibold">Reobrir {confirmAction.group.label}?</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Això desbloquejarà el període i anul·larà la compensació si n&apos;hi havia. Es podran tornar a editar les factures.
                </p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setConfirmAction(null)} className="px-4 py-2 rounded-md border text-sm hover:bg-muted">Cancel·lar</button>
                  <button onClick={() => handleUnlock(confirmAction.group)} className="px-4 py-2 rounded-md bg-gray-600 text-white text-sm hover:bg-gray-700">Reobrir</button>
                </div>
              </>
            )}
            {confirmAction.type === 'compensate' && (() => {
              // Calcular resum
              const invs = confirmAction.group.invoices;
              let totalSeito = 0, totalLogistik = 0, seitoPaid = 0, logistikPaid = 0, pendingCount = 0;
              for (const inv of invs) {
                const total = parseFloat(inv.totalAmount);
                totalSeito += inv.amountSeito;
                totalLogistik += inv.amountLogistik;
                if (inv.paidBy === 'SEITO') seitoPaid += total;
                else if (inv.paidBy === 'LOGISTIK') logistikPaid += total;
                else pendingCount++;
              }
              const seitoBalance = seitoPaid - totalSeito;

              return (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 rounded-full bg-emerald-100"><HandCoins size={20} className="text-emerald-600" /></div>
                    <h3 className="text-lg font-semibold">Compensar {confirmAction.group.label}?</h3>
                  </div>

                  {pendingCount > 0 ? (
                    <div className="mb-4">
                      <p className="text-sm text-red-600 font-medium mb-2">
                        Hi ha {pendingCount} factures sense &quot;Pagat per&quot; assignat.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Cal indicar qui ha pagat cada factura abans de poder compensar.
                      </p>
                      <div className="flex justify-end gap-2 mt-4">
                        <button onClick={() => setConfirmAction(null)} className="px-4 py-2 rounded-md border text-sm hover:bg-muted">Entesos</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="bg-muted/50 rounded-lg p-3 mb-4 text-sm space-y-1">
                        <div className="flex justify-between"><span>Part Seito:</span><span className="font-medium text-blue-600">{formatCurrency(totalSeito)}</span></div>
                        <div className="flex justify-between"><span>Part Logistik:</span><span className="font-medium text-orange-600">{formatCurrency(totalLogistik)}</span></div>
                        <div className="border-t my-2"></div>
                        <div className="flex justify-between"><span>Pagat per Seito:</span><span>{formatCurrency(seitoPaid)}</span></div>
                        <div className="flex justify-between"><span>Pagat per Logistik:</span><span>{formatCurrency(logistikPaid)}</span></div>
                        <div className="border-t my-2"></div>
                        <div className="flex justify-between font-semibold">
                          <span>Resultat:</span>
                          <span className={seitoBalance > 0.01 ? 'text-orange-600' : seitoBalance < -0.01 ? 'text-blue-600' : 'text-emerald-600'}>
                            {seitoBalance > 0.01
                              ? `Logistik paga ${formatCurrency(seitoBalance)} a Seito`
                              : seitoBalance < -0.01
                              ? `Seito paga ${formatCurrency(Math.abs(seitoBalance))} a Logistik`
                              : 'Equilibrat — no cal compensar'}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground mb-4">
                        Això tancarà el període i registrarà la compensació.
                      </p>
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setConfirmAction(null)} className="px-4 py-2 rounded-md border text-sm hover:bg-muted">Cancel·lar</button>
                        <button onClick={() => handleCompensate(confirmAction.group)} className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700">Compensar i tancar</button>
                      </div>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modal PDF */}
      {pdfInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closePdfModal}>
          <div className="bg-card rounded-lg shadow-xl w-[90vw] h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">{pdfInvoice.invoiceNumber}</h3>
                <span className="text-xs text-muted-foreground">{pdfInvoice.supplier?.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleDownloadPdf(pdfInvoice)} className="p-1.5 rounded hover:bg-green-50 text-green-600" title="Descarregar">
                  <Download size={16} />
                </button>
                <button onClick={closePdfModal} className="p-1.5 rounded hover:bg-muted text-muted-foreground">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="flex-1 p-2">
              {pdfUrl ? (
                <iframe src={pdfUrl} className="w-full h-full rounded border" title="PDF" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  Carregant PDF...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
