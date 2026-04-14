const express = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// Totes les rutes requereixen ADMIN
router.use(authenticate);
router.use(authorize('ADMIN'));

// ===========================================
// Schemas
// ===========================================

const createUserSchema = z.object({
  email: z.string().email('Email invàlid'),
  password: z.string().min(8, 'Mínim 8 caràcters'),
  name: z.string().min(2, 'Mínim 2 caràcters'),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']).optional(),
  isActive: z.boolean().optional(),
});

// ===========================================
// GET /api/users — Llistar usuaris
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json(users);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/users — Crear usuari
// ===========================================
router.post('/', validate(createUserSchema), async (req, res, next) => {
  try {
    const { email, password, name, role } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Ja existeix un usuari amb aquest email' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { email, passwordHash, name, role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// PUT /api/users/:id — Actualitzar usuari
// ===========================================
router.put('/:id', validate(updateUserSchema), async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: req.body,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });

    res.json(user);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Usuari no trobat' });
    }
    next(error);
  }
});

// ===========================================
// POST /api/users/:id/reset-password — Resetejar contrasenya
// ===========================================
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'La contrasenya ha de tenir mínim 8 caràcters' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: req.params.id },
      data: { passwordHash },
    });

    res.json({ message: 'Contrasenya actualitzada' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Usuari no trobat' });
    }
    next(error);
  }
});

// ===========================================
// DELETE /api/users/:id — Desactivar usuari
// ===========================================
router.delete('/:id', async (req, res, next) => {
  try {
    // No permetre eliminar-se a un mateix
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'No pots desactivar el teu propi compte' });
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });

    res.json({ message: 'Usuari desactivat' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Usuari no trobat' });
    }
    next(error);
  }
});

module.exports = router;
