import { useState } from 'react'
import './ReportModal.css'

const reasonOptions = [
  'Harassment',
  'Inappropriate Content',
  'Spam',
  'Threats',
  'Other'
]

interface ReportModalProps {
  onSubmit: (data: { reasons: string[], details: string }) => void
  onClose: () => void
}

function ReportModal({ onSubmit, onClose }: ReportModalProps) {
  const [reasons, setReasons] = useState<string[]>([])
  const [details, setDetails] = useState<string>('')

  const handleReasonToggle = (reason: string) => {
    if (reasons.includes(reason)) {
      setReasons(reasons.filter(r => r !== reason))
    } else {
      setReasons([...reasons, reason])
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (reasons.length > 0) {
      onSubmit({ reasons, details })
      setReasons([])
      setDetails('')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Report User</h2>
        <form className="report-form" onSubmit={handleSubmit}>
          <div className="checkbox-group">
            {reasonOptions.map(reason => (
              <label key={reason} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={reasons.includes(reason)}
                  onChange={() => handleReasonToggle(reason)}
                />
                <span>{reason}</span>
              </label>
            ))}
          </div>
          <textarea
            className="report-textarea"
            placeholder="Please provide additional details..."
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
          <div className="modal-buttons">
            <button 
              type="button" 
              className="modal-btn btn-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="modal-btn btn-submit"
              disabled={reasons.length === 0}
            >
              Submit Report
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ReportModal
