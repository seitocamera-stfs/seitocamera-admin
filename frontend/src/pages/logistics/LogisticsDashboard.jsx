import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Truck, Plus, Search, X, Filter, ChevronDown, ChevronRight,
  Package, PackageCheck, PackageOpen, Clock, Phone, MapPin,
  Trash2, StickyNote, CalendarDays, Table, Building2, RefreshCw,
} from 'lucide-react';
import api from '../../lib/api';

// ===========================================
// Constants
// ===========================================

const ESTATS = ['Pendent', 'Confirmat', 'En Preparació', 'Lliurat', 'Cancel·lat'];
const TIPUS_SERVEI = ['Entrega', 'Recollida', 'Tot el dia'];

const ESTAT_STYLES = {
  'Pendent':       'bg-slate-100 text-slate-700',
  'Confirmat':     'bg-blue-100 text-blue-800',
  'En Preparació': 'bg-amber-100 text-amber-800',
  'Lliurat':       'bg-emerald-100 text-emerald-800',
  'Cancel·lat':    'bg-rose-100 text-rose-800',
};

const TIPUS_STYLES = {
  'Entrega':     'bg-sky-100 text-sky-800',
  'Recollida':   'bg-violet-100 text-violet-800',
  'Tot el dia':  'bg-indigo-100 text-indigo-800',
};

// ===========================================
// Utilitats temps
// ===========================================

function hmToMinutes(hm) {
  if (!hm) return null;
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

function descHoresExtres(minuts) {
  if (minuts == null) return '—';
  if (minuts === 0) return 'Puntual';
  const abs = Math.abs(minuts);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const str = h > 0 ? `${h}h ${m}min` : `${m}min`;
  return minuts > 0 ? `+${str}` : `-${str}`;
}

function formatDataCurta(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ===========================================
// Component principal
// ===========================================

export default function LogisticsDashboard() {
  const [transports, setTransports] = useState([]);
  const [conductors, setConductors] = useState([]);
  const [empreses, setEmpreses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showConfig, setShowConfig] = useState(null); // 'conductors' | 'empreses' | null

  // Filtres
  const [filterEstat, setFilterEstat] = useState('');
  const [filterTipus, setFilterTipus] = useState('');
  const [filterResponsable, setFilterResponsable] = useState('');
  const [cerca, setCerca] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, cRes, eRes] = await Promise.all([
        api.get('/logistics/transports'),
        api.get('/logistics/conductors'),
        api.get('/logistics/empreses'),
      ]);
      setTransports(tRes.data);
      setConductors(cRes.data);
      setEmpreses(eRes.data);
    } catch (err) {
      console.error('Error carregant logística:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const responsables = useMemo(() => {
    const set = new Set(transports.map(t => t.responsableProduccio).filter(Boolean));
    return Array.from(set).sort();
  }, [transports]);

  const filtered = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return transports.filter(t => {
      if (filterEstat && t.estat !== filterEstat) return false;
      if (filterTipus && t.tipusServei !== filterTipus) return false;
      if (filterResponsable && t.responsableProduccio !== filterResponsable) return false;
      if (q) {
        const blob = [t.projecte, t.origen, t.desti, t.conductor?.nom, t.empresa?.nom, t.responsableProduccio, t.id].join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [transports, filterEstat, filterTipus, filterResponsable, cerca]);

  // KPIs
  const kpis = useMemo(() => {
    let totalExtres = 0, ambExtres = 0;
    filtered.forEach(t => {
      if (t.estat === 'Cancel·lat') return;
      if (t.minutsExtres > 0) { totalExtres += t.minutsExtres; ambExtres++; }
    });
    return {
      total: filtered.length,
      pendents: filtered.filter(t => t.estat === 'Pendent').length,
      confirmats: filtered.filter(t => t.estat === 'Confirmat').length,
      enPreparacio: filtered.filter(t => t.estat === 'En Preparació').length,
      lliurats: filtered.filter(t => t.estat === 'Lliurat').length,
      cancellats: filtered.filter(t => t.estat === 'Cancel·lat').length,
      ambExtres,
      totalExtresH: (totalExtres / 60).toFixed(1),
    };
  }, [filtered]);

  // Handlers
  const handleCreate = async (data) => {
    try {
      await api.post('/logistics/transports', data);
      fetchAll();
      setShowModal(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdate = async (id, patch) => {
    try {
      const { data } = await api.put(`/logistics/transports/${id}`, patch);
      setTransports(prev => prev.map(t => t.id === id ? data : t));
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Eliminar aquest transport?')) return;
    try {
      await api.delete(`/logistics/transports/${id}`);
      setTransports(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const hasFilters = filterEstat || filterTipus || filterResponsable || cerca;

  return (
    <div className="min-h-screen" style={{ background: '#f8f9fa' }}>
      {/* Top bar */}
      <div className="bg-white border-b px-3 md:px-6 py-3 md:py-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-base md:text-lg font-medium text-gray-900 flex items-center gap-2">
            <Truck size={20} style={{ color: '#00617F' }} /> Logística
          </h1>
          <p className="text-[11px] md:text-xs text-gray-400 mt-0.5">{transports.length} transports</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowConfig('conductors')} className="flex items-center gap-1.5 px-3 py-2 text-xs border rounded-lg text-gray-600 hover:bg-gray-50">
            <Phone size={13} /> Conductors
          </button>
          <button onClick={() => setShowConfig('empreses')} className="flex items-center gap-1.5 px-3 py-2 text-xs border rounded-lg text-gray-600 hover:bg-gray-50">
            <Building2 size={13} /> Empreses
          </button>
          <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg text-white" style={{ background: '#00617F' }}>
            <Plus size={13} /> Nou transport
          </button>
        </div>
      </div>

      {/* Filtres */}
      <div className="bg-white border-b px-3 md:px-6 py-2 flex flex-wrap items-center gap-2">
        <Filter size={13} className="text-gray-400" />
        <select value={filterEstat} onChange={e => setFilterEstat(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 bg-white">
          <option value="">Tots els estats</option>
          {ESTATS.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={filterTipus} onChange={e => setFilterTipus(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 bg-white">
          <option value="">Tots els tipus</option>
          {TIPUS_SERVEI.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterResponsable} onChange={e => setFilterResponsable(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 bg-white">
          <option value="">Tots els responsables</option>
          {responsables.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <div className="relative flex-1 min-w-[150px] max-w-[300px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" value={cerca} onChange={e => setCerca(e.target.value)}
            placeholder="Cercar..." className="w-full text-xs border rounded-lg pl-8 pr-3 py-1.5"
          />
        </div>
        {hasFilters && (
          <button onClick={() => { setFilterEstat(''); setFilterTipus(''); setFilterResponsable(''); setCerca(''); }} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
            <X size={12} /> Netejar
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <RefreshCw className="animate-spin text-gray-300" size={32} />
        </div>
      ) : (
        <div className="px-3 md:px-6 py-4 md:py-5 max-w-[1600px] mx-auto space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 md:gap-3">
            <Kpi label="Total" value={kpis.total} />
            <Kpi label="Pendents" value={kpis.pendents} tone="slate" />
            <Kpi label="Confirmats" value={kpis.confirmats} tone="blue" />
            <Kpi label="En preparació" value={kpis.enPreparacio} tone="amber" />
            <Kpi label="Lliurats" value={kpis.lliurats} tone="emerald" />
            <Kpi label="Cancel·lats" value={kpis.cancellats} tone="rose" />
            <Kpi label="Hores extres" value={`${kpis.totalExtresH}h`} sub={`${kpis.ambExtres} transp.`} tone="orange" />
          </div>

          {/* Taula */}
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Truck size={36} className="mx-auto text-gray-200 mb-3" />
              <p className="font-medium">Cap transport per mostrar</p>
              <p className="text-sm">Crea'n un de nou o neteja els filtres.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <Th w={40}></Th>
                      <Th>Projecte</Th>
                      <Th>Tipus</Th>
                      <Th>Origen</Th>
                      <Th>Destí</Th>
                      <Th>Data/Hora</Th>
                      <Th>Responsable</Th>
                      <Th>Conductor</Th>
                      <Th>Empresa</Th>
                      <Th>Estat</Th>
                      <Th>H. extres</Th>
                      <Th w={60}></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(t => (
                      <TransportRow
                        key={t.id}
                        t={t}
                        conductors={conductors}
                        empreses={empreses}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <NewTransportModal
          conductors={conductors}
          empreses={empreses}
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}

      {showConfig === 'conductors' && (
        <ConductorsPanel empreses={empreses} onClose={() => setShowConfig(null)} onRefresh={fetchAll} />
      )}
      {showConfig === 'empreses' && (
        <EmpresesPanel onClose={() => setShowConfig(null)} onRefresh={fetchAll} />
      )}
    </div>
  );
}

// ===========================================
// Transport Row
// ===========================================

function TransportRow({ t, conductors, empreses, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const cancellat = t.estat === 'Cancel·lat';
  const minsExtres = t.minutsExtres;
  let extresCls = 'text-gray-400';
  if (minsExtres != null && minsExtres > 15) extresCls = 'text-rose-600 font-semibold';
  else if (minsExtres != null && minsExtres > 0) extresCls = 'text-amber-600 font-medium';
  else if (minsExtres != null && minsExtres <= 0) extresCls = 'text-emerald-600 font-medium';

  return (
    <>
      <tr className={`border-b border-gray-100 hover:bg-gray-50/60 ${cancellat ? 'opacity-60 bg-rose-50/20' : ''}`}>
        <td className="px-3 py-2.5">
          <button onClick={() => setExpanded(!expanded)} className="p-1 rounded hover:bg-gray-200 text-gray-400">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="px-3 py-2.5 min-w-[160px]">
          <InlineEdit value={t.projecte} onSave={v => onUpdate(t.id, { projecte: v })} placeholder="Projecte" className="font-medium text-gray-900" />
        </td>
        <td className="px-3 py-2.5">
          <select value={t.tipusServei} onChange={e => onUpdate(t.id, { tipusServei: e.target.value })} className={`text-[11px] font-medium px-2 py-0.5 rounded-full cursor-pointer border-0 ${TIPUS_STYLES[t.tipusServei] || 'bg-gray-100'}`}>
            {TIPUS_SERVEI.map(tp => <option key={tp} value={tp}>{tp}</option>)}
          </select>
        </td>
        <td className="px-3 py-2.5 min-w-[150px]">
          <InlineEdit value={t.origen} onSave={v => onUpdate(t.id, { origen: v })} placeholder="Origen" />
        </td>
        <td className="px-3 py-2.5 min-w-[150px]">
          <InlineEdit value={t.desti} onSave={v => onUpdate(t.id, { desti: v })} placeholder="Destí" />
          {t.desti && (
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.desti)}`} target="_blank" rel="noopener" className="text-[10px] text-blue-500 hover:underline flex items-center gap-0.5 mt-0.5">
              <MapPin size={10} /> Mapa
            </a>
          )}
        </td>
        <td className="px-3 py-2.5 min-w-[120px]">
          <div className="flex flex-col gap-0.5 text-[11px]">
            <span className="text-gray-500">{formatDataCurta(t.dataCarrega)}</span>
            <InlineEdit value={t.horaRecollida} onSave={v => onUpdate(t.id, { horaRecollida: v })} placeholder="HH:MM" type="time" className="text-gray-700" />
            <InlineEdit value={t.horaFiPrevista} onSave={v => onUpdate(t.id, { horaFiPrevista: v })} placeholder="Fi prev." type="time" className="text-gray-400" />
          </div>
        </td>
        <td className="px-3 py-2.5 min-w-[130px]">
          <InlineEdit value={t.responsableProduccio} onSave={v => onUpdate(t.id, { responsableProduccio: v })} placeholder="Responsable" />
        </td>
        <td className="px-3 py-2.5 min-w-[130px]">
          <select
            value={t.conductorId || ''}
            onChange={e => onUpdate(t.id, { conductorId: e.target.value || null })}
            className="text-xs border rounded px-2 py-1 w-full bg-white"
          >
            <option value="">— Sense conductor —</option>
            {conductors.map(c => <option key={c.id} value={c.id}>{c.nom}{c.empresa ? ` (${c.empresa.nom})` : ''}</option>)}
          </select>
        </td>
        <td className="px-3 py-2.5 min-w-[120px]">
          <select
            value={t.empresaId || ''}
            onChange={e => onUpdate(t.id, { empresaId: e.target.value || null })}
            className="text-xs border rounded px-2 py-1 w-full bg-white"
          >
            <option value="">— Sense empresa —</option>
            {empreses.map(emp => <option key={emp.id} value={emp.id}>{emp.nom}</option>)}
          </select>
        </td>
        <td className="px-3 py-2.5">
          <select
            value={t.estat}
            onChange={e => onUpdate(t.id, { estat: e.target.value })}
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full cursor-pointer border-0 ${ESTAT_STYLES[t.estat] || 'bg-gray-100'}`}
          >
            {ESTATS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </td>
        <td className={`px-3 py-2.5 text-xs ${extresCls}`}>
          {descHoresExtres(minsExtres)}
        </td>
        <td className="px-3 py-2.5 text-right">
          <button onClick={() => onDelete(t.id)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500" title="Eliminar">
            <Trash2 size={14} />
          </button>
        </td>
      </tr>

      {/* Expansió: notes + historial */}
      {expanded && (
        <tr className="bg-gray-50/50">
          <td colSpan={12} className="px-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <h4 className="font-medium text-gray-700 mb-2 flex items-center gap-1"><StickyNote size={12} /> Notes</h4>
                <InlineEdit value={t.notes} onSave={v => onUpdate(t.id, { notes: v })} placeholder="Afegir notes..." multiline />
                {t.notesOrigen && <p className="text-gray-500 mt-1">Origen: {t.notesOrigen}</p>}
                {t.notesDesti && <p className="text-gray-500 mt-1">Destí: {t.notesDesti}</p>}
                {t.horaIniciReal && <p className="text-gray-600 mt-2">Inici real: <span className="font-medium">{t.horaIniciReal}</span></p>}
                {t.horaFiReal && <p className="text-gray-600">Fi real: <span className="font-medium">{t.horaFiReal}</span></p>}
              </div>
              <div>
                <h4 className="font-medium text-gray-700 mb-2 flex items-center gap-1"><Clock size={12} /> Historial</h4>
                {(t.historial || []).length === 0 ? (
                  <p className="text-gray-400 italic">Sense historial</p>
                ) : (
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {[...(t.historial || [])].reverse().map((h, i) => (
                      <div key={i} className="flex gap-2 text-[11px]">
                        <span className="text-gray-400 flex-shrink-0">{new Date(h.timestamp).toLocaleString('ca-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="text-gray-600">{h.detall || h.accio}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ===========================================
// Inline Edit
// ===========================================

function InlineEdit({ value, onSave, placeholder, type = 'text', className = '', multiline = false }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || '');

  useEffect(() => { setVal(value || ''); }, [value]);

  const save = () => {
    if (val !== (value || '')) onSave(val);
    setEditing(false);
  };

  if (editing) {
    if (multiline) {
      return (
        <textarea
          value={val} onChange={e => setVal(e.target.value)}
          onBlur={save} onKeyDown={e => e.key === 'Escape' && setEditing(false)}
          autoFocus rows={3}
          className="w-full text-xs border rounded px-2 py-1 resize-none"
        />
      );
    }
    return (
      <input
        type={type} value={val} onChange={e => setVal(e.target.value)}
        onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
        className={`w-full text-xs border rounded px-2 py-1 ${className}`}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 inline-block text-xs ${value ? className : 'text-gray-300 italic'}`}
    >
      {value || placeholder}
    </span>
  );
}

// ===========================================
// New Transport Modal
// ===========================================

function NewTransportModal({ conductors, empreses, onClose, onCreate }) {
  const [form, setForm] = useState({
    projecte: '', tipusServei: 'Entrega', origen: '', desti: '',
    dataCarrega: '', horaRecollida: '', horaFiPrevista: '',
    responsableProduccio: '', conductorId: '', empresaId: '', notes: '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onCreate(form);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">Nou transport</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <Field label="Projecte">
            <input value={form.projecte} onChange={e => setForm({ ...form, projecte: e.target.value })} className="input-field" placeholder="Nom del projecte" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipus servei">
              <select value={form.tipusServei} onChange={e => setForm({ ...form, tipusServei: e.target.value })} className="input-field">
                {TIPUS_SERVEI.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Data càrrega">
              <input type="date" value={form.dataCarrega} onChange={e => setForm({ ...form, dataCarrega: e.target.value })} className="input-field" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Origen">
              <input value={form.origen} onChange={e => setForm({ ...form, origen: e.target.value })} className="input-field" placeholder="Lloc càrrega" />
            </Field>
            <Field label="Destí">
              <input value={form.desti} onChange={e => setForm({ ...form, desti: e.target.value })} className="input-field" placeholder="Lloc entrega" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hora recollida">
              <input type="time" value={form.horaRecollida} onChange={e => setForm({ ...form, horaRecollida: e.target.value })} className="input-field" />
            </Field>
            <Field label="Hora fi prevista">
              <input type="time" value={form.horaFiPrevista} onChange={e => setForm({ ...form, horaFiPrevista: e.target.value })} className="input-field" />
            </Field>
          </div>
          <Field label="Responsable producció">
            <input value={form.responsableProduccio} onChange={e => setForm({ ...form, responsableProduccio: e.target.value })} className="input-field" placeholder="Nom responsable" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Conductor">
              <select value={form.conductorId} onChange={e => setForm({ ...form, conductorId: e.target.value })} className="input-field">
                <option value="">— Seleccionar —</option>
                {conductors.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </Field>
            <Field label="Empresa logística">
              <select value={form.empresaId} onChange={e => setForm({ ...form, empresaId: e.target.value })} className="input-field">
                <option value="">— Seleccionar —</option>
                {empreses.map(emp => <option key={emp.id} value={emp.id}>{emp.nom}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input-field resize-none" rows={2} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs border rounded-lg hover:bg-gray-50">Cancel·lar</button>
            <button type="submit" className="px-4 py-2 text-xs rounded-lg text-white" style={{ background: '#00617F' }}>Crear transport</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===========================================
// Conductors Panel
// ===========================================

function ConductorsPanel({ empreses, onClose, onRefresh }) {
  const [conductors, setConductors] = useState([]);
  const [nom, setNom] = useState('');
  const [telefon, setTelefon] = useState('');
  const [empresaId, setEmpresaId] = useState('');

  useEffect(() => {
    api.get('/logistics/conductors').then(r => setConductors(r.data));
  }, []);

  const handleAdd = async () => {
    if (!nom.trim()) return;
    await api.post('/logistics/conductors', { nom, telefon, empresaId: empresaId || null });
    setNom(''); setTelefon(''); setEmpresaId('');
    const r = await api.get('/logistics/conductors');
    setConductors(r.data);
    onRefresh();
  };

  const handleDelete = async (id) => {
    if (!confirm('Eliminar conductor?')) return;
    await api.delete(`/logistics/conductors/${id}`);
    setConductors(prev => prev.filter(c => c.id !== id));
    onRefresh();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Phone size={16} /> Conductors</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex gap-2">
            <input value={nom} onChange={e => setNom(e.target.value)} placeholder="Nom" className="input-field flex-1" />
            <input value={telefon} onChange={e => setTelefon(e.target.value)} placeholder="Telèfon" className="input-field w-28" />
            <select value={empresaId} onChange={e => setEmpresaId(e.target.value)} className="input-field w-32">
              <option value="">Empresa</option>
              {empreses.map(emp => <option key={emp.id} value={emp.id}>{emp.nom}</option>)}
            </select>
            <button onClick={handleAdd} className="px-3 py-1.5 text-xs rounded-lg text-white" style={{ background: '#00617F' }}>
              <Plus size={14} />
            </button>
          </div>
          <div className="space-y-1">
            {conductors.map(c => (
              <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg border text-xs">
                <div>
                  <span className="font-medium">{c.nom}</span>
                  {c.telefon && <span className="text-gray-400 ml-2">{c.telefon}</span>}
                  {c.empresa && <span className="text-gray-400 ml-2">({c.empresa.nom})</span>}
                </div>
                <button onClick={() => handleDelete(c.id)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================
// Empreses Panel
// ===========================================

function EmpresesPanel({ onClose, onRefresh }) {
  const [empreses, setEmpreses] = useState([]);
  const [nom, setNom] = useState('');
  const [telefon, setTelefon] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    api.get('/logistics/empreses').then(r => setEmpreses(r.data));
  }, []);

  const handleAdd = async () => {
    if (!nom.trim()) return;
    await api.post('/logistics/empreses', { nom, telefonContacte: telefon, emailContacte: email });
    setNom(''); setTelefon(''); setEmail('');
    const r = await api.get('/logistics/empreses');
    setEmpreses(r.data);
    onRefresh();
  };

  const handleDelete = async (id) => {
    if (!confirm('Eliminar empresa?')) return;
    await api.delete(`/logistics/empreses/${id}`);
    setEmpreses(prev => prev.filter(e => e.id !== id));
    onRefresh();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Building2 size={16} /> Empreses logístiques</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex gap-2">
            <input value={nom} onChange={e => setNom(e.target.value)} placeholder="Nom empresa" className="input-field flex-1" />
            <input value={telefon} onChange={e => setTelefon(e.target.value)} placeholder="Telèfon" className="input-field w-28" />
            <button onClick={handleAdd} className="px-3 py-1.5 text-xs rounded-lg text-white" style={{ background: '#00617F' }}>
              <Plus size={14} />
            </button>
          </div>
          <div className="space-y-1">
            {empreses.map(e => (
              <div key={e.id} className="flex items-center justify-between px-3 py-2 rounded-lg border text-xs">
                <div>
                  <span className="font-medium">{e.nom}</span>
                  {e.telefonContacte && <span className="text-gray-400 ml-2">{e.telefonContacte}</span>}
                  <span className="text-gray-300 ml-2">{e._count?.conductors || 0} cond. · {e._count?.transports || 0} transp.</span>
                </div>
                <button onClick={() => handleDelete(e.id)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================
// Helpers UI
// ===========================================

function Kpi({ label, value, sub, tone = 'neutral' }) {
  const tones = {
    neutral: '', slate: 'bg-slate-50/40 border-slate-200',
    blue: 'bg-blue-50/40 border-blue-200', emerald: 'bg-emerald-50/40 border-emerald-200',
    amber: 'bg-amber-50/40 border-amber-200', rose: 'bg-rose-50/40 border-rose-200',
    orange: 'bg-orange-50/40 border-orange-200',
  };
  return (
    <div className={`bg-white rounded-xl border px-3 py-2.5 ${tones[tone]}`}>
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">{label}</div>
      <div className="text-xl font-semibold text-gray-900 mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Th({ children, w }) {
  return (
    <th style={w ? { width: w } : undefined} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 text-left">
      {children}
    </th>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
