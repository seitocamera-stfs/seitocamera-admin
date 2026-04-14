const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');

/**
 * Middleware d'autenticació JWT
 * Verifica el token i afegeix req.user
 */
async function authenticate(req, res, next) {
  try {
    // Buscar token al header Authorization o a les cookies
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : req.cookies?.token;

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
 * Middleware d'autorització per rol
 * Ús: authorize('ADMIN', 'EDITOR')
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticat' });
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
