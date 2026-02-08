import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import LandingScreen from './components/LandingScreen'
import WaitingScreen from './components/WaitingScreen'
import ChatScreen from './components/ChatScreen'
import AdminScreen from './components/AdminScreen'
import ReportModal from './components/ReportModal'
import ConfirmModal from './components/ConfirmModal'
import SuccessMessage from './components/SuccessMessage'
import PasswordModal from './components/PasswordModal'
import HealthIndicator from './components/HealthIndicator'
import MiddleDebate from './components/MiddleDebate'
import { MiddleDebateProvider } from './contexts/MiddleDebateContext'
import { useSupabase } from './contexts/SupabaseContext'
import type { Message as DbMessage, ChatMode } from './contexts/SupabaseContext'
import { supabase } from './lib/supabase'
import { initSounds, playMatchSound } from './lib/sounds'
import './App.css'

type Screen = 'landing' | 'waiting' | 'chat' | 'admin'

interface Message {
  id?: string
  sender: 'system' | 'user1' | 'user2'
  senderName?: string
  text: string
  ts?: number
  isOwn?: boolean
}

interface Report {
  id: string
  created_at: string
  reasons: string[]
  details: string
}

function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    connected,
    userId,
    userCounts,
    currentRoom,
    currentRole,
    peerName: contextPeerName,
    messages: dbMessages,
    healthStatus,
    startChat: supabaseStartChat,
    leaveRoom: supabaseLeaveRoom,
    sendMessage: supabaseSendMessage,
    submitReport: supabaseSubmitReport,
    trackPresence,
  } = useSupabase()

  const [screen, setScreen] = useState<Screen>('landing')
  const [chatMode, setChatMode] = useState<ChatMode | null>(null)
  const [currentSegment, setCurrentSegment] = useState<number>(0)
  const [round, setRound] = useState<number>(1)
  const [timeRemaining, setTimeRemaining] = useState<number>(60)
  const [messages, setMessages] = useState<Message[]>([])
  const [showReportModal, setShowReportModal] = useState<boolean>(false)
  const [showSuccessMessage, setShowSuccessMessage] = useState<boolean>(false)
  const [successMessage, setSuccessMessage] = useState<string>('')
  const [showPasswordModal, setShowPasswordModal] = useState<boolean>(false)
  const [confirmModal, setConfirmModal] = useState<{
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    onConfirm: () => void
  } | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [roomId, setRoomId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<'user1' | 'user2' | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [peerName, setPeerName] = useState<string | null>(null)
  const [isWaitingForMatch, setIsWaitingForMatch] = useState(false)
  const [middleDebateRoomId, setMiddleDebateRoomId] = useState<string | null>(null)

  const timerRef = useRef<number | null>(null)
  const roundRef = useRef<number>(1)
  const matchHandledRef = useRef(false)

  // Keep refs in sync with state
  useEffect(() => {
    roundRef.current = round
  }, [round])

  // Initialize sounds on first user interaction
  useEffect(() => {
    const handleFirstInteraction = () => {
      console.log('First user interaction detected, initializing sounds')
      initSounds()
    }
    window.addEventListener('pointerdown', handleFirstInteraction, { once: true })
    window.addEventListener('click', handleFirstInteraction, { once: true })
    window.addEventListener('touchstart', handleFirstInteraction, { once: true })
    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction)
      window.removeEventListener('click', handleFirstInteraction)
      window.removeEventListener('touchstart', handleFirstInteraction)
    }
  }, [])

  // Fetch reports from Supabase
  const fetchReports = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Failed to fetch reports:', error)
        return
      }

      setReports(data || [])
    } catch (err) {
      console.error('Failed to fetch reports:', err)
    }
  }, [])

  useEffect(() => {
    if (connected) {
      fetchReports()
    }
  }, [fetchReports, connected])

  // Refresh reports when entering admin screen
  useEffect(() => {
    if (screen === 'admin') {
      fetchReports()
    }
  }, [screen, fetchReports])

  // Sync context peer name
  useEffect(() => {
    if (contextPeerName) {
      setPeerName(contextPeerName)
    }
  }, [contextPeerName])

  // Handle room status changes from context (realtime)
  useEffect(() => {
    if (!currentRoom) return

    setRoomId(currentRoom.id)
    setChatMode(currentRoom.mode)
    setCurrentSegment(currentRoom.current_segment)

    // Calculate time remaining from segment_start_at
    if (currentRoom.segment_start_at) {
      const startTime = new Date(currentRoom.segment_start_at).getTime()
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const remaining = Math.max(0, currentRoom.segment_duration_sec - elapsed)
      setTimeRemaining(remaining)
    }

    // Handle match via realtime - when room status changes to 'matched'
    if (currentRoom.status === 'matched' && isWaitingForMatch && !matchHandledRef.current) {
      matchHandledRef.current = true
      console.log('[App] Match detected via realtime!')

      // Fetch peer name
      const fetchPeer = async () => {
        const { data: members } = await supabase
          .from('room_members')
          .select('display_name, role')
          .eq('room_id', currentRoom.id)
          .neq('user_id', userId)
          .single()

        if (members) {
          setPeerName((members as { display_name: string | null }).display_name)
        }
      }
      fetchPeer()

      setScreen('chat')
      setIsWaitingForMatch(false)
      playMatchSound()

      const welcomeMsg =
        userRole === 'user1'
          ? 'Connected! You will start sharing first.'
          : 'Connected! Wait for the other person to start.'
      setMessages([{ sender: 'system', text: welcomeMsg }])
    }

    // Handle room closed
    if (currentRoom.status === 'closed') {
      handleRoomClosed()
    }
  }, [currentRoom, isWaitingForMatch, userId, userRole])

  // Sync messages from context
  useEffect(() => {
    if (dbMessages.length > 0) {
      const convertedMessages: Message[] = dbMessages.map((msg: DbMessage) => ({
        id: msg.id,
        sender: msg.user_id === userId ? 'user1' : 'user2',
        senderName: msg.display_name || 'Stranger',
        text: msg.text,
        ts: new Date(msg.created_at).getTime(),
        isOwn: msg.user_id === userId,
      }))
      setMessages(convertedMessages)
    }
  }, [dbMessages, userId])

  // Sync current role from context
  useEffect(() => {
    if (currentRole) {
      setUserRole(currentRole)
    }
  }, [currentRole])

  // Timer for segments
  useEffect(() => {
    if (screen !== 'chat') {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }

    timerRef.current = window.setInterval(() => {
      setTimeRemaining((prev) => {
        const newTime = prev - 1

        if (newTime <= 0) {
          // Time's up - only user1 advances segment
          if (userRole === 'user1') {
            handleAdvanceSegment()
          }
          return 60 // Reset timer
        }

        return newTime
      })
    }, 1000)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [screen, userRole])

  const handleRoomClosed = () => {
    setSuccessMessage('The other person has left the chat.')
    setShowSuccessMessage(true)

    setMessages([])
    setCurrentSegment(0)
    setRound(1)
    setTimeRemaining(60)
    setRoomId(null)
    setUserRole(null)
    setPeerName(null)
    setIsWaitingForMatch(false)
    matchHandledRef.current = false
    setScreen('landing')
    trackPresence(null)
  }

  const handleAdvanceSegment = async () => {
    const nextSegment = (currentSegment + 1) % 4
    const isNewRound = currentSegment === 3 && nextSegment === 0
    const newRound = isNewRound ? round + 1 : round

    setCurrentSegment(nextSegment)
    setTimeRemaining(60)

    if (isNewRound) {
      setRound(newRound)
    }

    // Update room in database
    if (roomId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('rooms') as any)
        .update({
          current_segment: nextSegment,
          segment_start_at: new Date().toISOString(),
        })
        .eq('id', roomId)
    }
  }

  const startChat = async (mode: ChatMode, name: string) => {
    if (!connected) {
      alert('Please wait for the connection to be established.')
      return
    }

    let finalName = name.trim()
    if (!finalName) {
      try {
        finalName = localStorage.getItem('onetwoone_name')?.trim() || 'User'
      } catch {
        finalName = 'User'
      }
    }

    // Save name to localStorage
    try {
      localStorage.setItem('onetwoone_name', finalName)
    } catch (error) {
      console.warn('Failed to save name to localStorage:', error)
    }

    setChatMode(mode)
    setUserName(finalName)
    setPeerName(null)
    setMessages([])
    setCurrentSegment(0)
    setRound(1)
    setTimeRemaining(60)
    setRoomId(null)
    setUserRole(null)
    matchHandledRef.current = false

    // Call Supabase matchmaking
    const result = await supabaseStartChat(mode, finalName)

    if (!result) {
      alert('Failed to start chat. Please try again.')
      return
    }

    console.log('[App] Matchmaking result:', result)
    setUserRole(result.role as 'user1' | 'user2')

    if (result.matched) {
      // Already matched!
      setRoomId(result.roomId)
      setPeerName(result.peerName)
      setChatMode(result.chatMode)
      setScreen('chat')
      setIsWaitingForMatch(false)
      playMatchSound()

      const welcomeMsg =
        result.role === 'user1'
          ? 'Connected! You will start sharing first.'
          : 'Connected! Wait for the other person to start.'
      setMessages([{ sender: 'system', text: welcomeMsg }])
    } else {
      // Waiting for match - realtime subscription will detect match
      setRoomId(result.roomId)
      setIsWaitingForMatch(true)
      setScreen('waiting')
    }
  }

  const handleNext = () => {
    setConfirmModal({
      title: 'Move to Next Person',
      message: 'Are you sure you want to move on to the next person?',
      confirmText: 'Yes, Next',
      cancelText: 'Cancel',
      onConfirm: async () => {
        setConfirmModal(null)
        await supabaseLeaveRoom()

        setMessages([])
        setCurrentSegment(0)
        setRound(1)
        setTimeRemaining(60)
        setRoomId(null)
        setUserRole(null)
        setPeerName(null)
        matchHandledRef.current = false

        if (chatMode && userName) {
          // Re-queue for matching
          const result = await supabaseStartChat(chatMode, userName)
          if (result) {
            setUserRole(result.role as 'user1' | 'user2')
            if (result.matched) {
              setRoomId(result.roomId)
              setPeerName(result.peerName)
              setScreen('chat')
              playMatchSound()
            } else {
              setRoomId(result.roomId)
              setIsWaitingForMatch(true)
              setScreen('waiting')
            }
          }
        }
      },
    })
  }

  const handleEnd = () => {
    setConfirmModal({
      title: 'End Session',
      message: 'Are you sure you want to end your session?',
      confirmText: 'Yes, End',
      cancelText: 'Cancel',
      onConfirm: async () => {
        setConfirmModal(null)
        await supabaseLeaveRoom()

        setScreen('landing')
        setMessages([])
        setCurrentSegment(0)
        setRound(1)
        setTimeRemaining(60)
        setChatMode(null)
        setRoomId(null)
        setUserRole(null)
        setPeerName(null)
        setIsWaitingForMatch(false)
        matchHandledRef.current = false
        trackPresence(null)
      },
    })
  }

  const handleReport = () => {
    setShowReportModal(true)
  }

  const submitReport = async (reportData: { reasons: string[]; details: string }) => {
    try {
      await supabaseSubmitReport(reportData.reasons, reportData.details)

      setShowReportModal(false)
      setSuccessMessage('Report submitted. Thank you for keeping our community safe.')
      setShowSuccessMessage(true)

      // Clean up chat state
      await supabaseLeaveRoom()

      // Auto navigate to landing page
      setTimeout(() => {
        setScreen('landing')
        setMessages([])
        setCurrentSegment(0)
        setRound(1)
        setTimeRemaining(60)
        setChatMode(null)
        setRoomId(null)
        setUserRole(null)
        setPeerName(null)
        setShowSuccessMessage(false)
        trackPresence(null)
      }, 2000)
    } catch (error) {
      console.error('Failed to submit report:', error)
      setSuccessMessage('Failed to submit report. Please try again.')
      setShowSuccessMessage(true)
      setTimeout(() => {
        setShowSuccessMessage(false)
      }, 2000)
    }
  }

  const handleSkip = async () => {
    if (userRole !== 'user1') {
      console.log('[App] Only user1 can skip segments')
      return
    }
    await handleAdvanceSegment()
  }

  const sendMessage = async (text: string) => {
    if (!roomId || !userName) {
      console.log('Cannot send - missing:', { roomId, userName })
      return
    }

    // Add message locally first for instant feedback
    const messageId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const newMessage: Message = {
      id: messageId,
      sender: 'user1',
      senderName: userName,
      text: text,
      ts: Date.now(),
      isOwn: true,
    }

    setMessages((prev) => [...prev, newMessage])

    // Send to Supabase
    await supabaseSendMessage(text, userName)
  }

  const handleWaitingBack = async () => {
    await supabaseLeaveRoom()

    setScreen('landing')
    setChatMode(null)
    setRoomId(null)
    setUserRole(null)
    setPeerName(null)
    setMessages([])
    setCurrentSegment(0)
    setRound(1)
    setTimeRemaining(60)
    setIsWaitingForMatch(false)
    matchHandledRef.current = false
    trackPresence(null)
  }

  return (
    <div className="app-container">
      <div className="bg-animation"></div>

      {/* Health indicator - shows in dev mode or on error */}
      <HealthIndicator status={healthStatus} userId={userId} />

      {!connected && (
        <div
          style={{
            position: 'fixed',
            top: 10,
            right: 10,
            padding: '10px 15px',
            background: healthStatus.authStatus === 'error' ? '#ff4444' : '#ffaa00',
            color: 'white',
            borderRadius: '5px',
            zIndex: 9999,
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          {healthStatus.authStatus === 'error' ? '✗ Connection Error' : '○ Connecting...'}
          <div style={{ fontSize: '0.75rem', marginTop: '4px', opacity: 0.9 }}>
            {healthStatus.authError || 'Initializing session'}
          </div>
        </div>
      )}

      {location.pathname === '/middle-debate' && (
        <MiddleDebateProvider roomId={middleDebateRoomId} userId={userId}>
          <MiddleDebate
            connected={connected}
            onBack={() => {
              navigate('/')
              setMiddleDebateRoomId(null)
            }}
            roomId={middleDebateRoomId}
            setRoomId={setMiddleDebateRoomId}
          />
        </MiddleDebateProvider>
      )}

      {screen === 'landing' && location.pathname !== '/middle-debate' && (
        <LandingScreen
          userCounts={userCounts}
          onStartChat={startChat}
          onShowAdmin={() => setShowPasswordModal(true)}
          onShowMiddleDebate={() => navigate('/middle-debate')}
          connected={connected}
        />
      )}

      {screen === 'waiting' && <WaitingScreen onBack={handleWaitingBack} />}

      {screen === 'admin' && <AdminScreen reports={reports} onBack={() => setScreen('landing')} />}

      {screen === 'chat' && chatMode && roomId && userRole && (
        <ChatScreen
          chatMode={chatMode}
          currentSegment={currentSegment}
          round={round}
          timeRemaining={timeRemaining}
          messages={messages}
          onNext={handleNext}
          onEnd={handleEnd}
          onReport={handleReport}
          onSkip={handleSkip}
          onSendMessage={sendMessage}
          roomId={roomId}
          userId={userRole}
          peerId={null}
          socket={null}
          userName={userName || 'You'}
          peerName={peerName || 'Stranger'}
        />
      )}

      {showReportModal && (
        <ReportModal onSubmit={submitReport} onClose={() => setShowReportModal(false)} />
      )}

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          cancelText={confirmModal.cancelText}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {showSuccessMessage && (
        <SuccessMessage
          message={successMessage}
          onClose={() => setShowSuccessMessage(false)}
          autoCloseDelay={3000}
        />
      )}

      {showPasswordModal && (
        <PasswordModal
          onSuccess={() => {
            setShowPasswordModal(false)
            setScreen('admin')
          }}
          onCancel={() => setShowPasswordModal(false)}
        />
      )}
    </div>
  )
}

export default App
