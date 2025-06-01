import { 
  Request as ExpressRequest, 
  Response as ExpressResponse, 
  NextFunction as ExpressNextFunction, 
  Router as ExpressRouter, 
  Application as ExpressApplication,
  RequestHandler as ExpressRequestHandler
} from 'express';
import { CustomJwtPayload } from './jwt';

// Augment the Express namespace to add custom properties
declare global {
  namespace Express {
    interface Request {
      user?: CustomJwtPayload;
    }
  }
}

// Export the Express types directly (no intersection needed)
export type Request = ExpressRequest;
export type Response = ExpressResponse;
export type NextFunction = ExpressNextFunction;
export type Application = ExpressApplication;
export type RequestHandler = ExpressRequestHandler;

// Export Router as a value, not a type
export { Router as ExpressRouter } from 'express';