const express = require('express');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const {
  listCompletedSessionsForUser,
  getSessionTelemetryBundle,
} = require('../services/sessionTelemetry');

const router = express.Router();

router.get('/dashboard', verifyToken, requireRole('user'), (req, res) => {
  return res.json({
    title: 'User Dashboard',
    message: `Welcome ${req.user.email}, you are logged in successfully.`,
  });
});

router.post('/scores', verifyToken, async (req, res) => {
  try {
    const { score } = req.body;
    if (!Number.isFinite(score) || score < 0) {
      return res.status(400).json({ message: 'Invalid score' });
    }

    await db.query('INSERT INTO game_scores (user_id, score) VALUES (?, ?)', [
      req.user.id,
      Math.floor(score),
    ]);

    return res.status(201).json({ message: 'Score saved' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save score', error: error.message });
  }
});

router.get('/scores', verifyToken, async (req, res) => {
  try {
    const [scores] = await db.query(
      `SELECT id, score, created_at
       FROM game_scores
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    return res.json(
      scores.map((entry) => ({
        id: entry.id,
        score: entry.score,
        createdAt: entry.created_at,
      }))
    );
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch scores', error: error.message });
  }
});

router.get('/game-sessions', verifyToken, async (req, res) => {
  try {
    const rows = await listCompletedSessionsForUser(req.user.id, { includeUserColumns: false });
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch game sessions', error: error.message });
  }
});

router.get('/game-sessions/:sessionId', verifyToken, async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ message: 'Invalid session id' });
    }

    const bundle = await getSessionTelemetryBundle(sessionId, req.user.id, { includeUser: false });
    if (!bundle) {
      return res.status(404).json({ message: 'Session not found' });
    }

    return res.json(bundle);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load session telemetry', error: error.message });
  }
});

router.post('/game-sessions', verifyToken, async (req, res) => {
  try {
    const [result] = await db.query(
      `INSERT INTO game_sessions (user_id, status) VALUES (?, 'active')`,
      [req.user.id]
    );

    return res.status(201).json({ sessionId: result.insertId });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create game session', error: error.message });
  }
});

router.post('/game-sessions/:sessionId/complete', verifyToken, async (req, res) => {
  const rawSessionId = Number(req.params.sessionId);
  if (!Number.isInteger(rawSessionId) || rawSessionId <= 0) {
    return res.status(400).json({ message: 'Invalid session id' });
  }

  try {
    const { finalScore, totalBlinks = 0, samples, eyeFrames } = req.body || {};
    if (!Number.isFinite(finalScore) || finalScore < 0) {
      return res.status(400).json({ message: 'Invalid final score' });
    }

    if (!Number.isFinite(totalBlinks) || totalBlinks < 0) {
      return res.status(400).json({ message: 'Invalid total blink count' });
    }

    if (!Array.isArray(samples)) {
      return res.status(400).json({ message: 'samples must be an array' });
    }

    const MAX_SAMPLES = 7200;
    if (samples.length > MAX_SAMPLES) {
      return res.status(400).json({ message: 'Too many telemetry samples' });
    }

    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const expectedSecond = index + 1;

      const isEyeFieldValid = (value) => value === null || value === undefined || Number.isFinite(value);

      if (
        !sample ||
        sample.secondIndex !== expectedSecond ||
        typeof sample.paddlePosition !== 'number' ||
        typeof sample.paddleDelta !== 'number' ||
        typeof sample.paddleSpeedPerSecond !== 'number' ||
        typeof sample.blinkDetected !== 'boolean' ||
        typeof sample.eyeMovementPerSecond !== 'number' ||
        sample.paddlePosition < 0 ||
        !Number.isFinite(sample.secondIndex) ||
        !Number.isFinite(sample.paddleSpeedPerSecond) ||
        sample.paddleSpeedPerSecond < 0 ||
        !Number.isFinite(sample.eyeMovementPerSecond)
      ) {
        return res.status(400).json({ message: `Invalid sample payload at row ${expectedSecond}` });
      }

      if (
        !isEyeFieldValid(sample.eyeOffsetX) ||
        !isEyeFieldValid(sample.eyeOffsetY) ||
        !isEyeFieldValid(sample.eyeConfidence)
      ) {
        return res.status(400).json({ message: `Invalid eye metrics at row ${expectedSecond}` });
      }

      const confidence = sample.eyeConfidence;
      if (confidence !== undefined && confidence !== null && (confidence < 0 || confidence > 1)) {
        return res.status(400).json({ message: `Confidence must be between 0 and 1 at row ${expectedSecond}` });
      }
    }

    let normalizedEyeFrames = [];
    if (eyeFrames !== undefined && eyeFrames !== null) {
      if (!Array.isArray(eyeFrames)) {
        return res.status(400).json({ message: 'eyeFrames must be an array' });
      }

      const MAX_EYE_FRAMES = 80000;
      if (eyeFrames.length > MAX_EYE_FRAMES) {
        return res.status(400).json({ message: 'Too many eye frame samples' });
      }

      const isNullableNumber = (value) => value === null || value === undefined || Number.isFinite(value);

      for (let index = 0; index < eyeFrames.length; index += 1) {
        const frame = eyeFrames[index];
        if (
          !frame ||
          typeof frame.offsetMs !== 'number' ||
          !Number.isFinite(frame.offsetMs) ||
          frame.offsetMs < 0 ||
          frame.offsetMs > 86400000
        ) {
          return res.status(400).json({ message: `Invalid eye frame at index ${index}` });
        }

        if (
          !isNullableNumber(frame.eyeOffsetX) ||
          !isNullableNumber(frame.eyeOffsetY) ||
          !isNullableNumber(frame.eyeConfidence)
        ) {
          return res.status(400).json({ message: `Invalid eye metrics at frame ${index}` });
        }

        const confidence = frame.eyeConfidence;
        if (confidence !== undefined && confidence !== null && (confidence < 0 || confidence > 1)) {
          return res.status(400).json({ message: `Eye confidence must be between 0 and 1 at frame ${index}` });
        }

        normalizedEyeFrames.push([
          rawSessionId,
          Math.round(frame.offsetMs),
          frame.eyeOffsetX === undefined || frame.eyeOffsetX === null ? null : frame.eyeOffsetX,
          frame.eyeOffsetY === undefined || frame.eyeOffsetY === null ? null : frame.eyeOffsetY,
          frame.eyeConfidence === undefined || frame.eyeConfidence === null ? null : frame.eyeConfidence,
          frame.blinkDetected ? 1 : 0,
        ]);
      }
    }

    const durationSeconds = samples.length;
    let connection;

    try {
      connection = await db.getConnection();
      await connection.beginTransaction();

      const [sessionRows] = await connection.query(
        `SELECT id, status
         FROM game_sessions
         WHERE id = ? AND user_id = ?`,
        [rawSessionId, req.user.id]
      );

      if (sessionRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: 'Session not found' });
      }

      if (sessionRows[0].status !== 'active') {
        await connection.rollback();
        return res.status(409).json({ message: 'Session already completed' });
      }

      const [updateResult] = await connection.query(
        `UPDATE game_sessions
         SET ended_at = CURRENT_TIMESTAMP,
             duration_seconds = ?,
             final_score = ?,
             total_blinks = ?,
             status = 'completed'
         WHERE id = ? AND user_id = ? AND status = 'active'`,
        [durationSeconds, Math.floor(finalScore), Math.floor(totalBlinks), rawSessionId, req.user.id]
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return res.status(409).json({ message: 'Unable to finish session' });
      }

      if (samples.length > 0) {
        const bulkRows = samples.map((sample) => [
          rawSessionId,
          sample.secondIndex,
          Number(sample.paddlePosition.toFixed(4)),
          Number(sample.paddleDelta.toFixed(4)),
          Number(sample.paddleSpeedPerSecond.toFixed(4)),
          sample.blinkDetected ? 1 : 0,
          sample.eyeOffsetX === undefined || sample.eyeOffsetX === null ? null : sample.eyeOffsetX,
          sample.eyeOffsetY === undefined || sample.eyeOffsetY === null ? null : sample.eyeOffsetY,
          sample.eyeConfidence === undefined || sample.eyeConfidence === null ? null : sample.eyeConfidence,
          Number(sample.eyeMovementPerSecond.toFixed(4)),
        ]);

        await connection.query(
          `INSERT INTO game_session_samples
            (
              session_id,
              second_index,
              paddle_position,
              paddle_delta,
              paddle_speed_per_second,
              blink_detected,
              eye_offset_x,
              eye_offset_y,
              eye_confidence,
              eye_movement_per_second
            )
           VALUES ?`,
          [bulkRows]
        );
      }

      if (normalizedEyeFrames.length > 0) {
        await connection.query(
          `INSERT INTO game_session_eye_frames
            (session_id, offset_ms, eye_offset_x, eye_offset_y, eye_confidence, blink_detected)
           VALUES ?`,
          [normalizedEyeFrames]
        );
      }

      await connection.commit();
      return res.status(201).json({
        message: 'Session telemetry saved',
        durationSeconds,
        sampleCount: samples.length,
        eyeFrameCount: normalizedEyeFrames.length,
        totalBlinks: Math.floor(totalBlinks),
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }
      throw error;
    } finally {
      if (connection) {
        connection.release();
      }
    }
  } catch (error) {
    return res.status(500).json({ message: 'Failed to finalize session telemetry', error: error.message });
  }
});

module.exports = router;
