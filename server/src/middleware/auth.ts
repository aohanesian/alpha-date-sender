import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';
import { CustomJwtPayload } from '../types';

declare global {
  namespace Express {
    interface Request {
      user?: CustomJwtPayload;
    }
  }
}

export const verifyToken = async (token: string): Promise<CustomJwtPayload> => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    if (typeof decoded === 'string') {
      throw new AppError('Invalid token format', 401);
    }
    return decoded as CustomJwtPayload;
  } catch (error) {
    throw new AppError('Invalid token', 401);
  }
};

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new AppError('No authorization header', 401);
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new AppError('No token provided', 401);
    }

    const decoded = await verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    next(error);
  }
}; 