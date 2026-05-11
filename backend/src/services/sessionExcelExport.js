const ExcelJS = require('exceljs');
const db = require('../config/db');

const GAME_CANVAS_WIDTH_PX = 820;
const GAME_CANVAS_HEIGHT_PX = 520;
const PADDLE_WIDTH_PX = 130;
/** Pixels: if |paddle_delta| exceeds this in a 1s window, we count one "slider move" for that second. */
const PADDLE_MOVE_EPSILON_PX = 0.5;

async function fetchSessionExportData(sessionId) {
  const [[session]] = await db.query(
    `SELECT gs.id,
            gs.user_id,
            gs.started_at,
            gs.ended_at,
            gs.duration_seconds,
            gs.final_score,
            gs.total_blinks,
            gs.status,
            u.full_name AS user_full_name,
            u.email AS user_email
     FROM game_sessions gs
     INNER JOIN users u ON u.id = gs.user_id
     WHERE gs.id = ?`,
    [sessionId]
  );

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

  const [eyeFrames] = await db.query(
    `SELECT id,
            offset_ms,
            set_number,
            set_label,
            control_mode,
            eye_offset_x,
            eye_offset_y,
            eye_confidence,
            blink_detected
     FROM game_session_eye_frames
     WHERE session_id = ?
     ORDER BY offset_ms ASC, id ASC`,
    [sessionId]
  );

  return { session, samples, eyeFrames };
}

function formatMmSs(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function minuteBucketFromSecond(secondIndex) {
  const s = Number(secondIndex) || 0;
  return Math.floor((Math.max(s, 1) - 1) / 60) + 1;
}

/** Second bucket 1 = [0ms, 1000ms), aligned with telemetry second_index. */
function gameplaySecondFromOffsetMs(offsetMs) {
  return Math.floor(Number(offsetMs) / 1000) + 1;
}

function minuteBucketFromOffsetMs(offsetMs) {
  return Math.floor(Number(offsetMs) / 60000) + 1;
}

function blinkEdgeCount(framesSorted) {
  let count = 0;
  let wasClosed = false;
  for (let i = 0; i < framesSorted.length; i += 1) {
    const closed = Boolean(framesSorted[i].blink_detected);
    if (closed && !wasClosed) count += 1;
    wasClosed = closed;
  }
  return count;
}

function pathLengthNormalized(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (
      a.x == null ||
      b.x == null ||
      a.y == null ||
      b.y == null ||
      !Number.isFinite(a.x) ||
      !Number.isFinite(b.x) ||
      !Number.isFinite(a.y) ||
      !Number.isFinite(b.y)
    ) {
      continue;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    sum += Math.sqrt(dx * dx + dy * dy);
  }
  return sum;
}

function groupFramesByGameplaySecond(frames) {
  const map = new Map();
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    const gi = gameplaySecondFromOffsetMs(f.offset_ms);
    if (!map.has(gi)) map.set(gi, []);
    map.get(gi).push(f);
  }
  return map;
}

function groupFramesByMinute(frames) {
  const map = new Map();
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    const mi = minuteBucketFromOffsetMs(f.offset_ms);
    if (!map.has(mi)) map.set(mi, []);
    map.get(mi).push(f);
  }
  return map;
}

function sheetStyleHeaderRow(sheet, rowNumber = 1) {
  const row = sheet.getRow(rowNumber);
  row.font = { bold: true, color: { argb: 'FF0F172A' } };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  };
}

function addUnitsSheet(workbook) {
  const sheet = workbook.addWorksheet('00_Units_guide', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'Topic', key: 'topic', width: 30 },
    { header: 'Explanation', key: 'explanation', width: 88 },
  ];

  const lines = [
    [
      'Time columns',
      'gameplay_elapsed_seconds = same as second_index (1 = first full second after Start). gameplay_elapsed_minutes = seconds ÷ 60. mm_ss = mm:ss wall-style label for that moment.',
    ],
    [
      'minute_number',
      'Groups seconds 1–60 → minute 1, 61–120 → minute 2, etc. Used for per-minute summary tables.',
    ],
    [
      'Slider / paddle speed',
      'paddle_speed_px_per_s = |paddle_delta| over that 1-second sample (pixels per second). Per-minute averages are mean of those values across seconds in that minute.',
    ],
    [
      `slider_move_0_or_1 (per second)`,
      `1 if |paddle_delta| > ${PADDLE_MOVE_EPSILON_PX}px in that second (slider noticeably moved); else 0. “Kitni bar” per minute = SUM of these flags.`,
    ],
    [
      'cumulative_slider_distance_px',
      'Running sum of |paddle_delta| — total paddle travel in pixels from session start through that second.',
    ],
    [
      'Eye movement (1 Hz row)',
      'eye_movement_normalized_per_s (eyeball movement amount) = distance between consecutive per-second gaze points in normalized XY (unitless), not inches.',
    ],
    [
      'Eye path (high-rate row)',
      'eye_path_norm_from_high_rate_frames (fine eyeball path) = Sum of √(Δx²+Δy²) between consecutive frames inside that second.',
    ],
    [
      'Blinks (1 Hz)',
      'blink_detected (blink happened): 1 if any blink counted in that gameplay second; cumulative_blinks running sum.',
    ],
    [
      'Blinks (high-rate, per minute)',
      'blink_events_edges: count of closed-eye “starts” (0→1) in eye frames within that wall-clock minute of the session timer.',
    ],
    ['Inches / cm', 'Not stored. Gaze is normalized; paddle is pixels.'],
    [
      'Sheets',
      '01_Session_overview | 02_Set_summary | 02_Per_SECOND_full | 03_Per_MINUTE_summary | 04_Eye_per_SECOND_HR | 05_Eye_frames_raw',
    ],
    [
      'Why data can be less',
      'If a set ends early due to OUT / game over, that set will have fewer sample_seconds than expected_seconds. See 02_Set_summary.',
    ],
  ];

  sheet.addRows(lines.map(([topic, explanation]) => ({ topic, explanation })));
  sheetStyleHeaderRow(sheet);
}

function addSessionOverviewSheet(workbook, session, samples, eyeFrames, aggregates) {
  const sheet = workbook.addWorksheet('01_Session_overview', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'Field', key: 'field', width: 38 },
    { header: 'Value', key: 'value', width: 52 },
  ];

  const dSec = Number(session.duration_seconds) || 0;
  const dMinDec = dSec / 60;
  const wholeMin = Math.floor(dSec / 60);
  const remSec = dSec % 60;

  const rows = [
    { field: 'session_id', value: session.id },
    { field: 'user_id', value: session.user_id },
    { field: 'player_name', value: session.user_full_name ?? '' },
    { field: 'player_email', value: session.user_email ?? '' },
    { field: 'status', value: session.status },
    { field: 'started_at_UTC (DB)', value: session.started_at ? String(session.started_at) : '' },
    { field: 'ended_at_UTC (DB)', value: session.ended_at ? String(session.ended_at) : '' },
    {
      field: 'gameplay_duration_seconds (from session row)',
      value: dSec,
    },
    {
      field: 'gameplay_duration_minutes (decimal, seconds ÷ 60)',
      value: Number(dMinDec.toFixed(4)),
    },
    {
      field: 'gameplay_duration_readable',
      value: `${wholeMin} min ${remSec} sec (${dSec}s total)`,
    },
    { field: 'final_score_points', value: session.final_score },
    { field: 'total_blinks_stored_on_session (counter during game)', value: session.total_blinks },
    {
      field: 'blinks_sum_of_1Hz_sample_flags (sanity check)',
      value: aggregates.blinkSecondsSum,
    },
    { field: 'slider_move_seconds_count_total', value: aggregates.totalSliderMoveSeconds },
    {
      field: 'slider_total_distance_px (sum abs delta)',
      value: Number(aggregates.totalPaddleDistancePx.toFixed(4)),
    },
    { field: 'per_second_rows_exported', value: samples.length },
    { field: 'eye_frame_rows_exported', value: eyeFrames.length },
    { field: 'canvas_width_px', value: GAME_CANVAS_WIDTH_PX },
    { field: 'canvas_height_px', value: GAME_CANVAS_HEIGHT_PX },
  ];

  sheet.addRows(rows);
  sheetStyleHeaderRow(sheet);
}

function addSetSummarySheet(workbook, samples, eyeFrames) {
  const expectedSecondsBySet = { 1: 30, 2: 30, 3: 60 };
  const sheet = workbook.addWorksheet('02_Set_summary', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'set_number (set no)', key: 'set_number', width: 16 },
    { header: 'set_label (instruction group)', key: 'set_label', width: 30 },
    { header: 'control_mode (input type)', key: 'control_mode', width: 20 },
    { header: 'expected_seconds (s)', key: 'expected_seconds', width: 20 },
    { header: 'sample_seconds (s)', key: 'sample_seconds', width: 20 },
    { header: 'second_index_range', key: 'second_range', width: 18 },
    { header: 'eye_frame_count', key: 'eye_frame_count', width: 16 },
    { header: 'blink_seconds', key: 'blink_seconds', width: 14 },
    { header: 'total_paddle_distance_px', key: 'distance', width: 22 },
    { header: 'avg_paddle_speed_px_per_s', key: 'avg_speed', width: 22 },
  ];

  const sets = new Map();
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    const setNo = Number(s.set_number || 1);
    if (!sets.has(setNo)) {
      sets.set(setNo, {
        setLabel: s.set_label || '',
        controlMode: s.control_mode || 'pointer',
        sampleSeconds: 0,
        minSecond: null,
        maxSecond: null,
        blinkSeconds: 0,
        distance: 0,
        speedSum: 0,
      });
    }
    const row = sets.get(setNo);
    row.sampleSeconds += 1;
    const secondIndex = Number(s.second_index || 0);
    if (Number.isFinite(secondIndex) && secondIndex > 0) {
      row.minSecond = row.minSecond == null ? secondIndex : Math.min(row.minSecond, secondIndex);
      row.maxSecond = row.maxSecond == null ? secondIndex : Math.max(row.maxSecond, secondIndex);
    }
    if (s.blink_detected) row.blinkSeconds += 1;
    row.distance += Math.abs(Number(s.paddle_delta) || 0);
    row.speedSum += Number(s.paddle_speed_per_second) || 0;
  }

  for (let i = 0; i < eyeFrames.length; i += 1) {
    const f = eyeFrames[i];
    const setNo = Number(f.set_number || 1);
    if (!sets.has(setNo)) {
      sets.set(setNo, {
        setLabel: f.set_label || '',
        controlMode: f.control_mode || 'pointer',
        sampleSeconds: 0,
        eyeFrameCount: 0,
        blinkSeconds: 0,
        distance: 0,
        speedSum: 0,
      });
    }
    const row = sets.get(setNo);
    row.eyeFrameCount = (row.eyeFrameCount || 0) + 1;
  }

  const ordered = Array.from(sets.keys()).sort((a, b) => a - b);
  for (let i = 0; i < ordered.length; i += 1) {
    const key = ordered[i];
    const row = sets.get(key);
    const avgSpeed = row.sampleSeconds ? row.speedSum / row.sampleSeconds : 0;
    sheet.addRow({
      set_number: key,
      set_label: row.setLabel,
      control_mode: row.controlMode,
      expected_seconds: expectedSecondsBySet[key] || 0,
      sample_seconds: row.sampleSeconds,
      second_range:
        row.minSecond != null && row.maxSecond != null ? `${row.minSecond}-${row.maxSecond}` : '',
      eye_frame_count: row.eyeFrameCount || 0,
      blink_seconds: row.blinkSeconds,
      distance: Number(row.distance.toFixed(4)),
      avg_speed: Number(avgSpeed.toFixed(4)),
    });
  }

  sheetStyleHeaderRow(sheet);
}

function addPerSecondFullSheet(workbook, samples, framesBySecond) {
  const sheet = workbook.addWorksheet('02_Per_SECOND_full', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'second_index (timeline second)', key: 'second_index', width: 22 },
    { header: 'set_number (set no)', key: 'set_number', width: 16 },
    { header: 'set_label (instruction group)', key: 'set_label', width: 30 },
    { header: 'control_mode (input type)', key: 'control_mode', width: 20 },
    { header: 'time_mm_ss_label (mm:ss)', key: 'time_mm_ss', width: 18 },
    { header: 'gameplay_elapsed_minutes_decimal', key: 'elapsed_min', width: 22 },
    { header: 'minute_number', key: 'minute_number', width: 12 },
    { header: 'paddle_position_px (slider position)', key: 'paddle_position_px', width: 28 },
    { header: 'paddle_delta_px_in_this_second (slider left-right change)', key: 'paddle_delta_px', width: 38 },
    { header: 'paddle_speed_px_per_second (slider speed)', key: 'paddle_speed', width: 32 },
    {
      header: `slider_move_0_or_1_eps_${PADDLE_MOVE_EPSILON_PX}px`,
      key: 'slider_move',
      width: 22,
    },
    { header: 'cumulative_slider_move_seconds (s)', key: 'cum_move_sec', width: 30 },
    {
      header: 'cumulative_slider_distance_px',
      key: 'cum_dist_px',
      width: 22,
    },
    { header: 'eye_offset_x_unitless (eyeball left-right)', key: 'eye_x', width: 34 },
    { header: 'eye_offset_y_unitless (eyeball up-down)', key: 'eye_y', width: 32 },
    { header: 'eye_confidence_0_to_1 (tracking reliability)', key: 'eye_conf', width: 36 },
    {
      header: 'eye_movement_norm_per_s_1Hz (normalized/s)',
      key: 'eye_mov_1hz',
      width: 22,
    },
    { header: 'blink_this_second_0_or_1 (blink happened)', key: 'blink', width: 30 },
    { header: 'cumulative_blinks_1Hz (running blink count)', key: 'cum_blink', width: 34 },
    {
      header: 'eye_path_norm_from_high_rate_frames (normalized)',
      key: 'eye_path_hr',
      width: 28,
    },
    { header: 'high_rate_frames_in_this_second (rows)', key: 'hr_frame_n', width: 30 },
    { header: 'blink_edges_high_rate_in_second (count)', key: 'hr_blink_edge', width: 32 },
  ];

  let cumMoveSec = 0;
  let cumDist = 0;
  let cumBlink = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    const si = Number(s.second_index);
    const delta = s.paddle_delta != null ? Number(s.paddle_delta) : 0;
    const speed = s.paddle_speed_per_second != null ? Number(s.paddle_speed_per_second) : Math.abs(delta);
    const moved = Math.abs(delta) > PADDLE_MOVE_EPSILON_PX ? 1 : 0;
    cumMoveSec += moved;
    cumDist += Math.abs(delta);
    const blink = s.blink_detected ? 1 : 0;
    cumBlink += blink;

    const fr = framesBySecond.get(si) || [];
    const points = fr.map((f) => ({
      x: f.eye_offset_x != null ? Number(f.eye_offset_x) : null,
      y: f.eye_offset_y != null ? Number(f.eye_offset_y) : null,
    }));
    const eyePathHr = pathLengthNormalized(points);
    const hrEdges = blinkEdgeCount(fr);

    sheet.addRow({
      second_index: si,
      set_number: Number(s.set_number || 1),
      set_label: s.set_label || '',
      control_mode: s.control_mode || 'pointer',
      time_mm_ss: formatMmSs(si),
      elapsed_min: Number((si / 60).toFixed(6)),
      minute_number: minuteBucketFromSecond(si),
      paddle_position_px: s.paddle_position != null ? Number(s.paddle_position) : '',
      paddle_delta_px: s.paddle_delta != null ? Number(s.paddle_delta) : '',
      paddle_speed: Number.isFinite(speed) ? Number(speed.toFixed(6)) : '',
      slider_move: moved,
      cum_move_sec: cumMoveSec,
      cum_dist_px: Number(cumDist.toFixed(4)),
      eye_x: s.eye_offset_x != null ? Number(s.eye_offset_x) : '',
      eye_y: s.eye_offset_y != null ? Number(s.eye_offset_y) : '',
      eye_conf: s.eye_confidence != null ? Number(s.eye_confidence) : '',
      eye_mov_1hz:
        s.eye_movement_per_second != null ? Number(s.eye_movement_per_second) : '',
      blink,
      cum_blink: cumBlink,
      eye_path_hr: fr.length > 1 ? Number(eyePathHr.toFixed(6)) : 0,
      hr_frame_n: fr.length,
      hr_blink_edge: hrEdges,
    });
  }

  sheetStyleHeaderRow(sheet);
}

function addPerMinuteSummarySheet(workbook, samples, framesByMinute) {
  const sheet = workbook.addWorksheet('03_Per_MINUTE_summary', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'minute_number', key: 'minute_number', width: 12 },
    {
      header: 'second_index_range_inclusive',
      key: 'sec_range',
      width: 22,
    },
    { header: 'seconds_with_data_in_minute', key: 'n_sec', width: 22 },
    {
      header: 'avg_paddle_speed_px_per_s',
      key: 'avg_speed',
      width: 24,
    },
    {
      header: 'max_paddle_speed_px_per_s',
      key: 'max_speed',
      width: 24,
    },
    {
      header: 'total_paddle_distance_px_this_minute',
      key: 'dist_px',
      width: 30,
    },
    {
      header: 'slider_move_count_seconds_this_minute',
      key: 'move_sec_n',
      width: 32,
    },
    {
      header: 'avg_slider_speed_if_spread_over_full_minute_px_per_min',
      key: 'avg_speed_min',
      width: 36,
    },
    {
      header: 'total_distance_if_per_minute_rate_px_per_minute',
      key: 'dist_rate_min',
      width: 36,
    },
    {
      header: 'blinks_sum_1Hz_flags_this_minute',
      key: 'blinks_1hz',
      width: 28,
    },
    {
      header: 'avg_eye_movement_norm_per_s_this_minute',
      key: 'avg_eye_m',
      width: 32,
    },
    {
      header: 'sum_eye_movement_norm_this_minute',
      key: 'sum_eye_m',
      width: 28,
    },
    {
      header: 'blink_events_high_rate_edges_this_minute',
      key: 'blinks_hr',
      width: 34,
    },
    { header: 'high_rate_frames_this_minute', key: 'hr_n', width: 24 },
  ];

  const bundle = new Map();

  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    const si = Number(s.second_index);
    const m = minuteBucketFromSecond(si);
    if (!bundle.has(m)) {
      bundle.set(m, {
        seconds: [],
        speeds: [],
        deltas: [],
        moves: 0,
        blinks: 0,
        eyeM: [],
      });
    }
    const b = bundle.get(m);
    b.seconds.push(si);
    const delta = s.paddle_delta != null ? Number(s.paddle_delta) : 0;
    const speed = s.paddle_speed_per_second != null ? Number(s.paddle_speed_per_second) : Math.abs(delta);
    b.speeds.push(speed);
    b.deltas.push(Math.abs(delta));
    if (Math.abs(delta) > PADDLE_MOVE_EPSILON_PX) b.moves += 1;
    b.blinks += s.blink_detected ? 1 : 0;
    if (s.eye_movement_per_second != null) b.eyeM.push(Number(s.eye_movement_per_second));
  }

  const minuteIndices = Array.from(bundle.keys()).sort((a, b) => a - b);

  for (let i = 0; i < minuteIndices.length; i += 1) {
    const m = minuteIndices[i];
    const b = bundle.get(m);
    const smin = Math.min(...b.seconds);
    const smax = Math.max(...b.seconds);
    const n = b.seconds.length;
    const sumSpeed = b.speeds.reduce((a, c) => a + c, 0);
    const maxSpeed = Math.max(...b.speeds, 0);
    const dist = b.deltas.reduce((a, c) => a + c, 0);
    const avgSpeed = n ? sumSpeed / n : 0;
    const avgEye = b.eyeM.length ? b.eyeM.reduce((a, c) => a + c, 0) / b.eyeM.length : 0;
    const sumEye = b.eyeM.reduce((a, c) => a + c, 0);

    const frMin = framesByMinute.get(m) || [];
    const hrEdges = blinkEdgeCount(frMin);

    const avgSpeedPxPerMin = avgSpeed * 60;
    const distAsPerMinRate = dist * (60 / Math.max(n, 1));

    sheet.addRow({
      minute_number: m,
      sec_range: `${smin}–${smax}`,
      n_sec: n,
      avg_speed: Number(avgSpeed.toFixed(6)),
      max_speed: Number(maxSpeed.toFixed(6)),
      dist_px: Number(dist.toFixed(4)),
      move_sec_n: b.moves,
      avg_speed_min: Number(avgSpeedPxPerMin.toFixed(4)),
      dist_rate_min: Number(distAsPerMinRate.toFixed(4)),
      blinks_1hz: b.blinks,
      avg_eye_m: Number(avgEye.toFixed(6)),
      sum_eye_m: Number(sumEye.toFixed(6)),
      blinks_hr: hrEdges,
      hr_n: frMin.length,
    });
  }

  sheetStyleHeaderRow(sheet);
}

function addEyePerSecondFromFramesSheet(workbook, framesBySecond, maxSecondFromSamples) {
  const sheet = workbook.addWorksheet('04_Eye_per_SECOND_HR', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'gameplay_second_index', key: 'si', width: 18 },
    { header: 'time_mm_ss', key: 'mmss', width: 12 },
    { header: 'minute_number', key: 'mn', width: 12 },
    { header: 'frame_count', key: 'fc', width: 12 },
    {
      header: 'eye_path_length_norm_unitless',
      key: 'path',
      width: 26,
    },
    { header: 'blink_edge_events_in_second', key: 'bedge', width: 22 },
    {
      header: 'first_offset_ms_in_second',
      key: 'fms',
      width: 20,
    },
    { header: 'last_offset_ms_in_second', key: 'lms', width: 20 },
  ];

  const maxFrameSecond =
    framesBySecond.size > 0 ? Math.max(...framesBySecond.keys()) : 0;
  const maxLoop = Math.max(Number(maxSecondFromSamples) || 0, maxFrameSecond);

  for (let si = 1; si <= maxLoop; si += 1) {
    const fr = framesBySecond.get(si);
    if (!fr || fr.length === 0) continue;
    const points = fr.map((f) => ({
      x: f.eye_offset_x != null ? Number(f.eye_offset_x) : null,
      y: f.eye_offset_y != null ? Number(f.eye_offset_y) : null,
    }));
    sheet.addRow({
      si,
      mmss: formatMmSs(si),
      mn: minuteBucketFromSecond(si),
      fc: fr.length,
      path: Number(pathLengthNormalized(points).toFixed(6)),
      bedge: blinkEdgeCount(fr),
      fms: fr[0]?.offset_ms,
      lms: fr[fr.length - 1]?.offset_ms,
    });
  }

  sheetStyleHeaderRow(sheet);
}

function addEyeFramesRawSheet(workbook, frames) {
  const sheet = workbook.addWorksheet('05_Eye_frames_raw', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'row_id_db', key: 'row_id_db', width: 12 },
    { header: 'offset_ms (ms)', key: 'offset_ms', width: 18 },
    { header: 'set_number (set no)', key: 'set_number', width: 16 },
    { header: 'set_label (instruction group)', key: 'set_label', width: 30 },
    { header: 'control_mode (input type)', key: 'control_mode', width: 20 },
    { header: 'time_sec_decimal (s)', key: 'time_sec', width: 20 },
    { header: 'gameplay_second_bucket (s)', key: 'gsec', width: 24 },
    { header: 'minute_bucket (min)', key: 'gmin', width: 18 },
    { header: 'eye_offset_x_unitless (eyeball left-right)', key: 'ex', width: 34 },
    { header: 'eye_offset_y_unitless (eyeball up-down)', key: 'ey', width: 32 },
    { header: 'eye_confidence_0_to_1 (tracking reliability)', key: 'ec', width: 36 },
    { header: 'blink_detected_0_or_1 (blink happened)', key: 'bk', width: 32 },
    {
      header: 'norm_distance_from_previous_frame_row',
      key: 'step',
      width: 34,
    },
  ];

  let prevNorm = null;
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    const ms = Number(f.offset_ms);
    const ex = f.eye_offset_x != null ? Number(f.eye_offset_x) : null;
    const ey = f.eye_offset_y != null ? Number(f.eye_offset_y) : null;
    let stepCell = '';
    if (
      prevNorm &&
      ex != null &&
      ey != null &&
      Number.isFinite(ex) &&
      Number.isFinite(ey)
    ) {
      const dx = ex - prevNorm.x;
      const dy = ey - prevNorm.y;
      stepCell = Number(Math.sqrt(dx * dx + dy * dy).toFixed(8));
    }
    if (ex != null && ey != null && Number.isFinite(ex) && Number.isFinite(ey)) {
      prevNorm = { x: ex, y: ey };
    }

    sheet.addRow({
      row_id_db: f.id,
      offset_ms: ms,
      set_number: Number(f.set_number || 1),
      set_label: f.set_label || '',
      control_mode: f.control_mode || 'pointer',
      time_sec: Number.isFinite(ms) ? Number((ms / 1000).toFixed(6)) : '',
      gsec: Number.isFinite(ms) ? gameplaySecondFromOffsetMs(ms) : '',
      gmin: Number.isFinite(ms) ? minuteBucketFromOffsetMs(ms) : '',
      ex: ex ?? '',
      ey: ey ?? '',
      ec: f.eye_confidence != null ? Number(f.eye_confidence) : '',
      bk: f.blink_detected ? 1 : 0,
      step: stepCell,
    });
  }

  sheetStyleHeaderRow(sheet);
}

async function buildSessionExcelBuffer(sessionId) {
  const bundle = await fetchSessionExportData(sessionId);
  if (!bundle) {
    return null;
  }

  const { session, samples, eyeFrames } = bundle;
  const framesBySecond = groupFramesByGameplaySecond(eyeFrames);
  const framesByMinute = groupFramesByMinute(eyeFrames);

  let totalSliderMoveSeconds = 0;
  let totalPaddleDistancePx = 0;
  let blinkSecondsSum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    const delta = s.paddle_delta != null ? Number(s.paddle_delta) : 0;
    totalPaddleDistancePx += Math.abs(delta);
    if (Math.abs(delta) > PADDLE_MOVE_EPSILON_PX) totalSliderMoveSeconds += 1;
    if (s.blink_detected) blinkSecondsSum += 1;
  }

  const maxSecondFromSamples =
    samples.length > 0 ? Math.max(...samples.map((r) => Number(r.second_index))) : 0;

  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  workbook.creator = 'Reflex Project Admin Export';
  workbook.properties.date1904 = false;

  addUnitsSheet(workbook);
  addSessionOverviewSheet(workbook, session, samples, eyeFrames, {
    totalSliderMoveSeconds,
    totalPaddleDistancePx,
    blinkSecondsSum,
  });
  addSetSummarySheet(workbook, samples, eyeFrames);
  addPerSecondFullSheet(workbook, samples, framesBySecond);
  addPerMinuteSummarySheet(workbook, samples, framesByMinute);
  addEyePerSecondFromFramesSheet(workbook, framesBySecond, maxSecondFromSamples);
  addEyeFramesRawSheet(workbook, eyeFrames);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = {
  buildSessionExcelBuffer,
  fetchSessionExportData,
};
