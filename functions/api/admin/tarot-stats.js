/**
 * Cloudflare Pages Function
 * 路径: /api/admin/tarot-stats
 * 方法: GET
 * 用途: 塔罗数据统计（后台）
 * 提供: 总抽牌次数、今日抽牌次数、近14天趋势、牌阵分布
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
      spreadBreakdown,
      dailyTrend,
    ] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as cnt FROM tarot_readings').first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM tarot_readings WHERE created_at >= ?').bind(todayStartMs).first(),
      env.DB.prepare(
        `SELECT spread_type, COUNT(*) as cnt FROM tarot_readings GROUP BY spread_type ORDER BY cnt DESC`
      ).all(),
      env.DB.prepare(
        `SELECT cast(created_at / ${DAY_MS} as integer) as day_bucket, COUNT(*) as cnt
         FROM tarot_readings WHERE created_at >= ?
         GROUP BY day_bucket ORDER BY day_bucket ASC`
      ).bind(fourteenDaysAgoMs).all(),
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
      generatedAt: now,
      totals: {
        readings: totalRow?.cnt || 0,
      },
      today: {
        readings: todayRow?.cnt || 0,
      },
      spreadBreakdown: (spreadBreakdown.results || []).map(r => ({
        spreadType: r.spread_type,
        count: r.cnt,
      })),
      dailyTrend: trend,
    });
  } catch (err) {
    return jsonResponse({
      error: 'query_failed',
      message: '统计查询失败：' + String(err?.message || err),
    }, 500);
  }
};