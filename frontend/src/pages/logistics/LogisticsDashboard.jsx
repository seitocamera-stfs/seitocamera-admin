import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Truck, Plus, Search, X, Filter, ChevronDown, ChevronRight,
  Package, PackageCheck, PackageOpen, Clock, Phone, MapPin,
  Trash2, StickyNote, CalendarDays, Table, Building2, RefreshCw,
  User, Ban, MessageCircle, Link2,
} from 'lucide-react';
import api from '../../lib/api';
import { useApiGet } from '../../hooks/useApi';
import { enviarViaWhatsapp, enviarViaWhatsappEmpresa, copyDriverLink } from '../../services/whatsappService';

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
  const location = useLocation();
  const [transports, setTransports] = useState([]);
  const [conductors, setConductors] = useState([]);
  const [empreses, setEmpreses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showConfig, setShowConfig] = useState(null); // 'conductors' | 'empreses' | null
  const [highlightId, setHighlightId] = useState(null);
  const [preselectedProject, setPreselectedProject] = useState({ id: null, name: '' });

  // Si arribem amb ?newWithProject=...&projectName=..., obrim modal preseleccionat
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('newWithProject');
    const name = params.get('projectName') || '';
    if (id) {
      setPreselectedProject({ id, name });
      setShowModal(true);
    }
  }, [location.search]);

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

  // Scroll al transport destacat si ve del calendari
  useEffect(() => {
    if (location.state?.highlightTransportId && transports.length > 0) {
      setHighlightId(location.state.highlightTransportId);
      window.history.replaceState({}, '');
      // Scroll al element
      setTimeout(() => {
        const el = document.getElementById(`transport-${location.state.highlightTransportId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 200);
      // Treure highlight després de 3s
      setTimeout(() => setHighlightId(null), 3500);
    }
  }, [location.state, transports]);

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
                      <Th>Cap producció</Th>
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
                        isHighlighted={highlightId === t.id}
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
          defaultRentalProjectId={preselectedProject.id}
          defaultRentalProjectName={preselectedProject.name}
          onClose={() => { setShowModal(false); setPreselectedProject({ id: null, name: '' }); }}
          onCreate={(form) => { handleCreate(form); setPreselectedProject({ id: null, name: '' }); }}
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

function TransportRow({ t, conductors, empreses, onUpdate, onDelete, isHighlighted }) {
  const [expanded, setExpanded] = useState(false);
  const cancellat = t.estat === 'Cancel·lat';
  const minsExtres = t.minutsExtres;
  let extresCls = 'text-gray-400';
  if (minsExtres != null && minsExtres > 15) extresCls = 'text-rose-600 font-semibold';
  else if (minsExtres != null && minsExtres > 0) extresCls = 'text-amber-600 font-medium';
  else if (minsExtres != null && minsExtres <= 0) extresCls = 'text-emerald-600 font-medium';

  return (
    <>
      <tr
        id={`transport-${t.id}`}
        className={`border-b border-gray-100 hover:bg-gray-50/60 ${cancellat ? 'opacity-60 bg-rose-50/20' : ''} ${isHighlighted ? 'ring-2 ring-primary bg-primary/5 animate-pulse' : ''}`}
      >
        <td className="px-3 py-2.5">
          <button onClick={() => setExpanded(!expanded)} className="p-1 rounded hover:bg-gray-200 text-gray-400">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="px-3 py-2.5 min-w-[160px]">
          <ProjectSelectEdit
            value={t.rentalProject?.name || t.projecte}
            rentalProjectId={t.rentalProjectId}
            onSave={(payload) => onUpdate(t.id, payload)}
          />
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
          <InlineEdit value={t.responsableProduccio} onSave={v => onUpdate(t.id, { responsableProduccio: v })} placeholder="Cap producció" />
          {t.telefonResponsable && (
            <a href={`tel:${t.telefonResponsable}`} className="text-[10px] text-blue-500 hover:underline flex items-center gap-0.5 mt-0.5">
              <Phone size={10} /> {t.telefonResponsable}
            </a>
          )}
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
          <div className="flex items-center justify-end gap-0.5">
            <button
              onClick={() => enviarViaWhatsapp(t)}
              className="p-1.5 rounded hover:bg-emerald-50 text-gray-400 hover:text-emerald-600"
              title={t.conductor?.telefon ? `WhatsApp al conductor (${t.conductor.telefon})` : 'WhatsApp al conductor'}
            >
              <MessageCircle size={14} />
            </button>
            <button
              onClick={() => { copyDriverLink(t); }}
              className="p-1.5 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600"
              title="Copiar enllaç conductor"
            >
              <Link2 size={14} />
            </button>
            <button onClick={() => onDelete(t.id)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500" title="Eliminar">
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>

      {/* Expansió: notes + historial */}
      {expanded && (
        <tr className="bg-gray-50/50">
          <td colSpan={12} className="px-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              {/* Col 1: Notes i detalls */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2 flex items-center gap-1"><StickyNote size={12} /> Detalls</h4>

                {/* Data entrega + hora entrega estimada */}
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-32 shrink-0">Data entrega:</span>
                    <InlineEdit value={t.dataEntrega ? new Date(t.dataEntrega).toISOString().split('T')[0] : ''} onSave={v => onUpdate(t.id, { dataEntrega: v })} placeholder="AAAA-MM-DD" type="date" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-32 shrink-0">Hora entrega est.:</span>
                    <InlineEdit value={t.horaEntregaEstimada} onSave={v => onUpdate(t.id, { horaEntregaEstimada: v })} placeholder="HH:MM" type="time" className="text-gray-700" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone size={11} className="text-gray-400" />
                    <span className="text-gray-500 w-28 shrink-0">Tel. responsable:</span>
                    <InlineEdit value={t.telefonResponsable} onSave={v => onUpdate(t.id, { telefonResponsable: v })} placeholder="+34..." className="text-gray-700" />
                    {t.telefonResponsable && (
                      <a href={`tel:${t.telefonResponsable}`} className="text-[10px] text-blue-500 hover:underline">Trucar</a>
                    )}
                  </div>
                </div>

                {/* Enllaç conductor */}
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span className="text-gray-500 text-[11px] font-medium">Enllaç conductor:</span>
                  <button onClick={() => copyDriverLink(t)} className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline">
                    <Link2 size={11} /> Copiar enllaç
                  </button>
                  <button
                    onClick={() => enviarViaWhatsapp(t)}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                  >
                    <MessageCircle size={11} /> Al conductor
                  </button>
                  <button
                    onClick={() => {
                      const emp = empreses.find(e => e.id === t.empresaId);
                      enviarViaWhatsappEmpresa(t, emp);
                    }}
                    disabled={!t.empresaId}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium"
                  >
                    <Building2 size={11} /> A l'empresa
                  </button>
                </div>

                {/* Notes */}
                <InlineEdit value={t.notes} onSave={v => onUpdate(t.id, { notes: v })} placeholder="Afegir notes..." multiline />
                {t.notesOrigen && <p className="text-gray-500 mt-1">Origen: {t.notesOrigen}</p>}
                {t.notesDesti && <p className="text-gray-500 mt-1">Destí: {t.notesDesti}</p>}

                {/* Motiu cancel·lació */}
                {t.estat === 'Cancel·lat' && (
                  <div className="mt-3 p-2 bg-rose-50 rounded-lg border border-rose-100">
                    <div className="flex items-center gap-1 text-rose-600 font-medium mb-1"><Ban size={11} /> Motiu cancel·lació</div>
                    <InlineEdit value={t.motiuCancellacio} onSave={v => onUpdate(t.id, { motiuCancellacio: v })} placeholder="Afegir motiu..." multiline className="text-rose-700" />
                  </div>
                )}
              </div>

              {/* Col 2: Horaris reals */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2 flex items-center gap-1"><Clock size={12} /> Jornada</h4>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-20">Inici real:</span>
                    <InlineEdit value={t.horaIniciReal} onSave={v => onUpdate(t.id, { horaIniciReal: v })} placeholder="HH:MM" type="time" className="font-medium text-gray-700" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-20">Fi real:</span>
                    <InlineEdit value={t.horaFiReal} onSave={v => onUpdate(t.id, { horaFiReal: v })} placeholder="HH:MM" type="time" className="font-medium text-gray-700" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-20">H. extres:</span>
                    <span className={`font-medium ${minsExtres != null && minsExtres > 0 ? 'text-rose-600' : minsExtres != null ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {descHoresExtres(minsExtres)}
                    </span>
                  </div>
                </div>

                {/* Creador */}
                <div className="mt-4 pt-3 border-t border-gray-200">
                  <div className="flex items-center gap-1.5 text-gray-400">
                    <User size={11} />
                    <span>Creat per <span className="text-gray-600 font-medium">{t.createdBy?.name || '—'}</span></span>
                  </div>
                  <div className="text-[10px] text-gray-400 ml-4 mt-0.5">
                    {t.createdAt ? new Date(t.createdAt).toLocaleString('ca-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </div>
                </div>
              </div>

              {/* Col 3: Historial */}
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

// Selector de projecte (vincle a RentalProject) per fila/detall transport.
// Click → dropdown amb llista de projectes (departureDate >= ahir) + opció text lliure + desvincular.
function ProjectSelectEdit({ value, rentalProjectId, onSave }) {
  const [editing, setEditing] = useState(false);
  const [freeText, setFreeText] = useState(value || '');
  const { data: rentalProjects } = useApiGet(editing ? '/operations/projects' : null, { limit: 200 });
  const all = Array.isArray(rentalProjects) ? rentalProjects : (rentalProjects?.data || []);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(0, 0, 0, 0);
  const list = all
    .filter((p) => !p.departureDate || new Date(p.departureDate) >= yesterday)
    .sort((a, b) => new Date(a.departureDate || 0) - new Date(b.departureDate || 0));

  useEffect(() => { setFreeText(value || ''); }, [value]);

  const pick = (id, name) => {
    onSave({ rentalProjectId: id, projecte: name });
    setEditing(false);
  };
  const unlink = () => {
    onSave({ rentalProjectId: null });
    setEditing(false);
  };
  const saveFreeText = () => {
    if (freeText !== (value || '')) onSave({ rentalProjectId: null, projecte: freeText });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="relative">
        <input
          autoFocus value={freeText} onChange={(e) => setFreeText(e.target.value)}
          onBlur={() => setTimeout(() => setEditing(false), 200)}
          onKeyDown={(e) => { if (e.key === 'Enter') saveFreeText(); if (e.key === 'Escape') setEditing(false); }}
          placeholder="Cerca o escriu projecte..."
          className="w-full text-xs border rounded px-2 py-1"
        />
        <div className="absolute z-50 mt-1 w-72 max-h-64 overflow-y-auto bg-white border rounded shadow-lg text-xs">
          {rentalProjectId && (
            <button type="button" onMouseDown={(e) => { e.preventDefault(); unlink(); }}
              className="w-full text-left px-3 py-1.5 text-rose-600 hover:bg-rose-50 border-b">
              ✗ Desvincular projecte actual
            </button>
          )}
          {list
            .filter((p) => !freeText || p.name.toLowerCase().includes(freeText.toLowerCase()))
            .slice(0, 30)
            .map((p) => (
              <button
                key={p.id} type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(p.id, p.name); }}
                className={`w-full text-left px-3 py-1.5 hover:bg-blue-50 ${rentalProjectId === p.id ? 'bg-blue-50 font-medium' : ''}`}
              >
                {p.name}
                {p.departureDate && <span className="text-gray-400 ml-2">{new Date(p.departureDate).toLocaleDateString('ca-ES')}</span>}
              </button>
            ))}
          {freeText && !list.some((p) => p.name.toLowerCase() === freeText.toLowerCase()) && (
            <button type="button" onMouseDown={(e) => { e.preventDefault(); saveFreeText(); }}
              className="w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-50 border-t italic">
              Guardar com a text lliure: "{freeText}"
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 inline-flex items-center gap-1 text-xs font-medium ${value ? 'text-gray-900' : 'text-gray-300 italic'}`}
      title={rentalProjectId ? 'Vinculat a un projecte. Clic per canviar.' : 'Sense projecte vinculat. Clic per triar-ne un.'}
    >
      {rentalProjectId && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
      {value || 'Projecte'}
    </span>
  );
}

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

  // Format de visualització: per dates, mostrar DD/MM/YYYY en català
  let display = value || placeholder;
  if (value && type === 'date') {
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) display = `${m[3]}/${m[2]}/${m[1]}`;
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 inline-block text-xs ${value ? className : 'text-gray-300 italic'}`}
    >
      {display}
    </span>
  );
}

// ===========================================
// New Transport Modal
// ===========================================

function NewTransportModal({ conductors, empreses, onClose, onCreate, defaultRentalProjectId = null, defaultRentalProjectName = '' }) {
  const [form, setForm] = useState({
    projecte: defaultRentalProjectName, rentalProjectId: defaultRentalProjectId || '',
    tipusServei: 'Entrega', origen: '', desti: '',
    dataCarrega: '', dataEntrega: '', horaRecollida: '', horaFiPrevista: '',
    horaEntregaEstimada: '', responsableProduccio: '', telefonResponsable: '',
    conductorId: '', empresaId: '', notes: '',
  });
  const { data: rentalProjects } = useApiGet('/operations/projects', { limit: 200 });
  const allProjects = Array.isArray(rentalProjects) ? rentalProjects : (rentalProjects?.data || rentalProjects?.projects || []);
  // Mostrar només projectes amb sortida >= ahir (no té sentit vincular transports a projectes ja passats)
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(0, 0, 0, 0);
  const projectList = allProjects
    .filter((p) => !p.departureDate || new Date(p.departureDate) >= yesterday)
    .sort((a, b) => new Date(a.departureDate || 0) - new Date(b.departureDate || 0));

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
            <select
              value={form.rentalProjectId}
              onChange={(e) => {
                const id = e.target.value;
                const p = projectList.find((x) => x.id === id);
                setForm({ ...form, rentalProjectId: id, projecte: p?.name || form.projecte });
              }}
              className="input-field"
            >
              <option value="">— Sense projecte vinculat (text lliure a sota) —</option>
              {projectList.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.departureDate ? ` · ${new Date(p.departureDate).toLocaleDateString('ca-ES')}` : ''}</option>
              ))}
            </select>
          </Field>
          {!form.rentalProjectId && (
            <Field label="Nom de projecte (text lliure)">
              <input value={form.projecte} onChange={(e) => setForm({ ...form, projecte: e.target.value })} className="input-field" placeholder="Si no està a la llista" />
            </Field>
          )}
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
            <Field label="Data entrega">
              <input type="date" value={form.dataEntrega} onChange={e => setForm({ ...form, dataEntrega: e.target.value })} className="input-field" />
            </Field>
            <Field label="Hora entrega estimada">
              <input type="time" value={form.horaEntregaEstimada} onChange={e => setForm({ ...form, horaEntregaEstimada: e.target.value })} className="input-field" />
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cap de producció">
              <input value={form.responsableProduccio} onChange={e => setForm({ ...form, responsableProduccio: e.target.value })} className="input-field" placeholder="Nom responsable" />
            </Field>
            <Field label="Telèfon responsable">
              <input value={form.telefonResponsable} onChange={e => setForm({ ...form, telefonResponsable: e.target.value })} className="input-field" placeholder="+34..." type="tel" />
            </Field>
          </div>
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
  const [users, setUsers] = useState([]);
  const [nom, setNom] = useState('');
  const [telefon, setTelefon] = useState('');
  const [empresaId, setEmpresaId] = useState('');
  const [userId, setUserId] = useState('');

  useEffect(() => {
    api.get('/logistics/conductors').then(r => setConductors(r.data));
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
  }, []);

  const handleAdd = async () => {
    if (!nom.trim()) return;
    await api.post('/logistics/conductors', { nom, telefon, empresaId: empresaId || null, userId: userId || null });
    setNom(''); setTelefon(''); setEmpresaId(''); setUserId('');
    const r = await api.get('/logistics/conductors');
    setConductors(r.data);
    onRefresh();
  };

  const handleLinkUser = async (conductorId, newUserId) => {
    await api.put(`/logistics/conductors/${conductorId}`, { userId: newUserId || null });
    const r = await api.get('/logistics/conductors');
    setConductors(r.data);
  };

  const handleDelete = async (id) => {
    if (!confirm('Eliminar conductor?')) return;
    await api.delete(`/logistics/conductors/${id}`);
    setConductors(prev => prev.filter(c => c.id !== id));
    onRefresh();
  };

  // Usuaris que ja estan vinculats (per excloure'ls del selector)
  const linkedUserIds = new Set(conductors.filter(c => c.userId).map(c => c.userId));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Phone size={16} /> Conductors</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            <input value={nom} onChange={e => setNom(e.target.value)} placeholder="Nom" className="input-field flex-1 min-w-[100px]" />
            <input value={telefon} onChange={e => setTelefon(e.target.value)} placeholder="Telèfon" className="input-field w-28" />
            <select value={empresaId} onChange={e => setEmpresaId(e.target.value)} className="input-field w-28">
              <option value="">Empresa</option>
              {empreses.map(emp => <option key={emp.id} value={emp.id}>{emp.nom}</option>)}
            </select>
            <select value={userId} onChange={e => setUserId(e.target.value)} className="input-field w-32">
              <option value="">Usuari Seito</option>
              {users.filter(u => u.isActive).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button onClick={handleAdd} className="px-3 py-1.5 text-xs rounded-lg text-white" style={{ background: '#00617F' }}>
              <Plus size={14} />
            </button>
          </div>
          <p className="text-[10px] text-gray-400">Si vincules un conductor a un usuari Seito, els seus transports crearan absències automàtiques.</p>
          <div className="space-y-1">
            {conductors.map(c => (
              <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg border text-xs gap-2">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{c.nom}</span>
                  {c.telefon && <span className="text-gray-400 ml-2">{c.telefon}</span>}
                  {c.empresa && <span className="text-gray-400 ml-2">({c.empresa.nom})</span>}
                </div>
                <select
                  value={c.userId || ''}
                  onChange={e => handleLinkUser(c.id, e.target.value)}
                  className={`text-[11px] border rounded px-1.5 py-1 w-28 ${c.userId ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white'}`}
                >
                  <option value="">— No vinculat —</option>
                  {users.filter(u => u.isActive && (!linkedUserIds.has(u.id) || u.id === c.userId)).map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
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
