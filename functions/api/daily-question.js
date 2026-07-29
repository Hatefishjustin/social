/* functions/api/daily-question.js */
async function getCurrentUser(request, env) {
  if (!env.DB) return null;
  const cookieHeader = request.headers.get('Cookie');
  const match = cookieHeader && cookieHeader.match(new RegExp('(?:^|;\\s*)session=([^;]+)'));
  if (!match) return null;
  const row = await env.DB.prepare('SELECT sessions.expires_at as expires_at, users.id as user_id, users.email as email FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.token = ?').bind(match[1]).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { id: row.user_id, email: row.email };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
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

  const today = new Date().toISOString().slice(0, 10);
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
