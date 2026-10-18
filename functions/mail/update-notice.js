/**
 * Cloudflare Pages Function
 * 路径: /functions/mail/update-notice.js
 * 路由: POST /mail/update-notice   body: { "to": "3099316459@qq.com" }
 *
 * 用途：把"网站更新"通知邮件（诚实版：带署名、不伪装系统通知）发到指定邮箱。
 *       复用站点已有的 Resend 配置（env.RESEND_API_KEY / env.MAIL_FROM）。
 *
 * 注意：
 * 1. 这是临时发信工具，测完建议删掉本文件，避免留下一个开放发信接口。
 * 2. 邮件正文与 mail-draft-update.html 中 EMAIL-FRAGMENT 完全一致；改文案请同步改两处。
 * 3. 发送前把正文里"最近在改它，加了些东西"改成真话——这封邮件的出厂标准是每行都真。
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

const EMAIL_HTML = `
    <div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1C2333;">
      <h2 style="font-size:20px;margin:0 0 16px;">网站更新了</h2>
      <p style="font-size:14px;line-height:1.8;color:#444;margin:0 0 12px;">之前你在我做的那个站上登过号。</p>
      <p style="font-size:14px;line-height:1.8;color:#444;margin:0 0 12px;">最近在改它，加了些东西。有空的话，进去看看——回不回都行，我就是想说一声。</p>
      <p style="margin:28px 0;">
        <a href="https://social-6za.pages.dev" style="background:#C4526E;color:#fff;padding:12px 28px;border-radius:4px;text-decoration:none;font-size:15px;display:inline-block;">进去看看</a>
      </p>
      <p style="font-size:12.5px;color:#999;line-height:1.7;margin:0;">按钮点不了的话，复制这个链接到浏览器：<br>https://social-6za.pages.dev</p>
      <p style="font-size:12px;color:#bbb;line-height:1.7;margin:24px 0 0;">心镜·社交 · yourlover.cc.cd<br>——（这里署你的名）</p>
    </div>
  `;

const lastRequestByIp = new Map();
const THROTTLE_WINDOW_MS = 60 * 1000;

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

  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    return jsonResponse({ error: 'missing_mail_config', message: 'RESEND_API_KEY / MAIL_FROM 未配置' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body', message: '请求体必须是 JSON' }, 400);
  }

  const to = (body?.to || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 200) {
    return jsonResponse({ error: 'invalid_email', message: '邮箱格式不正确' }, 400);
  }

  try {
    const mailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [to],
        subject: '网站更新了，你有空可以看看',
        html: EMAIL_HTML,
      }),
    });

    if (!mailResp.ok) {
      const detail = (await mailResp.text().catch(() => '')).slice(0, 300);
      return jsonResponse({ error: 'mail_send_failed', detail }, 502);
    }
  } catch (err) {
    return jsonResponse({ error: 'mail_network_error', message: '邮件服务网络错误' }, 504);
  }

  return jsonResponse({ ok: true, message: '已发送到 ' + to });
};
