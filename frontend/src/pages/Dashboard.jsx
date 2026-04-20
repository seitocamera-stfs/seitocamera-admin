import { useState, useMemo } from 'react';
import {
  FileInput, FileOutput, Landmark, Bell, Calendar,
  TrendingUp, Users, Building2, PieChart as PieIcon,
  AlertTriangle, Clock, CreditCard, CheckCircle2,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useApiGet } from '../hooks/useApi';
import { formatCurrency } from '../lib/utils';
import api from '../lib/api';
import useAuthStore from '../stores/authStore';
import { canSeeDashboardPanel } from '../lib/permissions';

// ===========================================
// Helpers
// ===========================================

// Format YYYY-MM → "gen 2026" (català)
const MONTH_LABELS = ['gen', 'feb', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'des'];
function formatMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MONTH_LABELS[parseInt(m, 10) - 1] || m} ${y.slice(2)}`;
}

// Labels per estats de factura
const STATUS_LABELS = {
  PENDING: 'Pendent',
  PDF_PENDING: 'Cal revisar',
  REVIEWED: 'Revisada',
  APPROVED: 'Aprovada',
  REJECTED: 'Rebutjada',
  PAID: 'Pagada',
  PARTIALLY_PAID: 'Pagament parcial',
  NOT_INVOICE: 'No és factura',
};
const STATUS_COLORS = {
  PENDING: '#f59e0b',
  PDF_PENDING: '#ea580c',
  REVIEWED: '#3b82f6',
  APPROVED: '#0d9488',
  REJECTED: '#dc2626',
  PAID: '#16a34a',
  PARTIALLY_PAID: '#84cc16',
  NOT_INVOICE: '#9ca3af',
};

// Paleta de colors per línies/barres
const CHART_COLORS = ['#0d9488', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#10b981'];

// Preset de rang (últims N mesos fins avui)
function getRangePreset(months) {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  };
}

// Format intel·ligent per l'eix Y (adapta unitats: €, k€, M€)
function formatYAxis(value) {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value.toFixed(0);
}

// Tooltip personalitzat per moneda
function CurrencyTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-card border rounded-md p-2 shadow-lg text-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

// ===========================================
// Component
// ===========================================

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);

  // Estat: rang de dates configurable (per defecte any natural)
  const currentYear = new Date().getFullYear();
  const [dateFrom, setDateFrom] = useState(`${currentYear}-01-01`);
  const [dateTo, setDateTo] = useState(`${currentYear}-12-31`);

  // Stats unificades del backend (quan l'usuari pot veure algun panell de dashboard)
  const canSeeDashboard = user?.role === 'ADMIN' || user?.role === 'EDITOR'
    || canSeeDashboardPanel(user, 'receivedPending')
    || canSeeDashboardPanel(user, 'issuedPending');

  const { data: stats, loading: statsLoading, refetch: refetchStats } = useApiGet(
    canSeeDashboard ? '/dashboard/stats' : null,
    { from: dateFrom, to: dateTo }
  );

  // Estat: rang de dates per Top Clients/Proveïdors (independent)
  const [topPeriod, setTopPeriod] = useState('year'); // 'year', '3m', '6m', '12m', 'all'
  const topRange = useMemo(() => {
    const now = new Date();
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    if (topPeriod === 'year') return { from: `${currentYear}-01-01`, to: `${currentYear}-12-31` };
    if (topPeriod === '3m') { const f = new Date(now.getFullYear(), now.getMonth() - 2, 1); return { from: f.toISOString().split('T')[0], to: to.toISOString().split('T')[0] }; }
    if (topPeriod === '6m') { const f = new Date(now.getFullYear(), now.getMonth() - 5, 1); return { from: f.toISOString().split('T')[0], to: to.toISOString().split('T')[0] }; }
    if (topPeriod === '12m') { const f = new Date(now.getFullYear(), now.getMonth() - 11, 1); return { from: f.toISOString().split('T')[0], to: to.toISOString().split('T')[0] }; }
    if (topPeriod === 'all') return { from: '2020-01-01', to: `${currentYear}-12-31` };
    return { from: `${currentYear}-01-01`, to: `${currentYear}-12-31` };
  }, [topPeriod, currentYear]);

  const { data: topData, loading: topLoading } = useApiGet(
    canSeeDashboard ? '/dashboard/top' : null,
    topRange
  );

  // Dades addicionals dels panells existents
  const { data: receivedData } = useApiGet(
    canSeeDashboardPanel(user, 'recentReceived')
      ? '/invoices/received' : null,
    { status: 'PENDING', limit: 5 }
  );
  const { data: bankData } = useApiGet(
    canSeeDashboardPanel(user, 'unconciliatedList')
      ? '/bank' : null,
    { conciliated: 'false', limit: 5 }
  );
  const { data: remindersData } = useApiGet(
    canSeeDashboardPanel(user, 'reminders')
      ? '/reminders/pending' : null
  );

  // Dades per gràfics (evitem recalculs)
  const monthlyChartData = useMemo(() => {
    if (!stats?.monthlyBilling) return [];
    return stats.monthlyBilling.map((m) => ({
      month: formatMonth(m.month),
      Emeses: m.issued,
      Rebudes: m.received,
      'Emeses any ant.': m.prevIssued || 0,
      'Rebudes any ant.': m.prevReceived || 0,
    }));
  }, [stats?.monthlyBilling]);

  const topClientsData = useMemo(() => {
    if (!topData?.topClients) return [];
    return topData.topClients.slice(0, 8).map((c) => ({
      name: c.name.length > 20 ? c.name.slice(0, 18) + '…' : c.name,
      total: c.total,
      count: c.count,
    }));
  }, [topData?.topClients]);

  const topSuppliersData = useMemo(() => {
    if (!topData?.topSuppliers) return [];
    return topData.topSuppliers.slice(0, 8).map((s) => ({
      name: s.name.length > 20 ? s.name.slice(0, 18) + '…' : s.name,
      total: s.total,
      count: s.count,
    }));
  }, [topData?.topSuppliers]);

  const bankBalanceData = useMemo(() => {
    if (!stats?.bankBalance) return [];
    return stats.bankBalance.map((d) => ({
      ...d,
      dateLabel: new Date(d.date).toLocaleDateString('ca-ES', { day: '2-digit', month: 'short' }),
    }));
  }, [stats?.bankBalance]);

  const statusDistributionReceived = useMemo(() => {
    if (!stats?.invoiceStatusDistribution?.received) return [];
    return stats.invoiceStatusDistribution.received.map((s) => ({
      name: STATUS_LABELS[s.status] || s.status,
      value: s.count,
      total: s.total,
      status: s.status,
    }));
  }, [stats?.invoiceStatusDistribution]);

  const statusDistributionIssued = useMemo(() => {
    if (!stats?.invoiceStatusDistribution?.issued) return [];
    return stats.invoiceStatusDistribution.issued.map((s) => ({
      name: STATUS_LABELS[s.status] || s.status,
      value: s.count,
      total: s.total,
      status: s.status,
    }));
  }, [stats?.invoiceStatusDistribution]);

  // KPIs (preferim les dades de /dashboard/stats si hi són, per respectar el rang)
  const allStats = [
    {
      key: 'receivedPending',
      label: 'Factures rebudes',
      value: stats?.summary?.totalReceivedCount ?? 0,
      sub: stats?.summary?.totalReceived ? formatCurrency(stats.summary.totalReceived) : '0 €',
      icon: FileInput,
      color: 'text-blue-500',
    },
    {
      key: 'issuedPending',
      label: 'Factures emeses',
      value: stats?.summary?.totalIssuedCount ?? 0,
      sub: stats?.summary?.totalIssued ? formatCurrency(stats.summary.totalIssued) : '0 €',
      icon: FileOutput,
      color: 'text-green-500',
    },
    {
      key: 'unconciliated',
      label: 'Sense conciliar',
      value: stats?.summary?.unconciliatedCount ?? (bankData?.pagination?.total || 0),
      sub: 'moviments bancaris',
      icon: Landmark,
      color: 'text-orange-500',
    },
    {
      key: 'reminders',
      label: 'Recordatoris',
      value: remindersData?.count || 0,
      sub: 'mencions pendents',
      icon: Bell,
      color: 'text-red-500',
    },
  ];

  const visibleStats = allStats.filter((s) => canSeeDashboardPanel(user, s.key));
  const gridCols = visibleStats.length >= 4
    ? 'lg:grid-cols-4'
    : visibleStats.length === 3
      ? 'lg:grid-cols-3'
      : visibleStats.length === 2
        ? 'lg:grid-cols-2'
        : 'lg:grid-cols-1';

  // Aplicar preset de rang
  const applyPreset = (months) => {
    const r = getRangePreset(months);
    setDateFrom(r.from);
    setDateTo(r.to);
  };

  return (
    <div>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-bold mb-1">Hola, {user?.name?.split(' ')[0] || 'Sergi'}!</h2>
          <p className="text-muted-foreground">Resum del teu panell d'administració</p>
        </div>

        {/* Selector de rang de dates */}
        {canSeeDashboard && (
          <div className="bg-card border rounded-lg p-3 flex flex-col sm:flex-row gap-2 items-start sm:items-center">
            <Calendar size={16} className="text-muted-foreground shrink-0" />
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-2 py-1 border rounded text-sm bg-background"
                aria-label="Data inici"
              />
              <span className="text-sm text-muted-foreground">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-2 py-1 border rounded text-sm bg-background"
                aria-label="Data fi"
              />
            </div>
            <div className="flex flex-wrap gap-1 ml-0 sm:ml-2">
              <button onClick={() => { setDateFrom(`${currentYear}-01-01`); setDateTo(`${currentYear}-12-31`); }}
                className="text-xs px-2 py-1 rounded border hover:bg-accent transition-colors font-medium">
                Any
              </button>
              <button onClick={() => applyPreset(3)}
                className="text-xs px-2 py-1 rounded border hover:bg-accent transition-colors">
                3M
              </button>
              <button onClick={() => applyPreset(6)}
                className="text-xs px-2 py-1 rounded border hover:bg-accent transition-colors">
                6M
              </button>
              <button onClick={() => applyPreset(12)}
                className="text-xs px-2 py-1 rounded border hover:bg-accent transition-colors">
                12M
              </button>
              <button onClick={() => applyPreset(24)}
                className="text-xs px-2 py-1 rounded border hover:bg-accent transition-colors">
                24M
              </button>
            </div>
          </div>
        )}
      </div>

      {/* KPIs */}
      {visibleStats.length > 0 && (
        <div className={`grid grid-cols-1 md:grid-cols-2 ${gridCols} gap-4 mb-8`}>
          {visibleStats.map(({ label, value, sub, icon: Icon, color }) => (
            <div key={label} className="bg-card border rounded-lg p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">{label}</span>
                <Icon size={20} className={color} />
              </div>
              <p className="text-3xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* ===========================================
          GRÀFICS
      =========================================== */}
      {canSeeDashboard && (
        <div className="space-y-6 mb-8">
          {/* Evolució mensual */}
          {(canSeeDashboardPanel(user, 'receivedPending') || canSeeDashboardPanel(user, 'issuedPending')) && (
            <div className="bg-card border rounded-lg p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={18} className="text-teal-600" />
                <h3 className="font-semibold">Evolució de facturació mensual</h3>
              </div>
              {statsLoading ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">Carregant…</div>
              ) : monthlyChartData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                  No hi ha dades pel rang seleccionat
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={monthlyChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={formatYAxis} />
                    <Tooltip content={<CurrencyTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Emeses" fill="#0d9488" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Rebudes" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Emeses any ant." fill="#d1d5db" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Rebudes any ant." fill="#e5e7eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* Saldo bancari històric */}
          {canSeeDashboardPanel(user, 'unconciliated') && stats?.bankAccountNames?.length > 0 && (
            <div className="bg-card border rounded-lg p-5">
              <div className="flex items-center gap-2 mb-4">
                <Landmark size={18} className="text-orange-500" />
                <h3 className="font-semibold">Saldo bancari històric</h3>
              </div>
              {statsLoading ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">Carregant…</div>
              ) : bankBalanceData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                  No hi ha saldos registrats en aquest rang
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={bankBalanceData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={formatYAxis} />
                    <Tooltip content={<CurrencyTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    {stats.bankAccountNames.map((acc, idx) => (
                      <Line
                        key={acc}
                        type="monotone"
                        dataKey={acc}
                        stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* Top clients + Top proveïdors */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Període de rànquings:</span>
            <div className="flex gap-1">
              {[
                { key: 'year', label: `${currentYear}` },
                { key: '3m', label: '3M' },
                { key: '6m', label: '6M' },
                { key: '12m', label: '12M' },
                { key: 'all', label: 'Tot' },
              ].map((p) => (
                <button
                  key={p.key}
                  onClick={() => setTopPeriod(p.key)}
                  className={`text-xs px-2 py-1 rounded border transition-colors font-medium ${
                    topPeriod === p.key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {canSeeDashboardPanel(user, 'issuedPending') && (
              <div className="bg-card border rounded-lg p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Users size={18} className="text-teal-600" />
                  <h3 className="font-semibold">Top clients per facturació</h3>
                </div>
                {topLoading ? (
                  <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">Carregant…</div>
                ) : topClientsData.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                    No hi ha dades
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(240, topClientsData.length * 32)}>
                    <BarChart data={topClientsData} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatYAxis} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                      <Tooltip content={<CurrencyTooltip />} />
                      <Bar dataKey="total" fill="#0d9488" name="Total" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}

            {canSeeDashboardPanel(user, 'receivedPending') && (
              <div className="bg-card border rounded-lg p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 size={18} className="text-blue-600" />
                  <h3 className="font-semibold">Top proveïdors per despesa</h3>
                </div>
                {topLoading ? (
                  <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">Carregant…</div>
                ) : topSuppliersData.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                    No hi ha dades
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(240, topSuppliersData.length * 32)}>
                    <BarChart data={topSuppliersData} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatYAxis} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                      <Tooltip content={<CurrencyTooltip />} />
                      <Bar dataKey="total" fill="#3b82f6" name="Total" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}
          </div>

          {/* Distribució per estat — 2 pies (rebudes + emeses) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {canSeeDashboardPanel(user, 'receivedPending') && (
              <div className="bg-card border rounded-lg p-5">
                <div className="flex items-center gap-2 mb-4">
                  <PieIcon size={18} className="text-blue-600" />
                  <h3 className="font-semibold">Estats factures rebudes</h3>
                </div>
                {statsLoading ? (
                  <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">Carregant…</div>
                ) : statusDistributionReceived.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                    No hi ha dades
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={statusDistributionReceived}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={false}
                      >
                        {statusDistributionReceived.map((entry) => (
                          <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || '#64748b'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value, name, props) => [
                        `${value} factures (${formatCurrency(props.payload.total)})`,
                        name,
                      ]} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}

            {canSeeDashboardPanel(user, 'issuedPending') && (
              <div className="bg-card border rounded-lg p-5">
                <div className="flex items-center gap-2 mb-4">
                  <PieIcon size={18} className="text-teal-600" />
                  <h3 className="font-semibold">Estats factures emeses</h3>
                </div>
                {statsLoading ? (
                  <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">Carregant…</div>
                ) : statusDistributionIssued.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                    No hi ha dades
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={statusDistributionIssued}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={false}
                      >
                        {statusDistributionIssued.map((entry) => (
                          <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || '#64748b'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value, name, props) => [
                        `${value} factures (${formatCurrency(props.payload.total)})`,
                        name,
                      ]} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Factures pendents de pagament */}
      {canSeeDashboardPanel(user, 'receivedPending') && stats?.pendingPayments?.count > 0 && (
        <div className="bg-card border rounded-lg mb-6">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard size={18} className="text-amber-500" />
              <h3 className="font-semibold">Factures pendents de pagament</h3>
              <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                {stats.pendingPayments.count}
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-muted-foreground">
                Total: <span className="font-semibold text-foreground">{formatCurrency(stats.pendingPayments.total)}</span>
              </span>
              {stats.pendingPayments.overdueCount > 0 && (
                <span className="flex items-center gap-1 text-red-600">
                  <AlertTriangle size={14} />
                  {stats.pendingPayments.overdueCount} vençudes ({formatCurrency(stats.pendingPayments.overdueTotal)})
                </span>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Proveïdor</th>
                  <th className="text-left p-3 font-medium">Nº Factura</th>
                  <th className="text-left p-3 font-medium">Data emissió</th>
                  <th className="text-left p-3 font-medium">Venciment</th>
                  <th className="text-right p-3 font-medium">Import</th>
                  <th className="text-center p-3 font-medium">Estat</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {stats.pendingPayments.invoices.map((inv) => {
                  const isOverdue = inv.isOverdue;
                  const daysUntilDue = inv.dueDate
                    ? Math.ceil((new Date(inv.dueDate) - new Date()) / (1000 * 60 * 60 * 24))
                    : null;
                  return (
                    <tr key={inv.id} className={`hover:bg-muted/30 ${isOverdue ? 'bg-red-50/50' : ''}`}>
                      <td className="p-3 font-medium">{inv.supplierName}</td>
                      <td className="p-3 text-muted-foreground">{inv.invoiceNumber || '—'}</td>
                      <td className="p-3 text-muted-foreground">
                        {inv.issueDate ? new Date(inv.issueDate).toLocaleDateString('ca-ES') : '—'}
                      </td>
                      <td className="p-3">
                        {inv.dueDate ? (
                          <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-600 font-medium' : daysUntilDue <= 7 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                            {isOverdue && <AlertTriangle size={13} />}
                            {!isOverdue && daysUntilDue <= 7 && <Clock size={13} />}
                            {new Date(inv.dueDate).toLocaleDateString('ca-ES')}
                            {isOverdue && <span className="text-xs ml-1">({Math.abs(daysUntilDue)}d)</span>}
                            {!isOverdue && daysUntilDue <= 7 && <span className="text-xs ml-1">({daysUntilDue}d)</span>}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 text-right font-medium">{formatCurrency(inv.totalAmount)}</td>
                      <td className="p-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          inv.status === 'PENDING' ? 'bg-amber-100 text-amber-800' :
                          inv.status === 'REVIEWED' ? 'bg-blue-100 text-blue-800' :
                          inv.status === 'APPROVED' ? 'bg-teal-100 text-teal-800' :
                          inv.status === 'PARTIALLY_PAID' ? 'bg-lime-100 text-lime-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {STATUS_LABELS[inv.status] || inv.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Factures emeses pendents de cobrament (des de 2025) */}
      {canSeeDashboardPanel(user, 'issuedPending') && stats?.overdueIssuedInvoices?.count > 0 && (
        <div className="bg-card border rounded-lg mb-6">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-500" />
              <h3 className="font-semibold">Factures emeses pendents de cobrament</h3>
              <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                {stats.overdueIssuedInvoices.count}
              </span>
            </div>
            <span className="text-sm text-muted-foreground">
              Total: <span className="font-semibold text-foreground">{formatCurrency(stats.overdueIssuedInvoices.total)}</span>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Client</th>
                  <th className="text-left p-3 font-medium">Nº Factura</th>
                  <th className="text-left p-3 font-medium">Data emissió</th>
                  <th className="text-left p-3 font-medium">Venciment</th>
                  <th className="text-right p-3 font-medium">Import</th>
                  <th className="text-center p-3 font-medium">Dies</th>
                  <th className="text-center p-3 font-medium">Acció</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {stats.overdueIssuedInvoices.invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-muted/30 bg-red-50/30">
                    <td className="p-3 font-medium">{inv.clientName}</td>
                    <td className="p-3 text-muted-foreground">{inv.invoiceNumber || '—'}</td>
                    <td className="p-3 text-muted-foreground">
                      {inv.issueDate ? new Date(inv.issueDate).toLocaleDateString('ca-ES') : '—'}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('ca-ES') : '—'}
                    </td>
                    <td className="p-3 text-right font-medium">{formatCurrency(inv.totalAmount)}</td>
                    <td className="p-3 text-center">
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                        {inv.daysPending}d
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <button
                        onClick={async () => {
                          if (!confirm(`Marcar la factura ${inv.invoiceNumber} com a cobrada?`)) return;
                          try {
                            await api.patch(`/invoices/issued/${inv.id}/status`, { status: 'PAID' });
                            refetchStats();
                          } catch { alert('Error actualitzant l\'estat'); }
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                        title="Marcar com a cobrada"
                      >
                        <CheckCircle2 size={13} />
                        Cobrada
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Panells existents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {canSeeDashboardPanel(user, 'recentReceived') && (
          <div className="bg-card border rounded-lg">
            <div className="p-4 border-b">
              <h3 className="font-semibold">Últimes factures rebudes pendents</h3>
            </div>
            <div className="divide-y">
              {receivedData?.data?.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Cap factura pendent</p>
              ) : (
                receivedData?.data?.map((inv) => (
                  <div key={inv.id} className="p-3 flex items-center justify-between">
                    <div>
                      <span className="font-medium text-sm">{inv.invoiceNumber}</span>
                      <span className="text-muted-foreground text-sm ml-2">{inv.supplier?.name}</span>
                    </div>
                    <span className="font-medium text-sm">{formatCurrency(inv.totalAmount)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {canSeeDashboardPanel(user, 'unconciliatedList') && (
          <div className="bg-card border rounded-lg">
            <div className="p-4 border-b">
              <h3 className="font-semibold">Moviments sense conciliar</h3>
            </div>
            <div className="divide-y">
              {bankData?.data?.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Tots els moviments conciliats!</p>
              ) : (
                bankData?.data?.map((m) => (
                  <div key={m.id} className="p-3 flex items-center justify-between">
                    <span className="text-sm">{m.description}</span>
                    <span className={`font-medium text-sm ${parseFloat(m.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(Math.abs(parseFloat(m.amount)))}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {visibleStats.length === 0 && !canSeeDashboard && (
        <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">
          <p>No tens panells assignats al teu rol.</p>
          <p className="text-sm mt-1">Contacta amb l'administrador si necessites accés a més seccions.</p>
        </div>
      )}
    </div>
  );
}
