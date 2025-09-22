// C:\Dev\Git\AIwmsa\backend\src\routes\warehouses.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient, UserRole } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const createWarehouseSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    code: z.string().min(2).max(10),
    location: z.string().optional(),
    description: z.string().optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().optional(),
    manager: z.string().optional(),
    operatingHours: z.string().optional(),
    timezone: z.string().default('UTC'),
    metadata: z.record(z.any()).optional(),
  }),
});

const updateWarehouseSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    location: z.string().optional(),
    description: z.string().optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().optional(),
    manager: z.string().optional(),
    operatingHours: z.string().optional(),
    timezone: z.string().optional(),
    isActive: z.boolean().optional(),
    metadata: z.record(z.any()).optional(),
  }),
  params: z.object({
    id: z.string().uuid(),
  }),
});

const getWarehousesQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).default('1').transform(Number),
    limit: z.string().regex(/^\d+$/).default('10').transform(Number),
    isActive: z.string().transform(val => val === 'true').optional(),
    search: z.string().optional(),
  }),
});

// Get all warehouses
router.get(
  '/',
  authenticate,
  validateRequest(getWarehousesQuerySchema),
  async (req, res, next) => {
    try {
      const { page, limit, isActive, search } = req.query as any;
      const skip = (page - 1) * limit;

      // Build where clause
      const where: any = {};
      if (isActive !== undefined) where.isActive = isActive;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          { location: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Get warehouses with pagination
      const [warehouses, total] = await Promise.all([
        prisma.warehouse.findMany({
          where,
          skip,
          take: limit,
          include: {
            _count: {
              select: {
                users: true,
                documents: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.warehouse.count({ where }),
      ]);

      res.json({
        success: true,
        data: warehouses,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get single warehouse
router.get(
  '/:id',
  authenticate,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const warehouse = await prisma.warehouse.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              users: true,
              documents: true,
            },
          },
          users: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              isActive: true,
            },
            take: 10,
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!warehouse) {
        throw new AppError('Warehouse not found', 404);
      }

      res.json({
        success: true,
        data: warehouse,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Create new warehouse (Admin only)
router.post(
  '/',
  authenticate,
  authorize([UserRole.ADMIN]),
  validateRequest(createWarehouseSchema),
  async (req, res, next) => {
    try {
      const data = req.body;

      // Check if code already exists
      const existingWarehouse = await prisma.warehouse.findUnique({
        where: { code: data.code },
      });

      if (existingWarehouse) {
        throw new AppError('Warehouse code already exists', 400);
      }

      // Create warehouse
      const warehouse = await prisma.warehouse.create({
        data,
      });

      logger.info(`New warehouse created: ${warehouse.name} by ${req.user!.email}`);

      res.status(201).json({
        success: true,
        data: warehouse,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Update warehouse
router.patch(
  '/:id',
  authenticate,
  authorize([UserRole.ADMIN]),
  validateRequest(updateWarehouseSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const warehouse = await prisma.warehouse.update({
        where: { id },
        data: updates,
      });

      logger.info(`Warehouse updated: ${warehouse.name} by ${req.user!.email}`);

      res.json({
        success: true,
        data: warehouse,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Delete warehouse (Admin only)
router.delete(
  '/:id',
  authenticate,
  authorize([UserRole.ADMIN]),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Check if warehouse has users or documents
      const [userCount, documentCount] = await Promise.all([
        prisma.user.count({ where: { warehouseId: id } }),
        prisma.document.count({ where: { warehouseId: id } }),
      ]);

      if (userCount > 0) {
        throw new AppError('Cannot delete warehouse with active users', 400);
      }

      if (documentCount > 0) {
        throw new AppError('Cannot delete warehouse with documents', 400);
      }

      // Soft delete by setting isActive to false
      await prisma.warehouse.update({
        where: { id },
        data: { isActive: false },
      });

      logger.info(`Warehouse deactivated: ${id} by ${req.user!.email}`);

      res.json({
        success: true,
        message: 'Warehouse deactivated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get warehouse statistics
router.get(
  '/:id/stats',
  authenticate,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const [
        userStats,
        documentStats,
        queryStats,
        feedbackStats,
      ] = await Promise.all([
        // User statistics
        prisma.user.groupBy({
          by: ['role'],
          where: { warehouseId: id },
          _count: { role: true },
        }),
        // Document statistics
        prisma.document.groupBy({
          by: ['type'],
          where: { warehouseId: id },
          _count: { type: true },
        }),
        // Query statistics (last 30 days)
        prisma.queryLog.aggregate({
          where: {
            userId: {
              in: await prisma.user.findMany({
                where: { warehouseId: id },
                select: { id: true },
              }).then(users => users.map(u => u.id)),
            },
            createdAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          },
          _count: true,
          _avg: { responseTime: true },
        }),
        // Feedback statistics
        prisma.feedback.aggregate({
          where: {
            queryLog: {
              userId: {
                in: await prisma.user.findMany({
                  where: { warehouseId: id },
                  select: { id: true },
                }).then(users => users.map(u => u.id)),
              },
            },
          },
          _avg: { rating: true },
          _count: true,
        }),
      ]);

      res.json({
        success: true,
        data: {
          users: {
            byRole: userStats.map(stat => ({
              role: stat.role,
              count: stat._count.role,
            })),
          },
          documents: {
            byType: documentStats.map(stat => ({
              type: stat.type,
              count: stat._count.type,
            })),
          },
          queries: {
            last30Days: queryStats._count,
            avgResponseTime: queryStats._avg.responseTime || 0,
          },
          feedback: {
            totalFeedback: feedbackStats._count,
            averageRating: feedbackStats._avg.rating || 0,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get warehouse activity log
router.get(
  '/:id/activity',
  authenticate,
  authorize([UserRole.ADMIN, UserRole.EXPERT]),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20 } = req.query as any;
      const skip = (page - 1) * limit;

      // Get recent queries from warehouse users
      const warehouseUserIds = await prisma.user.findMany({
        where: { warehouseId: id },
        select: { id: true },
      }).then(users => users.map(u => u.id));

      const [activities, total] = await Promise.all([
        prisma.queryLog.findMany({
          where: {
            userId: { in: warehouseUserIds },
          },
          skip,
          take: limit,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
            feedback: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.queryLog.count({
          where: {
            userId: { in: warehouseUserIds },
          },
        }),
      ]);

      res.json({
        success: true,
        data: activities,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;