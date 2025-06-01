import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { AppError } from '../middleware/errorHandler';
import { auth } from '../middleware/auth';
import { login, register } from '../controllers/auth';

interface CustomJwtPayload {
  operatorId: string;
  iat?: number;
  exp?: number;
}

const router = Router();

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

router.post('/login', login);
router.post('/register', register);

// Refresh token endpoint
router.post('/refresh', auth, async (req, res) => {
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

export { router as authRouter }; 