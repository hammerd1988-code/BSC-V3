import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseAllowedOrigins(): string[] {
  const raw = [
    process.env.APP_URL,
    process.env.CLIENT_ORIGIN,
    process.env.VITE_APP_URL,
  ]
    .filter(Boolean)
    .join(',');
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

async function startServer() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = parseAllowedOrigins();
  const httpServer = createServer(app);
  
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : (isProd ? false : '*'),
    },
  });

  const PORT = Number(process.env.PORT) || 3001;

  app.use(express.json());

  // Health Check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      env: process.env.NODE_ENV,
      connections: io.engine.clientsCount,
      uptime: process.uptime(),
      version: 'unified'
    });
  });

  // Socket.IO State
  const connectedUsers = new Map<string, string>(); // userId -> socketId
  const liveStreams = new Map<string, any>(); // socketId -> streamData
  const userToStream = new Map<string, string>(); // socketId -> streamId

  io.on('connection', (socket) => {
    console.log(`[socket] Connected: ${socket.id} (total: ${io.engine.clientsCount})`);

    socket.on('user:online', (userId) => {
      connectedUsers.set(userId, socket.id);
      console.log(`[socket] User ${userId} -> ${socket.id}`);
    });

    // WebRTC Signaling
    socket.on('call:initiate', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:incoming', data);
      }
    });

    socket.on('call:accept', (data) => {
      const targetSocketId = connectedUsers.get(data.callerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:accepted', { answer: data.answer });
      }
    });

    socket.on('call:reject', (data) => {
      const targetSocketId = connectedUsers.get(data.callerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:rejected');
      }
    });

    socket.on('call:ice-candidate', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:ice-candidate', { candidate: data.candidate });
      }
    });

    socket.on('call:end', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:ended');
      }
    });

    socket.on('disconnect', () => {
      console.log(`[socket] Disconnected: ${socket.id}`);
      for (const [userId, socketId] of connectedUsers.entries()) {
        if (socketId === socket.id) {
          connectedUsers.delete(userId);
          break;
        }
      }
    });
  });

  // Serve Static Files from 'dist' directory
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));

  // SPA Fallback: serve index.html for all non-API routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] BSC-V3 Unified Server listening on port ${PORT}`);
    console.log(`[server] Serving static files from ${distPath}`);
  });
}

startServer().catch(err => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
