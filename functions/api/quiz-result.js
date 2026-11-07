/**
 * Cloudflare Pages Function
 * 路径: /api/quiz-result
 * 方法: POST
 *
 * 保存 /quiz.html 通用答题器的结果到 quiz_attempts 表。
 * 2026-11-07 起同时保存逐题答案明细与维度分（answers_json / dims_json / mode），
 * 并记录提交时的 UA 与 IP；匿名用户以 visitor_token 记录。
 * 该接口服务于娱乐 / 自我探索类测评，不构成心理诊断。
 */

import { hasTable, hasColumn } from '../_lib/schema.js';
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

function clip(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// 逐题作答明细：由 /quiz.html 在提交时生成（题目、所选项、计分增量）。
function normalizeAnswers(value) {
  if (!Array.isArray(value)) return [];
  const list = value.slice(0, 300).map((item) => {
    if (!item || typeof item !== 'object') return null;
    const score = item.s && typeof item.s === 'object' ? item.s : null;
    return {
      q: clip(item.q || item.question || '', 180),
      t: clip(item.t || item.text || item.option || '', 180),
      i: Number.isFinite(Number(item.i)) ? Math.round(Number(item.i)) : null,
      s: score,
    };
  }).filter(Boolean);
  return list;
}

function normalizeDims(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const dims = Array.isArray(value.dims) ? value.dims.slice(0, 30).map((d) => {
    if (!d || typeof d !== 'object') return null;
    return {
      key: clip(d.key || '', 40),
      name: clip(d.name || '', 80),
      percent: finiteOrNull(d.percent, 0, 100),
      level: clip(d.level || '', 10),
    };
  }).filter(Boolean) : [];
  return {
    mode: clip(value.mode || '', 20),
    percent: finiteOrNull(value.percent, 0, 100),
    mouthPct: finiteOrNull(value.mouthPct, 0, 100),
    dims,
  };
}

function getClientIp(request) {
  const ip = request.headers.get('CF-Connecting-IP')
    || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim();
  return clip(ip, 80);
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

  let answersJson = '[]';
  let dimsJson = '{}';
  let detailMode = '';
  try {
    const answers = normalizeAnswers(body.answersJson || body.answers);
    const dims = normalizeDims(body.dimsJson || body.dims);
    detailMode = clip(body.mode || dims.mode || '', 20);
    answersJson = JSON.stringify(answers);
    dimsJson = JSON.stringify(dims);
    if (answersJson.length > 200000 || dimsJson.length > 200000) {
      answersJson = '[]';
      dimsJson = '{}';
    }
  } catch (e) {
    answersJson = '[]';
    dimsJson = '{}';
  }

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

  // 明细字段为 2026-11-07 新增；迁移未执行时自动降级为旧写入方式。
  const hasDetail = await hasColumn(env, 'quiz_attempts', 'answers_json');

  try {
    if (hasDetail) {
      await env.DB.prepare(
        `INSERT INTO quiz_attempts
           (slug, quiz_title, result_key, result_name, score, mouth_score,
            user_id, visitor_token, created_at, answers_json, dims_json, mode,
            user_agent, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        slug,
        quizTitle,
        resultKey,
        resultName,
        score,
        mouthScore,
        userId,
        visitorToken,
        Date.now(),
        answersJson,
        dimsJson,
        detailMode,
        clip(request.headers.get('User-Agent') || '', 500),
        getClientIp(request)
      ).run();
    } else {
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
    }

    return jsonResponse({ success: true });
  } catch (e) {
    console.error('[quiz-result.js] 写入失败:', e.message);
    return jsonResponse({ error: 'db_error' }, 500);
  }
};
