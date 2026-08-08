/**
 * Cloudflare Pages Function
 * 路径: /api/event
 * 方法: POST
 * S09 统一行为上报接口（用户活动中心）
 * 兼容迁移前/后状态（S09 未执行时基础字段写入，不报错）
 *
 * 修复: 2026-08-08 Phase 6-4 线上 405
 *   原路径 functions/event.js → 路由为 /event，与 track.js 调用的 /api/event 不匹配。
 *   移动至 functions/api/event.js → 路由匹配 /api/event。
 */
import { getCurrentUser } from '../_lib/auth.js';
import { getRequestMeta } from '../_lib/ip.js';
import { parseUA } from '../_lib/ua.js';
import { getVisitorId } from '../_lib/visitor.js';
import { hasColumn } from '../_lib/schema.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

const ALLOWED_ACTIONS = new Set([
  'page_view', 'register', 'login', 'profile_created',
  'quiz_start', 'quiz_completed', 'quiz_view_result',
  'askbox_view', 'askbox_view_answer', 'askbox_question', 'askbox_answer', 'askbox_reply',
  'tarot_start', 'tarot_analyze', 'tarot_history_view',
  'match_view', 'chat_start',
  'favorite_add', 'favorite_remove', 'share',
  'wall_post', 'wall_like', 'moment_post', 'moment_like', 'profile_view',
  'memory_import', 'contact_request', 'daily_question_answer',
  'other',
]);

export const onRequestPost = async ({ request, env }) => {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body', message: '请求体必须是 JSON' }, 400);
  }

  const action = String(body?.action || '').trim().slice(0, 50);
  if (!action) return jsonResponse({ error: 'invalid_action', message: '缺少 action 参数' }, 400);
  const safeAction = ALLOWED_ACTIONS.has(action) ? action : 'other';
  const page = String(body?.page || '').trim().slice(0, 200);
  const targetType = String(body?.target_type || body?.targetType || '').trim().slice(0, 30);
  const targetId = body?.target_id !== undefined && body?.target_id !== null ? String(body.target_id).slice(0, 50) : null;
  const detail = String(body?.detail || '').trim().slice(0, 500);

  const meta = getRequestMeta(request);
  const parsedUA = parseUA(meta.ua);

  let user = null;
  try { user = await getCurrentUser(request, env); } catch (e) { user = null; }
  const visitorId = getVisitorId(request);

  if (!env || !env.DB) return jsonResponse({ ok: false, error: 'missing_db', message: '数据库未配置' }, 500);

  const hasNewColumns = await hasColumn(env, 'activity_log', 'device');
  const now = Date.now();

  try {
    if (hasNewColumns) {
      await env.DB.prepare(
        `INSERT INTO activity_log
           (user_id, user_email, action, target_type, target_id, content,
            ip, user_agent, country, city, is_anonymous, visitor_id,
            device, os, browser, referrer, page_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        user ? user.id : null, user ? user.email : null,
        safeAction, targetType || null, targetId || null, detail,
        meta.ip, meta.ua, meta.country, meta.city, user ? 0 : 1, visitorId || null,
        parsedUA.device, parsedUA.os, parsedUA.browser,
        String(body?.referrer || '').slice(0, 300), page || null, now
      ).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO activity_log
           (user_id, user_email, action, target_type, target_id, content,
            ip, user_agent, country, city, is_anonymous, visitor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        user ? user.id : null, user ? user.email : null,
        safeAction, targetType || null, targetId || null, detail,
        meta.ip, meta.ua, meta.country, meta.city, user ? 0 : 1, visitorId || null, now
      ).run();
    }
  } catch (e) {
    console.error('api/event 写入 activity_log 失败:', e.message);
    return jsonResponse({ ok: false, error: 'db_error', message: '行为记录失败' }, 500);
  }

  return jsonResponse({ ok: true });
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
};