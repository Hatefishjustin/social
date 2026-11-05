/**
 * Cloudflare Pages Function
 * 路径: /api/quizzes
 *
 * GET: 公开测评目录
 *   - 不带参数：返回全部已发布测评（不含题目）
 *   - ?slug=attachment：返回单个已发布测评（含题目）
 *
 * 设计原则：
 *   - 轮盘卡片数量完全由 D1 的 quizzes 表决定，前端不写死。
 *   - 没有已发布记录时返回空数组，前端显示空状态。
 */

import { checkRateLimit, getRateLimitIdentity } from '../_lib/ratelimit.js';

const PUBLIC_COLUMNS = `id, slug, title, category, subtitle, description,
  question_count, duration_minutes, participant_count, points_json,
  entry_url, icon, tint, badge, badge_class, sort_order, created_at, updated_at`;

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=30, must-revalidate',
      ...headers,
    },
  });
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

function mapQuiz(row, withQuestions) {
  const item = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    subtitle: row.subtitle,
    description: row.description,
    questionCount: row.question_count,
    durationMinutes: row.duration_minutes,
    participantCount: row.participant_count,
    points: parseJson(row.points_json, []),
    entryUrl: row.entry_url || '',
    icon: row.icon,
    tint: row.tint,
    badge: row.badge,
    badgeClass: row.badge_class,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (withQuestions) {
    item.questions = parseJson(row.questions_json, []);
  }
  return item;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) {
    return jsonResponse({ error: 'missing_db', message: '数据库未配置' }, 500);
  }

  const { ip } = getRateLimitIdentity(request);
  const limit = await checkRateLimit(env, 'quiz:list:ip:' + ip, 120, 60 * 1000);
  if (!limit.allowed) {
    return jsonResponse(
      { error: 'rate_limited', message: '请求太频繁，请稍后再试' },
      429,
      { 'Retry-After': String(limit.retryAfter) }
    );
  }

  const url = new URL(request.url);
  const slug = String(url.searchParams.get('slug') || '').trim();

  try {
    if (slug) {
      const row = await env.DB.prepare(
        `SELECT ${PUBLIC_COLUMNS}, questions_json FROM quizzes
         WHERE slug = ? AND status = 'published' LIMIT 1`
      ).bind(slug).first();

      if (!row) {
        return jsonResponse({ error: 'not_found', message: '测评不存在或未发布' }, 404);
      }
      return jsonResponse({ item: mapQuiz(row, true) });
    }

    const result = await env.DB.prepare(
      `SELECT ${PUBLIC_COLUMNS} FROM quizzes
       WHERE status = 'published'
       ORDER BY sort_order ASC, id ASC`
    ).all();

    const items = (result.results || []).map((row) => mapQuiz(row, false));
    return jsonResponse({ items, total: items.length });
  } catch (e) {
    console.error('GET /api/quizzes failed:', e.message);
    return jsonResponse({ error: 'server_error', message: '测评目录读取失败' }, 500);
  }
}
