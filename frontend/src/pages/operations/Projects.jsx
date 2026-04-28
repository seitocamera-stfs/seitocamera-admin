import { useState, useCallback } from 'react';
import {
  Package, Plus, Search, Filter, Clock, User, Users, AlertTriangle,
  CheckCircle2, XCircle, ChevronDown, X, Loader2, ArrowRight,
  CalendarDays, Truck, Wrench, Eye, Edit2, MessageSquare, RefreshCw,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';
import Modal from '../../components/shared/Modal';

// ===========================================
// Constants
// ===========================================

const STATUS_CONFIG = {
  PENDING_PREP:        { label: 'Pendent preparar',    color: 'bg-gray-100 text-gray-700',    kanban: true },
  IN_PREPARATION:      { label: 'En preparació',       color: 'bg-blue-100 text-blue-700',    kanban: true },
  PENDING_TECH_REVIEW: { label: 'Revisió tècnica',     color: 'bg-amber-100 text-amber-700',  kanban: true },
  PENDING_FINAL_CHECK: { label: 'Validació final',     color: 'bg-orange-100 text-orange-700', kanban: true },
  READY:               { label: 'Preparat',            color: 'bg-green-100 text-green-700',  kanban: true },
  PENDING_LOAD:        { label: 'Pendent càrrega',     color: 'bg-teal-100 text-teal-700',    kanban: false },
  OUT:                 { label: 'Sortit',              color: 'bg-indigo-100 text-indigo-700', kanban: true },
  RETURNED:            { label: 'Retornat',            color: 'bg-purple-100 text-purple-700', kanban: false },
  RETURN_REVIEW:       { label: 'Revisió devolució',   color: 'bg-yellow-100 text-yellow-700', kanban: true },
  WITH_INCIDENT:       { label: 'Amb incidència',      color: 'bg-red-100 text-red-700',      kanban: false },
  EQUIPMENT_BLOCKED:   { label: 'Material bloquejat',  color: 'bg-red-200 text-red-800',      kanban: false },
  CLOSED:              { label: 'Tancat',              color: 'bg-gray-200 text-gray-600',    kanban: false },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG);
const KANBAN_STATUSES = ALL_STATUSES.filter(s => STATUS_CONFIG[s].kanban);

const PRIORITY_LABELS = { 0: 'Normal', 1: 'Alta', 2: 'Urgent' };

// ===========================================
// Component principal
// ===========================================

export default function Projects() {
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'kanban'
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const activeStatuses = statusFilter || ALL_STATUSES.filter(s => s !== 'CLOSED').join(',');

  const { data, loading, error, refetch } = useApiGet('/operations/projects', {
    status: activeStatuses,
    search: search || undefined,
    limit: 200,
  });

  const projects = data?.projects || [];

  const handleSyncRentman = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await api.post('/rentman/sync/projects');
      setSyncResult(res.data);
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error sincronitzant amb Rentman');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      {/* Capçalera */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Package size={28} className="text-primary" />
          <h1 className="text-2xl font-bold">Projectes</h1>
          {data?.total > 0 && (
            <span className="text-sm text-muted-foreground">({data.total})</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-md">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-sm ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
            >
              Llista
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`px-3 py-1.5 text-sm ${viewMode === 'kanban' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
            >
              Kanban
            </button>
          </div>
          <button
            onClick={handleSyncRentman}
            disabled={syncing}
            className="flex items-center gap-2 border border-primary text-primary px-4 py-2 rounded-md text-sm hover:bg-primary/10 disabled:opacity-50"
            title="Importar projectes actuals de Rentman"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sincronitzant...' : 'Sync Rentman'}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90"
          >
            <Plus size={16} /> Nou projecte
          </button>
        </div>
      </div>

      {/* Resultat sync */}
      {syncResult && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-2 text-sm">
          <CheckCircle2 size={16} />
          <span>
            Sync completat: {syncResult.created} nous, {syncResult.updated} actualitzats
            {syncResult.skipped > 0 && `, ${syncResult.skipped} saltats`}
            {syncResult.errors > 0 && `, ${syncResult.errors} errors`}
            <span className="text-green-600 ml-1">({syncResult.totalFiltered}/{syncResult.totalRentman} projectes Rentman filtrats)</span>
          </span>
          <button onClick={() => setSyncResult(null)} className="ml-auto text-green-600 hover:text-green-800">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filtres */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Cercar projectes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border rounded-md text-sm bg-background"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">Tots els estats (actius)</option>
          {ALL_STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      )}

      {error && <div className="bg-red-50 text-red-600 p-4 rounded-lg">{error}</div>}

      {/* Vista Llista */}
      {!loading && viewMode === 'list' && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left p-3 font-medium">Projecte</th>
                <th className="text-left p-3 font-medium">Check</th>
                <th className="text-left p-3 font-medium">Rodatge</th>
                <th className="text-left p-3 font-medium">Devolució</th>
                <th className="text-left p-3 font-medium">Responsable</th>
                <th className="text-left p-3 font-medium">Estat</th>
                <th className="text-center p-3 font-medium">Info</th>
                <th className="text-center p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    Cap projecte trobat
                  </td>
                </tr>
              ) : (
                projects.map(p => (
                  <tr key={p.id} className="hover:bg-accent/50 cursor-pointer" onClick={() => setSelectedProject(p.id)}>
                    <td className="p-3">
                      <div className="font-medium flex items-center gap-1.5">
                        {p.name}
                        {p.rentmanProjectId && (
                          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-normal" title="Importat de Rentman">RM</span>
                        )}
                      </div>
                      {p.clientName && <div className="text-xs text-muted-foreground">{p.clientName}</div>}
                      {p.client && <div className="text-xs text-muted-foreground">{p.client.name}</div>}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {p.checkDate ? (
                        <>
                          <div>{new Date(p.checkDate).toLocaleDateString('ca-ES')}</div>
                          {p.checkTime && <div className="text-xs text-muted-foreground">{p.checkTime}</div>}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <div>{new Date(p.departureDate).toLocaleDateString('ca-ES')}</div>
                      {p.shootEndDate && (
                        <div className="text-xs text-muted-foreground">
                          → {new Date(p.shootEndDate).toLocaleDateString('ca-ES')}
                        </div>
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <div>{new Date(p.returnDate).toLocaleDateString('ca-ES')}</div>
                      {p.returnTime && <div className="text-xs text-muted-foreground">{p.returnTime}</div>}
                    </td>
                    <td className="p-3">
                      {p.leadUser ? (
                        <span className="flex items-center gap-1 text-sm">
                          <User size={14} /> {p.leadUser.name}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Sense assignar</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${STATUS_CONFIG[p.status]?.color}`}>
                        {STATUS_CONFIG[p.status]?.label}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        {p._count?.incidents > 0 && (
                          <span className="flex items-center gap-0.5 text-amber-600" title="Incidències">
                            <AlertTriangle size={12} /> {p._count.incidents}
                          </span>
                        )}
                        {p._count?.tasks > 0 && (
                          <span className="flex items-center gap-0.5" title="Tasques">
                            <CheckCircle2 size={12} /> {p._count.tasks}
                          </span>
                        )}
                        {p.assignments?.length > 0 && (
                          <span className="flex items-center gap-0.5" title="Personal">
                            <Users size={12} /> {p.assignments.length}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-center">
                      <button className="text-primary hover:underline text-xs" onClick={(e) => { e.stopPropagation(); setSelectedProject(p.id); }}>
                        Veure
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Vista Kanban */}
      {!loading && viewMode === 'kanban' && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_STATUSES.map(status => {
            const statusProjects = projects.filter(p => p.status === status);
            return (
              <div key={status} className="flex-shrink-0 w-72 bg-muted/30 rounded-lg">
                <div className="p-3 border-b">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_CONFIG[status].color}`}>
                      {STATUS_CONFIG[status].label}
                    </span>
                    <span className="text-xs text-muted-foreground">{statusProjects.length}</span>
                  </div>
                </div>
                <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                  {statusProjects.map(p => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProject(p.id)}
                      className="bg-card border rounded-md p-3 cursor-pointer hover:shadow-md transition-shadow"
                    >
                      {p.priority > 0 && (
                        <div className={`text-xs font-bold mb-1 ${p.priority === 2 ? 'text-red-600' : 'text-orange-600'}`}>
                          {PRIORITY_LABELS[p.priority]}
                        </div>
                      )}
                      <div className="font-medium text-sm truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <Clock size={11} />
                        {new Date(p.departureDate).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' })}
                        {p.departureTime && ` ${p.departureTime}`}
                      </div>
                      {p.leadUser && (
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <User size={11} /> {p.leadUser.name}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        {p._count?.incidents > 0 && (
                          <span className="text-xs text-amber-600 flex items-center gap-0.5">
                            <AlertTriangle size={11} /> {p._count.incidents}
                          </span>
                        )}
                        {p._count?.communications > 0 && (
                          <span className="text-xs text-blue-600 flex items-center gap-0.5">
                            <MessageSquare size={11} /> {p._count.communications}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {statusProjects.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">Buit</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Crear projecte */}
      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refetch(); }}
        />
      )}

      {/* Modal: Detall projecte */}
      {selectedProject && (
        <ProjectDetailModal
          projectId={selectedProject}
          onClose={() => setSelectedProject(null)}
          onUpdate={refetch}
        />
      )}
    </div>
  );
}

// ===========================================
// Modal Crear Projecte
// ===========================================

function CreateProjectModal({ onClose, onCreated }) {
  const { data: teamUsers } = useApiGet('/operations/team');
  const [form, setForm] = useState({
    name: '', clientName: '',
    checkDate: '', checkTime: '',
    departureDate: '', departureTime: '',
    shootEndDate: '', shootEndTime: '',
    returnDate: '', returnTime: '',
    priority: 0, leadUserId: '',
    transportType: '', transportNotes: '', pickupTime: '',
    internalNotes: '',
    techValidationRequired: false,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.departureDate || !form.returnDate) return;
    setSaving(true);
    try {
      const body = { ...form, leadUserId: form.leadUserId || undefined };
      await api.post('/operations/projects', body);
      onCreated();
    } catch (err) {
      alert(err.response?.data?.error || 'Error creant projecte');
    } finally {
      setSaving(false);
    }
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  return (
    <Modal isOpen={true} title="Nou projecte" onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="text-sm font-medium">Nom del projecte *</label>
            <input
              value={form.name} onChange={e => set('name', e.target.value)}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" required
              placeholder="Ex: Rodatge Estrella Damm"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Client</label>
            <input
              value={form.clientName} onChange={e => set('clientName', e.target.value)}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
              placeholder="Nom del client"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Responsable</label>
            <select value={form.leadUserId} onChange={e => set('leadUserId', e.target.value)}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background">
              <option value="">Sense assignar</option>
              {teamUsers?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Prioritat</label>
            <select value={form.priority} onChange={e => set('priority', parseInt(e.target.value))}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background">
              <option value={0}>Normal</option>
              <option value={1}>Alta</option>
              <option value={2}>Urgent</option>
            </select>
          </div>
          {/* Dates del cicle: Check → Rodatge → Devolució */}
          <div className="col-span-2 border-t pt-3 mt-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Dates del cicle</p>
          </div>
          <div>
            <label className="text-sm font-medium">Dia de Check (preparació)</label>
            <input type="date" value={form.checkDate} onChange={e => set('checkDate', e.target.value)}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" />
          </div>
          <div>
            <label className="text-sm font-medium">Hora check</label>
            <input type="time" value={form.checkTime} onChange={e => set('checkTime', e.target.value)}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" />
          </div>
          <div>
            <label className="text-sm font-medium">Inici rodatge *</label>
            <input type="date" value={form.departureDate} onChange={e => set('departureDate', e.target.value)}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" required />
          </div>
          <div>
            <label className="text-sm font-medium">Hora sortida</label>
            <input type="time" value={form.departureTime} onChange={e => set('departureTime', e.target.value)}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" />
          </div>
          <div>
            <label className="text-sm font-medium">Fi rodatge</label>
            <input type="date" value={form.shootEndDate} onChange={e => set('shootEndDate', e.target.value)}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" />
          </div>
          <div>
            <label className="text-sm font-medium">Hora fi rodatge</label>
            <input type="time" value={form.shootEndTime} onChange={e => set('shootEndTime', e.target.value)}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" />
          </div>
          <div>
            <label className="text-sm font-medium">Dia devolució *</label>
            <input type="date" value={form.returnDate} onChange={e => set('returnDate', e.target.value)}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" required />
          </div>
          <div>
            <label className="text-sm font-medium">Hora devolució</label>
            <input type="time" value={form.returnTime} onChange={e => set('returnTime', e.target.value)}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" />
          </div>
          <div>
            <label className="text-sm font-medium">Transport</label>
            <select value={form.transportType} onChange={e => set('transportType', e.target.value)}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background">
              <option value="">— Seleccionar —</option>
              <option value="INTERN">Intern (nosaltres portem)</option>
              <option value="EXTERN">Extern (missatger/transportista)</option>
              <option value="CLIENT_PICKUP">Recollida pel client</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium flex items-center gap-2">
              <input type="checkbox" checked={form.techValidationRequired}
                onChange={e => set('techValidationRequired', e.target.checked)} />
              Requereix validació tècnica
            </label>
          </div>
          {form.transportType && (
            <>
              <div>
                <label className="text-sm font-medium">Hora recollida/lliurament</label>
                <input type="time" value={form.pickupTime} onChange={e => set('pickupTime', e.target.value)}
                  className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" />
              </div>
              <div>
                <label className="text-sm font-medium">Notes transport</label>
                <input value={form.transportNotes} onChange={e => set('transportNotes', e.target.value)}
                  className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                  placeholder="Adreça, contacte, indicacions..." />
              </div>
            </>
          )}
          <div className="col-span-2">
            <label className="text-sm font-medium">Notes internes</label>
            <textarea value={form.internalNotes} onChange={e => set('internalNotes', e.target.value)}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background min-h-[60px]"
              placeholder="Notes sobre el projecte..." />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm border rounded-md hover:bg-accent">
            Cancel·lar
          </button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Creant...' : 'Crear projecte'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ===========================================
// Modal Detall Projecte
// ===========================================

function ProjectDetailModal({ projectId, onClose, onUpdate }) {
  const { data: project, loading, refetch } = useApiGet(`/operations/projects/${projectId}`);
  const [activeTab, setActiveTab] = useState('general');
  const [changingStatus, setChangingStatus] = useState(false);

  const handleStatusChange = async (newStatus) => {
    setChangingStatus(true);
    try {
      await api.put(`/operations/projects/${projectId}/status`, { status: newStatus });
      refetch();
      onUpdate();
    } catch (err) {
      alert(err.response?.data?.error || 'Error canviant estat');
    } finally {
      setChangingStatus(false);
    }
  };

  const handleValidateWarehouse = async () => {
    try {
      await api.put(`/operations/projects/${projectId}/validate-warehouse`);
      refetch();
    } catch (err) {
      alert('Error validant');
    }
  };

  const handleValidateTech = async () => {
    try {
      await api.put(`/operations/projects/${projectId}/validate-tech`);
      refetch();
    } catch (err) {
      alert('Error validant');
    }
  };

  if (loading || !project) {
    return (
      <Modal isOpen={true} title="Projecte" onClose={onClose} size="xl">
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      </Modal>
    );
  }

  const tabs = [
    { id: 'general', label: 'General', icon: Package },
    { id: 'equipment', label: `Material (${project.equipmentItems?.length || 0})`, icon: Package },
    { id: 'tasks', label: `Tasques (${project.tasks?.length || 0})`, icon: CheckCircle2 },
    { id: 'incidents', label: `Incidències (${project.incidents?.length || 0})`, icon: AlertTriangle },
    { id: 'comms', label: `Comunicacions (${project.communications?.length || 0})`, icon: MessageSquare },
    { id: 'history', label: 'Historial', icon: Clock },
  ];

  return (
    <Modal isOpen={true} title={project.name} onClose={onClose} size="xl">
      <div className="space-y-4">
        {/* Capçalera estat */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`text-sm px-3 py-1 rounded-full font-medium ${STATUS_CONFIG[project.status]?.color}`}>
            {STATUS_CONFIG[project.status]?.label}
          </span>
          {project.priority > 0 && (
            <span className={`text-sm font-bold ${project.priority === 2 ? 'text-red-600' : 'text-orange-600'}`}>
              Prioritat {PRIORITY_LABELS[project.priority]}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <select
              value={project.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={changingStatus}
              className="text-sm border rounded-md px-2 py-1 bg-background"
            >
              {ALL_STATUSES.map(s => (
                <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="min-h-[300px]">
          {activeTab === 'general' && (
            <GeneralTab project={project} projectId={projectId} refetch={() => { refetch(); onUpdate(); }}
              onValidateWarehouse={handleValidateWarehouse} onValidateTech={handleValidateTech} />
          )}

          {activeTab === 'equipment' && (
            <EquipmentTab project={project} refetch={refetch} />
          )}

          {activeTab === 'tasks' && (
            <TasksTab project={project} refetch={refetch} />
          )}

          {activeTab === 'incidents' && (
            <div className="space-y-2">
              {project.incidents?.length === 0 && (
                <p className="text-sm text-muted-foreground py-4">Cap incidència registrada</p>
              )}
              {project.incidents?.map(inc => (
                <div key={inc.id} className="border rounded-md p-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      inc.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                      inc.severity === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                      inc.severity === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {inc.severity}
                    </span>
                    <span className="font-medium text-sm">{inc.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{inc.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{inc.description}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'comms' && (
            <CommunicationsTab project={project} projectId={projectId} refetch={refetch} />
          )}

          {activeTab === 'history' && (
            <div className="space-y-2">
              {project.statusHistory?.map(h => (
                <div key={h.id} className="flex items-center gap-3 text-sm border-l-2 border-primary/30 pl-4 py-1">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(h.createdAt).toLocaleString('ca-ES')}
                  </span>
                  {h.fromStatus && (
                    <>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CONFIG[h.fromStatus]?.color}`}>
                        {STATUS_CONFIG[h.fromStatus]?.label}
                      </span>
                      <ArrowRight size={14} className="text-muted-foreground" />
                    </>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CONFIG[h.toStatus]?.color}`}>
                    {STATUS_CONFIG[h.toStatus]?.label}
                  </span>
                  {h.reason && <span className="text-xs text-muted-foreground">— {h.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ===========================================
// Tabs auxiliars
// ===========================================

function EquipmentTab({ project, refetch }) {
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState('');

  const handleAdd = async () => {
    if (!newItem.trim()) return;
    try {
      await api.post(`/operations/projects/${project.id}/equipment`, { itemName: newItem });
      setNewItem('');
      setAdding(false);
      refetch();
    } catch (err) {
      alert('Error afegint equip');
    }
  };

  const handleToggle = async (item, field) => {
    try {
      await api.put(`/operations/project-equipment/${item.id}`, { [field]: !item[field] });
      refetch();
    } catch (err) {
      alert('Error actualitzant');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">Material del projecte</h4>
        <button onClick={() => setAdding(!adding)} className="text-sm text-primary hover:underline">
          + Afegir
        </button>
      </div>
      {adding && (
        <div className="flex gap-2">
          <input value={newItem} onChange={e => setNewItem(e.target.value)}
            placeholder="Nom de l'equip..." className="flex-1 border rounded-md px-3 py-1.5 text-sm bg-background" />
          <button onClick={handleAdd} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm">Afegir</button>
        </div>
      )}
      {project.equipmentItems?.length === 0 ? (
        <p className="text-sm text-muted-foreground">Cap equip assignat</p>
      ) : (
        <div className="space-y-1">
          {project.equipmentItems?.map(item => (
            <div key={item.id} className="flex items-center gap-3 p-2 border rounded-md text-sm">
              <input type="checkbox" checked={item.isCheckedOut}
                onChange={() => handleToggle(item, 'isCheckedOut')} title="Sortit" />
              <span className={`flex-1 ${item.isCheckedOut ? '' : 'text-muted-foreground'}`}>
                {item.itemName} {item.quantity > 1 && `(×${item.quantity})`}
              </span>
              {item.equipment?.serialNumber && (
                <span className="text-xs text-muted-foreground">SN: {item.equipment.serialNumber}</span>
              )}
              {item.isReturned && <CheckCircle2 size={14} className="text-green-600" />}
              {item.returnCondition && item.returnCondition !== 'OK' && (
                <span className="text-xs text-red-600">{item.returnCondition}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================
// Tab General — Editable
// ===========================================

const TRANSPORT_LABELS = {
  INTERN: 'Intern (nosaltres portem)',
  EXTERN: 'Extern (missatger/transportista)',
  CLIENT_PICKUP: 'Recollida pel client',
};

function GeneralTab({ project, projectId, refetch, onValidateWarehouse, onValidateTech }) {
  const { data: teamUsers } = useApiGet('/operations/team');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  const startEditing = () => {
    setForm({
      leadUserId: project.leadUserId || '',
      transportType: project.transportType || '',
      transportNotes: project.transportNotes || '',
      pickupTime: project.pickupTime || '',
      internalNotes: project.internalNotes || '',
      clientNotes: project.clientNotes || '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/operations/projects/${projectId}`, {
        leadUserId: form.leadUserId || null,
        transportType: form.transportType || null,
        transportNotes: form.transportNotes || null,
        pickupTime: form.pickupTime || null,
        internalNotes: form.internalNotes || null,
        clientNotes: form.clientNotes || null,
      });
      setEditing(false);
      refetch();
    } catch (err) {
      alert('Error guardant');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-muted-foreground font-medium">Responsable</label>
            <select value={form.leadUserId} onChange={e => setForm({ ...form, leadUserId: e.target.value })}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background">
              <option value="">Sense assignar</option>
              {teamUsers?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-muted-foreground font-medium">Transport</label>
            <select value={form.transportType} onChange={e => setForm({ ...form, transportType: e.target.value })}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background">
              <option value="">— Seleccionar —</option>
              <option value="INTERN">Intern</option>
              <option value="EXTERN">Extern</option>
              <option value="CLIENT_PICKUP">Recollida client</option>
            </select>
          </div>
          {form.transportType && (
            <>
              <div>
                <label className="text-muted-foreground font-medium">Hora recollida/lliurament</label>
                <input type="time" value={form.pickupTime} onChange={e => setForm({ ...form, pickupTime: e.target.value })}
                  className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" />
              </div>
              <div>
                <label className="text-muted-foreground font-medium">Notes transport</label>
                <input value={form.transportNotes} onChange={e => setForm({ ...form, transportNotes: e.target.value })}
                  className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                  placeholder="Adreça, contacte, indicacions..." />
              </div>
            </>
          )}
          <div className="col-span-2">
            <label className="text-muted-foreground font-medium">Notes internes</label>
            <textarea value={form.internalNotes} onChange={e => setForm({ ...form, internalNotes: e.target.value })}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background min-h-[60px]"
              placeholder="Notes sobre el projecte..." />
          </div>
          <div className="col-span-2">
            <label className="text-muted-foreground font-medium">Notes pel client</label>
            <textarea value={form.clientNotes} onChange={e => setForm({ ...form, clientNotes: e.target.value })}
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background min-h-[60px]"
              placeholder="Observacions que afecten al client..." />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm border rounded-md">Cancel·lar</button>
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50">
            {saving ? 'Guardant...' : 'Guardar'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex justify-end">
        <button onClick={startEditing} className="text-sm text-primary hover:underline flex items-center gap-1">
          <Edit2 size={14} /> Editar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="text-muted-foreground">Client:</span>
          <span className="ml-2 font-medium">{project.clientName || project.client?.name || '—'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Responsable:</span>
          <span className="ml-2 font-medium">{project.leadUser?.name || <span className="italic text-muted-foreground">Sense assignar</span>}</span>
        </div>
        <div className="col-span-2 border-t pt-3 mt-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Cicle del projecte</p>
          <div className="grid grid-cols-4 gap-3">
            {project.checkDate && (
              <div className="bg-blue-50 rounded-md p-2 text-center">
                <div className="text-[10px] text-blue-600 font-semibold uppercase">Check</div>
                <div className="font-medium">{new Date(project.checkDate).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' })}</div>
                {project.checkTime && <div className="text-xs text-muted-foreground">{project.checkTime}</div>}
              </div>
            )}
            <div className="bg-green-50 rounded-md p-2 text-center">
              <div className="text-[10px] text-green-600 font-semibold uppercase">Inici rodatge</div>
              <div className="font-medium">{new Date(project.departureDate).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' })}</div>
              {project.departureTime && <div className="text-xs text-muted-foreground">{project.departureTime}</div>}
            </div>
            {project.shootEndDate && (
              <div className="bg-amber-50 rounded-md p-2 text-center">
                <div className="text-[10px] text-amber-600 font-semibold uppercase">Fi rodatge</div>
                <div className="font-medium">{new Date(project.shootEndDate).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' })}</div>
                {project.shootEndTime && <div className="text-xs text-muted-foreground">{project.shootEndTime}</div>}
              </div>
            )}
            <div className="bg-purple-50 rounded-md p-2 text-center">
              <div className="text-[10px] text-purple-600 font-semibold uppercase">Devolució</div>
              <div className="font-medium">{new Date(project.returnDate).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' })}</div>
              {project.returnTime && <div className="text-xs text-muted-foreground">{project.returnTime}</div>}
            </div>
          </div>
        </div>
        <div className="col-span-2 border-t pt-3 mt-1">
          <h4 className="font-semibold mb-2 flex items-center gap-2"><Truck size={16} /> Transport</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-muted-foreground">Tipus:</span>
              <span className="ml-2">{TRANSPORT_LABELS[project.transportType] || '—'}</span>
            </div>
            {project.pickupTime && (
              <div>
                <span className="text-muted-foreground">Hora:</span>
                <span className="ml-2">{project.pickupTime}</span>
              </div>
            )}
            {project.transportNotes && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Notes:</span>
                <span className="ml-2">{project.transportNotes}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Validacions */}
      <div className="border-t pt-4 space-y-2">
        <h4 className="font-semibold">Validacions</h4>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {project.warehouseValidated ? (
              <CheckCircle2 size={18} className="text-green-600" />
            ) : (
              <XCircle size={18} className="text-gray-400" />
            )}
            <span>Magatzem</span>
            {!project.warehouseValidated && (
              <button onClick={onValidateWarehouse}
                className="text-xs text-primary hover:underline ml-2">Validar</button>
            )}
          </div>
          {project.techValidationRequired && (
            <div className="flex items-center gap-2">
              {project.techValidated ? (
                <CheckCircle2 size={18} className="text-green-600" />
              ) : (
                <XCircle size={18} className="text-gray-400" />
              )}
              <span>Tècnica</span>
              {!project.techValidated && (
                <button onClick={onValidateTech}
                  className="text-xs text-primary hover:underline ml-2">Validar</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Personal assignat */}
      {project.assignments?.length > 0 && (
        <div className="border-t pt-4 space-y-2">
          <h4 className="font-semibold">Personal assignat</h4>
          <div className="flex flex-wrap gap-2">
            {project.assignments.map(a => (
              <span key={a.id} className="text-sm bg-muted px-3 py-1 rounded-full flex items-center gap-1.5">
                <User size={12} />
                {a.user.name}
                {a.roleCode && <span className="text-xs text-muted-foreground">({a.roleCode.replace(/_/g, ' ')})</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {project.internalNotes && (
        <div className="border-t pt-4">
          <h4 className="font-semibold mb-1">Notes internes</h4>
          <p className="text-muted-foreground whitespace-pre-wrap">{project.internalNotes}</p>
        </div>
      )}
      {project.clientNotes && (
        <div className="border-t pt-4">
          <h4 className="font-semibold mb-1">Notes pel client</h4>
          <p className="text-muted-foreground whitespace-pre-wrap">{project.clientNotes}</p>
        </div>
      )}
    </div>
  );
}

// ===========================================
// Tab Tasques
// ===========================================

function TasksTab({ project, refetch }) {
  const [adding, setAdding] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', description: '', assignedToId: '', dueAt: '', requiresSupervision: false });
  const { data: teamUsers } = useApiGet('/operations/team');

  const handleAdd = async () => {
    if (!taskForm.title.trim()) return;
    try {
      await api.post(`/operations/projects/${project.id}/tasks`, {
        title: taskForm.title,
        description: taskForm.description || undefined,
        assignedToId: taskForm.assignedToId || undefined,
        dueAt: taskForm.dueAt || undefined,
        requiresSupervision: taskForm.requiresSupervision,
      });
      setTaskForm({ title: '', description: '', assignedToId: '', dueAt: '', requiresSupervision: false });
      setAdding(false);
      refetch();
    } catch (err) {
      alert('Error creant tasca');
    }
  };

  const handleToggle = async (task) => {
    const newStatus = task.status === 'OP_DONE' ? 'OP_PENDING' : 'OP_DONE';
    try {
      await api.put(`/operations/tasks/${task.id}`, { status: newStatus });
      refetch();
    } catch (err) {
      alert('Error actualitzant');
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

  const done = project.tasks?.filter(t => t.status === 'OP_DONE').length || 0;
  const total = project.tasks?.length || 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">
          Tasques {total > 0 && <span className="text-muted-foreground font-normal">({done}/{total})</span>}
        </h4>
        <button onClick={() => setAdding(!adding)} className="text-sm text-primary hover:underline">
          + Nova tasca
        </button>
      </div>
      {total > 0 && (
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}
      {adding && (
        <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
          <input value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })}
            placeholder="Títol de la tasca *" className="w-full border rounded-md px-3 py-1.5 text-sm bg-background" />
          <textarea value={taskForm.description} onChange={e => setTaskForm({ ...taskForm, description: e.target.value })}
            placeholder="Descripció (opcional)" className="w-full border rounded-md px-3 py-1.5 text-sm bg-background min-h-[50px]" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Assignar a</label>
              <select value={taskForm.assignedToId} onChange={e => setTaskForm({ ...taskForm, assignedToId: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm bg-background mt-0.5">
                <option value="">Sense assignar</option>
                {teamUsers?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Data límit</label>
              <input type="date" value={taskForm.dueAt} onChange={e => setTaskForm({ ...taskForm, dueAt: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm bg-background mt-0.5" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={taskForm.requiresSupervision}
              onChange={e => setTaskForm({ ...taskForm, requiresSupervision: e.target.checked })} />
            Requereix supervisió
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm border rounded-md">Cancel·lar</button>
            <button onClick={handleAdd} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm">Crear tasca</button>
          </div>
        </div>
      )}
      {project.tasks?.map(task => (
        <div key={task.id} className="flex items-start gap-3 p-2.5 border rounded-md text-sm">
          <input type="checkbox" checked={task.status === 'OP_DONE'}
            onChange={() => handleToggle(task)} className="mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={task.status === 'OP_DONE' ? 'line-through text-muted-foreground' : 'font-medium'}>
                {task.title}
              </span>
              {task.requiresSupervision && (
                <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">supervisió</span>
              )}
              {task.dueAt && (
                <span className="text-[10px] text-muted-foreground">
                  {new Date(task.dueAt).toLocaleDateString('ca-ES')}
                </span>
              )}
            </div>
            {task.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
            )}
            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
              {task.createdBy && <span>Creada per: {task.createdBy.name}</span>}
              {task.assignedTo ? (
                <span className="flex items-center gap-1">
                  <User size={10} /> {task.assignedTo.name}
                </span>
              ) : (
                <select onChange={e => handleReassign(task.id, e.target.value)}
                  className="text-[10px] border rounded px-1 py-0.5 bg-background"
                  defaultValue="">
                  <option value="">Assignar...</option>
                  {teamUsers?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
              {task.assignedTo && (
                <select onChange={e => handleReassign(task.id, e.target.value)}
                  className="text-[10px] border rounded px-1 py-0.5 bg-background"
                  defaultValue={task.assignedToId}>
                  <option value="">Sense assignar</option>
                  {teamUsers?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CommunicationsTab({ project, projectId, refetch }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      await api.post(`/operations/projects/${projectId}/communications`, { message });
      setMessage('');
      refetch();
    } catch (err) {
      alert('Error enviant');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {project.communications?.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">Cap comunicació encara</p>
        )}
        {project.communications?.map(c => (
          <div key={c.id} className={`p-3 rounded-md text-sm ${c.isUrgent ? 'bg-red-50 border-red-200 border' : 'bg-muted/50'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-muted-foreground">
                {new Date(c.createdAt).toLocaleString('ca-ES')}
              </span>
              {c.isUrgent && <span className="text-xs text-red-600 font-bold">URGENT</span>}
              {c.targetRoleCode && (
                <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                  @{c.targetRoleCode.replace('_', ' ')}
                </span>
              )}
            </div>
            <p className="whitespace-pre-wrap">{c.message}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-2 border-t">
        <input value={message} onChange={e => setMessage(e.target.value)}
          placeholder="Escriu un missatge..."
          className="flex-1 border rounded-md px-3 py-2 text-sm bg-background"
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()} />
        <button onClick={handleSend} disabled={sending || !message.trim()}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm disabled:opacity-50">
          Enviar
        </button>
      </div>
    </div>
  );
}
