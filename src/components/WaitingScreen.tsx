import './WaitingScreen.css'

interface WaitingScreenProps {
  onBack: () => void
}

function WaitingScreen({ onBack }: WaitingScreenProps) {
  return (
    <div className="waiting-screen">
      <button className="waiting-back-btn" onClick={onBack} title="Go back home">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <div className="waiting-spinner"></div>
      <h2 className="waiting-text">Finding your match...</h2>
      <p className="waiting-subtext">This usually takes just a few seconds</p>
    </div>
  )
}

export default WaitingScreen
