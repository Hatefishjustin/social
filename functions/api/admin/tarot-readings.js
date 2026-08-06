/**
 * Cloudflare Pages Function
 * 路径: /api/admin/tarot-readings
 * 方法: GET
 * 用途: 塔罗抽牌记录列表（后台）
 * 提供: 分页、时间筛选、最近记录、详情
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
      `SELECT COUNT(*) as total FROM tarot_readings${whereSql}`
    ).bind(...params).first();

    const { results } = await env.DB.prepare(
      `SELECT r.id, r.user_id, r.created_at, r.spread_type, r.question, r.cards_json,
              r.headline, r.linked_quiz_id, r.ip, r.user_agent, r.country, r.city,
              u.email as user_email, u.display_name as user_display_name
       FROM tarot_readings r
       LEFT JOIN users u ON r.user_id = u.id
       ${whereSql}
       ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
    ).bind(...params, pageSize, offset).all();

    const total = countRow?.total || 0;

    return jsonResponse({
      readings: (results || []).map(r => ({
        id: r.id,
        userId: r.user_id,
        userEmail: r.user_email || '',
        userDisplayName: r.user_display_name || '',
        createdAt: r.created_at,
        spreadType: r.spread_type,
        question: r.question || '',
        headline: r.headline || '',
        linkedQuizId: r.linked_quiz_id,
        ip: r.ip || '',
        country: r.country || '',
        city: r.city || '',
        userAgent: r.user_agent || '',
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