import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Pencil, Eye, Download, X, FileText, CheckSquare } from 'lucide-react';
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

  const { data, loading, refetch } = useApiGet('/shared-invoices', { year, groupBy });

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
    } catch {}
  };

  const handlePaidByChange = async (invoiceId, paidBy) => {
    try {
      await api.patch(`/shared-invoices/${invoiceId}`, { paidBy });
      refetch();
    } catch {
      alert('Error actualitzant el pagament');
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

      {/* Grups */}
      {loading ? (
        <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">Carregant...</div>
      ) : !data?.groups?.length ? (
        <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">
          Cap factura compartida aquest any. Marca factures com a compartides des de l'edició de factures rebudes.
        </div>
      ) : (
        <div className="space-y-3">
          {data.groups.map((group) => (
            <div key={group.key} className="bg-card border rounded-lg overflow-hidden">
              {/* Capçalera del grup */}
              <div className="flex items-center p-4 hover:bg-muted/30 transition-colors">
                <input
                  type="checkbox"
                  checked={group.invoices.every((inv) => selectedIds.includes(inv.id))}
                  onChange={() => toggleSelectGroup(group)}
                  className="mr-3 h-4 w-4 rounded border-gray-300 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="flex-1 flex items-center justify-between"
                >
                <div className="flex items-center gap-3">
                  {expanded[group.key] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="font-medium">{group.label}</span>
                  <span className="text-xs text-muted-foreground">({group.invoices.length} factures)</span>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <span className="text-muted-foreground">{formatCurrency(group.totalAmount)}</span>
                  <span className="text-blue-600 font-medium">{formatCurrency(group.totalSeito)}</span>
                  <span className="text-orange-600 font-medium">{formatCurrency(group.totalLogistik)}</span>
                </div>
                </button>
              </div>

              {/* Detall factures */}
              {expanded[group.key] && (
                <div className="border-t">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="p-3 w-8"></th>
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
                          <td className="p-3">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(inv.id)}
                              onChange={() => toggleSelect(inv.id)}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                          </td>
                          <td className="p-3 font-mono text-xs">{inv.invoiceNumber}</td>
                          <td className="p-3 text-muted-foreground">{inv.supplier?.name || '—'}</td>
                          <td className="p-3 text-muted-foreground">{formatDate(inv.issueDate)}</td>
                          <td className="p-3 text-right font-medium">{formatCurrency(parseFloat(inv.totalAmount))}</td>
                          <td className="p-3 text-right text-blue-600">{formatCurrency(inv.amountSeito)}</td>
                          <td className="p-3 text-right text-orange-600">{formatCurrency(inv.amountLogistik)}</td>
                          <td className="p-3 text-center">
                            {editingId === inv.id ? (
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
                              <button
                                onClick={() => { setEditingId(inv.id); setEditPercent(parseFloat(inv.sharedPercentSeito)); }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground"
                                title="Editar percentatge"
                              >
                                <Pencil size={13} />
                              </button>
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
          ))}
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
