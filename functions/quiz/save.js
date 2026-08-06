/**
 * Cloudflare Pages Function
 * 路径: /quiz/save
 * 方法: POST
 */
import { getRequestMeta } from '../_lib/ip.js';
import { parseUA } from '../_lib/ua.js';

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
    `SELECT sessions.expires_at as expires_at, users.id as user_id, users.email as email
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { id: row.user_id, email: row.email };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { headline, scores, answers } = body || {};
  if (!headline || !scores) {
    return jsonResponse({ error: 'invalid_body', message: '缺少 headline 或 scores' }, 400);
  }

  const meta = getRequestMeta(request);
  const parsedUA = parseUA(meta.ua);

  const result = await env.DB.prepare(
    `INSERT INTO quiz_results (user_id, created_at, headline, scores_json, answers_json, ip, user_agent, country, city, device, os, browser)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, Date.now(), headline.slice(0, 100), JSON.stringify(scores), JSON.stringify(answers || {}),
    meta.ip, meta.ua, meta.country, meta.city, parsedUA.device, parsedUA.os, parsedUA.browser
  ).run();

  return jsonResponse({ ok: true, id: result.meta.last_row_id });
};
