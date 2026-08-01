-- ============================================================
-- S-01 端到端测试数据（fixture）
-- 项目: Hatefishjustin/social
-- 日期: 2026-08-01
-- 用途: 为 /chat/send 敏感词自动关闭功能提供测试数据
-- 说明:
--   - 所有测试数据均带 s01-test 标识，避免污染真实用户
--   - 不硬编码 user_id，通过 email 子查询获取实际 id（D1 SQLite 兼容）
--   - 使用 INSERT OR IGNORE 保证幂等，重复执行不会产生重复数据
-- 执行方式: Cloudflare Dashboard → D1 → 控制台，或
--           wrangler d1 execute <DB_NAME> --file docs/test-data/S01-test-fixture.sql
-- 注意: 本文件仅用于测试，执行前请确认 <DB_NAME> 为测试/可回滚环境
-- ============================================================

-- ─────────────────────────────────────────────
-- 0. 执行前检查（可选）
--    若返回结果，说明测试邮箱已存在，可跳过插入或先清理
-- ─────────────────────────────────────────────
-- SELECT id, email FROM users WHERE email IN
--   ('s01-test-user-a@example.com','s01-test-user-b@example.com');

-- ─────────────────────────────────────────────
-- 1. 测试用户（users）
-- ─────────────────────────────────────────────
-- 为什么需要: /chat/send 的 getCurrentUser 通过 sessions JOIN users 取 user_id/email；
--             match 校验要求 user_a/user_b 是真实存在的 users.id。
-- 幂等: INSERT OR IGNORE（email 有 UNIQUE 约束，重复执行自动跳过）
INSERT OR IGNORE INTO users (email, display_name, avatar_url, is_admin, created_at)
VALUES ('s01-test-user-a@example.com', 'S01测试用户A', '', 0, 1782950400000);

INSERT OR IGNORE INTO users (email, display_name, avatar_url, is_admin, created_at)
VALUES ('s01-test-user-b@example.com', 'S01测试用户B', '', 0, 1782950400000);

-- ─────────────────────────────────────────────
-- 2. 测试用户资料（profiles）
-- ─────────────────────────────────────────────
-- 为什么需要: 虽然 /chat/send 本身不校验 profile，但为保持数据完整、
--             便于后续复用（如 /chat/match 需要 profile），一并创建。
-- 幂等: INSERT OR IGNORE（user_id 是 PRIMARY KEY，重复执行自动跳过）
-- 取 id: 通过 email 子查询从 users 表获取实际 user_id，不硬编码
INSERT OR IGNORE INTO profiles
  (user_id, nickname, gender, age_group, bio, avatar_seed, scores_json, is_active, created_at, updated_at)
SELECT id, 'S01测试用户A', '男', '大学生', 'S01测试用资料', 's01-a',
       '{"attachment":{"type":"安全型"},"big5":{"openness":60,"conscientiousness":60,"extraversion":60,"agreeableness":60,"neuroticism":40},"loveLang":{"primary":"肯定的言辞"},"values":{"commitment":70}}',
       1, 1782950400000, 1782950400000
FROM users WHERE email = 's01-test-user-a@example.com';

INSERT OR IGNORE INTO profiles
  (user_id, nickname, gender, age_group, bio, avatar_seed, scores_json, is_active, created_at, updated_at)
SELECT id, 'S01测试用户B', '女', '大学生', 'S01测试用资料', 's01-b',
       '{"attachment":{"type":"安全型"},"big5":{"openness":60,"conscientiousness":60,"extraversion":60,"agreeableness":60,"neuroticism":40},"loveLang":{"primary":"肯定的言辞"},"values":{"commitment":70}}',
       1, 1782950400000, 1782950400000
FROM users WHERE email = 's01-test-user-b@example.com';

-- ─────────────────────────────────────────────
-- 3. 测试会话（sessions）
-- ─────────────────────────────────────────────
-- 为什么需要: /chat/send 的 getCurrentUser 通过 Cookie 中的 session token
--             查询 sessions 表，必须存在有效会话才能通过 401 校验。
-- 幂等: INSERT OR IGNORE（token 是 PRIMARY KEY，重复执行自动跳过）
-- 取 id: 通过 email 子查询获取用户A的实际 user_id
INSERT OR IGNORE INTO sessions (token, user_id, expires_at)
SELECT 's01-test-session-token-a', id, 4102444800000
FROM users WHERE email = 's01-test-user-a@example.com';

-- ─────────────────────────────────────────────
-- 4. 测试 match（matches）
-- ─────────────────────────────────────────────
-- 为什么需要: /chat/send 校验 match 必须存在且 status='accepted'，
--             且当前用户是 user_a 或 user_b 之一。
-- 幂等: 用 NOT EXISTS 守卫，避免重复创建相同 match
-- 取 id: 通过 email 子查询获取用户A/B的实际 user_id
INSERT INTO matches (user_a, user_b, match_score, match_reason, status, is_shadow, created_at)
SELECT a.id, b.id, 85, 'S01测试匹配', 'accepted', 0, 1782950400000
FROM users a, users b
WHERE a.email = 's01-test-user-a@example.com'
  AND b.email = 's01-test-user-b@example.com'
  AND NOT EXISTS (
    SELECT 1 FROM matches m
    WHERE m.user_a = a.id AND m.user_b = b.id AND m.status = 'accepted'
  );

-- ============================================================
-- 测试完成后清理（DELETE）
-- 说明: 按外键依赖顺序删除，避免外键约束失败。
--       仅删除 s01-test 标识的数据，不影响真实数据。
-- ============================================================

-- 5. 清理 content_violations（敏感词自动关闭产生的记录）
DELETE FROM content_violations WHERE sender_id IN (
  SELECT id FROM users WHERE email IN ('s01-test-user-a@example.com','s01-test-user-b@example.com')
);

-- 6. 清理 notifications（send 产生的通知）
DELETE FROM notifications WHERE actor_email IN ('s01-test-user-a@example.com','s01-test-user-b@example.com');

-- 7. 清理 messages（该 match 下的消息）
DELETE FROM messages WHERE match_id IN (
  SELECT m.id FROM matches m
  JOIN users ua ON ua.id = m.user_a
  JOIN users ub ON ub.id = m.user_b
  WHERE ua.email = 's01-test-user-a@example.com' AND ub.email = 's01-test-user-b@example.com'
);

-- 8. 清理 matches
DELETE FROM matches WHERE user_a IN (
  SELECT id FROM users WHERE email IN ('s01-test-user-a@example.com','s01-test-user-b@example.com')
) OR user_b IN (
  SELECT id FROM users WHERE email IN ('s01-test-user-a@example.com','s01-test-user-b@example.com')
);

-- 9. 清理 sessions
DELETE FROM sessions WHERE token = 's01-test-session-token-a';

-- 10. 清理 profiles
DELETE FROM profiles WHERE user_id IN (
  SELECT id FROM users WHERE email IN ('s01-test-user-a@example.com','s01-test-user-b@example.com')
);

-- 11. 清理 users（最后删除，因其他表外键引用）
DELETE FROM users WHERE email IN ('s01-test-user-a@example.com','s01-test-user-b@example.com');

-- ============================================================
-- 使用说明:
--   1. 执行上方 1-4 段 INSERT 创建测试数据（幂等，可重复执行）
--   2. 查询实际生成的 id 和 match id:
--        SELECT id FROM users WHERE email='s01-test-user-a@example.com';
--        SELECT id FROM users WHERE email='s01-test-user-b@example.com';
--        SELECT id FROM matches WHERE match_reason='S01测试匹配';
--   3. 用 Cookie: session=s01-test-session-token-a 调用
--      POST /chat/send  body: {"matchId": <matches.id>, "content": "..."}
--   4. 测试用例:
--      - 正常消息: content = "你好，今天天气不错"
--      - LOW 违规: content = "加我微信聊"
--      - HIGH 违规: content = "我们约炮吧"
--      - 累计关闭: 连续发送违规消息使累计 severity ≥ 6
--   5. 测试完成后执行 5-11 段 DELETE 清理
-- ============================================================
