/**
 * D1 固定窗口限流工具
 * 路径: /functions/_lib/ratelimit.js
 *
 * 用途：
 *   - 保护 AI 接口（/analyze、/api/sm-analyze）不被匿名刷取
 *   - 保护埋点接口（/api/event、/api/view）不被刷量
 *   - 保护头像读取接口（/api/avatar）不被批量抓取
 *
 * 说明：
 *   - 使用 D1 表 rate_limits 做持久化计数，跨 isolate 生效
 *   - 首次调用会自动建表（兼容尚未执行迁移的线上库）
 *   - 限流失败时 fail-open，避免数据库异常导致整站不可用
 */

import { getClientIP } from './ip.js';

let tableEnsured = false;

async function ensureTable(env) {
  if (tableEnsured) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS rate_limits (
       key TEXT PRIMARY KEY,
       window_start INTEGER NOT NULL,
       count INTEGER NOT NULL DEFAULT 0
     )`
  ).run();
  tableEnsured = true;
}

/**
 * 检查并累加一次计数
 * @param {object} env - 含 DB 的环境对象
 * @param {string} key - 限流键（建议带作用域前缀，如 ai:analyze:ip:1.2.3.4）
 * @param {number} limit - 窗口内允许次数
 * @param {number} windowMs - 窗口长度（毫秒）
 * @returns {Promise<{allowed:boolean, retryAfter:number}>}
 */
export async function checkRateLimit(env, key, limit, windowMs) {
  if (!env || !env.DB) return { allowed: true, retryAfter: 0 };

  try {
    await ensureTable(env);

    const now = Date.now();
    const safeKey = String(key || 'unknown').slice(0, 200);
    const row = await env.DB.prepare(
      'SELECT window_start, count FROM rate_limits WHERE key = ?'
    ).bind(safeKey).first();

    if (!row || now - row.window_start >= windowMs) {
      await env.DB.prepare(
        `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1`
      ).bind(safeKey, now).run();
      return { allowed: true, retryAfter: 0 };
    }

    if (row.count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000));
      return { allowed: false, retryAfter };
    }

    await env.DB.prepare(
      'UPDATE rate_limits SET count = count + 1 WHERE key = ?'
    ).bind(safeKey).run();

    return { allowed: true, retryAfter: 0 };
  } catch (e) {
    // 限流组件异常不应阻断正常业务
    console.error('checkRateLimit failed:', e.message);
    return { allowed: true, retryAfter: 0 };
  }
}

/**
 * 从请求中提取限流身份
 * @param {Request} request
 * @param {string} bodyToken - 请求体里的匿名标识（可选）
 * @returns {{ip:string, token:string, identity:string}}
 */
export function getRateLimitIdentity(request, bodyToken) {
  const ip = getClientIP(request);
  const token = String(bodyToken || '').slice(0, 100);
  return { ip, token, identity: token || ip };
}

/**
 * 同源校验：浏览器跨站 POST 会带 Origin，若存在且与站点不同源则拒绝。
 * 注意：部分 sendBeacon 请求可能不带 Origin，此时放行，由限流兜底。
 * @param {Request} request
 * @returns {boolean}
 */
export function isSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch (e) {
    return false;
  }
}
