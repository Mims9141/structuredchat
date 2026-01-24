import './AdminScreen.css'

interface Report {
  id: string
  created_at: string
  reasons: string[]
  details: string
}

interface AdminScreenProps {
  reports: Report[]
  onBack: () => void
}

function AdminScreen({ reports, onBack }: AdminScreenProps) {
  const handleBack = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    onBack()
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-header">
        <h1>Admin Dashboard</h1>
        <p>Review and manage user reports</p>
        <button 
          onClick={handleBack} 
          className="back-btn"
          type="button"
        >
          Back to Home
        </button>
      </div>

      <div className="reports-list">
        {reports.length === 0 ? (
          <div className="empty-state">No reports yet</div>
        ) : (
          reports.map(report => (
            <div key={report.id} className="report-card">
              <div className="report-header">
                <span className="report-id">{report.id}</span>
                <span className="report-time">{new Date(report.created_at).toLocaleString()}</span>
              </div>
              <div className="report-reasons">
                {report.reasons.map(reason => (
                  <span key={reason} className="reason-tag">{reason}</span>
                ))}
              </div>
              {report.details && (
                <div className="report-details">
                  "{report.details}"
                </div>
              )}
              <div className="report-actions">
                <button className="admin-btn btn-review">Review</button>
                <button className="admin-btn btn-dismiss">Dismiss</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default AdminScreen
