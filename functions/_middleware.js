/**
 * Cloudflare Pages Middleware
 * 仅当请求来自 Pages 默认域名时，301 重定向到自定义域名。
 * 自定义域名本身不受影响，避免重定向死循环。
 */
export const onRequest = async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.hostname === 'soulmirror-255.pages.dev') {
    return Response.redirect(`https://soulmirror.cc.cd${url.pathname}${url.search}`, 301);
  }
  return next();
};
