/**
 * Cloudflare Pages Function
 * 路径: /api/reports-admin
 * GET: 管理员查看举报列表
 * PUT: 管理员处理举报 {reportId, action: "dismiss"|"warn"|"ban", admin_note}
 */
function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

async function getAdminUser(request, env) {
  if (!env.DB) return null;
  const token = parseCookie(request.headers.get('Cookie'), 'session');
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.expires_at, u.id, u.email, u.is_admin
     FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?`
  ).bind(token).first();
  if (!row || Date.now() > row.expires_at) return null;
  if (!row.is_admin) return null;
  return { id: row.id, email: row.email };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

export const onRequestGet = async ({ request, env }) => {
  const admin = await getAdminUser(request, env);
  if (!admin) return json({ error: 'forbidden' }, 403);

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20'));
  const offset = (page - 1) * limit;

  let where = '';
  if (status === 'pending') where = "WHERE r.status = 'pending'";
  else if (status === 'resolved') where = "WHERE r.status = 'resolved'";
  else if (status === 'all') where = '';

  const [reportRows, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT r.id as report_id, r.reporter_id, r.match_id, r.reason, r.status, r.admin_note, r.created_at, r.resolved_at,
              p1.nickname as reporter_name, p1.email as reporter_email,
              m.user_a, m.user_b,
              p2.nickname as user_a_name, p3.nickname as user_b_name
       FROM reports r
       LEFT JOIN users u1 ON u1.id = r.reporter_id
       LEFT JOIN profiles p1 ON p1.user_id = r.reporter_id
       LEFT JOIN matches m ON m.id = r.match_id
       LEFT JOIN profiles p2 ON p2.user_id = m.user_a
       LEFT JOIN profiles p3 ON p3.user_id = m.user_b
       ${where}
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) as total FROM reports r ${where}`).first()
  ]);

  return json({
    reports: reportRows.results || [],
    pagination: { page, limit, total: countRow.total, totalPages: Math.ceil(countRow.total / limit) }
  });
};

export const onRequestPut = async ({ request, env }) => {
  const admin = await getAdminUser(request, env);
  if (!admin) return json({ error: 'forbidden' }, 403);

  let body;
  try { body = await request.json(); } catch(e) {
    return json({ error: 'invalid_body' }, 400);
  }

  const { reportId, action, adminNote } = body || {};
  if (!reportId || !action || !['dismiss', 'warn', 'ban'].includes(action)) {
    return json({ error: 'invalid_params' }, 400);
  }

  const report = await env.DB.prepare(
    `SELECT * FROM reports WHERE id = ?`
  ).bind(reportId).first();

  if (!report) return json({ error: 'not_found' }, 404);

  // Get the match to find the reported user
  const match = await env.DB.prepare(
    `SELECT * FROM matches WHERE id = ?`
  ).bind(report.match_id).first();

  if (!match) return json({ error: 'match_not_found' }, 404);

  const reportedUser = match.user_a === report.reporter_id ? match.user_b : match.user_a;

  // Apply action
  if (action === 'ban') {
    // Ban the reported user's shadows
    await env.DB.prepare(
      `UPDATE profiles SET is_active = 0 WHERE user_id = ?`
    ).bind(reportedUser).run();

    // Close all their matches
    await env.DB.prepare(
      `UPDATE matches SET status = 'closed', closed_at = ? WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'`
    ).bind(Date.now(), reportedUser, reportedUser).run();
  }

  // Record violation
  if (action !== 'dismiss') {
    await env.DB.prepare(
      `INSERT INTO content_violations (user_id, report_id, action, admin_id, admin_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(reportedUser, reportId, action, admin.id, adminNote || '', Date.now()).run();
  }

  // Mark report as resolved
  await env.DB.prepare(
    `UPDATE reports SET status = 'resolved', admin_note = ?, resolved_at = ? WHERE id = ?`
  ).bind(adminNote || '', Date.now(), reportId).run();

  return json({ ok: true, action: action });
};
