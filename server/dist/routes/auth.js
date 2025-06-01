"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const errorHandler_1 = require("../middleware/errorHandler");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
async function getWhitelistedEmails() {
    try {
        // Fetch from first whitelist
        const whitelistResponse1 = await axios_1.default.get('https://firestore.googleapis.com/v1/projects/alpha-a4fdc/databases/(default)/documents/operator_whitelist');
        // Fetch from second whitelist
        const whitelistResponse2 = await axios_1.default.get('https://firestore.googleapis.com/v1/projects/alpha-date-sender/databases/(default)/documents/operator_whitelist');
        // Combine emails from both whitelists
        const emails1 = whitelistResponse1.data.documents?.[0]?.fields?.email?.arrayValue?.values?.map(item => item.stringValue.toLowerCase()) || [];
        const emails2 = whitelistResponse2.data.documents?.[0]?.fields?.email?.arrayValue?.values?.map(item => item.stringValue.toLowerCase()) || [];
        // Combine and remove duplicates
        return [...new Set([...emails1, ...emails2])];
    }
    catch (error) {
        console.error('Error fetching whitelists:', error);
        throw new errorHandler_1.AppError('Failed to fetch whitelist', 500);
    }
}
router.post('/login', async (req, res, next) => {
    try {
        console.log('Login attempt:', { email: req.body.email, password: req.body.password });
        const { email, password } = req.body;
        if (!email || !password) {
            console.log('Missing credentials');
            throw new errorHandler_1.AppError('Email and password are required', 400);
        }
        // Login to Alpha Date
        console.log('Attempting Alpha Date login...');
        const alphaDateResponse = await axios_1.default.post('https://alpha.date/api/login/login', { email, password });
        console.log('Alpha Date response:', { status: alphaDateResponse.data.status });
        if (!alphaDateResponse.data.status) {
            console.log('Invalid Alpha Date credentials');
            throw new errorHandler_1.AppError('Invalid credentials', 401);
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
            throw new errorHandler_1.AppError('Email not in whitelist', 403);
        }
        // Create JWT token
        console.log('Creating JWT token...');
        const token = jsonwebtoken_1.default.sign({
            operatorId: alphaDateResponse.data.operator_id,
            email: email.toLowerCase(),
            alphaDateToken: alphaDateResponse.data.token
        }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '9h' });
        console.log('Login successful');
        res.json({
            status: true,
            token,
            operatorId: alphaDateResponse.data.operator_id,
            alphaDateToken: alphaDateResponse.data.token
        });
    }
    catch (error) {
        console.error('Login error:', error);
        if (axios_1.default.isAxiosError(error)) {
            const status = error.response?.status || 500;
            const message = error.response?.data?.message || 'Authentication failed';
            console.error('Axios error:', { status, message });
            next(new errorHandler_1.AppError(message, status));
        }
        else if (error instanceof errorHandler_1.AppError) {
            next(error);
        }
        else {
            console.error('Unknown error:', error);
            next(new errorHandler_1.AppError('Authentication failed', 500));
        }
    }
});
// Refresh token endpoint
router.post('/refresh', auth_1.authenticate, async (req, res) => {
    try {
        const { operatorId } = req.user;
        // Generate new JWT token
        const token = jsonwebtoken_1.default.sign({ operatorId }, process.env.JWT_SECRET, { expiresIn: '9h' });
        // Get the current alphaDateToken from the request
        const alphaDateToken = req.headers['x-alpha-date-token'];
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
    }
    catch (error) {
        console.error('Error refreshing token:', error);
        res.status(500).json({
            status: false,
            message: 'Error refreshing token'
        });
    }
});
exports.authRouter = router;
