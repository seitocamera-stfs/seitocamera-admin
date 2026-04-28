import { useState } from 'react';
import {
  ListTodo, User, Clock, CheckCircle2, Circle, Filter,
  Loader2, Package, ChevronDown,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';
import useAuthStore from '../../stores/authStore';

// ===========================================
// Constants
// ===========================================

const TASK_STATUS_CONFIG = {
  OP_PENDING:     { label: 'Pendent',     color: 'bg-amber-100 text-amber-700', icon: Circle },
  OP_IN_PROGRESS: { label: 'En curs',     color: 'bg-blue-100 text-blue-700',   icon: Clock },
  OP_DONE:        { label: 'Completada',  color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  OP_CANCELLED:   { label: 'Cancel·lada', color: 'bg-gray-100 text-gray-500',   icon: Circle },
};

// ===========================================
// Component principal
// ===========================================

export default function Tasks() {
  const currentUser = useAuthStore((s) => s.user);
  const [statusFilter, setStatusFilter] = useState('OP_PENDING,OP_IN_PROGRESS');
  const [userFilter, setUserFilter] = useState('');

  const { data: teamUsers } = useApiGet('/operations/team');
  const { data, loading, error, refetch } = useApiGet('/operations/tasks', {
    status: statusFilter || undefined,
    assignedToId: userFilter || undefined,
    limit: 200,
  });

  const tasks = data?.tasks || [];
  const isAdmin = data?.isAdmin || false;

  // Agrupar tasques per usuari assignat
  const tasksByUser = {};
  tasks.forEach((t) => {
    const key = t.assignedTo?.id || '_unassigned';
    const name = t.assignedTo?.name || 'Sense assignar';
    if (!tasksByUser[key]) tasksByUser[key] = { name, tasks: [] };
    tasksByUser[key].tasks.push(t);
  });

  // Ordenar: primer l'usuari actual, després la resta
  const sortedGroups = Object.entries(tasksByUser).sort(([keyA], [keyB]) => {
    if (keyA === currentUser?.id) return -1;
    if (keyB === currentUser?.id) return 1;
    if (keyA === '_unassigned') return 1;
    if (keyB === '_unassigned') return -1;
    return 0;
  });

  const handleToggleStatus = async (task) => {
    const newStatus = task.status === 'OP_DONE' ? 'OP_PENDING' : 'OP_DONE';
    try {
      await api.put(`/operations/tasks/${task.id}`, { status: newStatus });
      refetch();
    } catch (err) {
      alert('Error actualitzant tasca');
    }
  };

  const handleReassign = async (taskId, assignedToId) => {
    try {
      await api.put(`/operations/tasks/${taskId}`, { assignedToId: assignedToId || null });
      refetch();
    } catch (err) {
      alert('Error reassignant');
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      {/* Capçalera */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <ListTodo size={28} className="text-primary" />
          <h1 className="text-2xl font-bold">Tasques</h1>
          {data?.total > 0 && (
            <span className="text-sm text-muted-foreground">({data.total})</span>
          )}
        </div>
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="OP_PENDING,OP_IN_PROGRESS">Pendents i en curs</option>
          <option value="OP_PENDING">Només pendents</option>
          <option value="OP_IN_PROGRESS">Només en curs</option>
          <option value="OP_DONE">Completades</option>
          <option value="">Totes</option>
        </select>

        {isAdmin && (
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="">Tots els usuaris</option>
            {teamUsers?.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      )}

      {error && <div className="bg-red-50 text-red-600 p-4 rounded-lg">{error}</div>}

      {!loading && tasks.length === 0 && (
        <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">
          Cap tasca trobada amb aquests filtres
        </div>
      )}

      {/* Tasques agrupades per usuari */}
      {!loading && sortedGroups.map(([userId, group]) => (
        <div key={userId} className="bg-card border rounded-lg overflow-hidden">
          <div className="p-3 border-b bg-muted/30 flex items-center gap-2">
            <User size={16} className="text-muted-foreground" />
            <span className="font-semibold text-sm">
              {userId === currentUser?.id ? `${group.name} (jo)` : group.name}
            </span>
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {group.tasks.length}
            </span>
          </div>
          <div className="divide-y">
            {group.tasks.map((task) => {
              const isOverdue = task.dueAt && task.status !== 'OP_DONE' && new Date(task.dueAt) < new Date();
              const StatusIcon = TASK_STATUS_CONFIG[task.status]?.icon || Circle;

              return (
                <div key={task.id} className="p-3 hover:bg-accent/50 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={task.status === 'OP_DONE'}
                    onChange={() => handleToggleStatus(task)}
                    className="mt-1 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium ${task.status === 'OP_DONE' ? 'line-through text-muted-foreground' : ''} ${isOverdue ? 'text-red-700' : ''}`}>
                        {task.title}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${TASK_STATUS_CONFIG[task.status]?.color}`}>
                        {TASK_STATUS_CONFIG[task.status]?.label}
                      </span>
                      {task.requiresSupervision && (
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">supervisió</span>
                      )}
                    </div>
                    {task.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                      {task.project && (
                        <span className="flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded">
                          <Package size={10} /> {task.project.name}
                        </span>
                      )}
                      {task.dueAt && (
                        <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
                          <Clock size={10} />
                          {new Date(task.dueAt).toLocaleDateString('ca-ES')}
                        </span>
                      )}
                      {task.createdBy && (
                        <span>creada per {task.createdBy.name}</span>
                      )}
                      {isAdmin && (
                        <select
                          onChange={(e) => handleReassign(task.id, e.target.value)}
                          className="text-[10px] border rounded px-1 py-0.5 bg-background ml-auto"
                          defaultValue={task.assignedTo?.id || ''}
                        >
                          <option value="">Sense assignar</option>
                          {teamUsers?.map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
