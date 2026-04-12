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

const app = express();
const PORT = process.env.PORT || 4000;

// ===========================================
// Middleware global
// ===========================================

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

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

// Placeholder per les rutes que crearem als blocs següents
// app.use('/api/auth', require('./routes/auth'));
// app.use('/api/invoices', require('./routes/invoices'));
// app.use('/api/suppliers', require('./routes/suppliers'));
// app.use('/api/clients', require('./routes/clients'));
// app.use('/api/bank', require('./routes/bank'));
// app.use('/api/conciliation', require('./routes/conciliation'));
// app.use('/api/notes', require('./routes/notes'));
// app.use('/api/reminders', require('./routes/reminders'));

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

    app.listen(PORT, () => {
      logger.info(`Servidor escoltant al port ${PORT}`);
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
