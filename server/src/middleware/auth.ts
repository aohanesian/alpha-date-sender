import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from '../types/express.js';
import { AppError } from './errorHandler.js';
import { CustomJwtPayload } from '../types/jwt.js';

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

export const auth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      throw new Error();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as CustomJwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate.' });
  }
};

export const authenticate = auth; // Alias for backward compatibility 