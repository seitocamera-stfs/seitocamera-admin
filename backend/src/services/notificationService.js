/**
 * notificationService — wrapper reutilitzable per crear notificacions
 * (`OpNotification` row + push si l'usuari té dispositius subscrits).
 *
 * Origen: les funcions vivien dins `routes/operations.js`. Les he duplicat
 * aquí (no extret) perquè operations.js segueix usant-les en flux síncron;
 * cap codi nou (cron jobs, agents IA, etc.) ha d'importar des d'operations.js.
 */
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

/**
 * @param {string} userId
 * @param {{
 *   type: string,
 *   title: string,
 *   message: string,
 *   entityType?: string,
 *   entityId?: string,
 *   priority?: 'low' | 'normal' | 'high' | 'urgent',
 * }} notifData
 */
async function notifyUser(userId, notifData) {
  if (!userId) return;
  try {
    await prisma.opNotification.create({ data: { userId, ...notifData } });
    try {
      const pushService = require('./pushService');
      pushService.sendToUser(userId, {
        title: notifData.title || 'SeitoCamera',
        body: notifData.message || '',
        url: notifData.entityType ? `/${notifData.entityType}s` : '/',
        tag: notifData.type || 'notification',
      }).catch(() => {});
    } catch { /* push no disponible */ }
  } catch (err) {
    logger.error(`Error creant notificació per user ${userId}: ${err.message}`);
  }
}

/**
 * Crea notificació per a tots els usuaris amb assignació activa al rol.
 *
 * @param {string} roleCode  ex: 'WAREHOUSE_LEAD', 'ADMIN_COORDINATION'
 * @param {Object} notifData mateixa forma que notifyUser
 * @returns {Promise<number>} Nombre d'usuaris notificats
 */
async function notifyRole(roleCode, notifData) {
  try {
    const assignments = await prisma.roleAssignment.findMany({
      where: {
        role: { code: roleCode },
        OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
      },
      select: { userId: true },
    });
    if (!assignments.length) return 0;

    await prisma.opNotification.createMany({
      data: assignments.map((a) => ({ userId: a.userId, ...notifData })),
    });

    try {
      const pushService = require('./pushService');
      const userIds = assignments.map((a) => a.userId);
      pushService.sendToUsers(userIds, {
        title: notifData.title || 'SeitoCamera',
        body: notifData.message || '',
        url: notifData.entityType ? `/${notifData.entityType}s` : '/',
        tag: notifData.type || 'notification',
      }).catch(() => {});
    } catch { /* push no disponible */ }

    return assignments.length;
  } catch (err) {
    logger.error(`Error creant notificació per rol ${roleCode}: ${err.message}`);
    return 0;
  }
}

/**
 * Comprova si ja existeix una notificació recent del mateix `type` i
 * `entityId` per al mateix `userId` (deduplicació). Útil per evitar
 * spammejar l'usuari quan un cron es repeteix o un agent es refà.
 */
async function alreadyNotified(userId, { type, entityId, withinHours = 12 }) {
  const since = new Date(Date.now() - withinHours * 3600 * 1000);
  const found = await prisma.opNotification.findFirst({
    where: { userId, type, entityId, createdAt: { gte: since } },
    select: { id: true },
  });
  return Boolean(found);
}

module.exports = { notifyUser, notifyRole, alreadyNotified };
