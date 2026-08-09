/**
 * Cloudflare Pages Function
 * 路径: /api/sm-analyze
 * 方法: POST
 *
 * 接收 S/M 互动倾向测试的评分结果，调用 DashScope 生成心理分析。
 * 该测试从心理学角度分析用户在亲密关系中的权力互动偏好，
 * 属于娱乐和自我探索性质，不代表专业心理诊断。
 */
import { callDashScope } from '../_lib/ai.js';

const SYSTEM_PROMPT = `你是一名心理学方向分析助手。

你的任务：根据用户的五个心理互动维度生成《S/M互动心理画像》。

输入数据：
- S倾向分数（Dominance）：主导关系互动、制定规则、承担决策责任、引导另一方的倾向
- M倾向分数（Submission）：信任后接受引导、享受被支持和照顾、愿意让对方承担部分主动权的倾向
- Switch倾向（双向适应）：根据关系状态切换角色、同时具备主动和接受能力的倾向
- 信任程度（Trust）：需要高度安全感后才开放自己的程度
- 边界意识（Consent）：重视双方同意、善于沟通需求、尊重边界的程度

分析规则（必须严格根据分数差异来生成内容）：

如果S明显高于M（S - M > 0.5）：
- 重点描述：主动规划、引导倾向、责任感、控制感需求
- 不要描述接受/依赖倾向

如果M明显高于S（M - S > 0.5）：
- 重点描述：接受引导、信任建立、支持需求、安全感需求
- 不要描述主导/控制倾向

如果S和M都高（两者都 >= 3.5）：
- 重点描述：灵活切换、情境适应能力、双向能力

如果S和M接近（|S - M| <= 0.5）：
- 重点描述：平衡互动、关系质量关注

必须遵守的规则：
1. 禁止判断人格优劣
2. 禁止心理疾病诊断
3. 禁止性取向判断
4. 禁止绝对化标签（如"你一定是""你永远"）
5. 必须强调：这是娱乐和自我探索性质测试，不代表专业心理诊断
6. 语气温和、专业、有洞察力，让用户感受到被理解而非被评判
7. 从心理学角度（如依恋理论、权力动态、边界理论等）提供有深度的观察
8. 内容必须与用户的实际分数匹配，不能出现与分数矛盾的分析

输出结构（5个部分）：
1. 你的互动倾向类型
2. 核心特点
3. 优势
4. 可能需要注意的地方
5. 关系建议

长度：300-500字。

你必须返回严格 JSON，格式如下：
{
  "headline": "一句话总结，30字以内",
  "sections": [
    {
      "icon": "heart",
      "title": "小节标题，10字以内",
      "body": "小节正文，简洁但有深度"
    }
  ],
  "closing": "收尾段落，80字以内"
}

icon 从以下6个中选用：heart brain puzzle compass shield spark
sections 数量：5个（对应上述5个输出结构部分）
每个 body 控制在 120 字以内
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

export const onRequestPost = async ({ request, env }) => {
  // 1. 解析请求
  let payload;
  try {
    const body = await request.json();
    payload = body && body.payload ? body.payload : null;
    console.log('[sm-analyze.js] 收到请求');
  } catch {
    console.error('[sm-analyze.js] 请求格式错误（JSON 解析失败）');
    return jsonResponse({ message: '请求格式错误' }, 400);
  }

  if (!payload) {
    console.error('[sm-analyze.js] 缺少 payload 参数');
    return jsonResponse({ message: '缺少 payload 参数' }, 400);
  }

  // 2. 校验评分数据
  const sScore = Number(payload.sScore);
  const mScore = Number(payload.mScore);
  const switchScore = Number(payload.switchScore);
  const trustScore = Number(payload.trustScore);
  const consentScore = Number(payload.consentScore);
  const resultType = String(payload.resultType || '');

  if ([sScore, mScore, switchScore, trustScore, consentScore].some(v => isNaN(v) || v < 1 || v > 5)) {
    console.error('[sm-analyze.js] 评分数据不合法');
    return jsonResponse({ message: '评分数据不合法' }, 400);
  }

  // 3. 构造 AI prompt
  const typeLabel = {
    S: '偏S型（主导倾向）',
    M: '偏M型（接受倾向）',
    Switch: 'Switch型（双向适应）',
    Balanced: '平衡型',
  }[resultType] || '平衡型';

  const prompt = `以下是用户「S/M 互动倾向测试」的评分结果（各维度满分5分）：

- S 倾向（Dominance）：${sScore.toFixed(1)} 分
- M 倾向（Submission）：${mScore.toFixed(1)} 分
- Switch（双向适应）：${switchScore.toFixed(1)} 分
- Consent（边界意识）：${consentScore.toFixed(1)} 分
- Trust（信任建立能力）：${trustScore.toFixed(1)} 分

系统判定结果类型：${typeLabel}

请基于以上数据，从心理学角度为用户生成一份《你的S/M互动心理画像》分析。`;

  // 4. 调用 AI
  console.log('[sm-analyze.js] 开始调用 callDashScope...');
  const result = await callDashScope(prompt, {
    systemPrompt: SYSTEM_PROMPT,
    model: 'qwen-plus',
    temperature: 0.7,
    max_tokens: 1500,
    timeout: 35000,
  }, env);

  // 5. AI 调用失败
  if (!result.ok) {
    console.error(`[sm-analyze.js] AI 调用失败: ${result.error || 'AI 服务暂不可用'}`);
    return jsonResponse({ message: result.error || 'AI 服务暂不可用' }, 502);
  }

  const content = result.content || '';
  console.log(`[sm-analyze.js] AI 调用成功 content.length=${content.length}`);

  // 6. 尝试 JSON 解析
  try {
    let jsonStr = content.trim();
    const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      jsonStr = fenced[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    if (parsed && typeof parsed === 'object') {
      const analysis = {
        headline: String(parsed.headline || '').slice(0, 60),
        sections: Array.isArray(parsed.sections) ? parsed.sections.map(s => ({
          icon: ['heart', 'brain', 'puzzle', 'compass', 'shield', 'spark'].includes(s.icon) ? s.icon : 'spark',
          title: String(s.title || '').slice(0, 20),
          body: String(s.body || '').slice(0, 200),
        })).slice(0, 5) : [],
        closing: String(parsed.closing || '').slice(0, 160),
      };
      console.log('[sm-analyze.js] JSON 解析成功，返回 analysis');
      return jsonResponse({ analysis });
    }

    console.warn('[sm-analyze.js] JSON 解析成功但格式不对，返回 analysisRaw 兜底');
    return jsonResponse({ analysisRaw: content });
  } catch {
    console.warn('[sm-analyze.js] JSON 解析失败，返回 analysisRaw 兜底');
    return jsonResponse({ analysisRaw: content });
  }
};
