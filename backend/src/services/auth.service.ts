import { PrismaClient, User, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AppError } from '../utils/errors';
import { redisClient } from '../config/redis';

const prisma = new PrismaClient();

// Validation schemas
export const RegisterSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30),
  password: z.string().min(8).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    'Password must contain uppercase, lowercase, number and special character'
  ),
  firstName: z.string().min(2).max(50),
  lastName: z.string().min(2).max(50),
  role: z.nativeEnum(UserRole).default(UserRole.WORKER),
  department: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
  preferredLanguage: z.enum(['EN', 'AR', 'DE']).default('EN')
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;

interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  warehouseId?: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  private readonly JWT_SECRET = process.env.JWT_SECRET!;
  private readonly JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;
  private readonly JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
  private readonly JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  private readonly BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10');

  /**
   * Register a new user
   */
  async register(data: RegisterInput): Promise<User> {
    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: data.email },
          { username: data.username }
        ]
      }
    });

    if (existingUser) {
      throw new AppError(
        existingUser.email === data.email 
          ? 'Email already registered' 
          : 'Username already taken',
        409
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, this.BCRYPT_ROUNDS);

    // Create user
    const user = await prisma.user.create({
      data: {
        ...data,
        password: hashedPassword
      },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        department: true,
        warehouseId: true,
        preferredLanguage: true,
        createdAt: true
      }
    });

    return user as User;
  }

  /**
   * Login user and generate tokens
   */
  async login(data: LoginInput, userAgent?: string, ipAddress?: string): Promise<{
    user: Omit<User, 'password'>;
    tokens: AuthTokens;
  }> {
    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: {
        warehouse: true
      }
    });

    if (!user || !user.isActive) {
      throw new AppError('Invalid credentials', 401);
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(data.password, user.password);
    if (!isValidPassword) {
      throw new AppError('Invalid credentials', 401);
    }

    // Generate tokens
    const tokens = await this.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      warehouseId: user.warehouseId || undefined
    });

    // Create session
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + 7 * 24 * 60 * 60); // 7 days

    await prisma.session.create({
      data: {
        userId: user.id,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        userAgent,
        ipAddress,
        expiresAt
      }
    });

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });

    // Cache user session in Redis
    await this.cacheSession(user.id, tokens.accessToken);

    const { password, ...userWithoutPassword } = user;
    return { user: userWithoutPassword, tokens };
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    try {
      // Verify refresh token
      const payload = jwt.verify(refreshToken, this.JWT_REFRESH_SECRET) as TokenPayload;

      // Check if session exists
      const session = await prisma.session.findUnique({
        where: { refreshToken },
        include: { user: true }
      });

      if (!session || session.expiresAt < new Date()) {
        throw new AppError('Invalid or expired refresh token', 401);
      }

      // Generate new tokens
      const tokens = await this.generateTokens({
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        warehouseId: payload.warehouseId
      });

      // Update session
      await prisma.session.update({
        where: { id: session.id },
        data: {
          token: tokens.accessToken,
          refreshToken: tokens.refreshToken
        }
      });

      // Update cache
      await this.cacheSession(payload.userId, tokens.accessToken);

      return tokens;
    } catch (error) {
      throw new AppError('Invalid refresh token', 401);
    }
  }

  /**
   * Logout user
   */
  async logout(token: string): Promise<void> {
    // Remove session from database
    await prisma.session.delete({
      where: { token }
    });

    // Remove from cache
    const payload = jwt.decode(token) as TokenPayload;
    if (payload) {
      await redisClient.del(`session:${payload.userId}`);
      await redisClient.setex(`blacklist:${token}`, 86400, '1'); // Blacklist for 24 hours
    }
  }

  /**
   * Verify token and get user
   */
  async verifyToken(token: string): Promise<User | null> {
    try {
      // Check if token is blacklisted
      const isBlacklisted = await redisClient.get(`blacklist:${token}`);
      if (isBlacklisted) {
        return null;
      }

      // Verify token
      const payload = jwt.verify(token, this.JWT_SECRET) as TokenPayload;

      // Check cache first
      const cachedUserId = await redisClient.get(`session:${payload.userId}`);
      if (cachedUserId !== token) {
        // Session mismatch or expired
        return null;
      }

      // Get user from database
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        include: { warehouse: true }
      });

      if (!user || !user.isActive) {
        return null;
      }

      return user;
    } catch (error) {
      return null;
    }
  }

  /**
   * Change password
   */
  async changePassword(
    userId: string, 
    currentPassword: string, 
    newPassword: string
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new AppError('Invalid current password', 401);
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.BCRYPT_ROUNDS);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    // Invalidate all sessions
    await this.invalidateAllSessions(userId);
  }

  /**
   * Private methods
   */
  private async generateTokens(payload: TokenPayload): Promise<AuthTokens> {
    const accessToken = jwt.sign(payload, this.JWT_SECRET, {
      expiresIn: this.JWT_EXPIRES_IN
    });

    const refreshToken = jwt.sign(payload, this.JWT_REFRESH_SECRET, {
      expiresIn: this.JWT_REFRESH_EXPIRES_IN
    });

    return { accessToken, refreshToken };
  }

  private async cacheSession(userId: string, token: string): Promise<void> {
    await redisClient.setex(
      `session:${userId}`, 
      15 * 60, // 15 minutes
      token
    );
  }

  private async invalidateAllSessions(userId: string): Promise<void> {
    // Delete all database sessions
    await prisma.session.deleteMany({
      where: { userId }
    });

    // Clear cache
    await redisClient.del(`session:${userId}`);
  }
}