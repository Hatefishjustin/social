-- ============================================================
-- 迁移: S05 - quiz_results 补全元数据字段（后台升级 Phase 3）
-- 日期: 2026-08-06
-- 说明:
--   1. 为 quiz_results 表补充 ip、user_agent、country、city、device、os、browser 字段
--   2. 补充后台查询所需索引
--   3. 不影响 yourlover（QUIZ_DB.completions）链路
-- ============================================================

-- ── 1. quiz_results 表补充 IP/UA/Geo/Device 字段 ──
-- 已有字段: id, user_id, created_at, headline, scores_json, answers_json
-- ALTER TABLE 是幂等的：如果字段已存在会报错，需先确认
-- 执行命令: wrangler d1 execute db --remote --file docs/migrations/2026-08-06-S05-quiz-meta.sql

ALTER TABLE quiz_results ADD COLUMN ip TEXT DEFAULT '';
ALTER TABLE quiz_results ADD COLUMN user_agent TEXT DEFAULT '';
ALTER TABLE quiz_results ADD COLUMN country TEXT DEFAULT '';
ALTER TABLE quiz_results ADD COLUMN city TEXT DEFAULT '';
ALTER TABLE quiz_results ADD COLUMN device TEXT DEFAULT '';
ALTER TABLE quiz_results ADD COLUMN os TEXT DEFAULT '';
ALTER TABLE quiz_results ADD COLUMN browser TEXT DEFAULT '';

-- ── 2. 后台统计所需索引 ──

CREATE INDEX IF NOT EXISTS idx_quiz_results_created ON quiz_results(created_at DESC);

-- ── 3. 验证方法 ──
-- 执行后运行:
--   SELECT COUNT(*) FROM pragma_table_info('quiz_results') WHERE name IN ('ip','user_agent','country','city','device','os','browser');
--   返回值应为 7（说明字段存在）
-- ============================================================