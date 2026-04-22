const express = require('express');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { requireSection, requireLevel } = require('../middleware/sectionAccess');
const equipmentService = require('../services/equipmentExtractService');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('equipment'));

// ===========================================
// GET /api/equipment — Llistar equips
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const { search, category, status, supplierId, invoiceId, sortBy, sortOrder = 'asc', page = 1, limit = 50 } = req.query;
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

    // Per defecte, només mostrar items arrel (sense pare), tret que busquem
    if (!search && !req.query.includeChildren) {
      where.parentId = null;
    }

    // Ordenació
    const dir = sortOrder === 'desc' ? 'desc' : 'asc';
    const orderByMap = {
      name: { name: dir },
      category: { category: dir },
      supplier: { supplier: { name: dir } },
      invoice: { receivedInvoice: { invoiceNumber: dir } },
      price: { purchasePrice: dir },
      status: { status: dir },
      date: { purchaseDate: dir },
    };
    const orderBy = orderByMap[sortBy] || { createdAt: 'desc' };

    const [items, total] = await Promise.all([
      prisma.equipment.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy,
        include: {
          supplier: { select: { id: true, name: true } },
          receivedInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, issueDate: true, gdriveFileId: true } },
          parent: { select: { id: true, name: true } },
          children: {
            orderBy: { name: 'asc' },
            include: {
              supplier: { select: { id: true, name: true } },
              receivedInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, issueDate: true, gdriveFileId: true } },
            },
          },
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
// ACCIONS MASSIVES (ha d'anar ABANS de /:id)
// ===========================================

/**
 * PATCH /api/equipment/bulk-update — Actualitzar categoria/estat de múltiples equips
 */
router.patch('/bulk-update', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { ids, category, status } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Cal enviar un array d\'IDs' });
    }

    const data = {};
    if (category !== undefined) data.category = category;
    if (status !== undefined) data.status = status;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Cal especificar category o status' });
    }

    const result = await prisma.equipment.updateMany({
      where: { id: { in: ids } },
      data,
    });

    res.json({ message: `${result.count} equips actualitzats`, count: result.count });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/equipment/group — Crear grup: primer ID = pare, resta = fills
 */
router.post('/group', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { parentId, childIds } = req.body;

    if (!parentId || !Array.isArray(childIds) || childIds.length === 0) {
      return res.status(400).json({ error: 'Cal un parentId i un array de childIds' });
    }

    // Verificar que el pare existeix i no és fill d'un altre
    const parent = await prisma.equipment.findUnique({ where: { id: parentId } });
    if (!parent) return res.status(404).json({ error: 'Equip pare no trobat' });
    if (parent.parentId) return res.status(400).json({ error: 'L\'equip pare ja és fill d\'un altre grup' });

    // Assignar parentId als fills
    const result = await prisma.equipment.updateMany({
      where: { id: { in: childIds.filter(id => id !== parentId) } },
      data: { parentId },
    });

    res.json({ message: `${result.count} equips afegits al grup de "${parent.name}"`, count: result.count });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/equipment/auto-group — Agrupar retroactivament equips per factura
 * Equips de la mateixa factura sense parentId → el més car és pare, resta fills
 */
router.post('/auto-group', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    // Trobar factures amb >1 equip no agrupat
    const invoices = await prisma.receivedInvoice.findMany({
      where: {
        equipment: {
          some: { parentId: null },
        },
      },
      select: { id: true, invoiceNumber: true },
    });

    let grouped = 0;
    let groupCount = 0;

    for (const inv of invoices) {
      const items = await prisma.equipment.findMany({
        where: { receivedInvoiceId: inv.id, parentId: null },
        orderBy: { purchasePrice: 'desc' },
      });

      if (items.length < 2) continue;

      const parentId = items[0].id;
      const childIds = items.slice(1).map((c) => c.id);

      await prisma.equipment.updateMany({
        where: { id: { in: childIds } },
        data: { parentId },
      });

      grouped += childIds.length;
      groupCount++;
    }

    res.json({
      message: `${groupCount} grups creats, ${grouped} equips agrupats`,
      groupCount,
      grouped,
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

/**
 * PATCH /api/equipment/:id/ungroup — Treure un item del grup (posar parentId a null)
 */
router.patch('/:id/ungroup', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const updated = await prisma.equipment.update({
      where: { id: req.params.id },
      data: { parentId: null },
    });
    res.json(updated);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Equip no trobat' });
    next(error);
  }
});

/**
 * PATCH /api/equipment/:id/disband — Desfer grup sencer (alliberar tots els fills)
 */
router.patch('/:id/disband', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const result = await prisma.equipment.updateMany({
      where: { parentId: req.params.id },
      data: { parentId: null },
    });
    res.json({ message: `Grup desfet, ${result.count} items alliberats`, count: result.count });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/equipment/:id/make-parent — Convertir un fill en el nou pare del grup
 * L'antic pare passa a ser fill, i tots els fills apunten al nou pare
 */
router.patch('/:id/make-parent', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const item = await prisma.equipment.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Equip no trobat' });

    const oldParentId = item.parentId;
    if (!oldParentId) return res.status(400).json({ error: 'Aquest equip ja és el principal del grup' });

    // 1. Tots els fills de l'antic pare → apunten al nou pare
    await prisma.equipment.updateMany({
      where: { parentId: oldParentId },
      data: { parentId: req.params.id },
    });

    // 2. L'antic pare → passa a ser fill del nou pare
    await prisma.equipment.update({
      where: { id: oldParentId },
      data: { parentId: req.params.id },
    });

    // 3. El nou pare → parentId = null
    await prisma.equipment.update({
      where: { id: req.params.id },
      data: { parentId: null },
    });

    res.json({ message: `"${item.name}" ara és el principal del grup` });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
