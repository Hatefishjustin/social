/**
 * 路径: /functions/admin-activity.js
 * 路由: /admin-activity
 * 后台活动日志查询 API
 *
 * S11-P0 修复:
 *   - 返回完整字段供前台折叠分组：page_path / target_id / target_type / visitor_token / detail_json
 *   - 字段兼容：activity_log 无 event 列 → NULL AS event；
 *     S09 迁移未执行时 page_path/detail_json 不存在 → NULL AS 占位，不报错；
 *     visitor_token 列不存在时 → NULL AS visitor_token
 */

import { hasColumn } from './_lib/schema.js';

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

async function getCurrentUser(request, env) {
  if (!env.DB) return null;
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) return null;
  const row = await env.DB.prepare(
    `SELECT sessions.expires_at as expires_at, users.id as user_id, users.email as email, users.is_admin
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  if (!row.is_admin) return null;
  return { id: row.user_id, email: row.email };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

const PAGE_SIZE = 30;

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const action = url.searchParams.get('action') || '';
  const offset = (page - 1) * PAGE_SIZE;

  let where = '';
  const params = [];

  if (action) {
    where = ' WHERE action = ?';
    params.push(action);
  }

  // S11-P0: 字段存在性检测（不存在的字段用 NULL 占位，保证接口稳定不报错）
  const hasPageCol = await hasColumn(env, 'activity_log', 'page_path');
  const hasVisitorTokenCol = await hasColumn(env, 'activity_log', 'visitor_token');

  // activity_log 没有 event 列 → NULL AS event；S09 列缺失时同样 NULL 占位
  const extraCols =
    (hasPageCol ? 'page_path, detail_json, ' : 'NULL AS page_path, NULL AS detail_json, ') +
    (hasVisitorTokenCol ? 'visitor_token, ' : 'NULL AS visitor_token, ') +
    'NULL AS event, ';

  const sql = `SELECT id, user_id, user_email, action, target_type, target_id,
                      content, ip, user_agent, country, city, is_anonymous, visitor_id,
                      ${extraCols}
                      created_at
               FROM activity_log${where}
               ORDER BY created_at DESC LIMIT ? OFFSET ?`;

  const countSql = `SELECT COUNT(*) as total FROM activity_log${where}`;

  const { results } = await env.DB.prepare(sql).bind(...params, PAGE_SIZE, offset).all();
  const countRow = await env.DB.prepare(countSql).bind(...params).first();

  return jsonResponse({
    activities: results,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total: countRow?.total || 0,
      totalPages: Math.ceil((countRow?.total || 0) / PAGE_SIZE),
    },
  });
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
