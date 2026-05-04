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

// Desactivar ETag per evitar cache 304 en respostes API
app.set('etag', false);

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

// Trust proxy (nginx davant) — necessari perquè express-rate-limit identifiqui IPs correctament
app.set('trust proxy', 1);

// Rate limiting global (relaxat — endpoints sensibles com login tenen el seu propi limiter)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuts
  max: 1000,
  message: { error: 'Massa peticions. Torna-ho a provar en 15 minuts.' },
  standardHeaders: true,
  legacyHeaders: false,
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
app.use('/api/config', require('./routes/config'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/bank-accounts', require('./routes/bankAccounts'));
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
app.use('/api/fiscal', require('./routes/fiscal'));
app.use('/api/shared-invoices', require('./routes/sharedInvoices'));
app.use('/api/ai-costs', require('./routes/aiCosts'));
app.use('/api/connections', require('./routes/connections'));
app.use('/api/operations', require('./routes/operations'));
app.use('/api/shelly', require('./routes/shelly'));
app.use('/api/push', require('./routes/push'));
app.use('/api/logistics', require('./routes/logistics'));
app.use('/api/team', require('./routes/team'));

// Mòdul Comptabilitat formal (Sprint 1)
app.use('/api/companies', require('./routes/companies'));
app.use('/api/fiscal-years', require('./routes/fiscalYears'));
app.use('/api/chart-of-accounts', require('./routes/chartOfAccounts'));
app.use('/api/audit-logs', require('./routes/auditLogs'));

// Llibre Diari + Major (Sprint 2)
app.use('/api/journal', require('./routes/journal'));
app.use('/api/ledger', require('./routes/ledger'));

// Comptabilització de factures (Sprint 3)
app.use('/api/invoice-posting', require('./routes/invoicePosting'));

// Ruta pública per al conductor (sense autenticació, accés per token)
app.get('/api/logistics/public/:token', async (req, res) => {
  try {
    const transport = await prisma.transport.findUnique({
      where: { publicToken: req.params.token },
      include: {
        conductor: { select: { nom: true, telefon: true } },
        empresa: { select: { nom: true } },
      },
    });
    if (!transport) return res.status(404).json({ error: 'Ruta no trobada' });
    // Retornar només camps necessaris pel conductor (no exposar dades internes)
    res.json({
      id: transport.id,
      projecte: transport.projecte,
      tipusServei: transport.tipusServei,
      origen: transport.origen,
      notesOrigen: transport.notesOrigen,
      desti: transport.desti,
      notesDesti: transport.notesDesti,
      dataCarrega: transport.dataCarrega,
      dataEntrega: transport.dataEntrega,
      horaRecollida: transport.horaRecollida,
      horaEntregaEstimada: transport.horaEntregaEstimada,
      horaFiPrevista: transport.horaFiPrevista,
      horaIniciReal: transport.horaIniciReal,
      horaFiReal: transport.horaFiReal,
      minutsExtres: transport.minutsExtres,
      responsableProduccio: transport.responsableProduccio,
      telefonResponsable: transport.telefonResponsable,
      conductor: transport.conductor,
      empresa: transport.empresa,
      estat: transport.estat,
      motiuCancellacio: transport.motiuCancellacio,
      notes: transport.notes,
    });
  } catch (err) {
    logger.error('Error ruta pública conductor:', err.message);
    res.status(500).json({ error: 'Error intern' });
  }
});

// POST /api/logistics/public/:token/start — Conductor marca inici ruta (públic)
app.post('/api/logistics/public/:token/start', async (req, res) => {
  try {
    const transport = await prisma.transport.findUnique({ where: { publicToken: req.params.token } });
    if (!transport) return res.status(404).json({ error: 'Ruta no trobada' });
    if (transport.estat === 'Cancel·lat') return res.status(400).json({ error: 'Ruta cancel·lada' });
    if (transport.horaIniciReal) return res.status(400).json({ error: 'Ruta ja iniciada' });

    const { hora } = req.body;
    const historial = [...(transport.historial || []), { timestamp: new Date().toISOString(), accio: 'inici_ruta', detall: `Ruta iniciada pel conductor a les ${hora}` }];
    const updated = await prisma.transport.update({
      where: { id: transport.id },
      data: { horaIniciReal: hora, estat: 'En Preparació', historial },
    });
    res.json({ ok: true, estat: updated.estat, horaIniciReal: updated.horaIniciReal });
  } catch (err) {
    logger.error('Error inici ruta pública:', err.message);
    res.status(500).json({ error: 'Error intern' });
  }
});

// POST /api/logistics/public/:token/end — Conductor marca fi ruta (públic)
app.post('/api/logistics/public/:token/end', async (req, res) => {
  try {
    const transport = await prisma.transport.findUnique({ where: { publicToken: req.params.token } });
    if (!transport) return res.status(404).json({ error: 'Ruta no trobada' });
    if (transport.estat === 'Cancel·lat') return res.status(400).json({ error: 'Ruta cancel·lada' });
    if (!transport.horaIniciReal) return res.status(400).json({ error: 'Ruta no iniciada' });
    if (transport.horaFiReal) return res.status(400).json({ error: 'Ruta ja finalitzada' });

    const { hora } = req.body;
    // Calcular hores extres
    const toMin = (hm) => { if (!hm) return null; const m = hm.match(/^(\d{1,2}):(\d{2})$/); return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null; };
    const prev = toMin(transport.horaFiPrevista);
    const real = toMin(hora);
    let minutsExtres = null;
    if (prev != null && real != null) {
      minutsExtres = real - prev;
      if (minutsExtres < -12 * 60) minutsExtres += 24 * 60;
    }

    let historial = [...(transport.historial || []),
      { timestamp: new Date().toISOString(), accio: 'tancament', detall: `Hora final: ${hora} (previst ${transport.horaFiPrevista || '—'})` },
      { timestamp: new Date().toISOString(), accio: 'canvi_estat', detall: `${transport.estat} → Lliurat` },
    ];
    const updated = await prisma.transport.update({
      where: { id: transport.id },
      data: { horaFiReal: hora, minutsExtres, estat: 'Lliurat', historial },
    });
    res.json({ ok: true, estat: updated.estat, horaFiReal: updated.horaFiReal, minutsExtres: updated.minutsExtres });
  } catch (err) {
    logger.error('Error fi ruta pública:', err.message);
    res.status(500).json({ error: 'Error intern' });
  }
});

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
    const { startShellySyncJob } = require('./jobs/shellySyncJob');
    startShellySyncJob();
    const { startQontoDropzoneJob } = require('./jobs/qontoDropzoneJob');
    startQontoDropzoneJob();
    // accountingReviewJob desactivat — agentJobsService ja fa classify + anomalies
    // const { startAccountingReviewJob } = require('./jobs/accountingReviewJob');
    // startAccountingReviewJob();
    const { initJobs } = require('./services/agentJobsService');
    initJobs();

    const server = app.listen(PORT, () => {
      logger.info(`Servidor escoltant al port ${PORT}`);
    });
    global.__server = server;

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} ja està ocupat. Tancant — Docker reiniciarà el contenidor.`);
        process.exit(1);
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
async function gracefulShutdown(signal) {
  logger.info(`${signal} rebut. Tancant...`);
  try {
    // Tancar servidor HTTP (no acceptar noves connexions)
    if (global.__server) {
      global.__server.close();
    }
    await prisma.$disconnect();
    redis.disconnect();
  } catch (err) {
    logger.error('Error durant shutdown:', err.message);
  }
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();

module.exports = app;
