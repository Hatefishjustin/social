/**
 * Cloudflare Pages Function
 * 路径: /api/admin/quiz-stats-local
 * 方法: GET
 * 用途: SoulMirror 社交站心理测评统计（后台）
 * 数据源: env.DB 数据库的 quiz_results 表（社交站内测评）
 * 说明: 与 yourlover 测评站（QUIZ_DB.completions）数据源相互独立，互不影响
 *
 * 真实表结构（已线上确认）:
 *   id, user_id, created_at, headline, scores_json, answers_json
 *   - 无独立 quiz_type 字段；headline 为测评结果一句话总结，用于近似类型分布
 *
 * 提供: 总记录数、今日记录、最近14天趋势、结果类型分布、最近50条记录
 * 仅管理员可访问
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

const DAY_MS = 24 * 60 * 60 * 1000;

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);
  }
  if (!user.isAdmin) {
    return jsonResponse({ error: 'forbidden', message: '需要管理员权限' }, 403);
  }

  const now = Date.now();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  const fourteenDaysAgoMs = now - 14 * DAY_MS;

  try {
    const [
      totalRow,
      todayRow,
      totalUsersRow,
      headlineBreakdown,
      dailyTrend,
      recentRecords,
    ] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as cnt FROM quiz_results').first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM quiz_results WHERE created_at >= ?').bind(todayStartMs).first(),
      env.DB.prepare('SELECT COUNT(DISTINCT user_id) as cnt FROM quiz_results').first(),
      env.DB.prepare(
        `SELECT headline, COUNT(*) as cnt FROM quiz_results
         WHERE headline IS NOT NULL AND headline != ''
         GROUP BY headline ORDER BY cnt DESC LIMIT 20`
      ).all(),
      env.DB.prepare(
        `SELECT cast(created_at / ${DAY_MS} as integer) as day_bucket, COUNT(*) as cnt
         FROM quiz_results WHERE created_at >= ?
         GROUP BY day_bucket ORDER BY day_bucket ASC`
      ).bind(fourteenDaysAgoMs).all(),
      env.DB.prepare(
        `SELECT r.id, r.user_id, r.created_at, r.headline,
                (r.scores_json IS NOT NULL) as has_scores,
                u.email as user_email, u.display_name as user_display_name
         FROM quiz_results r
         LEFT JOIN users u ON r.user_id = u.id
         ORDER BY r.created_at DESC LIMIT 50`
      ).all(),
    ]);

    const trendMap = {};
    (dailyTrend.results || []).forEach(r => { trendMap[r.day_bucket] = r.cnt; });
    const todayBucket = Math.floor(now / DAY_MS);
    const trend = [];
    for (let i = 13; i >= 0; i--) {
      const bucket = todayBucket - i;
      trend.push({ dayBucket: bucket, date: bucket * DAY_MS, count: trendMap[bucket] || 0 });
    }

    return jsonResponse({
      source: 'soulmirror',
      generatedAt: now,
      totals: {
        records: totalRow?.cnt || 0,
        users: totalUsersRow?.cnt || 0,
      },
      today: {
        records: todayRow?.cnt || 0,
      },
      headlineBreakdown: (headlineBreakdown.results || []).map(r => ({
        key: r.headline,
        count: r.cnt,
      })),
      dailyTrend: trend,
      recentRecords: (recentRecords.results || []).map(r => ({
        id: r.id,
        userId: r.user_id,
        userEmail: r.user_email || '',
        userDisplayName: r.user_display_name || '',
        headline: r.headline || '',
        createdAt: r.created_at,
        hasScores: !!r.has_scores,
      })),
    });
  } catch (err) {
    return jsonResponse({
      error: 'query_failed',
      message: '统计查询失败：' + String(err?.message || err),
    }, 500);
  }
};