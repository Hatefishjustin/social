/**
 * Cloudflare Pages Function
 * 路径: /profile
 * 方法: GET - 获取个人信息  PUT - 更新昵称/头像
 */

import { getCurrentUser } from '../_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);
  return jsonResponse({
    displayName: user.displayName || '',
    avatarUrl: user.avatarUrl || '',
  });
};

export const onRequestPut = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { displayName, avatarUrl } = body || {};
  const updates = [];
  const params = [];

  if (displayName !== undefined) {
    const name = String(displayName).trim().slice(0, 30);
    updates.push('display_name = ?');
    params.push(name);
  }
  if (avatarUrl !== undefined) {
    const url = String(avatarUrl).trim().slice(0, 1000);
    updates.push('avatar_url = ?');
    params.push(url);
  }

  if (updates.length === 0) {
    return jsonResponse({ error: 'no_fields' }, 400);
  }

  params.push(user.id);
  await env.DB.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  return jsonResponse({ ok: true });
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
  });
};
