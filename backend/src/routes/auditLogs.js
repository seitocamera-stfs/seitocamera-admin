const express = require('express');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('audit'));

// ===========================================
// GET /api/audit-logs — Llistar amb filtres
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const {
      entityType,
      entityId,
      userId,
      action,
      from,
      to,
      page = '1',
      pageSize = '50',
    } = req.query;

    const where = {};
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const take = Math.min(parseInt(pageSize, 10) || 50, 200);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ items, total, page: parseInt(page, 10), pageSize: take });
  } catch (err) {
    next(err);
  }
});

// ===========================================
// GET /api/audit-logs/:id — Detall d'una entrada
// ===========================================
router.get('/:id', async (req, res, next) => {
  try {
    const log = await prisma.auditLog.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!log) return res.status(404).json({ error: 'Log no trobat' });
    res.json(log);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
