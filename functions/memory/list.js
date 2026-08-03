/**
 * Cloudflare Pages Function
 * 路径: /functions/memory/list.js
 * 路由: /memory/list
 * 方法: GET
 * 功能: 读取当前登录用户已导入的「匿名记忆」
 *       - 查询 content_imports（导入批次，按时间倒序）
 *       - 每个批次附带其 imported_questions（问答明细）
 *       - 仅返回当前登录用户自己的数据（隐私隔离）
 * 说明: 供 user.html「我的记忆」模块展示，配合 /memory/import 的 confirm 写库闭环。
 */

import { getCurrentUser } from '../_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// GET：返回当前用户已导入的记忆列表
export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  // 1. 查询当前用户的导入批次（按时间倒序）
  const imports = await env.DB.prepare(
    `SELECT id, platform, source_url, source_id, title, avatar, total_count, status, created_at
     FROM content_imports
     WHERE user_id = ?
     ORDER BY created_at DESC`
  ).bind(user.id).all();

  const rows = imports.results || [];

  // 2. 无导入记录 → 返回空列表
  if (rows.length === 0) {
    return jsonResponse({ ok: true, imports: [] });
  }

  // 3. 批量查询每个批次的问答明细
  const result = [];
  for (const row of rows) {
    const qs = await env.DB.prepare(
      `SELECT id, source_question_id, question, answer, source_created_at, created_at
       FROM imported_questions
       WHERE import_id = ?
       ORDER BY created_at ASC`
    ).bind(row.id).all();

    result.push({
      id: row.id,
      platform: row.platform || '',
      sourceUrl: row.source_url || '',
      sourceId: row.source_id || '',
      title: row.title || '',
      avatar: row.avatar || '',
      totalCount: row.total_count || 0,
      status: row.status || '',
      createdAt: row.created_at || null,
      questions: (qs.results || []).map((q) => ({
        id: q.id,
        sourceQuestionId: q.source_question_id || '',
        question: q.question || '',
        answer: q.answer || '',
        sourceCreatedAt: q.source_created_at || null,
        createdAt: q.created_at || null,
      })),
    });
  }

  return jsonResponse({ ok: true, imports: result });
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
