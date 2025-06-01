"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.AppError = void 0;
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;
const errorHandler = (err, req, res, next) => {
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            status: false,
            message: err.message
        });
    }
    console.error('Unhandled error:', err);
    return res.status(500).json({
        status: false,
        message: 'Internal server error'
    });
};
exports.errorHandler = errorHandler;
