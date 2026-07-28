/**
 * Cloudflare Workers Scheduled Function
 * 路径: functions/cron-cleanup.js
 * 触发: 在 Cloudflare Dashboard 设置 Workers Cron Trigger（建议每天凌晨 3 点）
 * 清理: login_tokens / ip_trust / sessions 过期数据
 */
export async function scheduled(event, env, ctx) {
  const now = Date.now();
  const db = env.DB;
  if (!db) { console.error('DB binding not found'); return; }

  const results = [];

  // 清理过期 login_tokens（10 分钟有效期）
  try {
    const r = await db.prepare(
      `DELETE FROM login_tokens WHERE expires_at < ?`
    ).bind(now).run();
    results.push(`login_tokens: deleted ${r.meta?.changes_written || '?'}`);
  } catch(e) { results.push(`login_tokens: error - ${e.message}`); }

  // 清理过期 ip_trust（5 分钟有效期）
  try {
    const r = await db.prepare(
      `DELETE FROM ip_trust WHERE expires_at < ?`
    ).bind(now).run();
    results.push(`ip_trust: deleted ${r.meta?.changes_written || '?'}`);
  } catch(e) { results.push(`ip_trust: error - ${e.message}`); }

  // 清理过期 sessions（7 天有效期）
  try {
    const r = await db.prepare(
      `DELETE FROM sessions WHERE expires_at < ?`
    ).bind(now).run();
    results.push(`sessions: deleted ${r.meta?.changes_written || '?'}`);
  } catch(e) { results.push(`sessions: error - ${e.message}`); }

  // 清理过期 notifications（30 天）
  try {
    const r = await db.prepare(
      `DELETE FROM notifications WHERE created_at < ?`
    ).bind(now - 30 * 24 * 3600 * 1000).run();
    results.push(`notifications: deleted ${r.meta?.changes_written || '?'}`);
  } catch(e) { results.push(`notifications: error - ${e.message}`); }

  console.log(`[cron-cleanup] ${new Date().toISOString()} - ${results.join(' | ')}`);
}
