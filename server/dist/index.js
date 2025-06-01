"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const socket_1 = require("./socket");
const sessionManager_1 = require("./services/sessionManager");
const schedulerService_1 = require("./services/schedulerService");
const auth_1 = require("./routes/auth");
const profiles_1 = require("./routes/profiles");
const errorHandler_1 = require("./middleware/errorHandler");
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
// CORS configuration
const corsOptions = {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Alpha-Date-Token']
};
app.use((0, cors_1.default)(corsOptions));
app.use(express_1.default.json());
// Rate limiting
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);
// API routes
app.use('/api/auth', auth_1.authRouter);
app.use('/api/profiles', profiles_1.profileRouter);
// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express_1.default.static(path_1.default.join(__dirname, '../../client/dist')));
    app.get('*', (req, res) => {
        res.sendFile(path_1.default.join(__dirname, '../../client/dist/index.html'));
    });
}
// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    if (err instanceof errorHandler_1.AppError) {
        res.status(err.statusCode).json({
            status: false,
            message: err.message
        });
    }
    else {
        res.status(500).json({
            status: false,
            message: 'Internal server error'
        });
    }
});
// Initialize Socket.IO
const io = new socket_io_1.Server(httpServer, {
    cors: corsOptions,
    transports: ['websocket', 'polling']
});
// Initialize session manager
const sessionManager = new sessionManager_1.SessionManager(io);
sessionManager.initialize().catch(console.error);
// Initialize scheduler
const schedulerService = new schedulerService_1.SchedulerService(sessionManager);
schedulerService.startScheduler();
// Setup socket handlers
(0, socket_1.setupSocketHandlers)(io);
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
