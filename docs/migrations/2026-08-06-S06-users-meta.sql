-- ============================================================
-- 迁移: S06 - users 表补充注册元数据字段（后台升级 Phase 5）
-- 日期: 2026-08-06
-- 说明:
--   1. 为 users 表补充 ip、country、city、user_agent 字段
--   2. 用于后台「注册用户管理」展示注册来源 IP/地区/设备
--   3. 不影响 yourlover（QUIZ_DB.completions）链路
-- ============================================================

-- ── 1. users 表补充注册元数据字段 ──
-- 已有字段: id, email, display_name, avatar_url, is_admin, created_at
-- 执行命令: wrangler d1 execute db --remote --file docs/migrations/2026-08-06-S06-users-meta.sql

ALTER TABLE users ADD COLUMN ip TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN country TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN city TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN user_agent TEXT DEFAULT '';

-- ── 2. 验证方法 ──
-- 执行后运行:
--   SELECT COUNT(*) FROM pragma_table_info('users') WHERE name IN ('ip','country','city','user_agent');
--   返回值应为 4（说明字段存在）
-- ============================================================