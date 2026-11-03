/**
 * Cloudflare Pages Function
 * 路径: /functions/wall.js
 * 路由: /wall
 * v2: 增加活动日志，记录 IP / 设备 / 地区
 * v3: 统一使用 _lib/ip.js 获取请求元数据
 */

import { getRequestMeta } from './_lib/ip.js';
import { getCurrentUser } from './_lib/auth.js';
import { checkRateLimit, getRateLimitIdentity, isSameOrigin } from './_lib/ratelimit.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function logActivity(env, meta, user, action, targetType, targetId, content, isAnonymous) {
  try {
    await env.DB.prepare(
      `INSERT INTO activity_log (user_id, user_email, action, target_type, target_id, content, ip, user_agent, country, city, is_anonymous, created_at)
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
      isAnonymous ? 1 : 0,
      Date.now()
    ).run();
  } catch (e) {
    console.error('activity_log insert failed:', e.message);
  }
}

const PAGE_SIZE = 20;

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const tag = url.searchParams.get('tag') || null;
  const offset = (page - 1) * PAGE_SIZE;

  let sql = `SELECT w.id, w.content, w.tag, w.is_anonymous, w.school, w.created_at, w.likes_count, w.comments_count,
                    CASE WHEN w.is_anonymous = 1 THEN NULL ELSE w.user_id END AS user_id,
                    CASE WHEN w.is_anonymous = 1 THEN NULL ELSE p.nickname END AS nickname
             FROM wall_posts w
             LEFT JOIN profiles p ON w.user_id = p.user_id`;
  let countSql = `SELECT COUNT(*) as total FROM wall_posts w
                     LEFT JOIN profiles p ON w.user_id = p.user_id`;
  const params = [];

  if (tag) {
    sql += ` WHERE tag = ?`;
    countSql += ` WHERE tag = ?`;
    params.push(tag);
  }
  sql += ` ORDER BY w.created_at DESC LIMIT ? OFFSET ?`;

  const { results } = await env.DB.prepare(sql).bind(...params, PAGE_SIZE, offset).all();
  const countRow = await env.DB.prepare(countSql).bind(...params).first();
  const total = countRow?.total || 0;

  return jsonResponse({
    posts: results,
    pagination: { page, pageSize: PAGE_SIZE, total, totalPages: Math.ceil(total / PAGE_SIZE) },
  });
};

export const onRequestPost = async ({ request, env }) => {
  if (!isSameOrigin(request)) {
    return jsonResponse({ error: 'forbidden_origin', message: '非法来源' }, 403);
  }

  const user = await getCurrentUser(request, env);
  const meta = getRequestMeta(request);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body', message: '请求体必须是 JSON' }, 400);
  }

  const { content, tag = '#表白', isAnonymous = true, school = '' } = body || {};
  if (!content || typeof content !== 'string' || content.length > 2000) {
    return jsonResponse({ error: 'invalid_content', message: '内容不能为空且不超过2000字' }, 400);
  }

  const rl = getRateLimitIdentity(request, body && body.visitorToken);
  const ipLimit = await checkRateLimit(env, `wall:post:ip:${rl.ip}`, 10, 60 * 60 * 1000);
  if (!ipLimit.allowed) {
    return jsonResponse({ error: 'rate_limited', message: '发帖太频繁，请稍后再试' }, 429);
  }
  if (user) {
    const userLimit = await checkRateLimit(env, `wall:post:user:${user.id}`, 20, 60 * 60 * 1000);
    if (!userLimit.allowed) {
      return jsonResponse({ error: 'rate_limited', message: '发帖太频繁，请稍后再试' }, 429);
    }
  }

  const now = Date.now();
  const result = await env.DB.prepare(
    `INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, created_at, likes_count, comments_count)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`
  ).bind(
    user ? user.id : null,
    content,
    tag.slice(0, 20),
    isAnonymous ? 1 : 0,
    school.slice(0, 50),
    now
  ).run();

  const postId = result.meta.last_row_id;

  // 写入活动日志
  await logActivity(env, meta, user, 'wall_post', 'wall', postId, content, isAnonymous);

  return jsonResponse({ ok: true, id: postId });
};

export const onRequestPatch = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  // Check admin
  const adminRow = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(user.id).first();
  if (!adminRow || !adminRow.is_admin) return jsonResponse({ error: 'forbidden' }, 403);

  let body;
  try { body = await request.json(); } catch (e) { return jsonResponse({ error: 'invalid_body' }, 400); }
  const { postId, featured } = body || {};
  if (!postId || typeof featured !== 'boolean') return jsonResponse({ error: 'invalid_params' }, 400);

  await env.DB.prepare('UPDATE wall_posts SET is_featured = ? WHERE id = ?').bind(featured ? 1 : 0, postId).run();
  return jsonResponse({ ok: true, postId, is_featured: featured });
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
};