/**
 * Activitat usuaris — Administració.
 *
 * Vista en 2 panells:
 *   - Stats (cards): usuaris vistos últims 7/30/90 dies, intents fallits 24h
 *   - Per usuari: taula amb últim login, últim seen, total logins
 *   - Historial: scroll d'esdeveniments recents (login OK + fail) amb IP/UA
 */
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LineChart, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  User as UserIcon, Clock, Filter, Eye, Globe, Monitor,
} from 'lucide-react';
import { useApiGet } from '../hooks/useApi';
import api from '../lib/api';

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ca-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtRelative(iso) {
  if (!iso) return 'Mai';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Ara mateix';
  if (min < 60) return `Fa ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Fa ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `Fa ${d} dia${d === 1 ? '' : 's'}`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `Fa ${mo} mes${mo === 1 ? '' : 'os'}`;
  return `Fa ${Math.floor(mo / 12)} any${mo < 24 ? '' : 's'}`;
}

const FAIL_REASON_LABELS = {
  invalid_password: 'Contrasenya incorrecta',
  unknown_email:    'Email no existeix',
  inactive_user:    'Compte desactivat',
  unknown_error:    'Error desconegut',
};

function StatCard({ label, value, sub, icon: Icon, tone = 'slate' }) {
  const tones = {
    slate:   'bg-white border-slate-200',
    emerald: 'bg-emerald-50/60 border-emerald-200',
    amber:   'bg-amber-50/60 border-amber-200',
    rose:    'bg-rose-50/60 border-rose-200',
    blue:    'bg-blue-50/60 border-blue-200',
  };
  const iconColor = {
    slate: 'text-slate-500', emerald: 'text-emerald-600',
    amber: 'text-amber-600', rose: 'text-rose-600', blue: 'text-blue-600',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon size={14} className={iconColor[tone]} />}
        <span className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function UserActivity() {
  const [searchParams] = useSearchParams();
  const initialUserId = searchParams.get('userId') || '';
  // Si arribem amb ?userId=..., obrim directament la pestanya d'historial filtrat
  const [tab, setTab] = useState(initialUserId ? 'history' : 'users');
  const [historyFilter, setHistoryFilter] = useState({ success: '', userId: initialUserId });

  const { data: stats, refetch: refetchStats, loading: statsLoading } = useApiGet('/user-activity/stats');
  const { data: byUser, refetch: refetchByUser, loading: byUserLoading } = useApiGet('/user-activity/by-user');
  const { data: history, refetch: refetchHistory, loading: historyLoading } = useApiGet(
    '/user-activity',
    historyFilter,
  );

  const refreshAll = useCallback(() => {
    refetchStats(); refetchByUser(); refetchHistory();
  }, [refetchStats, refetchByUser, refetchHistory]);

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <LineChart size={22} className="text-[#00617F]" />
            Activitat d'usuaris
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Historial d'accessos a l'app — útil per detectar usuaris inactius o intents sospitosos.
          </p>
        </div>
        <button
          onClick={refreshAll}
          className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
        >
          <RefreshCw size={14} /> Refrescar
        </button>
      </div>

      {/* Stats */}
      {statsLoading ? (
        <div className="text-center py-8 text-gray-400"><RefreshCw className="animate-spin inline" /> Carregant...</div>
      ) : stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard
            icon={UserIcon}
            label="Usuaris actius totals"
            value={stats.total_active_users}
            tone="slate"
          />
          <StatCard
            icon={CheckCircle2}
            label="Vistos 7 dies"
            value={stats.seen_last_7d}
            sub={`${Math.round(100 * stats.seen_last_7d / Math.max(1, stats.total_active_users))}% del total`}
            tone="emerald"
          />
          <StatCard
            icon={Clock}
            label="Vistos 30 dies"
            value={stats.seen_last_30d}
            tone="blue"
          />
          <StatCard
            icon={AlertTriangle}
            label="Sense activitat 90+ dies"
            value={stats.never_seen}
            sub="incloent mai vistos"
            tone="amber"
          />
          <StatCard
            icon={XCircle}
            label="Intents fallits 24h"
            value={stats.failed_attempts_24h}
            sub={Object.entries(stats.failed_by_reason_24h).map(([r, c]) => `${FAIL_REASON_LABELS[r] || r}: ${c}`).join(' · ') || '—'}
            tone={stats.failed_attempts_24h > 5 ? 'rose' : 'slate'}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="border-b flex gap-1">
        {[
          { k: 'users', label: 'Per usuari' },
          { k: 'history', label: 'Historial complet' },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.k ? 'border-[#00617F] text-[#00617F]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Vista per usuari */}
      {tab === 'users' && (
        <div className="border rounded-lg overflow-hidden bg-white">
          {byUserLoading ? (
            <div className="text-center py-8 text-gray-400"><RefreshCw className="animate-spin inline" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Usuari</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Rol</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Últim login</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Última activitat</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Total logins</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(byUser?.users || []).map((u) => {
                  const days = u.days_since_seen;
                  const inactiveCls = days == null ? 'text-rose-600' : days > 30 ? 'text-amber-600' : 'text-emerald-600';
                  return (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-gray-50/50">
                      <td className="px-3 py-2">
                        <div className="font-medium">{u.name}</div>
                        <div className="text-[11px] text-gray-400">{u.email}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{u.role}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700" title={fmtDateTime(u.lastLoginAt)}>
                        {fmtRelative(u.lastLoginAt)}
                      </td>
                      <td className={`px-3 py-2 text-xs font-medium ${inactiveCls}`} title={fmtDateTime(u.lastSeenAt)}>
                        {fmtRelative(u.lastSeenAt)}
                      </td>
                      <td className="px-3 py-2 text-right text-sm">{u.successful_logins_total}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => { setHistoryFilter({ success: '', userId: u.id }); setTab('history'); }}
                          className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-1"
                          title="Veure historial d'aquest usuari"
                        >
                          <Eye size={11} /> Historial
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Vista historial complet */}
      {tab === 'history' && (
        <div className="space-y-3">
          {/* Filtres */}
          <div className="flex flex-wrap items-center gap-2 bg-white border rounded-lg px-3 py-2">
            <Filter size={14} className="text-gray-400" />
            <select
              value={historyFilter.success}
              onChange={(e) => setHistoryFilter({ ...historyFilter, success: e.target.value })}
              className="text-xs border rounded px-2 py-1 bg-white"
            >
              <option value="">Tots els intents</option>
              <option value="true">Només exitosos</option>
              <option value="false">Només fallits</option>
            </select>
            <select
              value={historyFilter.userId}
              onChange={(e) => setHistoryFilter({ ...historyFilter, userId: e.target.value })}
              className="text-xs border rounded px-2 py-1 bg-white min-w-[160px]"
            >
              <option value="">Tots els usuaris</option>
              {(byUser?.users || []).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {(historyFilter.success || historyFilter.userId) && (
              <button
                onClick={() => setHistoryFilter({ success: '', userId: '' })}
                className="text-[11px] text-gray-400 hover:text-gray-600"
              >
                Netejar
              </button>
            )}
            <span className="text-[11px] text-gray-400 ml-auto">
              {history?.count || 0} entrades (max {history?.limit || 100})
            </span>
          </div>

          <div className="border rounded-lg overflow-hidden bg-white">
            {historyLoading ? (
              <div className="text-center py-8 text-gray-400"><RefreshCw className="animate-spin inline" /></div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Quan</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Usuari / Email</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Estat</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">IP</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Browser</th>
                  </tr>
                </thead>
                <tbody>
                  {(history?.logs || []).map((log) => (
                    <tr key={log.id} className="border-b last:border-0 hover:bg-gray-50/50">
                      <td className="px-3 py-2 text-xs text-gray-700" title={fmtDateTime(log.loggedInAt)}>
                        {fmtRelative(log.loggedInAt)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {log.user ? (
                          <>
                            <div className="font-medium text-gray-800">{log.user.name}</div>
                            <div className="text-[11px] text-gray-400">{log.user.email}</div>
                          </>
                        ) : (
                          <span className="text-gray-400 italic">{log.email}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {log.success ? (
                          <span className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                            <CheckCircle2 size={11} /> OK
                          </span>
                        ) : (
                          <span className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700" title={FAIL_REASON_LABELS[log.failReason] || log.failReason || 'unknown'}>
                            <XCircle size={11} /> {FAIL_REASON_LABELS[log.failReason] || log.failReason || 'fail'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-gray-500 font-mono">
                        {log.ipAddress ? (
                          <span className="inline-flex items-center gap-1"><Globe size={10} />{log.ipAddress}</span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-gray-500 max-w-[280px] truncate" title={log.userAgent}>
                        {log.userAgent ? (
                          <span className="inline-flex items-center gap-1"><Monitor size={10} />{log.userAgent.slice(0, 60)}{log.userAgent.length > 60 ? '…' : ''}</span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                  {(!history?.logs || history.logs.length === 0) && (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">Cap registre amb aquests filtres</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
