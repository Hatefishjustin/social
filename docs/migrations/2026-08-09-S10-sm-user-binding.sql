-- ============================================================
-- S10: S/M 互动倾向测试 - 用户身份绑定
-- 项目: Hatefishjustin/social
-- 日期: 2026-08-09
--
-- 说明:
--   为 sm_test_results 表新增 user_id 字段，
--   用于关联登录用户的身份。
--   未登录用户继续使用 visitor_token 保持匿名。
--
-- 线上 D1 执行:
--   wrangler d1 execute <DB_NAME> --remote --file docs/migrations/2026-08-09-S10-sm-user-binding.sql
-- ============================================================

-- 新增 user_id 字段（可空，兼容已有游客记录）
ALTER TABLE sm_test_results ADD COLUMN user_id INTEGER DEFAULT NULL;

-- 为 user_id 创建索引，便于后台按用户查询
CREATE INDEX IF NOT EXISTS idx_sm_test_results_user
    ON sm_test_results(user_id, created_at DESC);
