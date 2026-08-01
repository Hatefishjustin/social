-- ============================================================
-- 迁移方案：S-01 修复 content_violations 表字段与代码不一致
-- 项目: Hatefishjustin/social
-- 日期: 2026-08-01
-- 状态: 【执行记录】schema.sql 已同步更新；线上 D1 待手动执行本文件
-- 更新: 2026-08-01 - schema.sql 已新增 match_id/sender_id/content/violation_type 字段
--                    及 idx_content_violations_match 索引（保留全部既有字段）
--
-- 背景:
--   functions/chat/send.js 使用 match_id, sender_id, content, violation_type
--   但 content_violations 表（schema.sql 定义）仅有
--   user_id, report_id, action, admin_id, admin_note。
--   导致敏感词消息发送时 INSERT 报"列不存在"，整条消息发送失败(500)。
--
-- 方案: 方案 A（最小改动）
--   为 content_violations 新增 send.js 所需的 4 个字段 + 1 个索引。
--   保留现有字段（reports-admin.js 仍在使用），不删不改既有列。
-- ============================================================

-- 1. 新增字段（幂等：SQLite 不支持 ADD COLUMN IF NOT EXISTS，
--    执行前需先确认字段不存在，见下方"执行前检查"）
ALTER TABLE content_violations ADD COLUMN match_id INTEGER;
ALTER TABLE content_violations ADD COLUMN sender_id INTEGER;
ALTER TABLE content_violations ADD COLUMN content TEXT;
ALTER TABLE content_violations ADD COLUMN violation_type TEXT;

-- 2. 新增索引：加速 send.js 的累计严重度查询
--    SELECT violation_type FROM content_violations WHERE match_id = ?
CREATE INDEX IF NOT EXISTS idx_content_violations_match ON content_violations(match_id);

-- ============================================================
-- 执行前检查（只读，不修改数据）：
--   wrangler d1 execute <DB_NAME> --command "PRAGMA table_info(content_violations);"
--   或 Cloudflare Dashboard → D1 → 控制台执行
--   确认 match_id / sender_id / content / violation_type 均不存在后再执行迁移。
--
-- 执行方式（二选一）：
--   方式1: wrangler d1 execute <DB_NAME> --file docs/migrations/2026-08-01-S01-content-violations.sql
--   方式2: Cloudflare Dashboard → D1 → 控制台逐条执行上方 SQL
--
-- 注意: 当前 wrangler.toml 未声明 [[d1_databases]] 绑定，
--       D1 绑定(DB) 是在 Cloudflare Pages 控制台配置的。
--       执行前需确认 <DB_NAME> 与线上数据库名一致。
-- ============================================================
