import { useState, useMemo } from 'react';
import {
  Clock, ChevronLeft, ChevronRight, Loader2, Check, X,
  Building2, Film, Truck, Filter, Download, CheckCircle2,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';
import useAuthStore from '../../stores/authStore';

// ===========================================
// Constants
// ===========================================

const MONTH_NAMES = [
  'Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny',
  'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre',
];

const ENTRY_TYPES = [
  { value: 'OFICINA', label: 'Oficina', icon: Building2, color: 'bg-blue-500', text: 'text-blue-700', bg: 'bg-blue-50' },
  { value: 'RODATGE', label: 'Rodatge', icon: Film, color: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50' },
  { value: 'TRANSPORT_ENTREGA', label: 'Transport entrega', icon: Truck, color: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50' },
  { value: 'TRANSPORT_RECOLLIDA', label: 'Transport recollida', icon: Truck, color: 'bg-purple-500', text: 'text-purple-700', bg: 'bg-purple-50' },
  { value: 'TRANSPORT_COMPLET', label: 'Transport complet', icon: Truck, color: 'bg-indigo-500', text: 'text-indigo-700', bg: 'bg-indigo-50' },
];

function formatTime(dateStr) {
  if (!dateStr) return '--:--';
  return new Date(dateStr).toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes) {
  if (!minutes && minutes !== 0) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('ca-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ===========================================
// Component principal
// ===========================================

export default function TimeEntries() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN';

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [filterUser, setFilterUser] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showOvertimeOnly, setShowOvertimeOnly] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [message, setMessage] = useState(null);

  // Dates del mes
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

  // Dades
  const params = useMemo(() => {
    const p = { from, to, limit: 500 };
    if (filterUser) p.userId = filterUser;
    if (filterType) p.type = filterType;
    if (showOvertimeOnly) p.overtimeOnly = 'true';
    return p;
  }, [from, to, filterUser, filterType, showOvertimeOnly]);

  const { data, loading, refetch } = useApiGet('/team/time-entries', params);
  const { data: allUsers } = useApiGet(isAdmin ? '/users' : null);
  const { data: summaryData } = useApiGet('/team/summary/monthly', {
    year, month,
    ...(filterUser ? { userId: filterUser } : {}),
  });
  const { data: pendingOvertime, refetch: refetchOvertime } = useApiGet(
    isAdmin ? '/team/overtime/pending' : null
  );

  const entries = data?.entries || [];

  // Agrupar per dia
  const groupedByDay = useMemo(() => {
    const groups = {};
    for (const entry of entries) {
      const day = entry.date?.split('T')[0] || 'sense-data';
      if (!groups[day]) groups[day] = [];
      groups[day].push(entry);
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries]);

  // Navegació mesos
  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  // Accions admin
  const handleApprove = async (id) => {
    setActionLoading(id);
    try {
      await api.post(`/team/overtime/${id}/approve`);
      setMessage({ type: 'success', text: 'Hores extres aprovades' });
      refetch();
      refetchOvertime?.();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Error' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id) => {
    setActionLoading(id);
    try {
      await api.post(`/team/overtime/${id}/reject`);
      setMessage({ type: 'success', text: 'Hores extres rebutjades' });
      refetch();
      refetchOvertime?.();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Error' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleApproveAll = async () => {
    setActionLoading('all');
    try {
      const result = await api.post('/team/overtime/approve-all');
      setMessage({ type: 'success', text: `${result.data.approved} hores extres aprovades` });
      refetch();
      refetchOvertime?.();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Error' });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Capçalera */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Clock size={22} className="text-primary" />
          <h2 className="text-lg font-bold">Registres horaris</h2>
        </div>
      </div>

      {/* Missatge */}
      {message && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
        }`}>
          <CheckCircle2 size={16} />
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* Hores extres pendents (admin) */}
      {isAdmin && pendingOvertime?.length > 0 && (
        <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-amber-800">
              Hores extres pendents ({pendingOvertime.length})
            </h3>
            <button
              onClick={handleApproveAll}
              disabled={actionLoading === 'all'}
              className="text-xs px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium disabled:opacity-50"
            >
              Aprovar totes
            </button>
          </div>
          <div className="space-y-2">
            {pendingOvertime.map(ot => (
              <div key={ot.id} className="flex items-center gap-3 bg-white p-2.5 rounded-lg">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: ot.user?.color || '#6b7280' }}
                >
                  {ot.user?.name?.charAt(0) || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{ot.user?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(ot.date)} · +{formatDuration(ot.overtimeMinutes)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleApprove(ot.id)}
                    disabled={actionLoading === ot.id}
                    className="p-1.5 rounded-lg bg-green-100 hover:bg-green-200 text-green-700"
                    title="Aprovar"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => handleReject(ot.id)}
                    disabled={actionLoading === ot.id}
                    className="p-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-700"
                    title="Rebutjar"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navegació mes + filtres */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-muted">
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-semibold min-w-[140px] text-center">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-muted">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
          <Filter size={14} className="text-muted-foreground" />
          {isAdmin && allUsers && (
            <select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="text-xs px-2 py-1.5 border rounded-lg bg-background"
            >
              <option value="">Tots els usuaris</option>
              {(allUsers.users || allUsers || []).map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          )}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-xs px-2 py-1.5 border rounded-lg bg-background"
          >
            <option value="">Tots els tipus</option>
            {ENTRY_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showOvertimeOnly}
              onChange={(e) => setShowOvertimeOnly(e.target.checked)}
              className="rounded"
            />
            Hores extres
          </label>
        </div>
      </div>

      {/* Resum mensual */}
      {summaryData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="bg-muted/30 p-3 rounded-lg text-center">
            <p className="text-2xl font-bold">{summaryData.daysWorked || 0}</p>
            <p className="text-xs text-muted-foreground">Dies treballats</p>
          </div>
          <div className="bg-muted/30 p-3 rounded-lg text-center">
            <p className="text-2xl font-bold">{summaryData.totalHours || 0}h</p>
            <p className="text-xs text-muted-foreground">Hores totals</p>
          </div>
          <div className="bg-muted/30 p-3 rounded-lg text-center">
            <p className="text-2xl font-bold">{summaryData.overtimeHours || 0}h</p>
            <p className="text-xs text-muted-foreground">Hores extres</p>
          </div>
          <div className="bg-muted/30 p-3 rounded-lg text-center">
            <p className="text-2xl font-bold">{summaryData.totalEntries || 0}</p>
            <p className="text-xs text-muted-foreground">Registres</p>
          </div>
        </div>
      )}

      {/* Desglossament per tipus */}
      {summaryData?.byType && Object.keys(summaryData.byType).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {Object.entries(summaryData.byType).map(([type, info]) => {
            const et = ENTRY_TYPES.find(t => t.value === type);
            const Icon = et?.icon || Clock;
            return (
              <div key={type} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${et?.bg || 'bg-gray-50'} ${et?.text || 'text-gray-700'}`}>
                <Icon size={12} />
                {et?.label || type}: {formatDuration(info.minutes)} ({info.count})
              </div>
            );
          })}
        </div>
      )}

      {/* Llistat */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : groupedByDay.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Clock size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No hi ha registres per aquest període</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByDay.map(([day, dayEntries]) => (
            <div key={day}>
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase">
                {formatDate(day)}
              </p>
              <div className="space-y-1.5">
                {dayEntries.map(entry => {
                  const et = ENTRY_TYPES.find(t => t.value === entry.type);
                  const Icon = et?.icon || Clock;
                  return (
                    <div key={entry.id} className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg hover:bg-muted/40 transition-colors">
                      {/* Avatar usuari (admin) */}
                      {isAdmin && entry.user && (
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                          style={{ background: entry.user.color || '#6b7280' }}
                        >
                          {entry.user.name?.charAt(0) || '?'}
                        </div>
                      )}
                      {/* Icona tipus */}
                      <div className={`p-1.5 rounded ${et?.color || 'bg-gray-500'} text-white flex-shrink-0`}>
                        <Icon size={14} />
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-sm">
                          {isAdmin && entry.user && (
                            <span className="font-medium">{entry.user.name}</span>
                          )}
                          <span className={isAdmin ? 'text-muted-foreground' : 'font-medium'}>
                            {formatTime(entry.clockIn)} — {entry.clockOut ? formatTime(entry.clockOut) : 'en curs...'}
                          </span>
                          {entry.totalMinutes != null && (
                            <span className="text-muted-foreground text-xs">
                              {formatDuration(entry.totalMinutes)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {et?.label || entry.type}
                          {entry.shootingRole && ` · ${entry.shootingRole === 'VIDEOASSIST' ? 'Videoassist' : 'Aux. càmera'}`}
                          {entry.projectName && ` — ${entry.projectName}`}
                          {entry.notes && ` · ${entry.notes}`}
                        </p>
                      </div>
                      {/* Hores extres badge */}
                      {entry.overtimeMinutes > 0 && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                          entry.overtimeStatus === 'APROVADA' ? 'bg-green-100 text-green-700' :
                          entry.overtimeStatus === 'REBUTJADA' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          +{formatDuration(entry.overtimeMinutes)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Paginació info */}
      {data?.total > 0 && (
        <div className="mt-4 text-center text-xs text-muted-foreground">
          {entries.length} de {data.total} registres
        </div>
      )}
    </div>
  );
}
