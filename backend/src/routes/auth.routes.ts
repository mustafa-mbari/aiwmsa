import { Router } from 'express';
import {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  changePassword
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { rateLimiter } from '../middleware/rateLimiter';
import { validateRequest } from '../middleware/validation';
import { RegisterSchema, LoginSchema } from '../services/auth.service';

const router = Router();

/**
 * Public routes
 */
// Register new user
router.post(
  '/register',
  rateLimiter('register', 5, 15), // 5 requests per 15 minutes
  validateRequest(RegisterSchema),
  register
);

// Login
router.post(
  '/login',
  rateLimiter('login', 10, 15), // 10 requests per 15 minutes
  validateRequest(LoginSchema),
  login
);

// Refresh token
router.post(
  '/refresh',
  rateLimiter('refresh', 10, 15),
  refreshToken
);

/**
 * Protected routes
 */
// Logout
router.post('/logout', authenticate, logout);

// Get current user
router.get('/me', authenticate, getMe);

// Change password
router.patch(
  '/change-password',
  authenticate,
  rateLimiter('changePassword', 3, 15), // 3 requests per 15 minutes
  changePassword
);

export default router;