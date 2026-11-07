/**
 * Cloudflare Pages Function
 * 路径: /api/admin/quiz-attempts
 * 方法: GET
 *
 * 后台「测评结果」模块（数据源：quiz_attempts + users）
 * 仅管理员可访问：未登录 401，非管理员 403。
 *
 * 列表:  GET /api/admin/quiz-attempts
 *   参数:
 *     page     页码，默认 1（LIMIT/OFFSET 分页，可一直翻到末页）
 *     pageSize 每页条数，默认 50，可选 1–200（前端提供 50/100/200）
 *     slug     按测评 slug 筛选
 *     login    1=仅登录用户 / 0=仅匿名 / 空=全部
 *     result   按结果标签（result_name）精确筛选
 *     from/to  时间范围，毫秒时间戳（含边界）
 *     q        关键词：昵称 / 邮箱 / slug / 测评标题 / 结果名 / 访客标识
 *     sort     desc（默认，倒序）/ asc（正序）
 *   返回: records + pagination + overview（全量统计，不受筛选影响）+ facets
 *
 * 详情:  GET /api/admin/quiz-attempts?id=123
 *   返回逐题答案（answersJson）、维度分（dimsJson）、UA/IP 等完整明细。
 *
 * 全量导出: GET /api/admin/quiz-attempts?export=1&format=csv|json
 *   使用 created_at + id keyset 分批（每批 1000 行）流式输出，
 *   不受 D1 单次查询行数影响，也不会出现“最多 50 条”的截断。
 */

import { getCurrentUser } from '../../_lib/auth.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const EXPORT_BATCH = 1000;

const LIST_COLUMNS = `
  a.id, a.slug, a.quiz_title, a.result_key, a.result_name,
  a.score, a.mouth_score, a.user_id, a.visitor_token, a.created_at,
  a.mode, a.dims_json, a.user_agent, a.ip,
  u.display_name, u.email`;

const EXPORT_COLUMNS = LIST_COLUMNS + `, a.answers_json`;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function clip(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function parseTime(value, endOfDay) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return endOfDay ? parsed + 86399999 : parsed;
}

function parseFilters(url) {
  const conds = [];
  const params = [];

  const slug = clip(url.searchParams.get('slug'), 64);
  if (slug) {
    conds.push('a.slug = ?');
    params.push(slug);
  }

  const login = clip(url.searchParams.get('login'), 3);
  if (login === '1') conds.push('a.user_id IS NOT NULL');
  if (login === '0') conds.push('a.user_id IS NULL');

  const result = clip(url.searchParams.get('result'), 80);
  if (result) {
    conds.push('a.result_name = ?');
    params.push(result);
  }

  const from = parseTime(url.searchParams.get('from'), false);
  if (from) {
    conds.push('a.created_at >= ?');
    params.push(from);
  }

  const to = parseTime(url.searchParams.get('to'), true);
  if (to) {
    conds.push('a.created_at <= ?');
    params.push(to);
  }

  const q = clip(url.searchParams.get('q'), 80);
  if (q) {
    const like = '%' + q + '%';
    conds.push('(a.slug LIKE ? OR a.quiz_title LIKE ? OR a.result_name LIKE ?'
      + ' OR u.display_name LIKE ? OR u.email LIKE ? OR a.visitor_token LIKE ?)');
    params.push(like, like, like, like, like, like);
  }

  const sort = url.searchParams.get('sort') === 'asc' ? 'asc' : 'desc';
  return { conds, params, sort };
}

function whereSql(conds) {
  return conds.length ? ' WHERE ' + conds.join(' AND ') : '';
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

function deviceOfUA(ua) {
  if (!ua) return '';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/windows/i.test(ua)) return 'Windows';
  if (/macintosh|mac os/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return '其他';
}

function toRecord(row) {
  const dims = parseJson(row.dims_json, {});
  return {
    id: row.id,
    slug: row.slug || '',
    quizTitle: row.quiz_title || '',
    resultKey: row.result_key || '',
    resultName: row.result_name || '',
    score: row.score,
    mouthScore: row.mouth_score,
    userId: row.user_id,
    displayName: row.display_name || '',
    email: row.email || '',
    anonymous: !row.user_id,
    visitorToken: row.visitor_token || '',
    createdAt: row.created_at,
    mode: row.mode || '',
    dims: Array.isArray(dims.dims) ? dims.dims : [],
    dimsPercent: Number.isFinite(Number(dims.percent)) ? Number(dims.percent) : null,
    mouthPct: Number.isFinite(Number(dims.mouthPct)) ? Number(dims.mouthPct) : null,
    userAgent: row.user_agent || '',
    device: deviceOfUA(row.user_agent || ''),
    ip: row.ip || '',
    completed: !!row.result_name,
  };
}

// 北京时间当日 0 点（站点主要用户在东八区；与前端显示一致）
function todayStartMs(now) {
  const offset = 8 * 3600 * 1000;
  return Math.floor((now + offset) / 86400000) * 86400000 - offset;
}

async function loadOverview(db) {
  const now = Date.now();
  const dayStart = todayStartMs(now);
  const weekStart = now - 7 * 86400000;

  const [totalRow, todayRow, weekRow, anonRow, completedRow, byQuiz, resultNames, modes] =
    await Promise.all([
      db.prepare('SELECT COUNT(*) AS cnt FROM quiz_attempts').first(),
      db.prepare('SELECT COUNT(*) AS cnt FROM quiz_attempts WHERE created_at >= ?').bind(dayStart).first(),
      db.prepare('SELECT COUNT(*) AS cnt FROM quiz_attempts WHERE created_at >= ?').bind(weekStart).first(),
      db.prepare('SELECT COUNT(*) AS cnt FROM quiz_attempts WHERE user_id IS NULL').first(),
      db.prepare("SELECT COUNT(*) AS cnt FROM quiz_attempts WHERE result_name <> ''").first(),
      db.prepare(`SELECT slug, MAX(quiz_title) AS quiz_title, COUNT(*) AS cnt
                  FROM quiz_attempts GROUP BY slug ORDER BY cnt DESC`).all(),
      db.prepare(`SELECT result_name, COUNT(*) AS cnt FROM quiz_attempts
                  WHERE result_name <> '' GROUP BY result_name ORDER BY cnt DESC LIMIT 200`).all(),
      db.prepare(`SELECT mode, COUNT(*) AS cnt FROM quiz_attempts GROUP BY mode`).all(),
    ]);

  const total = totalRow?.cnt || 0;
  const completed = completedRow?.cnt || 0;

  return {
    total,
    today: todayRow?.cnt || 0,
    last7d: weekRow?.cnt || 0,
    anonymous: anonRow?.cnt || 0,
    loggedIn: total - (anonRow?.cnt || 0),
    completed,
    completionRate: total > 0 ? Math.round(completed / total * 100) : 0,
    byQuiz: (byQuiz.results || []).map((r) => ({
      slug: r.slug || '',
      quizTitle: r.quiz_title || r.slug || '',
      count: r.cnt,
    })),
    resultNames: (resultNames.results || []).map((r) => ({
      name: r.result_name || '',
      count: r.cnt,
    })),
    modes: (modes.results || []).map((r) => ({ mode: r.mode || '未知', count: r.cnt })),
  };
}

async function loadDetail(db, id) {
  const row = await db.prepare(
    `SELECT a.id, a.slug, a.quiz_title, a.result_key, a.result_name,
            a.score, a.mouth_score, a.user_id, a.visitor_token, a.created_at,
            a.mode, a.answers_json, a.dims_json, a.user_agent, a.ip,
            u.display_name, u.email
     FROM quiz_attempts a
     LEFT JOIN users u ON a.user_id = u.id
     WHERE a.id = ?`
  ).bind(id).first();

  if (!row) return null;

  const record = toRecord(row);
  return {
    ...record,
    answers: parseJson(row.answers_json, []),
    dimsDetail: parseJson(row.dims_json, {}),
    hasDetail: Array.isArray(parseJson(row.answers_json, []))
      && parseJson(row.answers_json, []).length > 0,
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function csvRow(record) {
  const dims = record.dims.map((d) => `${d.name || d.key || ''}:${d.percent == null ? '' : d.percent}`).join('|');
  return [
    record.id,
    record.createdAt,
    new Date(record.createdAt).toISOString(),
    record.userId || '',
    record.displayName,
    record.email,
    record.anonymous ? '匿名' : '登录',
    record.visitorToken,
    record.slug,
    record.quizTitle,
    record.resultKey,
    record.resultName,
    record.score == null ? '' : record.score,
    record.mouthScore == null ? '' : record.mouthScore,
    record.mode,
    dims,
    JSON.stringify(record.answers || []),
    record.device,
    record.userAgent,
    record.ip,
  ].map(csvCell).join(',') + '\r\n';
}

const CSV_HEADER = [
  'id', 'created_at_ms', 'created_at_iso', 'user_id', 'display_name', 'email',
  'login_state', 'visitor_token', 'slug', 'quiz_title', 'result_key', 'result_name',
  'score', 'mouth_score', 'mode', 'dims', 'answers_json', 'device', 'user_agent', 'ip',
].map(csvCell).join(',') + '\r\n';

async function streamExport(db, filters, format) {
  const encoder = new TextEncoder();
  const isCsv = format === 'csv';
  let cursor = null;
  let started = false;
  let exported = 0;

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          controller.enqueue(encoder.encode(isCsv ? '\ufeff' + CSV_HEADER : '['));
        }

        const conds = filters.conds.slice();
        const params = filters.params.slice();
        if (cursor) {
          if (filters.sort === 'desc') {
            conds.push('(a.created_at < ? OR (a.created_at = ? AND a.id < ?))');
          } else {
            conds.push('(a.created_at > ? OR (a.created_at = ? AND a.id > ?))');
          }
          params.push(cursor.createdAt, cursor.createdAt, cursor.id);
        }

        const rows = await db.prepare(
          `SELECT ${EXPORT_COLUMNS}
           FROM quiz_attempts a
           LEFT JOIN users u ON a.user_id = u.id
           ${whereSql(conds)}
           ORDER BY a.created_at ${filters.sort}, a.id ${filters.sort}
           LIMIT ${EXPORT_BATCH}`
        ).bind(...params).all();

        const list = rows.results || [];
        if (list.length === 0) {
          if (!isCsv) controller.enqueue(encoder.encode(']'));
          controller.close();
          return;
        }

        const last = list[list.length - 1];
        cursor = { createdAt: last.created_at, id: last.id };

        if (isCsv) {
          let chunk = '';
          for (const row of list) {
            const record = toRecord(row);
            record.answers = parseJson(row.answers_json, []);
            chunk += csvRow(record);
          }
          controller.enqueue(encoder.encode(chunk));
        } else {
          let chunk = exported > 0 ? ',\n' : '';
          const items = [];
          for (const row of list) {
            const record = toRecord(row);
            record.answers = parseJson(row.answers_json, []);
            record.dimsDetail = parseJson(row.dims_json, {});
            items.push(JSON.stringify(record));
          }
          chunk += items.join(',\n');
          controller.enqueue(encoder.encode(chunk));
        }

        exported += list.length;
        if (list.length < EXPORT_BATCH) {
          if (!isCsv) controller.enqueue(encoder.encode(']'));
          controller.close();
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': isCsv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="quiz-attempts-${new Date().toISOString().slice(0, 10)}.${isCsv ? 'csv' : 'json'}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export const onRequestGet = async ({ request, env }) => {
  if (!env || !env.DB) {
    return jsonResponse({ error: 'missing_db', message: '数据库未绑定' }, 500);
  }

  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);
  }
  if (!user.isAdmin) {
    return jsonResponse({ error: 'forbidden', message: '需要管理员权限' }, 403);
  }

  const url = new URL(request.url);
  const db = env.DB;

  try {
    const idParam = url.searchParams.get('id');
    if (idParam) {
      const id = Number(idParam);
      if (!Number.isInteger(id) || id <= 0) {
        return jsonResponse({ error: 'invalid_id', message: '无效的记录 ID' }, 400);
      }
      const detail = await loadDetail(db, id);
      if (!detail) {
        return jsonResponse({ error: 'not_found', message: '记录不存在' }, 404);
      }
      return jsonResponse({ detail });
    }

    const filters = parseFilters(url);

    const isExport = url.searchParams.get('export') === '1';
    const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
    if (isExport) {
      return await streamExport(db, filters, format);
    }

    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(url.searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
    );
    const offset = (page - 1) * pageSize;

    const where = whereSql(filters.conds);

    const [countRow, listRows, overview] = await Promise.all([
      db.prepare(
        `SELECT COUNT(*) AS total
         FROM quiz_attempts a
         LEFT JOIN users u ON a.user_id = u.id
         ${where}`
      ).bind(...filters.params).first(),
      db.prepare(
        `SELECT ${LIST_COLUMNS}
         FROM quiz_attempts a
         LEFT JOIN users u ON a.user_id = u.id
         ${where}
         ORDER BY a.created_at ${filters.sort}, a.id ${filters.sort}
         LIMIT ? OFFSET ?`
      ).bind(...filters.params, pageSize, offset).all(),
      loadOverview(db),
    ]);

    const total = countRow?.total || 0;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
    const records = (listRows.results || []).map(toRecord);

    return jsonResponse({
      records,
      pagination: { page, pageSize, total, totalPages, offset, from: total ? offset + 1 : 0, to: offset + records.length },
      overview,
      filters: {
        slug: clip(url.searchParams.get('slug'), 64),
        login: clip(url.searchParams.get('login'), 3),
        result: clip(url.searchParams.get('result'), 80),
        q: clip(url.searchParams.get('q'), 80),
        from: url.searchParams.get('from') || '',
        to: url.searchParams.get('to') || '',
        sort: filters.sort,
      },
    });
  } catch (err) {
    return jsonResponse({
      error: 'query_failed',
      message: '测评结果查询失败：' + String(err?.message || err),
    }, 500);
  }
};
