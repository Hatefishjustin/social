/**
 * Cloudflare Pages Function
 * 路径: /api/admin/dashboard
 * 方法: GET
 * S09 数据总览（管理员）
 * 返回: 今日 PV / 今日 UV / 注册用户 / 提问数量 / 回答数量 / 测试完成数量 / 塔罗次数
 * 兼容迁移前/后状态（S09 未执行时 visitor_token 字段不存在，UV 用 IP+分页去重降级）
 */
import { getCurrentUser } from '../../_lib/auth.js';
import { hasColumn } from '../../_lib/schema.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const DAY_MS = 86400000;

export const onRequestGet = async ({ request, env }) => {
  if (!env || !env.DB) return jsonResponse({ error: 'missing_db', message: '数据库未配置' }, 500);

  const user = await getCurrentUser(request, env);
  if (!user || !user.isAdmin) return jsonResponse({ error: 'forbidden', message: '无权限' }, 403);

  const db = env.DB;
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  // 兼容迁移前: page_views 是否有 visitor_token 字段
  const hasVisitorToken = await hasColumn(env, 'page_views', 'visitor_token');
  const hasAskboxVisits = await hasColumn(env, 'askbox_visits', 'id');

  const [
    todayPv,
    totalUsers,
    todayNewUsers,
    totalQuestions,
    totalAnswers,
    totalQuiz,
    todayQuiz,
    totalTarot,
    todayTarot,
    totalPageViews,
  ] = await Promise.all([
    // 今日 PV
    db.prepare('SELECT COUNT(*) as n FROM page_views WHERE created_at >= ?').bind(todayStartMs).first(),
    // 累计用户
    db.prepare('SELECT COUNT(*) as n FROM users').first(),
    // 今日新增用户
    db.prepare('SELECT COUNT(*) as n FROM users WHERE created_at >= ?').bind(todayStartMs).first(),
    // 提问数量
    db.prepare('SELECT COUNT(*) as n FROM askbox_questions').first(),
    // 回答数量
    db.prepare('SELECT COUNT(*) as n FROM askbox_questions WHERE answer_content IS NOT NULL AND answer_content != ?').bind('').first(),
    // 测试完成次数
    db.prepare('SELECT COUNT(*) as n FROM quiz_results').first(),
    db.prepare('SELECT COUNT(*) as n FROM quiz_results WHERE created_at >= ?').bind(todayStartMs).first(),
    // 塔罗次数
    db.prepare('SELECT COUNT(*) as n FROM tarot_readings').first(),
    db.prepare('SELECT COUNT(*) as n FROM tarot_readings WHERE created_at >= ?').bind(todayStartMs).first(),
    // 累计 PV
    db.prepare('SELECT COUNT(*) as n FROM page_views').first(),
  ]);

  // 今日 UV
  let todayUv = 0;
  let totalUv = 0;
  if (hasVisitorToken) {
    const uvRow = await db.prepare(
      `SELECT COUNT(DISTINCT COALESCE(NULLIF(visitor_token, ''), 'anon:' || user_id)) as n
       FROM page_views WHERE created_at >= ?`
    ).bind(todayStartMs).first();
    todayUv = uvRow?.n || 0;
    const totalUvRow = await db.prepare(
      `SELECT COUNT(DISTINCT COALESCE(NULLIF(visitor_token, ''), 'anon:' || user_id)) as n
       FROM page_views`
    ).first();
    totalUv = totalUvRow?.n || 0;
  } else {
    // 迁移前降级: 按 (ip, user_id) 去重不可行（page_views 无 ip），退化为按 user_id + 匿名计数
    const anonRow = await db.prepare(
      `SELECT COUNT(*) as n FROM page_views WHERE created_at >= ? AND user_id IS NULL`
    ).bind(todayStartMs).first();
    const loggedRow = await db.prepare(
      `SELECT COUNT(DISTINCT user_id) as n FROM page_views WHERE created_at >= ? AND user_id IS NOT NULL`
    ).bind(todayStartMs).first();
    todayUv = (anonRow?.n || 0) + (loggedRow?.n || 0);
    const anonTotal = await db.prepare(`SELECT COUNT(*) as n FROM page_views WHERE user_id IS NULL`).first();
    const loggedTotal = await db.prepare(`SELECT COUNT(DISTINCT user_id) as n FROM page_views WHERE user_id IS NOT NULL`).first();
    totalUv = (anonTotal?.n || 0) + (loggedTotal?.n || 0);
  }

  // 提问箱总数（有 askbox_visits 表时返回，无则返回 0 不报错）
  let askboxVisitTotal = 0;
  if (hasAskboxVisits) {
    try {
      const av = await db.prepare(`SELECT COUNT(*) as n FROM askbox_visits`).first();
      askboxVisitTotal = av?.n || 0;
    } catch (e) { askboxVisitTotal = 0; }
  }

  // 热门页面 Top 10（pv = COUNT(*), lastVisit = MAX(created_at), 按 pv DESC）
  const topPv = await db.prepare(
    `SELECT page, COUNT(*) as pv, MAX(created_at) as last_visit
     FROM page_views GROUP BY page ORDER BY pv DESC LIMIT 10`
  ).all();

  // UV（迁移后 visitor_token 存在时计算；否则降级 uv = pv）
  let topUvMap = {};
  if (hasVisitorToken) {
    const uvRes = await db.prepare(
      `SELECT page, COUNT(DISTINCT COALESCE(NULLIF(visitor_token, ''), 'anon:' || user_id)) as uv
       FROM page_views GROUP BY page`
    ).all();
    (uvRes.results || []).forEach((r) => { topUvMap[r.page] = r.uv; });
  }

  const topPages = (topPv.results || []).map((r) => ({
    page: r.page || '/',
    pv: r.pv || 0,
    uv: hasVisitorToken ? (topUvMap[r.page] || 0) : (r.pv || 0),
    lastVisit: r.last_visit || null,
  }));

  return jsonResponse({
    stats: {
      today: {
        pv: todayPv?.n || 0,
        uv: todayUv,
        newUsers: todayNewUsers?.n || 0,
        quiz: todayQuiz?.n || 0,
        tarot: todayTarot?.n || 0,
      },
      total: {
        uv: totalUv,
        pv: totalPageViews?.n || 0,
        users: totalUsers?.n || 0,
        questions: totalQuestions?.n || 0,
        answers: totalAnswers?.n || 0,
        quiz: totalQuiz?.n || 0,
        tarot: totalTarot?.n || 0,
        askboxVisits: askboxVisitTotal,
      },
    },
    topPages,
    generatedAt: now,
  });
};
