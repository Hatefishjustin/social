-- ============================================================
-- S-01 功能验证 SQL 查询清单
-- 项目: Hatefishjustin/social
-- 日期: 2026-08-01
-- 用途: 手动执行测试后，用以下 SQL 在 D1 中验证结果
-- 执行方式: Cloudflare Dashboard → D1 → 控制台，或
--           wrangler d1 execute <DB_NAME> --command "<SQL>"
-- 注意: <matchId> 请替换为实际测试的 match id
-- ============================================================

-- ─────────────────────────────────────────────
-- 0. 迁移后表结构验证（确认 S-01 字段已生效）
-- ─────────────────────────────────────────────
PRAGMA table_info(content_violations);
-- 预期列: id, user_id, report_id, action, admin_id, admin_note,
--         match_id, sender_id, content, violation_type, created_at

-- 索引验证
SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='content_violations';
-- 预期: idx_content_violations_user, idx_content_violations_match

-- ─────────────────────────────────────────────
-- 用例A - 正常消息（无违规）
-- ─────────────────────────────────────────────
-- 预期: messages 新增1条正常消息；content_violations 无新增
SELECT id, match_id, sender_id, content, is_system, created_at
FROM messages WHERE match_id = <matchId> ORDER BY id DESC LIMIT 5;

SELECT id, match_id, sender_id, content, violation_type, created_at
FROM content_violations WHERE match_id = <matchId> ORDER BY id DESC;

-- ─────────────────────────────────────────────
-- 用例B - 低危违规（LOW 词，如"微信"，severity=1，不触发关闭）
-- ─────────────────────────────────────────────
-- 预期: content_violations 新增1条，violation_type 含 severity=1；
--       messages 存过滤后内容（敏感词被替换为 **）
SELECT id, match_id, sender_id, content, violation_type, created_at
FROM content_violations WHERE match_id = <matchId> ORDER BY id DESC LIMIT 5;

SELECT id, match_id, sender_id, content
FROM messages WHERE match_id = <matchId> ORDER BY id DESC LIMIT 5;

-- ─────────────────────────────────────────────
-- 用例C - 高危违规（HIGH 词，如"色情"，severity=2，单次<3 不触发关闭）
-- ─────────────────────────────────────────────
-- 预期: content_violations 新增1条，violation_type 含 severity=2；
--       match 状态仍为 accepted（未关闭）
SELECT id, match_id, sender_id, content, violation_type
FROM content_violations WHERE match_id = <matchId> ORDER BY id DESC LIMIT 5;

SELECT id, status, closed_at FROM matches WHERE id = <matchId>;

-- ─────────────────────────────────────────────
-- 用例D - 累计触发关闭（累计 severity≥6）
-- ─────────────────────────────────────────────
-- 预期: match 状态变 closed；插入 is_system=1 的系统提示消息；
--       接口返回 403 auto_closed
SELECT id, status, closed_at FROM matches WHERE id = <matchId>;

SELECT id, match_id, sender_id, content, is_system
FROM messages WHERE match_id = <matchId> AND is_system = 1;

-- 查看该 match 全部违规记录及累计严重度
SELECT id, violation_type FROM content_violations WHERE match_id = <matchId>;

-- ─────────────────────────────────────────────
-- 用例E - 管理员举报处理回归（warn/ban）
-- ─────────────────────────────────────────────
-- 预期: content_violations 新增1条（user_id/report_id/action/admin_id/admin_note 正常写入）；
--       reports 状态变 resolved
SELECT id, user_id, report_id, action, admin_id, admin_note, created_at
FROM content_violations ORDER BY id DESC LIMIT 5;

SELECT id, status, admin_note, resolved_at
FROM reports ORDER BY id DESC LIMIT 5;

-- ============================================================
-- 验证通过标准:
--   1. PRAGMA 显示 11 列（含新增4列）
--   2. 索引含 idx_content_violations_match
--   3. 用例A: 无违规记录
--   4. 用例B: violation_type 含 severity=1，messages 为过滤后内容
--   5. 用例C: violation_type 含 severity=2，match 仍 accepted
--   6. 用例D: match 变 closed，存在 is_system=1 消息
--   7. 用例E: content_violations 含管理员 action 记录，reports 变 resolved
-- ============================================================
