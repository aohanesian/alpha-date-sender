import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { setupSocketHandlers } from './socket';
import { SessionManager } from './services/sessionManager';
import { SchedulerService } from './services/schedulerService';
import { authRouter } from './routes/auth';
import { profileRouter } from './routes/profiles';
import { AppError } from './middleware/errorHandler';
import path from 'path';

const app = express();
const httpServer = createServer(app);

// CORS configuration
const corsOptions = {
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  methods: ['GET', 'POST'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Alpha-Date-Token']
};

app.use(cors(corsOptions));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// API routes
app.use('/api/auth', authRouter);
app.use('/api/profiles', profileRouter);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../client/dist')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
  });
}

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: false,
      message: err.message
    });
  } else {
    res.status(500).json({
      status: false,
      message: 'Internal server error'
    });
  }
});

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: corsOptions,
  transports: ['websocket', 'polling']
});

// Initialize session manager
const sessionManager = new SessionManager(io);
sessionManager.initialize().catch(console.error);

// Initialize scheduler
const schedulerService = new SchedulerService(sessionManager);
schedulerService.startScheduler();

// Setup socket handlers
setupSocketHandlers(io);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
}); 