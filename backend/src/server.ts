// C:\Dev\Git\AIwmsa\backend\src\server.ts
import { createServer } from 'http';
import app from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { PrismaClient } from '@prisma/client';
import { redisClient } from './utils/redis';

// Initialize Prisma
const prisma = new PrismaClient({
  log: config.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Create HTTP server
const server = createServer(app);

// Start server
async function startServer() {
  try {
    // Connect to database
    await prisma.$connect();
    logger.info('✅ Database connected successfully');

    // Connect to Redis
    await redisClient.connect();
    logger.info('✅ Redis connected successfully');

    // Start listening
    server.listen(config.PORT, () => {
      logger.info(`
        ################################################
        🚀 Server listening on port: ${config.PORT}
        🌍 Environment: ${config.NODE_ENV}
        📝 API Documentation: http://localhost:${config.PORT}/api/v1/docs
        ################################################
      `);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle shutdown gracefully
async function shutdown() {
  logger.info('Shutting down server...');
  
  server.close(() => {
    logger.info('HTTP server closed');
  });

  await prisma.$disconnect();
  logger.info('Database disconnected');

  await redisClient.quit();
  logger.info('Redis disconnected');

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown();
});

// Start the server
startServer();