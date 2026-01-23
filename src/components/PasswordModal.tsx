import { useState, useRef, useEffect } from 'react'
import './PasswordModal.css'

interface PasswordModalProps {
  onSuccess: () => void
  onCancel: () => void
}

export default function PasswordModal({ onSuccess, onCancel }: PasswordModalProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (password === '121') {
      onSuccess()
    } else {
      setError('Incorrect password')
      setPassword('')
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <div className="password-modal-overlay" onClick={onCancel}>
      <div className="password-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Enter Admin Password</h2>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError('')
            }}
            onKeyDown={handleKeyDown}
            placeholder="Password"
            className="password-input"
            autoFocus
          />
          {error && <div className="password-error">{error}</div>}
          <div className="password-modal-buttons">
            <button type="button" onClick={onCancel} className="password-btn password-btn-cancel">
              Cancel
            </button>
            <button type="submit" className="password-btn password-btn-submit">
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
