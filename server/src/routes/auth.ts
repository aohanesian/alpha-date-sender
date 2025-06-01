import express from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { AppError } from '../middleware/errorHandler';
import { authenticate } from '../middleware/auth';

interface CustomJwtPayload {
  operatorId: string;
  iat?: number;
  exp?: number;
}

const router = express.Router();

interface AlphaDateLoginResponse {
  status: boolean;
  admin: boolean;
  token_create: string;
  token_end: string;
  operator_id: number;
  token: string;
}

interface WhitelistResponse {
  documents: Array<{
    fields: {
      email: {
        arrayValue: {
          values: Array<{
            stringValue: string;
          }>;
        };
      };
    };
  }>;
}

async function getWhitelistedEmails(): Promise<string[]> {
  try {
    // Fetch from first whitelist
    const whitelistResponse1 = await axios.get<WhitelistResponse>(
      'https://firestore.googleapis.com/v1/projects/alpha-a4fdc/databases/(default)/documents/operator_whitelist'
    );

    // Fetch from second whitelist
    const whitelistResponse2 = await axios.get<WhitelistResponse>(
      'https://firestore.googleapis.com/v1/projects/alpha-date-sender/databases/(default)/documents/operator_whitelist'
    );

    // Combine emails from both whitelists
    const emails1 = whitelistResponse1.data.documents?.[0]?.fields?.email?.arrayValue?.values?.map(
      item => item.stringValue.toLowerCase()
    ) || [];

    const emails2 = whitelistResponse2.data.documents?.[0]?.fields?.email?.arrayValue?.values?.map(
      item => item.stringValue.toLowerCase()
    ) || [];

    // Combine and remove duplicates
    return [...new Set([...emails1, ...emails2])];
  } catch (error) {
    console.error('Error fetching whitelists:', error);
    throw new AppError('Failed to fetch whitelist', 500);
  }
}

router.post('/login', async (req, res, next) => {
  try {
    console.log('Login attempt:', { email: req.body.email, password: req.body.password });
    const { email, password } = req.body;

    if (!email || !password) {
      console.log('Missing credentials');
      throw new AppError('Email and password are required', 400);
    }

    // Login to Alpha Date
    console.log('Attempting Alpha Date login...');
    const alphaDateResponse = await axios.post<AlphaDateLoginResponse>(
      'https://alpha.date/api/login/login',
      { email, password }
    );

    console.log('Alpha Date response:', { status: alphaDateResponse.data.status });

    if (!alphaDateResponse.data.status) {
      console.log('Invalid Alpha Date credentials');
      throw new AppError('Invalid credentials', 401);
    }

    // Check whitelist
    console.log('Checking whitelists...');
    const whitelistedEmails = await getWhitelistedEmails();

    console.log('Whitelist check:', { 
      email: email.toLowerCase(),
      isWhitelisted: whitelistedEmails.includes(email.toLowerCase())
    });

    if (!whitelistedEmails.includes(email.toLowerCase())) {
      console.log('Email not in whitelist');
      throw new AppError('Email not in whitelist', 403);
    }

    // Create JWT token
    console.log('Creating JWT token...');
    const token = jwt.sign(
      {
        operatorId: alphaDateResponse.data.operator_id,
        email: email.toLowerCase(),
        alphaDateToken: alphaDateResponse.data.token
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '9h' }
    );

    console.log('Login successful');
    res.json({
      status: true,
      token,
      operatorId: alphaDateResponse.data.operator_id,
      alphaDateToken: alphaDateResponse.data.token
    });
  } catch (error) {
    console.error('Login error:', error);
    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 500;
      const message = error.response?.data?.message || 'Authentication failed';
      console.error('Axios error:', { status, message });
      next(new AppError(message, status));
    } else if (error instanceof AppError) {
      next(error);
    } else {
      console.error('Unknown error:', error);
      next(new AppError('Authentication failed', 500));
    }
  }
});

// Refresh token endpoint
router.post('/refresh', authenticate, async (req, res) => {
  try {
    const { operatorId } = req.user as CustomJwtPayload;

    // Generate new JWT token
    const token = jwt.sign(
      { operatorId },
      process.env.JWT_SECRET!,
      { expiresIn: '9h' }
    );

    // Get the current alphaDateToken from the request
    const alphaDateToken = req.headers['x-alpha-date-token'] as string;

    if (!alphaDateToken) {
      return res.status(401).json({
        status: false,
        message: 'Alpha Date token is required'
      });
    }

    res.json({
      status: true,
      token,
      alphaDateToken,
      operatorId
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({
      status: false,
      message: 'Error refreshing token'
    });
  }
});

export const authRouter = router; 