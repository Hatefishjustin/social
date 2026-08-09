/**
 * Cloudflare Pages Function
 * 路径: /records
 * 方法: GET / POST
 *
 * 心理测评"我的历程"接口：
 * - GET /records            → 返回当前用户的测评记录列表 { records: [{ id, headline, createdAt }] }
 * - GET /records?id=X       → 返回单条记录详情 { data: { scores, answers } }
 * - POST /records           → 保存一条测评记录 { headline, data: { scores, answers }, visitorToken? }
 *
 * 数据存储于 quiz_results 表（id, user_id, created_at, headline, scores_json, answers_json）。
 *
 * 匿名支持（S11 需求1）:
 * - 未登录用户也可保存测评，user_id 写入 NULL，visitor_token 记录匿名访客标识，
 *   供后台「心理测评」板块展示与追踪同一匿名用户行为。
 * - 依赖迁移 docs/migrations/2026-08-10-S11-quiz-anonymous.sql；
 *   迁移未执行时（无 visitor_token 列）保持旧的"仅登录用户可保存"行为，不报错。
 */
import { getCurrentUser } from './_lib/auth.js';
import { getRequestMeta } from './_lib/ip.js';
import { parseUA } from './_lib/ua.js';
import { hasColumn } from './_lib/schema.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// 保存测评记录（POST）
export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ message: '请求格式错误' }, 400);
  }

  const headline = (body && body.headline) ? String(body.headline).trim() : '';
  // 兼容两种提交格式：{ headline, data: { scores, answers } } 或 { headline, scores, answers }
  const data = (body && body.data) || body || {};
  const scores = data.scores;
  const answers = data.answers || {};

  if (!headline || !scores) {
    return jsonResponse({ message: '缺少 headline 或 scores' }, 400);
  }

  const meta = getRequestMeta(request);
  const parsedUA = parseUA(meta.ua);

  // S11: 匿名访客标识（前端通过 window.SMTrack.getVisitorToken() 获取）
  const visitorToken = String(body.visitorToken || body.visitor_token || '').slice(0, 100);

  // 匿名用户保存：需要 S11 迁移已执行（quiz_results 含 visitor_token 列且 user_id 可空）
  if (!user) {
    const hasVisitorCol = await hasColumn(env, 'quiz_results', 'visitor_token');
    if (!hasVisitorCol) {
      return jsonResponse({ message: '请先登录' }, 401);
    }
  }

  const now = Date.now();
  const userId = user ? user.id : null;

  let result;
  if (user) {
    // 登录用户：始终写入 user_id；visitor_token 列存在时一并记录（双保险）
    const hasVisitorCol = await hasColumn(env, 'quiz_results', 'visitor_token');
    if (hasVisitorCol) {
      result = await env.DB.prepare(
        `INSERT INTO quiz_results (user_id, visitor_token, created_at, headline, scores_json, answers_json, ip, user_agent, country, city, device, os, browser)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        userId,
        visitorToken,
        now,
        headline.slice(0, 100),
        JSON.stringify(scores),
        JSON.stringify(answers),
        meta.ip,
        meta.ua,
        meta.country,
        meta.city,
        parsedUA.device,
        parsedUA.os,
        parsedUA.browser
      ).run();
    } else {
      result = await env.DB.prepare(
        `INSERT INTO quiz_results (user_id, created_at, headline, scores_json, answers_json, ip, user_agent, country, city, device, os, browser)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        userId,
        now,
        headline.slice(0, 100),
        JSON.stringify(scores),
        JSON.stringify(answers),
        meta.ip,
        meta.ua,
        meta.country,
        meta.city,
        parsedUA.device,
        parsedUA.os,
        parsedUA.browser
      ).run();
    }
  } else {
    // 匿名用户：user_id = NULL，visitor_token 标识匿名身份（S11 迁移后）
    result = await env.DB.prepare(
      `INSERT INTO quiz_results (user_id, visitor_token, created_at, headline, scores_json, answers_json, ip, user_agent, country, city, device, os, browser)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      null,
      visitorToken,
      now,
      headline.slice(0, 100),
      JSON.stringify(scores),
      JSON.stringify(answers),
      meta.ip,
      meta.ua,
      meta.country,
      meta.city,
      parsedUA.device,
      parsedUA.os,
      parsedUA.browser
    ).run();
  }

  return jsonResponse({ ok: true, id: result.meta.last_row_id, anonymous: !user });
};

// 查询测评记录（GET）
export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ message: '请先登录' }, 401);

  const url = new URL(request.url);
  const idParam = url.searchParams.get('id');

  // 单条详情：/records?id=X
  if (idParam) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return jsonResponse({ message: '无效的记录 ID' }, 400);
    }
    const row = await env.DB.prepare(
      `SELECT id, user_id, scores_json, answers_json
       FROM quiz_results WHERE id = ? AND user_id = ?`
    ).bind(id, user.id).first();

    if (!row) return jsonResponse({ message: '记录不存在' }, 404);

    let scores = {};
    let answers = {};
    try { scores = JSON.parse(row.scores_json); } catch (e) {}
    try { answers = JSON.parse(row.answers_json || '{}'); } catch (e) {}

    return jsonResponse({ data: { scores, answers } });
  }

  // 记录列表：/records
  const rows = await env.DB.prepare(
    `SELECT id, created_at, headline
     FROM quiz_results WHERE user_id = ?
     ORDER BY created_at DESC LIMIT 50`
  ).bind(user.id).all();

  const records = (rows.results || []).map(r => ({
    id: r.id,
    headline: r.headline,
    createdAt: r.created_at,
  }));

  return jsonResponse({ records });
};
