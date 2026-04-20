import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Pencil } from 'lucide-react';
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

  const { data, loading, refetch } = useApiGet('/shared-invoices', { year, groupBy });

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Factures compartides</h2>
          <p className="text-sm text-muted-foreground mt-1">SEITO · LOGISTIK — Repartiment de costos</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm">
            <option value="month">Per mes</option>
            <option value="quarter">Per trimestre</option>
          </select>
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value))} className="rounded-md border bg-background px-3 py-2 text-sm">
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
              <button
                onClick={() => toggleGroup(group.key)}
                className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
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

              {/* Detall factures */}
              {expanded[group.key] && (
                <div className="border-t">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="text-left p-3 font-medium">Factura</th>
                        <th className="text-left p-3 font-medium">Proveïdor</th>
                        <th className="text-left p-3 font-medium">Data</th>
                        <th className="text-right p-3 font-medium">Total</th>
                        <th className="text-right p-3 font-medium text-blue-600">Seito</th>
                        <th className="text-right p-3 font-medium text-orange-600">Logistik</th>
                        <th className="text-center p-3 font-medium">%</th>
                        <th className="text-right p-3 font-medium">Accions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.invoices.map((inv) => (
                        <tr key={inv.id} className="border-t hover:bg-muted/20">
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
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1">
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
    </div>
  );
}
