/**
 * Cloudflare Pages Function
 * 路径: /functions/wall-comments.js
 * 路由: /wall-comments
 */

import { getCurrentUser } from './_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const postId = parseInt(url.searchParams.get('postId'));
  if (!postId) return jsonResponse({ error: 'missing_postId' }, 400);

  const { results } = await env.DB.prepare(
    `SELECT wc.id, wc.post_id, wc.user_id, wc.content, wc.is_anonymous, wc.created_at
     FROM wall_comments wc WHERE wc.post_id = ? ORDER BY wc.created_at ASC`
  ).bind(postId).all();

  return jsonResponse({ comments: results });
};

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);

  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const postId2 = body.postId;
  const content = body.content;
  const is_anonymous = body.is_anonymous;
  if (!postId2 || !content || typeof content !== 'string' || content.length > 1000) {
    return jsonResponse({ error: 'invalid_params', message: '参数不合法' }, 400);
  }

  const now = Date.now();
  const result = await env.DB.prepare(
    `INSERT INTO wall_comments (post_id, user_id, content, is_anonymous, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(postId2, user ? user.id : null, content, is_anonymous !== false ? 1 : 0, now).run();

  // Update comments_count
  await env.DB.prepare(
    `UPDATE wall_posts SET comments_count = (SELECT COUNT(*) FROM wall_comments WHERE post_id = ?) WHERE id = ?`
  ).bind(postId2, postId2).run();

    // Notify post owner
    const postRow = await env.DB.prepare(`SELECT user_id, content FROM wall_posts WHERE id = ?`).bind(postId2).first();
    if (postRow && postRow.user_id && postRow.user_id !== (user ? user.id : -1)) {
      await env.DB.prepare(
        `INSERT INTO notifications (user_id, type, target_type, target_id, actor_id, actor_email, content_preview, is_read, created_at)
         VALUES (?, 'comment', 'wall', ?, ?, ?, ?, 0, ?)`
      ).bind(postRow.user_id, postId2, user ? user.id : null, user ? user.email : null, (postRow.content || '').slice(0, 100), Date.now()).run();
    }
    return jsonResponse({ ok: true, id: result.meta.last_row_id });
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
};
