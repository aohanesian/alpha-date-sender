import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

export type RequestHandler = (req: Request, res: Response, next: NextFunction) => void; 