import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { setupSocketHandlers } from './socket';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth';
import { profilesRouter } from './routes/profiles';

const app = express();
const httpServer = createServer(app);

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  process.env.CLIENT_URL
].filter((origin): origin is string => Boolean(origin));

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(express.json());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Alpha-Date-Token']
}));
app.use(morgan('dev'));
app.use(helmet());

// Static files
app.use(express.static('public'));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/profiles', profilesRouter);

// Error handling
app.use(errorHandler);

// Socket.io setup
setupSocketHandlers(io);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 