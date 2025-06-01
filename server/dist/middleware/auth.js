"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = exports.verifyToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const errorHandler_1 = require("./errorHandler");
const verifyToken = async (token) => {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        if (typeof decoded === 'string') {
            throw new errorHandler_1.AppError('Invalid token format', 401);
        }
        return decoded;
    }
    catch (error) {
        throw new errorHandler_1.AppError('Invalid token', 401);
    }
};
exports.verifyToken = verifyToken;
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            throw new errorHandler_1.AppError('No authorization header', 401);
        }
        const token = authHeader.split(' ')[1];
        if (!token) {
            throw new errorHandler_1.AppError('No token provided', 401);
        }
        const decoded = await (0, exports.verifyToken)(token);
        req.user = decoded;
        next();
    }
    catch (error) {
        next(error);
    }
};
exports.authenticate = authenticate;
