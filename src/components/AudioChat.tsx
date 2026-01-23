import { useEffect, useMemo, useRef } from "react"
import type { Socket } from "socket.io-client"
import "./AudioChat.css"

type UserId = "user1" | "user2"

interface AudioChatProps {
  roomId: string
  userId: UserId | null
  socket: Socket | null
  currentSegment: number // 0-3 (array index)
}

type OfferMsg = { roomId: string; offer: RTCSessionDescriptionInit; fromId: string }
type AnswerMsg = { roomId: string; answer: RTCSessionDescriptionInit; fromId: string }
type IceMsg = { roomId: string; candidate: RTCIceCandidateInit; fromId: string }

// Mic permission: segment is array index (0-3), returns true if user can speak
function micAllowed(segment: number, userId: UserId): boolean {
  if (segment === 0) return userId === "user1"
  if (segment === 1) return userId === "user2"
  if (segment === 2) return userId === "user2"
  if (segment === 3) return userId === "user1"
  return false
}

export default function AudioChat({ roomId, userId, socket, currentSegment }: AudioChatProps) {
  const localAudioRef = useRef<HTMLAudioElement | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)

  const audioTxRef = useRef<RTCRtpTransceiver | null>(null)
  const iceBufferRef = useRef<RTCIceCandidateInit[]>([])

  const initKeyRef = useRef<string | null>(null)

  const desiredMicOn = useMemo(() => {
    if (!userId) return false
    return micAllowed(currentSegment, userId)
  }, [currentSegment, userId])

  console.log("[AudioChat] render", {
    roomId,
    userId,
    hasSocket: !!socket,
    socketId: socket?.id,
    currentSegment,
  })

  useEffect(() => {
    if (!socket || !roomId) return
    console.log("[JOIN] emit join-room", { roomId, me: socket.id })
    socket.emit("join-room", { roomId })
  }, [socket, roomId])

  useEffect(() => {
    if (!socket || !socket.id || !roomId || !userId) return

    const key = `${roomId}:${socket.id}`
    if (initKeyRef.current === key) {
      console.log("[INIT] skip (already initialized)", key)
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
      const el = remoteAudioRef.current
      if (!el) return
      const stream = e.streams?.[0] ?? new MediaStream([e.track])
      el.srcObject = stream
      el.play().catch(() => {})
      console.log("[PC] ontrack", e.track.kind, e.track.id)
    }

    ;(async () => {
      try {
        console.log("[INIT] Requesting microphone access...")
        
        // Check if getUserMedia is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("getUserMedia is not supported in this browser")
        }

        // Check permission state if available
        if (navigator.permissions) {
          try {
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName })
            console.log("[INIT] Microphone permission state:", permissionStatus.state)
            if (permissionStatus.state === 'denied') {
              throw new Error("Microphone permission was previously denied. Please enable it in browser settings.")
            }
          } catch (permErr) {
            // Permission query might not be supported, continue anyway
            console.log("[INIT] Could not query permission state:", permErr)
          }
        }

        // Request microphone access with explicit constraints
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }, 
          video: false 
        })
        
        console.log("[INIT] Microphone access granted, stream:", stream.id)
        
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
        if (localAudioRef.current) localAudioRef.current.srcObject = stream

        const track = stream.getAudioTracks()[0]
        if (!track) throw new Error("No audio track in stream")
        
        console.log("[INIT] Audio track obtained:", track.id, "enabled:", track.enabled, "readyState:", track.readyState)

        if (cancelled || pcRef.current !== pc) return
        audioTxRef.current = pc.addTransceiver("audio", { direction: "sendrecv" })
        await audioTxRef.current.sender.replaceTrack(track)

        track.enabled = desiredMicOn
        audioTxRef.current.sender.track && (audioTxRef.current.sender.track.enabled = desiredMicOn)

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
            console.error("[INIT] Microphone permission denied. User needs to allow microphone access in browser settings.")
            alert("Microphone access denied. Please allow microphone access in your browser settings and refresh the page.")
          } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
            console.error("[INIT] No microphone found")
            alert("No microphone found. Please connect a microphone and refresh the page.")
          } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
            console.error("[INIT] Microphone is being used by another application")
            alert("Microphone is being used by another application. Please close other applications using the microphone.")
          } else {
            console.error("[INIT] Unknown error:", err.name, err.message)
            alert(`Failed to access microphone: ${err.message || err.name}`)
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
      audioTxRef.current = null
      iceBufferRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket?.id, roomId, userId])

  useEffect(() => {
    const track = localStreamRef.current?.getAudioTracks?.()[0]
    if (track) track.enabled = desiredMicOn

    const senderTrack = audioTxRef.current?.sender?.track
    if (senderTrack) senderTrack.enabled = desiredMicOn

    const pc = pcRef.current
    if (pc) {
      const audioSenders = pc.getSenders().filter((s) => s.track?.kind === "audio")
      console.log("[SEG] state", {
        segment: currentSegment,
        userId,
        desiredMicOn,
        audioSenders: audioSenders.map((s) => ({ id: s.track?.id, enabled: s.track?.enabled })),
        transceivers: pc.getTransceivers().length,
      })
    }
  }, [desiredMicOn, currentSegment, userId])

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
        if (pcRef.current.signalingState !== "have-local-offer") {
          console.warn("[SIGNAL] ignore answer, state:", pcRef.current.signalingState)
          return
        }
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.answer))

        const buffered = iceBufferRef.current
        iceBufferRef.current = []
        for (const c of buffered) {
          try {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(c))
          } catch {}
        }
      } catch (e) {
        console.error("[SIGNAL] answer error:", e)
      }
    }

    const onIce = async (msg: IceMsg) => {
      if (msg.roomId !== roomId) return
      if (msg.fromId === socket.id) return
      if (!pcRef.current) return

      console.log("[SIGNAL IN] ice-candidate", "from=", msg.fromId, "me=", socket.id, "room=", roomId)

      const pc = pcRef.current
      if (!pc.remoteDescription) {
        iceBufferRef.current.push(msg.candidate)
        return
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate))
      } catch (e) {
        console.error("[SIGNAL] ICE add error:", e)
      }
    }

    socket.on("webrtc-offer", onOffer)
    socket.on("webrtc-answer", onAnswer)
    socket.on("webrtc-ice-candidate", onIce)

    return () => {
      socket.off("webrtc-offer", onOffer)
      socket.off("webrtc-answer", onAnswer)
      socket.off("webrtc-ice-candidate", onIce)
    }
  }, [socket, roomId, userId])

  const canTransmit = userId ? micAllowed(currentSegment, userId) : false

  return (
    <div className="audio-container">
      <audio ref={localAudioRef} autoPlay muted />
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="audio-status">
        <h3>{canTransmit ? "🎤 You can speak" : "🔇 Listening only"}</h3>
      </div>
    </div>
  )
}
