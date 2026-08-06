-- ============================================================
-- 迁移: S04 - 后台系统升级
-- 日期: 2026-08-05
-- 说明:
--   1. 为 tarot_readings 表补充 ip、user_agent、country、city 字段
--   2. 补充后台查询所需索引
-- ============================================================

-- ── 1. tarot_readings 表补充 IP/UA/Geo 字段 ──
-- 已有字段: id, user_id, created_at, spread_type, question,
--           cards_json, headline, analysis_json, linked_quiz_id
-- ALTER TABLE 是幂等的：如果字段已存在会报错，需先确认
-- 执行命令: wrangler d1 execute soulmirror-db --file docs/migrations/2026-08-05-S04-admin-upgrade.sql

ALTER TABLE tarot_readings ADD COLUMN ip TEXT DEFAULT '';
ALTER TABLE tarot_readings ADD COLUMN user_agent TEXT DEFAULT '';
ALTER TABLE tarot_readings ADD COLUMN country TEXT DEFAULT '';
ALTER TABLE tarot_readings ADD COLUMN city TEXT DEFAULT '';

-- ── 2. 后台统计所需索引 ──

-- activity_log 查询索引
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_action_created ON activity_log(action, created_at DESC);

-- quiz_results 时间索引（今日统计 + 趋势查询）
CREATE INDEX IF NOT EXISTS idx_quiz_results_created ON quiz_results(created_at DESC);

-- tarot_readings 时间索引
CREATE INDEX IF NOT EXISTS idx_tarot_readings_created ON tarot_readings(created_at DESC);

-- users 注册趋势索引
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);

-- ── 3. 验证方法 ──
-- 执行后运行:
--   SELECT COUNT(*) FROM pragma_table_info('tarot_readings') WHERE name IN ('ip','user_agent','country','city');
--   返回值应为 4（说明字段存在）
--   SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%_created';
--   应显示新创建的索引
-- ============================================================