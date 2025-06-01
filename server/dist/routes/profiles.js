"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileRouter = void 0;
const express_1 = require("express");
const axios_1 = __importDefault(require("axios"));
const errorHandler_1 = require("../middleware/errorHandler");
const router = (0, express_1.Router)();
// Get profiles
router.get('/', async (req, res, next) => {
    try {
        const alphaDateToken = req.headers['x-alpha-date-token'];
        console.log('Profiles request received:', {
            hasAlphaDateToken: !!alphaDateToken,
            alphaDateTokenLength: alphaDateToken?.length,
            url: `${process.env.ALPHA_DATE_API_URL}/operator/profiles`
        });
        if (!alphaDateToken) {
            throw new errorHandler_1.AppError('Alpha Date token is required', 401);
        }
        const response = await axios_1.default.get(`${process.env.ALPHA_DATE_API_URL}/operator/profiles`, {
            headers: {
                'Authorization': `Bearer ${alphaDateToken}`
            }
        });
        console.log('Alpha Date API response:', {
            status: response.status,
            dataLength: response.data?.length,
            hasData: !!response.data
        });
        res.json(response.data);
    }
    catch (error) {
        console.error('Error in profiles route:', error);
        if (axios_1.default.isAxiosError(error)) {
            console.error('Axios error details:', {
                status: error.response?.status,
                data: error.response?.data,
                config: {
                    url: error.config?.url,
                    headers: error.config?.headers
                }
            });
            next(new errorHandler_1.AppError(error.response?.data?.message || 'Failed to fetch profiles', error.response?.status || 500));
        }
        else {
            next(error);
        }
    }
});
// Get attachments
router.get('/:profileId/attachments', async (req, res, next) => {
    try {
        const { profileId } = req.params;
        const { forceRefresh } = req.query;
        const alphaDateToken = req.headers['x-alpha-date-token'];
        if (!alphaDateToken) {
            throw new errorHandler_1.AppError('Alpha Date token is required', 401);
        }
        const types = ['images', 'videos', 'audios'];
        const attachments = {};
        for (const type of types) {
            const response = await axios_1.default.get(`${process.env.ALPHA_DATE_API_URL}/files/${type}?external_id=${profileId}${forceRefresh === 'true' ? '&force_refresh=true' : ''}`, {
                headers: {
                    'Authorization': `Bearer ${alphaDateToken}`
                }
            });
            if (response.data.folders && typeof response.data.folders === 'object') {
                const sendFolder = Object.values(response.data.folders).find((folder) => folder.name?.toLowerCase() === "send");
                if (sendFolder && Array.isArray(sendFolder.list)) {
                    attachments[type] = sendFolder.list;
                }
                else {
                    attachments[type] = [];
                }
            }
            else if (response.data[type] && Array.isArray(response.data[type])) {
                attachments[type] = response.data[type];
            }
            else if (response.data.response && Array.isArray(response.data.response)) {
                attachments[type] = response.data.response;
            }
            else {
                attachments[type] = [];
            }
        }
        res.json(attachments);
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error)) {
            next(new errorHandler_1.AppError(error.response?.data?.message || 'Failed to fetch attachments', error.response?.status || 500));
        }
        else {
            next(error);
        }
    }
});
exports.profileRouter = router;
