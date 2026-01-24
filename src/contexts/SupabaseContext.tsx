import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { supabase, ensureAnonymousSession, isSupabaseConfigured } from '../lib/supabase'
import type { RealtimeChannel, RealtimePresenceState } from '@supabase/supabase-js'

// Simple types without strict database typing
export type ChatMode = 'video' | 'audio' | 'text' | 'any'
export type RoomStatus = 'waiting' | 'matched' | 'closed'
export type UserRole = 'user1' | 'user2'

export interface Room {
  id: string
  created_at: string
  status: RoomStatus
  mode: ChatMode
  segment_start_at: string | null
  current_segment: number
  segment_duration_sec: number
}

export interface Message {
  id: string
  room_id: string
  user_id: string | null
  display_name: string | null
  text: string
  created_at: string
}

interface UserCounts {
  total: number
  video: number
  audio: number
  text: number
}

interface MatchResult {
  roomId: string
  role: UserRole
  matched: boolean
  peerName: string | null
  chatMode: ChatMode
}

// Health status for debugging
export interface HealthStatus {
  configured: boolean
  authStatus: 'initializing' | 'authenticated' | 'error'
  authError: string | null
  presenceChannel: 'disconnected' | 'connecting' | 'connected' | 'error'
  roomChannel: 'disconnected' | 'connecting' | 'connected' | 'error'
  currentRoomId: string | null
  currentRoomStatus: RoomStatus | null
}

interface SupabaseContextType {
  connected: boolean
  userId: string | null
  userCounts: UserCounts
  currentRoom: Room | null
  currentRole: UserRole | null
  peerName: string | null
  messages: Message[]
  healthStatus: HealthStatus
  startChat: (mode: ChatMode, displayName: string) => Promise<MatchResult | null>
  leaveRoom: () => Promise<void>
  sendMessage: (text: string, displayName: string) => Promise<void>
  advanceSegment: () => Promise<void>
  submitReport: (reasons: string[], details: string) => Promise<void>
  trackPresence: (mode: ChatMode | null) => void
}

const defaultCounts: UserCounts = { total: 0, video: 0, audio: 0, text: 0 }

const defaultHealthStatus: HealthStatus = {
  configured: isSupabaseConfigured(),
  authStatus: 'initializing',
  authError: null,
  presenceChannel: 'disconnected',
  roomChannel: 'disconnected',
  currentRoomId: null,
  currentRoomStatus: null,
}

const SupabaseContext = createContext<SupabaseContextType>({
  connected: false,
  userId: null,
  userCounts: defaultCounts,
  currentRoom: null,
  currentRole: null,
  peerName: null,
  messages: [],
  healthStatus: defaultHealthStatus,
  startChat: async () => null,
  leaveRoom: async () => {},
  sendMessage: async () => {},
  advanceSegment: async () => {},
  submitReport: async () => {},
  trackPresence: () => {},
})

export const useSupabase = () => useContext(SupabaseContext)

interface SupabaseProviderProps {
  children: ReactNode
}

export const SupabaseProvider = ({ children }: SupabaseProviderProps) => {
  const [connected, setConnected] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [userCounts, setUserCounts] = useState<UserCounts>(defaultCounts)
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null)
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null)
  const [peerName, setPeerName] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [healthStatus, setHealthStatus] = useState<HealthStatus>(defaultHealthStatus)

  const presenceChannelRef = useRef<RealtimeChannel | null>(null)
  const roomChannelRef = useRef<RealtimeChannel | null>(null)
  const currentModeRef = useRef<ChatMode | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const authInitializedRef = useRef(false)

  // Update health status helper
  const updateHealth = useCallback((updates: Partial<HealthStatus>) => {
    setHealthStatus((prev) => ({ ...prev, ...updates }))
  }, [])

  // Initialize anonymous session with retry logic
  useEffect(() => {
    if (authInitializedRef.current) return
    authInitializedRef.current = true

    const initSession = async (retryCount = 0) => {
      const maxRetries = 3
      const retryDelay = 1000 * Math.pow(2, retryCount) // Exponential backoff

      try {
        updateHealth({ authStatus: 'initializing', authError: null })

        if (!isSupabaseConfigured()) {
          throw new Error('Supabase not configured. Check environment variables.')
        }

        const session = await ensureAnonymousSession()
        if (session?.user) {
          setUserId(session.user.id)
          setConnected(true)
          updateHealth({ authStatus: 'authenticated', authError: null })
          console.log('[Supabase] Connected with user ID:', session.user.id)
        } else {
          throw new Error('No session returned')
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[Supabase] Auth init failed (attempt ${retryCount + 1}):`, errorMessage)

        if (retryCount < maxRetries) {
          console.log(`[Supabase] Retrying in ${retryDelay}ms...`)
          setTimeout(() => initSession(retryCount + 1), retryDelay)
        } else {
          updateHealth({ authStatus: 'error', authError: errorMessage })
          setConnected(false)
        }
      }
    }

    initSession()

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUserId(session.user.id)
        setConnected(true)
        updateHealth({ authStatus: 'authenticated', authError: null })
      } else {
        setUserId(null)
        setConnected(false)
        updateHealth({ authStatus: 'initializing' })
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [updateHealth])

  // Setup presence channel with reconnect logic
  useEffect(() => {
    if (!connected || !userId) return

    const setupPresenceChannel = () => {
      updateHealth({ presenceChannel: 'connecting' })

      const channel = supabase.channel('online', {
        config: {
          presence: {
            key: userId,
          },
        },
      })

      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState<{ mode: ChatMode | null }>()
          const counts = calculateCounts(state)
          setUserCounts(counts)
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            updateHealth({ presenceChannel: 'connected' })
            await channel.track({ mode: currentModeRef.current })
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            updateHealth({ presenceChannel: 'error' })
            // Attempt reconnect after delay
            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current)
            }
            reconnectTimeoutRef.current = window.setTimeout(() => {
              console.log('[Supabase] Reconnecting presence channel...')
              setupPresenceChannel()
            }, 3000)
          }
        })

      presenceChannelRef.current = channel
    }

    setupPresenceChannel()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      presenceChannelRef.current?.unsubscribe()
      updateHealth({ presenceChannel: 'disconnected' })
    }
  }, [connected, userId, updateHealth])

  const calculateCounts = (state: RealtimePresenceState<{ mode: ChatMode | null }>): UserCounts => {
    let total = 0
    let video = 0
    let audio = 0
    let text = 0

    Object.values(state).forEach((presences) => {
      presences.forEach((presence: { mode: ChatMode | null }) => {
        total++
        if (presence.mode === 'video') video++
        else if (presence.mode === 'audio') audio++
        else if (presence.mode === 'text') text++
      })
    })

    return { total, video, audio, text }
  }

  const trackPresence = useCallback(async (mode: ChatMode | null) => {
    currentModeRef.current = mode
    if (presenceChannelRef.current) {
      await presenceChannelRef.current.track({ mode })
    }
  }, [])

  // Subscribe to room with reconnect logic
  const subscribeToRoom = useCallback(
    (roomId: string) => {
      if (roomChannelRef.current) {
        roomChannelRef.current.unsubscribe()
      }

      updateHealth({
        roomChannel: 'connecting',
        currentRoomId: roomId,
      })

      const channel = supabase.channel(`room:${roomId}`)

      channel
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'rooms',
            filter: `id=eq.${roomId}`,
          },
          (payload) => {
            const updatedRoom = payload.new as Room
            console.log('[Supabase] Room updated:', updatedRoom.status)
            setCurrentRoom(updatedRoom)
            updateHealth({ currentRoomStatus: updatedRoom.status })

            if (updatedRoom.status === 'closed') {
              console.log('[Supabase] Room closed via realtime')
              setCurrentRoom(null)
              setCurrentRole(null)
              setPeerName(null)
              setMessages([])
              updateHealth({ currentRoomId: null, currentRoomStatus: null })
            }

            // Handle match notification - if room status changes to 'matched'
            if (updatedRoom.status === 'matched') {
              console.log('[Supabase] Room matched via realtime!')
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            const newMessage = payload.new as Message
            setMessages((prev) => {
              // Avoid duplicates
              if (prev.some((m) => m.id === newMessage.id)) return prev
              return [...prev, newMessage]
            })
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'room_members',
            filter: `room_id=eq.${roomId}`,
          },
          () => {
            console.log('[Supabase] Room member deleted - peer may have left')
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            updateHealth({ roomChannel: 'connected' })
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            updateHealth({ roomChannel: 'error' })
            // Attempt reconnect
            setTimeout(() => {
              if (currentRoom?.id === roomId) {
                console.log('[Supabase] Reconnecting room channel...')
                subscribeToRoom(roomId)
              }
            }, 3000)
          }
        })

      roomChannelRef.current = channel
    },
    [updateHealth, currentRoom?.id]
  )

  const startChat = useCallback(
    async (mode: ChatMode, displayName: string): Promise<MatchResult | null> => {
      if (!userId) {
        console.error('[Supabase] Cannot start chat: not authenticated')
        return null
      }

      try {
        // Call the matchmaking RPC
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.rpc as any)('match_or_create_room', {
          p_mode: mode,
          p_display_name: displayName,
        })

        if (error) {
          console.error('[Supabase] Matchmaking error:', error)
          return null
        }

        if (!data || (Array.isArray(data) && data.length === 0)) {
          console.error('[Supabase] No result from matchmaking')
          return null
        }

        // Handle both array and single object response
        const result = Array.isArray(data) ? data[0] : data
        console.log('[Supabase] Matchmaking result:', result)

        // Fetch the room
        const { data: roomData } = await supabase
          .from('rooms')
          .select('*')
          .eq('id', result.room_id)
          .single()

        if (roomData) {
          const room = roomData as Room
          setCurrentRoom(room)
          setCurrentRole(result.role as UserRole)
          setPeerName(result.peer_name)
          setMessages([])
          updateHealth({
            currentRoomId: room.id,
            currentRoomStatus: room.status,
          })

          // Subscribe to room changes (for both waiting and matched states)
          subscribeToRoom(result.room_id)
          trackPresence(result.chat_mode as ChatMode)
        }

        return {
          roomId: result.room_id,
          role: result.role as UserRole,
          matched: result.matched,
          peerName: result.peer_name,
          chatMode: result.chat_mode as ChatMode,
        }
      } catch (error) {
        console.error('[Supabase] startChat error:', error)
        return null
      }
    },
    [userId, subscribeToRoom, trackPresence, updateHealth]
  )

  const leaveRoom = useCallback(async () => {
    if (!currentRoom) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('leave_room', { p_room_id: currentRoom.id })

      if (roomChannelRef.current) {
        roomChannelRef.current.unsubscribe()
        roomChannelRef.current = null
      }

      setCurrentRoom(null)
      setCurrentRole(null)
      setPeerName(null)
      setMessages([])
      updateHealth({
        roomChannel: 'disconnected',
        currentRoomId: null,
        currentRoomStatus: null,
      })
      trackPresence(null)
    } catch (error) {
      console.error('[Supabase] leaveRoom error:', error)
    }
  }, [currentRoom, trackPresence, updateHealth])

  const sendMessage = useCallback(
    async (text: string, displayName: string) => {
      if (!currentRoom || !userId) return

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from('messages') as any).insert({
          room_id: currentRoom.id,
          user_id: userId,
          display_name: displayName,
          text,
        })

        if (error) {
          console.error('[Supabase] sendMessage error:', error)
        }
      } catch (error) {
        console.error('[Supabase] sendMessage error:', error)
      }
    },
    [currentRoom, userId]
  )

  const advanceSegment = useCallback(async () => {
    if (!currentRoom || currentRole !== 'user1') return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)('advance_segment', {
        p_room_id: currentRoom.id,
      })

      if (error) {
        console.error('[Supabase] advanceSegment error:', error)
      }
    } catch (error) {
      console.error('[Supabase] advanceSegment error:', error)
    }
  }, [currentRoom, currentRole])

  const submitReport = useCallback(async (reasons: string[], details: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('reports') as any).insert({
        reasons,
        details,
      })

      if (error) {
        console.error('[Supabase] submitReport error:', error)
        throw error
      }
    } catch (error) {
      console.error('[Supabase] submitReport error:', error)
      throw error
    }
  }, [])

  const contextValue: SupabaseContextType = {
    connected,
    userId,
    userCounts,
    currentRoom,
    currentRole,
    peerName,
    messages,
    healthStatus,
    startChat,
    leaveRoom,
    sendMessage,
    advanceSegment,
    submitReport,
    trackPresence,
  }

  return <SupabaseContext.Provider value={contextValue}>{children}</SupabaseContext.Provider>
}
