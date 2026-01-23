import { useState, useEffect, useRef } from 'react'
import LandingScreen from './components/LandingScreen'
import WaitingScreen from './components/WaitingScreen'
import ChatScreen from './components/ChatScreen'
import AdminScreen from './components/AdminScreen'
import ReportModal from './components/ReportModal'
import ConfirmModal from './components/ConfirmModal'
import SuccessMessage from './components/SuccessMessage'
import PasswordModal from './components/PasswordModal'
import { useSocket } from './contexts/SocketContext'
import { initSounds, playMatchSound } from './lib/sounds'
import './App.css'

type Screen = 'landing' | 'waiting' | 'chat' | 'admin'
type ChatMode = 'video' | 'audio' | 'text' | 'any' | null

interface Message {
  id?: string
  sender: 'system' | 'user1' | 'user2' // Keep for backward compatibility
  senderSocketId?: string // Source of truth for determining if message is own
  senderName?: string // Source of truth for display name
  text: string
  ts?: number
  isOwn?: boolean // Computed on client side
}

interface Report {
  id: string
  timestamp: string
  reasons: string[]
  details: string
}

interface UserCounts {
  total: number
  video: number
  audio: number
  text: number
}

function App() {
  const { socket, connected } = useSocket()
  const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'
  const [screen, setScreen] = useState<Screen>('landing')
  const [chatMode, setChatMode] = useState<ChatMode>(null)
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
  const [userCounts, setUserCounts] = useState<UserCounts>({
    total: 0,
    video: 0,
    audio: 0,
    text: 0
  })
  const [roomId, setRoomId] = useState<string | null>(null)
  const [userId, setUserId] = useState<'user1' | 'user2' | null>(null)
  const [peerId, setPeerId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [peerName, setPeerName] = useState<string | null>(null)

  const timerRef = useRef<number | null>(null)
  const userIdRef = useRef<'user1' | 'user2' | null>(null)
  const roundRef = useRef<number>(1)
  
  // Keep refs in sync with state
  useEffect(() => {
    userIdRef.current = userId
  }, [userId])
  
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

  // Fetch reports on mount and when entering admin screen
  const fetchReports = () => {
    fetch(`${SERVER_URL}/api/reports`)
      .then(res => res.json())
      .then(data => setReports(data))
      .catch(err => console.error('Failed to fetch reports:', err))
  }

  useEffect(() => {
    fetchReports()
  }, [])

  // Refresh reports when entering admin screen
  useEffect(() => {
    if (screen === 'admin') {
      fetchReports()
    }
  }, [screen])

  // Socket event listeners
  useEffect(() => {
    if (!socket) return

    socket.on('userCounts', (counts: UserCounts) => {
      setUserCounts(counts)
    })

    socket.on('waiting', () => {
      setScreen('waiting')
    })

    socket.on('matchFound', ({ roomId: matchedRoomId, userId: matchedUserId, peerId: matchedPeerId, peerName: matchedPeerName, chatMode: matchedChatMode }) => {
      console.log('Match found!', { roomId: matchedRoomId, userId: matchedUserId, peerId: matchedPeerId, peerName: matchedPeerName, chatMode: matchedChatMode, socketId: socket?.id })
      
      // Use the chat mode from server (for 'any' mode, this will be video/audio/text based on what was available)
      const actualChatMode = matchedChatMode || chatMode
      setChatMode(actualChatMode as ChatMode)
      
      setRoomId(matchedRoomId)
      setUserId(matchedUserId)
      setPeerId(matchedPeerId)
      setPeerName(matchedPeerName || null)
      setScreen('chat')
      setCurrentSegment(0)
      setRound(1)
      setTimeRemaining(60)
      
      playMatchSound()
      
      if (actualChatMode === 'text' || actualChatMode === 'any') {
        const welcomeMsg = matchedUserId === 'user1' 
          ? 'Connected! You will start sharing first.'
          : 'Connected! Wait for the other person to start.'
        setMessages([{ sender: 'system', text: welcomeMsg }])
      }
    })

    socket.on('messageReceived', (msg: { id?: string, senderSocketId: string, senderName: string, text: string, ts?: number, roomId?: string }) => {
      // Determine if message is own by comparing socket IDs (source of truth)
      const isOwn = msg.senderSocketId === socket?.id
      
      console.log('🔵 RECEIVED MESSAGE:', { 
        senderSocketId: msg.senderSocketId, 
        mySocketId: socket?.id,
        isOwn,
        senderName: msg.senderName,
        text: msg.text 
      })
      
      setMessages(prev => {
        const newMessage: Message = { 
          id: msg.id,
          sender: 'user1', // Keep for compatibility
          senderSocketId: msg.senderSocketId,
          senderName: msg.senderName ?? 'Stranger',
          text: msg.text,
          ts: msg.ts,
          isOwn // Store isOwn in message for easy access
        }
        
        console.log('🔵 Adding received message:', { 
          newMessage, 
          isOwn,
          displayAs: isOwn ? userName : newMessage.senderName
        })
        
        const updated = [...prev, newMessage]
        return updated
      })
    })

    socket.on('peerDisconnected', ({ chatMode }: { chatMode?: string }) => {
      // Show on-screen notification
      setSuccessMessage('The other person has left the chat. Finding a new match...')
      setShowSuccessMessage(true)
      
      // Clean up current chat state
      if (socket && roomId) {
        socket.emit('leaveRoom', { roomId })
      }
      
      setMessages([])
      setCurrentSegment(0)
      setTimeRemaining(60)
      setRoomId(null)
      setUserId(null)
      setPeerId(null)
      setPeerName(null)
      
      // Auto-match in the same chat type
      if (chatMode && socket) {
        // Use userName if available, otherwise try localStorage
        let nameToUse = userName
        if (!nameToUse) {
          try {
            nameToUse = localStorage.getItem('onetwoone_name')?.trim() || 'User'
          } catch {
            nameToUse = 'User'
          }
        }
        
        // Set the chat mode and start matching
        setChatMode(chatMode as ChatMode)
        socket.emit('findMatch', { mode: chatMode, name: nameToUse })
        setScreen('waiting')
      } else {
        // If no chat mode provided, go back to landing
        setChatMode(null)
        setScreen('landing')
      }
    })

    socket.on('peerLeft', () => {
      // Other user left the room - go back to waiting to find new match
      setMessages([])
      setCurrentSegment(0)
      setRound(1)
      setTimeRemaining(60)
      setRoomId(null)
      setUserId(null)
      setPeerId(null)
      setPeerName(null)
      
      if (chatMode) {
        // Use userName if available, otherwise try localStorage
        let nameToUse = userName
        if (!nameToUse) {
          try {
            nameToUse = localStorage.getItem('onetwoone_name')?.trim() || 'User'
          } catch {
            nameToUse = 'User'
          }
        }
        socket?.emit('findMatch', { mode: chatMode, name: nameToUse })
        setScreen('waiting')
      }
    })

    socket.on('segmentChanged', ({ segment, round: newRound }: { segment: number, round?: number }) => {
      setCurrentSegment(segment)
      if (newRound !== undefined) {
        setRound(newRound)
      }
      setTimeRemaining(60)
    })

    return () => {
      socket.off('userCounts')
      socket.off('waiting')
      socket.off('matchFound')
      socket.off('messageReceived')
      socket.off('peerDisconnected')
      socket.off('peerLeft')
      socket.off('segmentChanged')
    }
  }, [socket, chatMode])

  // Timer for segments
  useEffect(() => {
    if (screen !== 'chat') {
      // Clear timer if not in chat screen
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }

    // Create the timer interval
    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        const newTime = prev - 1
        
        if (newTime <= 0) {
          // Time's up - move to next segment
          setCurrentSegment(prevSegment => {
            const nextSegment = (prevSegment + 1) % 4
            const isNewRound = prevSegment === 3 && nextSegment === 0
            
            // Increment round if we completed segment 4 (going from 3 to 0)
            if (isNewRound) {
              setRound(prevRound => {
                const newRound = prevRound + 1
                // Notify peer about segment change with new round
                if (socket && roomId) {
                  socket.emit('segmentChange', { 
                    roomId, 
                    segment: nextSegment,
                    round: newRound
                  })
                }
                return newRound
              })
            } else {
              // Notify peer about segment change (same round)
              if (socket && roomId) {
                socket.emit('segmentChange', { 
                  roomId, 
                  segment: nextSegment,
                  round: roundRef.current
                })
              }
            }
            
            return nextSegment
          })
          
          return 60 // Reset timer to 60 seconds
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
  }, [screen, socket, roomId, round]) // Include round in dependencies

  const startChat = (mode: Exclude<ChatMode, null>, name: string) => {
    if (!socket) {
      alert('Initializing connection... Please wait a moment and try again.')
      return
    }
    
    // Only allow starting if connected
    if (!connected) {
      alert('Please wait for the server connection to be established.')
      return
    }
    
    // Ensure we have a name - try localStorage if not provided
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
    
    // Set the mode and clear previous state
    setChatMode(mode)
    setUserName(finalName)
    setPeerName(null)
    setMessages([])
    setCurrentSegment(0)
    setTimeRemaining(60)
    setRoomId(null)
    setUserId(null)
    setPeerId(null)
    
    // Emit the findMatch event - socket.io will queue it if not connected yet
    // Server will store this name in socket.data.name
    socket.emit('findMatch', { mode, name: finalName })
  }

  const handleNext = () => {
    setConfirmModal({
      title: 'Move to Next Person',
      message: 'Are you sure you want to move on to the next person?',
      confirmText: 'Yes, Next',
      cancelText: 'Cancel',
      onConfirm: () => {
        setConfirmModal(null)
        if (socket && roomId) {
          socket.emit('leaveRoom', { roomId })
        }
        
        setMessages([])
        setCurrentSegment(0)
        setRound(1)
        setTimeRemaining(60)
        setRoomId(null)
        setUserId(null)
        setPeerId(null)
        setPeerName(null)
        
        if (chatMode) {
          // Use userName if available, otherwise try localStorage
          let nameToUse = userName
          if (!nameToUse) {
            try {
              nameToUse = localStorage.getItem('onetwoone_name')?.trim() || 'User'
            } catch {
              nameToUse = 'User'
            }
          }
          socket?.emit('findMatch', { mode: chatMode, name: nameToUse })
          setScreen('waiting')
        }
      }
    })
  }

  const handleEnd = () => {
    setConfirmModal({
      title: 'End Session',
      message: 'Are you sure you want to end your session?',
      confirmText: 'Yes, End',
      cancelText: 'Cancel',
      onConfirm: () => {
        setConfirmModal(null)
        if (socket && roomId) {
          socket.emit('leaveRoom', { roomId })
        }
        
        if (socket) {
          socket.emit('leaveQueue')
        }
        
        setScreen('landing')
        setMessages([])
        setCurrentSegment(0)
        setRound(1)
        setTimeRemaining(60)
        setChatMode(null)
        setRoomId(null)
        setUserId(null)
        setPeerId(null)
        setPeerName(null)
      }
    })
  }

  const handleReport = () => {
    setShowReportModal(true)
  }

  const submitReport = async (reportData: { reasons: string[], details: string }) => {
    try {
      const response = await fetch(`${SERVER_URL}/api/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reportData),
      })
      
      const result = await response.json()
      if (result.success) {
        setReports(prev => [result.report, ...prev])
        setShowReportModal(false)
        setSuccessMessage('Report submitted. Thank you for keeping our community safe.')
        setShowSuccessMessage(true)
        
        // Clean up chat state and navigate to landing page
        if (socket && roomId) {
          socket.emit('leaveRoom', { roomId })
        }
        if (socket) {
          socket.emit('leaveQueue')
        }
        
        // Auto navigate to landing page after showing message
        setTimeout(() => {
          setScreen('landing')
          setMessages([])
          setCurrentSegment(0)
          setRound(1)
          setTimeRemaining(60)
          setChatMode(null)
          setRoomId(null)
          setUserId(null)
          setPeerId(null)
          setPeerName(null)
          setShowSuccessMessage(false)
        }, 2000)
      }
    } catch (error) {
      console.error('Failed to submit report:', error)
      setSuccessMessage('Failed to submit report. Please try again.')
      setShowSuccessMessage(true)
      setTimeout(() => {
        setShowSuccessMessage(false)
      }, 2000)
    }
  }

  const handleSkip = () => {
    console.log('[App] handleSkip called, currentSegment:', currentSegment)
    const nextSegment = (currentSegment + 1) % 4
    const isNewRound = currentSegment === 3 && nextSegment === 0
    const newRound = isNewRound ? round + 1 : round
    
    console.log('[App] Moving to next segment:', nextSegment, 'round:', newRound)
    setCurrentSegment(nextSegment)
    setTimeRemaining(60)
    
    if (isNewRound) {
      setRound(newRound)
    }
    
    if (socket && roomId) {
      console.log('[App] Emitting segmentChange event:', { roomId, segment: nextSegment, round: newRound })
      socket.emit('segmentChange', { roomId, segment: nextSegment, round: newRound })
    } else {
      console.warn('[App] Cannot emit segmentChange - missing socket or roomId', { socket: !!socket, roomId })
    }
  }

  const sendMessage = (text: string) => {
    if (!socket || !roomId) {
      console.log('Cannot send - missing:', { socket: !!socket, roomId })
      return
    }

    // Add message locally with socket.id as source of truth
    const messageId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const newMessage: Message = {
      id: messageId,
      sender: userId || 'user1', // Keep for compatibility
      senderSocketId: socket.id, // Source of truth
      senderName: userName || 'You',
      text: text,
      ts: Date.now(),
      isOwn: true // This is our own message
    }
    
    console.log('🟢 SENDING MESSAGE:', { socketId: socket.id, userName, text, roomId })
    setMessages(prev => {
      const updated = [...prev, newMessage]
      return updated
    })
    
    // Send to server - server will use socket.id as source of truth
    socket.emit('sendMessage', { roomId, message: text })
  }

  return (
    <div className="app-container">
      <div className="bg-animation"></div>
      
      {!connected && (
        <div style={{ 
          position: 'fixed', 
          top: 10, 
          right: 10, 
          padding: '10px 15px', 
          background: '#ff4444', 
          color: 'white', 
          borderRadius: '5px',
          zIndex: 9999,
          fontSize: '0.875rem',
          fontWeight: 600
        }}>
          ⚠️ Connecting to server...
          <div style={{ fontSize: '0.75rem', marginTop: '4px', opacity: 0.9 }}>
            Make sure the server is running
          </div>
        </div>
      )}
      
      {screen === 'landing' && (
        <LandingScreen
          userCounts={userCounts}
          onStartChat={startChat}
          onShowAdmin={() => setShowPasswordModal(true)}
          connected={connected}
        />
      )}
      
      {screen === 'waiting' && (
        <WaitingScreen 
          onBack={() => {
            // Leave queue and go back to landing
            if (socket) {
              socket.emit('leaveQueue')
            }
            setScreen('landing')
            setChatMode(null)
            setRoomId(null)
            setUserId(null)
            setPeerId(null)
            setPeerName(null)
            setMessages([])
            setCurrentSegment(0)
            setRound(1)
            setTimeRemaining(60)
          }}
        />
      )}
      
      {screen === 'admin' && (
        <AdminScreen
          reports={reports}
          onBack={() => setScreen('landing')}
        />
      )}
      
      {screen === 'chat' && chatMode && roomId && userId && (
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
          userId={userId}
          peerId={peerId}
          socket={socket}
          userName={userName || 'You'}
          peerName={peerName || 'Stranger'}
        />
      )}
      
      
      {showReportModal && (
        <ReportModal
          onSubmit={submitReport}
          onClose={() => setShowReportModal(false)}
        />
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
