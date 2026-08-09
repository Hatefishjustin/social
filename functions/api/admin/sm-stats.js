/**
 * Cloudflare Pages Function
 * 路径: /api/admin/sm-stats
 * 方法: GET
 * S/M 互动倾向测试数据统计（管理员）
 * 返回: 总完成次数 / 各类型分布 / 各维度平均分 / 最近记录
 */
import { getCurrentUser } from '../../_lib/auth.js';
import { hasTable } from '../../_lib/schema.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const onRequestGet = async ({ request, env }) => {
  if (!env || !env.DB) return jsonResponse({ error: 'missing_db', message: '数据库未配置' }, 500);

  const user = await getCurrentUser(request, env);
  if (!user || !user.isAdmin) return jsonResponse({ error: 'forbidden', message: '无权限' }, 403);

  const db = env.DB;

  // 检查表是否存在（迁移前降级）
  const tableExists = await hasTable(env, 'sm_test_results');
  if (!tableExists) {
    return jsonResponse({
      stats: {
        total: 0,
        today: 0,
        typeDistribution: {},
        avgS: 0,
        avgM: 0,
        avgSwitch: 0,
        avgTrust: 0,
        avgConsent: 0,
      },
      recent: [],
      tableMissing: true,
    });
  }

  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  try {
    const [totalRow, todayRow, typeRows, avgRow, recentRows] = await Promise.all([
      db.prepare('SELECT COUNT(*) as n FROM sm_test_results').first(),
      db.prepare('SELECT COUNT(*) as n FROM sm_test_results WHERE created_at >= ?').bind(todayStartMs).first(),
      db.prepare('SELECT result_type, COUNT(*) as n FROM sm_test_results GROUP BY result_type').all(),
      db.prepare(
        `SELECT
           AVG(s_score) as avg_s,
           AVG(m_score) as avg_m,
           AVG(switch_score) as avg_switch,
           AVG(trust_score) as avg_trust,
           AVG(consent_score) as avg_consent
         FROM sm_test_results`
      ).first(),
      db.prepare(
        `SELECT id, visitor_token, s_score, m_score, switch_score, trust_score, consent_score, result_type, created_at
         FROM sm_test_results ORDER BY created_at DESC LIMIT 20`
      ).all(),
    ]);

    const typeDistribution = {};
    (typeRows.results || []).forEach(r => {
      typeDistribution[r.result_type] = r.n;
    });

    const recent = (recentRows.results || []).map(r => ({
      id: r.id,
      visitorToken: r.visitor_token || '',
      sScore: r.s_score,
      mScore: r.m_score,
      switchScore: r.switch_score,
      trustScore: r.trust_score,
      consentScore: r.consent_score,
      resultType: r.result_type,
      createdAt: r.created_at,
    }));

    return jsonResponse({
      stats: {
        total: totalRow?.n || 0,
        today: todayRow?.n || 0,
        typeDistribution,
        avgS: avgRow?.avg_s ? Math.round(avgRow.avg_s * 10) / 10 : 0,
        avgM: avgRow?.avg_m ? Math.round(avgRow.avg_m * 10) / 10 : 0,
        avgSwitch: avgRow?.avg_switch ? Math.round(avgRow.avg_switch * 10) / 10 : 0,
        avgTrust: avgRow?.avg_trust ? Math.round(avgRow.avg_trust * 10) / 10 : 0,
        avgConsent: avgRow?.avg_consent ? Math.round(avgRow.avg_consent * 10) / 10 : 0,
      },
      recent,
      generatedAt: now,
    });
  } catch (e) {
    console.error('[sm-stats.js] 查询失败:', e.message);
    return jsonResponse({ error: 'db_error', message: '查询失败' }, 500);
  }
};
