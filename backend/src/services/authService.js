const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { prisma } = require('../config/database');
const { redis } = require('../config/redis');
const { logger } = require('../config/logger');

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '15m';   // 15 minuts (era 7d!)
const REFRESH_TOKEN_EXPIRY = '7d';   // 7 dies (era 30d)
const MAX_FAILED_ATTEMPTS = 10;      // Bloqueig temporal après 10 intents
const LOCKOUT_DURATION = 30 * 60;    // 30 minuts de bloqueig (en segons)

/**
 * Genera un parell de tokens (access + refresh)
 * Access token: curt, conté userId + role
 * Refresh token: llarg, conté userId + jti (per poder invalidar-lo)
 */
function generateTokens(userId, role) {
  const accessToken = jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || ACCESS_TOKEN_EXPIRY,
      issuer: 'seitocamera-admin',
      audience: 'seitocamera-api',
    }
  );

  // JTI (JWT ID) únic per poder invalidar refresh tokens
  const jti = crypto.randomUUID();
  const refreshToken = jwt.sign(
    { userId, type: 'refresh', jti },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || REFRESH_TOKEN_EXPIRY,
      issuer: 'seitocamera-admin',
    }
  );

  return { accessToken, refreshToken, jti };
}

/**
 * Comprova si un usuari està bloquejat per massa intents fallits
 */
async function checkAccountLockout(email) {
  try {
    const key = `login_attempts:${email}`;
    const attempts = await redis.get(key);
    if (attempts && parseInt(attempts) >= MAX_FAILED_ATTEMPTS) {
      const ttl = await redis.ttl(key);
      throw Object.assign(
        new Error(`Compte bloquejat temporalment. Torna-ho a provar en ${Math.ceil(ttl / 60)} minuts.`),
        { status: 429 }
      );
    }
  } catch (error) {
    if (error.status) throw error;
    // Si Redis no està disponible, continuar sense lockout
    logger.warn('Redis no disponible per lockout check');
  }
}

/**
 * Registra un intent fallit de login
 */
async function recordFailedAttempt(email) {
  try {
    const key = `login_attempts:${email}`;
    const attempts = await redis.incr(key);
    if (attempts === 1) {
      await redis.expire(key, LOCKOUT_DURATION);
    }
    logger.warn(`Intent de login fallit per: ${email} (intent ${attempts})`);
  } catch (error) {
    logger.warn('Redis no disponible per registrar intent fallit');
  }
}

/**
 * Neteja els intents fallits després d'un login correcte
 */
async function clearFailedAttempts(email) {
  try {
    await redis.del(`login_attempts:${email}`);
  } catch (error) {
    // No crític
  }
}

/**
 * Registrar un nou usuari
 */
async function register({ email, password, name, role }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw Object.assign(new Error('Ja existeix un usuari amb aquest email'), { status: 409 });
  }

  // Validar complexitat de contrasenya
  validatePasswordStrength(password);

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase().trim(),
      passwordHash,
      name: name.trim(),
      role: role || 'VIEWER',
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  const { accessToken, refreshToken } = generateTokens(user.id, user.role);

  logger.info(`Nou usuari registrat: ${email} (${user.role})`);

  return { user, accessToken, refreshToken };
}

/**
 * Login amb email i password
 */
async function login({ email, password }) {
  const normalizedEmail = email.toLowerCase().trim();

  // Comprovar bloqueig per intents fallits
  await checkAccountLockout(normalizedEmail);

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      passwordHash: true,
      isActive: true,
    },
  });

  // Missatge genèric per no revelar si l'email existeix
  if (!user) {
    await recordFailedAttempt(normalizedEmail);
    throw Object.assign(new Error('Credencials incorrectes'), { status: 401 });
  }

  if (!user.isActive) {
    throw Object.assign(new Error('Compte desactivat. Contacta amb l\'administrador.'), { status: 403 });
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    await recordFailedAttempt(normalizedEmail);
    throw Object.assign(new Error('Credencials incorrectes'), { status: 401 });
  }

  // Login correcte → neteja intents
  await clearFailedAttempts(normalizedEmail);

  // Actualitzar últim login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const { accessToken, refreshToken, jti } = generateTokens(user.id, user.role);

  // Guardar JTI del refresh token a Redis per poder-lo invalidar
  try {
    await redis.set(
      `refresh_token:${user.id}:${jti}`,
      '1',
      'EX',
      7 * 24 * 60 * 60 // 7 dies
    );
  } catch (error) {
    logger.warn('Redis no disponible per guardar refresh token JTI');
  }

  const { passwordHash, ...userWithoutPassword } = user;

  logger.info(`Login correcte: ${normalizedEmail}`);

  return { user: userWithoutPassword, accessToken, refreshToken };
}

/**
 * Refrescar el token d'accés amb rotation
 * Cada cop que es fa refresh, el token antic s'invalida
 */
async function refreshToken(token) {
  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { issuer: 'seitocamera-admin' }
    );

    if (decoded.type !== 'refresh') {
      throw Object.assign(new Error('Token invàlid'), { status: 401 });
    }

    // Comprovar que el JTI no ha estat invalidat
    if (decoded.jti) {
      try {
        const valid = await redis.get(`refresh_token:${decoded.userId}:${decoded.jti}`);
        if (!valid) {
          logger.warn(`Refresh token reusat (possible robatori): userId ${decoded.userId}`);
          // Invalidar TOTS els refresh tokens d'aquest usuari per seguretat
          const keys = await redis.keys(`refresh_token:${decoded.userId}:*`);
          if (keys.length > 0) {
            await redis.del(...keys);
          }
          throw Object.assign(new Error('Token de refresc invalidat. Torna a iniciar sessió.'), { status: 401 });
        }
        // Invalidar el token antic (rotation)
        await redis.del(`refresh_token:${decoded.userId}:${decoded.jti}`);
      } catch (error) {
        if (error.status) throw error;
        // Si Redis falla, continuar (degradació graciosa)
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw Object.assign(new Error('Usuari no trobat o desactivat'), { status: 401 });
    }

    const tokens = generateTokens(user.id, user.role);

    // Guardar nou JTI
    try {
      await redis.set(
        `refresh_token:${user.id}:${tokens.jti}`,
        '1',
        'EX',
        7 * 24 * 60 * 60
      );
    } catch (error) {
      // No crític
    }

    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('Token de refresc invàlid o expirat'), { status: 401 });
  }
}

/**
 * Canviar contrasenya
 */
async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!validPassword) {
    throw Object.assign(new Error('Contrasenya actual incorrecta'), { status: 400 });
  }

  validatePasswordStrength(newPassword);

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  // Invalidar tots els refresh tokens d'aquest usuari
  try {
    const keys = await redis.keys(`refresh_token:${userId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    logger.warn('Redis no disponible per invalidar tokens');
  }

  logger.info(`Contrasenya canviada per userId: ${userId}`);
}

/**
 * Logout: invalidar el refresh token actual
 */
async function logout(userId) {
  try {
    // Invalidar tots els refresh tokens de l'usuari
    const keys = await redis.keys(`refresh_token:${userId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    // No crític
  }
}

/**
 * Validar la fortalesa de la contrasenya
 */
function validatePasswordStrength(password) {
  if (password.length < 8) {
    throw Object.assign(new Error('La contrasenya ha de tenir mínim 8 caràcters'), { status: 400 });
  }
  if (!/[A-Z]/.test(password)) {
    throw Object.assign(new Error('La contrasenya ha de contenir almenys una majúscula'), { status: 400 });
  }
  if (!/[a-z]/.test(password)) {
    throw Object.assign(new Error('La contrasenya ha de contenir almenys una minúscula'), { status: 400 });
  }
  if (!/[0-9]/.test(password)) {
    throw Object.assign(new Error('La contrasenya ha de contenir almenys un número'), { status: 400 });
  }
}

module.exports = {
  register,
  login,
  refreshToken,
  changePassword,
  logout,
};
