import { useEffect, useMemo, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import './MiddleDebate.css'

type DebateRole = 'viewer' | 'debater1' | 'debater2'
type DebatePhase = 'lobby' | 'debate' | 'qna' | 'ended'

type DebateState = {
  roomCode: string
  phase: DebatePhase
  segmentsTotal: number
  segmentIndex: number // 0-based debate segment index
  speaker: 'debater1' | 'debater2' | 'both'
  secondsRemaining: number
  viewersCount: number
  debaters: { debater1?: string; debater2?: string }
  currentQuestion?: { fromViewerId: string; fromViewerName: string; text: string } | null
}

type ChatMessage = { id: string; ts: number; name: string; text: string }

interface MiddleDebateProps {
  socket: Socket | null
  connected: boolean
  serverUrl: string
  displayName: string
  onBack: () => void
}

export default function MiddleDebate({ socket, connected, displayName, onBack }: MiddleDebateProps) {
  const [roomCode, setRoomCode] = useState('')
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null)
  const [role, setRole] = useState<DebateRole>('viewer')
  const [segmentsTotal, setSegmentsTotal] = useState<number>(6)
  const [state, setState] = useState<DebateState | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [questionInput, setQuestionInput] = useState('')
  const [chat, setChat] = useState<ChatMessage[]>([])

  // WebRTC
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteDebater1Ref = useRef<HTMLVideoElement | null>(null)
  const remoteDebater2Ref = useRef<HTMLVideoElement | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map()) // key = peerSocketId

  const isDebater = role === 'debater1' || role === 'debater2'
  const canStart = isDebater && state?.phase === 'lobby' && !!state?.debaters.debater1 && !!state?.debaters.debater2
  const canNextQuestion = isDebater && state?.phase === 'qna'

  const normalizedRoomCode = useMemo(() => roomCode.trim().toUpperCase(), [roomCode])

  const updateMicForPhase = (phase: DebatePhase, speaker: DebateState['speaker']) => {
    const stream = localStreamRef.current
    if (!stream) return
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) return

    const shouldEnable =
      phase === 'qna'
        ? true
        : phase === 'debate'
          ? (speaker === role || speaker === 'both')
          : false

    audioTracks.forEach((t) => {
      t.enabled = shouldEnable
    })
  }

  const cleanupPeerConnections = () => {
    pcsRef.current.forEach((pc) => {
      try {
        pc.close()
      } catch {}
    })
    pcsRef.current.clear()
  }

  const stopLocalStream = () => {
    try {
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {}
    localStreamRef.current = null
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null
    }
  }

  const ensureLocalStream = async () => {
    if (!isDebater) return null
    if (localStreamRef.current) return localStreamRef.current

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    localStreamRef.current = stream
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream
      await localVideoRef.current.play().catch(() => {})
    }
    return stream
  }

  const createPeerConnection = async (peerId: string, remoteRole: DebateRole) => {
    if (pcsRef.current.has(peerId)) return pcsRef.current.get(peerId)!

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })

    pc.onicecandidate = (e) => {
      if (!e.candidate) return
      socket?.emit('debate-webrtc-ice', {
        roomCode: joinedRoom,
        toId: peerId,
        fromRole: role,
        candidate: e.candidate
      })
    }

    pc.ontrack = (e) => {
      const stream = e.streams?.[0] ?? new MediaStream([e.track])
      if (remoteRole === 'debater1' && remoteDebater1Ref.current) {
        remoteDebater1Ref.current.srcObject = stream
        remoteDebater1Ref.current.play().catch(() => {})
      }
      if (remoteRole === 'debater2' && remoteDebater2Ref.current) {
        remoteDebater2Ref.current.srcObject = stream
        remoteDebater2Ref.current.play().catch(() => {})
      }
    }

    pcsRef.current.set(peerId, pc)
    return pc
  }

  const sendOfferToViewer = async (viewerSocketId: string) => {
    if (!socket || !joinedRoom) return
    const stream = await ensureLocalStream()
    if (!stream) return

    // fromRole is debater1/debater2, viewer receives and routes stream based on that
    const fromRole = role
    const pc = await createPeerConnection(viewerSocketId, 'viewer')

    // Attach tracks if not already attached
    const senders = pc.getSenders()
    stream.getTracks().forEach((track) => {
      const already = senders.some((s) => s.track?.id === track.id)
      if (!already) pc.addTrack(track, stream)
    })

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    socket.emit('debate-webrtc-offer', {
      roomCode: joinedRoom,
      toId: viewerSocketId,
      fromRole,
      offer
    })
  }

  const sendOfferToDebaterPeer = async (peerSocketId: string, peerRole: DebateRole) => {
    if (!socket || !joinedRoom) return
    const stream = await ensureLocalStream()
    if (!stream) return

    const pc = await createPeerConnection(peerSocketId, peerRole)
    const senders = pc.getSenders()
    stream.getTracks().forEach((track) => {
      const already = senders.some((s) => s.track?.id === track.id)
      if (!already) pc.addTrack(track, stream)
    })

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    socket.emit('debate-webrtc-offer', {
      roomCode: joinedRoom,
      toId: peerSocketId,
      fromRole: role,
      offer
    })
  }

  const join = (desired: 'viewer' | 'debater') => {
    if (!socket || !connected) return
    const code = normalizedRoomCode
    if (!code) return
    socket.emit('debate-join', { roomCode: code, role: desired, name: displayName })
  }

  const createRoom = () => {
    if (!socket || !connected) return
    socket.emit('debate-create', { name: displayName, segmentsTotal })
  }

  const startDebate = () => {
    if (!socket || !joinedRoom) return
    socket.emit('debate-start', { roomCode: joinedRoom })
  }

  const sendChat = () => {
    if (!socket || !joinedRoom) return
    const text = chatInput.trim()
    if (!text) return
    socket.emit('debate-chat', { roomCode: joinedRoom, text })
    setChatInput('')
  }

  const submitQuestion = () => {
    if (!socket || !joinedRoom) return
    const text = questionInput.trim()
    if (!text) return
    socket.emit('debate-question', { roomCode: joinedRoom, text })
    setQuestionInput('')
  }

  const nextQuestion = () => {
    if (!socket || !joinedRoom) return
    socket.emit('debate-qna-next', { roomCode: joinedRoom })
  }

  useEffect(() => {
    if (!socket) return

    const onCreated = ({ roomCode: newRoomCode }: { roomCode: string }) => {
      setRoomCode(newRoomCode)
      // auto-join as debater by default (creator)
      socket.emit('debate-join', { roomCode: newRoomCode, role: 'debater', name: displayName })
    }

    const onJoined = (payload: { roomCode: string; role: DebateRole; state: DebateState }) => {
      setJoinedRoom(payload.roomCode)
      setRole(payload.role)
      setState(payload.state)
      setChat([])
      cleanupPeerConnections()

      if (payload.role === 'viewer') {
        socket.emit('debate-viewer-ready', { roomCode: payload.roomCode })
      }
    }

    const onState = (payload: DebateState) => {
      setState(payload)
      if (isDebater) {
        updateMicForPhase(payload.phase, payload.speaker)
      }

      // Debater-to-debater connection (simple: debater1 initiates to debater2)
      if (isDebater && payload.debaters.debater1 && payload.debaters.debater2) {
        const myId = socket.id
        const peerId = role === 'debater1' ? payload.debaters.debater2 : payload.debaters.debater1
        const peerRole = role === 'debater1' ? 'debater2' : 'debater1'
        if (peerId && peerId !== myId && role === 'debater1' && !pcsRef.current.has(peerId)) {
          sendOfferToDebaterPeer(peerId, peerRole)
        }
      }
    }

    const onChat = (msg: ChatMessage) => {
      setChat((prev) => [...prev, msg])
    }

    const onViewerJoined = async ({ viewerSocketId }: { viewerSocketId: string }) => {
      if (!isDebater) return
      await sendOfferToViewer(viewerSocketId)
    }

    const onOffer = async (payload: { fromId: string; fromRole: DebateRole; offer: RTCSessionDescriptionInit }) => {
      if (!socket || !joinedRoom) return
      // viewer receives offer from each debater; debaters may also receive for debater-to-debater connection in future
      const pc = await createPeerConnection(payload.fromId, payload.fromRole)

      // If we are a debater, attach local tracks so the other debater can receive our stream too
      if (isDebater) {
        const stream = await ensureLocalStream()
        if (stream) {
          const senders = pc.getSenders()
          stream.getTracks().forEach((track) => {
            const already = senders.some((s) => s.track?.id === track.id)
            if (!already) pc.addTrack(track, stream)
          })
        }
      }

      await pc.setRemoteDescription(payload.offer)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socket.emit('debate-webrtc-answer', {
        roomCode: joinedRoom,
        toId: payload.fromId,
        fromRole: role,
        answer
      })
    }

    const onAnswer = async (payload: { fromId: string; fromRole: DebateRole; answer: RTCSessionDescriptionInit }) => {
      // debater receives viewer answers for debater->viewer PCs
      const pc = pcsRef.current.get(payload.fromId)
      if (!pc) return
      await pc.setRemoteDescription(payload.answer)
    }

    const onIce = async (payload: { fromId: string; fromRole: DebateRole; candidate: RTCIceCandidateInit }) => {
      const pc = pcsRef.current.get(payload.fromId)
      if (!pc) return
      try {
        await pc.addIceCandidate(payload.candidate)
      } catch {
        // ignore
      }
    }

    socket.on('debate-created', onCreated)
    socket.on('debate-joined', onJoined)
    socket.on('debate-state', onState)
    socket.on('debate-chat', onChat)
    socket.on('debate-viewer-joined', onViewerJoined)
    socket.on('debate-webrtc-offer', onOffer)
    socket.on('debate-webrtc-answer', onAnswer)
    socket.on('debate-webrtc-ice', onIce)

    return () => {
      socket.off('debate-created', onCreated)
      socket.off('debate-joined', onJoined)
      socket.off('debate-state', onState)
      socket.off('debate-chat', onChat)
      socket.off('debate-viewer-joined', onViewerJoined)
      socket.off('debate-webrtc-offer', onOffer)
      socket.off('debate-webrtc-answer', onAnswer)
      socket.off('debate-webrtc-ice', onIce)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, connected, displayName, isDebater, joinedRoom, role])

  useEffect(() => {
    return () => {
      cleanupPeerConnections()
      stopLocalStream()
    }
  }, [])

  useEffect(() => {
    // Start local preview as soon as a debater joins a room
    if (!socket || !joinedRoom) return
    if (!isDebater) return
    ensureLocalStream().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDebater, joinedRoom, socket])

  return (
    <div className="debate-root">
      <div className="debate-topbar">
        <button className="debate-back" type="button" onClick={onBack}>
          ← Back
        </button>
        <div className="debate-title">
          Middle Debate
          {joinedRoom ? <span className="debate-roomcode">Room {joinedRoom}</span> : null}
        </div>
        <div className="debate-status">
          {connected ? 'Connected' : 'Connecting…'}
        </div>
      </div>

      {!joinedRoom ? (
        <div className="debate-lobby">
          <div className="debate-card">
            <h2>Create / Join</h2>
            <div className="debate-field">
              <label>Room code</label>
              <input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                placeholder="ABC123"
              />
            </div>
            <div className="debate-field">
              <label>Debate segments (2 min each)</label>
              <select value={segmentsTotal} onChange={(e) => setSegmentsTotal(Number(e.target.value))}>
                {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>
                    {n} segments
                  </option>
                ))}
              </select>
              <div className="debate-hint">After the last segment, Q&amp;A starts for 10 minutes.</div>
            </div>

            <div className="debate-actions">
              <button className="debate-primary" type="button" disabled={!connected} onClick={createRoom}>
                Create room
              </button>
              <button className="debate-secondary" type="button" disabled={!connected} onClick={() => join('debater')}>
                Join as debater
              </button>
              <button className="debate-secondary" type="button" disabled={!connected} onClick={() => join('viewer')}>
                Join as viewer
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="debate-grid">
          <div className="debate-stage">
            <div className="debate-stage-header">
              <div className="debate-phase">
                <strong>{state?.phase?.toUpperCase() ?? '…'}</strong>
                {state?.phase === 'debate' ? (
                  <span>
                    Segment {state.segmentIndex + 1}/{state.segmentsTotal} · Speaker:{' '}
                    <strong>{state.speaker}</strong>
                  </span>
                ) : null}
                {state?.phase === 'qna' ? <span>Q&amp;A · both mics on</span> : null}
              </div>
              <div className="debate-timer">{state ? `${state.secondsRemaining}s` : '—'}</div>
              <div className="debate-viewers">{state ? `${state.viewersCount} viewers` : ''}</div>
            </div>

            <div className="debate-videos">
              {isDebater ? (
                <div className="debate-video-card">
                  <div className="debate-video-label">You ({role})</div>
                  <video ref={localVideoRef} muted playsInline className="debate-video" />
                </div>
              ) : null}

              <div className="debate-video-card">
                <div className="debate-video-label">Debater 1</div>
                <video ref={remoteDebater1Ref} playsInline className="debate-video" />
              </div>

              <div className="debate-video-card">
                <div className="debate-video-label">Debater 2</div>
                <video ref={remoteDebater2Ref} playsInline className="debate-video" />
              </div>
            </div>

            <div className="debate-controls-row">
              {canStart ? (
                <button className="debate-primary" type="button" onClick={startDebate}>
                  Start debate
                </button>
              ) : null}
              {canNextQuestion ? (
                <button className="debate-secondary" type="button" onClick={nextQuestion}>
                  Next question
                </button>
              ) : null}
              {state?.phase === 'qna' && state.currentQuestion ? (
                <div className="debate-question">
                  <div className="debate-question-title">Current question</div>
                  <div className="debate-question-body">
                    <strong>{state.currentQuestion.fromViewerName}:</strong> {state.currentQuestion.text}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="debate-side">
            <div className="debate-panel">
              <div className="debate-panel-title">Chat</div>
              <div className="debate-chat">
                {chat.map((m) => (
                  <div key={m.id} className="debate-chat-line">
                    <span className="debate-chat-name">{m.name}</span>
                    <span className="debate-chat-text">{m.text}</span>
                  </div>
                ))}
              </div>
              <div className="debate-input-row">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Comment…"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sendChat()
                  }}
                />
                <button type="button" onClick={sendChat}>
                  Send
                </button>
              </div>
            </div>

            <div className="debate-panel">
              <div className="debate-panel-title">Q&amp;A</div>
              <div className="debate-hint">Submit questions anytime. During Q&amp;A, questions are selected randomly in a round-robin by viewer.</div>
              <div className="debate-input-row">
                <input
                  value={questionInput}
                  onChange={(e) => setQuestionInput(e.target.value)}
                  placeholder="Ask a question…"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitQuestion()
                  }}
                />
                <button type="button" onClick={submitQuestion}>
                  Submit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

