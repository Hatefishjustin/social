/**
 * Cloudflare Pages Function
 * 路径: /session
 * 方法: GET
 * 功能: 获取当前登录用户信息
 */

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestGet = async ({ request, env }) => {
  if (!env.DB) return jsonResponse({ loggedIn: false });

  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) return jsonResponse({ loggedIn: false });

  const row = await env.DB.prepare(
    `SELECT sessions.expires_at, users.id as user_id, users.email
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();

  if (!row || Date.now() > row.expires_at) {
    return jsonResponse({ loggedIn: false });
  }

  const staff = await env.DB.prepare(
    'SELECT role FROM staff_accounts WHERE user_id = ?'
  ).bind(row.user_id).first();

  return jsonResponse({
    loggedIn: true,
    userId: row.user_id,
    email: row.email,
    isStaff: !!staff,
    staffRole: staff ? staff.role : null,
  });
};
