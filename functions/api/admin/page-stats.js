/**
 * Cloudflare Pages Function
 * 路径: /api/admin/page-stats
 * 方法: GET
 * S09 页面访问统计（管理员）
 * 返回: 每页面 PV / UV / 最近访问时间 / 来源渠道 Top
 * 兼容迁移前/后状态（S09 未执行时 visitor_token 字段不存在，UV 降级）
 */
import { getCurrentUser } from '../../_lib/auth.js';
import { hasColumn } from '../../_lib/schema.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const onRequestGet = async ({ request, env }) => {
  if (!env || !env.DB) return jsonResponse({ error: 'missing_db', message: '数据库未配置' }, 500);

  const user = await getCurrentUser(request, env);
  if (!user || !user.isAdmin) return jsonResponse({ error: 'forbidden', message: '无权限' }, 403);

  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10)));
  const since = Date.now() - days * 86400000;

  const db = env.DB;
  const hasVisitorToken = await hasColumn(env, 'page_views', 'visitor_token');
  const hasReferrer = await hasColumn(env, 'page_views', 'referrer');

  // 每页面 PV + 最近访问
  const pvResult = await db.prepare(
    `SELECT page,
            COUNT(*) as pv,
            MAX(created_at) as last_visit
     FROM page_views
     WHERE created_at >= ?
     GROUP BY page
     ORDER BY pv DESC
     LIMIT 50`
  ).bind(since).all();

  // 每页面 UV
  let uvMap = {};
  if (hasVisitorToken) {
    const uvResult = await db.prepare(
      `SELECT page,
              COUNT(DISTINCT COALESCE(NULLIF(visitor_token, ''), 'anon:' || user_id)) as uv
       FROM page_views
       WHERE created_at >= ?
       GROUP BY page`
    ).bind(since).all();
    (uvResult.results || []).forEach((r) => { uvMap[r.page] = r.uv; });
  }

  // 来源渠道 Top（迁移后有 referrer 字段才统计）
  let topReferrers = [];
  if (hasReferrer) {
    const refResult = await db.prepare(
      `SELECT CASE
                WHEN referrer = '' THEN '直接访问'
                WHEN referrer LIKE '%weixin%' OR referrer LIKE '%wechat%' THEN '微信'
                WHEN referrer LIKE '%qq.com%' THEN 'QQ'
                WHEN referrer LIKE '%weibo%' THEN '微博'
                ELSE referrer
              END as source,
              COUNT(*) as count
       FROM page_views
       WHERE created_at >= ?
       GROUP BY source
       ORDER BY count DESC
       LIMIT 10`
    ).bind(since).all();
    topReferrers = refResult.results || [];
  }

  const pages = (pvResult.results || []).map((r) => ({
    page: r.page || '/',
    pv: r.pv || 0,
    uv: (hasVisitorToken ? (uvMap[r.page] || 0) : r.pv), // 迁移前 UV 降级为 PV 近似
    last_visit: r.last_visit || null,
  }));

  return jsonResponse({
    pages,
    topReferrers,
    appliedDays: days,
    uvMode: hasVisitorToken ? 'visitor_token' : 'degraded',
    generatedAt: Date.now(),
  });
};