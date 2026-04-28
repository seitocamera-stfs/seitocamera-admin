const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');

/**
 * Middleware d'autenticació JWT
 * Verifica el token i afegeix req.user
 */
async function authenticate(req, res, next) {
  try {
    // Buscar token al header Authorization, cookies, o query param (per iframes/PDFs)
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : req.cookies?.token || req.query?.token;

    if (!token) {
      return res.status(401).json({ error: 'Token d\'autenticació requerit' });
    }

    // Verificar token amb issuer i audience
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'seitocamera-admin',
      audience: 'seitocamera-api',
    });

    // Buscar usuari a la BD
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        color: true,
        customPermissions: true,
        isActive: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Usuari no trobat' });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'Compte desactivat' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirat', code: 'TOKEN_EXPIRED' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token invàlid' });
    }
    next(error);
  }
}

/**
 * Middleware d'autorització per rol.
 * Ús: authorize('ADMIN', 'EDITOR')
 *
 * NOTA: Un usuari amb rol CUSTOM sempre passa aquest middleware perquè
 * els seus permisos reals es validen a requireSection/requireLevel
 * (que coneixen la secció concreta). Si una ruta crida authorize('ADMIN')
 * i l'usuari és CUSTOM, es denega (les accions estrictament admin no
 * haurien de ser delegables via CUSTOM).
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticat' });
    }
    // Si la ruta permet EDITOR o VIEWER, un CUSTOM pot entrar (i la
    // validació real la farà requireSection amb el nivell corresponent).
    const customAllowed = roles.includes('EDITOR') || roles.includes('VIEWER');
    if (req.user.role === 'CUSTOM' && customAllowed) {
      return next();
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'No tens permisos per aquesta acció',
        required: roles,
        current: req.user.role,
      });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
