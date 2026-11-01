/**
 * Shared authentication helper
 * Returns { id, email, displayName, avatarUrl, isAdmin } or null
 */

export function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

/**
 * 计算 User-Agent 的 SHA-256 摘要，用于 IP 信任自动登录的设备指纹绑定。
 */
export async function hashUserAgent(ua) {
  const data = new TextEncoder().encode(String(ua || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export async function getCurrentUser(request, env) {
  if (!env.DB) return null;
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) return null;
  const row = await env.DB.prepare(
    `SELECT sessions.expires_at as expires_at, users.id as user_id, users.email as user_email,
            users.display_name as display_name, users.avatar_url as avatar_url, users.is_admin as is_admin
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return {
    id: row.user_id,
    email: row.user_email,
    displayName: row.display_name || '',
    avatarUrl: row.avatar_url || '',
    isAdmin: !!row.is_admin,
  };
}
