const db = require('../config/db');

const MAX_EYE_FRAMES_IN_RESPONSE = 5000;

function mapSessionSamples(rows) {
  return rows.map((row) => ({
    secondIndex: row.second_index,
    setNumber: Number(row.set_number || 1),
    setLabel: row.set_label || 'Dominant hand',
    controlMode: row.control_mode || 'pointer',
    paddlePosition: Number(row.paddle_position),
    paddleDelta: Number(row.paddle_delta),
    paddleSpeedPerSecond: Number(row.paddle_speed_per_second),
    eyeOffsetX: row.eye_offset_x !== null ? Number(row.eye_offset_x) : null,
    eyeOffsetY: row.eye_offset_y !== null ? Number(row.eye_offset_y) : null,
    eyeConfidence: row.eye_confidence !== null ? Number(row.eye_confidence) : null,
    eyeMovementPerSecond: Number(row.eye_movement_per_second),
    blinkDetected: Boolean(row.blink_detected),
  }));
}

function mapEyeFrameRows(rows) {
  return rows.map((row) => ({
    offsetMs: row.offset_ms,
    setNumber: Number(row.set_number || 1),
    setLabel: row.set_label || 'Dominant hand',
    controlMode: row.control_mode || 'pointer',
    eyeOffsetX: row.eye_offset_x !== null ? Number(row.eye_offset_x) : null,
    eyeOffsetY: row.eye_offset_y !== null ? Number(row.eye_offset_y) : null,
    eyeConfidence: row.eye_confidence !== null ? Number(row.eye_confidence) : null,
    blinkDetected: Boolean(row.blink_detected),
  }));
}

async function loadEyeFramesForSession(sessionId, totalCount) {
  if (totalCount <= 0) {
    return { eyeFrames: [], truncated: false, totalCount: 0 };
  }

  if (totalCount <= MAX_EYE_FRAMES_IN_RESPONSE) {
    const [frames] = await db.query(
      `SELECT offset_ms, set_number, set_label, control_mode, eye_offset_x, eye_offset_y, eye_confidence, blink_detected
       FROM game_session_eye_frames
       WHERE session_id = ?
       ORDER BY offset_ms ASC`,
      [sessionId]
    );
    return {
      eyeFrames: mapEyeFrameRows(frames),
      truncated: false,
      totalCount,
    };
  }

  const step = Math.ceil(totalCount / MAX_EYE_FRAMES_IN_RESPONSE);
  const [frames] = await db.query(
    `SELECT offset_ms, set_number, set_label, control_mode, eye_offset_x, eye_offset_y, eye_confidence, blink_detected
     FROM (
       SELECT offset_ms,
              set_number,
              set_label,
              control_mode,
              eye_offset_x,
              eye_offset_y,
              eye_confidence,
              blink_detected,
              ROW_NUMBER() OVER (ORDER BY offset_ms ASC) AS rn
       FROM game_session_eye_frames
       WHERE session_id = ?
     ) ranked
     WHERE (rn - 1) % ? = 0
     ORDER BY offset_ms ASC`,
    [sessionId, step]
  );

  return {
    eyeFrames: mapEyeFrameRows(frames),
    truncated: true,
    totalCount,
  };
}

function mapSessionListRow(entry) {
  return {
    id: entry.id,
    startedAt: entry.started_at,
    endedAt: entry.ended_at,
    sessionType: entry.session_type,
    durationSeconds: entry.duration_seconds,
    finalScore: entry.final_score,
    totalBlinks: entry.total_blinks,
    sampleCount: Number(entry.sample_count || 0),
    status: entry.status,
    fullName: entry.full_name ?? null,
    email: entry.email ?? null,
  };
}

async function listCompletedSessionsForUser(userId, { includeUserColumns = false } = {}) {
  const userCols = includeUserColumns ? `u.full_name, u.email,` : '';
  const joinUsers = includeUserColumns ? `INNER JOIN users u ON u.id = gs.user_id` : '';

  const [rows] = await db.query(
    `SELECT gs.id,
            gs.started_at,
            gs.ended_at,
            gs.session_type,
            gs.duration_seconds,
            gs.final_score,
            gs.total_blinks,
            gs.status,
            ${userCols}
            (SELECT COUNT(*) FROM game_session_samples s WHERE s.session_id = gs.id) AS sample_count
     FROM game_sessions gs
     ${joinUsers}
     WHERE gs.user_id = ?
       AND gs.status = 'completed'
     ORDER BY gs.ended_at DESC`,
    [userId]
  );

  return rows.map(mapSessionListRow);
}

/**
 * @param {number} sessionId
 * @param {number | null} userIdConstraint - if set, session must belong to this user
 * @param {{ includeUser?: boolean }} options
 */
async function getSessionTelemetryBundle(sessionId, userIdConstraint, options = {}) {
  let query = `SELECT id,
         user_id,
         started_at,
         ended_at,
         session_type,
         duration_seconds,
         final_score,
         total_blinks,
         status
       FROM game_sessions
       WHERE id = ?`;
  const params = [sessionId];
  if (userIdConstraint != null) {
    query += ' AND user_id = ?';
    params.push(userIdConstraint);
  }

  const [[session]] = await db.query(query, params);
  if (!session) {
    return null;
  }

  const [samples] = await db.query(
    `SELECT second_index,
            set_number,
            set_label,
            control_mode,
            paddle_position,
            paddle_delta,
            paddle_speed_per_second,
            eye_offset_x,
            eye_offset_y,
            eye_confidence,
            eye_movement_per_second,
            blink_detected
     FROM game_session_samples
     WHERE session_id = ?
     ORDER BY second_index ASC`,
    [sessionId]
  );

  const [[countEye]] = await db.query(
    `SELECT COUNT(*) AS c FROM game_session_eye_frames WHERE session_id = ?`,
    [sessionId]
  );

  const eyeBundle = await loadEyeFramesForSession(sessionId, Number(countEye?.c || 0));

  const sessionPayload = {
    id: session.id,
    userId: session.user_id,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    sessionType: session.session_type,
    durationSeconds: session.duration_seconds,
    finalScore: session.final_score,
    totalBlinks: session.total_blinks,
    status: session.status,
  };

  if (options.includeUser) {
    const [[u]] = await db.query(`SELECT full_name, email FROM users WHERE id = ?`, [session.user_id]);
    sessionPayload.fullName = u?.full_name ?? null;
    sessionPayload.email = u?.email ?? null;
  }

  return {
    session: sessionPayload,
    samples: mapSessionSamples(samples),
    eyeFrames: eyeBundle.eyeFrames,
    eyeFramesMeta: {
      totalCount: eyeBundle.totalCount,
      returnedCount: eyeBundle.eyeFrames.length,
      downsampled: eyeBundle.truncated,
    },
  };
}

module.exports = {
  getSessionTelemetryBundle,
  listCompletedSessionsForUser,
  MAX_EYE_FRAMES_IN_RESPONSE,
};
