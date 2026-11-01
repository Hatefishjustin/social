/**
 * Cloudflare Pages Function
 * 全局中间件：旧域名跳转 + 统一安全响应头
 */
export const onRequest = async (context) => {
  const url = new URL(context.request.url);

  // 历史遗留域名 → 主域名
  if (url.hostname === 'soulmirror.disabled.pages.dev') {
    return Response.redirect('https://soulmirror.cc.cd' + url.pathname + url.search, 301);
  }

  const res = await context.next();
  const headers = new Headers(res.headers);

  // 全站同源，移除接口层遗留的通配 CORS
  headers.delete('Access-Control-Allow-Origin');

  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "img-src 'self' data: https:; " +
    "style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; " +
    "font-src 'self' data:; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'; " +
    "object-src 'none'"
  );

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
};
