-- S12: Session 清理迁移
-- 执行后所有用户需要重新登录，请确认后执行。
-- 执行方式：wrangler d1 execute soulmirror-db --remote --file=docs/migrations/S12-session-cleanup.sql

DELETE FROM sessions;
