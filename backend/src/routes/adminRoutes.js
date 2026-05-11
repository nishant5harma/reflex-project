const express = require('express');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const {
  listCompletedSessionsForUser,
  getSessionTelemetryBundle,
} = require('../services/sessionTelemetry');
const { buildSessionExcelBuffer } = require('../services/sessionExcelExport');

const router = express.Router();

router.get('/stats', verifyToken, requireRole('admin'), async (_req, res) => {
  try {
    const [[counts]] = await db.query(
      `SELECT
         COUNT(*) AS totalUsers,
         SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS activeUsers
       FROM users
       WHERE role = 'user'`
    );

    return res.json({
      totalUsers: Number(counts.totalUsers || 0),
      activeUsers: Number(counts.activeUsers || 0),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch admin stats', error: error.message });
  }
});

router.get('/users', verifyToken, requireRole('admin'), async (_req, res) => {
  try {
    const [users] = await db.query(
      `SELECT id, full_name, email, role, is_active, created_at
       FROM users
       WHERE role = 'user'
       ORDER BY created_at DESC`
    );

    return res.json(
      users.map((user) => ({
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        isActive: Boolean(user.is_active),
        createdAt: user.created_at,
      }))
    );
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch users', error: error.message });
  }
});

router.get('/users/:userId/scores', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const [scores] = await db.query(
      `SELECT gs.id, gs.score, gs.created_at, u.full_name, u.email
       FROM game_scores gs
       INNER JOIN users u ON u.id = gs.user_id
       WHERE gs.user_id = ?
       ORDER BY gs.created_at DESC`,
      [userId]
    );

    return res.json(
      scores.map((entry) => ({
        id: entry.id,
        score: entry.score,
        createdAt: entry.created_at,
        fullName: entry.full_name,
        email: entry.email,
      }))
    );
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch user scores', error: error.message });
  }
});

router.delete('/users/:userId/scores/:scoreId', verifyToken, requireRole('admin'), async (req, res) => {
  let connection;
  try {
    const userId = Number(req.params.userId);
    const scoreId = Number(req.params.scoreId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    if (!Number.isInteger(scoreId) || scoreId <= 0) {
      return res.status(400).json({ message: 'Invalid score id' });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [[scoreRow]] = await connection.query(
      `SELECT id, user_id, score
       FROM game_scores
       WHERE id = ? AND user_id = ?`,
      [scoreId, userId]
    );
    if (!scoreRow) {
      await connection.rollback();
      return res.status(404).json({ message: 'Score not found' });
    }

    const [sessionRows] = await connection.query(
      `SELECT id FROM game_sessions WHERE user_id = ? AND final_score = ?`,
      [userId, scoreRow.score]
    );

    const [deleteScore] = await connection.query(
      `DELETE FROM game_scores WHERE id = ?`,
      [scoreId]
    );
    if (deleteScore.affectedRows === 0) {
      await connection.rollback();
      return res.status(409).json({ message: 'Unable to delete score' });
    }

    const sessionIds = sessionRows.map((row) => row.id);
    if (sessionIds.length > 0) {
      await connection.query(`DELETE FROM game_sessions WHERE id IN (?)`, [sessionIds]);
    }

    await connection.commit();
    return res.json({
      message: 'Score deleted, related sessions removed',
      deletedScoreId: scoreId,
      relatedSessionCount: sessionIds.length,
      relatedSessionIds: sessionIds,
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return res.status(500).json({ message: 'Failed to delete score', error: error.message });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

router.get('/users/:userId/game-sessions', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const rows = await listCompletedSessionsForUser(userId, { includeUserColumns: false });
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch user game sessions', error: error.message });
  }
});

router.get('/game-sessions/:sessionId', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ message: 'Invalid session id' });
    }

    const bundle = await getSessionTelemetryBundle(sessionId, null, { includeUser: true });
    if (!bundle) {
      return res.status(404).json({ message: 'Session not found' });
    }

    return res.json(bundle);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load session telemetry', error: error.message });
  }
});

router.get('/game-sessions/:sessionId/export', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ message: 'Invalid session id' });
    }

    const buffer = await buildSessionExcelBuffer(sessionId);
    if (!buffer) {
      return res.status(404).json({ message: 'Session not found' });
    }

    const safeName = `session_${sessionId}_telemetry_export.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', String(buffer.length));

    return res.send(buffer);
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to build Excel export',
      error: error.message,
    });
  }
});

router.delete('/game-sessions/:sessionId', verifyToken, requireRole('admin'), async (req, res) => {
  let connection;
  try {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ message: 'Invalid session id' });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [[session]] = await connection.query(
      `SELECT gs.id, gs.user_id, gs.status, u.full_name, u.email
       FROM game_sessions gs
       INNER JOIN users u ON u.id = gs.user_id
       WHERE gs.id = ?`,
      [sessionId]
    );

    if (!session) {
      await connection.rollback();
      return res.status(404).json({ message: 'Session not found' });
    }

    const [[sampleCountRow]] = await connection.query(
      `SELECT COUNT(*) AS total FROM game_session_samples WHERE session_id = ?`,
      [sessionId]
    );
    const [[eyeFrameCountRow]] = await connection.query(
      `SELECT COUNT(*) AS total FROM game_session_eye_frames WHERE session_id = ?`,
      [sessionId]
    );

    const [deleteResult] = await connection.query(
      `DELETE FROM game_sessions WHERE id = ?`,
      [sessionId]
    );

    if (deleteResult.affectedRows === 0) {
      await connection.rollback();
      return res.status(409).json({ message: 'Unable to delete session' });
    }

    await connection.commit();
    return res.json({
      message: 'Session deleted successfully',
      deletedSessionId: sessionId,
      userId: session.user_id,
      userName: session.full_name,
      userEmail: session.email,
      deletedChildren: {
        samples: Number(sampleCountRow?.total || 0),
        eyeFrames: Number(eyeFrameCountRow?.total || 0),
      },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return res.status(500).json({ message: 'Failed to delete session', error: error.message });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

module.exports = router;
