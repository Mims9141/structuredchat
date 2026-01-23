# OneTwoOne

A peer-to-peer chat application that enables balanced conversations between random strangers with equal time to share and listen.

## Features

- **Multiple Chat Modes**: Video, Audio, Text, or Any format
- **Real-time Matching**: Connect with random users instantly
- **Segment-based Conversations**: 4-segment structure ensuring balanced dialogue
- **WebRTC Support**: Direct peer-to-peer video and audio communication
- **Real-time Messaging**: WebSocket-based text chat
- **Admin Dashboard**: Review and manage user reports
- **Reporting System**: Users can report inappropriate behavior

## Tech Stack

### Frontend
- React 18 with TypeScript
- Vite
- Socket.io-client
- WebRTC

### Backend
- Node.js with Express
- Socket.io for WebSocket communication
- RESTful API for reports

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm

### Installation

1. **Install frontend dependencies:**
   ```bash
   npm install
   ```

2. **Install backend dependencies:**
   ```bash
   cd server
   npm install
   cd ..
   ```

### Running the Application

You need to run both the frontend and backend servers:

1. **Start the backend server** (in one terminal):
   ```bash
   cd server
   npm start
   ```
   The backend will run on `http://localhost:3001`

2. **Start the frontend development server** (in another terminal):
   ```bash
   npm run dev
   ```
   The frontend will run on `http://localhost:5173`

3. Open your browser and navigate to `http://localhost:5173`

### Development

For development with auto-reload:
- Backend: `cd server && npm run dev`
- Frontend: `npm run dev` (already has hot reload)

## Project Structure

```
onetwoone/
├── src/                 # Frontend React application
│   ├── components/      # React components
│   ├── contexts/        # React contexts (Socket)
│   └── ...
├── server/              # Backend Node.js server
│   ├── server.js        # Express + Socket.io server
│   └── package.json
└── ...
```

## Usage

1. **Start a Chat**: Choose your preferred format (Video, Audio, Text, or Any)
2. **Wait for Match**: The system will match you with another user
3. **Chat**: Engage in a 4-segment conversation structure
4. **Navigate**: Use Next to move to a new person, End to exit
5. **Report**: Report inappropriate behavior if needed

## API Endpoints

- `GET /health` - Server health check
- `POST /api/reports` - Submit a report
- `GET /api/reports` - Get all reports (admin)

## Socket Events

### Client to Server:
- `findMatch` - Request to find a match
- `leaveQueue` - Leave the waiting queue
- `sendMessage` - Send a text message
- `leaveRoom` - Leave current chat room
- `segmentChange` - Notify segment change
- `webrtc-offer` - WebRTC offer for video/audio
- `webrtc-answer` - WebRTC answer
- `webrtc-ice-candidate` - WebRTC ICE candidate

### Server to Client:
- `userCounts` - Online user counts
- `waiting` - Waiting for match
- `matchFound` - Match found
- `messageReceived` - New message received
- `peerDisconnected` - Peer disconnected
- `peerLeft` - Peer left
- `segmentChanged` - Segment changed

## License

MIT
