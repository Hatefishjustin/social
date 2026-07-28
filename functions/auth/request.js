/**
 * Cloudflare Pages Function
 * 路径: /functions/auth/request.js
 * 路由: POST /auth/request
 *
 * 使用 Resend 发送魔法链接登录邮件
 * 发件域名: yourlover.cc.cd (已在 Resend 验证)
 * 跳转域名: social-6za.pages.dev (当前站点)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

const lastRequestByIp = new Map();
const THROTTLE_WINDOW_MS = 60 * 1000;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PENDING_RESULT_CHARS = 100000;

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequestPost = async ({ request, env }) => {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  const last = lastRequestByIp.get(ip);
  if (last && now - last < THROTTLE_WINDOW_MS) {
    return jsonResponse({ error: 'rate_limited', message: '发送太频繁，请 1 分钟后再试' }, 429);
  }
  lastRequestByIp.set(ip, now);

  if (!env.DB) {
    return jsonResponse({ error: 'missing_db', message: '数据库未配置' }, 500);
  }
  if (!env.RESEND_API_KEY) {
    return jsonResponse({ error: 'missing_resend_key', message: 'RESEND_API_KEY 环境变量未设置' }, 500);
  }
  if (!env.MAIL_FROM) {
    return jsonResponse({ error: 'missing_mail_from', message: 'MAIL_FROM 环境变量未设置' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body', message: '请求体必须是 JSON' }, 400);
  }

  const email = (body?.email || '').trim().toLowerCase();
  if (!email || !EMAIL_REGEX.test(email) || email.length > 200) {
    return jsonResponse({ error: 'invalid_email', message: '邮箱格式不正确' }, 400);
  }

  let pendingResultJson = null;
  if (body?.pendingResult && typeof body.pendingResult === 'object') {
    try {
      const serialized = JSON.stringify(body.pendingResult);
      if (serialized.length <= MAX_PENDING_RESULT_CHARS) {
        pendingResultJson = serialized;
      }
    } catch (e) {}
  }

  const token = crypto.randomUUID();
  const expiresAt = now + 15 * 60 * 1000;

  try {
    await env.DB.prepare(
      'INSERT INTO login_tokens (token, email, expires_at, used, pending_result_json) VALUES (?, ?, ?, 0, ?)'
    ).bind(token, email, expiresAt, pendingResultJson).run();
  } catch (err) {
    return jsonResponse({ error: 'db_error', message: '数据库写入失败: ' + String(err?.message || err) }, 500);
  }

  const origin = new URL(request.url).origin;
  const verifyUrl = `${origin}/auth/verify?token=${token}`;
  const hasPendingResult = !!pendingResultJson;

  const emailHtml = `
    <div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1C2333;">
      <h2 style="font-size:20px;margin-bottom:16px;">🔐 登录验证</h2>
      <p style="font-size:14px;line-height:1.8;color:#444;">你正在登录心镜·社交，请点击下方按钮完成验证。链接 15 分钟内有效。</p>
      ${hasPendingResult ? `<p style="font-size:13px;line-height:1.7;color:#888;background:#f7f2f4;padding:10px 14px;border-radius:6px;">你之前完成了心理测评，登录后将自动保存结果。</p>` : ''}
      <p style="margin:28px 0;">
        <a href="${verifyUrl}" style="background:#C4526E;color:#fff;padding:12px 28px;border-radius:4px;text-decoration:none;font-size:15px;display:inline-block;">验证并登录</a>
      </p>
      <p style="font-size:12.5px;color:#999;line-height:1.7;">如果按钮无法点击，请复制以下链接到浏览器：<br>${verifyUrl}</p>
      <p style="font-size:12px;color:#bbb;margin-top:24px;">如非本人操作，请忽略此邮件。</p>
    </div>
  `;

  try {
    const mailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [email],
        subject: '🔐 心镜·社交 - 登录验证',
        html: emailHtml,
      }),
    });

    if (!mailResp.ok) {
      const errBody = await mailResp.text().catch(() => '');
      let message = '邮件发送失败';
      if (mailResp.status === 401 || mailResp.status === 403) {
        message = 'Resend API Key 无效';
      } else if (mailResp.status === 422) {
        message = '发件人域名未验证或收件人邮箱被拒绝';
      } else if (mailResp.status === 429) {
        message = '发送太频繁，请稍后再试';
      }
      return jsonResponse({
        error: 'mail_send_failed',
        message,
        detail: errBody.slice(0, 500),
      }, 502);
    }
  } catch (err) {
    return jsonResponse({ error: 'mail_network_error', message: '邮件服务网络错误' }, 504);
  }

  return jsonResponse({
    ok: true,
    message: hasPendingResult
      ? '验证邮件已发送！登录后将自动保存你的测评结果。'
      : '验证邮件已发送！请查收邮箱。',
  });
};
