-- ============================================================
-- S10: S/M 互动倾向测试（隐藏心理测试）
-- 项目: Hatefishjustin/social
-- 日期: 2026-08-09
--
-- 说明:
--   新增 sm_test_results 表，用于保存用户在隐藏心理测试
--   「S/M 互动倾向测试」中的作答结果。
--   该测试从心理学角度分析用户在亲密关系中的权力互动偏好，
--   属于娱乐和自我探索性质，不代表专业心理诊断。
--
-- 线上 D1 执行:
--   wrangler d1 execute <DB_NAME> --remote --file docs/migrations/2026-08-09-S10-sm-test.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS sm_test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_token TEXT DEFAULT '',        -- 匿名访客标识（visitor_id cookie / visitor_token，可空）
    s_score REAL NOT NULL DEFAULT 0,      -- S 倾向（Dominance）平均分 1~5
    m_score REAL NOT NULL DEFAULT 0,      -- M 倾向（Submission）平均分 1~5
    switch_score REAL NOT NULL DEFAULT 0, -- Switch（双向适应）平均分 1~5
    trust_score REAL NOT NULL DEFAULT 0,  -- Trust（信任建立能力）平均分 1~5
    consent_score REAL NOT NULL DEFAULT 0,-- Consent（边界意识）平均分 1~5
    result_type TEXT NOT NULL DEFAULT '', -- 结果类型：S / M / Switch / Balanced
    created_at INTEGER NOT NULL           -- 提交时间（Date.now() 毫秒）
);

CREATE INDEX IF NOT EXISTS idx_sm_test_results_created
    ON sm_test_results(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sm_test_results_visitor
    ON sm_test_results(visitor_token, created_at DESC);
