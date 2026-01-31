import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export type DebateRoomStatus = 'waiting' | 'live' | 'qna' | 'ended'
export type DebateRole = 'speaker_a' | 'speaker_b' | 'viewer'

export interface DebateRoom {
  id: string
  created_at: string
  status: DebateRoomStatus
  num_segments: number
  current_segment: number
  segment_start_at: string | null
  segment_duration_sec: number
  qna_duration_sec: number
  rules_text: string | null
  title: string | null
}

export interface DebateParticipant {
  room_id: string
  user_id: string
  display_name: string | null
  role: DebateRole
  joined_at: string
}

export interface DebateChatMessage {
  id: string
  room_id: string
  user_id: string | null
  display_name: string | null
  text: string
  created_at: string
}

export interface DebateQuestion {
  id: string
  room_id: string
  user_id: string | null
  display_name: string | null
  text: string
  created_at: string
  selected_at: string | null
  answered_at: string | null
}

export interface DebateFactCheck {
  id: string
  room_id: string
  claim_text: string
  source_display_name: string | null
  source_role: string | null
  verdict: 'true' | 'false' | 'unverified' | 'pending'
  summary: string | null
  sources_json: unknown
  created_at: string
}

interface MiddleDebateContextType {
  // State
  userId: string | null
  currentRoom: DebateRoom | null
  participants: DebateParticipant[]
  chatMessages: DebateChatMessage[]
  questions: DebateQuestion[]
  factChecks: DebateFactCheck[]
  currentQuestion: DebateQuestion | null
  // Actions
  createDebateRoom: (numSegments: number, displayName: string, title?: string) => Promise<{ roomId: string } | null>
  joinDebateRoom: (roomId: string, displayName: string, asViewer: boolean) => Promise<{ role: DebateRole; status: DebateRoomStatus; numSegments: number } | null>
  fetchDebateRooms: (searchQuery?: string) => Promise<DebateRoom[]>
  leaveDebateRoom: (roomId: string) => Promise<void>
  advanceDebateSegment: (roomId: string) => Promise<void>
  sendDebateChat: (roomId: string, text: string, displayName: string) => Promise<void>
  submitDebateQuestion: (roomId: string, text: string, displayName: string) => Promise<void>
  selectNextQuestion: (roomId: string) => Promise<DebateQuestion | null>
  markQuestionAnswered: (questionId: string) => Promise<void>
  submitFactCheck: (roomId: string, claimText: string, sourceDisplayName: string, sourceRole: string) => Promise<void>
  // Helpers
  setCurrentQuestion: (q: DebateQuestion | null) => void
  clearDebateState: () => void
}

const defaultContext: MiddleDebateContextType = {
  userId: null,
  currentRoom: null,
  participants: [],
  chatMessages: [],
  questions: [],
  factChecks: [],
  currentQuestion: null,
  createDebateRoom: async () => null,
  joinDebateRoom: async () => null,
  fetchDebateRooms: async () => [],
  leaveDebateRoom: async () => {},
  advanceDebateSegment: async () => {},
  sendDebateChat: async () => {},
  submitDebateQuestion: async () => {},
  selectNextQuestion: async () => null,
  markQuestionAnswered: async () => {},
  submitFactCheck: async () => {},
  setCurrentQuestion: () => {},
  clearDebateState: () => {},
}

const MiddleDebateContext = createContext<MiddleDebateContextType>(defaultContext)

export const useMiddleDebate = () => useContext(MiddleDebateContext)

interface MiddleDebateProviderProps {
  children: ReactNode
  roomId: string | null
  userId: string | null
}

export const MiddleDebateProvider = ({ children, roomId, userId }: MiddleDebateProviderProps) => {
  const [currentRoom, setCurrentRoom] = useState<DebateRoom | null>(null)
  const [participants, setParticipants] = useState<DebateParticipant[]>([])
  const [chatMessages, setChatMessages] = useState<DebateChatMessage[]>([])
  const [questions, setQuestions] = useState<DebateQuestion[]>([])
  const [factChecks, setFactChecks] = useState<DebateFactCheck[]>([])
  const [currentQuestion, setCurrentQuestionState] = useState<DebateQuestion | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

  const clearDebateState = useCallback(() => {
    setCurrentRoom(null)
    setParticipants([])
    setChatMessages([])
    setQuestions([])
    setFactChecks([])
    setCurrentQuestionState(null)
    if (channelRef.current) {
      channelRef.current.unsubscribe()
      channelRef.current = null
    }
  }, [])

  // Subscribe to room + chat + questions + fact_checks when roomId changes
  useEffect(() => {
    if (!roomId || !userId) return

    const channel = supabase.channel(`debate:${roomId}`)

    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'debate_rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
            const newRoom = payload.new as DebateRoom | null
            if (newRoom) setCurrentRoom(newRoom)
            else setCurrentRoom(null)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'debate_chat', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const msg = payload.new as DebateChatMessage
          setChatMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev
            return [...prev, msg]
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'debate_questions', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const q = payload.new as DebateQuestion
          setQuestions((prev) => {
            if (prev.some((x) => x.id === q.id)) return prev
            return [...prev, q]
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'debate_questions', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const updated = payload.new as DebateQuestion
          setQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)))
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'debate_fact_checks', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const fc = payload.new as DebateFactCheck
          setFactChecks((prev) => [...prev, fc])
        }
      )
      .subscribe()

    channelRef.current = channel

    // Initial fetch
    const fetchRoom = async () => {
      const { data: room } = await supabase.from('debate_rooms').select('*').eq('id', roomId).single()
      if (room) setCurrentRoom(room as DebateRoom)
    }
    const fetchParticipants = async () => {
      const { data } = await supabase.from('debate_participants').select('*').eq('room_id', roomId)
      setParticipants((data as DebateParticipant[]) || [])
    }
    const fetchChat = async () => {
      const { data } = await supabase.from('debate_chat').select('*').eq('room_id', roomId).order('created_at', { ascending: true })
      setChatMessages((data as DebateChatMessage[]) || [])
    }
    const fetchQuestions = async () => {
      const { data } = await supabase.from('debate_questions').select('*').eq('room_id', roomId).order('created_at', { ascending: true })
      setQuestions((data as DebateQuestion[]) || [])
    }
    const fetchFactChecks = async () => {
      const { data } = await supabase.from('debate_fact_checks').select('*').eq('room_id', roomId).order('created_at', { ascending: true })
      setFactChecks((data as DebateFactCheck[]) || [])
    }

    fetchRoom()
    fetchParticipants()
    fetchChat()
    fetchQuestions()
    fetchFactChecks()

    return () => {
      channel.unsubscribe()
      channelRef.current = null
    }
  }, [roomId, userId])

  const createDebateRoom = useCallback(async (numSegments: number, displayName: string, title?: string) => {
    try {
      // Single 3-param RPC (p_title has DEFAULT). Run migration 004 if you see PGRST203.
      const params: { p_num_segments: number; p_display_name: string; p_title?: string } = {
        p_num_segments: numSegments,
        p_display_name: displayName,
      }
      const t = title?.trim()
      if (t) params.p_title = t

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('create_debate_room', params)
      if (error) {
        console.error('[MiddleDebate] create_debate_room error:', error)
        return null
      }
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.room_id) return null
      return { roomId: row.room_id }
    } catch (e) {
      console.error('[MiddleDebate] createDebateRoom:', e)
      return null
    }
  }, [])

  const fetchDebateRooms = useCallback(async (searchQuery?: string): Promise<DebateRoom[]> => {
    try {
      const { data, error } = await supabase
        .from('debate_rooms')
        .select('*')
        .in('status', ['waiting', 'live', 'qna'])
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) {
        console.error('[MiddleDebate] fetchDebateRooms error:', error)
        return []
      }
      const rooms = (data as DebateRoom[]) || []
      if (!searchQuery?.trim()) return rooms
      const q = searchQuery.trim().toLowerCase()
      return rooms.filter(
        (r) =>
          (r.title?.toLowerCase().includes(q) ?? false) ||
          r.id.toLowerCase().includes(q.replace(/-/g, ''))
      )
    } catch (e) {
      console.error('[MiddleDebate] fetchDebateRooms:', e)
      return []
    }
  }, [])

  const joinDebateRoom = useCallback(async (roomIdParam: string, displayName: string, asViewer: boolean) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('join_debate_room', {
        p_room_id: roomIdParam,
        p_display_name: displayName,
        p_as_viewer: asViewer,
      })
      if (error) {
        console.error('[MiddleDebate] join_debate_room error:', error)
        return null
      }
      const row = Array.isArray(data) ? data[0] : data
      if (!row) return null
      return {
        role: row.role as DebateRole,
        status: row.status as DebateRoomStatus,
        numSegments: row.num_segments ?? 6,
      }
    } catch (e) {
      console.error('[MiddleDebate] joinDebateRoom:', e)
      return null
    }
  }, [])

  const leaveDebateRoom = useCallback(async (roomIdParam: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('leave_debate_room', { p_room_id: roomIdParam })
    } catch (e) {
      console.error('[MiddleDebate] leaveDebateRoom:', e)
    }
  }, [])

  const advanceDebateSegment = useCallback(async (roomIdParam: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('advance_debate_segment', { p_room_id: roomIdParam })
    } catch (e) {
      console.error('[MiddleDebate] advanceDebateSegment:', e)
    }
  }, [])

  const sendDebateChat = useCallback(async (roomIdParam: string, text: string, displayName: string) => {
    if (!userId) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('debate_chat') as any).insert({
        room_id: roomIdParam,
        user_id: userId,
        display_name: displayName,
        text,
      })
    } catch (e) {
      console.error('[MiddleDebate] sendDebateChat:', e)
    }
  }, [userId])

  const submitDebateQuestion = useCallback(async (roomIdParam: string, text: string, displayName: string) => {
    if (!userId) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('debate_questions') as any).insert({
        room_id: roomIdParam,
        user_id: userId,
        display_name: displayName,
        text,
      })
    } catch (e) {
      console.error('[MiddleDebate] submitDebateQuestion:', e)
    }
  }, [userId])

  const selectNextQuestion = useCallback(async (roomIdParam: string): Promise<DebateQuestion | null> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('select_next_debate_question', { p_room_id: roomIdParam })
      if (error || !data?.length) return null
      const row = data[0]
      const q: DebateQuestion = {
        id: row.question_id,
        room_id: roomIdParam,
        user_id: null,
        display_name: row.display_name ?? null,
        text: row.question_text,
        created_at: '',
        selected_at: new Date().toISOString(),
        answered_at: null,
      }
      return q
    } catch (e) {
      console.error('[MiddleDebate] selectNextQuestion:', e)
      return null
    }
  }, [])

  const markQuestionAnswered = useCallback(async (questionId: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('mark_debate_question_answered', { p_question_id: questionId })
    } catch (e) {
      console.error('[MiddleDebate] markQuestionAnswered:', e)
    }
  }, [])

  const submitFactCheck = useCallback(async (roomIdParam: string, claimText: string, sourceDisplayName: string, sourceRole: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('debate_fact_checks') as any).insert({
        room_id: roomIdParam,
        claim_text: claimText,
        source_display_name: sourceDisplayName,
        source_role: sourceRole,
        verdict: 'pending',
        summary: null,
        sources_json: null,
      })
    } catch (e) {
      console.error('[MiddleDebate] submitFactCheck:', e)
    }
  }, [])

  const value: MiddleDebateContextType = {
    userId,
    currentRoom,
    participants,
    chatMessages,
    questions,
    factChecks,
    currentQuestion,
    createDebateRoom,
    joinDebateRoom,
    fetchDebateRooms,
    leaveDebateRoom,
    advanceDebateSegment,
    sendDebateChat,
    submitDebateQuestion,
    selectNextQuestion,
    markQuestionAnswered,
    submitFactCheck,
    setCurrentQuestion: (q) => setCurrentQuestionState(q),
    clearDebateState,
  }

  return <MiddleDebateContext.Provider value={value}>{children}</MiddleDebateContext.Provider>
}
