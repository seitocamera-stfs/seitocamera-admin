// ===========================================
// Web Push Notification Service
// ===========================================

const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

let webpush;
try {
  webpush = require('web-push');
} catch {
  logger.warn('web-push no disponible — push notifications desactivades');
}

// ===========================================
// Configuració VAPID
// ===========================================

function getVapidKeys() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL || 'mailto:seitocamera@gmail.com';

  if (!publicKey || !privateKey) {
    return null;
  }

  return { publicKey, privateKey, email };
}

function isAvailable() {
  if (!webpush) return false;
  const keys = getVapidKeys();
  return !!keys;
}

// Configurar web-push si disponible
function setup() {
  if (!webpush) return false;
  const keys = getVapidKeys();
  if (!keys) {
    logger.info('Push: VAPID keys no configurades (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)');
    return false;
  }

  webpush.setVapidDetails(keys.email, keys.publicKey, keys.privateKey);
  logger.info('Push: Web Push configurat correctament');
  return true;
}

// ===========================================
// Subscripcions
// ===========================================

/**
 * Guardar subscripció push d'un dispositiu
 */
async function subscribe(userId, subscription, userAgent) {
  const { endpoint, keys } = subscription;

  // Upsert: si l'endpoint ja existeix, actualitzar
  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: {
      userId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent || null,
    },
    create: {
      userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent || null,
    },
  });

  logger.info(`Push: subscripció ${sub.id} per user ${userId}`);
  return sub;
}

/**
 * Eliminar subscripció
 */
async function unsubscribe(endpoint) {
  try {
    await prisma.pushSubscription.delete({ where: { endpoint } });
  } catch {
    // Ja eliminada
  }
}

// ===========================================
// Enviar notificacions
// ===========================================

/**
 * Enviar push notification a un usuari específic
 * @param {string} userId
 * @param {object} payload - { title, body, icon, url, tag }
 */
async function sendToUser(userId, payload) {
  if (!isAvailable()) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  if (subscriptions.length === 0) return;

  const jsonPayload = JSON.stringify({
    title: payload.title || 'SeitoCamera',
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    url: payload.url || '/',
    tag: payload.tag || 'default',
  });

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          jsonPayload
        );
      } catch (err) {
        // 410 Gone o 404 = subscripció expirada → eliminar
        if (err.statusCode === 410 || err.statusCode === 404) {
          logger.info(`Push: eliminant subscripció expirada ${sub.id}`);
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          logger.warn(`Push: error enviant a ${sub.id}: ${err.message}`);
        }
        throw err;
      }
    })
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  if (sent > 0) {
    logger.debug(`Push: ${sent}/${subscriptions.length} enviades a user ${userId}`);
  }
}

/**
 * Enviar push a múltiples usuaris
 */
async function sendToUsers(userIds, payload) {
  if (!isAvailable()) return;
  await Promise.allSettled(userIds.map(uid => sendToUser(uid, payload)));
}

// Inicialitzar
setup();

module.exports = {
  isAvailable,
  getVapidKeys,
  subscribe,
  unsubscribe,
  sendToUser,
  sendToUsers,
  setup,
};
