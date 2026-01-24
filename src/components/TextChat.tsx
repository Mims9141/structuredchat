import { useState, useRef, useEffect } from 'react'
import './TextChat.css'

interface Message {
  id?: string
  sender: 'system' | 'user1' | 'user2'
  senderSocketId?: string
  senderName?: string
  text: string
  ts?: number
  isOwn?: boolean
}

interface TextChatProps {
  messages: Message[]
  canSpeak: boolean
  onSendMessage: (text: string) => void
  userId?: 'user1' | 'user2' | null
  userName?: string
  peerName?: string
}

function TextChat({ messages, canSpeak, onSendMessage, userId, userName = 'You', peerName = 'Stranger' }: TextChatProps) {
  const [input, setInput] = useState<string>('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Debug logging
  useEffect(() => {
    console.log('TextChat canSpeak:', canSpeak, 'userId:', userId, 'userName:', userName, 'peerName:', peerName, 'input:', input)
    console.log('All messages details:', messages.map((m, idx) => {
      const isOwn = m.sender === userId
      const displaySender = isOwn ? userName : (m.senderName || peerName)
      return { 
        idx, 
        sender: m.sender, 
        senderName: m.senderName,
        text: m.text, 
        isOwn,
        displaySender,
        userName,
        peerName,
        className: isOwn ? 'own' : 'other'
      }
    }))
  }, [canSpeak, userId, userName, peerName, input, messages])

  const handleSend = () => {
    console.log('handleSend called:', { input: input.trim(), canSpeak })
    if (input.trim() && canSpeak) {
      console.log('Sending message:', input)
      onSendMessage(input)
      setInput('')
    } else {
      console.log('Cannot send - input:', input.trim(), 'canSpeak:', canSpeak)
    }
  }

  return (
    <div className="text-chat-container">
      <div className="text-messages">
        {messages.map((msg, idx) => {
          if (msg.sender === 'system') {
            return (
              <div key={idx} className="message system">
                {msg.text}
              </div>
            )
          }
          
          // Use isOwn from message (computed by comparing user IDs)
          const isOwnMessage = msg.isOwn ?? false
          
          // Render name from the message, not from current user state
          // For own messages: show userName
          // For other messages: use msg.senderName from server (source of truth)
          const displaySender = isOwnMessage 
            ? (userName || 'You')
            : (msg.senderName || peerName || 'Stranger')
          
          return (
            <div 
              key={idx} 
              className={`message ${isOwnMessage ? 'own' : 'other'}`}
              data-sender={msg.sender}
              data-userid={userId}
              data-isown={isOwnMessage}
            >
              <div className="message-sender">
                {displaySender}
              </div>
              <div className="message-text">{msg.text}</div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>
      <div className="text-input-area">
        {!canSpeak && (
          <div className="read-only-indicator">
            👀 Reading only - Wait for your turn to type
          </div>
        )}
        <div className="text-input-wrapper">
          <textarea
            className="text-input"
            placeholder={canSpeak ? "Type your message... (Press Enter to send, Shift+Enter for new line)" : "You can read messages but cannot type yet..."}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              // Auto-resize textarea up to 4 lines
              e.target.style.height = 'auto'
              const lineHeight = 24 // 1.5rem
              const maxHeight = lineHeight * 4 + 24 // 4 lines + padding
              const newHeight = Math.min(e.target.scrollHeight, maxHeight)
              e.target.style.height = `${newHeight}px`
            }}
            onClick={() => {
              console.log('Textarea clicked, canSpeak:', canSpeak, 'disabled:', !canSpeak)
            }}
            onFocus={() => {
              console.log('Textarea focused, canSpeak:', canSpeak)
            }}
            onKeyDown={(e) => {
              console.log('onKeyDown:', e.key, 'canSpeak:', canSpeak, 'input:', input.trim())
              if (e.key === 'Enter' && !e.shiftKey && canSpeak && input.trim()) {
                e.preventDefault()
                handleSend()
                // Reset textarea height after sending
                const textarea = e.target as HTMLTextAreaElement
                textarea.style.height = 'auto'
              }
            }}
            disabled={!canSpeak}
            readOnly={false}
            tabIndex={canSpeak ? 0 : -1}
            rows={1}
            style={{
              pointerEvents: canSpeak ? 'auto' : 'none',
              cursor: canSpeak ? 'text' : 'not-allowed'
            }}
          />
          <button 
            className="send-btn" 
            onClick={handleSend}
            disabled={!canSpeak || !input.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

export default TextChat
