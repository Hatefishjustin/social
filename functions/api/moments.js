/**
 * Cloudflare Pages Function
 * 路径: /api/moments
 * 方法:
 *   POST   - 发布动态 { content, images[] }
 *   GET    - 获取动态列表 ?userId=xxx&page=1&pageSize=10
 *   DELETE - 删除自己的动态 ?id=xxx
 *   POST /like   - 点赞/取消点赞 { momentId }
 *   POST /comment- 评论 { momentId, content }
 * 功能: 个人主页动态（朋友圈/小红书式图文发布）
 */

import { getCurrentUser } from '../_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// 确保表存在（幂等）
async function ensureTables(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS moments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      content TEXT DEFAULT '',
      images_json TEXT DEFAULT '[]',
      likes_count INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS moment_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      moment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(moment_id, user_id),
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS moment_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      moment_id INTEGER NOT NULL,
      user_id INTEGER,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`
  ).run();
}

// 获取用户昵称/头像（用于展示）
async function getUserInfo(env, userId) {
  const row = await env.DB.prepare(
    `SELECT u.display_name, u.avatar_url, p.nickname
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = ?`
  ).bind(userId).first();
  if (!row) return { name: '用户', avatar: '' };
  return {
    name: row.nickname || row.display_name || '用户',
    avatar: row.avatar_url || '',
  };
}

// 组装单条动态的展示数据
async function buildMoment(env, m, viewerId) {
  let images = [];
  try { images = JSON.parse(m.images_json || '[]'); } catch(e) {}

  // 是否已点赞
  let liked = false;
  if (viewerId) {
    const like = await env.DB.prepare(
      `SELECT id FROM moment_likes WHERE moment_id = ? AND user_id = ?`
    ).bind(m.id, viewerId).first();
    liked = !!like;
  }

  // 评论列表（最多取5条）
  const { results: comments } = await env.DB.prepare(
    `SELECT c.id, c.content, c.created_at, c.user_id,
            u.display_name, u.avatar_url, p.nickname
     FROM moment_comments c
     LEFT JOIN users u ON u.id = c.user_id
     LEFT JOIN profiles p ON p.user_id = c.user_id
     WHERE c.moment_id = ?
     ORDER BY c.created_at ASC LIMIT 5`
  ).bind(m.id).all();

  const owner = await getUserInfo(env, m.user_id);

  return {
    id: m.id,
    userId: m.user_id,
    ownerName: owner.name,
    ownerAvatar: owner.avatar,
    content: m.content || '',
    images: images,
    likesCount: m.likes_count || 0,
    commentsCount: m.comments_count || 0,
    liked: liked,
    comments: (comments || []).map(c => ({
      id: c.id,
      userId: c.user_id,
      name: c.nickname || c.display_name || '用户',
      avatar: c.avatar_url || '',
      content: c.content,
      createdAt: c.created_at,
    })),
    createdAt: m.created_at,
  };
}

// ── 发布动态 ──
export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  let body;
  try { body = await request.json(); } catch(e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const content = String(body.content || '').trim().slice(0, 1000);
  let images = Array.isArray(body.images) ? body.images : [];

  // 校验图片
  if (images.length > 9) {
    return jsonResponse({ error: 'too_many_images', message: '最多上传9张图片' }, 400);
  }
  for (const img of images) {
    if (typeof img !== 'string' || !img.startsWith('data:image/')) {
      return jsonResponse({ error: 'invalid_image', message: '图片格式不正确' }, 400);
    }
    if (img.length > 400000) { // 单张约 300KB base64
      return jsonResponse({ error: 'image_too_large', message: '单张图片过大，请压缩后重试' }, 400);
    }
  }

  if (!content && images.length === 0) {
    return jsonResponse({ error: 'empty', message: '请填写内容或上传图片' }, 400);
  }

  await ensureTables(env);

  const result = await env.DB.prepare(
    `INSERT INTO moments (user_id, content, images_json, likes_count, comments_count, created_at)
     VALUES (?, ?, ?, 0, 0, ?)`
  ).bind(user.id, content, JSON.stringify(images), Date.now()).run();

  return jsonResponse({ ok: true, momentId: result.meta.last_row_id });
};

// ── 获取动态列表 ──
export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  const viewerId = user ? user.id : null;
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(20, Math.max(1, parseInt(url.searchParams.get('pageSize') || '10', 10)));

  await ensureTables(env);

  let where = '';
  let params = [];
  if (userId) {
    where = 'WHERE user_id = ?';
    params.push(userId);
  }

  const offset = (page - 1) * pageSize;
  const { results } = await env.DB.prepare(
    `SELECT * FROM moments ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, offset).all();

  const moments = [];
  for (const m of results) {
    moments.push(await buildMoment(env, m, viewerId));
  }

  // 总数（用于分页）
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM moments ${where}`
  ).bind(...params).first();

  return jsonResponse({
    moments: moments,
    pagination: {
      page: page,
      pageSize: pageSize,
      total: countRow ? countRow.cnt : 0,
    },
  });
};

// ── 删除动态 ──
export const onRequestDelete = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonResponse({ error: 'missing_id' }, 400);

  await ensureTables(env);

  const moment = await env.DB.prepare(
    `SELECT user_id FROM moments WHERE id = ?`
  ).bind(id).first();

  if (!moment) return jsonResponse({ error: 'not_found' }, 404);
  if (moment.user_id !== user.id && !user.isAdmin) {
    return jsonResponse({ error: 'forbidden', message: '只能删除自己的动态' }, 403);
  }

  await env.DB.prepare(`DELETE FROM moments WHERE id = ?`).bind(id).run();

  return jsonResponse({ ok: true });
};

// ── 点赞/取消点赞 ──
export const onRequestPut = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  let body;
  try { body = await request.json(); } catch(e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { momentId, action } = body || {};
  if (!momentId) return jsonResponse({ error: 'missing_momentId' }, 400);

  await ensureTables(env);

  const moment = await env.DB.prepare(
    `SELECT id FROM moments WHERE id = ?`
  ).bind(momentId).first();
  if (!moment) return jsonResponse({ error: 'not_found' }, 404);

  if (action === 'like') {
    // 点赞
    await env.DB.prepare(
      `INSERT OR IGNORE INTO moment_likes (moment_id, user_id, created_at) VALUES (?, ?, ?)`
    ).bind(momentId, user.id, Date.now()).run();
    await env.DB.prepare(
      `UPDATE moments SET likes_count = (SELECT COUNT(*) FROM moment_likes WHERE moment_id = ?) WHERE id = ?`
    ).bind(momentId, momentId).run();
  } else if (action === 'unlike') {
    // 取消点赞
    await env.DB.prepare(
      `DELETE FROM moment_likes WHERE moment_id = ? AND user_id = ?`
    ).bind(momentId, user.id).run();
    await env.DB.prepare(
      `UPDATE moments SET likes_count = (SELECT COUNT(*) FROM moment_likes WHERE moment_id = ?) WHERE id = ?`
    ).bind(momentId, momentId).run();
  } else {
    return jsonResponse({ error: 'invalid_action' }, 400);
  }

  const updated = await env.DB.prepare(
    `SELECT likes_count FROM moments WHERE id = ?`
  ).bind(momentId).first();

  return jsonResponse({ ok: true, likesCount: updated ? updated.likes_count : 0 });
};

// ── 评论 ──
export const onRequestPatch = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  let body;
  try { body = await request.json(); } catch(e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { momentId, content } = body || {};
  if (!momentId) return jsonResponse({ error: 'missing_momentId' }, 400);
  const text = String(content || '').trim();
  if (!text || text.length < 1) return jsonResponse({ error: 'empty_content', message: '评论不能为空' }, 400);
  if (text.length > 300) return jsonResponse({ error: 'too_long', message: '评论最多300字' }, 400);

  await ensureTables(env);

  const moment = await env.DB.prepare(
    `SELECT id FROM moments WHERE id = ?`
  ).bind(momentId).first();
  if (!moment) return jsonResponse({ error: 'not_found' }, 404);

  await env.DB.prepare(
    `INSERT INTO moment_comments (moment_id, user_id, content, created_at) VALUES (?, ?, ?, ?)`
  ).bind(momentId, user.id, text, Date.now()).run();

  await env.DB.prepare(
    `UPDATE moments SET comments_count = (SELECT COUNT(*) FROM moment_comments WHERE moment_id = ?) WHERE id = ?`
  ).bind(momentId, momentId).run();

  return jsonResponse({ ok: true });
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
