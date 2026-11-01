/**
 * Cloudflare Pages Function
 * 路径: /api/view
 * 方法: POST
 * 记录页面访问（兼容迁移前/后状态）
 *
 * S09 升级:
 *   - 接收完整路径 page + referrer + visitorToken
 *   - 后端 UA 解析 device/os/browser
 *   - 迁移后写入新字段；迁移前降级为基础字段
 * 兼容旧调用:
 *   - 旧前端传 { page: 'match' } 简体名 → 映射为 /match.html
 *   - 新 track.js 传 { page: '/tarot.html', referrer, visitorToken }
 */

import { parseCookie } from '../_lib/auth.js';
import { parseUA } from '../_lib/ua.js';
import { hasColumn } from '../_lib/schema.js';
import { checkRateLimit, getRateLimitIdentity, isSameOrigin } from '../_lib/ratelimit.js';

function jsonResponse(body, status = 200, retryAfter = 0) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (retryAfter > 0) headers['Retry-After'] = String(retryAfter);
  return new Response(JSON.stringify(body), { status, headers });
}

// 旧版简名 → 完整路径映射（兼容 match.html / qa.html 旧埋点）
const LEGACY_PAGE_MAP = {
  match: '/match.html',
  qa: '/qa.html',
  index: '/index.html',
  home: '/',
  tarot: '/tarot.html',
  login: '/login.html',
  profile: '/profile.html',
  campus: '/campus.html',
  chat: '/chat.html',
  memory: '/memory.html',
  user: '/user.html',
  admin: '/admin.html',
};

export const onRequestPost = async ({ request, env }) => {
  if (!env || !env.DB) return jsonResponse({ error: 'missing_db' }, 500);
  if (!isSameOrigin(request)) return jsonResponse({ error: 'forbidden_origin' }, 403);

  let body;
  try { body = await request.json(); } catch { body = {}; }

  // 归一化页面路径
  let page = String(body.page || 'unknown').trim().slice(0, 200);
  if (!page.startsWith('/')) {
    page = LEGACY_PAGE_MAP[page] || ('/' + page);
  }
  if (page === '/') page = '/index.html';

  const hasNewCols = await hasColumn(env, 'page_views', 'visitor_token');
  const hasVisitorTokenField = hasNewCols;

  // 兼容迁移前: 使用原有 user_id / is_logged_in
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  let userId = null;
  let isLoggedIn = 0;

  if (sessionToken) {
    try {
      const row = await env.DB.prepare(
        'SELECT user_id, expires_at FROM sessions WHERE token = ?'
      ).bind(sessionToken).first();
      if (row && Date.now() <= row.expires_at) {
        userId = row.user_id;
        isLoggedIn = 1;
      }
    } catch (e) {}
  }

  const ua = (request.headers.get('User-Agent') || '').slice(0, 500);
  const parsed = parseUA(ua);
  const referrer = String(body.referrer || '').slice(0, 300);
  const visitorToken = String(body.visitorToken || body.visitor_token || '').slice(0, 100);

  // 防止刷 PV：IP 120 次/分钟；同一访客同一页面 30 分钟内只记一次
  const rl = getRateLimitIdentity(request, visitorToken);
  const ipLimit = await checkRateLimit(env, `view:ip:${rl.ip}`, 120, 60000);
  if (!ipLimit.allowed) {
    return jsonResponse({ error: 'rate_limited' }, 429, ipLimit.retryAfter);
  }
  const dedupe = await checkRateLimit(env, `view:page:${rl.identity}:${page}`, 1, 1800000);
  if (!dedupe.allowed) {
    return jsonResponse({ success: true, deduped: true });
  }

  try {
    if (hasVisitorTokenField) {
      // 迁移后: 完整字段写入
      await env.DB.prepare(
        `INSERT INTO page_views
           (page, user_id, is_logged_in, visitor_token, referrer, device, os, browser, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(page, userId, isLoggedIn, visitorToken, referrer, parsed.device, parsed.os, parsed.browser, Date.now()).run();
    } else {
      // 迁移前: 基础字段写入（保证不报错）
      await env.DB.prepare(
        'INSERT INTO page_views (page, user_id, is_logged_in, created_at) VALUES (?, ?, ?, ?)'
      ).bind(page, userId, isLoggedIn, Date.now()).run();
    }
  } catch (e) {
    console.error('api/view 写入失败:', e.message);
    return jsonResponse({ error: 'db_error' }, 500);
  }

  return jsonResponse({ success: true });
};