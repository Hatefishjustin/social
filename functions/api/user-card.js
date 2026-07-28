/**
 * Cloudflare Pages Function
 * 路径: /functions/api/user-card.js
 * 路由: /api/user-card?userId=xxx
 * 功能: 获取用户公开卡片信息（昵称+头像），供访客页面使用
 */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return json({ error: 'missing_param' }, 400);

  try {
    const user = await env.DB.prepare(
      'SELECT display_name, avatar_url FROM users WHERE id = ?'
    ).bind(userId).first();

    if (!user) return json({ error: 'not_found' }, 404);

    return json({
      displayName: user.display_name || '',
      avatarUrl: user.avatar_url || '',
    });
  } catch (e) {
    return json({ error: 'db_error', message: e.message }, 500);
  }
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
