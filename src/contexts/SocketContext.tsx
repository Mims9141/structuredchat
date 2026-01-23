import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextType>({ socket: null, connected: false });

export const useSocket = () => useContext(SocketContext);

interface SocketProviderProps {
  children: ReactNode;
}

export const SocketProvider = ({ children }: SocketProviderProps) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
    console.log('[SocketContext] Initializing socket connection to', SERVER_URL);
    // Use websocket first in production (HTTPS), fallback to polling
    // For HTTPS, prefer websocket; for HTTP, allow both
    const transports = SERVER_URL.startsWith('https://') 
      ? ['websocket'] 
      : ['websocket', 'polling'];
    const newSocket = io(SERVER_URL, {
      transports,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      autoConnect: true,
      timeout: 20000,
      forceNew: false
    });

    const handleConnect = () => {
      console.log('[SocketContext] ✅ Connected to server. Socket ID:', newSocket.id);
      setConnected(true);
    };

    const handleDisconnect = (reason: string) => {
      console.log('[SocketContext] ❌ Disconnected from server. Reason:', reason);
      setConnected(false);
    };

    const handleConnectError = (error: Error) => {
      console.error('[SocketContext] ❌ Connection error:', error.message);
      console.error('[SocketContext] Make sure the server is running on', SERVER_URL);
      console.error('[SocketContext] Full error:', error);
      setConnected(false);
    };

    const handleReconnect = (attemptNumber: number) => {
      console.log('[SocketContext] ✅ Reconnected to server after', attemptNumber, 'attempts');
      setConnected(true);
    };

    const handleReconnectAttempt = (attemptNumber: number) => {
      console.log('[SocketContext] 🔄 Attempting to reconnect... (attempt', attemptNumber, ')');
    };

    newSocket.on('connect', handleConnect);
    newSocket.on('disconnect', handleDisconnect);
    newSocket.on('connect_error', handleConnectError);
    newSocket.on('reconnect', handleReconnect);
    newSocket.on('reconnect_attempt', handleReconnectAttempt);

    // Set initial connection state
    setConnected(newSocket.connected);
    setSocket(newSocket);

    return () => {
      // Clean up event listeners before closing
      newSocket.off('connect', handleConnect);
      newSocket.off('disconnect', handleDisconnect);
      newSocket.off('connect_error', handleConnectError);
      newSocket.off('reconnect', handleReconnect);
      newSocket.off('reconnect_attempt', handleReconnectAttempt);
      
      // Only close if socket is actually connected
      if (newSocket.connected) {
        newSocket.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    if (!socket) return
    console.log("[SOCKET] created", socket.id)

    const onConnect = () => console.log("[SOCKET] connected", socket.id)
    const onDisconnect = (r: any) => console.log("[SOCKET] disconnected", r)

    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)

    return () => {
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
    }
  }, [socket])

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
};
