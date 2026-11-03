-- 心镜 SoulMirror · 校园冷启动种子内容（方案 A）
-- 生成日期：2026-11-03
--
-- 说明：
-- 1. 以下为“官方话题引导”，不是伪造的用户故事；统一加【心镜话题】前缀，便于识别。
-- 2. 表白墙使用 #树洞 标签，匿名展示；如需删除：
--    DELETE FROM wall_posts WHERE content LIKE '【心镜话题】%';
-- 3. 脚本可重复执行：wall_posts 按 content 去重，daily_questions 按 date 去重。
-- 4. 执行前先备份 D1：
--    wrangler d1 export db --remote --output=backup-before-seed.sql

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你最近一次觉得“被理解”，是因为什么？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 72000000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你最近一次觉得“被理解”，是因为什么？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】有没有一句话，你一直想对某个人说，却还没说出口？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 68400000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】有没有一句话，你一直想对某个人说，却还没说出口？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你会在什么时候最想找个人聊聊？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 64800000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你会在什么时候最想找个人聊聊？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你觉得自己在朋友眼里，是什么样的人？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 61200000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你觉得自己在朋友眼里，是什么样的人？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】最近一次心跳加速，是因为什么？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 57600000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】最近一次心跳加速，是因为什么？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你理想中的周末，是什么样子？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 54000000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你理想中的周末，是什么样子？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你最近在偷偷努力的一件事是什么？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 50400000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你最近在偷偷努力的一件事是什么？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你会因为什么对一个人产生好感？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 46800000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你会因为什么对一个人产生好感？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你希望别人怎么安慰你？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 43200000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你希望别人怎么安慰你？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你有没有一个很想念、却不敢联系的人？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 39600000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你有没有一个很想念、却不敢联系的人？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你觉得“喜欢”和“合适”，哪个更重要？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 36000000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你觉得“喜欢”和“合适”，哪个更重要？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你最近一次感到孤独，是什么时候？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 32400000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你最近一次感到孤独，是什么时候？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】如果能给一年前的自己留一句话，你会说什么？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 28800000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】如果能给一年前的自己留一句话，你会说什么？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你最想被谁看见，又最怕被谁看穿？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 25200000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你最想被谁看见，又最怕被谁看穿？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你有没有一个一直没来得及道谢的人？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 21600000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你有没有一个一直没来得及道谢的人？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你最近一次哭，是因为什么？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 18000000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你最近一次哭，是因为什么？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】如果可以重启一段关系，你会选哪一段？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 14400000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】如果可以重启一段关系，你会选哪一段？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你最想对暗恋的人说什么？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 10800000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你最想对暗恋的人说什么？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】你希望未来的自己，保留现在的什么？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 7200000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】你希望未来的自己，保留现在的什么？');

INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, likes_count, comments_count, is_featured, created_at)
SELECT NULL, '【心镜话题】如果今天可以任性一次，你最想做什么？', '#树洞', 1, '', 0, 0, 0, (unixepoch() * 1000) - 3600000
WHERE NOT EXISTS (SELECT 1 FROM wall_posts WHERE content = '【心镜话题】如果今天可以任性一次，你最想做什么？');

INSERT OR IGNORE INTO daily_questions (date, question, option_a, option_b, option_c, option_d, created_at)
VALUES ('2026-11-03', '最近一次让你觉得“被理解了”的瞬间，是什么？', '朋友记得我说过的小事', '有人没有急着给建议', '家人看出我心情不好', '暂时还没有', unixepoch() * 1000);

INSERT OR IGNORE INTO daily_questions (date, question, option_a, option_b, option_c, option_d, created_at)
VALUES ('2026-11-04', '在关系里，你最需要对方给你什么？', '安全感', '自由空间', '明确回应', '一起成长', unixepoch() * 1000);

INSERT OR IGNORE INTO daily_questions (date, question, option_a, option_b, option_c, option_d, created_at)
VALUES ('2026-11-05', '如果你可以对暗恋的人说一句话，你会说什么？', '其实我喜欢你很久了', '最近过得好吗', '希望你能幸福', '暂时不敢说', unixepoch() * 1000);

INSERT OR IGNORE INTO daily_questions (date, question, option_a, option_b, option_c, option_d, created_at)
VALUES ('2026-11-06', '你觉得自己更像哪种动物？', '猫', '狗', '猫头鹰', '刺猬', unixepoch() * 1000);

INSERT OR IGNORE INTO daily_questions (date, question, option_a, option_b, option_c, option_d, created_at)
VALUES ('2026-11-07', '周末最想怎么充电？', '一个人待着', '和朋友散步', '睡到自然醒', '去尝试新东西', unixepoch() * 1000);

INSERT OR IGNORE INTO daily_questions (date, question, option_a, option_b, option_c, option_d, created_at)
VALUES ('2026-11-08', '你最容易因为什么对一个人有好感？', '认真听我说话', '幽默', '稳定可靠', '有共同爱好', unixepoch() * 1000);

INSERT OR IGNORE INTO daily_questions (date, question, option_a, option_b, option_c, option_d, created_at)
VALUES ('2026-11-09', '如果可以重启一段关系，你会选？', '一段友情', '一段暗恋', '和家人的关系', '不想重启', unixepoch() * 1000);
