import { Request as ExpressRequest, Response as ExpressResponse, NextFunction as ExpressNextFunction, Router as ExpressRouter } from 'express';
import { CustomJwtPayload } from './jwt';

declare global {
  namespace Express {
    interface Request {
      user?: CustomJwtPayload;
      body: any;
      params: any;
      headers: any;
    }
    interface Response {
      json: (body: any) => Response;
      status: (code: number) => Response;
    }
    interface NextFunction {
      (err?: any): void;
    }
  }
}

export type Request = ExpressRequest & Express.Request;
export type Response = ExpressResponse & Express.Response;
export type NextFunction = ExpressNextFunction & Express.NextFunction;
export const Router = ExpressRouter;
export type RequestHandler = (req: Request, res: Response, next: NextFunction) => void; 