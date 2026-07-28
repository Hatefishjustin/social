/**
 * Cloudflare Pages Function
 * 路径: /admin/quiz-stats
 * 方法: GET
 * 
 * 查询心理测评站（yourlover）数据，数据源为 QUIZ_DB（yourlover-db）
 * 复用社交站已有的 session 登录态，需要管理员权限
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 5000;

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function getCurrentAdmin(request, env) {
  if (!env.DB) return null;
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) return null;
  const row = await env.DB.prepare(
    `SELECT sessions.expires_at as expires_at, users.id as user_id, users.email as email
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { id: row.user_id, email: row.email };
}

function buildLimitedQuery(db, baseSql, unlimited, limit, bindArgs) {
  if (unlimited) {
    const stmt = db.prepare(baseSql);
    return bindArgs.length ? stmt.bind(...bindArgs) : stmt;
  }
  const stmt = db.prepare(baseSql + ' LIMIT ?');
  return stmt.bind(...bindArgs, limit);
}

export const onRequestGet = async ({ request, env }) => {
  if (!env.QUIZ_DB) {
    return jsonResponse({ error: 'missing_db', message: '服务器未绑定 QUIZ_DB（心理测评数据库）' }, 500);
  }

  const admin = await getCurrentAdmin(request, env);
  if (!admin) {
    return jsonResponse({ error: 'forbidden', message: '需要管理员登录' }, 403);
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  let unlimited = false;
  let limit = DEFAULT_LIMIT;
  if (limitParam === 'all') {
    unlimited = true;
  } else if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  const db = env.QUIZ_DB;
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  const sevenDaysAgoMs = now - 7 * 24 * 60 * 60 * 1000;
  const fourteenDaysAgoMs = now - 14 * 24 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  try {
    const recentUsersSql = 'SELECT id, email, created_at, last_seen_at FROM users ORDER BY created_at DESC';
    const recentCompletionsSql = `
      SELECT c.id, c.headline, c.created_at, c.quiz_type, c.user_id,
             c.ip, c.country, c.device, c.os, c.browser,
             (c.data_json IS NOT NULL) as has_data,
             u.email
      FROM completions c LEFT JOIN users u ON c.user_id = u.id
      ORDER BY c.created_at DESC`;
    const recentVisitorsSql = `
      SELECT visitor_id, COUNT(*) as cnt, MIN(created_at) as first_seen, MAX(created_at) as last_seen
      FROM completions WHERE visitor_id IS NOT NULL AND user_id IS NULL
      GROUP BY visitor_id ORDER BY last_seen DESC`;

    const [
      totalUsersRow, totalCompletionsRow, todayUsersRow, todayCompletionsRow,
      last7dUsersRow, prev7dUsersRow, quizTypeBreakdown, recentUsers,
      recentCompletions, anonCompletionsRow, attachBreakdown, loveBreakdown,
      countryBreakdown, deviceBreakdown, dailyTrend, recentVisitors,
    ] = await Promise.all([
      db.prepare('SELECT COUNT(*) as cnt FROM users').first(),
      db.prepare('SELECT COUNT(*) as cnt FROM completions').first(),
      db.prepare('SELECT COUNT(*) as cnt FROM users WHERE created_at >= ?').bind(todayStartMs).first(),
      db.prepare('SELECT COUNT(*) as cnt FROM completions WHERE created_at >= ?').bind(todayStartMs).first(),
      db.prepare('SELECT COUNT(*) as cnt FROM users WHERE created_at >= ?').bind(sevenDaysAgoMs).first(),
      db.prepare('SELECT COUNT(*) as cnt FROM users WHERE created_at >= ? AND created_at < ?').bind(fourteenDaysAgoMs, sevenDaysAgoMs).first(),
      db.prepare('SELECT quiz_type, COUNT(*) as cnt FROM completions GROUP BY quiz_type ORDER BY cnt DESC').all(),
      buildLimitedQuery(db, recentUsersSql, unlimited, limit, []).all(),
      buildLimitedQuery(db, recentCompletionsSql, unlimited, limit, []).all(),
      db.prepare('SELECT COUNT(*) as cnt FROM completions WHERE user_id IS NULL').first(),
      db.prepare('SELECT top_attach, COUNT(*) as cnt FROM completions WHERE top_attach IS NOT NULL GROUP BY top_attach ORDER BY cnt DESC').all(),
      db.prepare('SELECT primary_love, COUNT(*) as cnt FROM completions WHERE primary_love IS NOT NULL GROUP BY primary_love ORDER BY cnt DESC').all(),
      db.prepare('SELECT country, COUNT(*) as cnt FROM completions WHERE country IS NOT NULL GROUP BY country ORDER BY cnt DESC LIMIT 10').all(),
      db.prepare('SELECT device, COUNT(*) as cnt FROM completions WHERE device IS NOT NULL GROUP BY device ORDER BY cnt DESC').all(),
      db.prepare(
        `SELECT cast(created_at / ${DAY_MS} as integer) as day_bucket, COUNT(*) as cnt
         FROM completions WHERE created_at >= ? GROUP BY day_bucket ORDER BY day_bucket ASC`
      ).bind(now - 14 * DAY_MS).all(),
      buildLimitedQuery(db, recentVisitorsSql, unlimited, limit, []).all(),
    ]);

    const last7d = last7dUsersRow?.cnt || 0;
    const prev7d = prev7dUsersRow?.cnt || 0;
    let growthPct = null;
    if (prev7d > 0) growthPct = Math.round(((last7d - prev7d) / prev7d) * 1000) / 10;

    const trendMap = {};
    (dailyTrend.results || []).forEach(r => { trendMap[r.day_bucket] = r.cnt; });
    const todayBucket = Math.floor(now / DAY_MS);
    const trend = [];
    for (let i = 13; i >= 0; i--) {
      const bucket = todayBucket - i;
      trend.push({ dayBucket: bucket, date: bucket * DAY_MS, count: trendMap[bucket] || 0 });
    }

    return jsonResponse({
      generatedAt: now,
      appliedLimit: unlimited ? 'all' : limit,
      totals: {
        users: totalUsersRow?.cnt || 0,
        completions: totalCompletionsRow?.cnt || 0,
        anonCompletions: anonCompletionsRow?.cnt || 0,
      },
      today: { newUsers: todayUsersRow?.cnt || 0, completedTests: todayCompletionsRow?.cnt || 0 },
      growth: { last7dNewUsers: last7d, prev7dNewUsers: prev7d, growthPct },
      quizTypeBreakdown: (quizTypeBreakdown.results || []).map(r => ({ quizType: r.quiz_type, count: r.cnt })),
      attachBreakdown: (attachBreakdown.results || []).map(r => ({ key: r.top_attach, count: r.cnt })),
      loveBreakdown: (loveBreakdown.results || []).map(r => ({ key: r.primary_love, count: r.cnt })),
      countryBreakdown: (countryBreakdown.results || []).map(r => ({ key: r.country, count: r.cnt })),
      deviceBreakdown: (deviceBreakdown.results || []).map(r => ({ key: r.device, count: r.cnt })),
      dailyTrend: trend,
      recentUsers: (recentUsers.results || []).map(r => ({
        id: r.id, email: r.email, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
      })),
      recentRecords: (recentCompletions.results || []).map(r => ({
        id: r.id, userId: r.user_id, email: r.email, headline: r.headline,
        quizType: r.quiz_type, createdAt: r.created_at,
        ip: r.ip, country: r.country, device: r.device, os: r.os, browser: r.browser,
        hasData: !!r.has_data,
      })),
      recentVisitors: (recentVisitors.results || []).map(r => ({
        visitorId: r.visitor_id, count: r.cnt, firstSeen: r.first_seen, lastSeen: r.last_seen,
      })),
    });
  } catch (err) {
    return jsonResponse({
      error: 'query_failed',
      message: '统计查询失败：' + String(err?.message || err),
    }, 500);
  }
};
