import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import api from '../api'

function SessionDetailModal({ sessionId, apiMode, open, onClose }) {
  const [bundle, setBundle] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || sessionId == null) {
      return undefined
    }

    let cancelled = false
    const url =
      apiMode === 'admin' ? `/admin/game-sessions/${sessionId}` : `/user/game-sessions/${sessionId}`

    ;(async () => {
      try {
        setLoading(true)
        setError('')
        setBundle(null)
        const { data } = await api.get(url)
        if (!cancelled) {
          setBundle(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || 'Could not load session')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, sessionId, apiMode])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const session = bundle?.session
  const samples = bundle?.samples ?? []
  const eyeFrames = bundle?.eyeFrames ?? []
  const eyeFramesMeta = bundle?.eyeFramesMeta

  const perSecondData = samples.reduce(
    (acc, row) => {
      const cumulativeBlinks =
        acc.running + (row.blinkDetected ? 1 : 0)
      acc.rows.push({
        second: row.secondIndex,
        setNumber: row.setNumber ?? 1,
        setLabel: row.setLabel ?? '',
        controlMode: row.controlMode ?? 'pointer',
        paddle: row.paddlePosition,
        paddleDelta: row.paddleDelta,
        paddleSpeedPerSecond: row.paddleSpeedPerSecond,
        eyeMove: row.eyeMovementPerSecond,
        eyeConf: row.eyeConfidence ?? null,
        eyeX: row.eyeOffsetX,
        eyeY: row.eyeOffsetY,
        blinkThisSecond: row.blinkDetected ? 1 : 0,
        cumulativeBlinks,
      })
      return { rows: acc.rows, running: cumulativeBlinks }
    },
    { rows: [], running: 0 },
  ).rows

  const eyeFrameData = eyeFrames.map((f) => ({
    t: f.offsetMs / 1000,
    setNumber: f.setNumber ?? 1,
    setLabel: f.setLabel ?? '',
    controlMode: f.controlMode ?? 'pointer',
    eyeX: f.eyeOffsetX,
    eyeY: f.eyeOffsetY,
    conf: f.eyeConfidence,
    blinkFlag: f.blinkDetected ? 1 : 0,
  }))

  const setBuckets = [1, 2, 3].map((setNumber) => {
    const perSetSamples = perSecondData.filter((row) => row.setNumber === setNumber)
    const perSetFrames = eyeFrameData.filter((row) => row.setNumber === setNumber)
    const setLabel = perSetSamples[0]?.setLabel || perSetFrames[0]?.setLabel || `Set ${setNumber}`
    const controlMode = perSetSamples[0]?.controlMode || perSetFrames[0]?.controlMode || 'pointer'
    return {
      setNumber,
      setLabel,
      controlMode,
      perSetSamples,
      perSetFrames,
    }
  })

  return (
    <div className="session-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="session-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-detail-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="session-modal-head">
          <h2 id="session-detail-title">Session telemetry</h2>
          <button type="button" className="ghost-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {loading ? <p className="muted-text">Loading…</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {session && !loading && !error ? (
          <>
            <div className="session-meta-grid">
              {session.fullName != null ? (
                <div className="session-meta-item">
                  <strong>Player</strong>
                  {session.fullName}
                  {session.email ? ` (${session.email})` : ''}
                </div>
              ) : null}
              <div className="session-meta-item">
                <strong>Session ID</strong>
                {session.id}
              </div>
              <div className="session-meta-item">
                <strong>Final score</strong>
                {session.finalScore}
              </div>
              <div className="session-meta-item">
                <strong>Duration</strong>
                {session.durationSeconds}s
              </div>
              <div className="session-meta-item">
                <strong>Total blinks</strong>
                {session.totalBlinks}
              </div>
              <div className="session-meta-item">
                <strong>Session type</strong>
                {session.sessionType || 'three_set_reflex'}
              </div>
              <div className="session-meta-item">
                <strong>Started</strong>
                {session.startedAt ? new Date(session.startedAt).toLocaleString() : '—'}
              </div>
              <div className="session-meta-item">
                <strong>Ended</strong>
                {session.endedAt ? new Date(session.endedAt).toLocaleString() : '—'}
              </div>
            </div>

            {eyeFramesMeta?.downsampled ? (
              <p className="hint-text session-hint">
                Eye trace shows {eyeFramesMeta.returnedCount.toLocaleString()} of{' '}
                {eyeFramesMeta.totalCount.toLocaleString()} frames (evenly sampled for performance).
              </p>
            ) : null}

            <div className="session-chart-block">
              <h4>Data collection summary (set-wise)</h4>
              <p className="muted-text">
                Technical + normal names: eyeOffsetX (eyeball left-right), eyeOffsetY (eyeball up-down),
                eyeConfidence (tracking reliability), blinkDetected (blink happened), paddleX (slider position).
              </p>
              <p className="muted-text">
                Units: secondIndex (s), offsetMs (ms), paddleX/paddleDelta (px), paddleSpeedPerSecond (px/s),
                eyeOffsetX/eyeOffsetY (normalized), eyeConfidence (0-1), blinkDetected (0/1).
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Set</th>
                      <th>Instruction Group</th>
                      <th>Control</th>
                      <th>Paddle/Eye rows</th>
                      <th>Eye frames</th>
                      <th>Blink seconds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {setBuckets.map((bucket) => (
                      <tr key={bucket.setNumber}>
                        <td>{bucket.setNumber}</td>
                        <td>{bucket.setLabel}</td>
                        <td>{bucket.controlMode}</td>
                        <td>{bucket.perSetSamples.length}</td>
                        <td>{bucket.perSetFrames.length}</td>
                        <td>
                          {bucket.perSetSamples.reduce(
                            (sum, row) => sum + (row.blinkThisSecond ? 1 : 0),
                            0
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="session-charts">
              {setBuckets.map((bucket) => (
                <div key={bucket.setNumber} className="session-chart-block">
                  <h4>
                    Set {bucket.setNumber} - {bucket.setLabel} ({bucket.controlMode})
                  </h4>
                  <div className="chart-wrap chart-wrap--tall">
                    <ResponsiveContainer width="100%" height={230}>
                      <LineChart data={bucket.perSetSamples}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.4)" />
                        <XAxis dataKey="second" tick={{ fill: '#64748b', fontSize: 12 }} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 12,
                            border: '1px solid rgba(148,163,184,0.35)',
                          }}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="paddle" stroke="#6366f1" dot={false} name="paddleX (slider position, px)" strokeWidth={2} />
                        <Line type="monotone" dataKey="paddleSpeedPerSecond" stroke="#7c3aed" dot={false} name="paddleSpeedPerSecond (slider speed, px/s)" strokeWidth={2} />
                        <Line type="monotone" dataKey="eyeMove" stroke="#a855f7" dot={false} name="eyeMovementPerSecond (eyeball movement, normalized/s)" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="chart-wrap chart-wrap--tall">
                    <ResponsiveContainer width="100%" height={230}>
                      <ComposedChart data={bucket.perSetSamples}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.4)" />
                        <XAxis dataKey="second" tick={{ fill: '#64748b', fontSize: 12 }} />
                        <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 12 }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 12 }} />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 12,
                            border: '1px solid rgba(148,163,184,0.35)',
                          }}
                        />
                        <Legend />
                        <Bar yAxisId="left" dataKey="blinkThisSecond" fill="rgba(99,102,241,0.55)" name="blinkDetected (blink happened this second, 0/1)" />
                        <Line yAxisId="right" type="stepAfter" dataKey="cumulativeBlinks" stroke="#334155" dot={false} name="cumulativeBlinks (running blink count)" strokeWidth={2} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="chart-wrap chart-wrap--tall">
                    {bucket.perSetFrames.length === 0 ? (
                      <p className="muted-text">No high-rate eye frames in this set.</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={230}>
                        <LineChart data={bucket.perSetFrames}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.4)" />
                          <XAxis dataKey="t" tick={{ fill: '#64748b', fontSize: 11 }} />
                          <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
                          <Tooltip
                            contentStyle={{
                              borderRadius: 12,
                              border: '1px solid rgba(148,163,184,0.35)',
                            }}
                          />
                          <Legend />
                          <Line type="monotone" dataKey="eyeX" stroke="#14b8a6" dot={false} name="eyeOffsetX (eyeball left-right, normalized)" strokeWidth={1} />
                          <Line type="monotone" dataKey="eyeY" stroke="#eab308" dot={false} name="eyeOffsetY (eyeball up-down, normalized)" strokeWidth={1} />
                          <Line type="monotone" dataKey="conf" stroke="#94a3b8" dot={false} name="eyeConfidence (tracking reliability, 0-1)" strokeWidth={1} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

export default SessionDetailModal
