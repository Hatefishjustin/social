/**
 * Cloudflare Pages Functions 匿名身份追踪工具
 * 路径: /functions/_lib/visitor.js
 *
 * 职责：
 *   1. getOrCreateVisitor(request, env) - 读取 Cookie 中 visitor_id，不存在则生成并写入 anonymous_visitors
 *   2. linkVisitorToUser(env, visitorId, userId) - 用户登录/注册后绑定匿名身份
 *   3. afterLogin(request, env, userId) - 登录后统一处理：绑定 visitor + 补充注册信息 + 更新最近登录信息
 *
 * 设计原则：
 *   - visitor_id 仅用于行为关联，绝不可作为登录凭证
 *   - 首次生成时写数据库；已有 cookie 时只读取，避免每次请求产生数据库压力
 *   - 所有数据库写入失败静默降级，不阻塞业务主流程
 */
import { getRequestMeta } from './ip.js';

/**
 * 生成不可预测的 visitor_id：sm_v_<UUID>
 */
function generateVisitorId() {
  return 'sm_v_' + crypto.randomUUID();
}

/**
 * 获取 visitor_id Cookie
 * @param {Request} request
 * @returns {string|null}
 */
export function getVisitorId(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)visitor_id=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * 读取或创建匿名身份
 * @param {Request} request - 请求对象
 * @param {object} env - Cloudflare 环境（含 DB）
 * @returns {{ visitorId: string, isNew: boolean }}
 *   - visitorId: 当前匿名身份 ID
 *   - isNew: 本次是否新生成（true 时调用方应设置 Set-Cookie）
 */
export async function getOrCreateVisitor(request, env) {
  const existing = getVisitorId(request);
  if (existing) {
    return { visitorId: existing, isNew: false };
  }

  const visitorId = generateVisitorId();

  // 仅在首次生成时写数据库
  if (env && env.DB) {
    try {
      const cf = request.cf || {};
      const meta = {
        ip: request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || 'unknown',
        ua: (request.headers.get('User-Agent') || '').slice(0, 500),
        country: cf.country || '',
        city: cf.city || '',
      };
      await env.DB.prepare(
        `INSERT INTO anonymous_visitors (visitor_id, first_ip, first_country, first_city, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(visitorId, meta.ip, meta.country, meta.city, meta.ua, Date.now()).run();
    } catch (e) {
      console.error('anonymous_visitors insert failed:', e.message);
    }
  }

  return { visitorId, isNew: true };
}

/**
 * 绑定匿名身份到用户（注册/登录时调用）
 * @param {object} env - Cloudflare 环境
 * @param {string|null} visitorId - 匿名身份 ID（可能为空）
 * @param {number} userId - 用户 ID
 */
export async function linkVisitorToUser(env, visitorId, userId) {
  if (!visitorId || !env || !env.DB) return;
  try {
    await env.DB.prepare(
      `UPDATE anonymous_visitors SET linked_user_id = ? WHERE visitor_id = ? AND linked_user_id IS NULL`
    ).bind(userId, visitorId).run();
  } catch (e) {
    console.error('link_visitor_to_user failed:', e.message);
  }
}

/**
 * 登录成功后的统一处理：
 *   1. 绑定 Cookie 中的 visitor_id → anonymous_visitors.linked_user_id
 *   2. 注册信息（ip/country/city/user_agent）仅在为空时补充
 *   3. 最近登录信息（last_login_*）持续更新
 * @param {Request} request - 请求对象
 * @param {object} env - Cloudflare 环境
 * @param {number} userId - 用户 ID
 */
export async function afterLogin(request, env, userId) {
  if (!env || !env.DB) return;

  // 1. 绑定匿名身份
  const visitorId = getVisitorId(request);
  if (visitorId) {
    await linkVisitorToUser(env, visitorId, userId);
  }

  // 2+3. 补充/更新用户网络信息
  try {
    const { ip, ua, country, city } = getRequestMeta(request);
    await env.DB.prepare(
      `UPDATE users SET
         ip = CASE WHEN ip = '' OR ip IS NULL THEN ? ELSE ip END,
         country = CASE WHEN country = '' OR country IS NULL THEN ? ELSE country END,
         city = CASE WHEN city = '' OR city IS NULL THEN ? ELSE city END,
         user_agent = CASE WHEN user_agent = '' OR user_agent IS NULL THEN ? ELSE user_agent END,
         last_login_ip = ?,
         last_login_country = ?,
         last_login_city = ?,
         last_login_at = ?
       WHERE id = ?`
    ).bind(
      ip, country, city, ua,
      ip, country, city, Date.now(),
      userId
    ).run();
  } catch (e) {
    console.error('afterLogin update users failed:', e.message);
  }
}

/**
 * 构建 visitor_id 的 Set-Cookie 头（有效期 1 年）
 * HttpOnly=false（前端需要读取）、SameSite=Lax、Secure
 * @param {string} visitorId - 匿名身份 ID
 * @returns {string} Set-Cookie 值
 */
export function buildVisitorCookie(visitorId) {
  const maxAge = 365 * 24 * 60 * 60; // 1 年（秒）
  return `visitor_id=${visitorId}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`;
}