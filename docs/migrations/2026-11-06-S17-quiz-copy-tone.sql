-- =============================================================
-- S15 三个测评 · 目录文案口径调整（2026-11-06）
-- 背景：用户改口径，允许「确诊 / 废物 / 伪人 / 精神病」等
--       自嘲梗词回归；只改文案，不改结构、计分、题数。
-- 范围：quizzes 表 subtitle / description 两列，三条记录。
-- 执行前已备份：backups/soulmirror-db-2026-11-06-before-copy-tone.sql
-- 可重复执行（幂等 UPDATE）。
-- 回滚：把 subtitle / description 改回下方注释中的旧值。
--   lovebrain-level 旧 subtitle: 12 道题，算算你还剩多少理智在线
--   lovebrain-level 旧 description: 12 道情境题，算出你的恋爱脑浓度和嘴硬指数。玩笑式上头刻度，不是心理诊断。
--   mind-state      旧 subtitle: 20 道题，看看今天的你是什么状态
--   mind-state      旧 description: 早八猴、省电模式、热闹旁观者……不诊断、不贴病名，只描述你最近更常进入的状态。
--   dorm-persona    旧 subtitle: 11 个寝室名场面，测出你的宿舍生态位
--   dorm-persona    旧 description: 气氛组、边界派、后勤部长、夜聊搭子……看看你在宿舍里更常站在哪个位置。
-- =============================================================

UPDATE quizzes
SET subtitle = '12 道离谱情境题，给你现在的上头程度下个赛博诊断',
    description = '12 道离谱情境题，算出你的恋爱脑浓度，看看理智还剩几格电。纯属玩梗，非医学诊断。',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE slug = 'lovebrain-level';

UPDATE quizzes
SET subtitle = '今日精神状态：已确诊为××（纯属娱乐）',
    description = '20 道日常名场面，给你今天的精神状态下个赛博诊断。纯属玩梗，非医学诊断。',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE slug = 'mind-state';

UPDATE quizzes
SET subtitle = '确诊一下，你在寝室是哪种生物',
    description = '11 个寝室名场面，确诊你在宿舍的生态位。纯属玩梗，非医学诊断。',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE slug = 'dorm-persona';
