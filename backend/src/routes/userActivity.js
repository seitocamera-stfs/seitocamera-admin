/**
 * Endpoints per veure l'historial d'accessos d'usuaris (Administració).
 *
 * Tots restringits a ADMIN — son dades sensibles de seguretat.
 *
 *   GET /api/user-activity              → llistat d'esdeveniments amb filtres
 *   GET /api/user-activity/stats        → resum: actius/inactius últims X dies
 *   GET /api/user-activity/by-user      → resum per usuari amb darrer login/seen
 */
const express = require('express');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(authorize('ADMIN'));

/**
 * GET /api/user-activity
 *   ?userId=...     filtra per usuari
 *   ?from=ISO       data des de
 *   ?to=ISO         data fins a
 *   ?success=true|false
 *   ?limit=100      (max 500)
 */
router.get('/', async (req, res, next) => {
  try {
    const { userId, from, to, success } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);

    const where = {};
    if (userId) where.userId = userId;
    if (success === 'true') where.success = true;
    if (success === 'false') where.success = false;
    if (from || to) {
      where.loggedInAt = {};
      if (from) where.loggedInAt.gte = new Date(from);
      if (to) where.loggedInAt.lte = new Date(to);
    }

    const logs = await prisma.userLoginLog.findMany({
      where,
      orderBy: { loggedInAt: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    res.json({ logs, count: logs.length, limit });
  } catch (err) { next(err); }
});

/**
 * GET /api/user-activity/stats
 * Comptadors d'usuaris actius vs inactius en finestres comunes (7d/30d/90d),
 * + intents fallits últimes 24h.
 */
router.get('/stats', async (req, res, next) => {
  try {
    const now = new Date();
    const days = (n) => new Date(now.getTime() - n * 86400_000);

    const [activeUsers, total7d, total30d, total90d, failed24h, byReason24h] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: true, lastSeenAt: { gte: days(7) } } }),
      prisma.user.count({ where: { isActive: true, lastSeenAt: { gte: days(30) } } }),
      prisma.user.count({ where: { isActive: true, lastSeenAt: { gte: days(90) } } }),
      prisma.userLoginLog.count({
        where: { success: false, loggedInAt: { gte: days(1) } },
      }),
      prisma.userLoginLog.groupBy({
        by: ['failReason'],
        where: { success: false, loggedInAt: { gte: days(1) } },
        _count: true,
      }),
    ]);

    res.json({
      total_active_users: activeUsers,
      seen_last_7d: total7d,
      seen_last_30d: total30d,
      seen_last_90d: total90d,
      never_seen: activeUsers - total90d,
      failed_attempts_24h: failed24h,
      failed_by_reason_24h: byReason24h.reduce((acc, r) => {
        acc[r.failReason || 'unknown'] = r._count;
        return acc;
      }, {}),
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/user-activity/by-user
 * Per a cada usuari actiu retorna lastLoginAt + lastSeenAt + total logins.
 * Útil per veure d'un cop d'ull qui usa la app.
 */
router.get('/by-user', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, email: true, role: true,
        lastLoginAt: true, lastSeenAt: true, createdAt: true,
        _count: { select: { loginLogs: { where: { success: true } } } },
      },
      orderBy: [
        { lastSeenAt: { sort: 'desc', nulls: 'last' } },
      ],
    });

    res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        lastLoginAt: u.lastLoginAt,
        lastSeenAt: u.lastSeenAt,
        createdAt: u.createdAt,
        successful_logins_total: u._count.loginLogs,
        days_since_seen: u.lastSeenAt
          ? Math.floor((Date.now() - new Date(u.lastSeenAt).getTime()) / 86400_000)
          : null,
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
