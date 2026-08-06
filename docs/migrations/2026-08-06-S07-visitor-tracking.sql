-- ============================================================
-- S07 用户身份追踪 + 用户备注管理（2026-08-06）
-- 项目: Hatefishjustin/social
-- 说明:
--   1. 新增 anonymous_visitors 表（匿名身份追踪）
--   2. users 表补充 admin_note / last_login_* 字段
--   3. activity_log 表补充 visitor_id 字段（匿名行为关联）
-- 执行前请确认备份，执行: wrangler d1 execute <DB_NAME> --file docs/migrations/2026-08-06-S07-visitor-tracking.sql
-- ============================================================

-- ── 1. 匿名访问者身份表 ──
-- 游客首次访问时生成 sm_v_<UUID> 存入 cookie（有效期 1 年），
-- 首次生成时在此表记录首访 IP/地区/UA。
-- 用户注册/登录后通过 linked_user_id 关联，形成完整画像。
CREATE TABLE IF NOT EXISTS anonymous_visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id TEXT UNIQUE NOT NULL,        -- 形如 sm_v_<UUID>，随机不可预测
    first_ip TEXT DEFAULT '',               -- 首访 IP
    first_country TEXT DEFAULT '',          -- 首访国家
    first_city TEXT DEFAULT '',             -- 首访城市
    user_agent TEXT DEFAULT '',             -- 首访浏览器 UA
    created_at INTEGER NOT NULL,            -- 首访时间（Date.now() 毫秒）
    linked_user_id INTEGER DEFAULT NULL,    -- 注册/登录后绑定的用户
    FOREIGN KEY (linked_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_anonymous_visitors_linked_user
    ON anonymous_visitors(linked_user_id);

CREATE INDEX IF NOT EXISTS idx_anonymous_visitors_created
    ON anonymous_visitors(created_at);

-- ── 2. users 表补充管理员备注 + 最近登录信息 ──
-- admin_note: 管理员自定义用户标签/备注（最大 200 字符）
-- last_login_*: 每次登录成功持续更新（区别于注册信息 ip/country/city 仅在为空时补充）
ALTER TABLE users ADD COLUMN admin_note TEXT DEFAULT '';

ALTER TABLE users ADD COLUMN last_login_ip TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN last_login_country TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN last_login_city TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN last_login_at INTEGER DEFAULT NULL;

-- ── 3. activity_log 表补充 visitor_id 字段 ──
-- 匿名行为（如 /track 上报的 quiz_completed）通过 visitor_id 关联 anonymous_visitors，
-- 再由 anonymous_visitors.linked_user_id 归属到注册用户。
-- 已登录用户产生的日志同样记录 visitor_id，便于追溯"注册前匿名→注册后登录"同源行为。
ALTER TABLE activity_log ADD COLUMN visitor_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_log_visitor
    ON activity_log(visitor_id);