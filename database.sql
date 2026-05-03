CREATE DATABASE IF NOT EXISTS reflex_project;
USE reflex_project;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Replace the password hash value with a bcrypt hash that you generate.
INSERT INTO users (full_name, email, password_hash, role, is_active)
VALUES ('Main Admin', 'admin@reflex.com', '$2a$10$replace_with_real_bcrypt_hash', 'admin', 1);

CREATE TABLE IF NOT EXISTS game_scores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  score INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  duration_seconds INT NOT NULL DEFAULT 0,
  final_score INT NOT NULL DEFAULT 0,
  total_blinks INT NOT NULL DEFAULT 0,
  status ENUM('active', 'completed') NOT NULL DEFAULT 'active',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_status (status)
);

CREATE TABLE IF NOT EXISTS game_session_samples (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  second_index INT NOT NULL,
  paddle_position DECIMAL(10, 4) NOT NULL,
  paddle_delta DECIMAL(10, 4) NOT NULL DEFAULT 0,
  paddle_speed_per_second DECIMAL(10, 4) NOT NULL DEFAULT 0,
  eye_offset_x DECIMAL(10, 6) NULL,
  eye_offset_y DECIMAL(10, 6) NULL,
  eye_confidence DECIMAL(6, 4) NULL,
  eye_movement_per_second DECIMAL(10, 6) NOT NULL DEFAULT 0,
  blink_detected TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_session_second (session_id, second_index),
  INDEX idx_samples_session (session_id)
);

-- Run once on existing DBs created before paddle_speed_per_second was added.
ALTER TABLE game_session_samples
  ADD COLUMN IF NOT EXISTS paddle_speed_per_second DECIMAL(10, 4) NOT NULL DEFAULT 0
  AFTER paddle_delta;

-- High-frequency eye/gaze samples during play (also mirrored in IndexedDB until session completes).
CREATE TABLE IF NOT EXISTS game_session_eye_frames (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  offset_ms INT UNSIGNED NOT NULL,
  eye_offset_x DECIMAL(10, 6) NULL,
  eye_offset_y DECIMAL(10, 6) NULL,
  eye_confidence DECIMAL(6, 4) NULL,
  blink_detected TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,
  INDEX idx_eye_session (session_id),
  INDEX idx_eye_session_offset (session_id, offset_ms)
);
