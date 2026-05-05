/**
 * useMarketingStatus — flag MARKETING_ENABLED del backend (compartit
 * entre Sidebar i pàgines de marketing).
 *
 * Cache mòdul-level amb TTL llarg (5 min) — la flag canvia només via
 * canvi d'env del servidor + reinici. Fail-open per defecte (no amaguem
 * UI si l'API falla).
 */
import { useState, useEffect } from 'react';
import api from '../lib/api';

const TTL_MS = 5 * 60 * 1000;
let _cache = null; // { enabled, monthly_cap_usd, t }
let _inflight = null;

async function _fetchStatus() {
  if (_cache && Date.now() - _cache.t < TTL_MS) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const r = await api.get('/marketing/status');
      _cache = { ...r.data, t: Date.now() };
      return _cache;
    } catch (e) {
      // Fail-open: si no podem llegir, assumim activat (no amaguem UI)
      _cache = { enabled: true, monthly_cap_usd: null, t: Date.now(), error: true };
      return _cache;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export function invalidateMarketingStatus() {
  _cache = null;
}

export function useMarketingStatus() {
  const [status, setStatus] = useState({ enabled: true, loaded: false });

  useEffect(() => {
    let alive = true;
    _fetchStatus().then((s) => {
      if (alive) setStatus({ ...s, loaded: true });
    });
    return () => { alive = false; };
  }, []);

  return status;
}
