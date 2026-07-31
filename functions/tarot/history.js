/**
 * Cloudflare Pages Function
 * 路径: /tarot/history
 * 方法: GET
 *
 * 返回当前用户的塔罗抽牌历史（最近 50 条）
 */
import { getCurrentUser } from '../_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, spread_type, question, cards_json, headline, analysis_json
     FROM tarot_readings WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(user.id).all();

  const readings = (results || []).map(r => {
    let cards = [];
    let analysis = null;
    try { cards = JSON.parse(r.cards_json || '[]'); } catch {}
    try { analysis = JSON.parse(r.analysis_json || 'null'); } catch {}
    return {
      id: r.id,
      createdAt: r.created_at,
      spreadType: r.spread_type,
      question: r.question,
      cards,
      headline: r.headline,
      analysis,
    };
  });

  return jsonResponse({ readings });
};
