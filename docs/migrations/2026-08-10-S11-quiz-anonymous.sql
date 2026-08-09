-- ============================================================
-- S11: 心理测评支持匿名记录（quiz_results 支持匿名访客）
-- 项目: Hatefishjustin/social
-- 日期: 2026-08-10
--
-- 背景（需求1）:
--   后台「心理测评」数据板块只能看到登录用户的测评记录，
--   匿名用户完成心理测评后的结果没有进入后台展示。
--   根因:
--     1. quiz_results.user_id 为 INTEGER NOT NULL，无法写入匿名记录
--     2. /records 保存接口要求登录，匿名请求被 401 丢弃
--   方案:
--     - user_id 改为可空（NULL = 匿名访客）
--     - 新增 visitor_token 列（匿名访客标识，用于后台追踪同一匿名用户）
--     - 全量保留已有数据（id 不变，关联关系不变）
--
-- 线上 D1 执行:
--   wrangler d1 execute <DB_NAME> --remote --file docs/migrations/2026-08-10-S11-quiz-anonymous.sql
--
-- 安全说明:
--   - 仅 tarot_readings.linked_quiz_id 外键引用 quiz_results（ON DELETE SET NULL）
--   - 迁移前备份该引用，重建后恢复，确保不丢失任何数据
--   - D1 强制外键（无法 PRAGMA foreign_keys=OFF），使用 defer_foreign_keys 兼容 DROP
-- ============================================================

-- 1) 备份 tarot_readings → quiz_results 的引用（防 DROP 触发 SET NULL）
DROP TABLE IF EXISTS _quiz_links_backup;
CREATE TABLE _quiz_links_backup AS
  SELECT id, linked_quiz_id FROM tarot_readings WHERE linked_quiz_id IS NOT NULL;

-- 2) 新建支持匿名的 quiz_results 表
CREATE TABLE quiz_results_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT NULL,          -- 登录用户ID（匿名测评时为 NULL）
    visitor_token TEXT DEFAULT '',         -- 匿名访客标识（匿名测评时记录，用于后台追踪）
    created_at INTEGER NOT NULL,
    headline TEXT NOT NULL,
    scores_json TEXT NOT NULL,
    answers_json TEXT,
    ip TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    country TEXT DEFAULT '',
    city TEXT DEFAULT '',
    device TEXT DEFAULT '',
    os TEXT DEFAULT '',
    browser TEXT DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 3) 全量迁移旧数据（保留 id，保证 tarot_readings.linked_quiz_id 等关联不失效）
INSERT INTO quiz_results_new (id, user_id, created_at, headline, scores_json, answers_json, ip, user_agent, country, city, device, os, browser)
SELECT id, user_id, created_at, headline, scores_json, answers_json, ip, user_agent, country, city, device, os, browser
FROM quiz_results;

-- 4) 替换旧表（DROP 会对 tarot_readings.linked_quiz_id 触发 SET NULL，由步骤 6 恢复）
PRAGMA defer_foreign_keys = on;
DROP TABLE quiz_results;
ALTER TABLE quiz_results_new RENAME TO quiz_results;
PRAGMA defer_foreign_keys = off;

-- 5) 恢复原有索引 + 新增 visitor_token 索引
CREATE INDEX IF NOT EXISTS idx_quiz_results_created ON quiz_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_user ON quiz_results(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_results_visitor ON quiz_results(visitor_token, created_at DESC);

-- 6) 从备份恢复 tarot_readings 与 quiz_results 的关联（仅当目标 quiz 仍存在）
UPDATE tarot_readings
SET linked_quiz_id = (
  SELECT b.linked_quiz_id FROM _quiz_links_backup b WHERE b.id = tarot_readings.id
)
WHERE EXISTS (
  SELECT 1 FROM _quiz_links_backup b
  WHERE b.id = tarot_readings.id
    AND b.linked_quiz_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM quiz_results q WHERE q.id = b.linked_quiz_id)
);

-- 7) 同步 AUTOINCREMENT 序列（保证新记录 id 延续）
DELETE FROM sqlite_sequence WHERE name = 'quiz_results';
INSERT INTO sqlite_sequence (name, seq)
  SELECT 'quiz_results', COALESCE(MAX(id), 0) FROM quiz_results;

-- 8) 清理备份表
DROP TABLE IF EXISTS _quiz_links_backup;

-- ============================================================
-- 验证（执行后运行）:
--   PRAGMA table_info(quiz_results);
--     -- 应看到 user_id 可空（无 NOT NULL）+ visitor_token 列
--   SELECT COUNT(*) FROM quiz_results;
--     -- 数量与迁移前一致
--   SELECT COUNT(*) FROM tarot_readings WHERE linked_quiz_id IS NOT NULL;
--     -- 数量与迁移前一致
-- ============================================================
