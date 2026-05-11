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
  const [selectedSessionIds, setSelectedSessionIds] = useState([])
  const [selectedScoreIds, setSelectedScoreIds] = useState([])
  const [deletingScoreId, setDeletingScoreId] = useState(null)

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
        setSelectedSessionIds([])
        setSelectedScoreIds([])
        return
      }

      try {
        const [scoresRes, sessionsRes] = await Promise.all([
          api.get(`/admin/users/${selectedUserId}/scores`),
          api.get(`/admin/users/${selectedUserId}/game-sessions`),
        ])
        setSelectedUserScores(scoresRes.data)
        setSelectedUserSessions(sessionsRes.data)
        setSelectedSessionIds([])
        setSelectedScoreIds([])
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
      setSelectedSessionIds((prev) => prev.filter((id) => id !== sessionId))
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

  const handleSelectSession = (sessionId, checked) => {
    setSelectedSessionIds((prev) => {
      if (checked) {
        return prev.includes(sessionId) ? prev : [...prev, sessionId]
      }
      return prev.filter((id) => id !== sessionId)
    })
  }

  const handleSelectAllSessions = (checked) => {
    if (!checked) {
      setSelectedSessionIds([])
      return
    }
    setSelectedSessionIds(selectedUserSessions.map((entry) => entry.id))
  }

  const handleDeleteSelectedSessions = async () => {
    if (selectedSessionIds.length === 0) return
    const yes = window.confirm(
      `Delete ${selectedSessionIds.length} selected sessions? This is permanent.`
    )
    if (!yes) return

    try {
      setDeletingSessionId('bulk')
      await Promise.all(selectedSessionIds.map((sessionId) => api.delete(`/admin/game-sessions/${sessionId}`)))
      const deletedSet = new Set(selectedSessionIds)
      setSelectedUserSessions((prev) => prev.filter((entry) => !deletedSet.has(entry.id)))
      setSelectedSessionIds([])
      if (detailSessionId != null && deletedSet.has(detailSessionId)) {
        setDetailSessionId(null)
      }
      setError('')
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete selected sessions')
    } finally {
      setDeletingSessionId(null)
    }
  }

  const handleDeleteScoreAndRelatedSessions = async (scoreId) => {
    if (!selectedUserId) return
    const yes = window.confirm(
      'Delete this score and all sessions for this user with the same final score?'
    )
    if (!yes) return

    try {
      setDeletingScoreId(scoreId)
      const { data } = await api.delete(`/admin/users/${selectedUserId}/scores/${scoreId}`)
      setSelectedUserScores((prev) => prev.filter((entry) => entry.id !== scoreId))
      setSelectedScoreIds((prev) => prev.filter((id) => id !== scoreId))
      if (Array.isArray(data.relatedSessionIds) && data.relatedSessionIds.length > 0) {
        const relatedSet = new Set(data.relatedSessionIds)
        setSelectedUserSessions((prev) =>
          prev.filter((entry) => !relatedSet.has(entry.id))
        )
        setSelectedSessionIds((prev) => prev.filter((id) => !relatedSet.has(id)))
        if (detailSessionId != null && relatedSet.has(detailSessionId)) {
          setDetailSessionId(null)
        }
      }
      setError('')
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete score')
    } finally {
      setDeletingScoreId(null)
    }
  }

  const handleSelectScore = (scoreId, checked) => {
    setSelectedScoreIds((prev) => {
      if (checked) {
        return prev.includes(scoreId) ? prev : [...prev, scoreId]
      }
      return prev.filter((id) => id !== scoreId)
    })
  }

  const handleSelectAllScores = (checked) => {
    if (!checked) {
      setSelectedScoreIds([])
      return
    }
    setSelectedScoreIds(selectedUserScores.map((entry) => entry.id))
  }

  const handleDeleteSelectedScores = async () => {
    if (!selectedUserId || selectedScoreIds.length === 0) return
    const yes = window.confirm(
      `Delete ${selectedScoreIds.length} selected score(s) and their related sessions?`
    )
    if (!yes) return

    try {
      setDeletingScoreId('bulk')
      const responses = await Promise.all(
        selectedScoreIds.map((scoreId) => api.delete(`/admin/users/${selectedUserId}/scores/${scoreId}`))
      )

      const deletedScoreSet = new Set(selectedScoreIds)
      const relatedSessionIds = responses.flatMap((response) =>
        Array.isArray(response?.data?.relatedSessionIds) ? response.data.relatedSessionIds : []
      )
      const relatedSessionSet = new Set(relatedSessionIds)

      setSelectedUserScores((prev) => prev.filter((entry) => !deletedScoreSet.has(entry.id)))
      setSelectedScoreIds([])

      if (relatedSessionSet.size > 0) {
        setSelectedUserSessions((prev) => prev.filter((entry) => !relatedSessionSet.has(entry.id)))
        setSelectedSessionIds((prev) => prev.filter((id) => !relatedSessionSet.has(id)))
        if (detailSessionId != null && relatedSessionSet.has(detailSessionId)) {
          setDetailSessionId(null)
        }
      }

      setError('')
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete selected scores')
    } finally {
      setDeletingScoreId(null)
    }
  }

  return (
    <main className="page page--full">
      <div className="card wide card--fluid">
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
          <div className="game-actions">
            <button
              type="button"
              className="table-danger-btn"
              onClick={handleDeleteSelectedScores}
              disabled={selectedScoreIds.length === 0 || deletingScoreId === 'bulk'}
            >
              {deletingScoreId === 'bulk'
                ? 'Deleting selected scores...'
                : `Delete Selected Scores (${selectedScoreIds.length})`}
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={
                        selectedUserScores.length > 0 &&
                        selectedScoreIds.length === selectedUserScores.length
                      }
                      onChange={(event) => handleSelectAllScores(event.target.checked)}
                    />
                  </th>
                  <th>#</th>
                  <th>Score</th>
                  <th>Played At</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {selectedUserId === '' ? (
                  <tr>
                    <td colSpan={5}>Select a user to view scores.</td>
                  </tr>
                ) : selectedUserScores.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No scores found for this user.</td>
                  </tr>
                ) : (
                  selectedUserScores.map((entry, index) => (
                    <tr key={entry.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedScoreIds.includes(entry.id)}
                          onChange={(event) => handleSelectScore(entry.id, event.target.checked)}
                        />
                      </td>
                      <td>{index + 1}</td>
                      <td>{entry.score}</td>
                      <td>{new Date(entry.createdAt).toLocaleString()}</td>
                      <td>
                        <button
                          type="button"
                          className="table-danger-btn"
                          onClick={() => handleDeleteScoreAndRelatedSessions(entry.id)}
                          disabled={deletingScoreId === entry.id || deletingScoreId === 'bulk'}
                        >
                          {deletingScoreId === entry.id ? 'Deleting...' : 'Delete score + related sessions'}
                        </button>
                      </td>
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
          <div className="game-actions">
            <button
              type="button"
              className="table-danger-btn"
              onClick={handleDeleteSelectedSessions}
              disabled={selectedSessionIds.length === 0 || deletingSessionId === 'bulk'}
            >
              {deletingSessionId === 'bulk'
                ? 'Deleting selected sessions...'
                : `Delete Selected Sessions (${selectedSessionIds.length})`}
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={
                        selectedUserSessions.length > 0 &&
                        selectedSessionIds.length === selectedUserSessions.length
                      }
                      onChange={(event) => handleSelectAllSessions(event.target.checked)}
                    />
                  </th>
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
                    <td colSpan={12}>Select a user to view telemetry sessions.</td>
                  </tr>
                ) : selectedUserSessions.length === 0 ? (
                  <tr>
                    <td colSpan={12}>No completed telemetry sessions for this user.</td>
                  </tr>
                ) : (
                  selectedUserSessions.map((entry, index) => (
                    <tr key={entry.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedSessionIds.includes(entry.id)}
                          onChange={(event) => handleSelectSession(entry.id, event.target.checked)}
                        />
                      </td>
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
