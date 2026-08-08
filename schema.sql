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
    created_at INTEGER NOT NULL,
    ip TEXT DEFAULT '',               -- 注册时真实 IP（S-06 新增）
    country TEXT DEFAULT '',          -- 注册国家（S-06 新增）
    city TEXT DEFAULT '',             -- 注册城市（S-06 新增）
    user_agent TEXT DEFAULT '',       -- 注册浏览器 UA（S-06 新增）
    admin_note TEXT DEFAULT '',       -- 管理员自定义备注（S-07 新增，最大 200 字符）
    last_login_ip TEXT DEFAULT '',    -- 最近登录 IP（S-07 新增，每次登录更新）
    last_login_country TEXT DEFAULT '',  -- 最近登录国家（S-07 新增）
    last_login_city TEXT DEFAULT '',     -- 最近登录城市（S-07 新增）
    last_login_at INTEGER DEFAULT NULL   -- 最近登录时间（S-07 新增，Date.now()）
);

-- 迁移备注: S-06 (2026-08-06) 为 users 补充 ip/country/city/user_agent 字段
-- 线上 D1 执行: wrangler d1 execute db --remote --file docs/migrations/2026-08-06-S06-users-meta.sql
-- 迁移备注: S-07 (2026-08-06) 为 users 补充 admin_note / last_login_* 字段
-- 线上 D1 执行: wrangler d1 execute db --remote --file docs/migrations/2026-08-06-S07-visitor-tracking.sql

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

-- ── 匿名访问者身份（S-07 新增） ──
-- 游客首次访问时生成 sm_v_<UUID> 存入 cookie（有效期 1 年），
-- 首次生成时在此表记录首访 IP/地区/UA。
-- 用户注册/登录后通过 linked_user_id 关联，形成完整画像。
CREATE TABLE IF NOT EXISTS anonymous_visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id TEXT UNIQUE NOT NULL,        -- 形如 sm_v_<UUID>，随机不可预测
    first_ip TEXT DEFAULT '',               -- 首访 IP
    first_country TEXT DEFAULT '',          -- 首访国家
    first_city TEXT DEFAULT '',             -- 首访城市
    user_agent TEXT DEFAULT '',             -- 首访浏览器 UA
    created_at INTEGER NOT NULL,            -- 首访时间（Date.now() 毫秒）
    linked_user_id INTEGER DEFAULT NULL,    -- 注册/登录后绑定的用户
    FOREIGN KEY (linked_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_anonymous_visitors_linked_user
    ON anonymous_visitors(linked_user_id);

CREATE INDEX IF NOT EXISTS idx_anonymous_visitors_created
    ON anonymous_visitors(created_at);

-- 迁移备注: S-07 (2026-08-06) 新增 anonymous_visitors 表
-- 线上 D1 执行: wrangler d1 execute db --remote --file docs/migrations/2026-08-06-S07-visitor-tracking.sql

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
    ip TEXT DEFAULT '',               -- 用户提交测评时的真实 IP（S-05 新增）
    user_agent TEXT DEFAULT '',       -- 用户浏览器 UA（S-05 新增）
    country TEXT DEFAULT '',          -- 国家（S-05 新增）
    city TEXT DEFAULT '',             -- 城市（S-05 新增）
    device TEXT DEFAULT '',           -- 设备类型：mobile/desktop/tablet（S-05 新增）
    os TEXT DEFAULT '',               -- 操作系统（S-05 新增）
    browser TEXT DEFAULT '',          -- 浏览器（S-05 新增）
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 迁移备注: S-05 (2026-08-06) 为 quiz_results 补充 ip/user_agent/country/city/device/os/browser 字段
-- 线上 D1 执行: wrangler d1 execute db --remote --file docs/migrations/2026-08-06-S05-quiz-meta.sql
-- 并补充索引: idx_quiz_results_created（见 docs/migrations/2026-08-06-S05-quiz-meta.sql）

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

-- ── 提问箱追问对话（S-08 新增） ──
-- 已登录提问者与箱主之间在原有问答下方形成连续对话线程。
-- 说明:
--   - 每条消息独立存储，question_id 关联根问题
--   - role: 消息发送者的角色（asker=提问者 / owner=箱主），用于身份展示
--   - message_type: 消息行为类型（follow_up=提问者追问 / owner_reply=箱主回复），预留扩展（AI 回复/系统消息等）
--   - parent_message_id: 预留字段，用于未来支持回复某条消息（第一版仅线性排序，不嵌套）
--   - 隐私: 追问线程仅提问者本人与箱主可见，其他访客看不到
-- 迁移文件: docs/migrations/2026-08-06-S08-askbox-thread.sql
CREATE TABLE IF NOT EXISTS askbox_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,           -- 关联 askbox_questions.id（根问题）
    sender_id INTEGER NOT NULL,             -- 发送者用户ID（提问者或箱主）
    role TEXT NOT NULL CHECK(role IN ('asker','owner')),
    message_type TEXT NOT NULL CHECK(message_type IN ('follow_up','owner_reply')),
    parent_message_id INTEGER DEFAULT NULL, -- 预留：回复某条消息（第一版置 NULL）
    content TEXT NOT NULL,                  -- 追问/回复内容（≤500字）
    created_at INTEGER NOT NULL,            -- 毫秒级时间戳 Date.now()
    FOREIGN KEY (question_id) REFERENCES askbox_questions(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_askbox_messages_question ON askbox_messages(question_id, created_at);

-- 迁移备注: S-08 (2026-08-06) 新增 askbox_messages 表（提问箱追问对话）
-- 线上 D1 执行（待确认）: wrangler d1 execute <DB_NAME> --remote --file docs/migrations/2026-08-06-S08-askbox-thread.sql

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
    visitor_id TEXT DEFAULT NULL,      -- 匿名身份标识，关联 anonymous_visitors（S-07 新增）
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_log_visitor ON activity_log(visitor_id);

-- 迁移备注: S-07 (2026-08-06) 为 activity_log 补充 visitor_id 字段
-- 线上 D1 执行: wrangler d1 execute db --remote --file docs/migrations/2026-08-06-S07-visitor-tracking.sql
-- 迁移备注: S09 (2026-08-08) 为 activity_log 补充 device/os/browser/referrer/page_path/detail_json 字段
-- 线上 D1 执行（待执行）: wrangler d1 execute <DB_NAME> --file docs/migrations/2026-08-08-S09-analytics-upgrade.sql

-- ── 页面访问统计 ──

CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page TEXT NOT NULL,
    user_id INTEGER,
    is_logged_in INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 迁移备注: S09 (2026-08-08) 为 page_views 补充 visitor_token/referrer/device/os/browser 字段
-- 线上 D1 执行（待执行）: wrangler d1 execute <DB_NAME> --file docs/migrations/2026-08-08-S09-analytics-upgrade.sql

-- ── 提问箱访问统计（S09 新增） ──
-- 记录每次提问箱访问，供后台聚合访问次数/去重访客/来源渠道
CREATE TABLE IF NOT EXISTS askbox_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_user_id INTEGER NOT NULL,          -- 提问箱主人（users.id）
    visitor_id TEXT DEFAULT '',               -- 访客身份标识（visitor_id cookie / visitor_token，可空）
    user_id INTEGER DEFAULT NULL,             -- 登录访客（users.id，可空）
    referrer TEXT DEFAULT '',                 -- 来源渠道
    created_at INTEGER NOT NULL,              -- 访问时间（Date.now() 毫秒）
    FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_askbox_visits_target_time ON askbox_visits(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_askbox_visits_visitor ON askbox_visits(visitor_id, created_at DESC);

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
    ip TEXT DEFAULT '',               -- 用户抽牌时的真实 IP（CF-Connecting-IP，S-04 新增）
    user_agent TEXT DEFAULT '',       -- 用户浏览器 UA（S-04 新增）
    country TEXT DEFAULT '',          -- 国家（S-04 新增）
    city TEXT DEFAULT '',             -- 城市（S-04 新增）
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_quiz_id) REFERENCES quiz_results(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tarot_user ON tarot_readings(user_id, created_at DESC);

-- 迁移备注: S-04 (2026-08-05) 为 tarot_readings 补充 ip/user_agent/country/city 字段
-- 线上 D1 执行: wrangler d1 execute db --remote --file docs/migrations/2026-08-05-S04-admin-upgrade.sql
-- 并补充后台统计索引: idx_activity_log_created / idx_activity_log_action_created /
--                     idx_quiz_results_created / idx_tarot_readings_created / idx_users_created
-- （这些索引见 docs/migrations/2026-08-05-S04-admin-upgrade.sql）

-- ── 个人动态（朋友圈/小红书式图文） ──
-- 2026-08-01 新增：moments / moment_likes / moment_comments

CREATE TABLE IF NOT EXISTS moments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT DEFAULT '',
    images_json TEXT DEFAULT '[]',
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS moment_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(moment_id, user_id),
    FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS moment_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id INTEGER NOT NULL,
    user_id INTEGER,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_moments_user ON moments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moment_likes_moment ON moment_likes(moment_id);
CREATE INDEX IF NOT EXISTS idx_moment_comments_moment ON moment_comments(moment_id, created_at);

-- ── 匿名记忆导入（通用框架） ──
-- 2026-08-03 新增：content_imports / imported_questions
-- 说明：建立支持未来多个平台的内容导入系统，不修改现有 askbox_questions
-- 迁移文件：docs/migrations/2026-08-03-S03-content-import.sql

CREATE TABLE IF NOT EXISTS content_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,          -- 导入者（SoulMirror 用户）
    platform TEXT NOT NULL,            -- 来源平台标识（如 'lightbox'）
    source_url TEXT,                   -- 来源链接
    source_id TEXT,                    -- 来源平台侧 ID（如轻匿 url_code）
    title TEXT,                        -- 来源标题（如提问箱标题）
    avatar TEXT,                       -- 来源头像 URL
    total_count INTEGER DEFAULT 0,     -- 本次导入的问答总数
    status TEXT NOT NULL DEFAULT 'pending',  -- pending / previewed / imported / failed
    created_at INTEGER NOT NULL,       -- 创建时间（Date.now()）
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS imported_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id INTEGER NOT NULL,        -- 关联 content_imports.id
    source_question_id TEXT,           -- 来源平台侧问题 ID（去重用）
    question TEXT NOT NULL,            -- 问题内容
    answer TEXT,                       -- 回答内容
    source_created_at INTEGER,         -- 来源平台侧创建时间
    created_at INTEGER NOT NULL,       -- 导入时间（Date.now()）
    FOREIGN KEY (import_id) REFERENCES content_imports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_content_imports_user ON content_imports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_imported_questions_import ON imported_questions(import_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_imported_questions_dedup ON imported_questions(import_id, source_question_id);


