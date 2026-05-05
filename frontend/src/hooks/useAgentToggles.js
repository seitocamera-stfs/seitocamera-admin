/**
 * useAgentToggles — comparteix l'estat dels toggles d'agents IA entre components
 * (Sidebar, Dashboard, etc.) sense fer múltiples crides al mateix endpoint.
 *
 * Cache mòdul-level amb TTL 60s. Tots els consumidors veuen la mateixa info i
 * comparteixen la mateixa promise mentre es resol la primera crida.
 */
import { useState, useEffect } from 'react';
import api from '../lib/api';

const TTL_MS = 60_000;
let _cache = null; // { byType: Map<jobType, isEnabled>, t: number }
let _inflight = null;
const _subscribers = new Set();

async function _fetchToggles() {
  if (_cache && Date.now() - _cache.t < TTL_MS) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const r = await api.get('/agent/jobs/config');
      const byType = {};
      for (const c of (r.data || [])) byType[c.jobType] = c.isEnabled;
      _cache = { byType, t: Date.now() };
      return _cache;
    } catch (e) {
      // Fail-open: si no podem llegir, assumim tot habilitat (no amaguem UI)
      _cache = { byType: {}, t: Date.now(), error: true };
      return _cache;
    } finally {
      _inflight = null;
      for (const fn of _subscribers) {
        try { fn(); } catch { /* ignore */ }
      }
    }
  })();
  return _inflight;
}

export function invalidateAgentToggles() {
  _cache = null;
  for (const fn of _subscribers) {
    try { fn(); } catch { /* ignore */ }
  }
}

/**
 * Retorna `true` mentre carrega o si el toggle està actiu (fail-open).
 * Retorna `false` només si la config existeix i `isEnabled === false`.
 */
export function useAgentEnabled(jobType) {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const update = () => {
      if (!_cache) return;
      const v = _cache.byType[jobType];
      // undefined → no s'ha carregat encara o jobType no existeix → mostrem (fail-open)
      if (alive) {
        setEnabled(v !== false);
        setLoaded(true);
      }
    };
    _subscribers.add(update);
    _fetchToggles().then(update);
    return () => {
      alive = false;
      _subscribers.delete(update);
    };
  }, [jobType]);

  return { enabled, loaded };
}
