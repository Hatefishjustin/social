/**
 * Cloudflare Pages Function
 * 路径: /chat/send
 * 方法: POST
 */

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

async function getCurrentUser(request, env) {
  if (!env.DB) return null;
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) return null;
  const row = await env.DB.prepare(
    `SELECT sessions.expires_at as expires_at, users.id as user_id, users.email as email
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { id: row.user_id, email: row.email };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// 敏感词分级
// HIGH: 明确恶意/违规，命中即计入违规计数
// LOW: 常见口语易误伤，仅过滤不单独计入违规计数
const SENSITIVE_WORDS = {
  high: [
    '色情', '赌博', '毒品', '诈骗', '传销', '裸聊', '约炮', '包养', '裸贷',
    '自杀', '自残', '杀人', '暴力', '血腥', '邪教', '极端', '恐怖主义',
  ],
  low: [
    '微信', 'QQ', '电话', '手机号', '支付宝', '银行卡', '转账', '汇款',
    '加v', '加V', '加微', 'vx', 'VX', 'wx', 'WX', '二维码',
    '出来', '见面', '开房', '酒店', '宾馆', '地址', '定位', '位置'
  ]
};

// 累计严重度阈值：单次≥3 或累计≥6 触发自动关闭
const SEVERITY_THRESHOLD_SINGLE = 3;
const SEVERITY_THRESHOLD_CUMULATIVE = 6;

function buildRegex(word) {
  // 对正则特殊字符转义后构建忽略大小写的全局匹配
  return new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
}

function filterContent(text) {
  if (!text) return { filtered: '', highViolations: [], lowViolations: [], severity: 0 };

  let filtered = text;
  const highViolations = [];
  const lowViolations = [];

  // 先匹配 HIGH（优先级更高，避免被 LOW 的 ** 覆盖后误判）
  SENSITIVE_WORDS.high.forEach(word => {
    if (text.toLowerCase().includes(word.toLowerCase())) {
      highViolations.push(word);
      filtered = filtered.replace(buildRegex(word), '**');
    }
  });

  SENSITIVE_WORDS.low.forEach(word => {
    if (text.toLowerCase().includes(word.toLowerCase())) {
      lowViolations.push(word);
      filtered = filtered.replace(buildRegex(word), '**');
    }
  });

  const severity = highViolations.length * 2 + lowViolations.length * 1;
  return { filtered, highViolations, lowViolations, severity };
}

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { matchId, content } = body || {};
  if (!matchId || !content || typeof content !== 'string') {
    return jsonResponse({ error: 'invalid_body', message: '缺少 matchId 或 content' }, 400);
  }

  if (content.length > 500) {
    return jsonResponse({ error: 'too_long', message: '单条消息最多500字' }, 400);
  }

  const match = await env.DB.prepare(
    `SELECT * FROM matches
     WHERE id = ? AND (user_a = ? OR user_b = ?) AND status = 'accepted'`
  ).bind(matchId, user.id, user.id).first();

  if (!match) {
    return jsonResponse({ error: 'not_found', message: '对话不存在或已关闭' }, 404);
  }

  const { filtered, highViolations, lowViolations, severity } = filterContent(content);
  const allViolations = [...highViolations, ...lowViolations];

  if (allViolations.length > 0) {
    // 记录违规（带严重度，方便后续统计）
    try {
      await env.DB.prepare(
        `INSERT INTO content_violations (user_id, action, match_id, sender_id, content, violation_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        user.id, 'auto_filter', matchId, user.id, content,
        `severity=${severity} high=[${highViolations.join(',')}] low=[${lowViolations.join(',')}]`,
        Date.now()
      ).run();

      // 查询该对话的历史累计严重度
      const severityRows = await env.DB.prepare(
        `SELECT violation_type FROM content_violations WHERE match_id = ?`
      ).bind(matchId).all();

      let cumulativeSeverity = 0;
      (severityRows.results || []).forEach(row => {
        const m = (row.violation_type || '').match(/severity=(\d+)/);
        if (m) cumulativeSeverity += parseInt(m[1]) || 0;
      });

      // 单次严重触发 或 累计严重触发 → 自动关闭
      if (severity >= SEVERITY_THRESHOLD_SINGLE || cumulativeSeverity >= SEVERITY_THRESHOLD_CUMULATIVE) {
        await env.DB.prepare(
          `UPDATE matches SET status = 'closed', closed_at = ? WHERE id = ?`
        ).bind(Date.now(), matchId).run();

        await env.DB.prepare(
          `INSERT INTO messages (match_id, sender_id, content, is_system, created_at)
           VALUES (?, NULL, ?, 1, ?)`
        ).bind(matchId, '【系统提示】该对话因多次触发安全规则已被自动关闭。如有疑问请联系平台客服。', Date.now()).run();

        return jsonResponse({
          error: 'auto_closed',
          message: '该对话因多次触发安全规则已被自动关闭',
          filtered
        }, 403);
      }
    } catch (e) {
      // 违规记录/自动关闭失败不阻断消息发送，仅记录日志，避免 Worker 1101
      console.error('content_violations write failed:', e);
    }
  }

  await env.DB.prepare(
    `INSERT INTO messages (match_id, sender_id, content, created_at)
     VALUES (?, ?, ?, ?)`
  ).bind(matchId, user.id, filtered, Date.now()).run();

  // 通知对方有新消息
  const recipientId = match.user_a === user.id ? match.user_b : match.user_a;
  if (recipientId) {
    const preview = filtered.length > 40 ? filtered.substring(0, 37) + '...' : filtered;
    await env.DB.prepare(
      `INSERT INTO notifications (user_id, type, target_type, target_id, actor_email, content_preview, is_read, created_at)
       VALUES (?, 'chat_message', 'chat', ?, ?, ?, 0, ?)`
    ).bind(recipientId, matchId, user.email, preview, Date.now()).run();
  }

  return jsonResponse({ ok: true, filtered: allViolations.length > 0 });
};
