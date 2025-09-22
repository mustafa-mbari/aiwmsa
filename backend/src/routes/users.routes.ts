// C:\Dev\Git\AIwmsa\backend\src\routes\users.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { authenticate, authorize } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const createUserSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(2),
    role: z.nativeEnum(UserRole),
    warehouseId: z.string().uuid(),
    preferredLanguage: z.enum(['ar', 'en', 'de']).optional().default('en'),
    department: z.string().optional(),
    phone: z.string().optional(),
  }),
});

const updateUserSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    role: z.nativeEnum(UserRole).optional(),
    warehouseId: z.string().uuid().optional(),
    preferredLanguage: z.enum(['ar', 'en', 'de']).optional(),
    department: z.string().optional(),
    phone: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
  params: z.object({
    id: z.string().uuid(),
  }),
});

const getUsersQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).default('1').transform(Number),
    limit: z.string().regex(/^\d+$/).default('10').transform(Number),
    role: z.nativeEnum(UserRole).optional(),
    warehouseId: z.string().uuid().optional(),
    isActive: z.string().transform(val => val === 'true').optional(),
    search: z.string().optional(),
  }),
});

// Get all users (Admin only)
router.get(
  '/',
  authenticate,
  authorize([UserRole.ADMIN]),
  validateRequest(getUsersQuerySchema),
  async (req, res, next) => {
    try {
      const { page, limit, role, warehouseId, isActive, search } = req.query as any;
      const skip = (page - 1) * limit;

      // Build where clause
      const where: any = {};
      if (role) where.role = role;
      if (warehouseId) where.warehouseId = warehouseId;
      if (isActive !== undefined) where.isActive = isActive;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { department: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Get users with pagination
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip,
          take: limit,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            warehouseId: true,
            warehouse: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            preferredLanguage: true,
            department: true,
            phone: true,
            isActive: true,
            lastLogin: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.user.count({ where }),
      ]);

      res.json({
        success: true,
        data: users,
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

// Get single user
router.get(
  '/:id',
  authenticate,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const requestingUser = req.user!;

      // Users can view their own profile, admins can view any profile
      if (requestingUser.role !== UserRole.ADMIN && requestingUser.id !== id) {
        throw new AppError('Forbidden', 403);
      }

      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          warehouseId: true,
          warehouse: {
            select: {
              id: true,
              name: true,
              code: true,
              location: true,
            },
          },
          preferredLanguage: true,
          department: true,
          phone: true,
          isActive: true,
          lastLogin: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Create new user (Admin only)
router.post(
  '/',
  authenticate,
  authorize([UserRole.ADMIN]),
  validateRequest(createUserSchema),
  async (req, res, next) => {
    try {
      const data = req.body;

      // Check if email already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: data.email },
      });

      if (existingUser) {
        throw new AppError('Email already registered', 400);
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(data.password, 10);

      // Create user
      const user = await prisma.user.create({
        data: {
          ...data,
          password: hashedPassword,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          warehouseId: true,
          preferredLanguage: true,
          department: true,
          phone: true,
          isActive: true,
          createdAt: true,
        },
      });

      logger.info(`New user created: ${user.email} by ${req.user!.email}`);

      res.status(201).json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Update user
router.patch(
  '/:id',
  authenticate,
  validateRequest(updateUserSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const requestingUser = req.user!;

      // Only admins can update other users
      // Users can only update their own profile (limited fields)
      if (requestingUser.role !== UserRole.ADMIN) {
        if (requestingUser.id !== id) {
          throw new AppError('Forbidden', 403);
        }
        // Regular users can only update certain fields
        delete updates.role;
        delete updates.isActive;
        delete updates.warehouseId;
      }

      const user = await prisma.user.update({
        where: { id },
        data: updates,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          warehouseId: true,
          warehouse: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          preferredLanguage: true,
          department: true,
          phone: true,
          isActive: true,
          updatedAt: true,
        },
      });

      logger.info(`User updated: ${user.email} by ${requestingUser.email}`);

      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Delete user (Admin only)
router.delete(
  '/:id',
  authenticate,
  authorize([UserRole.ADMIN]),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const requestingUser = req.user!;

      // Prevent self-deletion
      if (requestingUser.id === id) {
        throw new AppError('Cannot delete your own account', 400);
      }

      // Soft delete by setting isActive to false
      await prisma.user.update({
        where: { id },
        data: { isActive: false },
      });

      logger.info(`User deactivated: ${id} by ${requestingUser.email}`);

      res.json({
        success: true,
        message: 'User deactivated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// Reset user password (Admin only)
router.post(
  '/:id/reset-password',
  authenticate,
  authorize([UserRole.ADMIN]),
  validateRequest(
    z.object({
      body: z.object({
        newPassword: z.string().min(8),
      }),
      params: z.object({
        id: z.string().uuid(),
      }),
    })
  ),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await prisma.user.update({
        where: { id },
        data: { password: hashedPassword },
      });

      logger.info(`Password reset for user ${id} by ${req.user!.email}`);

      res.json({
        success: true,
        message: 'Password reset successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get user statistics (Admin only)
router.get(
  '/stats/overview',
  authenticate,
  authorize([UserRole.ADMIN]),
  async (req, res, next) => {
    try {
      const [totalUsers, activeUsers, usersByRole, usersByWarehouse] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.user.groupBy({
          by: ['role'],
          _count: { role: true },
        }),
        prisma.user.groupBy({
          by: ['warehouseId'],
          _count: { warehouseId: true },
        }),
      ]);

      res.json({
        success: true,
        data: {
          totalUsers,
          activeUsers,
          inactiveUsers: totalUsers - activeUsers,
          usersByRole: usersByRole.map(item => ({
            role: item.role,
            count: item._count.role,
          })),
          usersByWarehouse: usersByWarehouse.map(item => ({
            warehouseId: item.warehouseId,
            count: item._count.warehouseId,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;