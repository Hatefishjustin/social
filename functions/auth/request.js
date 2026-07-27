/**
 * Cloudflare Pages Function
 * 路径: /auth/request
 * 方法: POST
 * 功能: 发送魔法链接登录邮件（使用 Brevo API）
 * 
 * 环境变量:
 *   BREVO_API_KEY = 你的 Brevo API Key
 *   MAIL_FROM = 发件人邮箱（如 login@yourdomain.com）
 */

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

export const onRequestPost = async ({ request, env }) => {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { email } = body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: 'invalid_email', message: '请输入有效的邮箱地址' }, 400);
  }

  const normalizedEmail = email.toLowerCase().trim();

  // 生成一次性登录令牌
  const token = generateToken();
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15分钟

  await env.DB.prepare(
    `INSERT INTO login_tokens (token, email, expires_at, used)
     VALUES (?, ?, ?, 0)`
  ).bind(token, normalizedEmail, expiresAt).run();

  // 发送邮件（Brevo API）
  const origin = new URL(request.url).origin;
  const verifyUrl = `${origin}/auth/verify?token=${token}`;

  const html = `
    <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:24px;background:#000;color:#fff;border-radius:16px;">
      <h2 style="color:#FF3B5C;margin-bottom:16px;">心镜 · 登录验证</h2>
      <p style="color:rgba(255,255,255,0.62);line-height:1.6;">你正在尝试登录心镜社交平台。点击下方按钮完成登录：</p>
      <a href="${verifyUrl}" style="display:inline-block;padding:14px 28px;background:#FF3B5C;color:#fff;text-decoration:none;border-radius:100px;margin:20px 0;font-weight:600;">立即登录</a>
      <p style="color:rgba(255,255,255,0.38);font-size:13px;">此链接15分钟内有效，且只能使用一次。如非本人操作，请忽略此邮件。</p>
      <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
      <p style="color:rgba(255,255,255,0.38);font-size:12px;">心镜 · 基于心理学测评的社交平台</p>
    </div>
  `;

  try {
    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: {
          name: '心镜社交',
          email: env.MAIL_FROM || 'noreply@brevo.com',
        },
        to: [{ email: normalizedEmail }],
        subject: '心镜登录验证',
        htmlContent: html,
      }),
    });

    if (!brevoRes.ok) {
      const err = await brevoRes.text();
      return jsonResponse({ error: 'email_failed', message: '邮件发送失败', detail: err.slice(0, 200) }, 502);
    }

    return jsonResponse({ ok: true, message: '登录链接已发送，请查收邮件' });
  } catch (err) {
    return jsonResponse({ error: 'email_error', message: '邮件服务暂时不可用' }, 502);
  }
};
