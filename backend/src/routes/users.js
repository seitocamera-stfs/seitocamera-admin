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

// Nivells vàlids de permís per secció
const levelEnum = z.enum(['read', 'write', 'admin']);

// Seccions que es poden assignar a un rol CUSTOM (users queda exclosa)
const SECTION_KEYS = [
  'dashboard', 'receivedInvoices', 'issuedInvoices', 'sharedInvoices',
  'suppliers', 'clients', 'bank', 'conciliation', 'reminders',
  'equipment', 'agent',
];

const customPermissionsSchema = z.record(z.string(), levelEnum)
  .refine(
    (obj) => Object.keys(obj).every((k) => SECTION_KEYS.includes(k)),
    { message: 'Conté una secció desconeguda' },
  )
  .optional()
  .nullable();

const createUserSchema = z.object({
  email: z.string().email('Email invàlid'),
  password: z.string().min(8, 'Mínim 8 caràcters'),
  name: z.string().min(2, 'Mínim 2 caràcters'),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER', 'CUSTOM']),
  customPermissions: customPermissionsSchema,
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER', 'CUSTOM']).optional(),
  customPermissions: customPermissionsSchema,
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
        customPermissions: true,
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
    const { email, password, name, role, customPermissions } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Ja existeix un usuari amb aquest email' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Només guardem customPermissions si el rol és CUSTOM
    const permsToStore = role === 'CUSTOM' ? (customPermissions || {}) : null;

    const user = await prisma.user.create({
      data: { email, passwordHash, name, role, customPermissions: permsToStore },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        customPermissions: true,
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
    const data = { ...req.body };

    // Lògica de coherència entre role i customPermissions:
    //  - Si el rol passa a no-CUSTOM, netegem customPermissions
    //  - Si es passa a CUSTOM, s'accepten els permisos (o {} per defecte)
    if ('role' in data && data.role !== 'CUSTOM') {
      data.customPermissions = null;
    } else if (data.role === 'CUSTOM' && data.customPermissions === undefined) {
      data.customPermissions = {};
    } else if ('customPermissions' in data && data.customPermissions === null) {
      // mantenim el valor nul explícitament
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        customPermissions: true,
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
