import { useState, useEffect } from 'react'
import './LandingScreen.css'

interface UserCounts {
  total: number
  video: number
  audio: number
  text: number
}

interface LandingScreenProps {
  userCounts: UserCounts
  onStartChat: (mode: 'video' | 'audio' | 'text' | 'any', name: string) => void
  onShowAdmin: () => void
}

const STORAGE_KEY = 'onetwoone_name'

function LandingScreen({ userCounts, onStartChat, onShowAdmin }: LandingScreenProps) {
  // Load name from localStorage on mount
  const [name, setName] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || ''
    } catch {
      return ''
    }
  })

  // Save name to localStorage whenever it changes
  useEffect(() => {
    const trimmedName = name.trim()
    if (trimmedName) {
      try {
        localStorage.setItem(STORAGE_KEY, trimmedName)
      } catch (error) {
        console.warn('Failed to save name to localStorage:', error)
      }
    }
  }, [name])

  const handleStartChat = (mode: 'video' | 'audio' | 'text' | 'any') => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      alert('Please enter your name to continue')
      return
    }
    // Save to localStorage before starting
    try {
      localStorage.setItem(STORAGE_KEY, trimmedName)
    } catch (error) {
      console.warn('Failed to save name to localStorage:', error)
    }
    onStartChat(mode, trimmedName)
  }

  return (
    <div className="landing">
      <h1 className="logo">OneTwoOne</h1>
      <p className="tagline">
        Balanced conversations with random strangers. Equal time to share, equal time to listen.
      </p>
      
      <div className="name-input-container">
        <label htmlFor="user-name" className="name-label" onClick={() => {
          const input = document.getElementById('user-name') as HTMLInputElement
          input?.focus()
        }}>
          Enter your name:
        </label>
        <input
          id="user-name"
          type="text"
          className="name-input"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onClick={(e) => {
            e.stopPropagation()
            e.currentTarget.focus()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              handleStartChat('any')
            }
          }}
          maxLength={20}
          autoFocus={false}
          tabIndex={0}
        />
      </div>
      
      <div className="online-count">
        <span className="pulse-dot"></span>
        <span>{userCounts.total} people online</span>
      </div>

      <button className="start-any-btn" onClick={() => handleStartChat('any')}>
        START ANY 🔥
      </button>

      <div className="format-selector">
        <div className="format-header">Or choose your format:</div>
        
        <div 
          className="format-option" 
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleStartChat('video')
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="format-left">
            <span className="format-icon">🎥</span>
            <div className="format-info">
              <h3>Video Chat</h3>
              <p className="format-count">
                <span className="count-number">{userCounts.video}</span> online
              </p>
            </div>
          </div>
          <button 
            type="button"
            className="format-btn" 
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleStartChat('video')
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            Start
          </button>
        </div>

        <div 
          className="format-option" 
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleStartChat('audio')
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="format-left">
            <span className="format-icon">🎤</span>
            <div className="format-info">
              <h3>Audio Only</h3>
              <p className="format-count">
                <span className="count-number">{userCounts.audio}</span> online
              </p>
            </div>
          </div>
          <button 
            type="button"
            className="format-btn" 
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleStartChat('audio')
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            Start
          </button>
        </div>

        <div 
          className="format-option" 
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleStartChat('text')
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="format-left">
            <span className="format-icon">💬</span>
            <div className="format-info">
              <h3>Text Chat</h3>
              <p className="format-count">
                <span className="count-number">{userCounts.text}</span> online
              </p>
            </div>
          </div>
          <button 
            type="button"
            className="format-btn" 
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleStartChat('text')
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            Start
          </button>
        </div>
      </div>
    </div>
  )
}

export default LandingScreen
