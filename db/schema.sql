-- ============================================================
-- 心镜社交独立站数据库 Schema
-- 包含：用户体系 + 测评记录 + 社交匹配 + 聊天 + 客服 + 审计
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_tokens (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    headline TEXT NOT NULL,
    scores_json TEXT NOT NULL,
    answers_json TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY,
    nickname TEXT NOT NULL,
    gender TEXT CHECK(gender IN ('男','女','保密')),
    age_group TEXT CHECK(age_group IN ('中学生','大学生')),
    bio TEXT,
    avatar_seed TEXT,
    scores_json TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a INTEGER NOT NULL,
    user_b INTEGER NOT NULL,
    match_score REAL NOT NULL,
    match_reason TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','closed')),
    is_shadow INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    FOREIGN KEY (user_a) REFERENCES users(id),
    FOREIGN KEY (user_b) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS staff_accounts (
    user_id INTEGER PRIMARY KEY,
    role TEXT DEFAULT 'support' CHECK(role IN ('support','admin')),
    max_concurrent INTEGER DEFAULT 10,
    is_online INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','dismissed')),
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    FOREIGN KEY (reporter_id) REFERENCES users(id),
    FOREIGN KEY (match_id) REFERENCES matches(id)
);

CREATE TABLE IF NOT EXISTS content_violations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    violation_type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_user ON quiz_results(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_user_a ON matches(user_a, status);
CREATE INDEX IF NOT EXISTS idx_matches_user_b ON matches(user_b, status);
CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id, created_at);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON profiles(is_active, age_group);
