const express = require('express');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const authService = require('../services/authService');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// Rate limiting estricte per login: 5 intents cada 15 min per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Massa intents de login. Torna-ho a provar en 15 minuts.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Només compta els fallits
});

// Rate limiting per refresh token: 10 per minut
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Massa peticions de refresh. Torna-ho a provar en un minut.' },
});

// ===========================================
// Schemas de validació
// ===========================================

const loginSchema = z.object({
  email: z.string().email('Email invàlid'),
  password: z.string().min(6, 'Mínim 6 caràcters'),
});

const registerSchema = z.object({
  email: z.string().email('Email invàlid'),
  password: z.string().min(8, 'Mínim 8 caràcters'),
  name: z.string().min(2, 'Mínim 2 caràcters'),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Contrasenya actual requerida'),
  newPassword: z.string().min(8, 'Mínim 8 caràcters'),
});

// ===========================================
// Rutes
// ===========================================

/**
 * POST /api/auth/login
 * Login amb email i password
 */
router.post('/login', loginLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { user, accessToken, refreshToken } = await authService.login(req.body);

    // Guardar refresh token com a cookie httpOnly
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dies
    });

    res.json({
      user,
      token: accessToken,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/register
 * Registrar nou usuari (només admins)
 */
router.post(
  '/register',
  authenticate,
  authorize('ADMIN'),
  validate(registerSchema),
  async (req, res, next) => {
    try {
      const { user, accessToken } = await authService.register(req.body);
      res.status(201).json({ user, token: accessToken });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/auth/me
 * Obtenir dades de l'usuari autenticat
 */
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

/**
 * POST /api/auth/refresh
 * Refrescar token d'accés
 */
router.post('/refresh', refreshLimiter, async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken || req.body.refreshToken;
    if (!token) {
      return res.status(401).json({ error: 'Refresh token requerit' });
    }

    const { accessToken, refreshToken } = await authService.refreshToken(token);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({ token: accessToken });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/change-password
 * Canviar contrasenya
 */
router.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  async (req, res, next) => {
    try {
      await authService.changePassword(req.user.id, req.body);
      res.json({ message: 'Contrasenya actualitzada correctament' });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/logout
 * Tancar sessió (eliminar cookie + invalidar refresh tokens)
 */
router.post('/logout', authenticate, async (req, res) => {
  await authService.logout(req.user.id);
  res.clearCookie('refreshToken');
  res.json({ message: 'Sessió tancada' });
});

module.exports = router;
