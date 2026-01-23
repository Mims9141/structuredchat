import './TimerDisplay.css'

interface TimerDisplayProps {
  label: string
  description: string
  timeDisplay: string
  canSkip: boolean
  onSkip: () => void
}

function TimerDisplay({ label, description, timeDisplay, canSkip, onSkip }: TimerDisplayProps) {
  return (
    <div className="timer-display">
      <div className="segment-label">{label}</div>
      <div className="segment-description">{description}</div>
      <div className="timer-circle">{timeDisplay}</div>
      {canSkip && (
        <button 
          className="skip-btn" 
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            console.log('[TimerDisplay] Skip button clicked')
            onSkip()
          }}
          type="button"
        >
          Skip to Next Segment
        </button>
      )}
    </div>
  )
}

export default TimerDisplay
