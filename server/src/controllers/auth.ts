import { Request, Response, NextFunction } from '../types/express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { AppError } from '../middleware/errorHandler';
import { getWhitelistedEmails } from '../services/whitelist';

interface AlphaDateLoginResponse {
  status: boolean;
  operator_id: string;
  token: string;
}

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }

    // Login to Alpha Date
    const alphaDateResponse = await axios.post<AlphaDateLoginResponse>(
      'https://alpha.date/api/login/login',
      { email, password }
    );

    if (!alphaDateResponse.data.status) {
      throw new AppError('Invalid credentials', 401);
    }

    // Check whitelist
    const whitelistedEmails = await getWhitelistedEmails();

    if (!whitelistedEmails.includes(email.toLowerCase())) {
      throw new AppError('Email not in whitelist', 403);
    }

    // Create JWT token
    const token = jwt.sign(
      {
        operatorId: alphaDateResponse.data.operator_id,
        email: email.toLowerCase(),
        alphaDateToken: alphaDateResponse.data.token
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '9h' }
    );

    res.json({
      status: true,
      token,
      operatorId: alphaDateResponse.data.operator_id,
      alphaDateToken: alphaDateResponse.data.token
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 500;
      const message = error.response?.data?.message || 'Authentication failed';
      next(new AppError(message, status));
    } else if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('Authentication failed', 500));
    }
  }
};

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }

    // Check whitelist
    const whitelistedEmails = await getWhitelistedEmails();

    if (!whitelistedEmails.includes(email.toLowerCase())) {
      throw new AppError('Email not in whitelist', 403);
    }

    // Register with Alpha Date
    const alphaDateResponse = await axios.post(
      'https://alpha.date/api/login/register',
      { email, password }
    );

    if (!alphaDateResponse.data.status) {
      throw new AppError('Registration failed', 400);
    }

    res.json({
      status: true,
      message: 'Registration successful'
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 500;
      const message = error.response?.data?.message || 'Registration failed';
      next(new AppError(message, status));
    } else if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('Registration failed', 500));
    }
  }
}; 