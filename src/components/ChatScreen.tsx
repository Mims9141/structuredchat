import TimerDisplay from './TimerDisplay'
import VideoChat from './VideoChat'
import AudioChat from './AudioChat'
import TextChat from './TextChat'
import './ChatScreen.css'

interface Message {
  sender: 'system' | 'user1' | 'user2'
  text: string
}

interface ChatScreenProps {
  chatMode: 'video' | 'audio' | 'text' | 'any'
  currentSegment: number
  round: number
  timeRemaining: number
  messages: Message[]
  onNext: () => void
  onEnd: () => void
  onReport: () => void
  onSkip: () => void
  onSendMessage: (text: string) => void
  roomId: string
  userId: 'user1' | 'user2' | null
  peerId: string | null
  socket: unknown // Socket.IO removed, kept for compatibility
  userName: string
  peerName: string
}

// This will be a function that generates segment descriptions based on names
const getSegmentDescription = (segment: number, userName: string, peerName: string, isUser1: boolean) => {
  switch (segment) {
    case 0:
      return isUser1 ? `${userName} speaks (${peerName} listens)` : `${peerName} speaks (${userName} listens)`
    case 1:
      return isUser1 ? `${peerName} speaks (${userName} listens)` : `${userName} speaks (${peerName} listens)`
    case 2:
      return isUser1 ? `${peerName} speaks (${userName} listens)` : `${userName} speaks (${peerName} listens)`
    case 3:
      return isUser1 ? `${userName} speaks (${peerName} listens)` : `${peerName} speaks (${userName} listens)`
    default:
      return ''
  }
}

const segments = [
  {
    label: 'Segment 1 of 4',
    canUser1Speak: true,
    canUser2Speak: false,
    canUser1Skip: true,  // User1 can skip segment 1
    canUser2Skip: false  // User2 cannot skip segment 1
  },
  {
    label: 'Segment 2 of 4',
    canUser1Speak: false,
    canUser2Speak: true,
    canUser1Skip: true,  // User1 can skip segment 2
    canUser2Skip: false  // User2 cannot skip segment 2
  },
  {
    label: 'Segment 3 of 4',
    canUser1Speak: false,
    canUser2Speak: true,
    canUser1Skip: false, // User1 cannot skip segment 3
    canUser2Skip: true   // User2 can skip segment 3
  },
  {
    label: 'Segment 4 of 4',
    canUser1Speak: true,
    canUser2Speak: false,
    canUser1Skip: false, // User1 cannot skip segment 4
    canUser2Skip: true   // User2 can skip segment 4
  }
]

function ChatScreen({ 
  chatMode, 
  currentSegment, 
  round,
  timeRemaining, 
  messages,
  onNext, 
  onEnd, 
  onReport, 
  onSkip,
  onSendMessage,
  roomId,
  userId,
  peerId,
  socket,
  userName,
  peerName
}: ChatScreenProps) {
  const segmentInfo = segments[currentSegment] || segments[0]
  
  // Generate segment label with round (only show round if > 1)
  const segmentLabel = round > 1 
    ? `${segmentInfo.label} - Round ${round}`
    : segmentInfo.label
  
  // Ensure userId is set before calculating canSpeak
  const isUser1 = userId === 'user1'
  
  // Generate description based on names
  const segmentDescription = getSegmentDescription(currentSegment, userName, peerName, isUser1)
  
  // Calculate canSpeak based on userId and segment
  // For segment 0 (1 of 4): user1 can speak, user2 cannot
  // For segment 1 (2 of 4): user2 can speak, user1 cannot
  // For segment 2 (3 of 4): user2 can speak, user1 cannot  
  // For segment 3 (4 of 4): user1 can speak, user2 cannot
  const canISpeak = userId 
    ? (isUser1 ? segmentInfo.canUser1Speak : segmentInfo.canUser2Speak)
    : false // Don't allow speaking if userId is not set yet
    
  // Calculate canSkip based on userId and segment
  // User1 can skip segments 1 and 2 (indices 0 and 1)
  // User2 can skip segments 3 and 4 (indices 2 and 3)
  const canISkip = userId 
    ? (isUser1 ? segmentInfo.canUser1Skip : segmentInfo.canUser2Skip)
    : false

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="chat-room">
      <div className="chat-header">
        <div className="chat-header-left">
          <h2>OneTwoOne</h2>
        </div>
        <div className="chat-controls">
          <button className="control-btn btn-next" onClick={onNext}>Next</button>
          <button className="control-btn btn-end" onClick={onEnd}>End</button>
          <button className="control-btn btn-report" onClick={onReport}>Report</button>
        </div>
      </div>

      <div className="chat-content">
        <TimerDisplay
          label={segmentLabel}
          description={segmentDescription}
          timeDisplay={formatTime(timeRemaining)}
          canSkip={canISkip}
          onSkip={onSkip}
        />

        {chatMode === 'video' && (
          socket ? (
            <VideoChat 
              canSpeak={canISpeak} 
              roomId={roomId}
              userId={userId}
              peerId={peerId}
              socket={socket}
              currentSegment={currentSegment}
            />
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)' }}>
              <p>Video chat requires WebRTC signaling</p>
              <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>Coming soon with Supabase Realtime</p>
            </div>
          )
        )}

        {chatMode === 'audio' && userId && (
          socket ? (
            <AudioChat 
              roomId={roomId}
              userId={userId}
              socket={socket}
              currentSegment={currentSegment}
            />
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)' }}>
              <p>Audio chat requires WebRTC signaling</p>
              <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>Coming soon with Supabase Realtime</p>
            </div>
          )
        )}

        {(chatMode === 'text' || chatMode === 'any') && (
          <TextChat
            messages={messages}
            canSpeak={canISpeak}
            onSendMessage={onSendMessage}
            userId={userId}
            userName={userName}
            peerName={peerName}
          />
        )}
      </div>
    </div>
  )
}

export default ChatScreen
