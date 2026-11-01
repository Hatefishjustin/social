/* functions/api/daily-question.js */
import { getCurrentUser } from '../_lib/auth.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
}

// 每日一问按北京时间（UTC+8）切换，避免 UTC 00:00 对应北京 08:00 的错位
function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const today = todayCN();
  const user = await getCurrentUser(request, env);

  let q = await env.DB.prepare('SELECT * FROM daily_questions WHERE date = ?').bind(today).first();
  if (!q) q = await env.DB.prepare('SELECT * FROM daily_questions ORDER BY date DESC LIMIT 1').first();
  if (!q) return json({ question: null });

  const dist = await env.DB.prepare('SELECT option_key, COUNT(*) as cnt FROM daily_answers WHERE question_id = ? GROUP BY option_key').bind(q.id).all();
  const total = dist.results.reduce((s,r) => s + r.cnt, 0);
  const distribution = {};
  dist.results.forEach(r => { distribution[r.option_key] = { count: r.cnt, pct: total > 0 ? Math.round(r.cnt / total * 100) : 0 }; });

  let userAnswer = null;
  if (user) {
    const ua = await env.DB.prepare('SELECT option_key FROM daily_answers WHERE question_id = ? AND user_id = ?').bind(q.id, user.id).first();
    if (ua) userAnswer = ua.option_key;
  }

  return json({ question: q, distribution, total, userAnswer });
};

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: '请先登录' }, 401);

  const today = todayCN();
  let q = await env.DB.prepare('SELECT * FROM daily_questions WHERE date = ?').bind(today).first();
  if (!q) q = await env.DB.prepare('SELECT * FROM daily_questions ORDER BY date DESC LIMIT 1').first();
  if (!q) return json({ error: '暂无今日之问' }, 404);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid_body' }, 400); }
  const { option } = body || {};
  if (!['A','B','C','D'].includes(option)) return json({ error: '无效选项' }, 400);

  await env.DB.prepare('INSERT OR REPLACE INTO daily_answers (question_id, user_id, option_key, created_at) VALUES (?, ?, ?, ?)').bind(q.id, user.id, option, Date.now()).run();

  const dist = await env.DB.prepare('SELECT option_key, COUNT(*) as cnt FROM daily_answers WHERE question_id = ? GROUP BY option_key').bind(q.id).all();
  const total = dist.results.reduce((s,r) => s + r.cnt, 0);
  const distribution = {};
  dist.results.forEach(r => { distribution[r.option_key] = { count: r.cnt, pct: total > 0 ? Math.round(r.cnt / total * 100) : 0 }; });

  return json({ ok: true, distribution, total, userAnswer: option });
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
};
