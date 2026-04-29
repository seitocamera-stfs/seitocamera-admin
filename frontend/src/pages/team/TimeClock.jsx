import { useState, useEffect, useCallback } from 'react';
import {
  Clock, Play, Square, Building2, Film, Truck, Loader2,
  CheckCircle2, AlertTriangle
} from 'lucide-react';
import api from '../../lib/api';

const ENTRY_TYPES = [
  { value: 'OFICINA', label: 'Oficina', icon: Building2, color: 'bg-blue-500' },
  { value: 'RODATGE', label: 'Rodatge', icon: Film, color: 'bg-amber-500' },
  { value: 'TRANSPORT_ENTREGA', label: 'Transport entrega', icon: Truck, color: 'bg-green-500' },
  { value: 'TRANSPORT_RECOLLIDA', label: 'Transport recollida', icon: Truck, color: 'bg-purple-500' },
  { value: 'TRANSPORT_COMPLET', label: 'Transport complet', icon: Truck, color: 'bg-indigo-500' },
];

const SHOOTING_ROLES = [
  { value: 'VIDEOASSIST', label: 'Videoassist' },
  { value: 'AUX_CAMERA', label: 'Auxiliar de càmera' },
];

function formatTime(dateStr) {
  if (!dateStr) return '--:--';
  return new Date(dateStr).toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes) {
  if (!minutes) return '0h 0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export default function TimeClock() {
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    type: 'OFICINA',
    shootingRole: '',
    projectName: '',
    notes: '',
  });
  const [message, setMessage] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  const fetchToday = useCallback(async () => {
    try {
      const { data } = await api.get('/team/time-entries/today');
      setToday(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchToday(); }, [fetchToday]);

  // Rellotge en temps real
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleClockIn = async () => {
    setActionLoading(true);
    setMessage(null);
    try {
      await api.post('/team/time-entries/clock-in', {
        type: formData.type,
        shootingRole: formData.type === 'RODATGE' ? formData.shootingRole : null,
        projectName: formData.projectName || null,
        notes: formData.notes || null,
      });
      setShowForm(false);
      setFormData({ type: 'OFICINA', shootingRole: '', projectName: '', notes: '' });
      setMessage({ type: 'success', text: 'Entrada registrada!' });
      await fetchToday();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Error al fitxar' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleClockOut = async () => {
    setActionLoading(true);
    setMessage(null);
    try {
      await api.post('/team/time-entries/clock-out');
      setMessage({ type: 'success', text: 'Sortida registrada!' });
      await fetchToday();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Error al fitxar' });
    } finally {
      setActionLoading(false);
    }
  };

  const isOpen = !!today?.openEntry;

  // Calcular temps en curs
  let elapsedMinutes = 0;
  if (isOpen) {
    elapsedMinutes = Math.round((currentTime - new Date(today.openEntry.clockIn)) / 60000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto">
      {/* Capçalera */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Clock size={24} className="text-primary" />
          <h2 className="text-xl font-bold">Control Horari</h2>
        </div>
        <p className="text-3xl font-mono font-bold text-foreground">
          {currentTime.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
        <p className="text-sm text-muted-foreground">
          {currentTime.toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Missatge */}
      {message && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
        }`}>
          {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Botó principal */}
      {isOpen ? (
        // SORTIDA
        <div className="text-center mb-6">
          <div className="mb-3 p-3 bg-green-50 rounded-lg">
            <p className="text-sm text-green-700 font-medium">Entrada a les {formatTime(today.openEntry.clockIn)}</p>
            <p className="text-2xl font-bold text-green-800 font-mono">{formatDuration(elapsedMinutes)}</p>
            <p className="text-xs text-green-600 mt-1">
              {ENTRY_TYPES.find(t => t.value === today.openEntry.type)?.label || today.openEntry.type}
              {today.openEntry.projectName && ` — ${today.openEntry.projectName}`}
            </p>
          </div>
          <button
            onClick={handleClockOut}
            disabled={actionLoading}
            className="w-full py-4 rounded-xl text-lg font-bold bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-3"
          >
            {actionLoading ? <Loader2 size={24} className="animate-spin" /> : <Square size={24} />}
            Fitxar Sortida
          </button>
        </div>
      ) : showForm ? (
        // FORMULARI D'ENTRADA
        <div className="mb-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Tipus d'activitat</label>
            <div className="grid grid-cols-2 gap-2">
              {ENTRY_TYPES.map(et => {
                const Icon = et.icon;
                const selected = formData.type === et.value;
                return (
                  <button
                    key={et.value}
                    onClick={() => setFormData({ ...formData, type: et.value })}
                    className={`p-3 rounded-lg border-2 text-left flex items-center gap-2 transition-colors text-sm ${
                      selected
                        ? 'border-primary bg-primary/5 font-medium'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <Icon size={18} className={selected ? 'text-primary' : 'text-muted-foreground'} />
                    {et.label}
                  </button>
                );
              })}
            </div>
          </div>

          {formData.type === 'RODATGE' && (
            <div>
              <label className="block text-sm font-medium mb-2">Perfil de rodatge</label>
              <div className="flex gap-2">
                {SHOOTING_ROLES.map(sr => (
                  <button
                    key={sr.value}
                    onClick={() => setFormData({ ...formData, shootingRole: sr.value })}
                    className={`flex-1 p-2.5 rounded-lg border-2 text-sm transition-colors ${
                      formData.shootingRole === sr.value
                        ? 'border-amber-500 bg-amber-50 font-medium'
                        : 'border-border hover:border-amber-300'
                    }`}
                  >
                    {sr.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Projecte / Rodatge (opcional)</label>
            <input
              type="text"
              value={formData.projectName}
              onChange={(e) => setFormData({ ...formData, projectName: e.target.value })}
              className="w-full px-3 py-2.5 border rounded-lg text-sm bg-background"
              placeholder="Nom del projecte..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes (opcional)</label>
            <input
              type="text"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2.5 border rounded-lg text-sm bg-background"
              placeholder="Notes addicionals..."
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="flex-1 py-3 rounded-xl text-sm font-medium bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              Cancel·lar
            </button>
            <button
              onClick={handleClockIn}
              disabled={actionLoading}
              className="flex-1 py-3 rounded-xl text-sm font-bold bg-green-500 hover:bg-green-600 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {actionLoading ? <Loader2 size={20} className="animate-spin" /> : <Play size={20} />}
              Fitxar Entrada
            </button>
          </div>
        </div>
      ) : (
        // BOTÓ D'ENTRADA
        <div className="text-center mb-6">
          <button
            onClick={() => setShowForm(true)}
            disabled={actionLoading}
            className="w-full py-5 rounded-xl text-lg font-bold bg-green-500 hover:bg-green-600 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-3"
          >
            <Play size={28} />
            Fitxar Entrada
          </button>
        </div>
      )}

      {/* Registres d'avui */}
      {today?.entries?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">Avui</h3>
          <div className="space-y-2">
            {today.entries.filter(e => e.clockOut).map(entry => {
              const et = ENTRY_TYPES.find(t => t.value === entry.type);
              const Icon = et?.icon || Clock;
              return (
                <div key={entry.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                  <div className={`p-1.5 rounded ${et?.color || 'bg-gray-500'} text-white`}>
                    <Icon size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {formatTime(entry.clockIn)} — {formatTime(entry.clockOut)}
                      <span className="text-muted-foreground font-normal ml-2">
                        {formatDuration(entry.totalMinutes)}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {et?.label}{entry.projectName ? ` — ${entry.projectName}` : ''}
                    </p>
                  </div>
                  {entry.overtimeMinutes > 0 && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
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

          {today.totalMinutesToday > 0 && (
            <div className="mt-3 text-right text-sm text-muted-foreground">
              Total avui: <span className="font-semibold text-foreground">{formatDuration(today.totalMinutesToday)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
