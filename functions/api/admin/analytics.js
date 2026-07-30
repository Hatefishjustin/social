/**
 * Cloudflare Pages Function
 * 路径: /api/admin/analytics
 * GET: 数据概览（管理员）
 */

import { getCurrentUser } from '../../_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestGet = async ({ request, env }) => {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);

  const user = await getCurrentUser(request, env);
  if (!user || !user.isAdmin) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  const db = env.DB;

  // Run all queries
  const [
    totalUsers, totalPagesViews, viewsToday, viewsWeek,
    totalWallPosts, totalQuestions, totalAnswers,
    totalFeedback, feedbackOpen,
    anonPosts, anonQuestions, anonUsersLoggedIn,
    activeUsersWeek
  ] = await Promise.all([
    db.prepare('SELECT COUNT(*) as n FROM users').first(),
    db.prepare('SELECT COUNT(*) as n FROM page_views').first(),
    db.prepare('SELECT COUNT(*) as n FROM page_views WHERE created_at >= ?').bind(Date.now() - 86400000).first(),
    db.prepare('SELECT COUNT(*) as n FROM page_views WHERE created_at >= ?').bind(Date.now() - 604800000).first(),
    db.prepare('SELECT COUNT(*) as n FROM wall_posts').first(),
    db.prepare('SELECT COUNT(*) as n FROM askbox_questions').first(),
    db.prepare('SELECT COUNT(*) as n FROM askbox_questions WHERE answer_content IS NOT NULL AND answer_content != \'\'').first(),
    db.prepare('SELECT COUNT(*) as n FROM feedback').first(),
    db.prepare('SELECT COUNT(*) as n FROM feedback WHERE status = \'open\'').first(),
    db.prepare('SELECT COUNT(*) as n FROM activity_log WHERE is_anonymous = 1 AND action = \'wall_post\'').first(),
    db.prepare('SELECT COUNT(*) as n FROM activity_log WHERE is_anonymous = 1 AND action = \'askbox_question\'').first(),
    db.prepare('SELECT COUNT(DISTINCT user_email) as n FROM activity_log WHERE is_anonymous = 1 AND user_email IS NOT NULL').first(),
    db.prepare('SELECT COUNT(DISTINCT user_id) as n FROM page_views WHERE user_id IS NOT NULL AND created_at >= ?').bind(Date.now() - 604800000).first(),
  ]);

  // Top 5 pages by views
  const topPages = await db.prepare(
    'SELECT page, COUNT(*) as views FROM page_views GROUP BY page ORDER BY views DESC LIMIT 10'
  ).all();

  // Today's hourly breakdown  
  const todayHourly = await db.prepare(
    `SELECT (created_at / 3600000) * 3600000 as hour, COUNT(*) as views
     FROM page_views WHERE created_at >= ?
     GROUP BY hour ORDER BY hour ASC`
  ).bind(Date.now() - 86400000).all();

  return jsonResponse({
    stats: {
      totalUsers: totalUsers.n,
      pageViews: { total: totalPagesViews.n, today: viewsToday.n, week: viewsWeek.n },
      content: {
        wallPosts: totalWallPosts.n,
        questions: totalQuestions.n,
        answers: totalAnswers.n,
      },
      feedback: { total: totalFeedback.n, open: feedbackOpen.n },
      anonymous: {
        wallPosts: anonPosts.n,
        questions: anonQuestions.n,
        loggedInUsersWhoPostAnonymously: anonUsersLoggedIn.n,
      },
      activeUsersWeek: activeUsersWeek.n,
    },
    topPages: topPages.results,
    todayHourly: todayHourly.results,
  });
};
