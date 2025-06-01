import { Request, Response, NextFunction } from '../types/express';

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error:', err);
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: false,
      message: err.message
    });
  } else {
    res.status(500).json({
      status: false,
      message: 'Internal server error'
    });
  }
}; 