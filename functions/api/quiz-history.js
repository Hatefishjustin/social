/**
 * Cloudflare Pages Function
 * 路由: /api/quiz-history
 *
 * GET: 当前登录用户的测评历史（深度匹配测评 + S/M 互动倾向 + 通用答题器测评）
 *   - 仅返回当前账号的记录
 *   - 按时间倒序，最多 20 条
 *   - 不返回原始答案，只返回结果摘要
 */

import { getCurrentUser } from '../_lib/auth.js';
import { hasTable } from '../_lib/schema.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function roundScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);

  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  const limit = 20;
  const items = [];

  try {
    const deep = await env.DB.prepare(
      `SELECT id, headline, created_at
       FROM quiz_results
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).bind(user.id, limit).all();

    (deep.results || []).forEach((row) => {
      items.push({
        id: 'deep-' + row.id,
        type: 'deep',
        title: row.headline || '深度匹配测评',
        createdAt: row.created_at,
        summary: '',
      });
    });
  } catch (e) {
    console.error('quiz-history deep query failed:', e.message);
  }

  try {
    if (await hasTable(env, 'sm_test_results')) {
      const sm = await env.DB.prepare(
        `SELECT id, result_type, s_score, m_score, switch_score, trust_score, consent_score, created_at
         FROM sm_test_results
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      ).bind(user.id, limit).all();

      (sm.results || []).forEach((row) => {
        const parts = [];
        const s = roundScore(row.s_score);
        const m = roundScore(row.m_score);
        const sw = roundScore(row.switch_score);
        if (s !== null) parts.push('S ' + s);
        if (m !== null) parts.push('M ' + m);
        if (sw !== null) parts.push('切换 ' + sw);
        items.push({
          id: 'sm-' + row.id,
          type: 'sm',
          title: 'S/M 互动倾向 · ' + (row.result_type || '结果'),
          createdAt: row.created_at,
          summary: parts.join(' · '),
        });
      });
    }
  } catch (e) {
    console.error('quiz-history sm query failed:', e.message);
  }

  try {
    if (await hasTable(env, 'quiz_attempts')) {
      const quiz = await env.DB.prepare(
        `SELECT id, slug, quiz_title, result_name, score, created_at
         FROM quiz_attempts
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      ).bind(user.id, limit).all();

      (quiz.results || []).forEach((row) => {
        const score = roundScore(row.score);
        items.push({
          id: 'quiz-' + row.id,
          type: 'quiz',
          slug: row.slug || '',
          title: (row.quiz_title || '状态测评') + (row.result_name ? ' · ' + row.result_name : ''),
          createdAt: row.created_at,
          summary: score === null ? '' : '得分 ' + score + '%',
          href: row.slug ? '/quiz.html?slug=' + encodeURIComponent(row.slug) : '/quiz.html',
        });
      });
    }
  } catch (e) {
    console.error('quiz-history quiz query failed:', e.message);
  }

  items.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

  return jsonResponse({
    items: items.slice(0, limit),
    total: items.length,
  });
}
