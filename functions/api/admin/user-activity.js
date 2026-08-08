/**
 * Cloudflare Pages Function
 * 路径: /api/admin/user-activity
 * 方法: GET
 * S09 用户行为时间线（管理员）
 * 返回: 某用户（或全局）的行为轨迹，合并 activity_log + page_views
 * 兼容迁移前/后状态（S09 未执行时 activity_log 新列不存在，降级返回基础字段）
 */
import { getCurrentUser } from '../../_lib/auth.js';
import { hasColumn } from '../../_lib/schema.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const PAGE_SIZE = 30;

export const onRequestGet = async ({ request, env }) => {
  if (!env || !env.DB) return jsonResponse({ error: 'missing_db', message: '数据库未配置' }, 500);

  const user = await getCurrentUser(request, env);
  if (!user || !user.isAdmin) return jsonResponse({ error: 'forbidden', message: '无权限' }, 403);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const userId = url.searchParams.get('userId') || '';
  const action = url.searchParams.get('action') || '';
  const offset = (page - 1) * PAGE_SIZE;

  const db = env.DB;
  const hasNewCols = await hasColumn(env, 'activity_log', 'device');

  // 动态构建 activity_log 查询列
  const activityCols = hasNewCols
    ? `id, user_id, user_email, action, target_type, target_id, content,
       ip, country, city, is_anonymous, visitor_id, created_at,
       device, os, browser, referrer, page_path`
    : `id, user_id, user_email, action, target_type, target_id, content,
       ip, country, city, is_anonymous, visitor_id, created_at`;

  const conditions = [];
  const params = [];
  if (userId) {
    conditions.push('user_id = ?');
    params.push(userId);
  }
  if (action) {
    conditions.push('action = ?');
    params.push(action);
  }
  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // 活动日志
  const actSql = `SELECT ${activityCols}, 'activity' as source FROM activity_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const actCountSql = `SELECT COUNT(*) as total FROM activity_log ${where}`;

  const [actRes, actCount] = await Promise.all([
    db.prepare(actSql).bind(...params, PAGE_SIZE, offset).all(),
    db.prepare(actCountSql).bind(...params).first(),
  ]);

  // 页面访问（仅跟踪 userId 时合并；全局模式只返回活动日志避免 page_views 全量膨胀）
  let views = [];
  if (userId) {
    const cond = userId ? 'WHERE user_id = ?' : 'WHERE 1=1';
    const vRes = await db.prepare(
      `SELECT id, page, user_id, is_logged_in, created_at,
              ${hasNewCols ? 'visitor_token, referrer, device, os, browser,' : ''}
              'page_view' as action
       FROM page_views ${cond}
       ORDER BY created_at DESC LIMIT 20`
    ).bind(userId).all();
    views = (vRes.results || []).map((v) => ({
      id: 'pv_' + v.id,
      user_id: v.user_id,
      action: 'page_view',
      content: '访问页面 ' + (v.page || '/'),
      page_path: v.page || '/',
      referrer: v.referrer || '',
      device: v.device || '',
      os: v.os || '',
      browser: v.browser || '',
      created_at: v.created_at,
      source: 'page_views',
    }));
  }

  // 合并排序（活动日志领先页，分页基于活动日志总量）
  const activities = (actRes.results || []).map((a) => ({
    id: a.id,
    user_id: a.user_id,
    user_email: a.user_email || '',
    action: a.action || '',
    target_type: a.target_type || '',
    target_id: a.target_id || '',
    content: a.content || '',
    ip: a.ip || '',
    country: a.country || '',
    city: a.city || '',
    is_anonymous: !!a.is_anonymous,
    visitor_id: a.visitor_id || '',
    created_at: a.created_at,
    device: a.device || '',
    os: a.os || '',
    browser: a.browser || '',
    referrer: a.referrer || '',
    page_path: a.page_path || '',
    source: a.source || 'activity',
  }));

  // userId 模式下将最近页面访问插入时间线顶部（按时间排序合并前 5 条）
  let merged = activities;
  if (userId && views.length > 0) {
    merged = [...activities, ...views].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  return jsonResponse({
    activities: merged,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total: actCount?.total || 0,
      totalPages: Math.ceil((actCount?.total || 0) / PAGE_SIZE),
    },
    schemaMode: hasNewCols ? 'S09' : 'legacy',
    generatedAt: Date.now(),
  });
};