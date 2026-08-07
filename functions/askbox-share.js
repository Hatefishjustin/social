/**
 * Cloudflare Pages Function
 * 路径: /askbox-share
 * 用途: 微信分享卡片落地页
 *   - 根据 ?u=user_id 读取用户昵称，服务端渲染 Open Graph 标签
 *   - 微信抓取后卡片显示「<昵称> 的提问箱」
 *   - 用户点击后自动跳转回 /qa.html?u=<user_id>
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const origin = url.origin;
  const userId = (url.searchParams.get('u') || '').trim();

  let name = '';
  let answered = 0;

  if (userId && env.DB) {
    try {
      const profile = await env.DB.prepare(
        'SELECT nickname FROM profiles WHERE user_id = ? AND is_active = 1'
      ).bind(userId).first();
      if (profile && profile.nickname) name = String(profile.nickname).trim();

      const cnt = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM askbox_questions WHERE target_id = ? AND answered_at IS NOT NULL'
      ).bind(userId).first();
      answered = cnt && cnt.n ? Number(cnt.n) : 0;
    } catch (e) {
      // 降级为通用文案，不影响跳转
    }
  }

  const redirectUrl = userId
    ? origin + '/qa.html?u=' + encodeURIComponent(userId)
    : origin + '/qa.html';

  const title = name ? 'SoulMirror 心镜 · ' + name + ' 的提问箱' : 'SoulMirror 心镜 · 匿名提问箱';
  const desc = name
    ? (answered > 0
        ? 'SoulMirror 心镜｜' + name + ' 的匿名提问箱，已收录 ' + answered + ' 条回答，来聊聊吧～'
        : 'SoulMirror 心镜｜' + name + ' 的匿名提问箱，有什么想说的都可以来问～')
    : 'SoulMirror 心镜 · 匿名提问，温柔回应。';
  // 微信/主流平台分享封面：使用标准 OG 尺寸 1200×630 的 share-cover.png
  // （share-card.png 为 440×435 小图，微信常无法渲染为分享卡片封面）
  const image = origin + '/assets/share-cover.png';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:url" content="${esc(redirectUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SoulMirror 心镜">
<meta http-equiv="refresh" content="0; url=${esc(redirectUrl)}">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d0710;color:#f7ede8;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;text-align:center}
  a{color:#dfb6b2;text-decoration:none}
</style>
</head>
<body>
  <div>
    <p style="font-size:18px;font-weight:600">${esc(title)}</p>
    <p style="font-size:13px;color:#b3a3ae">正在打开，请稍候…</p>
    <p style="font-size:13px;color:#7c6c78"><a href="${esc(redirectUrl)}">点击直达</a></p>
  </div>
  <script>location.replace('${esc(redirectUrl)}');</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 分享落地页包含 ?u= 目标参数，禁止缓存（防微信命中缓存丢失 u 参数导致串号）：
      // no-store 禁缓存 + private 仅允许私人存储 + max-age=0 立即过期，
      // 同时不让响应被 CDN/共享代理缓存（不恢复 public,max-age=300，避免串号回归）
      'Cache-Control': 'private, no-cache, no-store, max-age=0',
    },
  });
};