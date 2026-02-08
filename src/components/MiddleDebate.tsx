import { useState, useEffect, useRef } from 'react'
import { useMiddleDebate } from '../contexts/MiddleDebateContext'
import type { DebateRole } from '../contexts/MiddleDebateContext'
import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import './MiddleDebate.css'

const DEBATE_SEGMENT_SEC = 120
const QNA_SEGMENT_SEC = 600

function formatRoomId(id: string): string {
  return id.slice(0, 8).toUpperCase()
}

interface MiddleDebateProps {
  connected: boolean
  onBack: () => void
  roomId: string | null
  setRoomId: (id: string | null) => void
}

export default function MiddleDebate({ connected, onBack, roomId, setRoomId }: MiddleDebateProps) {
  const {
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
    setCurrentQuestion,
    clearDebateState,
  } = useMiddleDebate()

  const [screen, setScreen] = useState<'entry' | 'waiting' | 'room'>('entry')
  const [role, setRole] = useState<DebateRole | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [numSegments, setNumSegments] = useState(6)
  const [debateTitle, setDebateTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [browseRooms, setBrowseRooms] = useState<Array<{ id: string; title: string | null; status: string; created_at: string }>>([])
  const [entryTab, setEntryTab] = useState<'watch' | 'debate'>('watch')
  const [chatInput, setChatInput] = useState('')
  const [questionInput, setQuestionInput] = useState('')
  const [timeRemaining, setTimeRemaining] = useState(DEBATE_SEGMENT_SEC)
  const timerRef = useRef<number | null>(null)

  // Camera/mic and WebRTC for debaters
  const localStreamRef = useRef<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const debaterViewerPcMapRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const signalingChannelRef = useRef<RealtimeChannel | null>(null)
  const webrtcSetupDoneRef = useRef(false)
  // For viewers: one remote video per debater
  const remoteVideoARef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoBRef = useRef<HTMLVideoElement | null>(null)
  const viewerPcMapRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const viewerAnnounceTimeoutsRef = useRef<number[]>([])

  const isSpeaker = role === 'speaker_a' || role === 'speaker_b'
  const canAdvanceSegment = isSpeaker && currentRoom?.status === 'live' && role === 'speaker_a'
  const speakerAName = participants.find((p) => p.role === 'speaker_a')?.display_name ?? 'Speaker A'
  const speakerBName = participants.find((p) => p.role === 'speaker_b')?.display_name ?? 'Speaker B'
  const currentSpeaker: 'speaker_a' | 'speaker_b' =
    currentRoom?.status === 'live'
      ? currentRoom.current_segment % 2 === 0
        ? 'speaker_a'
        : 'speaker_b'
      : 'speaker_a'
  const isMyTurn = role === currentSpeaker && currentRoom?.status === 'live'
  const isQna = currentRoom?.status === 'qna'

  // Timer from segment_start_at
  useEffect(() => {
    if (!currentRoom?.segment_start_at || (currentRoom.status !== 'live' && currentRoom.status !== 'qna')) return
    const duration = currentRoom.status === 'qna' ? QNA_SEGMENT_SEC : currentRoom.segment_duration_sec
    const update = () => {
      const start = new Date(currentRoom.segment_start_at!).getTime()
      const elapsed = Math.floor((Date.now() - start) / 1000)
      const remaining = Math.max(0, duration - elapsed)
      setTimeRemaining(remaining)
    }
    update()
    timerRef.current = window.setInterval(update, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [currentRoom?.id, currentRoom?.segment_start_at, currentRoom?.status, currentRoom?.current_segment])

  // After create: we have roomId from parent; show waiting until status is live
  useEffect(() => {
    if (!roomId || !currentRoom) return
    if (currentRoom.status === 'waiting') setScreen('waiting')
    else if (currentRoom.status === 'live' || currentRoom.status === 'qna' || currentRoom.status === 'ended') setScreen('room')
  }, [roomId, currentRoom?.status])

  // Fetch debates for browse (when on entry, watch tab)
  useEffect(() => {
    if (screen !== 'entry' || !connected) return
    fetchDebateRooms(searchQuery).then((rooms) =>
      setBrowseRooms(rooms.map((r) => ({ id: r.id, title: r.title ?? null, status: r.status, created_at: r.created_at })))
    )
  }, [screen, connected, searchQuery, fetchDebateRooms])

  const otherDebaterUserId = participants.find(
    (p) => p.role !== role && (p.role === 'speaker_a' || p.role === 'speaker_b')
  )?.user_id
  const speakerAUserId = participants.find((p) => p.role === 'speaker_a')?.user_id
  const speakerBUserId = participants.find((p) => p.role === 'speaker_b')?.user_id
  const isViewer = role === 'viewer'

  // Get camera and mic when debater is in live room
  useEffect(() => {
    if (!isSpeaker || screen !== 'room' || !roomId) return
    let stream: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((s) => {
        stream = s
        localStreamRef.current = s
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = s
          localVideoRef.current.play().catch(() => {})
        }
      })
      .catch((err) => console.warn('[MiddleDebate] getUserMedia failed:', err))
    return () => {
      stream?.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
      if (localVideoRef.current) localVideoRef.current.srcObject = null
    }
  }, [isSpeaker, screen, roomId])

  // Mute/unmute based on turn: during live debate only current speaker is heard; during Q&A both
  useEffect(() => {
    const stream = localStreamRef.current
    if (!stream || !isSpeaker) return
    const shouldUnmute = isQna || currentSpeaker === role
    stream.getAudioTracks().forEach((t) => {
      t.enabled = shouldUnmute
    })
  }, [isSpeaker, isQna, currentSpeaker, role])

  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]

  // WebRTC signaling and peer connection for debaters (to other debater + to viewers)
  useEffect(() => {
    if (!isSpeaker || !roomId || !userId || !otherDebaterUserId) return
    webrtcSetupDoneRef.current = false
    const channel = supabase.channel(`debate:${roomId}:webrtc`)
    signalingChannelRef.current = channel
    const viewerPcs = debaterViewerPcMapRef.current

    const sendSignal = (to: string, kind: 'offer' | 'answer' | 'ice', data: unknown) => {
      channel.send({
        type: 'broadcast',
        event: 'webrtc-signal',
        payload: { to, from: userId, kind, ...(typeof data === 'object' && data !== null ? data : { data }) },
      })
    }

    channel.on('broadcast', { event: 'viewer-joined' }, ({ payload }) => {
      const viewerUserId = payload.userId as string
      if (!viewerUserId || viewerUserId === userId) return
      const stream = localStreamRef.current
      if (!stream) return
      const pc = new RTCPeerConnection({ iceServers })
      pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal(viewerUserId, 'ice', { candidate: e.candidate.toJSON() })
      }
      stream.getTracks().forEach((t) => pc.addTrack(t, stream))
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          sendSignal(viewerUserId, 'offer', { sdp: pc.localDescription })
          viewerPcs.set(viewerUserId, pc)
        })
        .catch((err) => console.error('[MiddleDebate] debater->viewer offer:', err))
    })

    channel.on('broadcast', { event: 'webrtc-signal' }, async ({ payload }) => {
      if (payload.to !== userId) return
      const from = payload.from as string
      const kind = payload.kind as 'offer' | 'answer' | 'ice'
      const pcForViewer = from !== otherDebaterUserId ? viewerPcs.get(from) : null
      const pcForDebater = from === otherDebaterUserId ? pcRef.current : null

      if (kind === 'offer' && payload.sdp) {
        if (from !== otherDebaterUserId) return
        try {
          const pc = new RTCPeerConnection({ iceServers })
          pc.ontrack = (e) => {
            const r = remoteVideoRef.current
            if (r && e.streams[0]) {
              r.srcObject = e.streams[0]
              r.play().catch(() => {})
            }
          }
          pc.onicecandidate = (e) => {
            if (e.candidate) sendSignal(from, 'ice', { candidate: e.candidate.toJSON() })
          }
          const stream = localStreamRef.current
          if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream))
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp as RTCSessionDescriptionInit))
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          sendSignal(from, 'answer', { sdp: pc.localDescription })
          pcRef.current = pc
        } catch (err) {
          console.error('[MiddleDebate] handle offer:', err)
        }
      } else if (kind === 'answer' && payload.sdp) {
        const pc = pcForViewer ?? pcForDebater
        if (pc) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp as RTCSessionDescriptionInit))
          } catch (err) {
            console.error('[MiddleDebate] set remote answer:', err)
          }
        }
      } else if (kind === 'ice' && payload.candidate) {
        const pc = pcForViewer ?? pcForDebater
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate as RTCIceCandidateInit))
          } catch (err) {
            console.error('[MiddleDebate] addIceCandidate:', err)
          }
        }
      }
    })

    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      if (webrtcSetupDoneRef.current) return
      webrtcSetupDoneRef.current = true
      if (role === 'speaker_b') {
        const pc = new RTCPeerConnection({ iceServers })
        pc.ontrack = (e) => {
          const r = remoteVideoRef.current
          if (r && e.streams[0]) {
            r.srcObject = e.streams[0]
            r.play().catch(() => {})
          }
        }
        pc.onicecandidate = (e) => {
          if (e.candidate) sendSignal(otherDebaterUserId, 'ice', { candidate: e.candidate.toJSON() })
        }
        const stream = localStreamRef.current
        if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream))
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => sendSignal(otherDebaterUserId, 'offer', { sdp: pc.localDescription }))
          .catch((err) => console.error('[MiddleDebate] createOffer:', err))
        pcRef.current = pc
      }
    })

    return () => {
      channel.unsubscribe()
      signalingChannelRef.current = null
      pcRef.current?.close()
      pcRef.current = null
      viewerPcs.forEach((pc) => pc.close())
      viewerPcs.clear()
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    }
  }, [isSpeaker, roomId, userId, otherDebaterUserId, role])

  // WebRTC for viewers: receive streams from both debaters
  useEffect(() => {
    if (!isViewer || !roomId || !userId || !speakerAUserId || !speakerBUserId) return
    const channel = supabase.channel(`debate:${roomId}:webrtc`)
    signalingChannelRef.current = channel
    const viewerPcs = viewerPcMapRef.current

    const sendSignal = (to: string, kind: 'offer' | 'answer' | 'ice', data: unknown) => {
      channel.send({
        type: 'broadcast',
        event: 'webrtc-signal',
        payload: { to, from: userId, kind, ...(typeof data === 'object' && data !== null ? data : { data }) },
      })
    }

    channel.on('broadcast', { event: 'webrtc-signal' }, async ({ payload }) => {
      if (payload.to !== userId) return
      const from = payload.from as string
      const kind = payload.kind as 'offer' | 'answer' | 'ice'
      const isFromA = from === speakerAUserId
      const isFromB = from === speakerBUserId
      if (!isFromA && !isFromB) return

      if (kind === 'offer' && payload.sdp) {
        try {
          const pc = new RTCPeerConnection({ iceServers })
          const videoRef = isFromA ? remoteVideoARef : remoteVideoBRef
          pc.ontrack = (e) => {
            const r = videoRef.current
            if (r && e.streams[0]) {
              r.srcObject = e.streams[0]
              r.play().catch(() => {})
            }
          }
          pc.onicecandidate = (e) => {
            if (e.candidate) sendSignal(from, 'ice', { candidate: e.candidate.toJSON() })
          }
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp as RTCSessionDescriptionInit))
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          sendSignal(from, 'answer', { sdp: pc.localDescription })
          viewerPcs.set(from, pc)
        } catch (err) {
          console.error('[MiddleDebate] viewer handle offer:', err)
        }
      } else if (kind === 'ice' && payload.candidate) {
        const pc = viewerPcs.get(from)
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate as RTCIceCandidateInit))
          } catch (err) {
            console.error('[MiddleDebate] viewer addIceCandidate:', err)
          }
        }
      }
    })

    const announceViewer = () => {
      channel.send({
        type: 'broadcast',
        event: 'viewer-joined',
        payload: { userId },
      })
    }

    viewerAnnounceTimeoutsRef.current = []
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      announceViewer()
      viewerAnnounceTimeoutsRef.current.push(window.setTimeout(announceViewer, 2000))
      viewerAnnounceTimeoutsRef.current.push(window.setTimeout(announceViewer, 5000))
    })

    return () => {
      viewerAnnounceTimeoutsRef.current.forEach(clearTimeout)
      viewerAnnounceTimeoutsRef.current = []
      channel.unsubscribe()
      signalingChannelRef.current = null
      viewerPcs.forEach((pc) => pc.close())
      viewerPcs.clear()
      if (remoteVideoARef.current) remoteVideoARef.current.srcObject = null
      if (remoteVideoBRef.current) remoteVideoBRef.current.srcObject = null
    }
  }, [isViewer, roomId, userId, speakerAUserId, speakerBUserId])

  const handleCreate = async () => {
    const name = displayName.trim() || 'Debater'
    const result = await createDebateRoom(numSegments, name, debateTitle.trim() || undefined)
    if (result) {
      setRoomId(result.roomId)
      setRole('speaker_a')
      setScreen('waiting')
    } else {
      alert('Failed to create room. Try again.')
    }
  }

  const handleWatchRoom = async (roomIdToWatch: string) => {
    const name = displayName.trim() || 'Viewer'
    const result = await joinDebateRoom(roomIdToWatch, name, true)
    if (result) {
      setRoomId(roomIdToWatch)
      setRole('viewer')
      setScreen('room')
    } else {
      alert('Failed to join. Try again.')
    }
  }

  const handleJoin = async (asViewer = false) => {
    const raw = joinCode.trim()
    if (!raw) {
      alert('Paste the Room ID from the host')
      return
    }
    // Accept full UUID (with or without dashes)
    const uuid = raw.replace(/-/g, '')
    const roomIdToJoin =
      uuid.length === 32
        ? raw.includes('-')
          ? raw
          : `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`
        : null
    if (!roomIdToJoin) {
      alert('Enter the full Room ID (paste from the host).')
      return
    }
    const name = displayName.trim() || (asViewer ? 'Viewer' : 'Debater')
    const result = await joinDebateRoom(roomIdToJoin, name, asViewer)
    if (result) {
      setRoomId(roomIdToJoin)
      setRole(result.role)
      setScreen(result.status === 'waiting' ? 'waiting' : 'room')
    } else {
      alert('Failed to join. Room may be full or invalid.')
    }
  }

  const handleBack = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    debaterViewerPcMapRef.current.forEach((pc) => pc.close())
    debaterViewerPcMapRef.current.clear()
    viewerPcMapRef.current.forEach((pc) => pc.close())
    viewerPcMapRef.current.clear()
    signalingChannelRef.current?.unsubscribe()
    signalingChannelRef.current = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    if (remoteVideoARef.current) remoteVideoARef.current.srcObject = null
    if (remoteVideoBRef.current) remoteVideoBRef.current.srcObject = null
    if (roomId) leaveDebateRoom(roomId)
    clearDebateState()
    setRoomId(null)
    setRole(null)
    setScreen('entry')
    onBack()
  }

  const handleAdvanceSegment = () => {
    if (roomId) advanceDebateSegment(roomId)
  }

  const handleSendChat = () => {
    const text = chatInput.trim()
    if (text && roomId) {
      sendDebateChat(roomId, text, displayName || (isSpeaker ? (role === 'speaker_a' ? speakerAName : speakerBName) : 'Viewer'))
      setChatInput('')
    }
  }

  const handleSubmitQuestion = () => {
    const text = questionInput.trim()
    if (text && roomId) {
      submitDebateQuestion(roomId, text, displayName || 'Viewer')
      setQuestionInput('')
    }
  }

  const handleNextQuestion = async () => {
    if (!roomId) return
    const q = await selectNextQuestion(roomId)
    setCurrentQuestion(q ?? null)
  }

  const handleMarkAnswered = () => {
    if (currentQuestion) {
      markQuestionAnswered(currentQuestion.id)
      setCurrentQuestion(null)
    }
  }

  // Entry screen – YouTube/Twitch-style: Watch (browse + search) or Create/Join debate
  if (screen === 'entry' && !roomId) {
    return (
      <div className="debate-root debate-entry">
        <div className="debate-topbar">
          <button className="debate-back" type="button" onClick={onBack}>
            ← Back
          </button>
          <div className="debate-title">
            <img src="/middle.png" alt="" className="debate-title-logo" />
            Middle Debate
          </div>
          <div className="debate-status">{connected ? 'Connected' : 'Connecting…'}</div>
        </div>

        <div className="debate-entry-tabs">
          <button
            type="button"
            className={`debate-tab ${entryTab === 'watch' ? 'active' : ''}`}
            onClick={() => setEntryTab('watch')}
          >
            Watch
          </button>
          <button
            type="button"
            className={`debate-tab ${entryTab === 'debate' ? 'active' : ''}`}
            onClick={() => setEntryTab('debate')}
          >
            Create / Join debate
          </button>
        </div>

        {entryTab === 'watch' && (
          <div className="debate-browse">
            <div className="debate-search-bar">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by debate title or room code…"
                className="debate-search-input"
              />
            </div>
            <div className="debate-grid-cards">
              {browseRooms.length === 0 && connected && (
                <div className="debate-empty">No debates right now. Create one or check back later.</div>
              )}
              {browseRooms.map((room) => (
                <div key={room.id} className="debate-card-item">
                  <div className="debate-card-thumb">
                    <span className={`debate-badge debate-badge-${room.status}`}>
                      {room.status === 'live' ? 'LIVE' : room.status === 'qna' ? 'Q&A' : 'Starting soon'}
                    </span>
                  </div>
                  <div className="debate-card-info">
                    <h3 className="debate-card-title">{room.title || 'Untitled Debate'}</h3>
                    <div className="debate-card-meta">
                      <span className="debate-card-code">{formatRoomId(room.id)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="debate-watch-btn"
                    disabled={!connected}
                    onClick={() => handleWatchRoom(room.id)}
                  >
                    Watch
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {entryTab === 'debate' && (
          <div className="debate-lobby">
            <div className="debate-card">
              <p className="debate-tagline">AI-moderated debates: fair turns, live fact-checking.</p>
              <div className="debate-field">
                <label>Your name</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Display name"
                />
              </div>

              <div className="debate-section">
                <h3>Create debate</h3>
                <div className="debate-field">
                  <label>Debate title</label>
                  <input
                    value={debateTitle}
                    onChange={(e) => setDebateTitle(e.target.value)}
                    placeholder="e.g. Climate policy debate"
                  />
                </div>
                <div className="debate-field">
                  <label>Number of segments (2 min each)</label>
                  <select value={numSegments} onChange={(e) => setNumSegments(Number(e.target.value))}>
                    {[2, 4, 6, 8, 10, 12].map((n) => (
                      <option key={n} value={n}>
                        {n} segments
                      </option>
                    ))}
                  </select>
                  <span className="debate-hint">After the last segment, Q&A runs for 10 minutes.</span>
                </div>
                <button className="debate-primary" type="button" disabled={!connected} onClick={handleCreate}>
                  Create room
                </button>
              </div>

              <div className="debate-divider" />
              <div className="debate-section">
                <h3>Have a room code? Join as debater</h3>
                <div className="debate-field">
                  <label>Room ID</label>
                  <input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    placeholder="Paste full Room ID from host"
                  />
                </div>
                <button className="debate-secondary" type="button" disabled={!connected} onClick={() => handleJoin(false)}>
                  Join as debater
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Waiting for second debater (show when we have roomId and are waiting, or room not yet loaded)
  if (screen === 'waiting' && roomId && (!currentRoom || currentRoom.status === 'waiting')) {
    return (
      <div className="debate-root">
        <div className="debate-topbar">
          <button className="debate-back" type="button" onClick={handleBack}>
            ← Back
          </button>
          <div className="debate-title">
            <img src="/middle.png" alt="" className="debate-title-logo" />
            Middle Debate · Room {formatRoomId(roomId!)}
          </div>
          <div className="debate-status">Waiting for opponent</div>
        </div>
        <div className="debate-lobby">
          <div className="debate-card">
            <h2>Share this room ID</h2>
            <div className="debate-roomcode-display debate-roomcode-full">{roomId!}</div>
            <button
              type="button"
              className="debate-copy-btn"
              onClick={() => {
                navigator.clipboard.writeText(roomId!).then(() => alert('Copied to clipboard'))
              }}
            >
              Copy room ID
            </button>
            <p className="debate-hint">Give this ID to your opponent. When they join as debater, the debate will start.</p>
            <button className="debate-secondary" type="button" onClick={handleBack}>
              Leave
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Live room
  return (
    <div className="debate-root">
      <div className="debate-topbar">
        <button className="debate-back" type="button" onClick={handleBack}>
          ← Back
        </button>
        <div className="debate-title">
          <img src="/middle.png" alt="" className="debate-title-logo" />
          Middle Debate
          {roomId ? <span className="debate-roomcode">Room {formatRoomId(roomId)}</span> : null}
        </div>
        <div className="debate-status">
          {currentRoom?.status === 'live' && (
            <span>Segment {currentRoom.current_segment + 1}/{currentRoom.num_segments} · {currentSpeaker === 'speaker_a' ? speakerAName : speakerBName}&apos;s turn</span>
          )}
          {currentRoom?.status === 'qna' && <span>Q&A · 10 min</span>}
        </div>
      </div>

      <div className="debate-grid">
        <div className="debate-stage">
          <div className="debate-stage-header">
            <div className="debate-phase">
              <strong>{currentRoom?.status?.toUpperCase() ?? '…'}</strong>
              {currentRoom?.status === 'live' && (
                <span>
                  {currentSpeaker === 'speaker_a' ? speakerAName : speakerBName} speaking · {timeRemaining}s left
                </span>
              )}
              {currentRoom?.status === 'qna' && <span>Both mics on · viewers ask questions</span>}
            </div>
            <div className="debate-timer">{timeRemaining}s</div>
            {currentRoom?.rules_text && (
              <div className="debate-rules">{currentRoom.rules_text}</div>
            )}
          </div>

          <div className="debate-speakers-row">
            <div className={`debate-speaker-card ${currentSpeaker === 'speaker_a' ? 'active' : ''}`}>
              <div className="debate-speaker-label">{speakerAName}</div>
              <div className="debate-speaker-role">Speaker A</div>
              {(isSpeaker || isViewer) && (
                <div className="debate-speaker-video">
                  {isSpeaker && role === 'speaker_a' && (
                    <video ref={localVideoRef} muted playsInline className="debate-video-el" />
                  )}
                  {isSpeaker && role === 'speaker_b' && (
                    <video ref={remoteVideoRef} playsInline className="debate-video-el" />
                  )}
                  {isViewer && (
                    <video ref={remoteVideoARef} playsInline className="debate-video-el" />
                  )}
                </div>
              )}
              {isMyTurn && role === 'speaker_a' && <div className="debate-your-turn">Your turn</div>}
            </div>
            <div className={`debate-speaker-card ${currentSpeaker === 'speaker_b' ? 'active' : ''}`}>
              <div className="debate-speaker-label">{speakerBName}</div>
              <div className="debate-speaker-role">Speaker B</div>
              {(isSpeaker || isViewer) && (
                <div className="debate-speaker-video">
                  {isSpeaker && role === 'speaker_b' && (
                    <video ref={localVideoRef} muted playsInline className="debate-video-el" />
                  )}
                  {isSpeaker && role === 'speaker_a' && (
                    <video ref={remoteVideoRef} playsInline className="debate-video-el" />
                  )}
                  {isViewer && (
                    <video ref={remoteVideoBRef} playsInline className="debate-video-el" />
                  )}
                </div>
              )}
              {isMyTurn && role === 'speaker_b' && <div className="debate-your-turn">Your turn</div>}
            </div>
          </div>

          <div className="debate-controls-row">
            {canAdvanceSegment && (
              <button className="debate-primary" type="button" onClick={handleAdvanceSegment}>
                Next segment
              </button>
            )}
            {isQna && isSpeaker && (
              <>
                <button className="debate-secondary" type="button" onClick={handleNextQuestion}>
                  Next question
                </button>
                {currentQuestion && (
                  <button className="debate-secondary" type="button" onClick={handleMarkAnswered}>
                    Mark answered
                  </button>
                )}
              </>
            )}
          </div>

          {isQna && currentQuestion && (
            <div className="debate-current-question">
              <div className="debate-panel-title">Current question</div>
              <div className="debate-question-body">
                <strong>{currentQuestion.display_name ?? 'Viewer'}:</strong> {currentQuestion.text}
              </div>
            </div>
          )}

          {factChecks.length > 0 && (
            <div className="debate-fact-checks">
              <div className="debate-panel-title">Live fact-check</div>
              {factChecks.slice(-5).reverse().map((fc) => (
                <div key={fc.id} className={`debate-fact-check verdict-${fc.verdict}`}>
                  <div className="debate-fact-claim">&ldquo;{fc.claim_text}&rdquo;</div>
                  <div className="debate-fact-meta">{fc.source_display_name} · {fc.verdict}</div>
                  {fc.summary && <div className="debate-fact-summary">{fc.summary}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="debate-side">
          <div className="debate-panel">
            <div className="debate-panel-title">Chat</div>
            <div className="debate-chat">
              {chatMessages.map((m) => (
                <div key={m.id} className="debate-chat-line">
                  <span className="debate-chat-name">{m.display_name ?? 'Someone'}</span>
                  <span className="debate-chat-text">{m.text}</span>
                </div>
              ))}
            </div>
            <div className="debate-input-row">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Comment…"
                onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
              />
              <button type="button" onClick={handleSendChat}>Send</button>
            </div>
          </div>

          <div className="debate-panel">
            <div className="debate-panel-title">Q&A</div>
            <p className="debate-hint">Submit questions anytime. During Q&A, moderators pick randomly.</p>
            <div className="debate-input-row">
              <input
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                placeholder="Ask a question…"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitQuestion()}
              />
              <button type="button" onClick={handleSubmitQuestion}>Submit</button>
            </div>
            {questions.length > 0 && (
              <div className="debate-questions-list">
                <span className="debate-hint">{questions.filter((q) => !q.selected_at).length} pending</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
