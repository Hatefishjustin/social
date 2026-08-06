/**
 * Cloudflare Pages Function
 * 路径: /api/admin/quiz-readings-local
 * 方法: GET
 * 用途: SoulMirror 社交站心理测评记录列表（后台）
 * 数据源: env.DB 数据库的 quiz_results 表
 * 提供: 分页、时间筛选、用户筛选、详情标记（scores/answers 是否有值）
 * 仅管理员可访问
 *
 * 参数:
 *   page      - 页码，默认 1
 *   pageSize  - 每页条数，默认 20，最大 100
 *   days      - 时间范围（最近 N 天），可选，默认全部
 *   userId    - 按用户 ID 筛选，可选
 */

import { getCurrentUser } from '../../_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);
  }
  if (!user.isAdmin) {
    return jsonResponse({ error: 'forbidden', message: '需要管理员权限' }, 403);
  }

  const url = new URL(request.url);
  const idParam = url.searchParams.get('id');

  // 单条详情模式：/api/admin/quiz-readings-local?id=X
  if (idParam) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return jsonResponse({ error: 'invalid_id', message: '无效的记录 ID' }, 400);
    }

    const row = await env.DB.prepare(
      `SELECT r.id, r.user_id, r.created_at, r.headline, r.scores_json, r.answers_json,
              r.ip, r.user_agent, r.country, r.city, r.device, r.os, r.browser,
              u.email as user_email, u.display_name as user_display_name
       FROM quiz_results r
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.id = ?`
    ).bind(id).first();

    if (!row) {
      return jsonResponse({ error: 'not_found', message: '记录不存在' }, 404);
    }

    let scores = {};
    let answers = {};
    try { scores = JSON.parse(row.scores_json || '{}'); } catch (e) {}
    try { answers = JSON.parse(row.answers_json || '{}'); } catch (e) {}

    return jsonResponse({
      source: 'soulmirror',
      detail: {
        id: row.id,
        userId: row.user_id,
        userEmail: row.user_email || '',
        userDisplayName: row.user_display_name || '',
        headline: row.headline || '',
        createdAt: row.created_at,
        ip: row.ip || '',
        country: row.country || '',
        city: row.city || '',
        device: row.device || '',
        os: row.os || '',
        browser: row.browser || '',
        userAgent: row.user_agent || '',
        scores,
        answers,
      },
    });
  }

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(url.searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
  );
  const days = parseInt(url.searchParams.get('days') || '', 10);
  const userId = parseInt(url.searchParams.get('userId') || '', 10);
  const offset = (page - 1) * pageSize;

  const where = [];
  const params = [];

  if (!isNaN(days) && days > 0) {
    where.push('created_at >= ?');
    params.push(Date.now() - days * 24 * 60 * 60 * 1000);
  }
  if (!isNaN(userId) && userId > 0) {
    where.push('user_id = ?');
    params.push(userId);
  }

  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  try {
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) as total FROM quiz_results${whereSql}`
    ).bind(...params).first();

    const { results } = await env.DB.prepare(
      `SELECT r.id, r.user_id, r.created_at, r.headline,
              (r.scores_json IS NOT NULL) as has_scores,
              (r.answers_json IS NOT NULL) as has_answers,
              u.email as user_email, u.display_name as user_display_name
       FROM quiz_results r
       LEFT JOIN users u ON r.user_id = u.id
       ${whereSql}
       ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
    ).bind(...params, pageSize, offset).all();

    const total = countRow?.total || 0;

    return jsonResponse({
      source: 'soulmirror',
      records: (results || []).map(r => ({
        id: r.id,
        userId: r.user_id,
        userEmail: r.user_email || '',
        userDisplayName: r.user_display_name || '',
        headline: r.headline || '',
        createdAt: r.created_at,
        hasScores: !!r.has_scores,
        hasAnswers: !!r.has_answers,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    return jsonResponse({
      error: 'query_failed',
      message: '查询失败：' + String(err?.message || err),
    }, 500);
  }
};