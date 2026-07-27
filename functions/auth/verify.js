/**
 * Cloudflare Pages Function
 * 路径: /auth/verify
 * 方法: GET
 * 功能: 验证魔法链接，创建会话
 */

function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response('无效的登录链接', { status: 400 });
  }

  const tokenRow = await env.DB.prepare(
    `SELECT email, expires_at, used FROM login_tokens WHERE token = ?`
  ).bind(token).first();

  if (!tokenRow) {
    return new Response('登录链接无效或已过期', { status: 400 });
  }

  if (tokenRow.used) {
    return new Response('此链接已被使用', { status: 400 });
  }

  if (Date.now() > tokenRow.expires_at) {
    return new Response('登录链接已过期', { status: 400 });
  }

  const email = tokenRow.email;

  await env.DB.prepare(
    `UPDATE login_tokens SET used = 1 WHERE token = ?`
  ).bind(token).run();

  let user = await env.DB.prepare(
    `SELECT id FROM users WHERE email = ?`
  ).bind(email).first();

  if (!user) {
    const result = await env.DB.prepare(
      `INSERT INTO users (email, created_at) VALUES (?, ?)`
    ).bind(email, Date.now()).run();
    user = { id: result.meta.last_row_id };
  }

  const sessionToken = generateToken();
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
  ).bind(sessionToken, user.id, expiresAt).run();

  const headers = new Headers({
    'Location': '/',
    'Set-Cookie': `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`,
  });

  return new Response(null, { status: 302, headers });
};
