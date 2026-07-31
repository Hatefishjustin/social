/**
 * Cloudflare Pages Function - DEBUG VERSION
 * 路径: /analyze  
 * 方法: POST
 */
import { callDashScope } from './_lib/ai.js';

export const onRequestPost = async ({ request, env }) => {
  // Debug: return what env looks like
  const envKeys = Object.keys(env || {});
  
  let body;
  try { body = await request.json(); } catch { body = {}; }
  
  return new Response(JSON.stringify({
    env_keys: envKeys,
    has_dashscope: !!env?.DASHSCOPE_API_KEY,
    has_db: !!env?.DB,
    body_received: !!body.rawText,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
