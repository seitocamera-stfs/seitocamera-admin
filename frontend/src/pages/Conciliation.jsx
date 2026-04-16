import { useState, useEffect } from 'react';
import { Zap, Check, X as XIcon, Search, FileText, Eye, ChevronLeft, ChevronRight, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import { StatusBadge } from '../components/shared/StatusBadge';
import { formatCurrency, formatDate } from '../lib/utils';
import ExportButtons from '../components/shared/ExportButtons';
import IssuedInvoiceDetailModal from '../components/shared/IssuedInvoiceDetailModal';
import api from '../lib/api';

// ===========================================
// Pàgina de Conciliació estil Xero
// Layout: Moviments bancaris (esquerra) ↔ Factures candidates (dreta)
// ===========================================

export default function Conciliation() {
  const [tab, setTab] = useState('pending'); // pending, matched, confirmed
  const [page, setPage] = useState(1);
  const [selectedMovement, setSelectedMovement] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [searchingCandidates, setSearchingCandidates] = useState(false);
  const [manualSearch, setManualSearch] = useState('');
  const [searchType, setSearchType] = useState('auto');
  const [detailInvoice, setDetailInvoice] = useState(null);
  const { mutate, loading: mutating } = useApiMutation();

  // Carregar detalls complets d'una factura emesa (per popup)
  const handleViewIssuedDetails = async (id) => {
    try {
      const { data } = await api.get(`/invoices/issued/${id}`);
      setDetailInvoice(data);
    } catch (err) {
      alert('Error carregant detalls: ' + err.message);
    }
  };

  // Dades segons la pestanya
  const pendingQuery = useApiGet('/bank', { conciliated: 'false', page, limit: 15 });
  const matchedQuery = useApiGet('/conciliation', { status: tab === 'confirmed' ? 'CONFIRMED' : 'AUTO_MATCHED', page, limit: 15 });

  const isPending = tab === 'pending';
  const activeQuery = isPending ? pendingQuery : matchedQuery;
  const movements = isPending ? (activeQuery.data?.data || []) : [];
  const conciliations = !isPending ? (activeQuery.data?.data || []) : [];

  // Stats
  const statsQuery = useApiGet('/bank/stats/summary');
  const concCount = useApiGet('/conciliation', { limit: 1 });

  // Quan seleccionem un moviment, buscar candidats automàticament
  useEffect(() => {
    if (selectedMovement && isPending) {
      findCandidates(selectedMovement);
    }
  }, [selectedMovement]);

  const findCandidates = async (movement) => {
    setSearchingCandidates(true);
    setCandidates([]);
    const absAmount = Math.abs(parseFloat(movement.amount));
    const isExpense = parseFloat(movement.amount) < 0;
    const searchTerm = movement.counterparty || movement.description || '';

    try {
      // Buscar per nom del contrapart
      const endpoint = isExpense ? '/invoices/received' : '/invoices/issued';
      const { data } = await api.get(endpoint, { params: { search: searchTerm, limit: 30 } });
      let results = (data.data || []).map(inv => ({ ...inv, _type: isExpense ? 'received' : 'issued' }));

      // Buscar també per import si no hi ha resultats per nom
      if (results.length === 0 && absAmount > 0) {
        const { data: data2 } = await api.get(endpoint, { params: { search: absAmount.toString(), limit: 20 } });
        results = (data2.data || []).map(inv => ({ ...inv, _type: isExpense ? 'received' : 'issued' }));
      }

      // Ordenar: primer els que coincideixen en import
      results.sort((a, b) => {
        const aDiff = Math.abs(parseFloat(a.totalAmount) - absAmount);
        const bDiff = Math.abs(parseFloat(b.totalAmount) - absAmount);
        return aDiff - bDiff;
      });

      setCandidates(results);
    } catch (err) {
      console.error(err);
    }
    setSearchingCandidates(false);
  };

  // Cerca manual de factures
  const handleManualSearch = async () => {
    if (!manualSearch.trim() || !selectedMovement) return;
    setSearchingCandidates(true);
    try {
      const isExpense = parseFloat(selectedMovement.amount) < 0;
      const type = searchType === 'auto' ? (isExpense ? 'received' : 'issued') : searchType;
      const endpoint = type === 'received' ? '/invoices/received' : '/invoices/issued';
      const { data } = await api.get(endpoint, { params: { search: manualSearch, limit: 30 } });
      setCandidates((data.data || []).map(inv => ({ ...inv, _type: type })));
    } catch (err) {
      console.error(err);
    }
    setSearchingCandidates(false);
  };

  // Conciliar manualment
  const handleMatch = async (movement, invoice) => {
    try {
      await mutate('post', '/conciliation/manual', {
        bankMovementId: movement.id,
        receivedInvoiceId: invoice._type === 'received' ? invoice.id : null,
        issuedInvoiceId: invoice._type === 'issued' ? invoice.id : null,
      });
      setSelectedMovement(null);
      setCandidates([]);
      pendingQuery.refetch();
      matchedQuery.refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error conciliant');
    }
  };

  // Auto-conciliar tots
  const handleAutoMatch = async () => {
    try {
      const result = await mutate('post', '/conciliation/auto');
      alert(`Processats: ${result.processed} | Conciliats: ${result.matched} | Sense match: ${result.unmatched}`);
      pendingQuery.refetch();
      matchedQuery.refetch();
    } catch (err) {
      alert(err.message);
    }
  };

  // Confirmar conciliació
  const handleConfirm = async (id) => {
    await mutate('patch', `/conciliation/${id}/confirm`);
    matchedQuery.refetch();
  };

  // Rebutjar conciliació (esborrar vincle)
  const handleReject = async (id) => {
    await mutate('patch', `/conciliation/${id}/reject`);
    matchedQuery.refetch();
    pendingQuery.refetch();
  };

  // Veure PDF
  const handleViewPdf = async (invoice) => {
    try {
      const response = await api.get(`/invoices/received/${invoice.id}/pdf`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      window.open(window.URL.createObjectURL(blob), '_blank');
    } catch {}
  };

  const pagination = activeQuery.data?.pagination;

  return (
    <div>
      {/* Capçalera */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold">Conciliació bancària</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {statsQuery.data?.unconciliated || 0} moviments pendents de conciliar
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportButtons
            endpoint="/export/conciliations"
            filters={{}}
            filenameBase="conciliacions"
          />
          <button onClick={handleAutoMatch} disabled={mutating} className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-teal-700 disabled:opacity-50">
            <Zap size={16} /> {mutating ? 'Processant...' : 'Auto-conciliar'}
          </button>
        </div>
      </div>

      {/* Pestanyes */}
      <div className="flex border-b mb-4">
        <button onClick={() => { setTab('pending'); setPage(1); setSelectedMovement(null); }} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'pending' ? 'border-teal-600 text-teal-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          Per conciliar ({statsQuery.data?.unconciliated || 0})
        </button>
        <button onClick={() => { setTab('matched'); setPage(1); }} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'matched' ? 'border-teal-600 text-teal-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          Per confirmar
        </button>
        <button onClick={() => { setTab('confirmed'); setPage(1); }} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'confirmed' ? 'border-teal-600 text-teal-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          Confirmades
        </button>
      </div>

      {/* TAB: Per conciliar — Layout Xero */}
      {isPending && (
        <div className="grid grid-cols-2 gap-4">
          {/* ESQUERRA: Moviments bancaris */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Moviments bancaris</h3>
            <div className="space-y-2">
              {activeQuery.loading ? (
                <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">Carregant...</div>
              ) : movements.length === 0 ? (
                <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">Tots els moviments estan conciliats!</div>
              ) : (
                movements.map((m) => {
                  const isSelected = selectedMovement?.id === m.id;
                  const isExpense = parseFloat(m.amount) < 0;
                  return (
                    <div
                      key={m.id}
                      onClick={() => setSelectedMovement(isSelected ? null : m)}
                      className={`bg-card border rounded-lg p-3 cursor-pointer transition-all ${isSelected ? 'ring-2 ring-teal-500 border-teal-500' : 'hover:border-muted-foreground/30'}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            {isExpense ? <ArrowUpCircle size={14} className="text-red-500" /> : <ArrowDownCircle size={14} className="text-green-500" />}
                            <span className="font-medium text-sm">{m.counterparty || m.description}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 ml-6">
                            {formatDate(m.date)} {m.reference ? `· ${m.reference}` : ''} {m.accountName ? `· ${m.accountName}` : ''}
                          </div>
                        </div>
                        <div className={`font-semibold text-sm ${isExpense ? 'text-red-600' : 'text-green-600'}`}>
                          {isExpense ? '-' : '+'}{formatCurrency(Math.abs(parseFloat(m.amount)))}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* DRETA: Factures candidates */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              {selectedMovement ? 'Factures candidates' : 'Selecciona un moviment'}
            </h3>

            {selectedMovement ? (
              <div className="space-y-3">
                {/* Cerca manual */}
                <div className="flex gap-2">
                  <select value={searchType} onChange={(e) => setSearchType(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-xs">
                    <option value="auto">Auto</option>
                    <option value="received">Rebudes</option>
                    <option value="issued">Emeses</option>
                  </select>
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={manualSearch}
                      onChange={(e) => setManualSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                      placeholder="Cercar factura..."
                      className="w-full pl-8 pr-3 py-1.5 rounded-md border bg-background text-xs"
                    />
                  </div>
                  <button onClick={handleManualSearch} className="px-3 py-1.5 rounded-md bg-muted text-xs font-medium hover:bg-muted/80">
                    Cercar
                  </button>
                </div>

                {/* Candidates */}
                {searchingCandidates ? (
                  <div className="bg-card border rounded-lg p-6 text-center text-muted-foreground text-sm">Cercant factures...</div>
                ) : candidates.length === 0 ? (
                  <div className="bg-card border rounded-lg p-6 text-center text-muted-foreground text-sm">
                    Cap factura candidata trobada. Prova la cerca manual.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                    {candidates.map((inv) => {
                      const absMovAmount = Math.abs(parseFloat(selectedMovement.amount));
                      const invAmount = parseFloat(inv.totalAmount);
                      const amountMatch = Math.abs(invAmount - absMovAmount) < 0.02;
                      const entityName = inv._type === 'received' ? inv.supplier?.name : inv.client?.name;

                      return (
                        <div key={inv.id} className={`bg-card border rounded-lg p-3 ${amountMatch ? 'border-green-300 bg-green-50/30' : ''}`}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{inv.invoiceNumber}</span>
                                {amountMatch && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Import coincident</span>}
                                {inv._type === 'received' && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Rebuda</span>}
                                {inv._type === 'issued' && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Emesa</span>}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {entityName || '—'} · {formatDate(inv.issueDate)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-semibold text-sm">{formatCurrency(inv.totalAmount)}</div>
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t">
                            {inv._type === 'received' && (inv.gdriveFileId || inv.hasPdf) && (
                              <button onClick={() => handleViewPdf(inv)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                <FileText size={12} /> Veure PDF
                              </button>
                            )}
                            {inv._type === 'issued' && (
                              <button
                                onClick={() => handleViewIssuedDetails(inv.id)}
                                className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
                              >
                                <Eye size={12} /> Veure detalls
                              </button>
                            )}
                            <button
                              onClick={() => handleMatch(selectedMovement, inv)}
                              className="px-4 py-1.5 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700"
                            >
                              OK
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-card border rounded-lg p-12 text-center text-muted-foreground">
                <Search size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">Clica un moviment bancari per veure les factures candidates</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: Per confirmar / Confirmades */}
      {!isPending && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium text-xs text-muted-foreground uppercase">Moviment</th>
                <th className="text-right p-3 font-medium text-xs text-muted-foreground uppercase">Import</th>
                <th className="text-left p-3 font-medium text-xs text-muted-foreground uppercase">Factura vinculada</th>
                <th className="text-center p-3 font-medium text-xs text-muted-foreground uppercase">Confiança</th>
                <th className="text-right p-3 font-medium text-xs text-muted-foreground uppercase">Accions</th>
              </tr>
            </thead>
            <tbody>
              {activeQuery.loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Carregant...</td></tr>
              ) : conciliations.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Cap conciliació en aquest estat.</td></tr>
              ) : (
                conciliations.map((c) => {
                  const invoice = c.receivedInvoice || c.issuedInvoice;
                  const invoiceLabel = c.receivedInvoice
                    ? `${c.receivedInvoice.invoiceNumber} (${c.receivedInvoice.supplier?.name || ''})`
                    : c.issuedInvoice
                      ? `${c.issuedInvoice.invoiceNumber} (${c.issuedInvoice.client?.name || ''})`
                      : '—';

                  return (
                    <tr key={c.id} className="border-t hover:bg-muted/30">
                      <td className="p-3">
                        <div className="font-medium">{c.bankMovement?.description}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(c.bankMovement?.date)}</div>
                      </td>
                      <td className={`p-3 text-right font-medium ${parseFloat(c.bankMovement?.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(Math.abs(parseFloat(c.bankMovement?.amount || 0)))}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span>{invoice ? invoiceLabel : <span className="text-muted-foreground italic">Sense factura</span>}</span>
                          {c.receivedInvoice && (c.receivedInvoice.gdriveFileId || c.receivedInvoice.filePath) && (
                            <button onClick={() => handleViewPdf(c.receivedInvoice)} className="p-1 rounded hover:bg-blue-50 text-blue-600" title="Veure PDF">
                              <FileText size={14} />
                            </button>
                          )}
                          {c.issuedInvoice && (
                            <button
                              onClick={() => handleViewIssuedDetails(c.issuedInvoice.id)}
                              className="p-1 rounded hover:bg-indigo-50 text-indigo-600"
                              title="Veure detalls factura emesa"
                            >
                              <Eye size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-center text-xs">
                        {c.confidence ? `${Math.round(c.confidence * 100)}%` : '—'}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {(c.status === 'AUTO_MATCHED' || c.status === 'MANUAL_MATCHED') && (
                            <>
                              <button onClick={() => handleConfirm(c.id)} className="px-2 py-1 rounded bg-green-600 text-white text-xs font-medium hover:bg-green-700">Confirmar</button>
                              <button onClick={() => handleReject(c.id)} className="px-2 py-1 rounded bg-red-100 text-red-700 text-xs font-medium hover:bg-red-200">Rebutjar</button>
                            </>
                          )}
                          {c.status === 'CONFIRMED' && (
                            <span className="text-xs text-green-600 font-medium flex items-center gap-1"><Check size={12} /> Confirmada</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginació */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between p-3 text-sm mt-2">
          <span className="text-muted-foreground">{pagination.total} registres</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1 rounded border disabled:opacity-50 flex items-center gap-1">
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="px-3 py-1">{page} / {pagination.totalPages}</span>
            <button onClick={() => setPage(Math.min(pagination.totalPages, page + 1))} disabled={page >= pagination.totalPages} className="px-3 py-1 rounded border disabled:opacity-50 flex items-center gap-1">
              Següent <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Popup detalls factura emesa (sense PDF) */}
      <IssuedInvoiceDetailModal
        isOpen={!!detailInvoice}
        onClose={() => setDetailInvoice(null)}
        invoice={detailInvoice}
      />
    </div>
  );
}
