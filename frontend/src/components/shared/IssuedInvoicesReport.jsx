import { useState, useMemo } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Calendar, TrendingUp, CreditCard, Clock, Users, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { StatusBadge } from './StatusBadge';

const MONTH_LABELS = ['Gen', 'Feb', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Des'];

function formatMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MONTH_LABELS[parseInt(m, 10) - 1] || m} ${y.slice(2)}`;
}

const STATUS_COLORS = {
  PAID: '#10b981',
  APPROVED: '#3b82f6',
  PENDING: '#f59e0b',
  REJECTED: '#ef4444',
  PARTIALLY_PAID: '#8b5cf6',
};

const STATUS_LABELS = {
  PAID: 'Pagada',
  APPROVED: 'Aprovada',
  PENDING: 'Pendent',
  REJECTED: 'Rebutjada',
  PARTIALLY_PAID: 'Parcial',
};

function getPresetDates(preset) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'thisMonth':
      return { from: `${y}-${String(m + 1).padStart(2, '0')}-01`, to: new Date(y, m + 1, 0).toISOString().slice(0, 10) };
    case 'lastMonth': {
      const lm = m === 0 ? 11 : m - 1;
      const ly = m === 0 ? y - 1 : y;
      return { from: `${ly}-${String(lm + 1).padStart(2, '0')}-01`, to: new Date(ly, lm + 1, 0).toISOString().slice(0, 10) };
    }
    case 'thisQuarter': {
      const qStart = Math.floor(m / 3) * 3;
      return { from: `${y}-${String(qStart + 1).padStart(2, '0')}-01`, to: new Date(y, qStart + 3, 0).toISOString().slice(0, 10) };
    }
    case 'lastQuarter': {
      let qStart = Math.floor(m / 3) * 3 - 3;
      let qy = y;
      if (qStart < 0) { qStart += 12; qy -= 1; }
      return { from: `${qy}-${String(qStart + 1).padStart(2, '0')}-01`, to: new Date(qy, qStart + 3, 0).toISOString().slice(0, 10) };
    }
    case 'thisYear':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'lastYear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default:
      return { from: '', to: '' };
  }
}

export default function IssuedInvoicesReport() {
  const [isOpen, setIsOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activePreset, setActivePreset] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAllClients, setShowAllClients] = useState(false);
  const [showAllInvoices, setShowAllInvoices] = useState(false);

  const applyPreset = (preset) => {
    const { from, to } = getPresetDates(preset);
    setDateFrom(from);
    setDateTo(to);
    setActivePreset(preset);
    fetchReport(from, to);
  };

  const fetchReport = async (from, to) => {
    if (!from || !to) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/invoices/issued/report', { params: { from, to } });
      setReport(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setReport(null);
    }
    setLoading(false);
  };

  const handleCustomFetch = () => {
    setActivePreset('custom');
    fetchReport(dateFrom, dateTo);
  };

  const monthChartData = useMemo(() => {
    if (!report?.byMonth) return [];
    return report.byMonth.map(m => ({
      name: formatMonth(m.month),
      Pagat: Math.round(m.paid * 100) / 100,
      Pendent: Math.round(m.pending * 100) / 100,
      Total: Math.round(m.total * 100) / 100,
    }));
  }, [report]);

  const pieData = useMemo(() => {
    if (!report?.byStatus) return [];
    return Object.entries(report.byStatus).map(([status, data]) => ({
      name: STATUS_LABELS[status] || status,
      value: Math.round(data.total * 100) / 100,
      count: data.count,
      color: STATUS_COLORS[status] || '#94a3b8',
    }));
  }, [report]);

  const clientsToShow = report?.byClient ? (showAllClients ? report.byClient : report.byClient.slice(0, 10)) : [];
  const invoicesToShow = report?.invoices ? (showAllInvoices ? report.invoices : report.invoices.slice(0, 20)) : [];

  const presets = [
    { key: 'thisMonth', label: 'Aquest mes' },
    { key: 'lastMonth', label: 'Mes anterior' },
    { key: 'thisQuarter', label: 'Trimestre actual' },
    { key: 'lastQuarter', label: 'Trimestre anterior' },
    { key: 'thisYear', label: 'Any actual' },
    { key: 'lastYear', label: 'Any anterior' },
  ];

  return (
    <div className="mb-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm font-medium text-primary hover:underline mb-2"
      >
        <TrendingUp size={16} />
        Informe per període
        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {isOpen && (
        <div className="bg-card border rounded-lg p-4 space-y-4">
          {/* Selector de període */}
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {presets.map(p => (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    activePreset === p.key
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:bg-muted'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-muted-foreground" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-md border bg-background px-3 py-1.5 text-sm"
              />
              <span className="text-muted-foreground text-sm">—</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-md border bg-background px-3 py-1.5 text-sm"
              />
              <button
                onClick={handleCustomFetch}
                disabled={!dateFrom || !dateTo || loading}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50"
              >
                {loading ? 'Carregant…' : 'Consultar'}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {report && (
            <div className="space-y-6">
              {/* Targetes resum */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-background rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <FileText size={13} /> Factures
                  </div>
                  <p className="text-xl font-bold">{report.summary.count}</p>
                </div>
                <div className="bg-background rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <TrendingUp size={13} /> Total facturat
                  </div>
                  <p className="text-xl font-bold">{formatCurrency(report.summary.total)}</p>
                </div>
                <div className="bg-background rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs text-emerald-600 mb-1">
                    <CreditCard size={13} /> Cobrat
                  </div>
                  <p className="text-xl font-bold text-emerald-600">{formatCurrency(report.summary.paid)}</p>
                </div>
                <div className="bg-background rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs text-amber-600 mb-1">
                    <Clock size={13} /> Pendent
                  </div>
                  <p className="text-xl font-bold text-amber-600">{formatCurrency(report.summary.pending)}</p>
                </div>
              </div>

              {/* Gràfics */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Barres per mes */}
                {monthChartData.length > 0 && (
                  <div className="lg:col-span-2 bg-background rounded-lg border p-3">
                    <h4 className="text-sm font-semibold mb-3">Facturació mensual</h4>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={monthChartData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                        <Tooltip formatter={(v) => formatCurrency(v)} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="Pagat" fill="#10b981" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="Pendent" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Pastís per estat */}
                {pieData.length > 0 && (
                  <div className="bg-background rounded-lg border p-3">
                    <h4 className="text-sm font-semibold mb-3">Per estat</h4>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          innerRadius={40}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {pieData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => formatCurrency(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-2 mt-2 justify-center">
                      {pieData.map((d, i) => (
                        <span key={i} className="flex items-center gap-1 text-xs">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                          {d.name}: {d.count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Taula resum per client */}
              {report.byClient?.length > 0 && (
                <div className="bg-background rounded-lg border overflow-hidden">
                  <div className="flex items-center gap-2 p-3 border-b">
                    <Users size={14} className="text-muted-foreground" />
                    <h4 className="text-sm font-semibold">Resum per client</h4>
                    <span className="text-xs text-muted-foreground">({report.byClient.length} clients)</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2.5 text-xs font-semibold text-muted-foreground uppercase">Client</th>
                        <th className="text-center p-2.5 text-xs font-semibold text-muted-foreground uppercase">Factures</th>
                        <th className="text-right p-2.5 text-xs font-semibold text-muted-foreground uppercase">Total</th>
                        <th className="text-right p-2.5 text-xs font-semibold text-muted-foreground uppercase">Cobrat</th>
                        <th className="text-right p-2.5 text-xs font-semibold text-muted-foreground uppercase">Pendent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientsToShow.map((c, i) => (
                        <tr key={i} className="border-t hover:bg-muted/30">
                          <td className="p-2.5 font-medium">{c.name}</td>
                          <td className="p-2.5 text-center text-muted-foreground">{c.count}</td>
                          <td className="p-2.5 text-right font-medium">{formatCurrency(c.total)}</td>
                          <td className="p-2.5 text-right text-emerald-600">{formatCurrency(c.paid)}</td>
                          <td className="p-2.5 text-right text-amber-600">{c.pending > 0 ? formatCurrency(c.pending) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {report.byClient.length > 10 && (
                    <div className="p-2 border-t text-center">
                      <button onClick={() => setShowAllClients(!showAllClients)} className="text-xs text-primary hover:underline">
                        {showAllClients ? 'Mostrar menys' : `Veure tots (${report.byClient.length})`}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Llistat de factures */}
              {report.invoices?.length > 0 && (
                <div className="bg-background rounded-lg border overflow-hidden">
                  <div className="flex items-center gap-2 p-3 border-b">
                    <FileText size={14} className="text-muted-foreground" />
                    <h4 className="text-sm font-semibold">Detall factures</h4>
                    <span className="text-xs text-muted-foreground">({report.invoices.length} factures)</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2.5 text-xs font-semibold text-muted-foreground uppercase">Número</th>
                        <th className="text-left p-2.5 text-xs font-semibold text-muted-foreground uppercase">Client</th>
                        <th className="text-left p-2.5 text-xs font-semibold text-muted-foreground uppercase">Data</th>
                        <th className="text-left p-2.5 text-xs font-semibold text-muted-foreground uppercase">Venciment</th>
                        <th className="text-right p-2.5 text-xs font-semibold text-muted-foreground uppercase">Import</th>
                        <th className="text-center p-2.5 text-xs font-semibold text-muted-foreground uppercase">Estat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoicesToShow.map((inv) => (
                        <tr key={inv.id} className="border-t hover:bg-muted/30">
                          <td className="p-2.5 font-medium">{inv.invoiceNumber}</td>
                          <td className="p-2.5">{inv.client?.name}</td>
                          <td className="p-2.5 text-muted-foreground">{formatDate(inv.issueDate)}</td>
                          <td className="p-2.5 text-muted-foreground">{inv.dueDate ? formatDate(inv.dueDate) : '—'}</td>
                          <td className="p-2.5 text-right font-medium">{formatCurrency(inv.totalAmount)}</td>
                          <td className="p-2.5 text-center"><StatusBadge status={inv.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {report.invoices.length > 20 && (
                    <div className="p-2 border-t text-center">
                      <button onClick={() => setShowAllInvoices(!showAllInvoices)} className="text-xs text-primary hover:underline">
                        {showAllInvoices ? 'Mostrar menys' : `Veure totes (${report.invoices.length})`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
