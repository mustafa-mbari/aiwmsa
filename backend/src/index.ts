import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import 'express-async-errors';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/auth.routes';
// import userRoutes from './routes/user.routes';
// import documentRoutes from './routes/document.routes';
// import queryRoutes from './routes/query.routes';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { requestLogger } from './middleware/requestLogger';

// Import configurations
import { redisClient } from './config/redis';
import { prisma } from './config/database';

// Create Express app
const app: Application = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Middleware Setup
 */
// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: NODE_ENV === 'production',
}));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Compression middleware
app.use(compression());

// Logging middleware
if (NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Custom request logger
app.use(requestLogger);

/**
 * Health Check Endpoints
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
  });
});

app.get('/api/health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    
    // Check Redis connection
    const redisStatus = redisClient.getStatus();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: redisStatus ? 'connected' : 'disconnected',
      },
      version: process.env.npm_package_version || '1.0.0',
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Service unavailable',
    });
  }
});

/**
 * API Routes
 */
app.use('/api/auth', authRoutes);
// app.use('/api/users', userRoutes);
// app.use('/api/documents', documentRoutes);
// app.use('/api/queries', queryRoutes);

/**
 * Static files (if needed)
 */
// app.use('/uploads', express.static('uploads'));

/**
 * Error Handling
 */
app.use(notFound);
app.use(errorHandler);

/**
 * Graceful Shutdown
 */
const gracefulShutdown = async (signal: string) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  // Close database connections
  await prisma.$disconnect();
  console.log('Database connection closed.');
  
  // Close Redis connection
  await redisClient.disconnect();
  console.log('Redis connection closed.');
  
  // Close server
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * Start Server
 */
const server = app.listen(PORT, () => {
  console.log(`
🚀 Server is running!
📍 Environment: ${NODE_ENV}
🔗 URL: http://localhost:${PORT}
📚 API Docs: http://localhost:${PORT}/api-docs
🎯 Health Check: http://localhost:${PORT}/health
⏰ Started at: ${new Date().toISOString()}
  `);
});