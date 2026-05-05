/**
 * transportCostService — càlcul automàtic del cost intern d'un Transport.
 *
 * Fórmula:
 *   cost = tarifaCategoria
 *        + (foraBarcelona && km > 0 ? km × costPerKm : 0)
 *        + (minutsExtres > 0 ? minutsExtres / 60 × tarifaHoraExtra : 0)
 *
 * NOTA hores extres: minutsExtres = max(0, (horaFiReal − horaIniciReal) − 12h).
 * La jornada estàndard és de 12h; tot el que excedeixi compta com a extra.
 * El cronòmetre comença quan el conductor dona "play" (horaIniciReal) — si
 * mai no ha donat play, no es computen extres.
 *
 * Categories:
 *   ENTREGA_RECOLLIDA → cost fix (e.g. 30€)
 *   RODATGE_DIA       → cost fix dia sencer (e.g. 80€)
 *   INTERN            → moviment intern, normalment 0
 *   ALTRE             → no es calcula auto; usar costManual
 *
 * Si Transport.costManual no és null, té prioritat (override per casos especials).
 *
 * Cache 60s — config canvia molt rarament.
 */
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');
const distanceService = require('./distanceService');

let _configCache = null;
let _configCacheAt = 0;
const TTL_MS = 60_000;

async function getConfig() {
  const now = Date.now();
  if (_configCache && now - _configCacheAt < TTL_MS) return _configCache;
  const config = await prisma.transportCostConfig.findUnique({ where: { id: 'default' } });
  if (!config) {
    // Per si la migració no s'ha aplicat encara, fem fallback amb valors per defecte
    return {
      costEntregaRecollida: 30, costRodatgeDia: 80, costIntern: 0,
      costPerKm: 0.200, tarifaHoraExtra: 25,
    };
  }
  _configCache = config;
  _configCacheAt = now;
  return config;
}

function clearConfigCache() { _configCache = null; _configCacheAt = 0; }

const n = (v) => Number(v) || 0;
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * Calcula el desglós i total per a un transport. Retorna objecte amb:
 *   { servei, gasolina, hores, total, isManual }
 *
 * No actualitza la BD; retorna només el càlcul. El caller decideix què guardar.
 */
async function computeBreakdown(transport, configOverride = null) {
  const config = configOverride || await getConfig();

  // costManual té sempre prioritat
  if (transport.costManual !== null && transport.costManual !== undefined) {
    return {
      servei: 0, gasolina: 0, hores: 0,
      total: round2(n(transport.costManual)),
      isManual: true,
      reason: 'Cost establert manualment',
    };
  }

  const cat = transport.tipusServeiCategoria;
  if (!cat || cat === 'ALTRE') {
    return {
      servei: 0, gasolina: 0, hores: 0, total: 0,
      isManual: false,
      reason: cat === 'ALTRE'
        ? 'Categoria ALTRE — establir cost manual'
        : 'Sense categoria assignada',
    };
  }

  // Tarifa fixa per categoria
  let servei = 0;
  if (cat === 'ENTREGA_RECOLLIDA') servei = n(config.costEntregaRecollida);
  else if (cat === 'RODATGE_DIA')  servei = n(config.costRodatgeDia);
  else if (cat === 'INTERN')       servei = n(config.costIntern);

  // Combustible si fora de Barcelona
  let gasolina = 0;
  if (transport.foraBarcelona && n(transport.kmAnadaTornada) > 0) {
    gasolina = n(transport.kmAnadaTornada) * n(config.costPerKm);
  }

  // Hores extres
  let hores = 0;
  if (n(transport.minutsExtres) > 0) {
    hores = (n(transport.minutsExtres) / 60) * n(config.tarifaHoraExtra);
  }

  const total = round2(servei + gasolina + hores);

  return {
    servei: round2(servei),
    gasolina: round2(gasolina),
    hores: round2(hores),
    total,
    isManual: false,
    reason: null,
  };
}

/**
 * Si foraBarcelona = true i no hi ha km manuals, intenta omplir-los amb
 * Google Maps a partir d'origen + destí del transport. Persisteix el km
 * descobert (perquè quedi visible al frontend) i retorna el transport
 * actualitzat. Si Google Maps falla (no API key, adreça no trobada, etc.),
 * retorna el transport sense modificar i registra l'error a costBreakdown
 * via warnings.
 *
 * Retorna: { transport, kmAuto: bool, kmError: string | null }
 */
async function ensureKm(transport) {
  // Només omplim si fora BCN i km no definits manualment
  if (!transport.foraBarcelona) return { transport, kmAuto: false, kmError: null };
  if (transport.kmAnadaTornada != null && Number(transport.kmAnadaTornada) > 0) {
    return { transport, kmAuto: false, kmError: null };
  }
  if (!distanceService.isConfigured()) {
    return { transport, kmAuto: false, kmError: 'GOOGLE_MAPS_API_KEY no configurada' };
  }
  if (!transport.desti?.trim()) {
    return { transport, kmAuto: false, kmError: 'Sense destí — no es pot calcular distància' };
  }

  try {
    const km = await distanceService.getRoundtripKm({
      origen: transport.origen,
      desti: transport.desti,
    });
    const updated = await prisma.transport.update({
      where: { id: transport.id },
      data: { kmAnadaTornada: km },
    });
    logger.info(`Transport ${transport.id}: km auto ${km} (${transport.origen || 'HQ'} → ${transport.desti})`);
    return { transport: updated, kmAuto: true, kmError: null };
  } catch (e) {
    logger.warn(`Transport ${transport.id}: no s'ha pogut calcular km: ${e.message}`);
    return { transport, kmAuto: false, kmError: e.message };
  }
}

/**
 * Recalcula i persisteix el cost al Transport. Idempotent — segur de cridar
 * cada cop que es desa el transport.
 *
 * Si foraBarcelona = true i no hi ha km manuals, primer intenta calcular-los
 * automàticament via Google Maps.
 */
async function recalculate(transportId, { forceKm = false } = {}) {
  const initial = await prisma.transport.findUnique({ where: { id: transportId } });
  if (!initial) return null;

  // Si forceKm, esborrem km abans perquè ensureKm els torni a buscar
  let working = initial;
  if (forceKm && initial.foraBarcelona) {
    working = await prisma.transport.update({
      where: { id: transportId },
      data: { kmAnadaTornada: null },
    });
  }

  const { transport, kmAuto, kmError } = await ensureKm(working);

  const breakdown = await computeBreakdown(transport);
  if (kmAuto) breakdown.kmAuto = true;
  if (kmError) breakdown.kmError = kmError;

  const updated = await prisma.transport.update({
    where: { id: transportId },
    data: {
      costCalculat: breakdown.total,
      costBreakdown: breakdown,
      costCalculatAt: new Date(),
    },
  });
  return { transport: updated, breakdown };
}

/**
 * Helper per detectar si els camps que afecten el càlcul han canviat.
 * Útil al middleware de PATCH per no recalcular si no cal.
 */
function affectsCost(updateData) {
  const fields = [
    'tipusServeiCategoria', 'foraBarcelona', 'kmAnadaTornada',
    'minutsExtres', 'horaFiReal', 'horaIniciReal', 'horaRecollida', 'costManual',
    // Origen/destí afecten la distància auto-calculada quan és fora BCN
    'origen', 'desti',
  ];
  return fields.some((f) => Object.prototype.hasOwnProperty.call(updateData, f));
}

module.exports = { getConfig, clearConfigCache, computeBreakdown, recalculate, ensureKm, affectsCost };
