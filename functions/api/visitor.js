/**
 * Cloudflare Pages Function
 * 路径: /api/visitor
 * 方法: GET
 * 用途: 获取/创建匿名身份 visitor_id，设置 Cookie（有效期 1 年）
 *      前端在页面加载时调用一次，确保游客首次访问即生成身份。
 * 说明: visitor_id 仅用于行为关联，不作为登录凭证。
 */
import { getOrCreateVisitor, buildVisitorCookie } from '../_lib/visitor.js';

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export const onRequestGet = async ({ request, env }) => {
  const { visitorId, isNew } = await getOrCreateVisitor(request, env);

  const headers = {};
  if (isNew) {
    headers['Set-Cookie'] = buildVisitorCookie(visitorId);
  }

  return jsonResponse({
    visitorId,
    isNew,
    expiresIn: 365 * 24 * 60 * 60, // 1 年（秒）
  }, 200, headers);
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};