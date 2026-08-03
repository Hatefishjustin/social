-- ============================================================
-- 迁移: 新增「匿名记忆导入」通用框架
-- 项目: Hatefishjustin/social
-- 日期: 2026-08-03
-- 说明: 建立支持未来多个平台的内容导入系统（当前为通用框架，未接入具体平台）
--       不修改现有 askbox_questions，不影响现有提问箱功能
-- 执行: wrangler d1 execute <DB_NAME> --file docs/migrations/2026-08-03-S03-content-import.sql
-- ============================================================

-- 导入批次表：记录一次导入的来源信息与状态
CREATE TABLE IF NOT EXISTS content_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,          -- 导入者（SoulMirror 用户）
    platform TEXT NOT NULL,            -- 来源平台标识（如 'lightbox'）
    source_url TEXT,                   -- 来源链接
    source_id TEXT,                    -- 来源平台侧 ID（如轻匿 url_code）
    title TEXT,                        -- 来源标题（如提问箱标题）
    avatar TEXT,                       -- 来源头像 URL
    total_count INTEGER DEFAULT 0,     -- 本次导入的问答总数
    status TEXT NOT NULL DEFAULT 'pending',  -- pending / previewed / imported / failed
    created_at INTEGER NOT NULL,       -- 创建时间（Date.now()）
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 导入问答明细表：每条导入的问答
CREATE TABLE IF NOT EXISTS imported_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id INTEGER NOT NULL,        -- 关联 content_imports.id
    source_question_id TEXT,           -- 来源平台侧问题 ID（去重用）
    question TEXT NOT NULL,            -- 问题内容
    answer TEXT,                       -- 回答内容
    source_created_at INTEGER,         -- 来源平台侧创建时间
    created_at INTEGER NOT NULL,       -- 导入时间（Date.now()）
    FOREIGN KEY (import_id) REFERENCES content_imports(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_content_imports_user ON content_imports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_imported_questions_import ON imported_questions(import_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_imported_questions_dedup ON imported_questions(import_id, source_question_id);
