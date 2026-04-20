require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { logger } = require('./config/logger');
const { prisma } = require('./config/database');
const { redis } = require('./config/redis');

// ===========================================
// Validació de variables d'entorn crítiques
// ===========================================
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`\n❌ VARIABLES D'ENTORN OBLIGATÒRIES NO CONFIGURADES:\n   ${missing.join(', ')}\n\n   Revisa el fitxer .env (veure .env.example)\n`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 4000;

// ===========================================
// Middleware global
// ===========================================

// Headers de seguretat estrictes
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// CORS estricte: només el frontend autoritzat
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',');
app.use(cors({
  origin: (origin, callback) => {
    // Permetre peticions sense origin (healthcheck intern, nginx reverse proxy)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS no permès'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600, // Cache preflight 10 min
}));

// Limitar mida del body per prevenir DoS
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// Logging (no loguejar en test)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
}

// Desactivar header X-Powered-By (helmet ja ho fa, però per si de cas)
app.disable('x-powered-by');

// Rate limiting global
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuts
  max: 100,
  message: { error: 'Massa peticions. Torna-ho a provar en 15 minuts.' },
});
app.use('/api/', limiter);

// ===========================================
// Rutes
// ===========================================

app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redisStatus = redis.status === 'ready' ? 'ok' : 'disconnected';
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: 'ok',
        redis: redisStatus,
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

// Rutes actives
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/bank', require('./routes/bank'));
app.use('/api/conciliation', require('./routes/conciliation'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/reminders', require('./routes/reminders'));
app.use('/api/users', require('./routes/users'));
app.use('/api/gdrive', require('./routes/gdrive'));
app.use('/api/rentman', require('./routes/rentman'));
app.use('/api/zoho', require('./routes/zoho'));
app.use('/api/export', require('./routes/export'));
app.use('/api/agent', require('./routes/agent'));
app.use('/api/equipment', require('./routes/equipment'));
app.use('/api/ai-costs', require('./routes/aiCosts'));

// ===========================================
// Gestió d'errors
// ===========================================

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no trobada' });
});

// Error handler global
app.use((err, req, res, next) => {
  logger.error(`${err.status || 500} - ${err.message} - ${req.originalUrl}`);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Error intern del servidor'
      : err.message,
  });
});

// ===========================================
// Iniciar servidor
// ===========================================

async function start() {
  try {
    await prisma.$connect();
    logger.info('Connectat a PostgreSQL');

    // Iniciar cron jobs
    const { startZohoEmailSync } = require('./jobs/zohoEmailSync');
    const { startGdriveSyncJob } = require('./jobs/gdriveSyncJob');
    const { startRentmanSyncJob } = require('./jobs/rentmanSyncJob');
    const { startQontoBankSyncJob } = require('./jobs/qontoBankSyncJob');
    startZohoEmailSync();
    startGdriveSyncJob();
    startRentmanSyncJob();
    startQontoBankSyncJob();
    const { startAccountingReviewJob } = require('./jobs/accountingReviewJob');
    startAccountingReviewJob();

    const server = app.listen(PORT, () => {
      logger.info(`Servidor escoltant al port ${PORT}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(`Port ${PORT} ocupat, matant procés anterior...`);
        const { execSync } = require('child_process');
        try {
          execSync(`lsof -ti :${PORT} | xargs kill -9`, { stdio: 'ignore' });
        } catch {}
        setTimeout(() => {
          server.listen(PORT, () => {
            logger.info(`Servidor escoltant al port ${PORT} (retry)`);
          });
        }, 1000);
      } else {
        throw err;
      }
    });
  } catch (error) {
    logger.error('Error iniciant el servidor:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM rebut. Tancant...');
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
});

start();

module.exports = app;
