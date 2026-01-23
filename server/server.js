import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow connections from any localhost port
      if (!origin || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: (origin, callback) => {
    // Allow connections from any localhost port
    if (!origin || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'OneTwoOne Server API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      reports: {
        get: 'GET /api/reports',
        post: 'POST /api/reports'
      },
      socket: 'WebSocket connection on /socket.io'
    },
    status: 'running'
  });
});

// Handle favicon requests (browsers automatically request this)
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// In-memory storage (in production, use a database)
const waitingQueues = {
  video: [],
  audio: [],
  text: [],
  any: []
};

const activeRooms = new Map(); // roomId -> { users: [socketId1, socketId2], mode, createdAt }
const userSessions = new Map(); // socketId -> { roomId, userId, mode, name }

// Track online user counts
let onlineCounts = {
  total: 0,
  video: 0,
  audio: 0,
  text: 0
};

// Reports storage
const reports = [];

// Helper function to find a match
function findMatch(socketId, mode) {
  // If mode is 'any', search video, audio, text queues in priority order
  if (mode === 'any') {
    const priorityQueues = ['video', 'audio', 'text'];
    
    for (const queueMode of priorityQueues) {
      const queue = waitingQueues[queueMode];
      for (let i = 0; i < queue.length; i++) {
        const waitingUser = queue[i];
        if (waitingUser.socketId !== socketId) {
          // Match found! Remove from queue and return with the matched mode
          queue.splice(i, 1);
          return { ...waitingUser, matchedMode: queueMode };
        }
      }
    }
    
    // If no match in priority queues, check 'any' queue
    const anyQueue = waitingQueues['any'];
    for (let i = 0; i < anyQueue.length; i++) {
      const waitingUser = anyQueue[i];
      if (waitingUser.socketId !== socketId) {
        anyQueue.splice(i, 1);
        return { ...waitingUser, matchedMode: 'any' };
      }
    }
    
    return null;
  } else {
    // For specific modes, check own queue and 'any' queue
    const queue = waitingQueues[mode];
    const compatibleModes = [mode, 'any'];
    
    for (let i = 0; i < queue.length; i++) {
      const waitingUser = queue[i];
      if (waitingUser.socketId !== socketId && 
          compatibleModes.includes(waitingUser.requestedMode)) {
        queue.splice(i, 1);
        return { ...waitingUser, matchedMode: mode };
      }
    }
    
    // Also check 'any' queue for this specific mode
    const anyQueue = waitingQueues['any'];
    for (let i = 0; i < anyQueue.length; i++) {
      const waitingUser = anyQueue[i];
      if (waitingUser.socketId !== socketId) {
        anyQueue.splice(i, 1);
        return { ...waitingUser, matchedMode: mode };
      }
    }
    
    return null;
  }
}

// Generate unique room ID
function generateRoomId() {
  return `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  onlineCounts.total++;
  
  // Send initial counts
  socket.emit('userCounts', onlineCounts);

  // Store name on socket.data (source of truth)
  socket.on('findMatch', ({ mode, name }) => {
    // Store name on socket.data as source of truth
    socket.data.name = name || 'Stranger';
    
    console.log(`User ${socket.id} (${socket.data.name}) looking for ${mode} match`);
    
    // Update counts
    const countKey = mode === 'any' ? 'video' : mode;
    onlineCounts[countKey]++;
    io.emit('userCounts', onlineCounts);

    const match = findMatch(socket.id, mode);
    
    if (match) {
      // Determine the actual chat mode based on the match
      // If user requested 'any', use the matched mode (video/audio/text)
      // Otherwise, use the requested mode
      const actualMode = mode === 'any' ? match.matchedMode : mode;
      
      // Create a room
      const roomId = generateRoomId();
      activeRooms.set(roomId, {
        users: [socket.id, match.socketId],
        mode: actualMode,
        createdAt: Date.now()
      });
      
      // Get match's name from their socket data or queue entry
      const matchSocket = io.sockets.sockets.get(match.socketId);
      const matchName = matchSocket?.data?.name || match.name || 'Stranger';
      const userName = socket.data.name || 'User';
      
      console.log(`🔵 MATCH FOUND: ${socket.id} (${userName}) matched with ${match.socketId} (${matchName}) in ${actualMode} mode`);
      
      userSessions.set(socket.id, { roomId, userId: 'user1', mode: actualMode, name: userName });
      userSessions.set(match.socketId, { roomId, userId: 'user2', mode: actualMode, name: matchName });
      
      // Notify both users with peer names and the actual chat mode
      const matchFoundData1 = { roomId, userId: 'user1', peerId: match.socketId, peerName: matchName, chatMode: actualMode };
      const matchFoundData2 = { roomId, userId: 'user2', peerId: socket.id, peerName: userName, chatMode: actualMode };
      
      console.log(`🔵 Sending matchFound to ${socket.id}:`, matchFoundData1);
      console.log(`🔵 Sending matchFound to ${match.socketId}:`, matchFoundData2);
      
      socket.emit('matchFound', matchFoundData1);
      io.to(match.socketId).emit('matchFound', matchFoundData2);
      
      console.log(`Match created: ${socket.id} (${userName}) + ${match.socketId} (${matchName}) in room ${roomId} with mode ${actualMode}`);
    } else {
      // Add to waiting queue with name
      waitingQueues[mode].push({ socketId: socket.id, requestedMode: mode, name: socket.data.name || 'User', joinedAt: Date.now() });
      socket.emit('waiting');
      console.log(`User ${socket.id} (${socket.data.name}) added to ${mode} queue`);
    }
  });

  // Handle leaving queue
  socket.on('leaveQueue', () => {
    for (const mode in waitingQueues) {
      const index = waitingQueues[mode].findIndex(u => u.socketId === socket.id);
      if (index !== -1) {
        waitingQueues[mode].splice(index, 1);
        const countKey = mode === 'any' ? 'video' : mode;
        onlineCounts[countKey] = Math.max(0, onlineCounts[countKey] - 1);
        io.emit('userCounts', onlineCounts);
        console.log(`User ${socket.id} left ${mode} queue`);
        break;
      }
    }
  });

  // Handle text messages
  socket.on('sendMessage', ({ roomId, message }) => {
    const session = userSessions.get(socket.id);
    
    if (!session) {
      console.log('🟢 SERVER: ❌ ERROR - No session found for socket!');
      return;
    }
    
    if (session.roomId !== roomId) {
      console.log(`🟢 SERVER: ❌ ERROR - Room ID mismatch! Session room: ${session.roomId}, Requested room: ${roomId}`);
      return;
    }
    
    const room = activeRooms.get(roomId);
    if (!room) {
      console.log('🟢 SERVER: ❌ ERROR - Room not found:', roomId);
      return;
    }
    
    // Use socket.id as source of truth for senderSocketId
    // Use socket.data.name (stored on server from findMatch event) as source of truth for senderName
    const payload = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text: message,
      senderSocketId: socket.id, // Source of truth - comes from server
      senderName: socket.data.name || session.name || 'Stranger', // Source of truth - from socket.data.name
      ts: Date.now(),
      roomId
    };
    
    console.log(`🟢 SERVER: 📤 Broadcasting message from ${socket.id} (${payload.senderName}) to room ${roomId}`);
    
    // Send to the other user in the room
    const otherSocketId = room.users.find(id => id !== socket.id);
    if (otherSocketId) {
      io.to(otherSocketId).emit('messageReceived', payload);
    }
    
    console.log(`🟢 SERVER: ====== MESSAGE SENT ======`);
  });

  // Handle room joining for WebRTC signaling
  socket.on('join-room', ({ roomId }) => {
    socket.join(roomId)
    console.log(`[SERVER] Socket ${socket.id} joined room ${roomId}`)
  })

  // Handle WebRTC signaling for video/audio
  // Relay to all other sockets in the room (excluding sender)
  socket.on('webrtc-offer', ({ roomId, offer }) => {
    console.log(`[SERVER] Received offer from ${socket.id} for room ${roomId}`)
    socket.to(roomId).emit('webrtc-offer', { roomId, offer, fromId: socket.id })
    console.log(`[SERVER] Relayed offer to room ${roomId}`)
  })

  socket.on('webrtc-answer', ({ roomId, answer }) => {
    console.log(`[SERVER] Received answer from ${socket.id} for room ${roomId}`)
    socket.to(roomId).emit('webrtc-answer', { roomId, answer, fromId: socket.id })
    console.log(`[SERVER] Relayed answer to room ${roomId}`)
  })

  socket.on('webrtc-ice-candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('webrtc-ice-candidate', { roomId, candidate, fromId: socket.id })
  })

  // Handle segment change
  socket.on('segmentChange', ({ roomId, segment }) => {
    const room = activeRooms.get(roomId);
    if (room) {
      room.users.forEach(userId => {
        if (userId !== socket.id) {
          io.to(userId).emit('segmentChanged', { segment });
        }
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    onlineCounts.total = Math.max(0, onlineCounts.total - 1);
    
    const session = userSessions.get(socket.id);
    
    // Remove from queues
    socket.emit('leaveQueue');
    
    if (session) {
      const room = activeRooms.get(session.roomId);
      if (room) {
        // Notify other user
        room.users.forEach(userId => {
          if (userId !== socket.id) {
            io.to(userId).emit('peerDisconnected');
          }
        });
        
        // Clean up room
        activeRooms.delete(session.roomId);
        room.users.forEach(userId => {
          userSessions.delete(userId);
        });
      }
    }
    
    // Update counts for specific mode
    for (const mode in waitingQueues) {
      const index = waitingQueues[mode].findIndex(u => u.socketId === socket.id);
      if (index !== -1) {
        waitingQueues[mode].splice(index, 1);
        const countKey = mode === 'any' ? 'video' : mode;
        onlineCounts[countKey] = Math.max(0, onlineCounts[countKey] - 1);
        break;
      }
    }
    
    io.emit('userCounts', onlineCounts);
  });

  // Handle leaving room
  socket.on('leaveRoom', ({ roomId }) => {
    const session = userSessions.get(socket.id);
    
    if (session && session.roomId === roomId) {
      const room = activeRooms.get(roomId);
      if (room) {
        // Notify the other user that their peer left
        const otherSocketId = room.users.find(id => id !== socket.id);
        if (otherSocketId) {
          // Notify other user to go back to waiting (not disconnect)
          io.to(otherSocketId).emit('peerLeft');
          console.log(`User ${socket.id} left room ${roomId}, notifying ${otherSocketId} to find new match`);
        }
        
        // Clean up room
        activeRooms.delete(roomId);
        room.users.forEach(userId => {
          userSessions.delete(userId);
        });
      }
    }
    if (session && session.roomId === roomId) {
      const room = activeRooms.get(roomId);
      if (room) {
        room.users.forEach(userId => {
          if (userId !== socket.id) {
            io.to(userId).emit('peerLeft');
          }
        });
        activeRooms.delete(roomId);
        room.users.forEach(userId => {
          userSessions.delete(userId);
        });
      }
    }
  });
});

// REST API for reports
app.post('/api/reports', (req, res) => {
  const report = {
    id: `RPT-${Date.now()}`,
    timestamp: new Date().toISOString(),
    ...req.body
  };
  reports.push(report);
  res.json({ success: true, report });
});

app.get('/api/reports', (req, res) => {
  res.json(reports);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', onlineUsers: onlineCounts.total });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.io server ready`);
});
