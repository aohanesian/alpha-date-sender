import { Request as ExpressRequest, Response as ExpressResponse, NextFunction as ExpressNextFunction, Router as ExpressRouter } from 'express';
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

export type Request = Express.Request;
export type Response = Express.Response;
export type NextFunction = Express.NextFunction;
export const Router = ExpressRouter;
export type RequestHandler = (req: Request, res: Response, next: NextFunction) => void; 