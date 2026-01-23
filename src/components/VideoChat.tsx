import { useEffect, useRef, useMemo } from 'react'
import { Socket } from 'socket.io-client'
import './VideoChat.css'

type UserId = 'user1' | 'user2'

interface VideoChatProps {
  canSpeak: boolean
  roomId: string
  userId: 'user1' | 'user2' | null
  peerId: string | null
  socket: Socket | null
  currentSegment: number
}

// Mic permission: segment is array index (0-3), returns true if user can speak
function micAllowed(segment: number, userId: UserId): boolean {
  if (segment === 0) return userId === "user1"
  if (segment === 1) return userId === "user2"
  if (segment === 2) return userId === "user2"
  if (segment === 3) return userId === "user1"
  return false
}

interface OfferMsg {
  roomId: string
  offer: RTCSessionDescriptionInit
  fromId: string
}

interface AnswerMsg {
  roomId: string
  answer: RTCSessionDescriptionInit
  fromId: string
}

interface IceCandidateMsg {
  roomId: string
  candidate: RTCIceCandidateInit
  fromId: string
}

function VideoChat({ roomId, userId, socket, currentSegment }: VideoChatProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const videoTxRef = useRef<RTCRtpTransceiver | null>(null)
  const audioTxRef = useRef<RTCRtpTransceiver | null>(null)
  const iceBufferRef = useRef<RTCIceCandidateInit[]>([])
  const initKeyRef = useRef<string | null>(null)

  const desiredMicOn = useMemo(() => {
    if (!userId) return false
    return micAllowed(currentSegment, userId)
  }, [currentSegment, userId])

  useEffect(() => {
    if (!socket || !roomId) return
    console.log("[JOIN] emit join-room", { roomId, me: socket.id })
    socket.emit("join-room", { roomId })
  }, [socket, roomId])

  useEffect(() => {
    if (!socket || !socket.id || !roomId) return
    
    // Wait for userId to be set, but don't re-initialize if we already have a connection
    if (!userId) {
      console.log("[INIT] waiting for userId...")
      return
    }

    const key = `${roomId}:${socket.id}`
    if (initKeyRef.current === key) {
      console.log("[INIT] skip (already initialized)", key)
      return
    }
    
    // Additional check: if we already have an active peer connection, don't re-initialize
    if (pcRef.current && pcRef.current.connectionState !== 'closed' && pcRef.current.connectionState !== 'failed') {
      console.log("[INIT] skip (active connection exists)", pcRef.current.connectionState)
      initKeyRef.current = key // Update key to prevent future re-initialization
      return
    }
    
    initKeyRef.current = key

    let cancelled = false

    try {
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {}
    localStreamRef.current = null

    try {
      pcRef.current?.close()
    } catch {}
    pcRef.current = null
    videoTxRef.current = null
    audioTxRef.current = null
    iceBufferRef.current = []

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    })
    pcRef.current = pc

    pc.onsignalingstatechange = () => console.log("[PC] signalingState", pc.signalingState)
    pc.oniceconnectionstatechange = () => console.log("[PC] ICE", pc.iceConnectionState)
    pc.onconnectionstatechange = () => console.log("[PC] connection", pc.connectionState)

    pc.onicecandidate = (e) => {
      if (cancelled) return
      if (!e.candidate) {
        console.log("[PC] ICE gathering complete")
        return
      }
      console.log("[SIGNAL OUT] ice-candidate", "me=", socket.id, "room=", roomId)
      socket.emit("webrtc-ice-candidate", { roomId, candidate: e.candidate.toJSON?.() ?? e.candidate })
    }

    pc.ontrack = (e) => {
      if (cancelled) return
      const el = remoteVideoRef.current
      if (!el) return
      const stream = e.streams?.[0] ?? new MediaStream([e.track])
      el.srcObject = stream
      el.play().catch(() => {})
      console.log("[PC] ontrack", e.track.kind, e.track.id)
    }

    ;(async () => {
      try {
        console.log("[INIT] Requesting camera and microphone access...")
        
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("getUserMedia is not supported in this browser")
        }

        // Request both video and audio
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        })
        
        console.log("[INIT] Camera and microphone access granted, stream:", stream.id)
        
        if (cancelled) {
          console.log("[INIT] Cancelled after getUserMedia, stopping tracks")
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        if (pcRef.current !== pc) {
          console.log("[INIT] PC replaced after getUserMedia, stopping tracks")
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        localStreamRef.current = stream
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream
        }

        const videoTrack = stream.getVideoTracks()[0]
        const audioTrack = stream.getAudioTracks()[0]
        
        if (!videoTrack) throw new Error("No video track in stream")
        if (!audioTrack) throw new Error("No audio track in stream")
        
        console.log("[INIT] Video track:", videoTrack.id, "enabled:", videoTrack.enabled)
        console.log("[INIT] Audio track:", audioTrack.id, "enabled:", audioTrack.enabled, "desiredMicOn:", desiredMicOn)

        // Always keep video enabled
        videoTrack.enabled = true

        // Set audio based on segment
        audioTrack.enabled = desiredMicOn

        if (cancelled || pcRef.current !== pc) return
        
        // Add transceivers for video and audio
        videoTxRef.current = pc.addTransceiver("video", { direction: "sendrecv" })
        await videoTxRef.current.sender.replaceTrack(videoTrack)
        
        audioTxRef.current = pc.addTransceiver("audio", { direction: "sendrecv" })
        await audioTxRef.current.sender.replaceTrack(audioTrack)

        // Ensure tracks are enabled correctly
        videoTrack.enabled = true
        audioTrack.enabled = desiredMicOn
        if (videoTxRef.current.sender.track) videoTxRef.current.sender.track.enabled = true
        if (audioTxRef.current.sender.track) audioTxRef.current.sender.track.enabled = desiredMicOn

        console.log("[INIT] transceivers:", pc.getTransceivers().length, "senders:", pc.getSenders().length)

        if (userId === "user1") {
          const offer = await pc.createOffer()
          if (cancelled) return
          await pc.setLocalDescription(offer)
          console.log("[SIGNAL OUT] offer", "me=", socket.id, "room=", roomId)
          socket.emit("webrtc-offer", { roomId, offer })
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error("[INIT] getUserMedia error:", err)
          if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            alert("Camera/microphone access denied. Please allow access in your browser settings and refresh the page.")
          } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
            alert("No camera/microphone found. Please connect devices and refresh the page.")
          } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
            alert("Camera/microphone is being used by another application. Please close other applications.")
          } else {
            alert(`Failed to access camera/microphone: ${err.message || err.name}`)
          }
        }
      }
    })()

    return () => {
      cancelled = true
      try {
        localStreamRef.current?.getTracks().forEach((t) => t.stop())
      } catch {}
      localStreamRef.current = null
      try {
        pc.close()
      } catch {}
      if (pcRef.current === pc) pcRef.current = null
      videoTxRef.current = null
      audioTxRef.current = null
      iceBufferRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket?.id, roomId, userId])

  // Handle WebRTC signaling
  useEffect(() => {
    if (!socket || !roomId || !userId) return

    const onOffer = async (msg: OfferMsg) => {
      if (msg.roomId !== roomId) return
      if (msg.fromId === socket.id) return
      if (userId !== "user2") return
      if (!pcRef.current) return

      console.log("[SIGNAL IN] offer", "from=", msg.fromId, "me=", socket.id, "room=", roomId)

      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.offer))

        const buffered = iceBufferRef.current
        iceBufferRef.current = []
        for (const c of buffered) {
          try {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(c))
          } catch {}
        }

        const answer = await pcRef.current.createAnswer()
        await pcRef.current.setLocalDescription(answer)

        console.log("[SIGNAL OUT] answer", "me=", socket.id, "room=", roomId)
        socket.emit("webrtc-answer", { roomId, answer })
      } catch (e) {
        console.error("[SIGNAL] offer error:", e)
      }
    }

    const onAnswer = async (msg: AnswerMsg) => {
      if (msg.roomId !== roomId) return
      if (msg.fromId === socket.id) return
      if (userId !== "user1") return
      if (!pcRef.current) return

      console.log("[SIGNAL IN] answer", "from=", msg.fromId, "me=", socket.id, "room=", roomId)

      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.answer))
      } catch (e) {
        console.error("[SIGNAL] answer error:", e)
      }
    }

    const onIceCandidate = async (msg: IceCandidateMsg) => {
      if (msg.roomId !== roomId) return
      if (msg.fromId === socket.id) return
      if (!pcRef.current) {
        iceBufferRef.current.push(msg.candidate)
        return
      }

      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate))
      } catch (e) {
        console.error("[SIGNAL] ice-candidate error:", e)
      }
    }

    socket.on("webrtc-offer", onOffer)
    socket.on("webrtc-answer", onAnswer)
    socket.on("webrtc-ice-candidate", onIceCandidate)

    return () => {
      socket.off("webrtc-offer", onOffer)
      socket.off("webrtc-answer", onAnswer)
      socket.off("webrtc-ice-candidate", onIceCandidate)
    }
  }, [socket, roomId, userId])

  // Update mic state based on segment
  useEffect(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()?.[0]
    if (audioTrack) {
      audioTrack.enabled = desiredMicOn
      console.log("[SEG] Audio track enabled set to:", desiredMicOn, "segment:", currentSegment, "userId:", userId)
    }

    const senderTrack = audioTxRef.current?.sender?.track
    if (senderTrack) {
      senderTrack.enabled = desiredMicOn
    }

    const pc = pcRef.current
    if (pc) {
      const audioSenders = pc.getSenders().filter((s) => s.track?.kind === "audio")
      const videoSenders = pc.getSenders().filter((s) => s.track?.kind === "video")
      console.log("[SEG] state", {
        segment: currentSegment,
        userId,
        desiredMicOn,
        audioSenders: audioSenders.map((s) => ({ id: s.track?.id, enabled: s.track?.enabled })),
        videoSenders: videoSenders.map((s) => ({ id: s.track?.id, enabled: s.track?.enabled })),
        transceivers: pc.getTransceivers().length,
      })
    }
  }, [desiredMicOn, currentSegment, userId])

  return (
    <div className="video-container">
      <div className="video-grid">
        <div className="video-wrapper remote-video">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="video-element"
          />
          {!remoteVideoRef.current?.srcObject && (
            <div className="video-placeholder">
              <span className="video-placeholder-icon">👤</span>
              <span className="video-placeholder-text">Waiting for peer...</span>
            </div>
          )}
        </div>
        <div className="video-wrapper local-video">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="video-element"
          />
        </div>
      </div>
      <div className="video-controls">
        <div className={`mic-status ${desiredMicOn ? 'active' : 'muted'}`}>
          {desiredMicOn ? '🎤 You can speak' : '🔇 Listening only'}
        </div>
      </div>
    </div>
  )
}

export default VideoChat
