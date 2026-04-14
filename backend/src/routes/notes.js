const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

router.use(authenticate);

// ===========================================
// Schemas
// ===========================================

const noteSchema = z.object({
  content: z.string().min(1, 'Contingut requerit'),
  entityType: z.enum(['received_invoice', 'issued_invoice', 'bank_movement', 'supplier', 'client', 'conciliation']),
  entityId: z.string().min(1, 'ID de l\'entitat requerit'),
  isPinned: z.boolean().default(false),
  isInternal: z.boolean().default(false),
});

// ===========================================
// GET /api/notes — Llistar notes per entitat
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const { entityType, entityId } = req.query;

    if (!entityType || !entityId) {
      return res.status(400).json({ error: 'entityType i entityId són requerits' });
    }

    const notes = await prisma.note.findMany({
      where: { entityType, entityId },
      orderBy: [
        { isPinned: 'desc' },
        { createdAt: 'desc' },
      ],
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });

    res.json(notes);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/notes — Crear nota
// ===========================================
router.post('/', validate(noteSchema), async (req, res, next) => {
  try {
    const note = await prisma.note.create({
      data: {
        ...req.body,
        authorId: req.user.id,
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });

    res.status(201).json(note);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// PUT /api/notes/:id — Editar nota (només l'autor)
// ===========================================
router.put('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.note.findUnique({ where: { id: req.params.id } });

    if (!existing) {
      return res.status(404).json({ error: 'Nota no trobada' });
    }

    if (existing.authorId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Només pots editar les teves pròpies notes' });
    }

    const note = await prisma.note.update({
      where: { id: req.params.id },
      data: {
        content: req.body.content,
        isPinned: req.body.isPinned,
        isInternal: req.body.isInternal,
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });

    res.json(note);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// DELETE /api/notes/:id — Eliminar nota
// ===========================================
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.note.findUnique({ where: { id: req.params.id } });

    if (!existing) {
      return res.status(404).json({ error: 'Nota no trobada' });
    }

    if (existing.authorId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Només pots eliminar les teves pròpies notes' });
    }

    await prisma.note.delete({ where: { id: req.params.id } });

    res.json({ message: 'Nota eliminada' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
