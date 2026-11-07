-- ============================================================
-- 2026-11-07 后台「测评结果」模块：quiz_attempts 补明细字段与索引
-- 项目: Hatefishjustin/social
--
-- 背景:
--   quiz_attempts 之前只存结果摘要（slug / 结果名 / 单一分数），
--   没有逐题答案、维度分、UA、IP，后台无法查看作答明细。
--   本次只新增字段与索引，不修改、不删除任何已有数据。
--
-- 内容（全部为只增）:
--   1. answers_json   逐题选择明细（JSON 数组，由答题器提交）
--   2. dims_json      维度得分与结果快照（JSON 对象）
--   3. mode           计分模式：type / scale / score
--   4. user_agent     提交时的浏览器 UA
--   5. ip             提交时的真实 IP（CF-Connecting-IP）
--   6. created_at 索引：支持全局按时间排序、翻页、导出
--   7. result_name 索引：支持按结果标签筛选
--
-- 纪律:
--   - 执行前先备份线上 D1（2026-11-07 已导出：
--     backups/soulmirror-db-2026-11-07-before-quiz-attempts-detail.sql）
--   - 本迁移只新增，不 DROP、不 UPDATE 既有行。
--   - 旧记录的新字段会取默认值（'[]' / '{}' / ''），后台会显示「旧记录无逐题明细」。
--
-- 线上执行:
--   wrangler d1 export db --remote --output=backups/soulmirror-db-2026-11-07-before-quiz-attempts-detail.sql
--   wrangler d1 execute db --remote --file docs/migrations/2026-11-07-quiz-attempts-detail.sql
--
-- 回滚（仅在确认不需要明细字段时执行；D1 不支持 DROP COLUMN，需重建表，
--       因此回滚前必须先导出 quiz_attempts 全量数据）:
--   DROP INDEX IF EXISTS idx_quiz_attempts_created;
--   DROP INDEX IF EXISTS idx_quiz_attempts_result;
--   -- 列无法单独删除；保留列不影响旧代码（旧代码不读取这些列）。
-- ============================================================

ALTER TABLE quiz_attempts ADD COLUMN answers_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE quiz_attempts ADD COLUMN dims_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE quiz_attempts ADD COLUMN mode TEXT NOT NULL DEFAULT '';
ALTER TABLE quiz_attempts ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';
ALTER TABLE quiz_attempts ADD COLUMN ip TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_created
    ON quiz_attempts(created_at, id);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_result
    ON quiz_attempts(result_name, created_at);
