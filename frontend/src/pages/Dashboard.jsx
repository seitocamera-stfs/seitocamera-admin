import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Package, CheckCircle2, ListTodo, AlertTriangle,
  ArrowRight, Calendar, User, Loader2, RefreshCw,
} from 'lucide-react';
import { useApiGet } from '../hooks/useApi';
import api from '../lib/api';

// ===========================================
// Constants
// ===========================================

const STATUS_CONFIG = {
  PENDING_PREP:        { label: 'Pendent preparar',   color: 'bg-gray-100 text-gray-600' },
  IN_PREPARATION:      { label: 'En preparació',      color: 'bg-blue-50 text-blue-700' },
  PENDING_TECH_REVIEW: { label: 'Revisió tècnica',    color: 'bg-amber-50 text-amber-700' },
  PENDING_FINAL_CHECK: { label: 'Validació final',    color: 'bg-orange-50 text-orange-700' },
  READY:               { label: 'Preparat',           color: 'bg-emerald-50 text-emerald-700' },
  OUT:                 { label: 'Sortit',             color: 'bg-violet-50 text-violet-700' },
  RETURNED:            { label: 'Retornat',           color: 'bg-purple-50 text-purple-700' },
};

const CATEGORY_LABELS = {
  WAREHOUSE: 'Magatzem',
  TECH: 'Tècnica',
  ADMIN: 'Admin',
  TRANSPORT: 'Transport',
  GENERAL: 'General',
};

const CATEGORY_COLORS = {
  TECH: 'bg-sky-50 text-[#00617F]',
  WAREHOUSE: 'bg-amber-50 text-amber-700',
  ADMIN: 'bg-gray-100 text-gray-600',
  TRANSPORT: 'bg-violet-50 text-violet-700',
  GENERAL: 'bg-gray-50 text-gray-500',
};

// ===========================================
// Component principal
// ===========================================

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, loading, refetch } = useApiGet('/operations/dashboard');
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post('/rentman/sync/projects');
      refetch();
    } catch (err) {
      alert('Error sincronitzant');
    } finally {
      setSyncing(false);
    }
  };

  const stats = data?.stats || {};
  const departures = data?.upcomingDepartures || [];
  const tasks = data?.tasksToday || [];

  const today = new Date();
  const dayNames = ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'];
  const monthNames = ['gener', 'febrer', 'març', 'abril', 'maig', 'juny', 'juliol', 'agost', 'setembre', 'octubre', 'novembre', 'desembre'];
  const dateStr = `${dayNames[today.getDay()]}, ${today.getDate()} ${monthNames[today.getMonth()]} ${today.getFullYear()}`;

  const handleToggleTask = async (task) => {
    const newStatus = task.status === 'OP_DONE' ? 'OP_PENDING' : 'OP_DONE';
    try {
      await api.put(`/operations/tasks/${task.id}`, { status: newStatus });
      refetch();
    } catch {
      // silently fail
    }
  };

  return (
    <div className="min-h-screen" style={{ background: '#f8f9fa' }}>
      {/* Top bar */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-gray-900">Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">{dateStr}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2 text-xs border rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            Sync Rentman
          </button>
          <button
            onClick={() => navigate('/operations/projects')}
            className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg text-white transition-colors"
            style={{ background: '#00617F' }}
          >
            <Package size={13} />
            Nou projecte
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-gray-300" size={32} />
        </div>
      ) : (
        <div className="px-6 py-5 max-w-7xl mx-auto space-y-5">
          {/* Mètriques */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="Projectes actius"
              value={stats.activeProjects || 0}
              sub={`${stats.readyProjects || 0} preparats`}
              color="#00617F"
              icon={Package}
            />
            <StatCard
              label="Preparats"
              value={stats.readyProjects || 0}
              sub="Llestos per sortir"
              color="#059669"
              icon={CheckCircle2}
            />
            <StatCard
              label="Tasques pendents"
              value={stats.pendingTasks || 0}
              sub={`${stats.todayTasks || 0} per avui`}
              color="#d97706"
              icon={ListTodo}
            />
            <StatCard
              label="Incidències"
              value={stats.openIncidents || 0}
              sub={stats.criticalIncidents > 0 ? `${stats.criticalIncidents} crítica` : 'Cap crítica'}
              color={stats.openIncidents > 0 ? '#dc2626' : '#059669'}
              icon={AlertTriangle}
            />
          </div>

          {/* Panells */}
          <div className="grid grid-cols-2 gap-4">
            {/* Pròximes sortides */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h3 className="text-xs font-medium text-gray-900">Pròximes sortides</h3>
                <span
                  className="text-[9px] font-medium px-2 py-0.5 rounded-full"
                  style={{ background: '#e6f3f7', color: '#00617F' }}
                >
                  Aquesta setmana
                </span>
              </div>
              <div>
                {departures.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">Cap sortida programada</p>
                ) : (
                  departures.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2.5 px-4 py-2.5 border-b last:border-b-0 hover:bg-gray-50/50 cursor-pointer transition-colors"
                      onClick={() => navigate('/operations/projects')}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{
                          background: p.status === 'READY' ? '#059669'
                            : p.status === 'OUT' ? '#7c3aed'
                            : p.status === 'PENDING_PREP' ? '#d97706'
                            : '#00617F',
                        }}
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
                <button
                  onClick={() => navigate('/operations/projects')}
                  className="w-full flex items-center justify-center gap-1 py-2.5 text-[10px] font-medium border-t hover:bg-gray-50 transition-colors"
                  style={{ color: '#00617F' }}
                >
                  Veure tots els projectes
                  <ArrowRight size={11} />
                </button>
              )}
            </div>

            {/* Tasques del dia */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h3 className="text-xs font-medium text-gray-900">Tasques del dia</h3>
                <span
                  className="text-[9px] font-medium px-2 py-0.5 rounded-full"
                  style={{ background: '#e6f3f7', color: '#00617F' }}
                >
                  {tasks.filter((t) => t.status !== 'OP_DONE').length} pendents
                </span>
              </div>
              <div>
                {tasks.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">Cap tasca per avui</p>
                ) : (
                  tasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-2.5 px-4 py-2.5 border-b last:border-b-0"
                    >
                      <button
                        onClick={() => handleToggleTask(t)}
                        className={`w-4 h-4 rounded flex-shrink-0 border-[1.5px] flex items-center justify-center transition-colors ${
                          t.status === 'OP_DONE'
                            ? 'bg-emerald-500 border-emerald-500'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        {t.status === 'OP_DONE' && (
                          <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <span className={`text-[11px] ${t.status === 'OP_DONE' ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                          {t.title}
                          {t.project && (
                            <span className="text-gray-400 font-normal"> — {t.project.name}</span>
                          )}
                        </span>
                      </div>
                      {t.category && t.category !== 'GENERAL' && (
                        <span className={`text-[8px] px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLORS[t.category] || 'bg-gray-50 text-gray-500'}`}>
                          {CATEGORY_LABELS[t.category] || t.category}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
              {tasks.length > 0 && (
                <button
                  onClick={() => navigate('/operations/tasks')}
                  className="w-full flex items-center justify-center gap-1 py-2.5 text-[10px] font-medium border-t hover:bg-gray-50 transition-colors"
                  style={{ color: '#00617F' }}
                >
                  Veure totes les tasques
                  <ArrowRight size={11} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================
// Stat Card
// ===========================================

function StatCard({ label, value, sub, color, icon: Icon }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</span>
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: `${color}10` }}
        >
          <Icon size={15} style={{ color }} />
        </div>
      </div>
      <div className="text-2xl font-medium" style={{ color }}>{value}</div>
      <div className="text-[10px] text-gray-400 mt-1">{sub}</div>
    </div>
  );
}
