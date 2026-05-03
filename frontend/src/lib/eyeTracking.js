/**
 * MediaPipe Face Landmarker based tracker with stable face mesh points.
 * Returns normalized gaze estimates and supports drawing an overlay.
 */
export async function loadFaceDetector() {
  const vision = await import('@mediapipe/tasks-vision')
  const filesetResolver = await vision.FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  )

  const faceLandmarker = await vision.FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    },
    outputFaceBlendshapes: false,
    runningMode: 'VIDEO',
    numFaces: 1,
  })

  return { faceLandmarker }
}

function distance(p1, p2) {
  if (!p1 || !p2) return null
  const dx = p1.x - p2.x
  const dy = p1.y - p2.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function estimateFromLandmarks(landmarks) {
  if (!landmarks || landmarks.length < 478) return null

  const leftIris = landmarks[468]
  const rightIris = landmarks[473]
  const leftUpper = landmarks[159]
  const leftLower = landmarks[145]
  const leftOuter = landmarks[33]
  const leftInner = landmarks[133]
  const rightUpper = landmarks[386]
  const rightLower = landmarks[374]
  const rightOuter = landmarks[362]
  const rightInner = landmarks[263]

  if (!leftIris || !rightIris) return null

  const centerX = (leftIris.x + rightIris.x) / 2
  const centerY = (leftIris.y + rightIris.y) / 2

  const eyeOffsetX = Number(((centerX - 0.5) * 2).toFixed(4))
  const eyeOffsetY = Number(((centerY - 0.5) * 2).toFixed(4))

  const leftOpen = distance(leftUpper, leftLower)
  const leftWidth = distance(leftOuter, leftInner)
  const rightOpen = distance(rightUpper, rightLower)
  const rightWidth = distance(rightOuter, rightInner)

  let blinkDetected = false
  let eyeAspectRatio = null
  if (leftOpen && leftWidth && rightOpen && rightWidth) {
    const ear = (leftOpen / leftWidth + rightOpen / rightWidth) / 2
    eyeAspectRatio = Number(ear.toFixed(4))
    blinkDetected = ear < 0.2
  }

  return {
    eyeOffsetX,
    eyeOffsetY,
    eyeConfidence: 0.9,
    blinkDetected,
    eyeAspectRatio,
  }
}

export function drawFaceOverlay(overlayCanvas, video, landmarks) {
  if (!overlayCanvas || !video) return
  const ctx = overlayCanvas.getContext('2d')
  const width = video.videoWidth || video.clientWidth || 640
  const height = video.videoHeight || video.clientHeight || 480
  overlayCanvas.width = width
  overlayCanvas.height = height
  ctx.clearRect(0, 0, width, height)

  if (!landmarks || landmarks.length === 0) return

  ctx.strokeStyle = 'rgba(37,99,235,0.9)'
  ctx.lineWidth = 1.3
  for (let i = 0; i < landmarks.length; i += 12) {
    const pt = landmarks[i]
    ctx.beginPath()
    ctx.arc(pt.x * width, pt.y * height, 1.5, 0, Math.PI * 2)
    ctx.stroke()
  }

  const irisIndices = [468, 473]
  ctx.fillStyle = 'rgba(249,115,22,0.95)'
  irisIndices.forEach((idx) => {
    const pt = landmarks[idx]
    if (!pt) return
    ctx.beginPath()
    ctx.arc(pt.x * width, pt.y * height, 3.5, 0, Math.PI * 2)
    ctx.fill()
  })
}
