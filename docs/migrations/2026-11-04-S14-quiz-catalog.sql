-- S14: 测评目录（quizzes）
-- 2026-11-04
-- 说明：
--   1. 测评中心轮盘不再写死卡片，数量完全由本表 status='published' 的记录决定。
--   2. 执行前先备份：wrangler d1 export db --remote --output=backup-before-s14.sql
--   3. 只新增表/索引，不修改已有表，可安全重复执行（IF NOT EXISTS）。

CREATE TABLE IF NOT EXISTS quizzes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '测评',
    subtitle TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    question_count INTEGER NOT NULL DEFAULT 0,
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    participant_count INTEGER NOT NULL DEFAULT 0,
    points_json TEXT NOT NULL DEFAULT '[]',
    questions_json TEXT NOT NULL DEFAULT '[]',
    entry_url TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'spark',
    tint TEXT NOT NULL DEFAULT '',
    badge TEXT NOT NULL DEFAULT '',
    badge_class TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quizzes_status_sort ON quizzes(status, sort_order, id);

-- 首批上架：原有 41 题深度匹配测评 + S/M 互动倾向测试
-- 用 INSERT OR IGNORE，重复执行不会覆盖后台后来的编辑。
INSERT OR IGNORE INTO quizzes
    (slug, title, category, subtitle, description, question_count, duration_minutes,
     participant_count, points_json, questions_json, entry_url, icon, tint, badge,
     badge_class, status, sort_order, created_at, updated_at)
VALUES
    (
        'deep-match',
        '深度匹配测评',
        '关系',
        '41 道题，画出你的关系画像',
        '融合依恋理论、大五人格、五种爱之语与价值观，生成你的关系画像。',
        41, 10, 0,
        '["你在关系里的默认靠近方式","什么情境最容易让你退开","你可以尝试的一次小调整"]',
        '[]',
        '/match.html',
        'compass',
        'rgba(82,43,91,.50)',
        '深度',
        'deep',
        'published',
        10,
        CAST(strftime('%s','now') AS INTEGER) * 1000,
        CAST(strftime('%s','now') AS INTEGER) * 1000
    ),
    (
        'sm-tendency',
        'S/M 互动倾向',
        '关系',
        '30 道题，看见你的互动偏好',
        '从主导、顺从、切换、信任与边界五个维度，看看你在亲密互动中的倾向。仅面向 18 岁以上用户。',
        30, 3, 0,
        '["你在互动中的主导与顺从倾向","你如何切换角色、建立信任","你的边界感与可协商空间"]',
        '[]',
        '/sm-test.html',
        'split',
        'rgba(133,79,108,.42)',
        '18+',
        '',
        'published',
        20,
        CAST(strftime('%s','now') AS INTEGER) * 1000,
        CAST(strftime('%s','now') AS INTEGER) * 1000
    );
