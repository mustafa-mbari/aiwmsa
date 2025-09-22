// Type definitions for the application
import { User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      token?: string;
    }
  }
}

export {};