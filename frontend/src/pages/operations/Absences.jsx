import { useState, useMemo } from 'react';
import {
  CalendarOff, ChevronLeft, ChevronRight, Plus, Check, X,
  Loader2, Trash2,
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
const DAY_NAMES = ['Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds', 'Dg'];

const ABSENCE_TYPES = [
  { value: 'VACANCES', label: 'Vacances', color: '#3b82f6', bg: '#dbeafe' },
  { value: 'MALALTIA', label: 'Malaltia', color: '#ef4444', bg: '#fee2e2' },
  { value: 'RODATGE', label: 'Rodatge', color: '#8b5cf6', bg: '#ede9fe' },
  { value: 'PERMIS', label: 'Permís', color: '#f59e0b', bg: '#fef3c7' },
  { value: 'FORMACIO', label: 'Formació', color: '#06b6d4', bg: '#cffafe' },
  { value: 'ALTRE', label: 'Altre', color: '#6b7280', bg: '#f3f4f6' },
];

const STATUS_CONFIG = {
  PENDENT: { label: 'Pendent', color: '#f59e0b', bg: '#fef3c7' },
  APROVADA: { label: 'Aprovada', color: '#10b981', bg: '#d1fae5' },
  REBUTJADA: { label: 'Rebutjada', color: '#ef4444', bg: '#fee2e2' },
};

function toDateStr(d) {
  if (typeof d === 'string') d = new Date(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

// ===========================================
// Component
// ===========================================

export default function Absences() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN';

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    startDate: '', endDate: '', type: 'VACANCES', notes: '', userId: '',
  });
  const [saving, setSaving] = useState(false);

  // Fetch absences for the visible month
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const toDate = new Date(year, month, 0);
  const to = toDateStr(toDate);

  const { data: absences, loading, refetch } = useApiGet('/operations/absences', { from, to });
  const { data: allUsers } = useApiGet(isAdmin ? '/users' : null);

  // Calendar grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startDow = (firstDay.getDay() + 6) % 7;
    const days = [];

    for (let i = startDow - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, -i);
      days.push({ date: d, currentMonth: false });
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({ date: new Date(year, month - 1, i), currentMonth: true });
    }
    while (days.length % 7 !== 0) {
      const d = new Date(year, month, days.length - startDow - lastDay.getDate() + 1);
      days.push({ date: d, currentMonth: false });
    }
    return days;
  }, [year, month]);

  // Group absences by date
  const absencesByDate = useMemo(() => {
    if (!absences) return {};
    const map = {};
    absences.forEach((a) => {
      const start = new Date(a.startDate);
      const end = new Date(a.endDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = toDateStr(d);
        if (!map[key]) map[key] = [];
        map[key].push(a);
      }
    });
    return map;
  }, [absences]);

  const prevMonth = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.startDate || !formData.endDate) return;
    setSaving(true);
    try {
      await api.post('/operations/absences', {
        startDate: formData.startDate,
        endDate: formData.endDate,
        type: formData.type,
        notes: formData.notes || undefined,
        userId: isAdmin && formData.userId ? formData.userId : undefined,
      });
      setShowForm(false);
      setFormData({ startDate: '', endDate: '', type: 'VACANCES', notes: '', userId: '' });
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error creant absència');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (id) => {
    try {
      await api.put(`/operations/absences/${id}/approve`);
      refetch();
    } catch { /* */ }
  };

  const handleReject = async (id) => {
    try {
      await api.put(`/operations/absences/${id}/reject`);
      refetch();
    } catch { /* */ }
  };

  const handleDelete = async (id) => {
    if (!confirm('Eliminar aquesta absència?')) return;
    try {
      await api.delete(`/operations/absences/${id}`);
      refetch();
    } catch { /* */ }
  };

  const todayStr = toDateStr(new Date());
  const pendingAbsences = (absences || []).filter(a => a.status === 'PENDENT');

  return (
    <div className="px-3 md:px-6 py-4 md:py-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-5 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#e6f3f7' }}>
            <CalendarOff size={16} className="text-[#00617F]" />
          </div>
          <div>
            <h1 className="text-sm md:text-base font-semibold text-gray-900">Absències del personal</h1>
            <p className="text-[11px] text-gray-400 hidden sm:block">Vacances, baixes, rodatges i permisos</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-xs font-medium active:opacity-80"
          style={{ background: '#00617F' }}
        >
          <Plus size={14} /> <span className="hidden sm:inline">Nova absència</span><span className="sm:hidden">Nova</span>
        </button>
      </div>

      {/* Pending approvals for admin */}
      {isAdmin && pendingAbsences.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs font-medium text-amber-800 mb-2">
            {pendingAbsences.length} absènci{pendingAbsences.length > 1 ? 'es' : 'a'} pendent{pendingAbsences.length > 1 ? 's' : ''} d'aprovació
          </p>
          <div className="space-y-1.5">
            {pendingAbsences.map((a) => {
              const typeInfo = ABSENCE_TYPES.find(t => t.value === a.type) || ABSENCE_TYPES[5];
              return (
                <div key={a.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border flex-wrap gap-1">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span
                      className="text-[11px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
                      style={{ background: typeInfo.bg, color: typeInfo.color }}
                    >
                      {typeInfo.label}
                    </span>
                    <span className="text-xs font-medium text-gray-800">{a.user?.name}</span>
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">
                      {formatDate(a.startDate)} — {formatDate(a.endDate)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 ml-auto">
                    <button
                      onClick={() => handleApprove(a.id)}
                      className="p-2 rounded-lg hover:bg-green-100 active:bg-green-200 text-green-600"
                      title="Aprovar"
                    >
                      <Check size={16} />
                    </button>
                    <button
                      onClick={() => handleReject(a.id)}
                      className="p-2 rounded-lg hover:bg-red-100 active:bg-red-200 text-red-500"
                      title="Rebutjar"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 bg-white border rounded-xl p-3 md:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 items-end">
            {isAdmin && allUsers && (
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Persona</label>
                <select
                  value={formData.userId}
                  onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm md:text-xs"
                >
                  <option value="">Jo mateix</option>
                  {(allUsers.users || allUsers || []).filter(u => u.isActive).map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Inici</label>
              <input
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value, endDate: formData.endDate || e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm md:text-xs"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Fi</label>
              <input
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm md:text-xs"
                min={formData.startDate}
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Tipus</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm md:text-xs"
              >
                {ABSENCE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Notes</label>
              <input
                type="text"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm md:text-xs"
                placeholder="Opcional"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-xs text-gray-500 hover:text-gray-700 active:text-gray-900"
            >
              Cancel·lar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50 active:opacity-80"
              style={{ background: '#00617F' }}
            >
              {saving ? 'Guardant...' : isAdmin ? 'Crear (aprovada)' : 'Sol·licitar'}
            </button>
          </div>
        </form>
      )}

      {/* Calendar */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-gray-300" size={32} />
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          {/* Month navigation */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <button onClick={prevMonth} className="p-2.5 -ml-1 rounded-lg hover:bg-gray-100 active:bg-gray-200">
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-sm font-semibold text-gray-900">
              {MONTH_NAMES[month - 1]} {year}
            </h2>
            <button onClick={nextMonth} className="p-2.5 -mr-1 rounded-lg hover:bg-gray-100 active:bg-gray-200">
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 border-b bg-gray-50">
            {DAY_NAMES.map(d => (
              <div key={d} className="text-center py-2 text-[11px] font-medium text-gray-400">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7">
            {calendarDays.map(({ date, currentMonth }, i) => {
              const dateStr = toDateStr(date);
              const dayAbsences = absencesByDate[dateStr] || [];
              const isToday = dateStr === todayStr;
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;

              return (
                <div
                  key={i}
                  className={`min-h-[60px] md:min-h-[90px] border-b border-r p-0.5 md:p-1 ${
                    !currentMonth ? 'bg-gray-50/50' : isWeekend ? 'bg-gray-50/30' : ''
                  }`}
                >
                  <div className={`text-[11px] font-medium mb-0.5 ${
                    isToday
                      ? 'w-6 h-6 rounded-full flex items-center justify-center text-white text-[12px]'
                      : currentMonth ? 'text-gray-700 p-0.5' : 'text-gray-300 p-0.5'
                  }`}
                    style={isToday ? { background: '#00617F' } : undefined}
                  >
                    {date.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayAbsences.slice(0, 2).map((a) => {
                      const typeInfo = ABSENCE_TYPES.find(t => t.value === a.type) || ABSENCE_TYPES[5];
                      const statusInfo = STATUS_CONFIG[a.status];
                      return (
                        <div
                          key={a.id}
                          className="flex items-center gap-0.5 px-1 py-0.5 md:py-1 rounded text-[10px] md:text-[11px] truncate cursor-default group relative"
                          style={{
                            background: a.status === 'APROVADA' ? typeInfo.bg : statusInfo.bg,
                            color: a.status === 'APROVADA' ? typeInfo.color : statusInfo.color,
                            opacity: a.status === 'REBUTJADA' ? 0.4 : 1,
                          }}
                          title={`${a.user?.name} — ${typeInfo.label} (${statusInfo.label})${a.notes ? ': ' + a.notes : ''}`}
                        >
                          <span className="truncate font-medium">{a.user?.name?.split(' ')[0]}</span>
                          {a.status === 'PENDENT' && <span className="text-[9px]">?</span>}
                          {/* Delete button on hover (desktop) */}
                          {(isAdmin || a.userId === user?.id) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}
                              className="hidden md:group-hover:flex absolute right-0 top-0 p-1 rounded hover:bg-white/70 items-center justify-center"
                            >
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {dayAbsences.length > 2 && (
                      <div className="text-[9px] md:text-[10px] text-gray-400 px-1">+{dayAbsences.length - 2}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-2 md:gap-3 mt-3">
        {ABSENCE_TYPES.map(t => (
          <div key={t.value} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} />
            <span className="text-[11px] text-gray-500">{t.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-2 md:ml-4">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#f59e0b' }} />
          <span className="text-[11px] text-gray-500">Pendent</span>
        </div>
      </div>

      {/* Mobile: llista d'absències del mes (més fàcil de gestionar que el calendari) */}
      <div className="md:hidden mt-4">
        {(absences || []).length > 0 && (
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-3 py-2.5 border-b bg-gray-50">
              <p className="text-[11px] font-medium text-gray-500">Absències del mes</p>
            </div>
            <div className="divide-y">
              {(absences || []).map((a) => {
                const typeInfo = ABSENCE_TYPES.find(t => t.value === a.type) || ABSENCE_TYPES[5];
                const statusInfo = STATUS_CONFIG[a.status];
                return (
                  <div key={a.id} className="flex items-center justify-between px-3 py-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: typeInfo.color }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-gray-800 truncate">{a.user?.name}</div>
                        <div className="text-[11px] text-gray-400">
                          {typeInfo.label} · {formatDate(a.startDate)} — {formatDate(a.endDate)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
                        style={{ background: statusInfo.bg, color: statusInfo.color }}
                      >
                        {statusInfo.label}
                      </span>
                      {(isAdmin || (a.userId === user?.id && a.status === 'PENDENT')) && (
                        <button
                          onClick={() => handleDelete(a.id)}
                          className="p-2 -mr-1 rounded-lg hover:bg-red-50 active:bg-red-100 text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
