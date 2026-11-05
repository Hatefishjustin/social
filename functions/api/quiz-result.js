/**
 * Cloudflare Pages Function
 * 路径: /api/quiz-result
 * 方法: POST
 *
 * 保存 /quiz.html 通用答题器的结果摘要到 quiz_attempts 表。
 * 只保存结果，不保存逐题答案；匿名用户以 visitor_token 记录。
 * 该接口服务于娱乐 / 自我探索类测评，不构成心理诊断。
 */

import { hasTable } from '../_lib/schema.js';
import { getCurrentUser } from '../_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function finiteOrNull(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

export const onRequestPost = async ({ request, env }) => {
  if (!env || !env.DB) return jsonResponse({ error: 'missing_db' }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ message: '请求格式错误' }, 400);
  }

  const slug = String(body.slug || '').trim().slice(0, 64);
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) {
    return jsonResponse({ message: '测评标识不合法' }, 400);
  }

  const resultKey = String(body.resultKey || '').trim().slice(0, 80);
  const resultName = String(body.resultName || '').trim().slice(0, 80);
  const quizTitle = String(body.quizTitle || '').trim().slice(0, 80);
  if (!resultName) {
    return jsonResponse({ message: '结果名称不能为空' }, 400);
  }

  const score = finiteOrNull(body.score, 0, 100);
  const mouthScore = body.mouthScore === null || body.mouthScore === undefined
    ? null
    : finiteOrNull(body.mouthScore, 0, 100);
  const visitorToken = String(body.visitorToken || body.visitor_token || '').slice(0, 100);

  let userId = null;
  try {
    const user = await getCurrentUser(request, env);
    if (user && user.id) userId = user.id;
  } catch (e) {
    console.warn('[quiz-result.js] 解析用户身份失败:', e.message);
  }

  const tableExists = await hasTable(env, 'quiz_attempts');
  if (!tableExists) {
    console.warn('[quiz-result.js] quiz_attempts 表不存在（迁移未执行），跳过保存');
    return jsonResponse({ success: true, skipped: true });
  }

  try {
    await env.DB.prepare(
      `INSERT INTO quiz_attempts
         (slug, quiz_title, result_key, result_name, score, mouth_score,
          user_id, visitor_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      slug,
      quizTitle,
      resultKey,
      resultName,
      score,
      mouthScore,
      userId,
      visitorToken,
      Date.now()
    ).run();

    return jsonResponse({ success: true });
  } catch (e) {
    console.error('[quiz-result.js] 写入失败:', e.message);
    return jsonResponse({ error: 'db_error' }, 500);
  }
};
