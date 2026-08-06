/**
 * Cloudflare Pages Function
 * 路径: /api/admin/users
 * GET: 管理员查看所有注册用户列表 (?page=1) 或用户详情 (?id=X)
 * PUT: 管理员修改用户备注（body: { adminNote }，最大 200 字符）
 * 返回: 用户账号/注册时间/IP/国家/城市/设备/OS/浏览器/测评次数/塔罗次数/
 *       登录状态/最近活跃/管理员备注/最近登录/匿名行为画像
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

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const PAGE_SIZE = 50;
  const offset = (page - 1) * PAGE_SIZE;

  const db = env.DB;

  // 单条详情：?id=X
  const idParam = url.searchParams.get('id');
  if (idParam) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return jsonResponse({ error: 'invalid_id', message: '无效的用户 ID' }, 400);
    }
    const detailSql = `
      SELECT 
        u.id, u.email, u.display_name, u.avatar_url, u.is_admin, u.created_at,
        u.ip, u.country, u.city, u.user_agent,
        u.admin_note,
        u.last_login_ip, u.last_login_country, u.last_login_city, u.last_login_at,
        p.nickname, p.gender, p.age_group,
        (SELECT COUNT(*) FROM quiz_results WHERE user_id = u.id) as quizCount,
        (SELECT COUNT(*) FROM tarot_readings WHERE user_id = u.id) as tarotCount,
        (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND expires_at > ?) as activeSessions,
        (SELECT MAX(created_at) FROM activity_log WHERE user_id = u.id) as lastActive,
        (SELECT ip FROM activity_log WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as lastActivityIp,
        (SELECT country FROM activity_log WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as lastActivityCountry,
        (SELECT city FROM activity_log WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as lastActivityCity,
        (SELECT COUNT(*) FROM wall_posts WHERE user_id = u.id) as wall_posts,
        (SELECT COUNT(*) FROM askbox_questions WHERE asker_id = u.id) as askboxAsked,
        (SELECT COUNT(*) FROM askbox_questions WHERE target_id = u.id) as askboxReceived,
        (SELECT COUNT(*) FROM moments WHERE user_id = u.id) as momentCount,
        (SELECT MAX(created_at) FROM (
          SELECT MAX(created_at) as created_at FROM quiz_results WHERE user_id = u.id
          UNION ALL SELECT MAX(created_at) FROM tarot_readings WHERE user_id = u.id
          UNION ALL SELECT MAX(created_at) FROM askbox_questions WHERE asker_id = u.id OR target_id = u.id
          UNION ALL SELECT MAX(created_at) FROM moments WHERE user_id = u.id
        )) as lastBehaviorAt
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.id = ?
    `;
    const row = await db.prepare(detailSql).bind(Date.now(), id).first();
    if (!row) return jsonResponse({ error: 'not_found', message: '用户不存在' }, 404);

    // 匿名行为画像：关联 anonymous_visitors + activity_log
    const visitors = await db.prepare(
      `SELECT id, visitor_id, first_ip, first_country, first_city, created_at
       FROM anonymous_visitors WHERE linked_user_id = ? ORDER BY created_at ASC`
    ).bind(id).all();

    // 通过 visitor_id 关联的匿名行为日志
    const visitorIds = (visitors.results || []).map(v => v.visitor_id);
    let anonActivity = [];
    if (visitorIds.length > 0) {
      const placeholders = visitorIds.map(() => '?').join(',');
      const anonRows = await db.prepare(
        `SELECT action, target_type, target_id, content, ip, country, city, is_anonymous, visitor_id, created_at
         FROM activity_log WHERE visitor_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 50`
      ).bind(...visitorIds).all();
      anonActivity = anonRows.results || [];
    }

    // 匿名提问箱关联（通过 visitor_token，不改 askbox 既有链路）
    const anonQuestions = await db.prepare(
      `SELECT id, target_id, content, is_anonymous, created_at, visitor_token
       FROM askbox_questions
       WHERE asker_id IS NULL AND visitor_token IS NOT NULL AND visitor_token != ''
         AND visitor_token IN (
           SELECT visitor_token FROM askbox_questions WHERE asker_id = ?
         )`
    ).bind(id).all();

    const device = parseUserDevice(row.user_agent, row.id);
    return jsonResponse({
      user: {
        ...row,
        ...device,
        anonymousVisitors: visitors.results || [],
        anonymousVisits: (visitors.results || []).length,
        firstVisitAt: visitors.results && visitors.results.length > 0 ? visitors.results[0].created_at : null,
        anonActivityCount: anonActivity.length,
        anonActivity: anonActivity,
        anonQuestions: (anonQuestions.results || []).length,
      },
    });
  }

  // 列表：?page=N
  const users = await db.prepare(`
    SELECT 
      u.id, u.email, u.display_name, u.avatar_url, u.is_admin, u.created_at,
      u.ip, u.country, u.city, u.user_agent,
      u.admin_note,
      u.last_login_at,
      (SELECT COUNT(*) FROM quiz_results WHERE user_id = u.id) as quizCount,
      (SELECT COUNT(*) FROM tarot_readings WHERE user_id = u.id) as tarotCount,
      (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND expires_at > ?) as activeSessions,
      (SELECT MAX(created_at) FROM activity_log WHERE user_id = u.id) as lastActive,
      (SELECT ip FROM activity_log WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as lastActivityIp,
      (SELECT country FROM activity_log WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as lastActivityCountry,
      (SELECT city FROM activity_log WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as lastActivityCity,
      (SELECT COUNT(*) FROM wall_posts WHERE user_id = u.id) as wall_posts,
      (SELECT COUNT(*) FROM askbox_questions WHERE target_id = u.id) as questions,
      (SELECT COUNT(*) FROM askbox_questions WHERE target_id = u.id AND answer_content IS NOT NULL AND answer_content != '') as answers,
      (SELECT COUNT(*) FROM activity_log WHERE user_id = u.id AND is_anonymous = 1) as anonymous_actions,
      (SELECT COUNT(*) FROM page_views WHERE user_id = u.id) as page_views,
      (SELECT COUNT(*) FROM anonymous_visitors WHERE linked_user_id = u.id) as anonymousVisits
    FROM users u
    ORDER BY u.id ASC
    LIMIT ? OFFSET ?
  `).bind(Date.now(), PAGE_SIZE, offset).all();

  const countRow = await db.prepare('SELECT COUNT(*) as total FROM users').first();
  const total = countRow.total;

  return jsonResponse({
    users: users.results.map((u) => ({
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      avatar_url: u.avatar_url,
      is_admin: u.is_admin,
      createdAt: u.created_at,
      ip: u.ip || '',
      country: u.country || '',
      city: u.city || '',
      admin_note: u.admin_note || '',
      lastLoginAt: u.last_login_at || null,
      quizCount: u.quizCount || 0,
      tarotCount: u.tarotCount || 0,
      activeSessions: u.activeSessions || 0,
      lastActive: u.lastActive || null,
      lastActivityIp: u.lastActivityIp || '',
      lastActivityCountry: u.lastActivityCountry || '',
      lastActivityCity: u.lastActivityCity || '',
      wall_posts: u.wall_posts || 0,
      questions: u.questions || 0,
      answers: u.answers || 0,
      anonymous_actions: u.anonymous_actions || 0,
      anonymousVisits: u.anonymousVisits || 0,
      page_views: u.page_views || 0,
      ...parseUserDevice(u.user_agent, u.id),
    })),
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    },
  });
};

/**
 * PUT /api/admin/users?id=X
 * 修改用户管理员备注
 * body: { adminNote: string }（最大 200 字符）
 */
export const onRequestPut = async ({ request, env }) => {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);

  const user = await getCurrentUser(request, env);
  if (!user || !user.isAdmin) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  const url = new URL(request.url);
  const idParam = url.searchParams.get('id');
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonResponse({ error: 'invalid_id', message: '无效的用户 ID' }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const adminNote = (body.adminNote || body.admin_note || '').trim();
  if (adminNote.length > 200) {
    return jsonResponse({ error: 'note_too_long', message: '备注不能超过 200 字符' }, 400);
  }

  const exists = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(id).first();
  if (!exists) return jsonResponse({ error: 'not_found', message: '用户不存在' }, 404);

  await env.DB.prepare(
    `UPDATE users SET admin_note = ? WHERE id = ?`
  ).bind(adminNote, id).run();

  return jsonResponse({ ok: true, adminNote });
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};

/**
 * 从 UA 解析设备/OS/浏览器（兼容旧数据无 UA）
 */
function parseUserDevice(userAgent, userId) {
  if (!userAgent) {
    return { device: '', os: '', browser: '' };
  }
  const s = String(userAgent);
  let device = 'desktop';
  if (/iPad|Tablet/i.test(s)) device = 'tablet';
  else if (/Mobile|iPhone|Android|iPod|Windows Phone|MicroMessenger/i.test(s)) device = 'mobile';

  let os = '其他';
  if (/iPhone|iPad|iPod/i.test(s)) {
    const verMatch = s.match(/OS (\d+[._]\d+)/);
    os = 'iOS' + (verMatch ? ' ' + verMatch[1].replace('_', '.') : '');
  } else if (/Android/i.test(s)) {
    const verMatch = s.match(/Android (\d+(?:\.\d+)?)/);
    os = 'Android' + (verMatch ? ' ' + verMatch[1] : '');
  } else if (/Windows/i.test(s)) {
    os = /Windows NT 10\.0/.test(s) ? 'Windows 10/11' : (/Windows NT 6\.3/.test(s) ? 'Windows 8.1' : (/Windows NT 6\.1/.test(s) ? 'Windows 7' : 'Windows'));
  } else if (/Macintosh|Mac OS/i.test(s)) {
    const verMatch = s.match(/Mac OS X (\d+[._]\d+)/);
    os = 'macOS' + (verMatch ? ' ' + verMatch[1].replace('_', '.') : '');
  } else if (/Linux/i.test(s)) {
    os = 'Linux';
  }

  let browser = '其他';
  if (/MicroMessenger/i.test(s)) {
    const verMatch = s.match(/MicroMessenger\/(\d+(?:\.\d+)*)/);
    browser = 'WeChat' + (verMatch ? ' ' + verMatch[1] : '');
  } else if (/Edg\//i.test(s)) {
    const verMatch = s.match(/Edg\/(\d+(?:\.\d+)*)/);
    browser = 'Edge' + (verMatch ? ' ' + verMatch[1] : '');
  } else if (/Chrome\//i.test(s)) {
    const verMatch = s.match(/Chrome\/(\d+(?:\.\d+)*)/);
    browser = 'Chrome' + (verMatch ? ' ' + verMatch[1] : '');
  } else if (/Firefox\//i.test(s)) {
    const verMatch = s.match(/Firefox\/(\d+(?:\.\d+)*)/);
    browser = 'Firefox' + (verMatch ? ' ' + verMatch[1] : '');
  } else if (/Version\/(\d+(?:\.\d+)*).*Safari\//.test(s)) {
    const verMatch = s.match(/Version\/(\d+(?:\.\d+)*)/);
    browser = 'Safari' + (verMatch ? ' ' + verMatch[1] : '');
  } else if (/Safari\//i.test(s)) {
    browser = 'Safari';
  }

  return { device, os, browser, user_agent: s.slice(0, 500) };
}