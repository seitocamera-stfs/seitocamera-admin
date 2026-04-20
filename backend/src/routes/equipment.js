const express = require('express');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const equipmentService = require('../services/equipmentExtractService');

const router = express.Router();

router.use(authenticate);

// ===========================================
// GET /api/equipment — Llistar equips
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const { search, category, status, supplierId, invoiceId, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (category) where.category = category;
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (invoiceId) where.receivedInvoiceId = invoiceId;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.equipment.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, name: true } },
          receivedInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, issueDate: true, gdriveFileId: true } },
        },
      }),
      prisma.equipment.count({ where }),
    ]);

    res.json({
      data: items,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// GET /api/equipment/stats — Estadístiques
// ===========================================
router.get('/stats', async (req, res, next) => {
  try {
    const [total, byCategory, byStatus, totalValue] = await Promise.all([
      prisma.equipment.count(),
      prisma.equipment.groupBy({
        by: ['category'],
        _count: true,
        orderBy: { _count: { category: 'desc' } },
      }),
      prisma.equipment.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.equipment.aggregate({
        _sum: { purchasePrice: true },
      }),
    ]);

    res.json({
      total,
      totalValue: totalValue._sum.purchasePrice || 0,
      byCategory: byCategory.map((c) => ({ category: c.category || 'other', count: c._count })),
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// GET /api/equipment/:id — Detall equip
// ===========================================
router.get('/:id', async (req, res, next) => {
  try {
    const item = await prisma.equipment.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: { select: { id: true, name: true } },
        receivedInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, issueDate: true, gdriveFileId: true, supplier: { select: { name: true } } } },
      },
    });
    if (!item) return res.status(404).json({ error: 'Equip no trobat' });
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/equipment — Crear equip manualment
// ===========================================
router.post('/', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { name, serialNumber, category, brand, model, purchasePrice, purchaseDate, receivedInvoiceId, supplierId, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'El nom és obligatori' });

    const item = await prisma.equipment.create({
      data: {
        name: name.trim(),
        serialNumber: serialNumber || null,
        category: category || 'other',
        brand: brand || null,
        model: model || null,
        purchasePrice: purchasePrice ? parseFloat(purchasePrice) : null,
        purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
        receivedInvoiceId: receivedInvoiceId || null,
        supplierId: supplierId || null,
        notes: notes || null,
        extractedBy: 'MANUAL',
      },
    });

    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// PUT /api/equipment/:id — Actualitzar equip
// ===========================================
router.put('/:id', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const data = {};
    const b = req.body;
    if (b.name !== undefined) data.name = b.name.trim();
    if (b.serialNumber !== undefined) data.serialNumber = b.serialNumber || null;
    if (b.category !== undefined) data.category = b.category || 'other';
    if (b.brand !== undefined) data.brand = b.brand || null;
    if (b.model !== undefined) data.model = b.model || null;
    if (b.purchasePrice !== undefined) data.purchasePrice = b.purchasePrice ? parseFloat(b.purchasePrice) : null;
    if (b.status !== undefined) data.status = b.status;
    if (b.notes !== undefined) data.notes = b.notes || null;

    const item = await prisma.equipment.update({
      where: { id: req.params.id },
      data,
    });

    res.json(item);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Equip no trobat' });
    next(error);
  }
});

// ===========================================
// DELETE /api/equipment/:id — Eliminar equip
// ===========================================
router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    await prisma.equipment.delete({ where: { id: req.params.id } });
    res.json({ message: 'Equip eliminat' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Equip no trobat' });
    next(error);
  }
});

// ===========================================
// POST /api/equipment/extract/:invoiceId — Extreure equips d'una factura
// ===========================================
router.post('/extract/:invoiceId', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { force } = req.body || {};
    const result = await equipmentService.extractEquipmentFromInvoice(
      req.params.invoiceId,
      { force, manual: true }
    );

    if (result.skipped) {
      return res.json({ message: result.reason === 'already_extracted' ? 'Equips ja extrets. Usa force: true per re-extreure.' : 'No s\'ha pogut extreure (sense text)', ...result });
    }

    res.json({
      message: `${result.items.length} equips extrets correctament`,
      items: result.items,
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/equipment/extract-batch — Processar factures pendents
// ===========================================
router.post('/extract-batch', authorize('ADMIN'), async (req, res, next) => {
  try {
    const results = await equipmentService.processNewInvoices();
    const success = results.filter((r) => !r.error && !r.skipped);
    const totalItems = success.reduce((sum, r) => sum + (r.items?.length || 0), 0);

    res.json({
      message: `${success.length} factures processades, ${totalItems} equips extrets`,
      results,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
