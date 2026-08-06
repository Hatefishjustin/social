/**
 * Cloudflare Pages Functions IP 获取工具
 * 路径: /functions/_lib/ip.js
 * 
 * 统一封装 IP 获取方式：
 *   1. 优先使用 Cloudflare 提供的 CF-Connecting-IP（最可靠，用户不可伪造）
 *   2. 其次使用 X-Real-IP（部分代理设置）
 *   3. 最后返回 'unknown'
 * 
 * 同时获取地理信息和 User-Agent 元数据。
 * 禁止使用 request.headers.get('x-forwarded-for')，
 * 因为该标头可被客户端伪造。
 */

/**
 * 获取客户端真实 IP 地址
 * @param {Request} request - Cloudflare Pages Function 的 request 对象
 * @returns {string} IP 地址或 'unknown'
 */
export function getClientIP(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Real-IP') ||
    'unknown'
  );
}

/**
 * 获取请求元数据（IP、地理信息、User-Agent）
 * @param {Request} request - Cloudflare Pages Function 的 request 对象
 * @returns {{ ip: string, ua: string, country: string, city: string, region: string, asn: string }}
 */
export function getRequestMeta(request) {
  const cf = request.cf || {};
  return {
    ip: getClientIP(request),
    ua: (request.headers.get('User-Agent') || '').slice(0, 500),
    country: cf.country || '',
    city: cf.city || '',
    region: cf.region || '',
    asn: cf.asn ? String(cf.asn) : '',
  };
}

/**
 * 行为日志辅助函数：向 activity_log 表写入一条日志记录
 * @param {object} env - Cloudflare Pages Function 的 env 对象（含 DB 绑定）
 * @param {object} meta - getRequestMeta 返回的元数据对象
 * @param {object|null} user - 当前用户对象（含 id, email）或 null
 * @param {string} action - 操作类型（如 'login', 'register', 'tarot_submit', 'test_submit', 'page_view'）
 * @param {string} targetType - 目标类型（如 'user', 'tarot', 'quiz'）
 * @param {string|null} targetId - 目标 ID
 * @param {string} content - 操作内容摘要
 * @param {number} isAnonymous - 是否匿名（0 或 1）
 */
export async function logActivity(env, meta, user, action, targetType, targetId, content, isAnonymous = 0) {
  try {
    await env.DB.prepare(
      `INSERT INTO activity_log 
       (user_id, user_email, action, target_type, target_id, content, ip, user_agent, country, city, is_anonymous, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user ? user.id : null,
      user ? user.email : null,
      action,
      targetType,
      targetId || null,
      (content || '').slice(0, 500),
      meta.ip,
      meta.ua,
      meta.country,
      meta.city,
      isAnonymous,
      Date.now()
    ).run();
  } catch (e) {
    // 日志写入失败不应影响主流程，静默记录
    console.error('activity_log insert failed:', e.message);
  }
}