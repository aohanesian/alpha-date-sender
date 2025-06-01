import { Request, Response, NextFunction } from '../types/express';
import axios from 'axios';
import { AppError } from '../middleware/errorHandler';

interface Profile {
  id: string;
  name: string;
  email: string;
  status: string;
}

const ALPHA_DATE_API_URL = 'https://alpha.date/api';

export const getProfiles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const alphaDateToken = req.headers['x-alpha-date-token'];

    if (!alphaDateToken) {
      throw new AppError('Alpha Date token is required', 401);
    }

    console.log('Fetching profiles with Alpha Date token:', {
      hasAlphaDateToken: !!alphaDateToken,
      tokenLength: alphaDateToken.length
    });

    const response = await axios.get<Profile[]>(
      `${ALPHA_DATE_API_URL}/operator/profiles`,
      {
        headers: {
          'Authorization': `Bearer ${alphaDateToken}`
        }
      }
    );

    console.log('Alpha Date API response:', {
      status: response.status,
      dataLength: response.data?.length
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error in getProfiles:', error);
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
      `${ALPHA_DATE_API_URL}/operator/profiles/${id}`,
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