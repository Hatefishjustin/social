/**
 * Cloudflare Pages Function
 * 路径: /logout
 * 方法: POST/GET
 * 功能: 清除会话
 */

export const onRequest = async ({ request, env }) => {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session=([^;]+)/);
  if (match) {
    await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(match[1]).run();
  }

  const headers = new Headers({
    'Location': '/',
    'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
  });

  return new Response(null, { status: 302, headers });
};
