import { useState, useCallback } from 'react';
import {
  ListTodo, Plus, User, Clock, CheckCircle2, Circle, Ban,
  Loader2, Package, CalendarDays, Tag, Bell, Repeat, ChevronDown,
  ChevronUp, X, AlertTriangle,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';
import useAuthStore from '../../stores/authStore';

// ===========================================
// Constants
// ===========================================

const STATUS_CONFIG = {
  OP_PENDING:     { label: 'Pendent',    color: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-400' },
  OP_IN_PROGRESS: { label: 'En curs',    color: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-400' },
  OP_BLOCKED:     { label: 'Bloquejada', color: 'bg-red-100 text-red-700',      dot: 'bg-red-400' },
  OP_DONE:        { label: 'Feta',       color: 'bg-green-100 text-green-700',  dot: 'bg-green-400' },
};

const CATEGORY_CONFIG = {
  WAREHOUSE: { label: 'Magatzem',       color: 'bg-orange-100 text-orange-700', icon: '📦' },
  TECH:      { label: 'Tècnica',        color: 'bg-purple-100 text-purple-700', icon: '🔧' },
  ADMIN:     { label: 'Administració',  color: 'bg-sky-100 text-sky-700',       icon: '📋' },
  TRANSPORT: { label: 'Transport',      color: 'bg-teal-100 text-teal-700',     icon: '🚛' },
  GENERAL:   { label: 'General',        color: 'bg-gray-100 text-gray-600',     icon: '📌' },
};

const REMINDER_OPTIONS = [
  { value: 'NONE',        label: 'Sense recordatori' },
  { value: 'AT_TIME',     label: "A l'hora" },
  { value: 'HOUR_BEFORE', label: '1 hora abans' },
  { value: 'DAY_BEFORE',  label: '1 dia abans' },
  { value: 'CUSTOM',      label: 'Personalitzat' },
];

const RECURRENCE_OPTIONS = [
  { value: 'NONE',    label: 'No es repeteix' },
  { value: 'DAILY',   label: 'Cada dia' },
  { value: 'WEEKLY',  label: 'Cada setmana' },
  { value: 'MONTHLY', label: 'Cada mes' },
  { value: 'CUSTOM',  label: 'Personalitzada' },
];

const VIEWS = [
  { id: 'today',   label: 'Avui',        icon: CalendarDays },
  { id: 'pending', label: 'Pendents',    icon: Circle },
  { id: 'blocked', label: 'Bloquejades', icon: Ban },
  { id: 'done',    label: 'Fetes',       icon: CheckCircle2 },
];

// ===========================================
// Component principal
// ===========================================

export default function Tasks() {
  const currentUser = useAuthStore((s) => s.user);
  const [view, setView] = useState('today');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingTask, setEditingTask] = useState(null);

  const { data: teamUsers } = useApiGet('/operations/team');
  const { data, loading, error, refetch } = useApiGet('/operations/tasks', {
    view,
    category: categoryFilter || undefined,
    assignedToId: userFilter || undefined,
  });

  const tasks = data?.tasks || [];
  const counts = data?.counts || {};
  const isAdmin = data?.isAdmin || false;

  // Canvi ràpid d'estat
  const handleStatusChange = useCallback(async (taskId, newStatus) => {
    try {
      await api.put(`/operations/tasks/${taskId}`, { status: newStatus });
      refetch();
    } catch { alert('Error actualitzant tasca'); }
  }, [refetch]);

  // Marcar com a feta / desfer
  const handleToggleDone = useCallback(async (task) => {
    const newStatus = task.status === 'OP_DONE' ? 'OP_PENDING' : 'OP_DONE';
    await handleStatusChange(task.id, newStatus);
  }, [handleStatusChange]);

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl mx-auto">
      {/* Capçalera */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListTodo size={24} className="text-primary" />
          <h1 className="text-xl sm:text-2xl font-bold">Tasques</h1>
        </div>
        <button
          onClick={() => { setShowCreate(true); setEditingTask(null); }}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 active:scale-95 transition-transform"
        >
          <Plus size={16} /> Nova
        </button>
      </div>

      {/* Tabs de vista */}
      <div className="flex border rounded-lg overflow-hidden bg-muted/30">
        {VIEWS.map(({ id, label, icon: Icon }) => {
          const count = id === 'today' ? counts.today : id === 'pending' ? counts.pending : id === 'blocked' ? counts.blocked : null;
          return (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs sm:text-sm font-medium transition-colors ${
                view === id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{label.substring(0, 3)}</span>
              {count > 0 && view !== id && (
                <span className="bg-white/20 text-[10px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="border rounded-lg px-2.5 py-1.5 text-sm bg-background"
        >
          <option value="">Totes les categories</option>
          {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        {isAdmin && (
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="border rounded-lg px-2.5 py-1.5 text-sm bg-background"
          >
            <option value="">Tots</option>
            {teamUsers?.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
        {data?.total > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">{data.total} tasques</span>
        )}
      </div>

      {/* Modal/formulari de creació */}
      {showCreate && (
        <TaskForm
          teamUsers={teamUsers}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refetch(); }}
          task={editingTask}
        />
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-primary" size={28} />
        </div>
      )}

      {error && <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm">{error}</div>}

      {/* Llista de tasques */}
      {!loading && tasks.length === 0 && (
        <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground text-sm">
          {view === 'today' ? "Cap tasca per avui" :
           view === 'blocked' ? "Cap tasca bloquejada" :
           view === 'done' ? "Cap tasca completada" :
           "Cap tasca pendent"}
        </div>
      )}

      {!loading && (
        <div className="space-y-1.5">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              currentUser={currentUser}
              isAdmin={isAdmin}
              teamUsers={teamUsers}
              onToggleDone={handleToggleDone}
              onStatusChange={handleStatusChange}
              onEdit={(t) => { setEditingTask(t); setShowCreate(true); }}
              refetch={refetch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================
// Targeta de tasca
// ===========================================

function TaskCard({ task, currentUser, isAdmin, teamUsers, onToggleDone, onStatusChange, onEdit, refetch }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = task.status === 'OP_DONE';
  const isBlocked = task.status === 'OP_BLOCKED';
  const isOverdue = task.dueAt && !isDone && new Date(task.dueAt) < new Date(new Date().setHours(0, 0, 0, 0));
  const cat = CATEGORY_CONFIG[task.category] || CATEGORY_CONFIG.GENERAL;

  return (
    <div className={`bg-card border rounded-lg overflow-hidden transition-colors ${
      isBlocked ? 'border-red-200 bg-red-50/30' :
      isOverdue ? 'border-amber-200' :
      isDone ? 'opacity-70' : ''
    }`}>
      {/* Fila principal */}
      <div className="flex items-center gap-2.5 p-3 sm:p-3.5">
        {/* Checkbox */}
        <button
          onClick={() => onToggleDone(task)}
          className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            isDone ? 'bg-green-500 border-green-500 text-white' :
            isBlocked ? 'border-red-300' : 'border-gray-300 hover:border-primary'
          }`}
        >
          {isDone && <CheckCircle2 size={12} />}
        </button>

        {/* Contingut */}
        <div className="flex-1 min-w-0" onClick={() => setExpanded(!expanded)}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-sm font-medium ${isDone ? 'line-through text-muted-foreground' : ''} ${isOverdue ? 'text-red-700' : ''}`}>
              {task.title}
            </span>
          </div>

          {/* Metadata en línia */}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {/* Categoria */}
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${cat.color}`}>
              {cat.icon} {cat.label}
            </span>

            {/* Data */}
            {task.dueAt && (
              <span className={`text-[10px] flex items-center gap-0.5 ${isOverdue ? 'text-red-500 font-semibold' : 'text-muted-foreground'}`}>
                <Clock size={9} />
                {new Date(task.dueAt).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' })}
                {task.dueTime && ` ${task.dueTime}`}
              </span>
            )}

            {/* Assignat */}
            {task.assignedTo && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <User size={9} /> {task.assignedTo.name}
              </span>
            )}

            {/* Projecte */}
            {task.project && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Package size={9} /> {task.project.name}
              </span>
            )}

            {/* Repetició */}
            {task.recurrence && task.recurrence !== 'NONE' && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Repeat size={9} />
              </span>
            )}

            {/* Recordatori */}
            {task.reminder && task.reminder !== 'NONE' && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Bell size={9} />
              </span>
            )}
          </div>
        </div>

        {/* Estat ràpid (dropdown petit) */}
        <select
          value={task.status}
          onChange={(e) => onStatusChange(task.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className={`text-[10px] border rounded-md px-1 py-0.5 bg-background flex-shrink-0 ${
            isBlocked ? 'border-red-200' : ''
          }`}
        >
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        {/* Expand */}
        <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground flex-shrink-0 p-1">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Detall expandit */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t bg-muted/20 space-y-2 text-sm">
          {task.notes && (
            <div>
              <span className="text-xs text-muted-foreground font-medium">Notes:</span>
              <p className="text-sm mt-0.5 whitespace-pre-wrap">{task.notes}</p>
            </div>
          )}
          {task.description && (
            <div>
              <span className="text-xs text-muted-foreground font-medium">Descripció:</span>
              <p className="text-sm mt-0.5 whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            {task.createdBy && <span>Creada per {task.createdBy.name}</span>}
            {task.completedBy && <span>· Completada per {task.completedBy.name}</span>}
            {task.completedAt && (
              <span>el {new Date(task.completedAt).toLocaleDateString('ca-ES')}</span>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onEdit(task)}
              className="text-xs text-primary hover:underline"
            >
              Editar
            </button>
            {isAdmin && task.assignedTo && (
              <span className="text-xs text-muted-foreground">
                Assignada a {task.assignedTo.name}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================
// Formulari de creació / edició
// ===========================================

function TaskForm({ teamUsers, onClose, onSaved, task }) {
  const isEdit = !!task;
  const [form, setForm] = useState({
    title: task?.title || '',
    assignedToId: task?.assignedToId || '',
    category: task?.category || 'GENERAL',
    dueAt: task?.dueAt ? task.dueAt.substring(0, 10) : '',
    dueTime: task?.dueTime || '',
    reminder: task?.reminder || 'NONE',
    reminderCustom: task?.reminderCustom || '',
    recurrence: task?.recurrence || 'NONE',
    recurrenceCustom: task?.recurrenceCustom || '',
    notes: task?.notes || '',
    projectId: task?.projectId || '',
  });
  const [showMore, setShowMore] = useState(
    isEdit && (form.dueAt || form.notes || form.reminder !== 'NONE' || form.recurrence !== 'NONE')
  );
  const [saving, setSaving] = useState(false);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        assignedToId: form.assignedToId || undefined,
        category: form.category,
        dueAt: form.dueAt || undefined,
        dueTime: form.dueTime || undefined,
        reminder: form.reminder,
        reminderCustom: form.reminder === 'CUSTOM' ? form.reminderCustom : undefined,
        recurrence: form.recurrence,
        recurrenceCustom: form.recurrence === 'CUSTOM' ? form.recurrenceCustom : undefined,
        notes: form.notes || undefined,
        projectId: form.projectId || undefined,
      };
      if (isEdit) {
        await api.put(`/operations/tasks/${task.id}`, body);
      } else {
        await api.post('/operations/tasks', body);
      }
      onSaved();
    } catch (err) {
      alert(err.response?.data?.error || 'Error guardant tasca');
    } finally {
      setSaving(false);
    }
  };

  // Creació ràpida: Enter sense Shift
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !showMore) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="bg-card border-2 border-primary/20 rounded-lg p-3 sm:p-4 space-y-3">
      <form onSubmit={handleSubmit}>
        {/* Fila principal: títol + enviar */}
        <div className="flex gap-2">
          <input
            autoFocus
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Què s'ha de fer?"
            className="flex-1 border rounded-lg px-3 py-2.5 text-sm bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          />
          <button
            type="submit"
            disabled={saving || !form.title.trim()}
            className="bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap"
          >
            {saving ? '...' : isEdit ? 'Guardar' : 'Crear'}
          </button>
        </div>

        {/* Fila de camps ràpids */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Categoria */}
          <select
            value={form.category}
            onChange={(e) => set('category', e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-xs bg-background"
          >
            {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>

          {/* Responsable */}
          <select
            value={form.assignedToId}
            onChange={(e) => set('assignedToId', e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-xs bg-background"
          >
            <option value="">Sense assignar</option>
            {teamUsers?.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>

          {/* Data */}
          <input
            type="date"
            value={form.dueAt}
            onChange={(e) => set('dueAt', e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-xs bg-background"
          />

          {/* Botó per obrir camps opcionals */}
          <button
            type="button"
            onClick={() => setShowMore(!showMore)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ml-auto"
          >
            {showMore ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showMore ? 'Menys' : 'Més opcions'}
          </button>
        </div>

        {/* Camps opcionals expandibles */}
        {showMore && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t">
            {/* Hora */}
            <div>
              <label className="text-xs text-muted-foreground">Hora</label>
              <input
                type="time"
                value={form.dueTime}
                onChange={(e) => set('dueTime', e.target.value)}
                className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-background mt-0.5"
              />
            </div>

            {/* Recordatori */}
            <div>
              <label className="text-xs text-muted-foreground">Recordatori</label>
              <select
                value={form.reminder}
                onChange={(e) => set('reminder', e.target.value)}
                className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-background mt-0.5"
              >
                {REMINDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {form.reminder === 'CUSTOM' && (
              <div>
                <label className="text-xs text-muted-foreground">Recordatori personalitzat</label>
                <input
                  value={form.reminderCustom}
                  onChange={(e) => set('reminderCustom', e.target.value)}
                  placeholder="Ex: 30 minuts abans"
                  className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-background mt-0.5"
                />
              </div>
            )}

            {/* Repetició */}
            <div>
              <label className="text-xs text-muted-foreground">Repetició</label>
              <select
                value={form.recurrence}
                onChange={(e) => set('recurrence', e.target.value)}
                className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-background mt-0.5"
              >
                {RECURRENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {form.recurrence === 'CUSTOM' && (
              <div>
                <label className="text-xs text-muted-foreground">Repetició personalitzada</label>
                <input
                  value={form.recurrenceCustom}
                  onChange={(e) => set('recurrenceCustom', e.target.value)}
                  placeholder="Ex: cada 2 setmanes"
                  className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-background mt-0.5"
                />
              </div>
            )}

            {/* Notes */}
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Informació addicional..."
                rows={2}
                className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-background mt-0.5 resize-none"
              />
            </div>
          </div>
        )}

        {/* Tancar */}
        <div className="flex justify-end pt-1">
          <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel·lar
          </button>
        </div>
      </form>
    </div>
  );
}
