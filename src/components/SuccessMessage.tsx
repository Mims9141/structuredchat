import { useEffect } from 'react'
import './SuccessMessage.css'

interface SuccessMessageProps {
  message: string
  onClose: () => void
  autoCloseDelay?: number
}

export default function SuccessMessage({ message, onClose, autoCloseDelay = 2000 }: SuccessMessageProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose()
    }, autoCloseDelay)

    return () => clearTimeout(timer)
  }, [onClose, autoCloseDelay])

  return (
    <div className="success-message-overlay">
      <div className="success-message">
        <div className="success-icon">✓</div>
        <p>{message}</p>
      </div>
    </div>
  )
}
