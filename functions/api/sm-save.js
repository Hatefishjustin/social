/**
 * Cloudflare Pages Function
 * 路径: /api/sm-save
 * 方法: POST
 *
 * 保存 S/M 互动倾向测试的结果到 sm_test_results 表。
 * 该测试从心理学角度分析用户在亲密关系中的权力互动偏好，
 * 属于娱乐和自我探索性质，不代表专业心理诊断。
 */
import { hasTable } from '../_lib/schema.js';
import { getCurrentUser } from '../_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestPost = async ({ request, env }) => {
  if (!env || !env.DB) return jsonResponse({ error: 'missing_db' }, 500);

  // 1. 解析请求
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ message: '请求格式错误' }, 400);
  }

  // 2. 校验评分数据
  const sScore = Number(body.sScore);
  const mScore = Number(body.mScore);
  const switchScore = Number(body.switchScore);
  const trustScore = Number(body.trustScore);
  const consentScore = Number(body.consentScore);
  const resultType = String(body.resultType || '').slice(0, 20);

  if ([sScore, mScore, switchScore, trustScore, consentScore].some(v => isNaN(v) || v < 1 || v > 5)) {
    return jsonResponse({ message: '评分数据不合法' }, 400);
  }

  if (!['S', 'M', 'Switch', 'Balanced'].includes(resultType)) {
    return jsonResponse({ message: '结果类型不合法' }, 400);
  }

  // 3. 获取访客标识（前端通过 SMTrack.getVisitorToken() 获取）
  const visitorToken = String(body.visitorToken || body.visitor_token || '').slice(0, 100);

  // 4. 解析登录用户身份（从 session cookie 中获取）
  let userId = null;
  try {
    const user = await getCurrentUser(request, env);
    if (user && user.id) {
      userId = user.id;
    }
  } catch (e) {
    console.warn('[sm-save.js] 解析用户身份失败:', e.message);
  }

  // 5. 检查表是否存在（迁移前降级：不保存，仅返回成功）
  const tableExists = await hasTable(env, 'sm_test_results');
  if (!tableExists) {
    console.warn('[sm-save.js] sm_test_results 表不存在（迁移未执行），跳过保存');
    return jsonResponse({ success: true, skipped: true });
  }

  // 6. 写入数据库
  try {
    await env.DB.prepare(
      `INSERT INTO sm_test_results
         (visitor_token, user_id, s_score, m_score, switch_score, trust_score, consent_score, result_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      visitorToken,
      userId,
      sScore,
      mScore,
      switchScore,
      trustScore,
      consentScore,
      resultType,
      Date.now()
    ).run();

    console.log(`[sm-save.js] 保存成功 result_type=${resultType} user_id=${userId || 'anonymous'}`);
    return jsonResponse({ success: true });
  } catch (e) {
    console.error('[sm-save.js] 写入失败:', e.message);
    return jsonResponse({ error: 'db_error' }, 500);
  }
};
