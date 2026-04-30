import { useState } from 'react';
import {
  CalendarDays, Package, ArrowRight, Truck, AlertTriangle,
  Users, Clock, CheckCircle2, XCircle, ChevronLeft, ChevronRight,
  Bell, Shield, Warehouse, Wrench, User, Phone, Loader2,
  ListTodo, Circle,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

// ===========================================
// Constants
// ===========================================

const STATUS_LABELS = {
  PENDING_PREP: 'Pendent preparar',
  IN_PREPARATION: 'En preparació',
  READY: 'Preparat',
  OUT: 'Sortit',
  RETURNED: 'Retornat',
  CLOSED: 'Tancat',
};

const STATUS_COLORS = {
  PENDING_PREP: 'bg-gray-100 text-gray-700',
  IN_PREPARATION: 'bg-blue-100 text-blue-700',
  READY: 'bg-green-100 text-green-700',
  OUT: 'bg-indigo-100 text-indigo-700',
  RETURNED: 'bg-purple-100 text-purple-700',
  CLOSED: 'bg-gray-200 text-gray-600',
};

const PRIORITY_LABELS = { 0: '', 1: 'Alta', 2: 'Urgent' };
const PRIORITY_COLORS = { 0: '', 1: 'text-orange-600', 2: 'text-red-600 font-bold' };

const SEVERITY_LABELS = { LOW: 'Baixa', MEDIUM: 'Mitjana', HIGH: 'Alta', CRITICAL: 'Crítica' };
const SEVERITY_COLORS = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  HIGH: 'bg-orange-100 text-orange-700',
  CRITICAL: 'bg-red-100 text-red-700',
};

const ROLE_ICONS = {
  ADMIN_COORDINATION: Phone,
  WAREHOUSE_LEAD: Warehouse,
  WAREHOUSE_SUPPORT: Package,
  TECH_LEAD: Wrench,
  INTERN_SUPPORT: User,
  GENERAL_MANAGER: Shield,
};

function formatDate(d) {
  return new Date(d).toLocaleDateString('ca-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function toDateStr(d) {
  const dd = new Date(d);
  return `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
}

// ===========================================
// Component principal
// ===========================================

export default function DailyPlan() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const dateStr = toDateStr(selectedDate);

  const { data, loading, error, refetch } = useApiGet(`/operations/daily/${dateStr}`);

  const changeDay = (delta) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d);
  };

  const goToday = () => setSelectedDate(new Date());

  const { checksToday, departuresToday, departuresTomorrow, returnsToday, openIncidents, staff, plan, myTasks } = data || {};

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 text-red-600 p-4 rounded-lg">{error}</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Capçalera */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <CalendarDays size={28} className="text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Pla del Dia</h1>
            <p className="text-sm text-muted-foreground capitalize">{formatDate(selectedDate)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => changeDay(-1)} className="p-2 rounded-md hover:bg-accent">
            <ChevronLeft size={20} />
          </button>
          <button onClick={goToday} className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
            Avui
          </button>
          <button onClick={() => changeDay(1)} className="p-2 rounded-md hover:bg-accent">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* Alertes urgents */}
      {plan?.urgentNotes && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <Bell className="text-red-500 mt-0.5 flex-shrink-0" size={20} />
          <div>
            <p className="font-semibold text-red-700">Alertes urgents</p>
            <p className="text-sm text-red-600 mt-1">{plan.urgentNotes}</p>
          </div>
        </div>
      )}

      {/* Personal disponible */}
      {staff?.length > 0 && (
        <div className="bg-card border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Users size={16} /> Personal amb rol assignat
          </h3>
          <div className="flex flex-wrap gap-2">
            {staff.map((s) => {
              const RoleIcon = ROLE_ICONS[s.role.code] || User;
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border"
                  style={{ borderColor: s.role.color, color: s.role.color }}
                >
                  <RoleIcon size={14} />
                  <span className="font-medium">{s.user.name}</span>
                  <span className="text-xs opacity-70">{s.role.shortName}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Checks d'avui (preparació/recollida material) */}
        {checksToday?.length > 0 && (
          <ProjectSection
            title="Checks d'avui (preparació)"
            icon={<Wrench size={18} className="text-cyan-600" />}
            projects={checksToday}
            emptyText=""
            isCheck
            refetch={refetch}
          />
        )}

        {/* Sortides d'avui */}
        <ProjectSection
          title="Sortides d'avui"
          icon={<Package size={18} className="text-blue-600" />}
          projects={departuresToday}
          emptyText="Cap sortida programada per avui"
          refetch={refetch}
        />

        {/* Sortides de demà */}
        <ProjectSection
          title="Sortides de demà"
          icon={<ArrowRight size={18} className="text-indigo-600" />}
          projects={departuresTomorrow}
          emptyText="Cap sortida programada per demà"
          refetch={refetch}
        />

        {/* Devolucions d'avui */}
        <ProjectSection
          title="Devolucions previstes"
          icon={<Truck size={18} className="text-purple-600" />}
          projects={returnsToday}
          emptyText="Cap devolució prevista per avui"
          isReturn
          refetch={refetch}
        />

        {/* Incidències obertes */}
        <div className="bg-card border rounded-lg">
          <div className="p-4 border-b flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-600" />
            <h2 className="font-semibold">Incidències obertes</h2>
            {openIncidents?.length > 0 && (
              <span className="ml-auto bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                {openIncidents.length}
              </span>
            )}
          </div>
          <div className="divide-y max-h-80 overflow-y-auto">
            {(!openIncidents || openIncidents.length === 0) ? (
              <p className="p-4 text-sm text-muted-foreground">Cap incidència oberta</p>
            ) : (
              openIncidents.map((inc) => (
                <div key={inc.id} className="p-3 hover:bg-accent/50">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${SEVERITY_COLORS[inc.severity]}`}>
                      {SEVERITY_LABELS[inc.severity]}
                    </span>
                    <span className="text-sm font-medium truncate">{inc.title}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {inc.project && <span>{inc.project.name}</span>}
                    {inc.equipment && <span>— {inc.equipment.name}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Les meves tasques */}
      <div className="bg-card border rounded-lg">
        <div className="p-4 border-b flex items-center gap-2">
          <ListTodo size={18} className="text-primary" />
          <h2 className="font-semibold">Les meves tasques</h2>
          {myTasks?.length > 0 && (
            <span className="ml-auto bg-primary/10 text-primary text-xs font-semibold px-2 py-0.5 rounded-full">
              {myTasks.length}
            </span>
          )}
        </div>
        <div className="divide-y max-h-96 overflow-y-auto">
          {(!myTasks || myTasks.length === 0) ? (
            <p className="p-4 text-sm text-muted-foreground">No tens tasques pendents assignades</p>
          ) : (
            myTasks.map((task) => {
              const isOverdue = task.dueAt && new Date(task.dueAt) < new Date();
              return (
                <div key={task.id} className="p-3 hover:bg-accent/50">
                  <div className="flex items-start gap-2">
                    <Circle size={14} className={`mt-0.5 flex-shrink-0 ${isOverdue ? 'text-red-400' : 'text-muted-foreground'}`} />
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-medium ${isOverdue ? 'text-red-700' : ''}`}>
                        {task.title}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                        {task.project && (
                          <span className="bg-muted px-1.5 py-0.5 rounded">{task.project.name}</span>
                        )}
                        {task.dueAt && (
                          <span className={isOverdue ? 'text-red-500 font-medium' : ''}>
                            <Clock size={10} className="inline mr-0.5" />
                            {new Date(task.dueAt).toLocaleDateString('ca-ES')}
                          </span>
                        )}
                        {task.createdBy && (
                          <span>assignada per {task.createdBy.name}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Notes del dia */}
      <DailyNotes dateStr={dateStr} plan={plan} refetch={refetch} />
    </div>
  );
}

// ===========================================
// Sub-components
// ===========================================

function ProjectSection({ title, icon, projects, emptyText, isReturn, isCheck, refetch }) {
  return (
    <div className="bg-card border rounded-lg">
      <div className="p-4 border-b flex items-center gap-2">
        {icon}
        <h2 className="font-semibold">{title}</h2>
        {projects?.length > 0 && (
          <span className="ml-auto bg-primary/10 text-primary text-xs font-semibold px-2 py-0.5 rounded-full">
            {projects.length}
          </span>
        )}
      </div>
      <div className="divide-y max-h-96 overflow-y-auto">
        {(!projects || projects.length === 0) ? (
          <p className="p-4 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          projects.map((p) => (
            <div key={p.id} className="p-3 hover:bg-accent/50">
              <div className="flex items-center gap-2 mb-1">
                {p.priority > 0 && (
                  <span className={`text-xs font-bold ${PRIORITY_COLORS[p.priority]}`}>
                    {PRIORITY_LABELS[p.priority]}
                  </span>
                )}
                <span className="text-sm font-medium truncate flex-1">{p.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[p.status]}`}>
                  {STATUS_LABELS[p.status]}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {isCheck && p.checkTime && (
                  <span className="flex items-center gap-1">
                    <Clock size={12} /> {p.checkTime}
                  </span>
                )}
                {!isReturn && !isCheck && p.departureTime && (
                  <span className="flex items-center gap-1">
                    <Clock size={12} /> {p.departureTime}
                  </span>
                )}
                {isReturn && p.returnTime && (
                  <span className="flex items-center gap-1">
                    <Clock size={12} /> {p.returnTime}
                  </span>
                )}
                {p.leadUser && (
                  <span className="flex items-center gap-1">
                    <User size={12} /> {p.leadUser.name}
                  </span>
                )}
                {p.assignments?.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Users size={12} /> +{p.assignments.length}
                  </span>
                )}
                {p._count?.incidents > 0 && (
                  <span className="flex items-center gap-1 text-amber-600">
                    <AlertTriangle size={12} /> {p._count.incidents}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DailyNotes({ dateStr, plan, refetch }) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(plan?.summary || '');
  const [urgentNotes, setUrgentNotes] = useState(plan?.urgentNotes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/operations/daily/${dateStr}`, { summary, urgentNotes });
      setEditing(false);
      refetch();
    } catch (err) {
      alert('Error guardant notes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <CalendarDays size={16} /> Notes del dia
        </h3>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-primary hover:underline"
          >
            Editar
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="text-sm text-muted-foreground hover:underline"
            >
              Cancel·lar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm bg-primary text-primary-foreground px-3 py-1 rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Guardant...' : 'Guardar'}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Resum del dia</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full mt-1 border rounded-md p-2 text-sm min-h-[80px] bg-background"
              placeholder="Notes generals sobre el dia..."
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Notes urgents</label>
            <textarea
              value={urgentNotes}
              onChange={(e) => setUrgentNotes(e.target.value)}
              className="w-full mt-1 border rounded-md p-2 text-sm min-h-[60px] bg-background border-red-200"
              placeholder="Alertes o avisos urgents..."
            />
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          {plan?.summary || <span className="italic">Cap nota per avui. Clica "Editar" per afegir-ne.</span>}
        </div>
      )}
    </div>
  );
}
