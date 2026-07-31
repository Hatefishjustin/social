/**
 * Cloudflare Pages Function
 * 路径: /tarot/analyze
 * 方法: POST
 *
 * 接收抽到的塔罗牌 + 可选的用户问题，调用 DashScope 生成深度解读。
 * 若用户最近做过心理测评，会自动结合测评结果一起分析（可关闭）。
 * 严格 JSON 输出；解析失败时返回 analysisRaw 兜底，与 /analyze 保持一致的响应格式。
 */
import { callDashScope } from '../_lib/ai.js';
import { getCurrentUser } from '../_lib/auth.js';

const SYSTEM_PROMPT = `你是一位专业的塔罗牌解读师，同时具备心理咨询背景。用户会提供抽到的塔罗牌信息（可能是单张牌，也可能是"过去-现在-未来"三张牌阵），有时还会附上一个具体问题，以及用户的心理测评结果作为参考背景。

要求：
1. 结合塔罗牌的传统象征意义，但落脚点是给用户提供心理层面的洞察和反思角度，而不是宿命论式的预言
2. 如果提供了心理测评背景（依恋类型、人格特质等），要自然地把这些信息融入解读，让解读更贴合这个人的真实心理状态，而不是生硬地分别陈述两套内容
3. 如果是三张牌阵（过去-现在-未来），要说明三张牌之间的关联和演变逻辑，不要孤立解读
4. 不做绝对化的命运预测（不说"你一定会…"），而是用"这张牌提示你可以关注…""值得留意的是…"这类邀请反思的语气
5. 语气温和、有洞察力，避免空洞的套话
6. 总字数控制在800-1200字之间（通过sections的body总和体现）

你必须返回严格 JSON，格式如下：
{
  "headline": "一句话总结本次解读的核心信息，30字以内",
  "sections": [
    {
      "icon": "heart",
      "title": "小节标题，10字以内",
      "body": "小节正文，有具体洞察，不空洞"
    }
  ],
  "closing": "收尾段落，给出一个可以带走的反思或行动方向，100字以内"
}

icon 从以下6个中选用：heart brain puzzle compass shield spark
sections 数量：4-6个（单张牌可以少一些，三张牌阵建议每张牌至少一个section，再加一个整体关联的section）
不要输出 JSON 之外的任何内容`;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function buildPrompt(spreadType, cards, question, quizContext) {
  let text = '';

  if (spreadType === 'three') {
    text += `牌阵类型：过去-现在-未来 三张牌阵\n\n`;
    const positions = ['过去', '现在', '未来'];
    cards.forEach((c, i) => {
      const dir = c.reversed ? '逆位' : '正位';
      const keywords = c.reversed ? c.reversed_keywords : c.upright_keywords;
      text += `【${positions[i] || `第${i+1}张`}】${c.name}（${dir}）\n关键词：${(keywords || []).join('、')}\n\n`;
    });
  } else {
    text += `牌阵类型：单张牌\n\n`;
    const c = cards[0];
    const dir = c.reversed ? '逆位' : '正位';
    const keywords = c.reversed ? c.reversed_keywords : c.upright_keywords;
    text += `【抽到的牌】${c.name}（${dir}）\n关键词：${(keywords || []).join('、')}\n\n`;
  }

  if (question && question.trim()) {
    text += `用户提出的问题/困惑：${question.trim()}\n\n`;
  } else {
    text += `用户没有指定具体问题，请做一次开放式的整体解读。\n\n`;
  }

  if (quizContext) {
    text += `--- 用户心理测评背景（供解读时参考融合，不要生硬罗列）---\n${quizContext}\n`;
  }

  return text;
}

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ message: '请先登录' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ message: '请求格式错误' }, 400);
  }

  const spreadType = body?.spreadType === 'three' ? 'three' : 'single';
  const cards = Array.isArray(body?.cards) ? body.cards : [];
  const question = typeof body?.question === 'string' ? body.question.slice(0, 200) : '';
  const useQuizContext = body?.useQuizContext !== false; // 默认结合心理测评

  const expectedCount = spreadType === 'three' ? 3 : 1;
  if (cards.length !== expectedCount) {
    return jsonResponse({ message: `${spreadType === 'three' ? '三张牌阵' : '单张牌'}需要提供 ${expectedCount} 张牌` }, 400);
  }

  for (const c of cards) {
    if (!c || typeof c.name !== 'string' || !c.name.trim()) {
      return jsonResponse({ message: '牌面数据不完整' }, 400);
    }
  }

  // 可选：拉取用户最近一次心理测评结果作为解读背景
  let quizContext = null;
  let linkedQuizId = null;
  if (useQuizContext && env.DB) {
    try {
      const row = await env.DB.prepare(
        `SELECT id, headline, scores_json FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`
      ).bind(user.id).first();
      if (row) {
        linkedQuizId = row.id;
        let scoresText = '';
        try {
          const scores = JSON.parse(row.scores_json || '{}');
          scoresText = Object.entries(scores)
            .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
            .map(([k, v]) => `${k}: ${v}`)
            .join('，');
        } catch {}
        quizContext = `心理测评概要：${row.headline || ''}${scoresText ? `（${scoresText}）` : ''}`;
      }
    } catch (e) {
      // 拉取失败不影响塔罗解读本身，静默降级为不带背景
      quizContext = null;
    }
  }

  const prompt = buildPrompt(spreadType, cards, question, quizContext);

  const result = await callDashScope(prompt, {
    systemPrompt: SYSTEM_PROMPT,
    model: 'qwen-plus',
    temperature: 0.8,
    max_tokens: 2000,
    timeout: 35000,
  }, env);

  if (!result.ok) {
    return jsonResponse({ message: result.error || 'AI 服务暂不可用' }, 502);
  }

  const content = result.content || '';

  let analysis = null;
  let analysisRaw = null;

  try {
    let jsonStr = content.trim();
    const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) jsonStr = fenced[1].trim();

    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object') {
      analysis = {
        headline: String(parsed.headline || '').slice(0, 60),
        sections: Array.isArray(parsed.sections) ? parsed.sections.map(s => ({
          icon: ['heart', 'brain', 'puzzle', 'compass', 'shield', 'spark'].includes(s.icon) ? s.icon : 'spark',
          title: String(s.title || '').slice(0, 20),
          body: String(s.body || '').slice(0, 260),
        })).slice(0, 6) : [],
        closing: String(parsed.closing || '').slice(0, 200),
      };
    } else {
      analysisRaw = content;
    }
  } catch {
    analysisRaw = content;
  }

  // 保存本次抽牌记录（即使AI解读JSON解析失败，也保存原始内容，不丢失这次抽牌）
  let readingId = null;
  if (env.DB) {
    try {
      const cardsToStore = cards.map((c, i) => ({
        id: c.id || '', name: c.name, reversed: !!c.reversed,
        position: spreadType === 'three' ? (['past','present','future'][i] || null) : null,
      }));
      const insertResult = await env.DB.prepare(
        `INSERT INTO tarot_readings (user_id, created_at, spread_type, question, cards_json, headline, analysis_json, linked_quiz_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        user.id, Date.now(), spreadType, question || null,
        JSON.stringify(cardsToStore),
        analysis ? analysis.headline : null,
        JSON.stringify(analysis || { raw: analysisRaw }),
        linkedQuizId
      ).run();
      readingId = insertResult.meta.last_row_id;
    } catch (e) {
      // 保存失败不影响本次返回结果给用户
      readingId = null;
    }
  }

  if (analysis) {
    return jsonResponse({ analysis, readingId, linkedQuizId });
  }
  return jsonResponse({ analysisRaw, readingId, linkedQuizId });
};
