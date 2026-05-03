import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import SessionDetailModal from '../components/SessionDetailModal.jsx'

function UserDashboardPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [dashboardData, setDashboardData] = useState(null)
  const [scores, setScores] = useState([])
  const [sessions, setSessions] = useState([])
  const [error, setError] = useState('')
  const [detailSessionId, setDetailSessionId] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [dashboardRes, scoresRes, sessionsRes] = await Promise.all([
          api.get('/user/dashboard'),
          api.get('/user/scores'),
          api.get('/user/game-sessions'),
        ])
        if (!cancelled) {
          setDashboardData(dashboardRes.data)
          setScores(scoresRes.data)
          setSessions(sessionsRes.data)
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || 'Failed to load dashboard')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])


  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <main className="page">
      <div className="card wide">
        <div className="top-bar">
          <h1 className="card-title">User Dashboard</h1>
          <button onClick={handleLogout} type="button" className="ghost-btn">
            Logout
          </button>
        </div>
        <p className="subtitle">Welcome {user?.fullName}</p>
        {error ? <p className="error">{error}</p> : null}
        <div className="game-actions">
          <button type="button" className="primary-btn" onClick={() => navigate('/game')}>
            Play Game
          </button>
        </div>
        {dashboardData ? (
          <div className="panel">
            <h3>{dashboardData.title}</h3>
            <p>{dashboardData.message}</p>
          </div>
        ) : null}
        <div className="panel">
          <h3>Your Scores</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Score</th>
                  <th>Played At</th>
                </tr>
              </thead>
              <tbody>
                {scores.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No scores yet. Play a game first.</td>
                  </tr>
                ) : (
                  scores.map((entry, index) => (
                    <tr key={entry.id}>
                      <td>{index + 1}</td>
                      <td>{entry.score}</td>
                      <td>{new Date(entry.createdAt).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>Telemetry sessions</h3>
          <p className="muted-text">
            Full paddle and eye telemetry is saved after each Brick Ball round. View charts for any completed session.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Session</th>
                  <th>Score</th>
                  <th>Duration</th>
                  <th>Blinks</th>
                  <th>Samples</th>
                  <th>Ended</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No completed sessions yet. Finish a Brick Ball round to capture telemetry.</td>
                  </tr>
                ) : (
                  sessions.map((entry, index) => (
                    <tr key={entry.id}>
                      <td>{index + 1}</td>
                      <td>{entry.id}</td>
                      <td>{entry.finalScore}</td>
                      <td>{entry.durationSeconds}s</td>
                      <td>{entry.totalBlinks}</td>
                      <td>{entry.sampleCount}</td>
                      <td>{entry.endedAt ? new Date(entry.endedAt).toLocaleString() : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="table-link-btn"
                          onClick={() => setDetailSessionId(entry.id)}
                        >
                          View details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <SessionDetailModal
        sessionId={detailSessionId}
        apiMode="user"
        open={detailSessionId != null}
        onClose={() => setDetailSessionId(null)}
      />
    </main>
  )
}

export default UserDashboardPage
