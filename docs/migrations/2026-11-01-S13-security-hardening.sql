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
-- 1. 本迁移只做「加列 / 加表 / 加索引」，不删除、不改写任何现有数据。
-- 2. 2026-11-01 已核对线上库：
--    - askbox_questions.answer_visibility / visitor_token 已存在
--    - activity_log 的 device/os/browser/referrer/page_path/detail_json 已存在
--    - page_views 的 visitor_token/referrer/device/os/browser 已存在
--    因此这里不再重复 ALTER，避免 duplicate column name 中断。
-- 3. SQLite 的 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS；
--    若在其他环境重复执行，报 duplicate column name 时跳过该条即可。
-- 4. messages.sender_id 在线上已允许 NULL（历史迁移未回写 schema.sql）。
--    本迁移不做表重建；新建环境请直接使用 schema.sql。
-- ============================================================

-- 1. 自动登录信任记录增加 UA 指纹（P0 #5）
ALTER TABLE ip_trust ADD COLUMN ua_hash TEXT;

-- 2. 行为日志补匿名访客标识（S09/S11 兼容）
ALTER TABLE activity_log ADD COLUMN visitor_token TEXT;

-- 3. 接口限流表（P0 #6 / P1 #12）
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- 4. 常用查询索引（提升会话列表效率）
CREATE INDEX IF NOT EXISTS idx_messages_match_time ON messages(match_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_user_a_status ON matches(user_a, status);
CREATE INDEX IF NOT EXISTS idx_matches_user_b_status ON matches(user_b, status);
