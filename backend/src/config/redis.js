const Redis = require('ioredis');
const { logger } = require('./logger');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('connect', () => logger.info('Connectat a Redis'));
redis.on('error', (err) => logger.error('Error Redis:', err.message));

module.exports = { redis };
