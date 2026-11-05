-- ============================================================
-- S15: 三个新测评接入目录 + 通用结果表
-- 项目: Hatefishjustin/social
-- 日期: 2026-11-05
--
-- 内容:
--   1. 新增 quiz_attempts 表，保存 /quiz.html 通用答题器的结果摘要。
--   2. 向 quizzes 表追加三条目录记录（published），entry_url 指向通用答题器：
--        lovebrain-level  → /quiz.html?slug=lovebrain-level
--        mind-state       → /quiz.html?slug=mind-state
--        dorm-persona     → /quiz.html?slug=dorm-persona
--
-- 纪律:
--   - 执行前先备份线上 D1。
--   - 本迁移只新增表/索引/目录记录，不修改、不删除任何已有数据。
--   - 使用 INSERT OR IGNORE，重复执行不会覆盖后台后续编辑。
--
-- 线上执行（示例，DB 名称以 Cloudflare 实际绑定为准）:
--   wrangler d1 export <DB_NAME> --remote --output=backup-before-s15.sql
--   wrangler d1 execute <DB_NAME> --remote --file docs/migrations/2026-11-05-S15-three-quizzes.sql
--
-- 回滚（仅在需要撤下这三个测试时执行，会删除这三条目录记录和通用结果表）:
--   DELETE FROM quizzes WHERE slug IN ('lovebrain-level','mind-state','dorm-persona');
--   DROP TABLE IF EXISTS quiz_attempts;
--   （用户记录如需保留，请先导出 quiz_attempts，不要直接 DROP。）
-- ============================================================

CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL DEFAULT '',            -- 测评 slug，如 lovebrain-level
    quiz_title TEXT NOT NULL DEFAULT '',      -- 测评标题快照
    result_key TEXT NOT NULL DEFAULT '',      -- 结果维度 / 档位标识
    result_name TEXT NOT NULL DEFAULT '',     -- 结果名称快照
    score REAL,                               -- 0~100 的浓度 / 百分比，可空
    mouth_score REAL,                         -- 恋爱脑附加的嘴硬指数，可空
    user_id INTEGER,                          -- 登录用户 id，匿名可空
    visitor_token TEXT NOT NULL DEFAULT '',   -- 匿名访客标识
    created_at INTEGER NOT NULL               -- 提交时间（Date.now() 毫秒）
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_time
    ON quiz_attempts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_slug
    ON quiz_attempts(slug, created_at DESC);

INSERT OR IGNORE INTO quizzes
    (slug, title, category, subtitle, description, question_count, duration_minutes,
     participant_count, points_json, questions_json, entry_url, icon, tint, badge,
     badge_class, status, sort_order, created_at, updated_at)
VALUES
    (
        'lovebrain-level',
        '恋爱脑浓度检测',
        '亲密关系',
        '12 道题，算算你还剩多少理智在线',
        '12 道情境题，算出你的恋爱脑浓度和嘴硬指数。玩笑式上头刻度，不是心理诊断。',
        12, 3, 0,
        '["你的恋爱脑浓度","你的嘴硬指数","一条把电量分回给自己的建议"]',
        '[]',
        '/quiz.html?slug=lovebrain-level',
        'heart',
        'rgba(223,182,178,.18)',
        '热门',
        '',
        'published',
        30,
        CAST(strftime('%s','now') AS INTEGER) * 1000,
        CAST(strftime('%s','now') AS INTEGER) * 1000
    ),
    (
        'mind-state',
        '精神状态图鉴',
        '自我认知',
        '20 道题，看看今天的你是什么状态',
        '早八猴、省电模式、热闹旁观者……不诊断、不贴病名，只描述你最近更常进入的状态。',
        20, 4, 0,
        '["最近最常进入的状态","你的今日电量","适合你的相处搭子"]',
        '[]',
        '/quiz.html?slug=mind-state',
        'bolt',
        'rgba(82,43,91,.50)',
        '抽象',
        '',
        'published',
        40,
        CAST(strftime('%s','now') AS INTEGER) * 1000,
        CAST(strftime('%s','now') AS INTEGER) * 1000
    ),
    (
        'dorm-persona',
        '宿舍生存人格',
        '校园生活',
        '11 个寝室名场面，测出你的宿舍生态位',
        '气氛组、边界派、后勤部长、夜聊搭子……看看你在宿舍里更常站在哪个位置。',
        11, 3, 0,
        '["你的宿舍角色","你的高光时刻与雷区","最适合你的室友类型"]',
        '[]',
        '/quiz.html?slug=dorm-persona',
        'users',
        'rgba(133,79,108,.42)',
        '群测',
        '',
        'published',
        50,
        CAST(strftime('%s','now') AS INTEGER) * 1000,
        CAST(strftime('%s','now') AS INTEGER) * 1000
    );
