-- ============================================================
-- 迁移: 提问箱追问对话 - askbox_messages 表
-- 项目: Hatefishjustin/social
-- 日期: 2026-08-06
-- 说明:
--   - 新增 askbox_messages 表：已登录提问者与箱主之间的连续对话线程
--   - 第一版仅线性排序（question_id + created_at），parent_message_id 为预留字段
--   - 隐私：追问线程仅提问者本人（asker_id）与箱主（target_id）可见
--   - 不影响 S04（answer_visibility / visitor_token），根回答可见性逻辑原样保留
-- 执行（待负责人确认）:
--   wrangler d1 execute <DB_NAME> --remote --file docs/migrations/2026-08-06-S08-askbox-thread.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS askbox_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,           -- 关联 askbox_questions.id（根问题）
    sender_id INTEGER NOT NULL,             -- 发送者用户ID（提问者或箱主）
    role TEXT NOT NULL CHECK(role IN ('asker','owner')),
    message_type TEXT NOT NULL CHECK(message_type IN ('follow_up','owner_reply')),
    parent_message_id INTEGER DEFAULT NULL, -- 预留：回复某条消息（第一版置 NULL）
    content TEXT NOT NULL,                  -- 追问/回复内容（≤500字）
    created_at INTEGER NOT NULL,            -- 毫秒级时间戳 Date.now()
    FOREIGN KEY (question_id) REFERENCES askbox_questions(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_askbox_messages_question ON askbox_messages(question_id, created_at);