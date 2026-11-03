/**
 * Cloudflare Pages Function
 * 路径: /health
 * 方法: GET
 *
 * 轻量健康检查：进程可响应 + D1 可查询。
 * 不要在这里做任何写操作。
 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export const onRequestGet = async ({ env }) => {
  const startedAt = Date.now();
  let dbOk = false;
  let dbError = null;

  if (env && env.DB) {
    try {
      const row = await env.DB.prepare('SELECT 1 AS ok').first();
      dbOk = !!row && row.ok === 1;
    } catch (e) {
      dbError = String(e && e.message ? e.message : e).slice(0, 200);
    }
  } else {
    dbError = 'DB binding missing';
  }

  const body = {
    ok: dbOk,
    db: dbOk,
    commit: env && env.CF_PAGES_COMMIT_SHA ? env.CF_PAGES_COMMIT_SHA : null,
    time: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
  };

  if (!dbOk && dbError) body.error = dbError;
  return jsonResponse(body, dbOk ? 200 : 503);
};
