-- ============================================================
-- 心镜社交独立站数据库 Schema（完整版）
-- 项目: Hatefishjustin/social
-- 更新: 2026-07-31 - D1线上全量对齐 + 补缺失表 + tarot_readings
-- ============================================================

-- ── 用户体系 ──

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_tokens (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    pending_result_json TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ip_trust (
    ip TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (ip, user_id)
);

-- ── 个人资料 ──

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

CREATE TABLE IF NOT EXISTS avatars (
    user_id INTEGER PRIMARY KEY,
    image_data TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── 个人主页访问记录 ──

CREATE TABLE IF NOT EXISTS profile_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id INTEGER,
    target_user_id INTEGER NOT NULL,
    visited_at INTEGER
);

-- ── 测评 + 匹配 + 聊天 ──

CREATE TABLE IF NOT EXISTS quiz_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    headline TEXT NOT NULL,
    scores_json TEXT NOT NULL,
    answers_json TEXT,
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
    is_system INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id)
);

-- ── 表白墙 (wall) ──

CREATE TABLE IF NOT EXISTS wall_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    content TEXT NOT NULL,
    tag TEXT,
    is_anonymous INTEGER DEFAULT 0,
    school TEXT,
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    is_featured INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wall_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER,
    content TEXT NOT NULL,
    is_anonymous INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (post_id) REFERENCES wall_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wall_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(post_id, user_id)
);

-- ── 提问箱 (askbox) ──

CREATE TABLE IF NOT EXISTS askbox_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asker_id INTEGER,
    target_id INTEGER,
    content TEXT NOT NULL,
    is_anonymous INTEGER DEFAULT 1,
    answer_content TEXT,
    answered_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (asker_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── 通知 ──

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    actor_id INTEGER,
    actor_email TEXT,
    content_preview TEXT,
    is_read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ── 反馈 ──

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_email TEXT,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    admin_note TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ── 举报 / 违规 ──

CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    reported_id INTEGER,
    match_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','dismissed')),
    admin_note TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    FOREIGN KEY (reporter_id) REFERENCES users(id),
    FOREIGN KEY (match_id) REFERENCES matches(id)
);

-- 迁移: 为已有 reports 表添加 reported_id 字段
-- ALTER TABLE reports ADD COLUMN reported_id INTEGER;
-- 线上 D1 执行: wrangler d1 execute soulmirror-db --command "ALTER TABLE reports ADD COLUMN reported_id INTEGER;"
-- 或通过 Cloudflare Dashboard / API 执行

CREATE TABLE IF NOT EXISTS content_violations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    report_id INTEGER,
    action TEXT NOT NULL,
    admin_id INTEGER,
    admin_note TEXT,
    -- 敏感词自动关闭（functions/chat/send.js）使用的字段
    match_id INTEGER,
    sender_id INTEGER,
    content TEXT,
    violation_type TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (report_id) REFERENCES reports(id),
    FOREIGN KEY (admin_id) REFERENCES users(id)
);

-- 迁移: 为 content_violations 表补充敏感词自动关闭所需字段（S-01）
-- 新增: match_id, sender_id, content, violation_type
-- 线上 D1 执行: wrangler d1 execute <DB_NAME> --file docs/migrations/2026-08-01-S01-content-violations.sql
-- 或通过 Cloudflare Dashboard / API 执行

-- ── 我想认识TA (contact_request) ──

CREATE TABLE IF NOT EXISTS contact_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (post_id) REFERENCES wall_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── 管理员 / 客服 ──

CREATE TABLE IF NOT EXISTS staff_accounts (
    user_id INTEGER PRIMARY KEY,
    role TEXT DEFAULT 'support' CHECK(role IN ('support','admin')),
    max_concurrent INTEGER DEFAULT 10,
    is_online INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ── 今日之问 ──

CREATE TABLE IF NOT EXISTS daily_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    question TEXT NOT NULL,
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    option_c TEXT NOT NULL,
    option_d TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    option_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(question_id, user_id),
    FOREIGN KEY (question_id) REFERENCES daily_questions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── 活动日志（写入/只追不删） ──

CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_email TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    content TEXT,
    ip TEXT,
    user_agent TEXT,
    country TEXT,
    city TEXT,
    is_anonymous INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- ── 页面访问统计 ──

CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page TEXT NOT NULL,
    user_id INTEGER,
    is_logged_in INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ── 跨设备登录码 ──

CREATE TABLE IF NOT EXISTS device_codes (
    code TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── 索引 ──

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens(email);
CREATE INDEX IF NOT EXISTS idx_login_tokens_expires ON login_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_ip_trust_expires ON ip_trust(expires_at);
CREATE INDEX IF NOT EXISTS idx_quiz_user ON quiz_results(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_user_a ON matches(user_a, status);
CREATE INDEX IF NOT EXISTS idx_matches_user_b ON matches(user_b, status);
CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id, created_at);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON profiles(is_active, age_group);
CREATE INDEX IF NOT EXISTS idx_wall_posts_created ON wall_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wall_posts_user ON wall_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_wall_likes_post ON wall_likes(post_id, user_id);
CREATE INDEX IF NOT EXISTS idx_wall_comments_post ON wall_comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_askbox_target ON askbox_questions(target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_violations_user ON content_violations(user_id);
CREATE INDEX IF NOT EXISTS idx_content_violations_match ON content_violations(match_id);
CREATE INDEX IF NOT EXISTS idx_contact_requests_post ON contact_requests(post_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_views_page ON page_views(page, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_codes_expires ON device_codes(expires_at);

-- 塔罗牌抽卡记录：保存每次抽牌的牌阵、AI解读结果，供历史记录查看
CREATE TABLE IF NOT EXISTS tarot_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    spread_type TEXT NOT NULL,        -- 'single' 或 'three'（过去-现在-未来）
    question TEXT,                    -- 用户抽牌前填写的问题/困惑，可为空
    cards_json TEXT NOT NULL,         -- 抽到的牌：[{id,name,reversed,position}]
    headline TEXT,                    -- AI解读一句话总结
    analysis_json TEXT,               -- AI解读完整结构化结果
    linked_quiz_id INTEGER,           -- 若解读时结合了心理测评结果，关联 quiz_results.id
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_quiz_id) REFERENCES quiz_results(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tarot_user ON tarot_readings(user_id, created_at DESC);
