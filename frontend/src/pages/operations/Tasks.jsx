import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ListTodo, Plus, User, Clock, CheckCircle2, Circle, Ban,
  Loader2, Package, CalendarDays, Tag, Bell, Repeat, ChevronDown,
  ChevronUp, X, AlertTriangle, MessageSquare, History,
  GripVertical, LayoutGrid, List, Send, Trash2, ArrowUp,
  ArrowDown, Minus, FileText, Zap, Check,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';
import useAuthStore from '../../stores/authStore';

// ===========================================
// Constants
// ===========================================

const STATUS_CONFIG = {
  OP_PENDING:     { label: 'Pendent',    color: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-400', kanbanBg: 'bg-amber-50' },
  OP_IN_PROGRESS: { label: 'En curs',    color: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-400',  kanbanBg: 'bg-blue-50' },
  OP_BLOCKED:     { label: 'Bloquejada', color: 'bg-red-100 text-red-700',      dot: 'bg-red-400',   kanbanBg: 'bg-red-50' },
  OP_DONE:        { label: 'Feta',       color: 'bg-green-100 text-green-700',  dot: 'bg-green-400', kanbanBg: 'bg-green-50' },
};

const CATEGORY_CONFIG = {
  WAREHOUSE: { label: 'Magatzem',       color: 'bg-orange-100 text-orange-700', icon: '📦' },
  TECH:      { label: 'Tècnica',        color: 'bg-purple-100 text-purple-700', icon: '🔧' },
  ADMIN:     { label: 'Administració',  color: 'bg-sky-100 text-sky-700',       icon: '📋' },
  TRANSPORT: { label: 'Transport',      color: 'bg-teal-100 text-teal-700',     icon: '🚛' },
  GENERAL:   { label: 'General',        color: 'bg-gray-100 text-gray-600',     icon: '📌' },
};

const PRIORITY_CONFIG = {
  LOW:    { label: 'Baixa',  color: 'text-gray-400',   icon: ArrowDown, badge: 'bg-gray-100 text-gray-600' },
  NORMAL: { label: 'Normal', color: 'text-blue-400',   icon: Minus,     badge: 'bg-blue-50 text-blue-600' },
  HIGH:   { label: 'Alta',   color: 'text-orange-500', icon: ArrowUp,   badge: 'bg-orange-100 text-orange-700' },
  URGENT: { label: 'Urgent', color: 'text-red-500',    icon: AlertTriangle, badge: 'bg-red-100 text-red-700' },
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

const KANBAN_COLUMNS = ['OP_PENDING', 'OP_IN_PROGRESS', 'OP_BLOCKED', 'OP_DONE'];

const ACTIVITY_LABELS = {
  created: 'ha creat la tasca',
  created_from_template: 'ha creat la tasca des de plantilla',
  status_change: 'ha canviat l\'estat',
  assigned: 'ha reassignat la tasca',
  priority_change: 'ha canviat la prioritat',
  comment: 'ha afegit un comentari',
  checklist_done: 'ha completat',
  checklist_undone: 'ha desmarcat',
  checklist_added: 'ha afegit al checklist',
};

// ===========================================
// Component principal
// ===========================================

export default function Tasks() {
  const currentUser = useAuthStore((s) => s.user);
  const [view, setView] = useState('today');
  const [viewMode, setViewMode] = useState('list'); // 'list' o 'kanban'
  const [categoryFilter, setCategoryFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);

  const { data: teamUsers } = useApiGet('/operations/team');
  const { data, loading, error, refetch } = useApiGet('/operations/tasks', {
    view: viewMode === 'kanban' ? 'all' : view,
    category: categoryFilter || undefined,
    assignedToId: userFilter || undefined,
  });

  const tasks = data?.tasks || [];
  const counts = data?.counts || {};
  const isAdmin = data?.isAdmin || false;

  const filteredTasks = priorityFilter
    ? tasks.filter(t => t.priority === priorityFilter)
    : tasks;

  const handleStatusChange = useCallback(async (taskId, newStatus) => {
    try {
      await api.put(`/operations/tasks/${taskId}`, { status: newStatus });
      refetch();
    } catch { alert('Error actualitzant tasca'); }
  }, [refetch]);

  const handleToggleDone = useCallback(async (task) => {
    const newStatus = task.status === 'OP_DONE' ? 'OP_PENDING' : 'OP_DONE';
    await handleStatusChange(task.id, newStatus);
  }, [handleStatusChange]);

  const handleDelete = useCallback(async (taskId) => {
    if (!confirm('Eliminar aquesta tasca?')) return;
    try {
      await api.delete(`/operations/tasks/${taskId}`);
      if (selectedTask?.id === taskId) setSelectedTask(null);
      refetch();
    } catch { alert('Error eliminant tasca'); }
  }, [refetch, selectedTask]);

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">
      {/* Capçalera */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListTodo size={24} className="text-primary" />
          <h1 className="text-xl sm:text-2xl font-bold">Tasques</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle vista */}
          <div className="flex border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
              title="Vista llista"
            >
              <List size={16} />
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`p-2 ${viewMode === 'kanban' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
              title="Vista Kanban"
            >
              <LayoutGrid size={16} />
            </button>
          </div>
          <button
            onClick={() => { setShowCreate(true); setEditingTask(null); }}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 active:scale-95 transition-transform"
          >
            <Plus size={16} /> Nova
          </button>
        </div>
      </div>

      {/* Tabs de vista (només en mode llista) */}
      {viewMode === 'list' && (
        <div className="flex border rounded-lg overflow-hidden bg-muted/30">
          {VIEWS.map(({ id, label, icon: Icon }) => {
            const count = id === 'today' ? counts.today : id === 'pending' ? counts.pending : id === 'blocked' ? counts.blocked : null;
            return (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs sm:text-sm font-medium transition-colors ${
                  view === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{label.substring(0, 3)}</span>
                {count > 0 && view !== id && (
                  <span className="bg-white/20 text-[10px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Filtres */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="border rounded-lg px-2.5 py-1.5 text-sm bg-background">
          <option value="">Totes les categories</option>
          {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="border rounded-lg px-2.5 py-1.5 text-sm bg-background">
          <option value="">Totes prioritats</option>
          {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        {isAdmin && (
          <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="border rounded-lg px-2.5 py-1.5 text-sm bg-background">
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

      {/* Modal creació */}
      {showCreate && (
        <TaskForm teamUsers={teamUsers} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); refetch(); }} task={editingTask} />
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-primary" size={28} />
        </div>
      )}

      {error && <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm">{error}</div>}

      {/* Contingut principal */}
      {!loading && (
        <div className={selectedTask ? 'grid grid-cols-1 lg:grid-cols-3 gap-4' : ''}>
          {/* Llista / Kanban */}
          <div className={selectedTask ? 'lg:col-span-2' : ''}>
            {viewMode === 'kanban' ? (
              <KanbanBoard tasks={filteredTasks} onStatusChange={handleStatusChange} onToggleDone={handleToggleDone}
                onEdit={(t) => { setEditingTask(t); setShowCreate(true); }} onSelect={setSelectedTask}
                selectedTaskId={selectedTask?.id} onDelete={handleDelete} refetch={refetch} />
            ) : (
              <>
                {filteredTasks.length === 0 && (
                  <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground text-sm">
                    {view === 'today' ? "Cap tasca per avui" : view === 'blocked' ? "Cap tasca bloquejada" : view === 'done' ? "Cap tasca completada" : "Cap tasca pendent"}
                  </div>
                )}
                <div className="space-y-1.5">
                  {filteredTasks.map((task) => (
                    <TaskCard key={task.id} task={task} currentUser={currentUser} isAdmin={isAdmin} teamUsers={teamUsers}
                      onToggleDone={handleToggleDone} onStatusChange={handleStatusChange}
                      onEdit={(t) => { setEditingTask(t); setShowCreate(true); }}
                      onSelect={setSelectedTask} selectedTaskId={selectedTask?.id}
                      onDelete={handleDelete} refetch={refetch} />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Panel de detall (lateral) */}
          {selectedTask && (
            <TaskDetailPanel task={selectedTask} currentUser={currentUser} onClose={() => setSelectedTask(null)} refetch={refetch} />
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================
// Kanban Board
// ===========================================

function KanbanBoard({ tasks, onStatusChange, onToggleDone, onEdit, onSelect, selectedTaskId, onDelete, refetch }) {
  const handleDragStart = (e, taskId) => {
    e.dataTransfer.setData('taskId', taskId);
  };

  const handleDrop = (e, newStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('taskId');
    if (taskId) onStatusChange(taskId, newStatus);
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {KANBAN_COLUMNS.map((status) => {
        const config = STATUS_CONFIG[status];
        const columnTasks = tasks.filter(t => t.status === status);
        return (
          <div
            key={status}
            className={`rounded-lg border ${config.kanbanBg} min-h-[200px]`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, status)}
          >
            <div className="p-2.5 border-b flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${config.dot}`} />
                <span className="text-xs font-semibold">{config.label}</span>
              </div>
              <span className="text-[10px] bg-white/60 px-1.5 py-0.5 rounded-full font-medium">{columnTasks.length}</span>
            </div>
            <div className="p-1.5 space-y-1.5">
              {columnTasks.map(task => (
                <KanbanCard key={task.id} task={task} onSelect={onSelect} selectedTaskId={selectedTaskId}
                  onDragStart={handleDragStart} onToggleDone={onToggleDone} onDelete={onDelete} refetch={refetch} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({ task, onSelect, selectedTaskId, onDragStart, onToggleDone, onDelete, refetch }) {
  const cat = CATEGORY_CONFIG[task.category] || CATEGORY_CONFIG.GENERAL;
  const prio = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.NORMAL;
  const PrioIcon = prio.icon;
  const isDone = task.status === 'OP_DONE';
  const isOverdue = task.dueAt && !isDone && new Date(task.dueAt) < new Date(new Date().setHours(0, 0, 0, 0));
  const checklistTotal = task.checklistItems?.length || 0;
  const checklistDone = task.checklistItems?.filter(i => i.isCompleted).length || 0;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onClick={() => onSelect(task)}
      className={`bg-white border rounded-lg p-2.5 cursor-pointer transition-all hover:shadow-sm ${
        selectedTaskId === task.id ? 'ring-2 ring-primary border-primary' : ''
      } ${isOverdue ? 'border-amber-300' : ''} ${isDone ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-1.5">
        <PrioIcon size={12} className={`mt-0.5 flex-shrink-0 ${prio.color}`} />
        <span className={`text-xs font-medium leading-tight ${isDone ? 'line-through text-muted-foreground' : ''}`}>
          {task.title}
        </span>
      </div>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span className={`text-[9px] px-1 py-0.5 rounded ${cat.color}`}>{cat.icon}</span>
        {task.dueAt && (
          <span className={`text-[9px] flex items-center gap-0.5 ${isOverdue ? 'text-red-500 font-bold' : 'text-muted-foreground'}`}>
            <Clock size={8} />
            {new Date(task.dueAt).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' })}
          </span>
        )}
        {task.assignedTo && (
          <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
            <User size={8} /> {task.assignedTo.name?.split(' ')[0]}
          </span>
        )}
        {checklistTotal > 0 && (
          <span className={`text-[9px] flex items-center gap-0.5 ${checklistDone === checklistTotal ? 'text-green-600' : 'text-muted-foreground'}`}>
            <CheckCircle2 size={8} /> {checklistDone}/{checklistTotal}
          </span>
        )}
        {(task._count?.comments || 0) > 0 && (
          <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
            <MessageSquare size={8} /> {task._count.comments}
          </span>
        )}
      </div>
    </div>
  );
}

// ===========================================
// Targeta de tasca (vista llista)
// ===========================================

function TaskCard({ task, currentUser, isAdmin, teamUsers, onToggleDone, onStatusChange, onEdit, onSelect, selectedTaskId, onDelete, refetch }) {
  const isDone = task.status === 'OP_DONE';
  const isBlocked = task.status === 'OP_BLOCKED';
  const isOverdue = task.dueAt && !isDone && new Date(task.dueAt) < new Date(new Date().setHours(0, 0, 0, 0));
  const cat = CATEGORY_CONFIG[task.category] || CATEGORY_CONFIG.GENERAL;
  const prio = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.NORMAL;
  const PrioIcon = prio.icon;
  const checklistTotal = task.checklistItems?.length || 0;
  const checklistDone = task.checklistItems?.filter(i => i.isCompleted).length || 0;

  return (
    <div
      onClick={() => onSelect(task)}
      className={`bg-card border rounded-lg overflow-hidden transition-colors cursor-pointer ${
        selectedTaskId === task.id ? 'ring-2 ring-primary border-primary' : ''
      } ${isBlocked ? 'border-red-200 bg-red-50/30' : isOverdue ? 'border-amber-200' : isDone ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center gap-2.5 p-3 sm:p-3.5">
        {/* Checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleDone(task); }}
          className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            isDone ? 'bg-green-500 border-green-500 text-white' : isBlocked ? 'border-red-300' : 'border-gray-300 hover:border-primary'
          }`}
        >
          {isDone && <CheckCircle2 size={12} />}
        </button>

        {/* Prioritat */}
        <PrioIcon size={14} className={`flex-shrink-0 ${prio.color}`} />

        {/* Contingut */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-sm font-medium ${isDone ? 'line-through text-muted-foreground' : ''} ${isOverdue ? 'text-red-700' : ''}`}>
              {task.title}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${cat.color}`}>{cat.icon} {cat.label}</span>
            {task.priority !== 'NORMAL' && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${prio.badge}`}>{prio.label}</span>
            )}
            {task.dueAt && (
              <span className={`text-[10px] flex items-center gap-0.5 ${isOverdue ? 'text-red-500 font-semibold' : 'text-muted-foreground'}`}>
                <Clock size={9} />
                {new Date(task.dueAt).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' })}
                {task.dueTime && ` ${task.dueTime}`}
              </span>
            )}
            {task.assignedTo && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <User size={9} /> {task.assignedTo.name}
              </span>
            )}
            {task.project && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Package size={9} /> {task.project.name}
              </span>
            )}
            {checklistTotal > 0 && (
              <span className={`text-[10px] flex items-center gap-0.5 ${checklistDone === checklistTotal ? 'text-green-600' : 'text-muted-foreground'}`}>
                <CheckCircle2 size={9} /> {checklistDone}/{checklistTotal}
              </span>
            )}
            {(task._count?.comments || 0) > 0 && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <MessageSquare size={9} /> {task._count.comments}
              </span>
            )}
            {task.recurrence && task.recurrence !== 'NONE' && <Repeat size={9} className="text-muted-foreground" />}
            {task.reminder && task.reminder !== 'NONE' && <Bell size={9} className="text-muted-foreground" />}
          </div>
        </div>

        {/* Estat dropdown */}
        <select
          value={task.status}
          onChange={(e) => { e.stopPropagation(); onStatusChange(task.id, e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          className={`text-[10px] border rounded-md px-1 py-0.5 bg-background flex-shrink-0 ${isBlocked ? 'border-red-200' : ''}`}
        >
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ===========================================
// Panel de detall (lateral)
// ===========================================

function TaskDetailPanel({ task, currentUser, onClose, refetch }) {
  const [activeTab, setActiveTab] = useState('checklist');
  const [comments, setComments] = useState([]);
  const [activities, setActivities] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [newCheckItem, setNewCheckItem] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);
  const [loadingActivities, setLoadingActivities] = useState(false);

  useEffect(() => {
    if (activeTab === 'comments') loadComments();
    if (activeTab === 'activity') loadActivities();
  }, [activeTab, task.id]);

  const loadComments = async () => {
    setLoadingComments(true);
    try {
      const res = await api.get(`/operations/tasks/${task.id}/comments`);
      setComments(res.data);
    } catch { /* silent */ }
    setLoadingComments(false);
  };

  const loadActivities = async () => {
    setLoadingActivities(true);
    try {
      const res = await api.get(`/operations/tasks/${task.id}/activity`);
      setActivities(res.data);
    } catch { /* silent */ }
    setLoadingActivities(false);
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      await api.post(`/operations/tasks/${task.id}/comments`, { content: newComment.trim() });
      setNewComment('');
      loadComments();
    } catch { alert('Error afegint comentari'); }
  };

  const handleDeleteComment = async (commentId) => {
    try {
      await api.delete(`/operations/tasks/${task.id}/comments/${commentId}`);
      loadComments();
    } catch { alert('Error eliminant comentari'); }
  };

  const handleToggleCheckItem = async (item) => {
    try {
      await api.put(`/operations/tasks/${task.id}/checklist/${item.id}`, { isCompleted: !item.isCompleted });
      refetch();
    } catch { alert('Error actualitzant checklist'); }
  };

  const handleAddCheckItem = async () => {
    if (!newCheckItem.trim()) return;
    try {
      await api.post(`/operations/tasks/${task.id}/checklist`, { title: newCheckItem.trim() });
      setNewCheckItem('');
      refetch();
    } catch { alert('Error afegint item'); }
  };

  const handleDeleteCheckItem = async (itemId) => {
    try {
      await api.delete(`/operations/tasks/${task.id}/checklist/${itemId}`);
      refetch();
    } catch { alert('Error eliminant item'); }
  };

  const cat = CATEGORY_CONFIG[task.category] || CATEGORY_CONFIG.GENERAL;
  const prio = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.NORMAL;
  const checkItems = task.checklistItems || [];
  const checkDone = checkItems.filter(i => i.isCompleted).length;
  const checkPercent = checkItems.length > 0 ? Math.round((checkDone / checkItems.length) * 100) : 0;

  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="text-sm font-semibold truncate flex-1">{task.title}</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X size={16} /></button>
      </div>

      {/* Info bàsica */}
      <div className="p-3 space-y-2 border-b text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-1.5 py-0.5 rounded ${cat.color}`}>{cat.icon} {cat.label}</span>
          <span className={`px-1.5 py-0.5 rounded ${prio.badge}`}>{prio.label}</span>
          <span className={`px-1.5 py-0.5 rounded ${STATUS_CONFIG[task.status]?.color}`}>{STATUS_CONFIG[task.status]?.label}</span>
        </div>
        {task.description && <p className="text-muted-foreground whitespace-pre-wrap">{task.description}</p>}
        {task.notes && <p className="text-muted-foreground whitespace-pre-wrap">{task.notes}</p>}
        <div className="flex items-center gap-3 text-muted-foreground flex-wrap">
          {task.assignedTo && <span className="flex items-center gap-1"><User size={10} /> {task.assignedTo.name}</span>}
          {task.project && <span className="flex items-center gap-1"><Package size={10} /> {task.project.name}</span>}
          {task.dueAt && (
            <span className="flex items-center gap-1">
              <Clock size={10} /> {new Date(task.dueAt).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' })}
              {task.dueTime && ` ${task.dueTime}`}
            </span>
          )}
        </div>
      </div>

      {/* Tabs: Checklist / Comentaris / Activitat */}
      <div className="flex border-b">
        {[
          { id: 'checklist', label: 'Checklist', icon: CheckCircle2, count: checkItems.length },
          { id: 'comments', label: 'Comentaris', icon: MessageSquare, count: task._count?.comments || 0 },
          { id: 'activity', label: 'Historial', icon: History, count: task._count?.activities || 0 },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon size={12} />
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.count > 0 && <span className="text-[9px] bg-muted px-1 rounded-full">{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* Contingut tabs */}
      <div className="p-3 max-h-[400px] overflow-y-auto">
        {activeTab === 'checklist' && (
          <div className="space-y-2">
            {/* Barra de progrés */}
            {checkItems.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{checkDone}/{checkItems.length} completats</span>
                  <span>{checkPercent}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${checkPercent}%` }} />
                </div>
              </div>
            )}

            {/* Items */}
            {checkItems.map(item => (
              <div key={item.id} className="flex items-center gap-2 group">
                <button
                  onClick={() => handleToggleCheckItem(item)}
                  className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                    item.isCompleted ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-primary'
                  }`}
                >
                  {item.isCompleted && <Check size={10} />}
                </button>
                <span className={`text-sm flex-1 ${item.isCompleted ? 'line-through text-muted-foreground' : ''}`}>
                  {item.title}
                </span>
                <button
                  onClick={() => handleDeleteCheckItem(item.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 p-0.5"
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            {/* Afegir item */}
            <div className="flex items-center gap-2 pt-1">
              <input
                value={newCheckItem}
                onChange={(e) => setNewCheckItem(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCheckItem(); } }}
                placeholder="Afegir element..."
                className="flex-1 border rounded px-2 py-1 text-sm bg-background"
              />
              <button onClick={handleAddCheckItem} disabled={!newCheckItem.trim()} className="text-primary disabled:opacity-30">
                <Plus size={16} />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'comments' && (
          <div className="space-y-3">
            {loadingComments ? (
              <div className="flex justify-center py-4"><Loader2 className="animate-spin" size={20} /></div>
            ) : (
              <>
                {comments.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Cap comentari encara</p>}
                {comments.map(c => (
                  <div key={c.id} className="space-y-1 group">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{c.user?.name}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(c.createdAt).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {c.userId === currentUser?.id && (
                          <button onClick={() => handleDeleteComment(c.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500">
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-sm bg-muted/40 rounded-lg px-2.5 py-1.5 whitespace-pre-wrap">{c.content}</p>
                  </div>
                ))}
              </>
            )}
            {/* Escriure comentari */}
            <div className="flex items-center gap-2 pt-1 border-t">
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
                placeholder="Escriu un comentari..."
                className="flex-1 border rounded px-2 py-1.5 text-sm bg-background"
              />
              <button onClick={handleAddComment} disabled={!newComment.trim()} className="text-primary disabled:opacity-30">
                <Send size={16} />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="space-y-2">
            {loadingActivities ? (
              <div className="flex justify-center py-4"><Loader2 className="animate-spin" size={20} /></div>
            ) : (
              <>
                {activities.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Cap activitat registrada</p>}
                {activities.map(a => (
                  <div key={a.id} className="flex items-start gap-2 text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                    <div className="flex-1">
                      <span className="font-medium">{a.user?.name || 'Sistema'}</span>{' '}
                      <span className="text-muted-foreground">
                        {ACTIVITY_LABELS[a.action] || a.action}
                        {a.action === 'status_change' && a.details && (
                          <span> de <span className="font-medium">{STATUS_CONFIG[a.details.from]?.label}</span> a <span className="font-medium">{STATUS_CONFIG[a.details.to]?.label}</span></span>
                        )}
                        {a.action === 'priority_change' && a.details && (
                          <span> a <span className="font-medium">{PRIORITY_CONFIG[a.details.to]?.label}</span></span>
                        )}
                        {(a.action === 'checklist_done' || a.action === 'checklist_undone' || a.action === 'checklist_added') && a.details?.title && (
                          <span>: "{a.details.title}"</span>
                        )}
                        {a.action === 'created_from_template' && a.details?.templateName && (
                          <span> "{a.details.templateName}"</span>
                        )}
                      </span>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(a.createdAt).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
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
    priority: task?.priority || 'NORMAL',
    dueAt: task?.dueAt ? task.dueAt.substring(0, 10) : '',
    dueTime: task?.dueTime || '',
    reminder: task?.reminder || 'NONE',
    reminderCustom: task?.reminderCustom || '',
    recurrence: task?.recurrence || 'NONE',
    recurrenceCustom: task?.recurrenceCustom || '',
    notes: task?.notes || '',
    projectId: task?.projectId || '',
    checklistItems: [],
  });
  const [showMore, setShowMore] = useState(
    isEdit && (form.dueAt || form.notes || form.reminder !== 'NONE' || form.recurrence !== 'NONE')
  );
  const [saving, setSaving] = useState(false);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const { data: templates } = useApiGet('/operations/task-templates');

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleApplyTemplate = (template) => {
    if (template.items?.length) {
      const items = template.items.flatMap(item => {
        const base = [item.title];
        return base;
      });
      set('checklistItems', [...form.checklistItems, ...items]);
    }
    if (template.category !== 'GENERAL') set('category', template.category);
    setShowTemplates(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        assignedToId: form.assignedToId || undefined,
        category: form.category,
        priority: form.priority,
        dueAt: form.dueAt || undefined,
        dueTime: form.dueTime || undefined,
        reminder: form.reminder,
        reminderCustom: form.reminder === 'CUSTOM' ? form.reminderCustom : undefined,
        recurrence: form.recurrence,
        recurrenceCustom: form.recurrence === 'CUSTOM' ? form.recurrenceCustom : undefined,
        notes: form.notes || undefined,
        projectId: form.projectId || undefined,
        checklistItems: form.checklistItems.length > 0 ? form.checklistItems : undefined,
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

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !showMore) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="bg-card border-2 border-primary/20 rounded-lg p-3 sm:p-4 space-y-3">
      <form onSubmit={handleSubmit}>
        {/* Títol + enviar */}
        <div className="flex gap-2">
          <input
            autoFocus
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Què s'ha de fer?"
            className="flex-1 border rounded-lg px-3 py-2.5 text-sm bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          />
          <button type="submit" disabled={saving || !form.title.trim()}
            className="bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap">
            {saving ? '...' : isEdit ? 'Guardar' : 'Crear'}
          </button>
        </div>

        {/* Camps ràpids */}
        <div className="flex items-center gap-2 flex-wrap">
          <select value={form.category} onChange={(e) => set('category', e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs bg-background">
            {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>

          <select value={form.priority} onChange={(e) => set('priority', e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs bg-background">
            {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>

          <select value={form.assignedToId} onChange={(e) => set('assignedToId', e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs bg-background">
            <option value="">Sense assignar</option>
            {teamUsers?.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>

          <input type="date" value={form.dueAt} onChange={(e) => set('dueAt', e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs bg-background" />

          {/* Plantilles */}
          {!isEdit && (
            <button type="button" onClick={() => setShowTemplates(!showTemplates)}
              className="text-xs text-primary hover:text-primary/80 flex items-center gap-1">
              <FileText size={12} /> Plantilla
            </button>
          )}

          <button type="button" onClick={() => setShowMore(!showMore)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ml-auto">
            {showMore ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showMore ? 'Menys' : 'Més'}
          </button>
        </div>

        {/* Selector de plantilla */}
        {showTemplates && templates && (
          <div className="border rounded-lg p-2 bg-muted/20 space-y-1">
            <p className="text-xs font-medium text-muted-foreground mb-1">Aplicar plantilla:</p>
            {templates.map(t => (
              <button key={t.id} type="button" onClick={() => handleApplyTemplate(t)}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded flex items-center justify-between">
                <span>{t.name}</span>
                <span className="text-[10px] text-muted-foreground">{t._count?.items || t.items?.length || 0} tasques</span>
              </button>
            ))}
          </div>
        )}

        {/* Checklist previ (per noves tasques) */}
        {form.checklistItems.length > 0 && (
          <div className="border rounded-lg p-2 bg-muted/20 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Checklist:</p>
            {form.checklistItems.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Circle size={12} className="text-muted-foreground" />
                <span className="flex-1">{item}</span>
                <button type="button" onClick={() => set('checklistItems', form.checklistItems.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-red-500"><X size={12} /></button>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <input value={newCheckItem} onChange={(e) => setNewCheckItem(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newCheckItem.trim()) { set('checklistItems', [...form.checklistItems, newCheckItem.trim()]); setNewCheckItem(''); } } }}
                placeholder="Afegir element..." className="flex-1 border rounded px-2 py-1 text-xs bg-background" />
              <button type="button" onClick={() => { if (newCheckItem.trim()) { set('checklistItems', [...form.checklistItems, newCheckItem.trim()]); setNewCheckItem(''); } }}
                className="text-primary text-xs">+</button>
            </div>
          </div>
        )}

        {/* Camps expandits */}
        {showMore && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t">
            <div>
              <label className="text-xs text-muted-foreground">Hora</label>
              <input type="time" value={form.dueTime} onChange={(e) => set('dueTime', e.target.value)} className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-background mt-0.5" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Recordatori</label>
              <select value={form.reminder} onChange={(e) => set('reminder', e.target.value)} className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-background mt-0.5">
                {REMINDER_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>
            {form.reminder === 'CUSTOM' && (
              <div>
                <label className="text-xs text-muted-foreground">Recordatori personalitzat</label>
                <input value={form.reminderCustom} onChange={(e) => set('reminderCustom', e.target.value)} placeholder="Ex: 30 minuts abans" className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-background mt-0.5" />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Repetició</label>
              <select value={form.recurrence} onChange={(e) => set('recurrence', e.target.value)} className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-background mt-0.5">
                {RECURRENCE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>
            {form.recurrence === 'CUSTOM' && (
              <div>
                <label className="text-xs text-muted-foreground">Repetició personalitzada</label>
                <input value={form.recurrenceCustom} onChange={(e) => set('recurrenceCustom', e.target.value)} placeholder="Ex: cada 2 setmanes" className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-background mt-0.5" />
              </div>
            )}

            {/* Afegir checklist si no n'hi ha */}
            {form.checklistItems.length === 0 && (
              <div className="sm:col-span-2">
                <button type="button" onClick={() => set('checklistItems', [''])}
                  className="text-xs text-primary hover:text-primary/80 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Afegir checklist
                </button>
              </div>
            )}

            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">Notes</label>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Informació addicional..."
                rows={2} className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-background mt-0.5 resize-none" />
            </div>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Cancel·lar</button>
        </div>
      </form>
    </div>
  );
}
