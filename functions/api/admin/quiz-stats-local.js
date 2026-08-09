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
import { hasColumn } from '../../_lib/schema.js';

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

  // S11: 检测 quiz_results 是否已含 visitor_token 列（迁移未执行时降级，不报错）
  const hasVisitorCol = await hasColumn(env, 'quiz_results', 'visitor_token');

  // 最近记录查询：LEFT JOIN 保证匿名记录（user_id 为 NULL）也会返回
  const recentSql = hasVisitorCol
    ? `SELECT r.id, r.user_id, r.visitor_token, r.created_at, r.headline,
              r.ip, r.country, r.city, r.device, r.os, r.browser,
              (r.scores_json IS NOT NULL) as has_scores,
              (r.ip IS NOT NULL AND r.ip != '') as has_meta,
              u.email as user_email, u.display_name as user_display_name
       FROM quiz_results r
       LEFT JOIN users u ON r.user_id = u.id
       ORDER BY r.created_at DESC LIMIT 50`
    : `SELECT r.id, r.user_id, r.created_at, r.headline,
              r.ip, r.country, r.city, r.device, r.os, r.browser,
              (r.scores_json IS NOT NULL) as has_scores,
              (r.ip IS NOT NULL AND r.ip != '') as has_meta,
              u.email as user_email, u.display_name as user_display_name
       FROM quiz_results r
       LEFT JOIN users u ON r.user_id = u.id
       ORDER BY r.created_at DESC LIMIT 50`;

  try {
    const [
      totalRow,
      todayRow,
      totalUsersRow,
      headlineBreakdown,
      countryBreakdown,
      deviceBreakdown,
      dailyTrend,
      recentRecords,
    ] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as cnt FROM quiz_results').first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM quiz_results WHERE created_at >= ?').bind(todayStartMs).first(),
      env.DB.prepare('SELECT COUNT(DISTINCT user_id) as cnt FROM quiz_results WHERE user_id IS NOT NULL').first(),
      env.DB.prepare(
        `SELECT headline, COUNT(*) as cnt FROM quiz_results
         WHERE headline IS NOT NULL AND headline != ''
         GROUP BY headline ORDER BY cnt DESC LIMIT 20`
      ).all(),
      env.DB.prepare(
        `SELECT country, COUNT(*) as cnt FROM quiz_results
         WHERE country IS NOT NULL AND country != ''
         GROUP BY country ORDER BY cnt DESC LIMIT 10`
      ).all(),
      env.DB.prepare(
        `SELECT device, COUNT(*) as cnt FROM quiz_results
         WHERE device IS NOT NULL AND device != ''
         GROUP BY device ORDER BY cnt DESC`
      ).all(),
      env.DB.prepare(
        `SELECT cast(created_at / ${DAY_MS} as integer) as day_bucket, COUNT(*) as cnt
         FROM quiz_results WHERE created_at >= ?
         GROUP BY day_bucket ORDER BY day_bucket ASC`
      ).bind(fourteenDaysAgoMs).all(),
      env.DB.prepare(recentSql).all(),
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
      countryBreakdown: (countryBreakdown.results || []).map(r => ({
        key: r.country,
        count: r.cnt,
      })),
      deviceBreakdown: (deviceBreakdown.results || []).map(r => ({
        key: r.device,
        count: r.cnt,
      })),
      dailyTrend: trend,
      recentRecords: (recentRecords.results || []).map(r => ({
        id: r.id,
        userId: r.user_id,
        visitorToken: r.visitor_token || '',
        userEmail: r.user_email || '',
        userDisplayName: r.user_display_name || '',
        headline: r.headline || '',
        createdAt: r.created_at,
        ip: r.ip || '',
        country: r.country || '',
        city: r.city || '',
        device: r.device || '',
        os: r.os || '',
        browser: r.browser || '',
        hasScores: !!r.has_scores,
        hasMeta: !!r.has_meta,
      })),
    });
  } catch (err) {
    return jsonResponse({
      error: 'query_failed',
      message: '统计查询失败：' + String(err?.message || err),
    }, 500);
  }
};