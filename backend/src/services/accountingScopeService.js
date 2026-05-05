/**
 * accountingScopeService — font única de veritat per la "data tall comptable".
 *
 * Tot el sistema (crons, agents IA, dashboards) consulta aquí per saber
 * a partir de quan considerar una factura "dins del scope". Anteriors
 * queden ignorades silenciosament (no generen alertes, no surten a
 * cobraments vençuts, etc.).
 *
 * Cache 60s — la dada canvia molt rarament (només quan l'usuari ajusta
 * la configuració de l'empresa).
 */
const { prisma } = require('../config/database');

let _cache = null;
let _cacheAt = 0;
const TTL_MS = 60_000;

/**
 * Retorna la data tall configurada a Company.accountingScopeFrom.
 * Si no hi ha cap empresa o no hi ha data configurada, retorna null
 * (= no filtre, comportament històric).
 */
async function getAccountingScopeFrom() {
  const now = Date.now();
  if (_cache !== null && now - _cacheAt < TTL_MS) return _cache;
  const company = await prisma.company.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { accountingScopeFrom: true },
  });
  _cache = company?.accountingScopeFrom || null;
  _cacheAt = now;
  return _cache;
}

/**
 * Helper per construir filtres Prisma `where` sobre `issueDate`.
 * Si no hi ha scope configurat, retorna {} (no afegeix filtre).
 *
 * @param {string} field — nom del camp (default 'issueDate'). Útil per
 *   `BankMovement.date` o altres camps temporal.
 */
async function scopeFilter(field = 'issueDate') {
  const from = await getAccountingScopeFrom();
  if (!from) return {};
  return { [field]: { gte: from } };
}

function clearCache() { _cache = null; _cacheAt = 0; }

module.exports = { getAccountingScopeFrom, scopeFilter, clearCache };
