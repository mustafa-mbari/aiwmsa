import { Request, Response, NextFunction } from 'express';
import { User, UserRole } from '@prisma/client';
import { AuthService } from '../services/auth.service';
import { AppError } from '../utils/errors';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: User;
      token?: string;
    }
  }
}

const authService = new AuthService();

/**
 * Authenticate user token
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      throw new AppError('No authentication token provided', 401);
    }

    const user = await authService.verifyToken(token);
    
    if (!user) {
      throw new AppError('Invalid or expired token', 401);
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Check if user has required role(s)
 */
export const authorize = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    if (!roles.includes(req.user.role)) {
      throw new AppError('Insufficient permissions', 403);
    }

    next();
  };
};

/**
 * Check if user is admin
 */
export const adminOnly = authorize(UserRole.ADMIN);

/**
 * Check if user is expert or admin
 */
export const expertOnly = authorize(UserRole.EXPERT, UserRole.ADMIN);

/**
 * Optional authentication - continues even if no token
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractToken(req);
    
    if (token) {
      const user = await authService.verifyToken(token);
      if (user) {
        req.user = user;
        req.token = token;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

/**
 * Check if user owns the resource or is admin
 */
export const ownerOrAdmin = (userIdParam: string = 'userId') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    const resourceUserId = req.params[userIdParam];
    
    if (req.user.role !== UserRole.ADMIN && req.user.id !== resourceUserId) {
      throw new AppError('Access denied', 403);
    }

    next();
  };
};

/**
 * Check if user belongs to the same warehouse
 */
export const sameWarehouse = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }

  const warehouseId = req.params.warehouseId || req.body.warehouseId;
  
  if (req.user.role !== UserRole.ADMIN && req.user.warehouseId !== warehouseId) {
    throw new AppError('Access denied to this warehouse', 403);
  }

  next();
};

/**
 * Extract token from request headers
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Check for token in cookies (optional)
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  
  return null;
}