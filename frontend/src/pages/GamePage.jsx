import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import api from '../api'
import { saveScoreLocally, getTopLocalScore } from '../lib/scoreStorage'
import {
  bulkAppendEyeFrames,
  getEyeFramesForSession,
  clearEyeFramesForSession,
} from '../lib/gameTelemetryStorage'
import { useAuth } from '../context/AuthContext'
import { drawFaceOverlay, estimateFromLandmarks, loadFaceDetector } from '../lib/eyeTracking'

const WIDTH = 820
const HEIGHT = 520
const BRICK_ROWS = 5
const BRICK_COLS = 10
const BRICK_HEIGHT = 22
const BRICK_GAP = 8
const BRICK_TOP = 60
const PADDLE_WIDTH = 130
const PADDLE_HEIGHT = 14
const BALL_RADIUS = 10
const KEYBOARD_STEP = 44
const SETS = [
  { number: 1, seconds: 30, label: 'Dominant hand', controlMode: 'pointer', instruction: 'Set 1: Use your dominant hand on mouse/trackpad.' },
  { number: 2, seconds: 30, label: 'Non-dominant hand', controlMode: 'pointer', instruction: 'Set 2: Use your non-dominant hand on mouse/trackpad.' },
  { number: 3, seconds: 60, label: 'Keyboard control', controlMode: 'keyboard', instruction: 'Set 3: Press P for right and Q for left repeatedly.' },
]

function createBricks() {
  const totalGap = BRICK_GAP * (BRICK_COLS - 1)
  const brickWidth = (WIDTH - 40 - totalGap) / BRICK_COLS
  const bricks = []

  for (let row = 0; row < BRICK_ROWS; row += 1) {
    for (let col = 0; col < BRICK_COLS; col += 1) {
      bricks.push({
        x: 20 + col * (brickWidth + BRICK_GAP),
        y: BRICK_TOP + row * (BRICK_HEIGHT + BRICK_GAP),
        width: brickWidth,
        height: BRICK_HEIGHT,
        alive: true,
      })
    }
  }

  return bricks
}

function GamePage() {
  const canvasRef = useRef(null)
  const stateRef = useRef(null)
  const animationRef = useRef(null)
  const navigate = useNavigate()
  const { user } = useAuth()

  const [score, setScore] = useState(0)
  const [topScore, setTopScore] = useState(0)
  const [status, setStatus] = useState('Read guide and start 3-set session')
  const [isRunning, setIsRunning] = useState(false)
  const [gameKey, setGameKey] = useState(0)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [detectorReady, setDetectorReady] = useState(false)
  const [trackingMode, setTrackingMode] = useState('off')
  const [secondsPlayed, setSecondsPlayed] = useState(0)
  const [eyeStoredCount, setEyeStoredCount] = useState(0)
  const [blinkCount, setBlinkCount] = useState(0)
  const [faceDetected, setFaceDetected] = useState(false)
  const [showGuide, setShowGuide] = useState(true)
  const [activeSet, setActiveSet] = useState(SETS[0])
  const [transitionModal, setTransitionModal] = useState(null)
  const activeSetRef = useRef(SETS[0])

  const [eyeSeries, setEyeSeries] = useState([])
  const [paddleSeries, setPaddleSeries] = useState([])

  const runningRef = useRef(false)
  const telemetryEnabledRef = useRef(false)
  const telemetryElapsedRef = useRef(0)
  const telemetrySamplesRef = useRef([])
  const prevPaddleTelemetryRef = useRef(0)
  const sessionIdRef = useRef(null)
  const finishingRef = useRef(false)
  const setElapsedRef = useRef(0)
  const countdownTimerRef = useRef(null)

  const lastGazeRef = useRef({ eyeOffsetX: null, eyeOffsetY: null, eyeConfidence: null })
  const lastValidGazeRef = useRef({ eyeOffsetX: 0, eyeOffsetY: 0, eyeConfidence: 0 })
  const videoRef = useRef(null)
  const overlayCanvasRef = useRef(null)
  const detectorRef = useRef(null)
  const detectBusyRef = useRef(false)
  const sessionStorageKeyRef = useRef('')
  const sessionPerfStartRef = useRef(0)
  const pendingEyeFramesRef = useRef([])
  const eyeStoredCountRef = useRef(0)
  const blinkCountRef = useRef(0)
  const eyeClosedRef = useRef(false)
  const blinkEventsInCurrentSecondRef = useRef(0)
  const prevSecondGazeRef = useRef({ eyeOffsetX: 0, eyeOffsetY: 0 })

  const endGameRef = useRef(async () => {})
  const finishSetRef = useRef(async () => {})

  useEffect(() => {
    getTopLocalScore().then(setTopScore).catch(() => setTopScore(0))
  }, [])

  useEffect(() => {
    runningRef.current = isRunning
  }, [isRunning])

  useEffect(() => {
    activeSetRef.current = activeSet
  }, [activeSet])

  useEffect(() => {
    lastGazeRef.current = { eyeOffsetX: null, eyeOffsetY: null, eyeConfidence: null }
    if (!cameraEnabled) {
      setDetectorReady(false)
      detectorRef.current = null
      setTrackingMode('off')
      return undefined
    }

    let cancelled = false
    ;(async () => {
      try {
        const detector = await loadFaceDetector()
        if (cancelled) return
        detectorRef.current = detector
        setTrackingMode('mediapipe')
        setDetectorReady(true)
      } catch (error) {
        console.error('Eye detector init failed:', error)
        if (!cancelled) setDetectorReady(false)
      }
    })()

    return () => {
      cancelled = true
      detectorRef.current = null
      setTrackingMode('off')
      setDetectorReady(false)
    }
  }, [cameraEnabled])

  useEffect(() => {
    if (!cameraEnabled) {
      if (videoRef.current) videoRef.current.srcObject = null
      return undefined
    }

    let stream
    let cancelled = false

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        videoRef.current.srcObject = stream
        await videoRef.current?.play?.().catch(() => {})
      } catch {
        setStatus('Unable to access camera for eye telemetry')
      }
    })()

    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [cameraEnabled])

  useEffect(() => {
    lastGazeRef.current = { eyeOffsetX: null, eyeOffsetY: null, eyeConfidence: null }
    if (!cameraEnabled || !detectorReady) {
      return undefined
    }

    const video = videoRef.current
    const detector = detectorRef.current
    if (!video || !detector?.faceLandmarker) {
      return undefined
    }

    let frameId
    let lastSample = 0

    const tick = async (timestamp) => {
      if (timestamp - lastSample > 50 && !detectBusyRef.current) {
        lastSample = timestamp
        if (video.readyState >= 2) {
          detectBusyRef.current = true
          try {
            const result = detector.faceLandmarker.detectForVideo(video, performance.now())
            const landmarks = result?.faceLandmarks?.[0]
            const metrics = estimateFromLandmarks(landmarks)
            const offsets = metrics
              ? {
                  eyeOffsetX: metrics.eyeOffsetX,
                  eyeOffsetY: metrics.eyeOffsetY,
                  eyeConfidence: metrics.eyeConfidence,
                }
              : null
            const blink = { blinkDetected: Boolean(metrics?.blinkDetected) }
            const hasFace = Boolean(landmarks && landmarks.length)
            drawFaceOverlay(overlayCanvasRef.current, video, landmarks)

            if (offsets) {
              const gazeValue = {
                eyeOffsetX: offsets.eyeOffsetX,
                eyeOffsetY: offsets.eyeOffsetY,
                eyeConfidence: offsets.eyeConfidence,
              }
              lastGazeRef.current = gazeValue
              lastValidGazeRef.current = gazeValue
              setFaceDetected(true)
            } else {
              lastGazeRef.current = { eyeOffsetX: null, eyeOffsetY: null, eyeConfidence: null }
              setFaceDetected(hasFace)
            }

            if (runningRef.current && blink.blinkDetected && !eyeClosedRef.current) {
              blinkCountRef.current += 1
              blinkEventsInCurrentSecondRef.current += 1
              setBlinkCount(blinkCountRef.current)
              eyeClosedRef.current = true
            }
            if (!blink.blinkDetected) {
              eyeClosedRef.current = false
            }

            const key = sessionStorageKeyRef.current
            if (key && cameraEnabled && runningRef.current && offsets) {
              const offsetMs = Math.round(performance.now() - sessionPerfStartRef.current)
              const setInfo = activeSetRef.current
              pendingEyeFramesRef.current.push({
                offsetMs,
                setNumber: setInfo.number,
                setLabel: setInfo.label,
                controlMode: setInfo.controlMode,
                eyeOffsetX: offsets.eyeOffsetX,
                eyeOffsetY: offsets.eyeOffsetY,
                eyeConfidence: offsets.eyeConfidence,
                blinkDetected: blink.blinkDetected,
              })
            }
          } catch {
            lastGazeRef.current = { eyeOffsetX: null, eyeOffsetY: null, eyeConfidence: null }
            setFaceDetected(false)
            drawFaceOverlay(overlayCanvasRef.current, video, null)
          } finally {
            detectBusyRef.current = false
          }
        }
      }

      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [cameraEnabled, detectorReady, gameKey])

  useEffect(() => {
    if (!isRunning) {
      telemetryEnabledRef.current = false
      return undefined
    }

    telemetryEnabledRef.current = true
    prevPaddleTelemetryRef.current = stateRef.current?.paddleX ?? WIDTH / 2 - PADDLE_WIDTH / 2

    const intervalId = window.setInterval(() => {
      if (!telemetryEnabledRef.current || !stateRef.current) return

      telemetryElapsedRef.current += 1
      setElapsedRef.current += 1
      const secondIndex = telemetryElapsedRef.current
      const setInfo = activeSetRef.current
      const paddlePosition = stateRef.current.paddleX
      const paddleDelta = paddlePosition - prevPaddleTelemetryRef.current
      const paddleSpeedPerSecond = Math.abs(paddleDelta)
      prevPaddleTelemetryRef.current = paddlePosition
      const gaze = lastGazeRef.current.eyeOffsetX !== null ? lastGazeRef.current : lastValidGazeRef.current
      const eyeMovementPerSecond = Math.sqrt(
        Math.pow(gaze.eyeOffsetX - prevSecondGazeRef.current.eyeOffsetX, 2) +
          Math.pow(gaze.eyeOffsetY - prevSecondGazeRef.current.eyeOffsetY, 2)
      )
      prevSecondGazeRef.current = {
        eyeOffsetX: gaze.eyeOffsetX,
        eyeOffsetY: gaze.eyeOffsetY,
      }

      const sample = {
        secondIndex,
        setNumber: setInfo.number,
        setLabel: setInfo.label,
        controlMode: setInfo.controlMode,
        paddlePosition,
        paddleDelta,
        paddleSpeedPerSecond: Number(paddleSpeedPerSecond.toFixed(4)),
        blinkDetected: blinkEventsInCurrentSecondRef.current > 0,
        eyeOffsetX: gaze.eyeOffsetX,
        eyeOffsetY: gaze.eyeOffsetY,
        eyeConfidence: gaze.eyeConfidence,
        eyeMovementPerSecond: Number(eyeMovementPerSecond.toFixed(4)),
      }
      blinkEventsInCurrentSecondRef.current = 0

      telemetrySamplesRef.current.push(sample)
      setSecondsPlayed(secondIndex)

      setEyeSeries((prev) => [
        ...prev,
        {
          second: secondIndex,
          gazeX: gaze.eyeOffsetX,
          gazeY: gaze.eyeOffsetY,
          gazeConfidence: gaze.eyeConfidence,
        },
      ])

      setPaddleSeries((prev) => [
        ...prev,
        { second: secondIndex, paddleX: paddlePosition, paddleDelta, paddleSpeedPerSecond },
      ])

      if (setElapsedRef.current >= setInfo.seconds) {
        finishSetRef.current(`Set ${setInfo.number} completed`)
      }
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
      telemetryEnabledRef.current = false
    }
  }, [isRunning, gameKey])

  useEffect(() => {
    if (!isRunning || !sessionStorageKeyRef.current) {
      return undefined
    }

    const storageKey = sessionStorageKeyRef.current
    const flushTimer = window.setInterval(async () => {
      const batch = pendingEyeFramesRef.current.splice(0, 150)
      if (batch.length === 0) return
      try {
        await bulkAppendEyeFrames(storageKey, batch)
        eyeStoredCountRef.current += batch.length
        setEyeStoredCount(eyeStoredCountRef.current)
      } catch {
        pendingEyeFramesRef.current.unshift(...batch)
      }
    }, 200)

    return () => {
      window.clearInterval(flushTimer)
    }
  }, [isRunning, gameKey])

  useEffect(() => {
    endGameRef.current = async (message) => {
      if (finishingRef.current) return
      finishingRef.current = true
      telemetryEnabledRef.current = false

      const telemetrySnapshot = [...telemetrySamplesRef.current]
      const finalScoreValue = stateRef.current?.score ?? 0
      const totalBlinks = blinkCountRef.current
      const activeSessionId = sessionIdRef.current

      setStatus(message)
      setIsRunning(false)
      cancelAnimationFrame(animationRef.current)

      await saveScoreLocally(finalScoreValue)
      const best = await getTopLocalScore()
      setTopScore(best)

      try {
        await api.post('/user/scores', { score: finalScoreValue })
      } catch {
        // leaderboard insert is best-effort
      }

      if (activeSessionId) {
        const storageKey = sessionStorageKeyRef.current
        const remainingBatch = pendingEyeFramesRef.current.splice(0, pendingEyeFramesRef.current.length)
        if (remainingBatch.length > 0 && storageKey) {
          try {
            await bulkAppendEyeFrames(storageKey, remainingBatch)
          } catch {
            pendingEyeFramesRef.current.unshift(...remainingBatch)
          }
        }

        let eyeFramesPayload = []
        if (storageKey) {
          try {
            eyeFramesPayload = await getEyeFramesForSession(storageKey)
          } catch {
            eyeFramesPayload = []
          }
        }

        try {
          await api.post(`/user/game-sessions/${activeSessionId}/complete`, {
            finalScore: finalScoreValue,
            totalBlinks,
            samples: telemetrySnapshot,
            eyeFrames: eyeFramesPayload,
          })
          if (storageKey) {
            await clearEyeFramesForSession(storageKey)
            eyeStoredCountRef.current = 0
            setEyeStoredCount(0)
          }
        } catch {
          setStatus(`${message} (telemetry / eye data not synced — still in IndexedDB)`)
        }
      }

      finishingRef.current = false
    }
  }, [])

  const launchSet = (setIndex) => {
    const setInfo = SETS[setIndex]
    setActiveSet(setInfo)
    activeSetRef.current = setInfo
    setElapsedRef.current = 0
    setTransitionModal(null)
    setStatus(`Set ${setInfo.number} started: ${setInfo.instruction}`)
    stateRef.current = {
      ...(stateRef.current || {}),
      bricks: createBricks(),
      paddleX: WIDTH / 2 - PADDLE_WIDTH / 2,
      ballX: WIDTH / 2,
      ballY: HEIGHT - 64,
      ballDx: 4,
      ballDy: -4,
    }
    setGameKey((value) => value + 1)
    setIsRunning(true)
  }

  useEffect(() => {
    finishSetRef.current = async (reasonMessage) => {
      if (!runningRef.current) return
      const currentSetNumber = activeSetRef.current.number
      const nextSetIndex = currentSetNumber

      setIsRunning(false)
      cancelAnimationFrame(animationRef.current)

      if (nextSetIndex >= SETS.length) {
        await endGameRef.current('Session completed: all 3 sets finished')
        return
      }

      setStatus(`${reasonMessage}. Open popup and continue when ready.`)
      setTransitionModal({
        reason: reasonMessage,
        nextSetIndex,
        phase: 'instruction',
        countdown: 5,
      })
    }
  }, [])

  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        window.clearInterval(countdownTimerRef.current)
      }
    }
  }, [])

  const startGame = async () => {
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    setShowGuide(false)
    finishingRef.current = false
    telemetrySamplesRef.current = []
    telemetryElapsedRef.current = 0
    setSecondsPlayed(0)
    setEyeSeries([])
    setPaddleSeries([])
    setBlinkCount(0)
    blinkCountRef.current = 0
    blinkEventsInCurrentSecondRef.current = 0
    eyeClosedRef.current = false
    lastGazeRef.current = { eyeOffsetX: null, eyeOffsetY: null, eyeConfidence: null }
    lastValidGazeRef.current = { eyeOffsetX: 0, eyeOffsetY: 0, eyeConfidence: 0 }
    prevSecondGazeRef.current = { eyeOffsetX: 0, eyeOffsetY: 0 }
    sessionIdRef.current = null
    setActiveSet(SETS[0])
    activeSetRef.current = SETS[0]
    setTransitionModal(null)
    setElapsedRef.current = 0

    try {
      const response = await api.post('/user/game-sessions')
      sessionIdRef.current = response.data.sessionId
    } catch {
      setStatus('Unable to start server session; saving locally only')
    }

    sessionPerfStartRef.current = performance.now()
    const fallbackId = crypto.randomUUID()
    sessionStorageKeyRef.current =
      sessionIdRef.current != null ? String(sessionIdRef.current) : `local-${fallbackId}`
    pendingEyeFramesRef.current = []
    eyeStoredCountRef.current = 0
    setEyeStoredCount(0)

    stateRef.current = {
      score: 0,
      bricks: createBricks(),
      paddleX: WIDTH / 2 - PADDLE_WIDTH / 2,
      ballX: WIDTH / 2,
      ballY: HEIGHT - 64,
      ballDx: 4,
      ballDy: -4,
    }
    setScore(0)
    launchSet(0)
  }

  const handleReadyForNextSet = () => {
    if (!transitionModal || transitionModal.phase !== 'instruction') return
    let counter = 5
    setTransitionModal((prev) => (prev ? { ...prev, phase: 'countdown', countdown: counter } : prev))
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current)
    }
    countdownTimerRef.current = window.setInterval(() => {
      counter -= 1
      if (counter <= 0) {
        window.clearInterval(countdownTimerRef.current)
        countdownTimerRef.current = null
        launchSet(transitionModal.nextSetIndex)
        return
      }
      setTransitionModal((prev) => (prev ? { ...prev, countdown: counter } : prev))
    }, 1000)
  }

  useEffect(() => {
    if (!isRunning) {
      return undefined
    }

    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    const colors = ['#60a5fa', '#818cf8', '#a78bfa', '#22d3ee', '#34d399']

    const draw = () => {
      const state = stateRef.current
      context.clearRect(0, 0, WIDTH, HEIGHT)

      const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT)
      gradient.addColorStop(0, '#eff6ff')
      gradient.addColorStop(1, '#ede9fe')
      context.fillStyle = gradient
      context.fillRect(0, 0, WIDTH, HEIGHT)

      state.bricks.forEach((brick, index) => {
        if (!brick.alive) return
        context.fillStyle = colors[index % colors.length]
        context.fillRect(brick.x, brick.y, brick.width, brick.height)
        context.strokeStyle = 'rgba(255,255,255,0.5)'
        context.strokeRect(brick.x, brick.y, brick.width, brick.height)
      })

      context.fillStyle = '#1d4ed8'
      context.fillRect(state.paddleX, HEIGHT - 30, PADDLE_WIDTH, PADDLE_HEIGHT)

      context.beginPath()
      context.arc(state.ballX, state.ballY, BALL_RADIUS, 0, Math.PI * 2)
      context.fillStyle = '#f97316'
      context.fill()
      context.closePath()
    }

    const tick = async () => {
      const state = stateRef.current
      if (!state) return

      state.ballX += state.ballDx
      state.ballY += state.ballDy

      if (state.ballX <= BALL_RADIUS || state.ballX >= WIDTH - BALL_RADIUS) {
        state.ballDx *= -1
      }

      if (state.ballY <= BALL_RADIUS) {
        state.ballDy *= -1
      }

      const paddleY = HEIGHT - 30
      if (
        state.ballY + BALL_RADIUS >= paddleY &&
        state.ballX >= state.paddleX &&
        state.ballX <= state.paddleX + PADDLE_WIDTH &&
        state.ballDy > 0
      ) {
        state.ballDy *= -1
      }

      for (const brick of state.bricks) {
        if (!brick.alive) continue
        const insideX = state.ballX >= brick.x && state.ballX <= brick.x + brick.width
        const insideY = state.ballY >= brick.y && state.ballY <= brick.y + brick.height
        if (insideX && insideY) {
          brick.alive = false
          state.ballDy *= -1
          state.score += 10
          setScore(state.score)
          break
        }
      }

      const remaining = state.bricks.filter((brick) => brick.alive).length
      if (remaining === 0) {
        await finishSetRef.current(`Set ${activeSetRef.current.number}: all bricks cleared`)
        return
      }

      if (state.ballY > HEIGHT + BALL_RADIUS) {
        await finishSetRef.current(`Set ${activeSetRef.current.number}: game over (out)`)
        return
      }

      draw()
      animationRef.current = requestAnimationFrame(tick)
    }

    draw()
    animationRef.current = requestAnimationFrame(tick)

    const onMove = (event) => {
      if (activeSetRef.current.controlMode !== 'pointer') return
      const rect = canvas.getBoundingClientRect()
      const clientX = event.touches ? event.touches[0].clientX : event.clientX
      const nextX = clientX - rect.left - PADDLE_WIDTH / 2
      const state = stateRef.current
      state.paddleX = Math.max(0, Math.min(WIDTH - PADDLE_WIDTH, nextX))
    }

    const onKeyDown = (event) => {
      if (activeSetRef.current.controlMode !== 'keyboard') return
      const state = stateRef.current
      if (!state) return
      const step = event.repeat ? KEYBOARD_STEP + 10 : KEYBOARD_STEP
      if (event.key === 'q' || event.key === 'Q') {
        state.paddleX = Math.max(0, state.paddleX - step)
      }
      if (event.key === 'p' || event.key === 'P') {
        state.paddleX = Math.min(WIDTH - PADDLE_WIDTH, state.paddleX + step)
      }
    }

    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('keydown', onKeyDown)

    return () => {
      cancelAnimationFrame(animationRef.current)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('touchmove', onMove)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isRunning, gameKey])

  return (
    <main className="page">
      <div className="shape one" aria-hidden="true" />
      <div className="shape two" aria-hidden="true" />
      <div className="card wide game-layout">
        <div className="top-bar">
          <h1 className="card-title">Brick Ball Game</h1>
          <button
            type="button"
            className="ghost-btn"
            onClick={() =>
              navigate(user?.role === 'admin' ? '/admin/dashboard' : '/user/dashboard')
            }
          >
            Back
          </button>
        </div>
        <p className="subtitle">{status}</p>
        {showGuide ? (
          <div className="panel">
            <h3>Session Guide (3 Sets)</h3>
            <p className="muted-text">Read instructions once, then press Start Session.</p>
            <ol className="session-guide-list">
              <li>Set 1 (30 sec): Use your dominant hand.</li>
              <li>Set 2 (30 sec): Use your non-dominant hand.</li>
              <li>Set 3 (60 sec): Use keyboard keys only - press Q for left and P for right.</li>
            </ol>
          </div>
        ) : null}
        <p className="hint-text">
          Tracking: {cameraEnabled ? (detectorReady ? (faceDetected ? `Face detected (${trackingMode})` : `No face lock (${trackingMode})`) : 'Loading model...') : 'Camera disabled'}
        </p>

        <label className="camera-toggle">
          <input
            type="checkbox"
            checked={cameraEnabled}
            onChange={(event) => setCameraEnabled(event.target.checked)}
          />
          <span>Enable webcam — live preview + full eye trace stored in IndexedDB, synced with this session</span>
        </label>
        <p className="hint-text">
          Paddle telemetry is saved once per second for graphs. Eye gaze is sampled ~20× per second, buffered to
          IndexedDB, and uploaded with the same session when the game ends.
        </p>
        <p className="hint-text">
          Naming + units: secondIndex (s), offsetMs (ms), paddleX (px), paddleDelta (px), paddleSpeedPerSecond
          (px/s), eyeOffsetX (normalized left-right), eyeOffsetY (normalized up-down), eyeConfidence (0-1),
          blinkDetected (0/1).
        </p>

        <div className="stats-grid">
          <div className="panel">
            <h3>Current Score</h3>
            <p className="big-number">{score}</p>
          </div>
          <div className="panel">
            <h3>Best Local Score</h3>
            <p className="big-number">{topScore}</p>
          </div>
          <div className="panel">
            <h3>Session Seconds</h3>
            <p className="big-number">
              {secondsPlayed}s
            </p>
          </div>
          <div className="panel">
            <h3>Active Set</h3>
            <p className="big-number">{activeSet.number}</p>
          </div>
          <div className="panel">
            <h3>Eye frames (IndexedDB)</h3>
            <p className="big-number">{eyeStoredCount}</p>
          </div>
          <div className="panel">
            <h3>Total Blinks</h3>
            <p className="big-number">{blinkCount}</p>
          </div>
        </div>

        <div className="game-main-row">
          <div className="panel game-panel">
            <canvas ref={canvasRef} className="game-canvas" width={WIDTH} height={HEIGHT} />
          </div>
          <div className="panel camera-preview-panel">
            <h3>Live camera</h3>
            <p className="camera-preview-meta">
              {cameraEnabled
                ? 'Face mesh runs locally. Every reading is written to IndexedDB and attached to this session on game over.'
                : 'Turn on the toggle above to show your camera here and record gaze samples.'}
            </p>
            <video
              ref={videoRef}
              playsInline
              muted
              className={cameraEnabled ? 'camera-video' : 'camera-video camera-video--muted'}
            />
            <canvas ref={overlayCanvasRef} className="camera-overlay" />
          </div>
        </div>

        <div className="telemetry-grid">
          <div className="panel chart-panel">
            <h3>Eye movement (eyeball left-right/up-down, per second [s])</h3>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={eyeSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="second" />
                  <YAxis domain={[-1.2, 1.2]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="gazeX" stroke="#2563eb" dot={false} connectNulls name="eyeOffsetX (eyeball left-right, normalized)" />
                  <Line type="monotone" dataKey="gazeY" stroke="#c026d3" dot={false} connectNulls name="eyeOffsetY (eyeball up-down, normalized)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="panel chart-panel">
            <h3>Paddle movement (slider left-right) and speed (per second [s])</h3>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={paddleSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="second" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="paddleX" stroke="#0f766e" dot={false} name="paddleX (slider position, px)" />
                  <Line type="monotone" dataKey="paddleDelta" stroke="#f97316" dot={false} name="paddleDelta (left-right change, px)" />
                  <Line type="monotone" dataKey="paddleSpeedPerSecond" stroke="#7c3aed" dot={false} name="paddleSpeedPerSecond (slider speed, px/s)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="game-actions">
          <button type="button" className="primary-btn" onClick={startGame}>
            {isRunning ? 'Restart Session' : 'Start Session'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => setShowGuide((value) => !value)}>
            {showGuide ? 'Hide Guide' : 'Show Guide'}
          </button>
        </div>
      </div>
      {transitionModal ? (
        <div className="set-popup-backdrop">
          <div className="set-popup-card">
            <h3>Set {SETS[transitionModal.nextSetIndex].number} Ready</h3>
            <p className="muted-text">{transitionModal.reason}</p>
            <p className="muted-text">{SETS[transitionModal.nextSetIndex].instruction}</p>
            {transitionModal.phase === 'instruction' ? (
              <button type="button" className="primary-btn" onClick={handleReadyForNextSet}>
                I'm Ready
              </button>
            ) : (
              <p className="set-countdown-text">
                Starting in {transitionModal.countdown}s...
              </p>
            )}
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default GamePage
