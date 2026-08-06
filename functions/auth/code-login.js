/**
 * POST /auth/code-login
 * 使用6位登录码创建会话（跨浏览器登录）
 */
import { afterLogin } from '../_lib/visitor.js';

function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

export const onRequestPost = async ({ request, env }) => {
  let body;
  try { body = await request.json(); } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const code = (body.code || '').trim();
  if (!code || code.length !== 6) {
    return new Response(JSON.stringify({ error: 'invalid_code', message: '请输入6位登录码' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const row = await env.DB.prepare(
    `SELECT user_id, expires_at, used FROM device_codes WHERE code = ?`
  ).bind(code).first();

  if (!row) return new Response(JSON.stringify({ error: 'invalid_code', message: '登录码无效' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  if (row.used) return new Response(JSON.stringify({ error: 'used', message: '登录码已使用' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  if (Date.now() > row.expires_at) return new Response(JSON.stringify({ error: 'expired', message: '登录码已过期' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

  await env.DB.prepare(`UPDATE device_codes SET used = 1 WHERE code = ?`).bind(code).run();

  const sessionToken = generateToken();
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
  ).bind(sessionToken, row.user_id, expiresAt).run();

  // S-07: 登录后绑定匿名身份 + 补充注册信息 + 更新最近登录信息
  await afterLogin(request, env, row.user_id);

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Set-Cookie': `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`,
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
};
