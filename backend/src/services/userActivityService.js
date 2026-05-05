/**
 * userActivityService — registra accessos i activitat d'usuari.
 *
 * Dues primitives:
 *   - recordLogin(userId, email, req, { success, failReason })
 *     → escriu un row a UserLoginLog. Crida-ho a /auth/login (success + fail).
 *
 *   - touchLastSeen(userId)
 *     → actualitza User.lastSeenAt amb throttling per evitar 1 UPDATE per
 *       request. Cache en memòria — només escriu si han passat ≥5 min des de
 *       l'última actualització d'aquest usuari.
 *
 * Notes:
 *   - El throttling és per-procés (no compartit entre workers). Si en algun
 *     moment s'usa cluster, migrar a Redis. Per ara no és problema.
 *   - El touch fa servir update sense await per no bloquejar la request;
 *     l'error queda al log però no propaga.
 */
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

const TOUCH_THROTTLE_MS = 5 * 60 * 1000; // 5 min entre updates per usuari
const _lastTouchByUser = new Map(); // userId → timestamp ms

/**
 * Extreu IP i user-agent de la request, truncats a longitud raonable.
 * `req.ip` requereix `app.set('trust proxy', ...)` configurat al backend
 * perquè reflecteixi la IP real del client (no la de nginx).
 */
function _extractClientInfo(req) {
  return {
    ipAddress: (req.ip || req.connection?.remoteAddress || '').slice(0, 64) || null,
    userAgent: (req.headers?.['user-agent'] || '').slice(0, 500) || null,
  };
}

/**
 * Registra un intent de login (success o fail). NO llença mai — captura
 * errors internament perquè un fallo de log no trenqui l'auth flow.
 */
async function recordLogin(userId, email, req, { success = true, failReason = null } = {}) {
  try {
    const { ipAddress, userAgent } = _extractClientInfo(req);
    await prisma.userLoginLog.create({
      data: {
        userId: userId || null,
        email: (email || '').slice(0, 320),
        success,
        failReason,
        ipAddress,
        userAgent,
      },
    });
  } catch (e) {
    logger.warn(`recordLogin failed: ${e.message}`);
  }
}

/**
 * Marca User.lastSeenAt = now, amb throttling de 5 min. Fire-and-forget.
 */
function touchLastSeen(userId) {
  if (!userId) return;
  const now = Date.now();
  const last = _lastTouchByUser.get(userId) || 0;
  if (now - last < TOUCH_THROTTLE_MS) return;
  _lastTouchByUser.set(userId, now);

  // Fire-and-forget; no espera ni propaga errors per no afegir latència
  prisma.user.update({
    where: { id: userId },
    data: { lastSeenAt: new Date() },
  }).catch((e) => {
    logger.warn(`touchLastSeen(${userId}) failed: ${e.message}`);
  });
}

/**
 * Test helper — buida la cache de throttling.
 */
function clearTouchCache() {
  _lastTouchByUser.clear();
}

module.exports = {
  recordLogin,
  touchLastSeen,
  clearTouchCache,
  TOUCH_THROTTLE_MS,
};
