-- ============================================================
-- 迁移: 新增动态（朋友圈/小红书式）功能
-- 项目: Hatefishjustin/social
-- 日期: 2026-08-01
-- 说明: 在个人主页增加发布图片/动图动态功能
-- 执行: wrangler d1 execute <DB_NAME> --file docs/migrations/2026-08-01-S02-moments.sql
-- ============================================================

-- 动态表：存储用户发布的图文动态
CREATE TABLE IF NOT EXISTS moments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT DEFAULT '',          -- 文字内容
    images_json TEXT DEFAULT '[]',    -- 图片列表（base64 data URI 数组）
    likes_count INTEGER DEFAULT 0,    -- 点赞数
    comments_count INTEGER DEFAULT 0, -- 评论数
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 动态点赞表
CREATE TABLE IF NOT EXISTS moment_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(moment_id, user_id),
    FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 动态评论表
CREATE TABLE IF NOT EXISTS moment_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id INTEGER NOT NULL,
    user_id INTEGER,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_moments_user ON moments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moment_likes_moment ON moment_likes(moment_id, user_id);
CREATE INDEX IF NOT EXISTS idx_moment_comments_moment ON moment_comments(moment_id, created_at);
