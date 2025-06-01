// @ts-ignore
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupSocketHandlers } from './socket.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.js';
import profilesRoutes from './routes/profiles.js';
import { errorHandler } from './middleware/errorHandler.js';

// @ts-ignore
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
// @ts-ignore
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));
// @ts-ignore
app.use(morgan('dev'));
// @ts-ignore
app.use(express.json());
// @ts-ignore
app.use(express.urlencoded({ extended: true }));

// Serve static files from the client build directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// @ts-ignore
app.use(express.static(path.join(__dirname, '../../client/dist')));

// API routes
// @ts-ignore
app.use('/api/auth', authRoutes);
// @ts-ignore
app.use('/api/profiles', profilesRoutes);

// Serve the client app for all other routes
// @ts-ignore
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

// Error handling middleware
// @ts-ignore
app.use(errorHandler);

// Setup socket handlers
setupSocketHandlers(io);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 