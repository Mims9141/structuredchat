import { useState } from 'react'
import type { HealthStatus } from '../contexts/SupabaseContext'
import './HealthIndicator.css'

interface HealthIndicatorProps {
  status: HealthStatus
  userId: string | null
}

export default function HealthIndicator({ status, userId }: HealthIndicatorProps) {
  const [expanded, setExpanded] = useState(false)

  const getStatusColor = () => {
    if (status.authStatus === 'error') return '#ff4444'
    if (status.authStatus === 'initializing') return '#ffaa00'
    if (status.presenceChannel === 'error' || status.roomChannel === 'error') return '#ffaa00'
    return '#00ff9d'
  }

  const getStatusIcon = () => {
    if (status.authStatus === 'error') return '✗'
    if (status.authStatus === 'initializing') return '○'
    return '✓'
  }

  // Only show in development or if there's an error
  const shouldShow = import.meta.env.DEV || status.authStatus === 'error'
  if (!shouldShow) return null

  return (
    <div className="health-indicator">
      <button
        className="health-toggle"
        onClick={() => setExpanded(!expanded)}
        style={{ borderColor: getStatusColor() }}
        title="Connection Status"
      >
        <span style={{ color: getStatusColor() }}>{getStatusIcon()}</span>
      </button>

      {expanded && (
        <div className="health-panel">
          <div className="health-header">
            <span>Connection Status</span>
            <button className="health-close" onClick={() => setExpanded(false)}>
              ×
            </button>
          </div>

          <div className="health-row">
            <span className="health-label">Configured:</span>
            <span className={status.configured ? 'health-ok' : 'health-error'}>
              {status.configured ? 'Yes' : 'No'}
            </span>
          </div>

          <div className="health-row">
            <span className="health-label">Auth:</span>
            <span
              className={
                status.authStatus === 'authenticated'
                  ? 'health-ok'
                  : status.authStatus === 'error'
                    ? 'health-error'
                    : 'health-warn'
              }
            >
              {status.authStatus}
            </span>
          </div>

          {status.authError && (
            <div className="health-row health-error-msg">
              <span className="health-label">Error:</span>
              <span>{status.authError}</span>
            </div>
          )}

          {userId && (
            <div className="health-row">
              <span className="health-label">User ID:</span>
              <span className="health-value">{userId.substring(0, 8)}...</span>
            </div>
          )}

          <div className="health-row">
            <span className="health-label">Presence:</span>
            <span
              className={
                status.presenceChannel === 'connected'
                  ? 'health-ok'
                  : status.presenceChannel === 'error'
                    ? 'health-error'
                    : 'health-warn'
              }
            >
              {status.presenceChannel}
            </span>
          </div>

          <div className="health-row">
            <span className="health-label">Room Channel:</span>
            <span
              className={
                status.roomChannel === 'connected'
                  ? 'health-ok'
                  : status.roomChannel === 'error'
                    ? 'health-error'
                    : 'health-warn'
              }
            >
              {status.roomChannel}
            </span>
          </div>

          {status.currentRoomId && (
            <>
              <div className="health-row">
                <span className="health-label">Room ID:</span>
                <span className="health-value">{status.currentRoomId.substring(0, 8)}...</span>
              </div>
              <div className="health-row">
                <span className="health-label">Room Status:</span>
                <span className="health-value">{status.currentRoomStatus}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
