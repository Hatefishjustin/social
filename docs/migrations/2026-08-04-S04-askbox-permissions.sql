-- ============================================================
-- 迁移: 提问箱权限升级 - 回复可见性 + 匿名访客身份
-- 项目: Hatefishjustin/social
-- 日期: 2026-08-04
-- 说明:
--   - 新增 answer_visibility: 回复可见性（public / private）
--   - 新增 visitor_token: 匿名提问者的临时身份标识
--   - 已回复数据默认设为 public，保持现有行为
-- 执行: wrangler d1 execute <DB_NAME> --file docs/migrations/2026-08-04-S04-askbox-permissions.sql
-- ============================================================

-- 1. 新增 answer_visibility 字段
--    控制回复的可见性
--    'public'  → 所有人可见（默认）
--    'private' → 仅提问者和箱主可见
ALTER TABLE askbox_questions ADD COLUMN answer_visibility TEXT NOT NULL DEFAULT 'public';

-- 2. 新增 visitor_token 字段
--    匿名用户提问时生成的 UUID v4，存储在用户 cookie 中
--    用于匿名提问者后续查看自己的私密回复
ALTER TABLE askbox_questions ADD COLUMN visitor_token TEXT DEFAULT NULL;

-- 3. 为 visitor_token 创建索引
--    用于 GET /askbox 时快速匹配匿名提问者身份
CREATE INDEX IF NOT EXISTS idx_askbox_visitor_token ON askbox_questions(visitor_token);