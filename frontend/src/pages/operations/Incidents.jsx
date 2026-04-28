import { useState } from 'react';
import {
  AlertTriangle, Plus, Search, Loader2, Clock,
  User, Package, Wrench, CheckCircle2, XCircle, Shield,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';
import Modal from '../../components/shared/Modal';

const STATUS_LABELS = {
  INC_OPEN: 'Oberta', INC_IN_PROGRESS: 'En curs', INC_WAITING_PARTS: 'Esperant peces',
  INC_WAITING_CLIENT: 'Esperant client', INC_RESOLVED: 'Resolta', INC_CLOSED: 'Tancada',
};
const STATUS_COLORS = {
  INC_OPEN: 'bg-red-100 text-red-700', INC_IN_PROGRESS: 'bg-blue-100 text-blue-700',
  INC_WAITING_PARTS: 'bg-amber-100 text-amber-700', INC_WAITING_CLIENT: 'bg-purple-100 text-purple-700',
  INC_RESOLVED: 'bg-green-100 text-green-700', INC_CLOSED: 'bg-gray-200 text-gray-600',
};
const SEVERITY_LABELS = { LOW: 'Baixa', MEDIUM: 'Mitjana', HIGH: 'Alta', CRITICAL: 'Crítica' };
const SEVERITY_COLORS = {
  LOW: 'bg-gray-100 text-gray-600', MEDIUM: 'bg-yellow-100 text-yellow-700',
  HIGH: 'bg-orange-100 text-orange-700', CRITICAL: 'bg-red-200 text-red-800',
};

export default function Incidents() {
  const [statusFilter, setStatusFilter] = useState('INC_OPEN,INC_IN_PROGRESS,INC_WAITING_PARTS');
  const [severityFilter, setSeverityFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const { data, loading, error, refetch } = useApiGet('/operations/incidents', {
    status: statusFilter || undefined,
    severity: severityFilter || undefined,
    limit: 100,
  });

  const incidents = data?.incidents || [];

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle size={28} className="text-amber-600" />
          <h1 className="text-2xl font-bold">Incidències</h1>
          {data?.total > 0 && <span className="text-sm text-muted-foreground">({data.total})</span>}
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90">
          <Plus size={16} /> Nova incidència
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-background">
          <option value="">Tots els estats</option>
          <option value="INC_OPEN,INC_IN_PROGRESS,INC_WAITING_PARTS">Obertes / En curs</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-background">
          <option value="">Totes les severitats</option>
          {Object.entries(SEVERITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {loading && <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary" size={32} /></div>}
      {error && <div className="bg-red-50 text-red-600 p-4 rounded-lg">{error}</div>}

      {!loading && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left p-3 font-medium">Severitat</th>
                <th className="text-left p-3 font-medium">Títol</th>
                <th className="text-left p-3 font-medium">Projecte</th>
                <th className="text-left p-3 font-medium">Equip</th>
                <th className="text-left p-3 font-medium">Estat</th>
                <th className="text-left p-3 font-medium">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {incidents.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Cap incidència trobada</td></tr>
              ) : incidents.map(inc => (
                <tr key={inc.id} className="hover:bg-accent/50 cursor-pointer" onClick={() => setSelectedId(inc.id)}>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${SEVERITY_COLORS[inc.severity]}`}>
                      {SEVERITY_LABELS[inc.severity]}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{inc.title}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-xs">{inc.description}</div>
                  </td>
                  <td className="p-3 text-sm">{inc.project?.name || '—'}</td>
                  <td className="p-3 text-sm">{inc.equipment?.name || '—'}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[inc.status]}`}>
                      {STATUS_LABELS[inc.status]}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(inc.createdAt).toLocaleDateString('ca-ES')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateIncidentModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); refetch(); }} />
      )}

      {selectedId && (
        <IncidentDetailModal incidentId={selectedId} onClose={() => setSelectedId(null)} onUpdate={refetch} />
      )}
    </div>
  );
}

function CreateIncidentModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '', description: '', severity: 'MEDIUM',
    equipmentBlocked: false, requiresClientNotification: false,
    affectsFutureDeparture: false,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.description) return;
    setSaving(true);
    try {
      await api.post('/operations/incidents', form);
      onCreated();
    } catch (err) {
      alert(err.response?.data?.error || 'Error creant incidència');
    } finally { setSaving(false); }
  };

  return (
    <Modal isOpen={true} title="Nova incidència" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium">Títol *</label>
          <input value={form.title} onChange={e => set('title', e.target.value)}
            className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" required
            placeholder="Resum breu del problema" />
        </div>
        <div>
          <label className="text-sm font-medium">Descripció *</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)}
            className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background min-h-[80px]" required
            placeholder="Descripció detallada..." />
        </div>
        <div>
          <label className="text-sm font-medium">Severitat</label>
          <select value={form.severity} onChange={e => set('severity', e.target.value)}
            className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background">
            {Object.entries(SEVERITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <input type="checkbox" checked={form.equipmentBlocked} onChange={e => set('equipmentBlocked', e.target.checked)} />
            Material queda bloquejat
          </label>
          <label className="text-sm font-medium flex items-center gap-2">
            <input type="checkbox" checked={form.requiresClientNotification} onChange={e => set('requiresClientNotification', e.target.checked)} />
            Cal avisar el client
          </label>
          <label className="text-sm font-medium flex items-center gap-2">
            <input type="checkbox" checked={form.affectsFutureDeparture} onChange={e => set('affectsFutureDeparture', e.target.checked)} />
            Afecta una sortida futura
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-accent">Cancel·lar</button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Creant...' : 'Crear incidència'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function IncidentDetailModal({ incidentId, onClose, onUpdate }) {
  const { data: incident, loading, refetch } = useApiGet(`/operations/incidents/${incidentId}`);
  const [newStatus, setNewStatus] = useState('');

  const handleStatusChange = async (status) => {
    try {
      await api.put(`/operations/incidents/${incidentId}`, { status });
      refetch();
      onUpdate();
    } catch (err) {
      alert('Error actualitzant');
    }
  };

  if (loading || !incident) {
    return <Modal isOpen={true} title="Incidència" onClose={onClose}><div className="flex justify-center py-12"><Loader2 className="animate-spin" size={32} /></div></Modal>;
  }

  return (
    <Modal isOpen={true} title={incident.title} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`text-sm px-3 py-1 rounded-full ${SEVERITY_COLORS[incident.severity]}`}>
            {SEVERITY_LABELS[incident.severity]}
          </span>
          <span className={`text-sm px-3 py-1 rounded-full ${STATUS_COLORS[incident.status]}`}>
            {STATUS_LABELS[incident.status]}
          </span>
          <select value={incident.status} onChange={e => handleStatusChange(e.target.value)}
            className="ml-auto text-sm border rounded-md px-2 py-1 bg-background">
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        <div className="text-sm whitespace-pre-wrap border rounded-md p-4 bg-muted/30">
          {incident.description}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted-foreground">Projecte:</span> <span className="ml-1 font-medium">{incident.project?.name || '—'}</span></div>
          <div><span className="text-muted-foreground">Equip:</span> <span className="ml-1 font-medium">{incident.equipment?.name || '—'}</span></div>
          <div><span className="text-muted-foreground">Data:</span> <span className="ml-1">{new Date(incident.createdAt).toLocaleString('ca-ES')}</span></div>
          <div className="flex items-center gap-2">
            {incident.equipmentBlocked && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Bloquejat</span>}
            {incident.requiresClientNotification && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">Avisar client</span>}
            {incident.affectsFutureDeparture && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">Afecta sortida</span>}
          </div>
        </div>

        {incident.actionTaken && (
          <div className="border-t pt-3">
            <h4 className="text-sm font-semibold mb-1">Acció realitzada</h4>
            <p className="text-sm text-muted-foreground">{incident.actionTaken}</p>
          </div>
        )}
        {incident.resolutionNotes && (
          <div className="border-t pt-3">
            <h4 className="text-sm font-semibold mb-1">Notes de resolució</h4>
            <p className="text-sm text-muted-foreground">{incident.resolutionNotes}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
