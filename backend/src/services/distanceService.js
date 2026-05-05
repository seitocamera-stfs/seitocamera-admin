/**
 * distanceService — calcula distàncies en cotxe entre dues adreces via Google
 * Maps Distance Matrix API.
 *
 * Requereix `GOOGLE_MAPS_API_KEY` a l'entorn. Si no existeix, qualsevol crida
 * llença `MISSING_API_KEY` perquè el caller pugui fer fallback (no calcular).
 *
 * Cache 24h en memòria per a parells (origen, destí) — adreces de transport
 * canvien rarament i cal estalviar trucades.
 */
const { logger } = require('../config/logger');
const { prisma } = require('../config/database');

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
// Adreça d'origen per defecte (HQ SeitoCamera). Es pot sobreescriure via env;
// alternativament es pot configurar als camps `address/city/postalCode` de Company.
const HQ_FALLBACK = process.env.LOGISTICS_HQ_ADDRESS || 'Barcelona, España';

const cache = new Map(); // key = `${o}|${d}` → { km, t }
const TTL_MS = 24 * 60 * 60 * 1000;

let _hqCache = null;
let _hqCacheAt = 0;
const HQ_TTL_MS = 60_000;

async function getHqAddress() {
  const now = Date.now();
  if (_hqCache && now - _hqCacheAt < HQ_TTL_MS) return _hqCache;
  try {
    const c = await prisma.company.findFirst();
    if (c) {
      const parts = [c.address, c.postalCode, c.city, c.country].filter(Boolean);
      if (parts.length) {
        _hqCache = parts.join(', ');
        _hqCacheAt = now;
        return _hqCache;
      }
    }
  } catch (e) {
    logger.debug?.(`distanceService: error llegint Company HQ: ${e.message}`);
  }
  _hqCache = HQ_FALLBACK;
  _hqCacheAt = now;
  return _hqCache;
}

function _normalize(s) {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

class DistanceError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/**
 * Distància en cotxe (km) entre dues adreces. Llença DistanceError amb codes:
 *   MISSING_API_KEY | EMPTY_ADDRESS | NOT_FOUND | API_ERROR
 */
async function getDistanceKm(origen, desti) {
  if (!GOOGLE_API_KEY) throw new DistanceError('MISSING_API_KEY', 'GOOGLE_MAPS_API_KEY no configurada');
  const o = (origen || '').trim();
  const d = (desti || '').trim();
  if (!o || !d) throw new DistanceError('EMPTY_ADDRESS', 'Origen o destí buits');

  const key = `${_normalize(o)}|${_normalize(d)}`;
  const now = Date.now();
  const c = cache.get(key);
  if (c && now - c.t < TTL_MS) return c.km;

  const params = new URLSearchParams({
    origins: o,
    destinations: d,
    mode: 'driving',
    units: 'metric',
    region: 'es',
    language: 'ca',
    key: GOOGLE_API_KEY,
  });
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`;

  let json;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    json = await r.json();
  } catch (e) {
    throw new DistanceError('API_ERROR', `Error xarxa: ${e.message}`);
  }

  if (json.status && json.status !== 'OK') {
    throw new DistanceError('API_ERROR', `Google Maps: ${json.status} ${json.error_message || ''}`);
  }
  const elem = json?.rows?.[0]?.elements?.[0];
  if (!elem) throw new DistanceError('API_ERROR', 'Resposta sense rows/elements');
  if (elem.status !== 'OK') {
    throw new DistanceError(
      elem.status === 'NOT_FOUND' || elem.status === 'ZERO_RESULTS' ? 'NOT_FOUND' : 'API_ERROR',
      `Google Maps element: ${elem.status}`
    );
  }
  const km = elem.distance.value / 1000;
  cache.set(key, { km, t: now });
  return km;
}

/**
 * Km anada+tornada per a un transport. Usa `origen` si està definit; si no,
 * cau cap a HQ (config Company o env). Multiplica × 2 (tornada per la mateixa ruta).
 */
async function getRoundtripKm({ origen, desti }) {
  if (!desti?.trim()) throw new DistanceError('EMPTY_ADDRESS', 'Destí no definit');
  const o = origen?.trim() || (await getHqAddress());
  const oneway = await getDistanceKm(o, desti);
  return Math.round(oneway * 2 * 10) / 10; // 1 decimal
}

function isConfigured() {
  return !!GOOGLE_API_KEY;
}

function clearCache() {
  cache.clear();
  _hqCache = null;
}

module.exports = {
  DistanceError,
  getDistanceKm,
  getRoundtripKm,
  getHqAddress,
  isConfigured,
  clearCache,
};
