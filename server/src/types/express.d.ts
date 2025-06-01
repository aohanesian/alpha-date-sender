import { Request as ExpressRequest, Response as ExpressResponse, NextFunction as ExpressNextFunction, Router as ExpressRouter, Application as ExpressApplication } from 'express';
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
    interface Application {
      use: (handler: any) => Application;
      json: () => any;
      static: (path: string) => any;
    }
  }
}

export type Request = ExpressRequest & Express.Request;
export type Response = ExpressResponse & Express.Response;
export type NextFunction = ExpressNextFunction & Express.NextFunction;
export type Application = ExpressApplication & Express.Application;
export const Router = ExpressRouter;
export type RequestHandler = (req: Request, res: Response, next: NextFunction) => void; 