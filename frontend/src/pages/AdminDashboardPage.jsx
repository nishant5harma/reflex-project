import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import SessionDetailModal from '../components/SessionDetailModal.jsx'

function AdminDashboardPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState({ totalUsers: 0, activeUsers: 0 })
  const [users, setUsers] = useState([])
  const [searchText, setSearchText] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedUserScores, setSelectedUserScores] = useState([])
  const [selectedUserSessions, setSelectedUserSessions] = useState([])
  const [error, setError] = useState('')
  const [detailSessionId, setDetailSessionId] = useState(null)
  const [deletingSessionId, setDeletingSessionId] = useState(null)
  const [exportingSessionId, setExportingSessionId] = useState(null)

  useEffect(() => {
    const fetchAdminData = async () => {
      try {
        const [statsRes, usersRes] = await Promise.all([
          api.get('/admin/stats'),
          api.get('/admin/users'),
        ])
        setStats(statsRes.data)
        setUsers(usersRes.data)
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load admin data')
      }
    }
    fetchAdminData()
  }, [])

  useEffect(() => {
    const fetchUserScoresAndSessions = async () => {
      if (!selectedUserId) {
        setSelectedUserScores([])
        setSelectedUserSessions([])
        return
      }

      try {
        const [scoresRes, sessionsRes] = await Promise.all([
          api.get(`/admin/users/${selectedUserId}/scores`),
          api.get(`/admin/users/${selectedUserId}/game-sessions`),
        ])
        setSelectedUserScores(scoresRes.data)
        setSelectedUserSessions(sessionsRes.data)
        setError('')
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load selected user data')
      }
    }

    fetchUserScoresAndSessions()
  }, [selectedUserId])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const filteredUsers = users.filter(
    (entry) =>
      entry.fullName.toLowerCase().includes(searchText.toLowerCase()) ||
      entry.email.toLowerCase().includes(searchText.toLowerCase())
  )

  const handleExportSessionExcel = async (sessionId) => {
    try {
      setExportingSessionId(sessionId)
      const response = await api.get(`/admin/game-sessions/${sessionId}/export`, {
        responseType: 'blob',
      })
      const blob =
        response.data instanceof Blob
          ? response.data
          : new Blob([response.data], {
              type:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `session_${sessionId}_telemetry_export.xlsx`
      anchor.click()
      URL.revokeObjectURL(url)
      setError('')
    } catch (err) {
      const fallback = err.response?.data?.message || 'Failed to export session'
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text()
          const parsed = JSON.parse(text)
          setError(parsed?.message || fallback)
        } catch {
          setError(fallback)
        }
      } else {
        setError(fallback)
      }
    } finally {
      setExportingSessionId(null)
    }
  }

  const handleDeleteSession = async (sessionId) => {
    const yes = window.confirm(
      `Delete session ${sessionId}? This removes session, samples, and eye frames permanently.`
    )
    if (!yes) return

    try {
      setDeletingSessionId(sessionId)
      await api.delete(`/admin/game-sessions/${sessionId}`)
      setSelectedUserSessions((prev) => prev.filter((entry) => entry.id !== sessionId))
      if (detailSessionId === sessionId) {
        setDetailSessionId(null)
      }
      setError('')
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete session')
    } finally {
      setDeletingSessionId(null)
    }
  }

  return (
    <main className="page">
      <div className="card wide">
        <div className="top-bar">
          <h1 className="card-title">Admin Dashboard</h1>
          <button onClick={handleLogout} type="button" className="ghost-btn">
            Logout
          </button>
        </div>
        <p className="subtitle">Hello {user?.fullName}</p>
        {error ? <p className="error">{error}</p> : null}
        <div className="game-actions">
          <button type="button" className="primary-btn" onClick={() => navigate('/game')}>
            Play Game
          </button>
        </div>
        <div className="stats-grid">
          <div className="panel">
            <h3>Total Users</h3>
            <p className="big-number">{stats.totalUsers}</p>
          </div>
          <div className="panel">
            <h3>Active Users</h3>
            <p className="big-number">{stats.activeUsers}</p>
          </div>
        </div>
        <div className="panel">
          <h3>Registered Users</h3>
          <div className="table-wrap">
            <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((registeredUser) => (
                <tr key={registeredUser.id}>
                  <td>{registeredUser.fullName}</td>
                  <td>{registeredUser.email}</td>
                  <td>
                    <span className={registeredUser.isActive ? 'badge active' : 'badge inactive'}>
                      {registeredUser.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h3>User Score Search</h3>
          <div className="filter-row">
            <input
              type="text"
              placeholder="Search by name or email"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
            <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
              <option value="">Select user</option>
              {filteredUsers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.fullName} ({entry.email})
                </option>
              ))}
            </select>
          </div>
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
                {selectedUserId === '' ? (
                  <tr>
                    <td colSpan={3}>Select a user to view scores.</td>
                  </tr>
                ) : selectedUserScores.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No scores found for this user.</td>
                  </tr>
                ) : (
                  selectedUserScores.map((entry, index) => (
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
          <h3>Telemetry sessions (selected user)</h3>
          <p className="muted-text">Open graphs for paddle motion, gaze, and blink counts tied to Brick Ball gameplay.</p>
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
                  <th>Details</th>
                  <th>Export</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {selectedUserId === '' ? (
                  <tr>
                    <td colSpan={11}>Select a user to view telemetry sessions.</td>
                  </tr>
                ) : selectedUserSessions.length === 0 ? (
                  <tr>
                    <td colSpan={11}>No completed telemetry sessions for this user.</td>
                  </tr>
                ) : (
                  selectedUserSessions.map((entry, index) => (
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
                      <td>
                        <button
                          type="button"
                          className="table-excel-btn"
                          onClick={() => handleExportSessionExcel(entry.id)}
                          disabled={exportingSessionId === entry.id}
                        >
                          {exportingSessionId === entry.id ? 'Downloading...' : 'Excel'}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="table-danger-btn"
                          onClick={() => handleDeleteSession(entry.id)}
                          disabled={deletingSessionId === entry.id}
                        >
                          {deletingSessionId === entry.id ? 'Deleting...' : 'Delete'}
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
        apiMode="admin"
        open={detailSessionId != null}
        onClose={() => setDetailSessionId(null)}
      />
    </main>
  )
}

export default AdminDashboardPage
