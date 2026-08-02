/**
 * Cloudflare Pages Function
 * 路径: /track
 * 方法: POST
 *
 * 测评完成事件上报（轻量统计，匿名访客也可上报）。
 * 只记录测试类型和一句摘要标签，不包含具体作答内容。
 * 数据写入 activity_log 表，action 固定为 'quiz_completed'。
 */
import { getCurrentUser } from './_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export const onRequestPost = async ({ request, env }) => {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ message: '请求格式错误' }, 400);
  }

  const quizType = (body && body.quizType) ? String(body.quizType).slice(0, 50) : '';
  const headline = (body && body.headline) ? String(body.headline).slice(0, 100) : '';

  if (!quizType) {
    return jsonResponse({ message: '缺少 quizType 参数' }, 400);
  }

  // 尝试识别当前用户（未登录则为匿名，不影响统计上报）
  let user = null;
  try {
    user = await getCurrentUser(request, env);
  } catch (e) {
    user = null;
  }

  const cf = request.cf || {};
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const userAgent = request.headers.get('User-Agent') || '';

  await env.DB.prepare(
    `INSERT INTO activity_log
       (user_id, user_email, action, target_type, target_id, content, ip, user_agent, country, city, is_anonymous, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user ? user.id : null,
    user ? user.email : null,
    'quiz_completed',
    'quiz',
    quizType,
    headline,
    ip,
    userAgent.slice(0, 300),
    cf.country || '',
    cf.city || '',
    user ? 0 : 1,
    Date.now()
  ).run();

  return jsonResponse({ ok: true });
};
