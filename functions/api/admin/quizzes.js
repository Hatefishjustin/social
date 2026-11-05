/**
 * Cloudflare Pages Function
 * 路径: /api/admin/quizzes
 *
 * 管理员测评目录管理接口。所有方法都需要 is_admin。
 *
 * GET    /api/admin/quizzes                 列出全部（含草稿/归档）
 * GET    /api/admin/quizzes?id=1            单条详情（含题目）
 * GET    /api/admin/quizzes?slug=attachment 单条详情（含题目）
 * POST   /api/admin/quizzes                 新建；body.items 可批量
 * PUT    /api/admin/quizzes?id=1            更新
 * DELETE /api/admin/quizzes?id=1            软删除（status='archived'）
 *
 * 说明：
 *   - slug 是稳定标识，发布后不建议修改。
 *   - questions 为任意 JSON 数组，由答题器解释；服务端只做大小与结构校验。
 *   - 批量写入时 body.upsert=true 可按 slug 覆盖已有记录。
 */

import { getCurrentUser } from '../../_lib/auth.js';

const STATUSES = new Set(['draft', 'published', 'archived']);
const MAX_QUESTIONS_BYTES = 200000;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function text(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function integer(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

function normalizePoints(value) {
  return parseArray(value)
    .map((item) => text(item, 120))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeQuestions(value) {
  const questions = parseArray(value).slice(0, 300);
  try {
    if (JSON.stringify(questions).length > MAX_QUESTIONS_BYTES) return null;
  } catch (e) {
    return null;
  }
  return questions;
}

function normalizePayload(body) {
  const slug = text(body.slug, 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) {
    return { error: 'invalid_slug', message: 'slug 只能包含小写字母、数字和连字符，长度 2–64' };
  }

  const title = text(body.title, 80);
  if (!title) return { error: 'invalid_title', message: '标题不能为空' };

  const category = text(body.category, 20) || '测评';
  const status = STATUSES.has(body.status) ? body.status : 'draft';
  const questions = normalizeQuestions(body.questions);
  const entryUrl = text(body.entryUrl || body.entry_url, 300);

  if (entryUrl && (entryUrl.charAt(0) !== '/' || entryUrl.indexOf('//') === 0 || /[\s"'<>\\]/.test(entryUrl))) {
    return { error: 'invalid_entry_url', message: 'entryUrl 必须是站内路径，例如 /quiz.html?slug=xxx' };
  }

  if (questions === null) {
    return { error: 'questions_too_large', message: '题目数据超过 200KB' };
  }

  return {
    payload: {
      slug,
      title,
      category,
      subtitle: text(body.subtitle, 120),
      description: text(body.description, 500),
      questionCount: integer(body.questionCount, 0, 10000, 0),
      durationMinutes: integer(body.durationMinutes, 0, 600, 0),
      participantCount: integer(body.participantCount, 0, 100000000, 0),
      points: normalizePoints(body.points),
      questions,
      entryUrl,
      icon: text(body.icon, 30) || 'spark',
      tint: text(body.tint, 80),
      badge: text(body.badge, 20),
      badgeClass: text(body.badgeClass, 20),
      status,
      sortOrder: integer(body.sortOrder, -100000, 100000, 0),
    },
  };
}

async function requireAdmin(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user || !user.isAdmin) return null;
  return user;
}

function mapRow(row, withQuestions) {
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
    points: parseArray(row.points_json),
    entryUrl: row.entry_url || '',
    icon: row.icon,
    tint: row.tint,
    badge: row.badge,
    badgeClass: row.badge_class,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (withQuestions) item.questions = parseArray(row.questions_json);
  return item;
}

async function insertQuiz(db, p, upsert) {
  const now = Date.now();
  const sql = `INSERT INTO quizzes
    (slug, title, category, subtitle, description, question_count, duration_minutes,
     participant_count, points_json, questions_json, entry_url, icon, tint, badge, badge_class,
     status, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ${upsert ? `ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      category = excluded.category,
      subtitle = excluded.subtitle,
      description = excluded.description,
      question_count = excluded.question_count,
      duration_minutes = excluded.duration_minutes,
      participant_count = excluded.participant_count,
      points_json = excluded.points_json,
      questions_json = excluded.questions_json,
      entry_url = excluded.entry_url,
      icon = excluded.icon,
      tint = excluded.tint,
      badge = excluded.badge,
      badge_class = excluded.badge_class,
      status = excluded.status,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at` : ''}`;

  return db.prepare(sql).bind(
    p.slug, p.title, p.category, p.subtitle, p.description,
    p.questionCount, p.durationMinutes, p.participantCount,
    JSON.stringify(p.points), JSON.stringify(p.questions), p.entryUrl,
    p.icon, p.tint, p.badge, p.badgeClass,
    p.status, p.sortOrder, now, now
  ).run();
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);
  const admin = await requireAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'forbidden' }, 403);

  const url = new URL(request.url);
  const idParam = url.searchParams.get('id');
  const slug = text(url.searchParams.get('slug'), 64);

  try {
    if (idParam) {
      const id = Number(idParam);
      if (!Number.isInteger(id) || id <= 0) {
        return jsonResponse({ error: 'invalid_id' }, 400);
      }
      const row = await env.DB.prepare('SELECT * FROM quizzes WHERE id = ?').bind(id).first();
      if (!row) return jsonResponse({ error: 'not_found' }, 404);
      return jsonResponse({ item: mapRow(row, true) });
    }

    if (slug) {
      const row = await env.DB.prepare('SELECT * FROM quizzes WHERE slug = ?').bind(slug).first();
      if (!row) return jsonResponse({ error: 'not_found' }, 404);
      return jsonResponse({ item: mapRow(row, true) });
    }

    const status = text(url.searchParams.get('status'), 20);
    const where = STATUSES.has(status) ? 'WHERE status = ?' : '';
    const stmt = env.DB.prepare(
      `SELECT * FROM quizzes ${where} ORDER BY sort_order ASC, id ASC LIMIT 500`
    );
    const result = status && STATUSES.has(status)
      ? await stmt.bind(status).all()
      : await stmt.all();

    const items = (result.results || []).map((row) => mapRow(row, false));
    return jsonResponse({ items, total: items.length });
  } catch (e) {
    console.error('GET /api/admin/quizzes failed:', e.message);
    return jsonResponse({ error: 'server_error' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);
  const admin = await requireAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'forbidden' }, 403);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const upsert = body.upsert === true;

  if (Array.isArray(body.items)) {
    if (body.items.length === 0) return jsonResponse({ error: 'empty_items' }, 400);
    if (body.items.length > 100) {
      return jsonResponse({ error: 'too_many_items', message: '单次最多 100 条' }, 400);
    }

    const created = [];
    const errors = [];
    for (let i = 0; i < body.items.length; i += 1) {
      const normalized = normalizePayload(body.items[i] || {});
      if (normalized.error) {
        errors.push({ index: i, error: normalized.error, message: normalized.message });
        continue;
      }
      try {
        const result = await insertQuiz(env.DB, normalized.payload, upsert);
        created.push({ index: i, slug: normalized.payload.slug, id: result.meta ? result.meta.last_row_id : null });
      } catch (e) {
        errors.push({ index: i, slug: normalized.payload.slug, error: 'db_error', message: e.message });
      }
    }
    return jsonResponse({ ok: errors.length === 0, created, errors }, errors.length ? 207 : 200);
  }

  const normalized = normalizePayload(body);
  if (normalized.error) {
    return jsonResponse({ error: normalized.error, message: normalized.message }, 400);
  }

  try {
    const result = await insertQuiz(env.DB, normalized.payload, upsert);
    return jsonResponse({
      ok: true,
      item: { id: result.meta ? result.meta.last_row_id : null, ...normalized.payload },
    }, 201);
  } catch (e) {
    if (String(e.message || '').toLowerCase().includes('unique')) {
      return jsonResponse({ error: 'slug_exists', message: 'slug 已存在；如需覆盖请传 upsert=true' }, 409);
    }
    console.error('POST /api/admin/quizzes failed:', e.message);
    return jsonResponse({ error: 'server_error', message: e.message }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);
  const admin = await requireAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'forbidden' }, 403);

  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return jsonResponse({ error: 'invalid_id' }, 400);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const normalized = normalizePayload(body);
  if (normalized.error) {
    return jsonResponse({ error: normalized.error, message: normalized.message }, 400);
  }

  const p = normalized.payload;
  try {
    const result = await env.DB.prepare(
      `UPDATE quizzes SET
        slug = ?, title = ?, category = ?, subtitle = ?, description = ?,
        question_count = ?, duration_minutes = ?, participant_count = ?,
        points_json = ?, questions_json = ?, entry_url = ?, icon = ?, tint = ?, badge = ?, badge_class = ?,
        status = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      p.slug, p.title, p.category, p.subtitle, p.description,
      p.questionCount, p.durationMinutes, p.participantCount,
      JSON.stringify(p.points), JSON.stringify(p.questions), p.entryUrl,
      p.icon, p.tint, p.badge, p.badgeClass,
      p.status, p.sortOrder, Date.now(), id
    ).run();

    if (!result.meta || result.meta.changes === 0) {
      return jsonResponse({ error: 'not_found' }, 404);
    }
    return jsonResponse({ ok: true, id });
  } catch (e) {
    if (String(e.message || '').toLowerCase().includes('unique')) {
      return jsonResponse({ error: 'slug_exists', message: 'slug 已被其他测评使用' }, 409);
    }
    console.error('PUT /api/admin/quizzes failed:', e.message);
    return jsonResponse({ error: 'server_error', message: e.message }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);
  const admin = await requireAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'forbidden' }, 403);

  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return jsonResponse({ error: 'invalid_id' }, 400);

  try {
    const result = await env.DB.prepare(
      "UPDATE quizzes SET status = 'archived', updated_at = ? WHERE id = ?"
    ).bind(Date.now(), id).run();

    if (!result.meta || result.meta.changes === 0) {
      return jsonResponse({ error: 'not_found' }, 404);
    }
    return jsonResponse({ ok: true, id, status: 'archived' });
  } catch (e) {
    console.error('DELETE /api/admin/quizzes failed:', e.message);
    return jsonResponse({ error: 'server_error', message: e.message }, 500);
  }
}
