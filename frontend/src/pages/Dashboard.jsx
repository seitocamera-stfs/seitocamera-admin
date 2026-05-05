import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Package, CheckCircle2, ListTodo, AlertTriangle,
  ArrowRight, User, Loader2, RefreshCw, Truck,
  Clock, Users, Phone, Warehouse, Wrench, Shield,
} from 'lucide-react';
import { useApiGet } from '../hooks/useApi';
import { useAgentEnabled } from '../hooks/useAgentToggles';
import api from '../lib/api';

// ===========================================
// Constants
// ===========================================

const STATUS_CONFIG = {
  PENDING_PREP:        { label: 'Pendent preparar',   color: 'bg-gray-100 text-gray-600' },
  IN_PREPARATION:      { label: 'En preparació',      color: 'bg-blue-50 text-blue-700' },
  READY:               { label: 'Preparat',           color: 'bg-emerald-50 text-emerald-700' },
  OUT:                 { label: 'Sortit',             color: 'bg-violet-50 text-violet-700' },
  RETURNED:            { label: 'Retornat',           color: 'bg-purple-50 text-purple-700' },
  CLOSED:              { label: 'Tancat',             color: 'bg-gray-200 text-gray-500' },
};

const CATEGORY_LABELS = {
  WAREHOUSE: 'Magatzem', TECH: 'Tècnica', ADMIN: 'Admin', TRANSPORT: 'Transport', GENERAL: 'General',
};
const CATEGORY_COLORS = {
  TECH: 'bg-sky-50 text-[#00617F]', WAREHOUSE: 'bg-amber-50 text-amber-700',
  ADMIN: 'bg-gray-100 text-gray-600', TRANSPORT: 'bg-violet-50 text-violet-700',
  GENERAL: 'bg-gray-50 text-gray-500',
};

const SEVERITY_LABELS = { LOW: 'Baixa', MEDIUM: 'Mitjana', HIGH: 'Alta', CRITICAL: 'Crítica' };
const SEVERITY_COLORS = {
  LOW: 'bg-gray-100 text-gray-600', MEDIUM: 'bg-yellow-50 text-yellow-700',
  HIGH: 'bg-orange-50 text-orange-700', CRITICAL: 'bg-red-100 text-red-700',
};

const ROLE_ICONS = {
  ADMIN_COORDINATION: Phone, WAREHOUSE_LEAD: Warehouse, WAREHOUSE_SUPPORT: Package,
  TECH_LEAD: Wrench, INTERN_SUPPORT: User, GENERAL_MANAGER: Shield,
};

// ===========================================
// Component principal
// ===========================================

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, loading, refetch } = useApiGet('/operations/dashboard', {}, { refetchOnFocus: true, refetchOnVisible: true });
  const { data: logistics, refetch: refetchLogistics } = useApiGet('/logistics/dashboard', {}, { refetchOnFocus: true, refetchOnVisible: true });
  const { enabled: warehouseAgentEnabled } = useAgentEnabled('warehouse_agent');
  // Només demanem el briefing si el Magatzem IA està actiu — així evitem la
  // crida i amaguem els cards relacionats quan està desactivat.
  const { data: warehouse } = useApiGet(
    warehouseAgentEnabled ? '/warehouse/briefing' : null,
    {},
    { refetchOnFocus: true }
  );
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post('/rentman/sync/projects');
      refetch();
    } catch { /* silently */ }
    finally { setSyncing(false); }
  };

  const stats = data?.stats || {};
  const departures = data?.upcomingDepartures || [];
  const tasks = data?.tasksToday || [];
  const returns = data?.returnsToday || [];
  const incidents = data?.openIncidents || [];
  const staff = data?.staff || [];
  const todayAbsences = data?.todayAbsences || [];

  const today = new Date();
  const dayNames = ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'];
  const monthNames = ['gener', 'febrer', 'març', 'abril', 'maig', 'juny', 'juliol', 'agost', 'setembre', 'octubre', 'novembre', 'desembre'];
  const dateStr = `${dayNames[today.getDay()]}, ${today.getDate()} ${monthNames[today.getMonth()]} ${today.getFullYear()}`;

  const handleToggleTask = async (task) => {
    const newStatus = task.status === 'OP_DONE' ? 'OP_PENDING' : 'OP_DONE';
    try {
      await api.put(`/operations/tasks/${task.id}`, { status: newStatus });
      refetch();
    } catch { /* silently */ }
  };

  return (
    <div className="min-h-screen" style={{ background: '#f8f9fa' }}>
      {/* Top bar */}
      <div className="bg-white border-b px-3 md:px-6 py-2 md:py-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-sm md:text-lg font-medium text-gray-900">Dashboard</h1>
          <p className="text-[10px] md:text-xs text-gray-400">{dateStr}</p>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
          <button
            onClick={() => { refetch(); refetchLogistics(); }}
            disabled={loading}
            className="flex items-center gap-1 px-2 md:px-3 py-1.5 md:py-2 text-[11px] md:text-xs border rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            title="Recarregar dades del dashboard"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Actualitzar</span>
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1 px-2 md:px-3 py-1.5 md:py-2 text-[11px] md:text-xs border rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Sync</span> Rentman
          </button>
          <button
            onClick={() => navigate('/operations/projects')}
            className="flex items-center gap-1 px-2 md:px-3 py-1.5 md:py-2 text-[11px] md:text-xs rounded-lg text-white transition-colors"
            style={{ background: '#00617F' }}
          >
            <Package size={12} /> Projectes
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-gray-300" size={32} />
        </div>
      ) : (
        <div className="px-3 md:px-6 py-3 md:py-5 max-w-7xl mx-auto space-y-3 md:space-y-5">
          {/* Mètriques */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 md:gap-3">
            <StatCard label="Projectes actius" value={stats.activeProjects || 0} sub={`${stats.readyProjects || 0} preparats`} color="#00617F" icon={Package} onClick={() => navigate('/operations/projects')} />
            <StatCard label="Preparats" value={stats.readyProjects || 0} sub="Llestos per sortir" color="#059669" icon={CheckCircle2} onClick={() => navigate('/operations/projects?status=READY')} />
            <StatCard label="Tasques pendents" value={stats.pendingTasks || 0} sub={`${stats.todayTasks || 0} per avui`} color="#d97706" icon={ListTodo} onClick={() => navigate('/operations/tasks')} />
            <StatCard label="Devolucions avui" value={stats.returnsToday || 0} sub="Projectes que tornen" color="#7c3aed" icon={Truck} onClick={() => navigate('/operations/projects?view=returns')} />
            <StatCard label="Transports avui" value={logistics?.transportsAvuiCount || 0} sub={`${logistics?.transportsDemaCount || 0} demà`} color="#0ea5e9" icon={Truck} onClick={() => navigate('/logistics')} />
            <div className="col-span-2 md:col-span-1">
              <StatCard label="Incidències" value={stats.openIncidents || 0} sub={stats.criticalIncidents > 0 ? `${stats.criticalIncidents} crítica` : 'Cap crítica'} color={stats.openIncidents > 0 ? '#dc2626' : '#059669'} icon={AlertTriangle} onClick={() => navigate('/operations/incidents')} />
            </div>
          </div>

          {/* Personal disponible */}
          {staff.length > 0 && (() => {
            const ABSENCE_LABELS = { VACANCES: 'Vacances', MALALTIA: 'Malaltia', RODATGE: 'Rodatge', PERMIS: 'Permís', FORMACIO: 'Formació', ALTRE: 'Absent' };
            const available = staff.filter((s) => !s.absent);
            const absent = staff.filter((s) => s.absent);
            // Deduplicar per userId
            const uniqueAvailable = [...new Map(available.map(s => [s.user.id, s])).values()];
            const uniqueAbsent = [...new Map(absent.map(s => [s.user.id, s])).values()];

            return (
              <div className="bg-white rounded-xl border p-3 md:p-4">
                <div className="flex items-center justify-between mb-2 md:mb-3">
                  <h3 className="text-[11px] md:text-xs font-medium text-gray-900 flex items-center gap-1.5">
                    <Users size={13} className="text-[#00617F]" /> Personal disponible avui
                  </h3>
                  <div className="flex items-center gap-2">
                    {uniqueAbsent.length > 0 && (
                      <span className="text-[10px] md:text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600">
                        {uniqueAbsent.length} absent{uniqueAbsent.length > 1 ? 's' : ''}
                      </span>
                    )}
                    <span className="text-[10px] md:text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: '#e6f3f7', color: '#00617F' }}>
                      {uniqueAvailable.length} disponible{uniqueAvailable.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 md:gap-2">
                  {available.map((s) => {
                    const RoleIcon = ROLE_ICONS[s.role.code] || User;
                    return (
                      <div
                        key={s.id}
                        className="flex items-center gap-1 md:gap-1.5 px-2 md:px-2.5 py-1 md:py-1.5 rounded-lg text-[11px] md:text-xs border bg-gray-50/50"
                        style={{ borderColor: `${s.role.color}40` }}
                      >
                        {s.user.color && (
                          <span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full flex-shrink-0" style={{ background: s.user.color }} />
                        )}
                        <RoleIcon size={11} style={{ color: s.role.color }} />
                        <span className="font-medium text-gray-800">{s.user.name}</span>
                        <span className="text-gray-400">{s.role.shortName}</span>
                      </div>
                    );
                  })}
                  {absent.map((s) => {
                    const RoleIcon = ROLE_ICONS[s.role.code] || User;
                    const absenceInfo = todayAbsences.find(a => a.userId === s.user.id);
                    return (
                      <div
                        key={s.id}
                        className="flex items-center gap-1 md:gap-1.5 px-2 md:px-2.5 py-1 md:py-1.5 rounded-lg text-[11px] md:text-xs border border-red-200 bg-red-50/50 opacity-60"
                        title={absenceInfo ? ABSENCE_LABELS[absenceInfo.type] || 'Absent' : 'Absent'}
                      >
                        {s.user.color && (
                          <span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full flex-shrink-0" style={{ background: s.user.color }} />
                        )}
                        <RoleIcon size={11} style={{ color: '#9ca3af' }} />
                        <span className="font-medium text-gray-400 line-through">{s.user.name}</span>
                        <span className="text-red-400 text-[10px]">{absenceInfo ? ABSENCE_LABELS[absenceInfo.type] : 'Absent'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Magatzem · alertes (només es mostren si hi ha contingut) */}
          {warehouse && (warehouse.summary?.overdue_returns > 0 || warehouse.summary?.equipment_broken_or_lost > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              {warehouse.summary?.overdue_returns > 0 && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 md:p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[11px] md:text-xs font-medium text-rose-900 flex items-center gap-1.5">
                      <Clock size={13} className="text-rose-600" /> Devolucions endarrerides
                    </h3>
                    <span className="text-[10px] md:text-[11px] font-medium px-2 py-0.5 rounded-full bg-rose-200 text-rose-900">
                      {warehouse.summary.overdue_returns}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {(warehouse.overdue_returns || []).slice(0, 3).map((p) => {
                      const days = Math.floor((new Date() - new Date(p.returnDate)) / 86400000);
                      return (
                        <div key={p.id} className="flex items-center justify-between text-xs bg-white/60 rounded px-2 py-1">
                          <span className="font-medium truncate">{p.name}</span>
                          <span className="text-rose-700 ml-2 flex-shrink-0">{days}d</span>
                        </div>
                      );
                    })}
                    {warehouse.summary.overdue_returns > 3 && (
                      <button
                        onClick={() => navigate('/warehouse/agent')}
                        className="text-[10px] md:text-[11px] text-rose-700 hover:underline inline-flex items-center gap-1"
                      >
                        Veure les {warehouse.summary.overdue_returns} <ArrowRight size={10} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {warehouse.summary?.equipment_broken_or_lost > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 md:p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[11px] md:text-xs font-medium text-amber-900 flex items-center gap-1.5">
                      <Wrench size={13} className="text-amber-600" /> Equips fora de servei
                    </h3>
                    <span className="text-[10px] md:text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
                      {warehouse.summary.equipment_broken_or_lost}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {(warehouse.broken_equipment || []).slice(0, 3).map((e) => {
                      const inc = e.openIncident;
                      return (
                        <div key={e.id} className="flex items-center justify-between text-xs bg-white/60 rounded px-2 py-1 gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{e.name}</div>
                            {inc ? (
                              <button
                                onClick={() => navigate('/operations/incidents')}
                                className="text-[10px] text-amber-800 hover:underline truncate text-left w-full"
                                title={inc.title}
                              >
                                Incidència oberta · {inc.status.replace('INC_', '').toLowerCase()}
                              </button>
                            ) : (
                              <span className="text-[10px] text-rose-700 italic">⚠ Sense incidència oberta</span>
                            )}
                          </div>
                          <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded ${e.status === 'BROKEN' ? 'bg-rose-200 text-rose-900' : e.status === 'LOST' ? 'bg-slate-200 text-slate-700' : 'bg-orange-200 text-orange-900'}`}>{e.status}</span>
                        </div>
                      );
                    })}
                    <div className="flex justify-between gap-2 pt-1">
                      {warehouse.summary.equipment_broken_or_lost > 3 && (
                        <button
                          onClick={() => navigate('/warehouse/agent')}
                          className="text-[10px] md:text-[11px] text-amber-700 hover:underline inline-flex items-center gap-1"
                        >
                          Veure els {warehouse.summary.equipment_broken_or_lost} <ArrowRight size={10} />
                        </button>
                      )}
                      <button
                        onClick={() => navigate('/operations/incidents')}
                        className="text-[10px] md:text-[11px] text-amber-700 hover:underline inline-flex items-center gap-1 ml-auto"
                      >
                        Incidències <ArrowRight size={10} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Transports avui i demà */}
          {logistics && (logistics.transportsAvuiCount > 0 || logistics.transportsDemaCount > 0) && (
            <div className="bg-white rounded-xl border p-3 md:p-4">
              <div className="flex items-center justify-between mb-2 md:mb-3">
                <h3 className="text-[11px] md:text-xs font-medium text-gray-900 flex items-center gap-1.5">
                  <Truck size={13} className="text-sky-600" /> Transports
                </h3>
                <button onClick={() => navigate('/logistics')} className="text-[10px] md:text-[11px] text-sky-700 hover:underline inline-flex items-center gap-1">
                  Veure tots <ArrowRight size={10} />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <TransportColumn title="Avui" items={logistics.transportsAvui || []} emptyText="Cap transport avui" navigate={navigate} />
                <TransportColumn title="Demà" items={logistics.transportsDema || []} emptyText="Cap transport demà" navigate={navigate} />
              </div>
            </div>
          )}

          {/* Grid principal: 3 columnes */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4">
            {/* Pròximes sortides */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h3 className="text-xs font-medium text-gray-900 flex items-center gap-1.5">
                  <Package size={13} className="text-blue-600" /> Pròximes sortides
                </h3>
                <span className="text-[9px] font-medium px-2 py-0.5 rounded-full" style={{ background: '#e6f3f7', color: '#00617F' }}>
                  Setmana
                </span>
              </div>
              <div>
                {departures.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">Cap sortida programada</p>
                ) : (
                  departures.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 md:gap-2.5 px-3 md:px-4 py-2 md:py-2.5 border-b last:border-b-0 hover:bg-gray-50/50 cursor-pointer transition-colors"
                      onClick={() => navigate('/operations/projects')}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: p.status === 'READY' ? '#059669' : p.status === 'OUT' ? '#7c3aed' : '#00617F' }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium text-gray-900 truncate">{p.name}</div>
                        <div className="text-[9px] text-gray-400">{p.clientName || p.client?.name || ''}</div>
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${STATUS_CONFIG[p.status]?.color || 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_CONFIG[p.status]?.label || p.status}
                      </span>
                      <div className="text-[9px] text-gray-400 w-14 text-right">
                        {new Date(p.departureDate).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                  ))
                )}
              </div>
              {departures.length > 0 && (
                <button onClick={() => navigate('/operations/projects')} className="w-full flex items-center justify-center gap-1 py-2.5 text-[10px] font-medium border-t hover:bg-gray-50 transition-colors" style={{ color: '#00617F' }}>
                  Veure projectes <ArrowRight size={11} />
                </button>
              )}
            </div>

            {/* Devolucions previstes */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h3 className="text-xs font-medium text-gray-900 flex items-center gap-1.5">
                  <Truck size={13} className="text-purple-600" /> Devolucions previstes
                </h3>
                <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">
                  Avui/demà
                </span>
              </div>
              <div>
                {returns.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">Cap devolució prevista</p>
                ) : (
                  returns.map((p) => {
                    const isToday = new Date(p.returnDate).toDateString() === today.toDateString();
                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 md:gap-2.5 px-3 md:px-4 py-2 md:py-2.5 border-b last:border-b-0 hover:bg-gray-50/50 cursor-pointer transition-colors"
                        onClick={() => navigate('/operations/projects')}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isToday ? 'bg-purple-500' : 'bg-gray-300'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium text-gray-900 truncate">{p.name}</div>
                          <div className="text-[9px] text-gray-400">
                            {p.clientName || p.client?.name || ''}
                            {p.returnTime && ` — ${p.returnTime}`}
                          </div>
                        </div>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${STATUS_CONFIG[p.status]?.color || 'bg-gray-100 text-gray-500'}`}>
                          {STATUS_CONFIG[p.status]?.label || p.status}
                        </span>
                        <div className="text-[9px] text-gray-400 w-14 text-right">
                          {isToday ? 'Avui' : new Date(p.returnDate).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {returns.length > 0 && (
                <button onClick={() => navigate('/operations/projects')} className="w-full flex items-center justify-center gap-1 py-2.5 text-[10px] font-medium border-t hover:bg-gray-50 transition-colors" style={{ color: '#7c3aed' }}>
                  Veure projectes <ArrowRight size={11} />
                </button>
              )}
            </div>

            {/* Incidències obertes */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h3 className="text-xs font-medium text-gray-900 flex items-center gap-1.5">
                  <AlertTriangle size={13} className="text-amber-600" /> Incidències obertes
                </h3>
                {incidents.length > 0 && (
                  <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                    {incidents.length}
                  </span>
                )}
              </div>
              <div>
                {incidents.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">Cap incidència oberta</p>
                ) : (
                  incidents.map((inc) => (
                    <div
                      key={inc.id}
                      className="flex items-center gap-2 md:gap-2.5 px-3 md:px-4 py-2 md:py-2.5 border-b last:border-b-0 hover:bg-gray-50/50 cursor-pointer transition-colors"
                      onClick={() => navigate('/operations/incidents')}
                    >
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${SEVERITY_COLORS[inc.severity]}`}>
                        {SEVERITY_LABELS[inc.severity]}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium text-gray-900 truncate">{inc.title}</div>
                        <div className="text-[9px] text-gray-400">
                          {inc.project?.name || ''}
                          {inc.equipment && ` — ${inc.equipment.name}`}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {incidents.length > 0 && (
                <button onClick={() => navigate('/operations/incidents')} className="w-full flex items-center justify-center gap-1 py-2.5 text-[10px] font-medium border-t hover:bg-gray-50 transition-colors" style={{ color: '#d97706' }}>
                  Veure incidències <ArrowRight size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Tasques del dia — amplada completa */}
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-xs font-medium text-gray-900 flex items-center gap-1.5">
                <ListTodo size={13} className="text-[#00617F]" /> Tasques del dia
              </h3>
              <span className="text-[9px] font-medium px-2 py-0.5 rounded-full" style={{ background: '#e6f3f7', color: '#00617F' }}>
                {tasks.filter((t) => t.status !== 'OP_DONE').length} pendents
              </span>
            </div>
            <div>
              {tasks.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">Cap tasca per avui</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0">
                  {tasks.map((t) => (
                    <div key={t.id} className="flex items-center gap-2.5 px-3 md:px-4 py-3 md:py-2.5 border-b last:border-b-0">
                      <button
                        onClick={() => handleToggleTask(t)}
                        className={`w-5 h-5 md:w-4 md:h-4 rounded flex-shrink-0 border-[1.5px] flex items-center justify-center transition-colors ${
                          t.status === 'OP_DONE'
                            ? 'bg-emerald-500 border-emerald-500'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        {t.status === 'OP_DONE' && (
                          <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <span className={`text-[11px] ${t.status === 'OP_DONE' ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                          {t.title}
                          {t.project && <span className="text-gray-400 font-normal"> — {t.project.name}</span>}
                        </span>
                      </div>
                      {t.assignedTo && (
                        <span className="flex items-center gap-1 text-[10px] text-gray-400">
                          {t.assignedTo.color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.assignedTo.color }} />}
                          {t.assignedTo.name?.split(' ')[0]}
                        </span>
                      )}
                      {t.category && t.category !== 'GENERAL' && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLORS[t.category] || 'bg-gray-50 text-gray-500'}`}>
                          {CATEGORY_LABELS[t.category] || t.category}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {tasks.length > 0 && (
              <button onClick={() => navigate('/operations/tasks')} className="w-full flex items-center justify-center gap-1 py-2.5 text-[10px] font-medium border-t hover:bg-gray-50 transition-colors" style={{ color: '#00617F' }}>
                Veure totes les tasques <ArrowRight size={11} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================
// Transport column (transports avui / demà)
// ===========================================

const TRANSPORT_ESTAT_COLOR = {
  'Pendent':       'bg-gray-100 text-gray-600',
  'Confirmat':     'bg-sky-50 text-sky-700',
  'En Preparació': 'bg-amber-50 text-amber-700',
  'Lliurat':       'bg-emerald-50 text-emerald-700',
};

function TransportColumn({ title, items, emptyText, navigate }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{title}</span>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-gray-400 italic">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((t) => {
            const ruta = [t.origen, t.desti].filter(Boolean).join(' → ');
            const hora = t.horaRecollida || t.horaEntregaEstimada || '—';
            return (
              <li key={t.id} onClick={() => navigate('/logistics')} className="flex items-center gap-2 px-2 py-1.5 rounded border bg-gray-50/50 hover:bg-gray-100 cursor-pointer text-[11px]">
                <span className="font-mono text-gray-500 w-12 shrink-0">{hora}</span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium text-gray-800">{t.tipusServei || 'Transport'}</span>
                  {(t.rentalProject?.name || t.projecte) && <span className="text-gray-500"> · {t.rentalProject?.name || t.projecte}</span>}
                  {ruta && <div className="text-[10px] text-gray-500 truncate">{ruta}</div>}
                </span>
                {t.conductor?.nom && <span className="text-[10px] text-gray-500 truncate max-w-[80px] shrink-0">{t.conductor.nom}</span>}
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 ${TRANSPORT_ESTAT_COLOR[t.estat] || 'bg-gray-100 text-gray-600'}`}>
                  {t.estat}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ===========================================
// Stat Card
// ===========================================

function StatCard({ label, value, sub, color, icon: Icon, onClick }) {
  return (
    <div
      className={`bg-white rounded-xl border p-2.5 md:p-4 transition-all ${onClick ? 'cursor-pointer hover:shadow-md hover:border-gray-300 active:scale-[0.98]' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-1.5 md:mb-3">
        <span className="text-[10px] md:text-[10px] text-gray-400 uppercase tracking-wide font-medium leading-tight">{label}</span>
        <div className="w-6 h-6 md:w-8 md:h-8 rounded-lg flex items-center justify-center flex-shrink-0 ml-1" style={{ background: `${color}10` }}>
          <Icon size={13} className="md:hidden" style={{ color }} />
          <Icon size={15} className="hidden md:block" style={{ color }} />
        </div>
      </div>
      <div className="text-lg md:text-2xl font-medium" style={{ color }}>{value}</div>
      <div className="text-[10px] md:text-[10px] text-gray-400 mt-0.5">{sub}</div>
    </div>
  );
}
