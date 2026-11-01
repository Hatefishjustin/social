-- ============================================================
-- S-13 安全加固迁移（2026-11-01）
-- 对应代码：P0/P1 安全修复
--
-- 执行前请先备份：
--   wrangler d1 export db --remote --output=backup-before-s13.sql
-- 执行：
--   wrangler d1 execute db --remote --file docs/migrations/2026-11-01-S13-security-hardening.sql
--
-- 说明：
-- 1. 本迁移只做「加列 / 加表」，不删除、不改写任何现有数据。
-- 2. SQLite 的 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS；
--    若某列已存在，该条会报 duplicate column name，可跳过该条继续执行其余语句。
-- 3. messages.sender_id 在线上已允许 NULL（历史迁移未回写 schema.sql）。
--    本迁移不做表重建；新建环境请直接使用 schema.sql。
-- ============================================================

-- 1. 自动登录信任记录增加 UA 指纹（P0 #5）
ALTER TABLE ip_trust ADD COLUMN ua_hash TEXT;

-- 2. 提问箱：回答可见性 + 匿名提问者标识（P1 #10）
ALTER TABLE askbox_questions ADD COLUMN answer_visibility TEXT DEFAULT 'public';
ALTER TABLE askbox_questions ADD COLUMN visitor_token TEXT;

-- 3. 行为日志：S09 埋点字段 + 匿名 token（P1 #12）
ALTER TABLE activity_log ADD COLUMN visitor_token TEXT;
ALTER TABLE activity_log ADD COLUMN device TEXT;
ALTER TABLE activity_log ADD COLUMN os TEXT;
ALTER TABLE activity_log ADD COLUMN browser TEXT;
ALTER TABLE activity_log ADD COLUMN referrer TEXT;
ALTER TABLE activity_log ADD COLUMN page_path TEXT;
ALTER TABLE activity_log ADD COLUMN detail_json TEXT;

-- 4. 页面访问：S09 埋点字段（P1 #12）
ALTER TABLE page_views ADD COLUMN visitor_token TEXT;
ALTER TABLE page_views ADD COLUMN referrer TEXT;
ALTER TABLE page_views ADD COLUMN device TEXT;
ALTER TABLE page_views ADD COLUMN os TEXT;
ALTER TABLE page_views ADD COLUMN browser TEXT;

-- 5. 接口限流表（P0 #6 / P1 #12）
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- 6. 常用查询索引（可选，提升会话列表与限流清理效率）
CREATE INDEX IF NOT EXISTS idx_messages_match_time ON messages(match_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_user_a_status ON matches(user_a, status);
CREATE INDEX IF NOT EXISTS idx_matches_user_b_status ON matches(user_b, status);
