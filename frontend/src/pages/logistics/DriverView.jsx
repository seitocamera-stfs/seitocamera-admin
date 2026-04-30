import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  MapPin, Phone, Clock, Navigation, CheckCircle2, AlertTriangle,
  Truck, Calendar, StickyNote, Play, Flag, Timer, XCircle, Loader2,
} from 'lucide-react';
import api from '../../lib/api';

// ===========================================
// Utils
// ===========================================

function formatData(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch { return iso; }
}

function horaActual() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function descHoresExtres(minuts) {
  if (minuts == null) return null;
  if (minuts === 0) return 'Puntual';
  const abs = Math.abs(minuts);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const str = h > 0 ? `${h}h ${m}min` : `${m}min`;
  return minuts > 0 ? `+${str}` : `-${str}`;
}

function calcularDurada(inici, fi) {
  if (!inici || !fi) return null;
  const toMin = (hm) => { const m = hm.match(/^(\d{1,2}):(\d{2})$/); return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null; };
  const i = toMin(inici), f = toMin(fi);
  if (i == null || f == null) return null;
  let diff = f - i;
  if (diff < 0) diff += 24 * 60;
  return diff;
}

function formatDurada(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

// ===========================================
// Component
// ===========================================

export default function DriverView() {
  const { token } = useParams();
  const [transport, setTransport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchTransport() {
      try {
        const { data } = await api.get(`/logistics/public/${token}`);
        setTransport(data);
      } catch (err) {
        setError(err.response?.status === 404 ? 'not_found' : 'error');
      }
      setLoading(false);
    }
    fetchTransport();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  if (error || !transport) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg border p-8 max-w-sm w-full text-center">
          <Truck size={36} className="mx-auto text-slate-300 mb-3" />
          <h2 className="text-base font-semibold text-slate-900">Ruta no trobada</h2>
          <p className="text-sm text-slate-500 mt-1">Comprova l'enllaç que t'han enviat.</p>
        </div>
      </div>
    );
  }

  const t = transport;
  const mapsQuery = t.desti || t.origen;
  const mapsUrl = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}` : null;
  const telResp = t.telefonResponsable?.replace(/\s+/g, '');
  const iniciat = !!t.horaIniciReal;
  const finalitzat = t.estat === 'Lliurat' || !!t.horaFiReal;
  const cancellat = t.estat === 'Cancel·lat';
  const duradaMin = calcularDurada(t.horaIniciReal, t.horaFiReal);

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Top bar */}
      <header className="bg-white border-b px-5 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#00617F' }}>
            <Truck size={16} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Full de ruta</p>
            <p className="text-sm font-semibold text-slate-900 truncate">{t.projecte}</p>
            {t.tipusServei && (
              <span className="inline-block mt-0.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">
                {t.tipusServei}
              </span>
            )}
          </div>
          <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${
            t.estat === 'Lliurat' ? 'bg-emerald-100 text-emerald-800' :
            t.estat === 'Cancel·lat' ? 'bg-rose-100 text-rose-800' :
            t.estat === 'En Preparació' ? 'bg-amber-100 text-amber-800' :
            t.estat === 'Confirmat' ? 'bg-blue-100 text-blue-800' :
            'bg-slate-100 text-slate-700'
          }`}>
            {t.estat}
          </span>
        </div>
      </header>

      <main className="p-4 space-y-4 max-w-lg mx-auto">
        {/* Cancel·lació */}
        {cancellat && (
          <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <XCircle size={22} className="text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-900">Aquest transport ha estat cancel·lat</p>
                {t.motiuCancellacio && (
                  <p className="text-sm text-rose-800 mt-1">Motiu: {t.motiuCancellacio}</p>
                )}
                <p className="text-xs text-rose-700 mt-2">
                  Si creus que hi ha hagut un error, contacta amb el responsable de producció.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Hora de citació */}
        <div className="bg-white rounded-2xl border shadow-sm p-5">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-medium uppercase tracking-wide">
            <Clock size={14} /> Hora de recollida
          </div>
          <div className="mt-1 text-5xl font-bold text-slate-900 font-mono tabular-nums tracking-tight">
            {t.horaRecollida || '--:--'}
          </div>
          {t.dataCarrega && (
            <div className="flex items-center gap-1.5 text-sm text-slate-500 mt-1">
              <Calendar size={13} /> {formatData(t.dataCarrega)}
            </div>
          )}
          {(t.horaEntregaEstimada || t.dataEntrega) && (
            <div className="text-sm text-slate-600 mt-3 pt-3 border-t border-slate-100">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Entrega estimada</div>
              <div className="mt-0.5 flex items-baseline gap-2 flex-wrap">
                {t.horaEntregaEstimada && (
                  <span className="font-mono font-semibold text-lg text-slate-900">{t.horaEntregaEstimada}</span>
                )}
                {t.dataEntrega && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <Calendar size={11} /> {formatData(t.dataEntrega)}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Ubicació */}
        <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-3">
          {t.origen && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium flex items-center gap-1.5">
                <MapPin size={12} /> Ubicació càrrega
              </div>
              <p className="text-sm text-slate-900 mt-0.5">{t.origen}</p>
              {t.notesOrigen && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-1.5 flex gap-1.5 items-start">
                  <StickyNote size={12} className="shrink-0 mt-0.5 text-amber-600" />
                  <span>{t.notesOrigen}</span>
                </p>
              )}
            </div>
          )}
          {t.desti && (
            <div className="pt-3 border-t border-slate-100">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium flex items-center gap-1.5">
                <MapPin size={12} /> Ubicació entrega
              </div>
              <p className="text-sm font-medium text-slate-900 mt-0.5">{t.desti}</p>
              {t.notesDesti && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-1.5 flex gap-1.5 items-start">
                  <StickyNote size={12} className="shrink-0 mt-0.5 text-amber-600" />
                  <span>{t.notesDesti}</span>
                </p>
              )}
            </div>
          )}

          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 w-full py-4 flex items-center justify-center gap-2 font-semibold text-base text-white rounded-xl shadow-sm active:scale-[0.99] transition-transform"
              style={{ background: '#00617F' }}
            >
              <Navigation size={20} />
              Com arribar
            </a>
          )}
        </div>

        {/* Contacte responsable */}
        {(t.responsableProduccio || t.telefonResponsable) && (
          <div className="bg-white rounded-2xl border shadow-sm p-5">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-2">Contacte a la nau</div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 truncate">{t.responsableProduccio || '—'}</p>
                <p className="text-xs text-slate-500 truncate">Cap de producció</p>
              </div>
              {telResp && (
                <a
                  href={`tel:${telResp}`}
                  className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl font-semibold text-sm shadow-sm active:scale-[0.99] transition-transform"
                >
                  <Phone size={16} />
                  Trucar
                </a>
              )}
            </div>
          </div>
        )}

        {/* Notes */}
        {t.notes && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle size={15} className="text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Notes</p>
                <p className="text-sm text-amber-900 mt-0.5">{t.notes}</p>
              </div>
            </div>
          </div>
        )}

        {/* Botons conductor */}
        {!cancellat && !iniciat && !finalitzat && (
          <button
            onClick={async () => {
              const hora = horaActual();
              try {
                await api.post(`/logistics/public/${token}/start`, { hora });
                setTransport(prev => ({ ...prev, horaIniciReal: hora, estat: 'En Preparació' }));
              } catch (err) {
                console.error('Error iniciant ruta:', err);
              }
            }}
            className="w-full py-4 flex items-center justify-center gap-2 font-semibold text-base text-white rounded-xl shadow-sm active:scale-[0.99] transition-transform bg-emerald-600"
          >
            <Play size={20} className="fill-white" />
            Iniciar ruta
          </button>
        )}

        {/* Info jornada */}
        {iniciat && !finalitzat && (
          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
              <div className="flex items-center gap-2">
                <Play size={16} className="text-blue-600 shrink-0 fill-blue-600" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-blue-900">Ruta iniciada</p>
                  <p className="text-xs text-blue-700">Inici: <span className="font-mono font-bold">{t.horaIniciReal}</span></p>
                </div>
              </div>
            </div>
            <button
              onClick={async () => {
                const hora = horaActual();
                try {
                  await api.post(`/logistics/public/${token}/end`, { hora });
                  setTransport(prev => ({ ...prev, horaFiReal: hora, estat: 'Lliurat' }));
                } catch (err) {
                  console.error('Error finalitzant ruta:', err);
                }
              }}
              className="w-full py-4 flex items-center justify-center gap-2 font-semibold text-base text-white rounded-xl shadow-sm active:scale-[0.99] transition-transform bg-rose-600"
            >
              <Flag size={20} />
              Finalitzar ruta
            </button>
          </div>
        )}

        {/* Ruta finalitzada */}
        {finalitzat && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
            <div className="text-center">
              <CheckCircle2 size={28} className="mx-auto text-emerald-600 mb-2" />
              <p className="font-semibold text-emerald-900">Ruta finalitzada</p>
            </div>
            <div className="mt-4 pt-4 border-t border-emerald-200 space-y-1.5 text-sm">
              {t.horaIniciReal && (
                <div className="flex items-center justify-between">
                  <span className="text-emerald-800 flex items-center gap-1.5"><Play size={12} className="fill-emerald-700 text-emerald-700" /> Inici</span>
                  <span className="font-mono font-bold text-emerald-900">{t.horaIniciReal}</span>
                </div>
              )}
              {t.horaFiReal && (
                <div className="flex items-center justify-between">
                  <span className="text-emerald-800 flex items-center gap-1.5"><Flag size={12} /> Final</span>
                  <span className="font-mono font-bold text-emerald-900">{t.horaFiReal}</span>
                </div>
              )}
              {duradaMin != null && (
                <div className="flex items-center justify-between">
                  <span className="text-emerald-800 flex items-center gap-1.5"><Timer size={12} /> Durada</span>
                  <span className="font-mono font-bold text-emerald-900">{formatDurada(duradaMin)}</span>
                </div>
              )}
              {t.minutsExtres != null && t.minutsExtres !== 0 && (
                <div className="flex items-center justify-between pt-2 mt-2 border-t border-emerald-200">
                  <span className={`flex items-center gap-1.5 ${t.minutsExtres > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    <Clock size={12} /> {t.minutsExtres > 0 ? 'Hores extres' : 'Avançat'}
                  </span>
                  <span className={`font-mono font-bold ${t.minutsExtres > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {descHoresExtres(t.minutsExtres)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="text-center text-[11px] text-slate-400 font-mono pt-2">{t.id}</div>
      </main>
    </div>
  );
}
