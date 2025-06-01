import { Request, Response, NextFunction } from '../types/express';
import axios from 'axios';
import { AppError } from '../middleware/errorHandler';

interface Profile {
  id: string;
  name: string;
  email: string;
  status: string;
}

export const getProfiles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const alphaDateToken = req.headers['x-alpha-date-token'];

    if (!alphaDateToken) {
      throw new AppError('Alpha Date token is required', 401);
    }

    const response = await axios.get<Profile[]>(
      `${process.env.ALPHA_DATE_API_URL}/operator/profiles`,
      {
        headers: {
          'Authorization': `Bearer ${alphaDateToken}`
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      next(new AppError(error.response?.data?.message || 'Failed to fetch profiles', error.response?.status || 500));
    } else {
      next(error);
    }
  }
};

export const updateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const alphaDateToken = req.headers['x-alpha-date-token'];

    if (!alphaDateToken) {
      throw new AppError('Alpha Date token is required', 401);
    }

    const response = await axios.put(
      `${process.env.ALPHA_DATE_API_URL}/operator/profiles/${id}`,
      req.body,
      {
        headers: {
          'Authorization': `Bearer ${alphaDateToken}`
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      next(new AppError(error.response?.data?.message || 'Failed to update profile', error.response?.status || 500));
    } else {
      next(error);
    }
  }
}; 