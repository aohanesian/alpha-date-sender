import { Request as ExpressRequest, Response as ExpressResponse, NextFunction as ExpressNextFunction } from 'express';

declare global {
  namespace Express {
    interface Request extends ExpressRequest {
      user?: any;
    }
    interface Response extends ExpressResponse {}
    interface NextFunction extends ExpressNextFunction {}
  }
}

export type RequestHandler = (req: Express.Request, res: Express.Response, next: Express.NextFunction) => void; 