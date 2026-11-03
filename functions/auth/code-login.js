/**
 * Cloudflare Pages Function
 * 路径: /auth/code-login
 *
 * 2026-11-03：停用 6 位跨设备登录码（S-02）。
 * 历史登录码不再可用，统一走邮箱魔法链接。
 */
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export const onRequestPost = async () => {
  return jsonResponse({
    error: 'code_login_disabled',
    message: '跨设备登录码已停用，请使用邮箱登录链接。',
  }, 410);
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
