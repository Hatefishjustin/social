-- ============================================================
-- S09 后台数据中心升级（2026-08-08）
-- 项目: Hatefishjustin/social
-- 说明（对应 S05 后台数据中心升级方案 Phase 1）:
--   1. activity_log 表补充设备/来源/页面维度字段（用户活动中心）
--   2. page_views 表补充 visitor_token/referrer/设备字段（页面访问统计 + UV）
--   3. 新增 askbox_visits 表（提问箱访问次数统计）
--   4. 本次不新增收藏表、不新增 user_interest_labels 表
--      （两者均为预留能力，未来按需开发）
-- 执行前注意:
--   - 本文件仅生成，不自动执行线上迁移
--   - 确认数据库名称后再执行（历史迁移注释显示: soulmirror-db）
--   - 执行命令: wrangler d1 execute <DB_NAME> --file docs/migrations/2026-08-08-S09-analytics-upgrade.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. activity_log 表补充字段（用户活动中心 / 行为轨迹）
-- 说明:
--   - 现有字段已覆盖: user_id / action / target_* / content / ip / geo / is_anonymous / visitor_id / created_at
--   - 本次补充: 设备维度 + 来源渠道 + 页面路径 + 扩展详情
--   - 所有新字段为可选，旧数据保持空值，不删除任何数据
-- ────────────────────────────────────────────────────────────

ALTER TABLE activity_log ADD COLUMN device TEXT DEFAULT '';       -- 设备类型: mobile/desktop/tablet（UA 解析）
ALTER TABLE activity_log ADD COLUMN os TEXT DEFAULT '';           -- 操作系统（UA 解析）
ALTER TABLE activity_log ADD COLUMN browser TEXT DEFAULT '';      -- 浏览器（UA 解析）
ALTER TABLE activity_log ADD COLUMN referrer TEXT DEFAULT '';     -- 来源渠道: document.referrer（如微信/直接访问/站内跳转）
ALTER TABLE activity_log ADD COLUMN page_path TEXT DEFAULT '';    -- 发生行为的页面路径: 如 /qa.html
ALTER TABLE activity_log ADD COLUMN detail_json TEXT DEFAULT '';  -- 扩展详情（预留 JSON，如行为附加参数）

-- 行为查询索引（用户活动时间线按时间+行为过滤）
CREATE INDEX IF NOT EXISTS idx_activity_log_user_time
    ON activity_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_log_action_time
    ON activity_log(action, created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 2. page_views 表补充字段（页面访问统计 / UV / 来源）
-- 说明:
--   - 现有结构: id / page / user_id / is_logged_in / created_at
--   - page 字段将规范化为完整路径（如 /、/index.html、/qa.html）
--   - visitor_token: 匿名访客身份（来自 visitor_id cookie 或 visitor_token cookie），
--     用于 UV（独立访客）去重计算
-- ────────────────────────────────────────────────────────────

ALTER TABLE page_views ADD COLUMN visitor_token TEXT DEFAULT '';  -- 访客身份标识（匿名去重）
ALTER TABLE page_views ADD COLUMN referrer TEXT DEFAULT '';       -- 来源渠道
ALTER TABLE page_views ADD COLUMN device TEXT DEFAULT '';         -- mobile/desktop/tablet
ALTER TABLE page_views ADD COLUMN os TEXT DEFAULT '';             -- 操作系统
ALTER TABLE page_views ADD COLUMN browser TEXT DEFAULT '';        -- 浏览器

-- 页面访问统计索引
CREATE INDEX IF NOT EXISTS idx_page_views_visitor_time
    ON page_views(visitor_token, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_page_views_page_time
    ON page_views(page, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_page_views_user_time
    ON page_views(user_id, created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 3. 新增 askbox_visits 表（提问箱访问次数统计）
-- 设计:
--   - 每个访问记录一行，供后台聚合: 访问次数 / 去重访客 / 来源
--   - visitor_id: 访客身份（匿名提问箱访客的身份标识，可空）
--   - user_id: 登录用户访问者（可空）
--   - 不删除数据、不限额，后台展示时按需聚合
--   - 提问箱自身身份仍以 target_user_id（即用户 ID）为主键语义
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS askbox_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_user_id INTEGER NOT NULL,          -- 提问箱主人（users.id）
    visitor_id TEXT DEFAULT '',               -- 访客身份标识（visitor_id cookie / visitor_token，可空）
    user_id INTEGER DEFAULT NULL,             -- 登录访客（users.id，可空）
    referrer TEXT DEFAULT '',                 -- 来源渠道
    created_at INTEGER NOT NULL,              -- 访问时间（Date.now() 毫秒）
    FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_askbox_visits_target_time
    ON askbox_visits(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_askbox_visits_visitor
    ON askbox_visits(visitor_id, created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 4. 预留设计（本次不建表，仅记录规划）
-- ────────────────────────────────────────────────────────────
--
-- 【预留】用户兴趣画像表 user_interest_labels（二期实现）
--   用途: 按用户行为聚合兴趣方向（塔罗/测评/提问箱/表白墙等），
--         后台用户画像模块展示
--   CREATE TABLE IF NOT EXISTS user_interest_labels (
--       id INTEGER PRIMARY KEY AUTOINCREMENT,
--       user_id INTEGER NOT NULL,
--       label TEXT NOT NULL,                -- 兴趣标签: 塔罗爱好者/测评活跃/提问箱创作者…
--       weight INTEGER NOT NULL DEFAULT 1,  -- 权重
--       updated_at INTEGER NOT NULL,
--       UNIQUE(user_id, label)
--   );
--
-- 【预留】收藏功能（本次不实现）
--   现状: 全站无收藏功能（前后端均无）
--   规划: 待收藏功能上线后，行为通过 activity_log.detail_json 记录收藏对象，
--         并在后台用户活动时间线以 favorite_add 行为展示。

-- ============================================================
-- 验证方法（执行后运行）:
--   SELECT name FROM pragma_table_info('activity_log') WHERE name IN ('device','os','browser','referrer','page_path','detail_json');
--   -- 应返回 6 行
--   SELECT name FROM pragma_table_info('page_views') WHERE name IN ('visitor_token','referrer','device','os','browser');
--   -- 应返回 5 行
--   SELECT name FROM sqlite_master WHERE type='table' AND name='askbox_visits';
--   -- 应返回 1 行
-- ============================================================