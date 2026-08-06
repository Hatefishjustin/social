/**
 * Cloudflare Pages Function
 * 路径: /auth/verify
 * GET - 显示登录确认页面（不立即消费 token）
 * POST - 确认登录，创建会话
 */
import { getRequestMeta } from '../_lib/ip.js';

function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function html(body) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function errorPage(title, msg) {
  return html(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>${title}</title><style>body{font-family:-apple-system,"PingFang SC",sans-serif;background:#0a0a0a;color:#ddd;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}.card{background:#111;border:1px solid #222;border-radius:16px;padding:32px 24px;max-width:360px;width:100%}h2{color:#fff;margin:0 0 10px;font-size:18px}p{color:#888;font-size:14px;line-height:1.6;margin:0 0 20px}a{color:#FF3B5C;text-decoration:none}</style></head><body><div class="card"><h2>${title}</h2><p>${msg}</p><a href="/">返回首页</a></div></body></html>`);
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) return errorPage('无效链接', '缺少登录令牌');

  const tokenRow = await env.DB.prepare(
    `SELECT email, expires_at, used FROM login_tokens WHERE token = ?`
  ).bind(token).first();

  if (!tokenRow) return errorPage('链接无效', '登录链接无效或已过期');
  if (tokenRow.used) return errorPage('已使用', '此登录链接已被使用');
  if (Date.now() > tokenRow.expires_at) return errorPage('已过期', '登录链接已过期');

  const email = tokenRow.email;
  const masked = email.replace(/(.{2}).*(@.*)/, '$1***$2');

  return html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>登录确认 - 心镜·社交</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
    background:#0a0a0a;color:#ddd;min-height:100vh;
    display:flex;align-items:center;justify-content:center;
    padding:20px;
  }
  .card{
    background:#111;border:1px solid #222;border-radius:20px;
    padding:36px 28px;max-width:400px;width:100%;text-align:center;
  }
  .icon{font-size:48px;margin-bottom:16px}
  .title{font-size:20px;font-weight:700;color:#fff;margin-bottom:6px}
  .email{font-size:14px;color:#888;margin-bottom:28px;word-break:break-all}
  .btn{
    display:block;width:100%;padding:14px;border-radius:100px;
    font-size:16px;font-weight:600;cursor:pointer;border:none;
    font-family:inherit;transition:all .2s;margin-bottom:12px;
  }
  .btn-confirm{background:#FF3B5C;color:#fff}
  .btn-confirm:hover{background:#C4293F;box-shadow:0 6px 24px rgba(255,59,92,.25)}
  .btn-confirm:active{transform:scale(.97)}
  .btn-confirm:disabled{opacity:.4;pointer-events:none}
  .btn-copy{
    background:transparent;color:#888;border:1px solid #333;
  }
  .btn-copy:active{background:rgba(255,255,255,.04)}
  .hint{
    font-size:12px;color:#666;margin-top:20px;line-height:1.6;
  }
  .hint strong{color:#FF3B5C}
  .toast{
    position:fixed;bottom:40px;left:50%;transform:translateX(-50%);
    background:#00C853;color:#000;padding:10px 24px;border-radius:10px;
    font-size:13px;z-index:99;opacity:0;transition:opacity .3s;pointer-events:none;
  }
  .toast.show{opacity:1}
</style>
</head>
<body>
<div class="card">
  <div class="icon">🔐</div>
  <div class="title">登录确认</div>
  <div class="email">${masked}</div>
  <button class="btn btn-confirm" id="confirmBtn" onclick="doLogin()">确认登录</button>
  <button class="btn btn-copy" onclick="copyLink()">复制链接到其他浏览器</button>
  <div class="hint">
    如果你在<strong>邮箱 App 内</strong>看到此页面，<br>
    请先点「复制链接到其他浏览器」，<br>
    再贴到你的<strong>主浏览器</strong>中打开后点「确认登录」。
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
var token = '${token}';
function showToast(msg){
  var t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  setTimeout(function(){t.classList.remove('show')},2000);
}
function copyLink(){
  var url=location.origin+'/auth/verify?token='+token;
  if(navigator.clipboard){
    navigator.clipboard.writeText(url).then(function(){showToast('已复制，请到主浏览器粘贴打开')}).catch(function(){promptCopy(url)});
  }else{
    promptCopy(url);
  }
}
function promptCopy(url){
  var input=document.createElement('textarea');
  input.value=url;document.body.appendChild(input);
  input.select();document.execCommand('copy');input.remove();
  showToast('已复制，请到主浏览器粘贴打开');
}
function doLogin(){
  var btn=document.getElementById('confirmBtn');
  btn.disabled=true;btn.textContent='登录中...';
  var form=document.createElement('form');
  form.method='POST';form.action='/auth/verify?token='+token;
  document.body.appendChild(form);form.submit();
}
</script>
</body>
</html>`);
};

export const onRequestPost = async ({ request, env }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) return errorPage('无效链接', '缺少登录令牌');

  const tokenRow = await env.DB.prepare(
    `SELECT email, expires_at, used FROM login_tokens WHERE token = ?`
  ).bind(token).first();

  if (!tokenRow) return errorPage('链接无效', '登录链接无效或已过期');
  if (tokenRow.used) return errorPage('已使用', '此登录链接已被使用');
  if (Date.now() > tokenRow.expires_at) return errorPage('已过期', '登录链接已过期');

  const email = tokenRow.email;

  await env.DB.prepare(
    `UPDATE login_tokens SET used = 1 WHERE token = ?`
  ).bind(token).run();

  let user = await env.DB.prepare(
    `SELECT id FROM users WHERE email = ?`
  ).bind(email).first();

  if (!user) {
    const meta = getRequestMeta(request);
    const result = await env.DB.prepare(
      `INSERT INTO users (email, created_at, ip, country, city, user_agent) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(email, Date.now(), meta.ip, meta.country, meta.city, meta.ua).run();
    user = { id: result.meta.last_row_id };
  }

  const sessionToken = generateToken();
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
  ).bind(sessionToken, user.id, expiresAt).run();

  // Generate 6-digit cross-browser login code (valid 30 min)
  const codeDigits = '0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += codeDigits[Math.floor(Math.random() * 10)];
  await env.DB.prepare(
    `INSERT INTO device_codes (code, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).bind(code, user.id, Date.now() + 30 * 60 * 1000, Date.now()).run();

  // Store IP-based trust for auto-login (valid 5 min)
  const clientIP = request.headers.get('CF-Connecting-IP') || '';
  if (clientIP) {
    try {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO ip_trust (ip, user_id, expires_at) VALUES (?, ?, ?)`
      ).bind(clientIP, user.id, Date.now() + 5 * 60 * 1000).run();
    } catch(e) { console.error('ip_trust insert failed:', e.message); }
  }

  const headers = new Headers({
    'Location': '/?login_code=' + code,
    'Set-Cookie': `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`,
  });

  return new Response(null, { status: 302, headers });
};
