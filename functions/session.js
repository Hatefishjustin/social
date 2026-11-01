/**
 * Cloudflare Pages Function
 * 路径: /session
 * 方法: GET
 * 功能: 获取当前登录用户信息（含昵称+头像+管理员）
 */
import { getCurrentUser } from './_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const onRequestGet = async ({ request, env }) => {
  if (!env.DB) return jsonResponse({ loggedIn: false });

  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ loggedIn: false });

  const staff = await env.DB.prepare(
    'SELECT role FROM staff_accounts WHERE user_id = ?'
  ).bind(user.id).first();

  return jsonResponse({
    loggedIn: true,
    userId: user.id,
    email: user.email,
    displayName: user.displayName || '',
    avatarUrl: user.avatarUrl || '',
    isAdmin: !!user.isAdmin,
    isStaff: !!staff,
    staffRole: staff ? staff.role : null,
  });
};
