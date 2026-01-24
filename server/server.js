import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
const httpServer = createServer(app);

// CORS configuration - allow localhost, Vercel domains, and custom domain
const allowedOrigins = [
  'https://structuredchat.vercel.app',
  'https://onetwoone.io',
  'https://www.onetwoone.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [])
];

// Also allow any *.vercel.app domain
const isAllowedOrigin = (origin) => {
  if (!origin) return true; // Allow requests with no origin (like mobile apps or curl requests)
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
    return true;
  }
  if (origin.includes('.vercel.app')) {
    return true;
  }
  // Allow custom domain
  if (origin === 'https://onetwoone.io' || origin === 'https://www.onetwoone.io') {
    return true;
  }
  return allowedOrigins.includes(origin);
};

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'], // Support both for mobile compatibility
  allowEIO3: true, // Allow Engine.IO v3 clients (older mobile browsers)
  pingTimeout: 60000, // Increased for mobile networks
  pingInterval: 25000
});

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
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

// Function to calculate accurate user counts
function calculateUserCounts() {
  // Count users in queues by mode
  const queueCounts = {
    video: waitingQueues.video.length,
    audio: waitingQueues.audio.length,
    text: waitingQueues.text.length,
    any: waitingQueues.any.length
  };
  
  // Count users in active rooms by mode
  const roomCounts = {
    video: 0,
    audio: 0,
    text: 0
  };
  
  // Track unique users in rooms to avoid double counting
  const usersInRooms = new Set();
  
  // Count users in each active room
  for (const [roomId, room] of activeRooms.entries()) {
    room.users.forEach(userId => {
      usersInRooms.add(userId);
    });
    
    if (room.mode === 'video') {
      roomCounts.video += room.users.length;
    } else if (room.mode === 'audio') {
      roomCounts.audio += room.users.length;
    } else if (room.mode === 'text') {
      roomCounts.text += room.users.length;
    }
  }
  
  // Calculate total: all connected users on the website
  // This includes users on landing screen, in queues, and in active chats
  // Only count sockets that are actually connected (not disconnected)
  let totalConnected = 0;
  for (const [socketId, socket] of io.sockets.sockets.entries()) {
    if (socket.connected) {
      totalConnected++;
    }
  }
  
  // Calculate totals: queue + active rooms
  // Note: 'any' queue users are counted in video for display purposes
  return {
    total: totalConnected,
    video: queueCounts.video + queueCounts.any + roomCounts.video,
    audio: queueCounts.audio + roomCounts.audio,
    text: queueCounts.text + roomCounts.text
  };
}

// Function to update and broadcast user counts
function updateUserCounts() {
  onlineCounts = calculateUserCounts();
  io.emit('userCounts', onlineCounts);
  console.log('Updated user counts:', onlineCounts);
  console.log('Total connected sockets:', io.sockets.sockets.size);
  console.log('Active sockets (connected):', Array.from(io.sockets.sockets.values()).filter(s => s.connected).length);
}

// Reports storage
const reports = [];

// =========================
// Middle Debate (MVP)
// =========================
// In-memory debate rooms (for production, use a DB + SFU for scaling)
const debateRooms = new Map(); // roomCode -> roomState

function generateDebateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function debateRoomName(roomCode) {
  return `debate:${roomCode}`;
}

function getDebateState(room) {
  const now = Date.now();
  let endsAt = null;
  if (room.phase === 'debate') endsAt = room.segmentEndsAt;
  if (room.phase === 'qna') endsAt = room.qnaEndsAt;
  const secondsRemaining = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;

  return {
    roomCode: room.code,
    phase: room.phase,
    segmentsTotal: room.segmentsTotal,
    segmentIndex: room.segmentIndex,
    speaker: room.speaker,
    secondsRemaining,
    viewersCount: room.viewers.size,
    debaters: {
      debater1: room.debater1?.socketId,
      debater2: room.debater2?.socketId
    },
    currentQuestion: room.currentQuestion ?? null
  };
}

function emitDebateState(room) {
  io.to(debateRoomName(room.code)).emit('debate-state', getDebateState(room));
}

function startDebateTimer(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
  room.timer = setInterval(() => {
    const now = Date.now();
    if (room.phase === 'debate' && now >= room.segmentEndsAt) {
      if (room.segmentIndex + 1 < room.segmentsTotal) {
        room.segmentIndex += 1;
        room.speaker = room.speaker === 'debater1' ? 'debater2' : 'debater1';
        room.segmentEndsAt = Date.now() + 120000; // 2 minutes
        emitDebateState(room);
      } else {
        // Transition to QnA
        room.phase = 'qna';
        room.speaker = 'both';
        room.qnaEndsAt = Date.now() + 600000; // 10 minutes
        room.segmentEndsAt = null;
        room.currentQuestion = null;
        room.qnaOrder = [];
        room.qnaIndex = 0;
        emitDebateState(room);
      }
    }

    if (room.phase === 'qna' && now >= room.qnaEndsAt) {
      room.phase = 'ended';
      room.speaker = 'both';
      room.currentQuestion = null;
      emitDebateState(room);
      if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
      }
    }

    // Broadcast countdown updates
    if (room.phase === 'debate' || room.phase === 'qna') {
      emitDebateState(room);
    }
  }, 1000);
}

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
  
  // Update counts and send to new user
  updateUserCounts();

  // =========================
  // Middle Debate socket events
  // =========================
  socket.on('debate-create', ({ name, segmentsTotal }) => {
    const safeSegments = Math.max(2, Math.min(12, Number(segmentsTotal) || 6));
    let code = generateDebateRoomCode();
    while (debateRooms.has(code)) code = generateDebateRoomCode();

    const room = {
      code,
      createdAt: Date.now(),
      phase: 'lobby',
      segmentsTotal: safeSegments,
      segmentIndex: 0,
      speaker: 'debater1',
      segmentEndsAt: null,
      qnaEndsAt: null,
      debater1: null,
      debater2: null,
      viewers: new Map(), // socketId -> { name }
      questionsByViewer: new Map(), // socketId -> { name, questions: [] }
      currentQuestion: null,
      qnaOrder: [],
      qnaIndex: 0,
      timer: null
    };

    debateRooms.set(code, room);
    socket.emit('debate-created', { roomCode: code });
  });

  socket.on('debate-join', ({ roomCode, role, name }) => {
    const code = String(roomCode || '').trim().toUpperCase();
    const room = debateRooms.get(code);
    if (!room) {
      socket.emit('debate-joined', { roomCode: code, role: 'viewer', state: null, error: 'Room not found' });
      return;
    }

    const displayName = (name || '').toString().trim() || 'Viewer';
    socket.data.debateName = displayName;
    socket.data.debateRoom = code;

    socket.join(debateRoomName(code));

    let assignedRole = 'viewer';
    if (role === 'debater') {
      if (!room.debater1) {
        room.debater1 = { socketId: socket.id, name: displayName };
        assignedRole = 'debater1';
      } else if (!room.debater2) {
        room.debater2 = { socketId: socket.id, name: displayName };
        assignedRole = 'debater2';
      } else {
        assignedRole = 'viewer';
      }
    }

    if (assignedRole === 'viewer') {
      room.viewers.set(socket.id, { name: displayName, joinedAt: Date.now() });
      if (!room.questionsByViewer.has(socket.id)) {
        room.questionsByViewer.set(socket.id, { name: displayName, questions: [] });
      }
    }

    const state = getDebateState(room);
    socket.emit('debate-joined', { roomCode: code, role: assignedRole, state });
    emitDebateState(room);

    // Notify debaters a viewer is available for WebRTC offers
    if (assignedRole === 'viewer') {
      if (room.debater1?.socketId) io.to(room.debater1.socketId).emit('debate-viewer-joined', { viewerSocketId: socket.id });
      if (room.debater2?.socketId) io.to(room.debater2.socketId).emit('debate-viewer-joined', { viewerSocketId: socket.id });
    }
  });

  socket.on('debate-viewer-ready', ({ roomCode }) => {
    const code = String(roomCode || '').trim().toUpperCase();
    const room = debateRooms.get(code);
    if (!room) return;
    if (!room.viewers.has(socket.id)) {
      // If they reloaded and joined as viewer, this may still be true later; ignore.
      return;
    }
    if (room.debater1?.socketId) io.to(room.debater1.socketId).emit('debate-viewer-joined', { viewerSocketId: socket.id });
    if (room.debater2?.socketId) io.to(room.debater2.socketId).emit('debate-viewer-joined', { viewerSocketId: socket.id });
  });

  socket.on('debate-start', ({ roomCode }) => {
    const code = String(roomCode || '').trim().toUpperCase();
    const room = debateRooms.get(code);
    if (!room) return;
    if (room.phase !== 'lobby') return;
    if (!room.debater1 || !room.debater2) return;

    room.phase = 'debate';
    room.segmentIndex = 0;
    room.speaker = 'debater1';
    room.segmentEndsAt = Date.now() + 120000; // 2 minutes
    room.qnaEndsAt = null;
    room.currentQuestion = null;
    emitDebateState(room);
    startDebateTimer(room);
  });

  socket.on('debate-chat', ({ roomCode, text }) => {
    const code = String(roomCode || '').trim().toUpperCase();
    const room = debateRooms.get(code);
    if (!room) return;
    const msgText = (text || '').toString().trim();
    if (!msgText) return;
    const msg = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      ts: Date.now(),
      name: socket.data.debateName || socket.data.name || 'User',
      text: msgText
    };
    io.to(debateRoomName(code)).emit('debate-chat', msg);
  });

  socket.on('debate-question', ({ roomCode, text }) => {
    const code = String(roomCode || '').trim().toUpperCase();
    const room = debateRooms.get(code);
    if (!room) return;
    const q = (text || '').toString().trim();
    if (!q) return;

    // Only viewers submit questions (debaters can still see Q&A)
    if (!room.viewers.has(socket.id)) return;

    const entry = room.questionsByViewer.get(socket.id) || { name: socket.data.debateName || 'Viewer', questions: [] };
    entry.name = socket.data.debateName || entry.name;
    entry.questions.push(q);
    room.questionsByViewer.set(socket.id, entry);
  });

  socket.on('debate-qna-next', ({ roomCode }) => {
    const code = String(roomCode || '').trim().toUpperCase();
    const room = debateRooms.get(code);
    if (!room) return;
    if (room.phase !== 'qna') return;

    // Only debaters can advance questions
    const isDebater = room.debater1?.socketId === socket.id || room.debater2?.socketId === socket.id;
    if (!isDebater) return;

    // Build list of viewers with pending questions
    const viewersWithQs = [];
    for (const [viewerId, entry] of room.questionsByViewer.entries()) {
      if (entry.questions && entry.questions.length > 0) viewersWithQs.push(viewerId);
    }

    if (viewersWithQs.length === 0) {
      room.currentQuestion = null;
      emitDebateState(room);
      return;
    }

    if (!room.qnaOrder || room.qnaOrder.length === 0 || room.qnaIndex >= room.qnaOrder.length) {
      room.qnaOrder = shuffle(viewersWithQs);
      room.qnaIndex = 0;
    }

    // Ensure next viewer still has questions; if not, rebuild
    let attempts = 0;
    while (attempts < 5) {
      const viewerId = room.qnaOrder[room.qnaIndex];
      const entry = room.questionsByViewer.get(viewerId);
      if (entry && entry.questions.length > 0) {
        room.qnaIndex += 1;
        const text = entry.questions.shift();
        room.currentQuestion = { fromViewerId: viewerId, fromViewerName: entry.name || 'Viewer', text };
        emitDebateState(room);
        return;
      }
      attempts += 1;
      // Rebuild order with remaining viewers
      room.qnaOrder = shuffle(viewersWithQs);
      room.qnaIndex = 0;
    }
  });

  // WebRTC signaling (targeted)
  socket.on('debate-webrtc-offer', ({ roomCode, toId, fromRole, offer }) => {
    io.to(toId).emit('debate-webrtc-offer', { fromId: socket.id, fromRole, offer });
  });

  socket.on('debate-webrtc-answer', ({ roomCode, toId, fromRole, answer }) => {
    io.to(toId).emit('debate-webrtc-answer', { fromId: socket.id, fromRole, answer });
  });

  socket.on('debate-webrtc-ice', ({ roomCode, toId, fromRole, candidate }) => {
    io.to(toId).emit('debate-webrtc-ice', { fromId: socket.id, fromRole, candidate });
  });

  // Store name on socket.data (source of truth)
  socket.on('findMatch', ({ mode, name }) => {
    // Store name on socket.data as source of truth
    socket.data.name = name || 'Stranger';
    
    console.log(`User ${socket.id} (${socket.data.name}) looking for ${mode} match`);

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
      
      // Store both actual mode and original requested mode for auto-matching
      userSessions.set(socket.id, { roomId, userId: 'user1', mode: actualMode, originalMode: mode, name: userName });
      userSessions.set(match.socketId, { roomId, userId: 'user2', mode: actualMode, originalMode: match.requestedMode || actualMode, name: matchName });
      
      // Notify both users with peer names and the actual chat mode
      const matchFoundData1 = { roomId, userId: 'user1', peerId: match.socketId, peerName: matchName, chatMode: actualMode };
      const matchFoundData2 = { roomId, userId: 'user2', peerId: socket.id, peerName: userName, chatMode: actualMode };
      
      console.log(`🔵 Sending matchFound to ${socket.id}:`, matchFoundData1);
      console.log(`🔵 Sending matchFound to ${match.socketId}:`, matchFoundData2);
      
      socket.emit('matchFound', matchFoundData1);
      io.to(match.socketId).emit('matchFound', matchFoundData2);
      
      console.log(`Match created: ${socket.id} (${userName}) + ${match.socketId} (${matchName}) in room ${roomId} with mode ${actualMode}`);
      
      // Update counts after match (users moved from queue to room)
      updateUserCounts();
    } else {
      // Add to waiting queue with name
      waitingQueues[mode].push({ socketId: socket.id, requestedMode: mode, name: socket.data.name || 'User', joinedAt: Date.now() });
      socket.emit('waiting');
      console.log(`User ${socket.id} (${socket.data.name}) added to ${mode} queue`);
      
      // Update counts after joining queue
      updateUserCounts();
    }
  });

  // Handle leaving queue
  socket.on('leaveQueue', () => {
    for (const mode in waitingQueues) {
      const index = waitingQueues[mode].findIndex(u => u.socketId === socket.id);
      if (index !== -1) {
        waitingQueues[mode].splice(index, 1);
        console.log(`User ${socket.id} left ${mode} queue`);
        // Update counts after leaving queue
        updateUserCounts();
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
  socket.on('segmentChange', ({ roomId, segment, round }) => {
    const room = activeRooms.get(roomId);
    if (room) {
      room.users.forEach(userId => {
        if (userId !== socket.id) {
          io.to(userId).emit('segmentChanged', { segment, round: round || 1 });
        }
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // ---- Middle Debate cleanup ----
    const debateCode = socket.data?.debateRoom;
    if (debateCode && debateRooms.has(debateCode)) {
      const dRoom = debateRooms.get(debateCode);

      // Remove viewer
      if (dRoom.viewers?.has(socket.id)) {
        dRoom.viewers.delete(socket.id);
        dRoom.questionsByViewer?.delete(socket.id);
      }

      // Remove debaters
      if (dRoom.debater1?.socketId === socket.id) dRoom.debater1 = null;
      if (dRoom.debater2?.socketId === socket.id) dRoom.debater2 = null;

      // If a debater left mid-session, end the debate
      if (dRoom.phase === 'debate' || dRoom.phase === 'qna') {
        if (!dRoom.debater1 || !dRoom.debater2) {
          dRoom.phase = 'ended';
          dRoom.speaker = 'both';
          dRoom.currentQuestion = null;
          if (dRoom.timer) {
            clearInterval(dRoom.timer);
            dRoom.timer = null;
          }
        }
      }

      // Broadcast updated state
      emitDebateState(dRoom);

      // Delete empty rooms
      const hasDebaters = !!dRoom.debater1 || !!dRoom.debater2;
      const hasViewers = dRoom.viewers && dRoom.viewers.size > 0;
      if (!hasDebaters && !hasViewers) {
        if (dRoom.timer) clearInterval(dRoom.timer);
        debateRooms.delete(debateCode);
      }
    }
    
    const session = userSessions.get(socket.id);
    
    // Remove from queues
    for (const mode in waitingQueues) {
      const index = waitingQueues[mode].findIndex(u => u.socketId === socket.id);
      if (index !== -1) {
        waitingQueues[mode].splice(index, 1);
        break;
      }
    }
    
    if (session) {
      const room = activeRooms.get(session.roomId);
      if (room) {
        // Get the other user's session to find their original requested mode
        const otherSocketId = room.users.find(id => id !== socket.id);
        if (otherSocketId) {
          const otherSession = userSessions.get(otherSocketId);
          // Use originalMode if available (for 'any' users), otherwise use current mode
          const chatMode = otherSession?.originalMode || otherSession?.mode || room.mode;
          
          // Notify other user with their original chat mode so they can auto-match
          io.to(otherSocketId).emit('peerDisconnected', { chatMode });
        }
        
        // Clean up room
        activeRooms.delete(session.roomId);
        room.users.forEach(userId => {
          userSessions.delete(userId);
        });
      }
    }
    
    // Update counts after cleanup
    updateUserCounts();
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
        
        // Update counts after leaving room
        updateUserCounts();
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

// Health check endpoint for Render/deployment monitoring
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.io server ready`);
});
