import React from 'react';

interface Booking {
  booking_code: string;
  topic: string;
  date: string;
  time: string;
  timezone: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface InspectorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessionVariables: any;
  fsmState: string;
  bookings: Booking[];
  onRefreshBookings: () => void;
}

export const InspectorDrawer: React.FC<InspectorDrawerProps> = ({
  isOpen,
  onClose,
  sessionVariables,
  fsmState,
  bookings,
  onRefreshBookings
}) => {
  if (!isOpen) return null;

  return (
    <div className="inspector-backdrop" onClick={onClose}>
      <div className="inspector-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title">
            <span className="drawer-icon">🗄️</span>
            <div>
              <h3>System & Database Inspector</h3>
              <p>Real-time FSM Variables & SQLite Sync</p>
            </div>
          </div>
          <button className="drawer-close-btn" onClick={onClose} title="Close Inspector">
            ✕
          </button>
        </div>

        <div className="drawer-content">
          {/* FSM Variables Section */}
          <div className="inspector-section">
            <div className="section-header">
              <h4>Current FSM State: <span className="state-badge">{fsmState}</span></h4>
            </div>
            
            <div className="fsm-grid">
              <div className="grid-item">
                <span className="label">Session ID</span>
                <span className="value code">{sessionVariables?.sessionId || "N/A"}</span>
              </div>
              <div className="grid-item">
                <span className="label">Detected Intent</span>
                <span className={`value badge ${sessionVariables?.intent ? 'intent-active' : ''}`}>
                  {sessionVariables?.intent || "Waiting..."}
                </span>
              </div>
              <div className="grid-item">
                <span className="label">Topic</span>
                <span className="value">{sessionVariables?.topic || "Unspecified"}</span>
              </div>
              <div className="grid-item">
                <span className="label">Preferred Day</span>
                <span className="value">{sessionVariables?.preferredDay || "None"}</span>
              </div>
              <div className="grid-item">
                <span className="label">Preferred Time</span>
                <span className="value">{sessionVariables?.preferredTime || "None"}</span>
              </div>
              <div className="grid-item">
                <span className="label">Selected Slot</span>
                <span className="value slot-highlight">
                  {sessionVariables?.selectedSlot || "None"}
                </span>
              </div>
              <div className="grid-item full-width">
                <span className="label">Active Booking Code</span>
                <span className="value booking-code-badge">
                  {sessionVariables?.bookingCode || "Not Generated Yet"}
                </span>
              </div>
              <div className="grid-item">
                <span className="label">MCP Sync Status</span>
                <span className="value">{sessionVariables?.mcpStatus || "Idle"}</span>
              </div>
              <div className="grid-item">
                <span className="label">Dialogue Turns</span>
                <span className="value number">{sessionVariables?.turnCount || 0}</span>
              </div>
            </div>
          </div>

          {/* SQLite Bookings Table Section */}
          <div className="inspector-section">
            <div className="section-header with-action">
              <h4>SQLite Bookings (`mcp-server/bookings.db`)</h4>
              <button className="refresh-btn" onClick={onRefreshBookings} title="Refresh Table">
                🔄 Refresh
              </button>
            </div>

            {bookings.length === 0 ? (
              <div className="empty-db-notice">
                <p>No appointments found in database. Complete a booking flow in chat to sync.</p>
              </div>
            ) : (
              <div className="table-scroll-container">
                <table className="drawer-bookings-table">
                  <thead>
                    <tr>
                      <th>Ref Code</th>
                      <th>Topic</th>
                      <th>Schedule</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={b.booking_code}>
                        <td className="code-cell"><strong>{b.booking_code}</strong></td>
                        <td>{b.topic}</td>
                        <td className="time-cell">
                          <div>{b.date}</div>
                          <small>{b.time} ({b.timezone})</small>
                        </td>
                        <td>
                          <span className={`db-status-pill ${b.status.toLowerCase()}`}>
                            {b.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
