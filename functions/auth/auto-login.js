/**
 * Cloudflare Pages Function
 * 路径: /auth/auto-login
 * GET - 检查当前IP是否有信任记录，有则自动创建session
 */
import { afterLogin } from '../_lib/visitor.js';

function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestGet = async ({ request, env }) => {
  if (!env.DB) return jsonResponse({ ok: false, message: 'no db' });

  const clientIP = request.headers.get('CF-Connecting-IP') || '';
  if (!clientIP) return jsonResponse({ ok: false, message: 'no ip' });

  const now = Date.now();

  // Find unexpired trust entry for this IP
  const trust = await env.DB.prepare(
    `SELECT user_id FROM ip_trust WHERE ip = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1`
  ).bind(clientIP, now).first();

  if (!trust) return jsonResponse({ ok: false, message: 'no_trust' });

  // Create session
  const sessionToken = generateToken();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000;

  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
  ).bind(sessionToken, trust.user_id, expiresAt).run();

  // Invalidate used trust entries for this IP
  await env.DB.prepare(
    `DELETE FROM ip_trust WHERE ip = ?`
  ).bind(clientIP).run();

  // S-07: 登录后绑定匿名身份 + 补充注册信息 + 更新最近登录信息
  await afterLogin(request, env, trust.user_id);

  // Get user info
  const user = await env.DB.prepare(
    `SELECT id, email, display_name, avatar_url FROM users WHERE id = ?`
  ).bind(trust.user_id).first();

  const headers = new Headers({
    'Set-Cookie': `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`,
  });

  return new Response(JSON.stringify({
    ok: true,
    user: user ? {
      userId: user.id,
      email: user.email,
      displayName: user.display_name || '',
      avatarUrl: user.avatar_url || '',
    } : null,
  }), { status: 200, headers });
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
  });
};
