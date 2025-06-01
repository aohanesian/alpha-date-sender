import { Request as ExpressRequest, Response as ExpressResponse, NextFunction as ExpressNextFunction } from 'express';
import { CustomJwtPayload } from './jwt';

declare global {
  namespace Express {
    interface Request extends ExpressRequest {
      user?: CustomJwtPayload;
      body: any;
      params: any;
      headers: any;
    }
    interface Response extends ExpressResponse {
      json: (body: any) => Response;
      status: (code: number) => Response;
    }
    interface NextFunction extends ExpressNextFunction {}
  }
}

export type RequestHandler = (req: Express.Request, res: Express.Response, next: Express.NextFunction) => void; 