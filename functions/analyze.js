/**
 * Cloudflare Pages Function
 * 路径: /analyze
 * 方法: POST
 *
 * 接收用户测评原始数据，调用 DashScope 生成心理分析。
 * 严格 JSON 输出；解析失败时返回 analysisRaw 兜底。
 */
import { callDashScope } from './_lib/ai.js';

const SYSTEM_PROMPT = `你是一位专业的心理学解读助手。用户会提供一份心理测评的原始作答数据，请基于这些数据做深度分析。

要求：
1. 结合人格心理学、社会心理学、发展心理学等理论进行分析
2. 不做医疗诊断、不贴绝对标签、不预测未来
3. 语气温和而专业，让用户感受到被理解而非被评判
4. 避免空洞的赞美或鼓励，给出有洞察力的观察

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
sections 数量：3-5个
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
  let rawText;
  try {
    const body = await request.json();
    rawText = (body && body.rawText) ? String(body.rawText).trim() : '';
    console.log(`[analyze.js] 收到请求 rawText.length=${rawText.length}`);
  } catch {
    console.error('[analyze.js] 请求格式错误（JSON 解析失败）');
    return jsonResponse({ message: '请求格式错误' }, 400);
  }

  if (!rawText) {
    console.error('[analyze.js] 缺少 rawText 参数');
    return jsonResponse({ message: '缺少 rawText 参数' }, 400);
  }

  if (rawText.length > 12000) {
    console.error(`[analyze.js] rawText 超过长度限制: ${rawText.length}`);
    return jsonResponse({ message: 'rawText 超过长度限制' }, 400);
  }

  // 2. 调用 AI
  console.log('[analyze.js] 开始调用 callDashScope...');
  const result = await callDashScope(rawText, {
    systemPrompt: SYSTEM_PROMPT,
    model: 'qwen-plus',
    temperature: 0.7,
    max_tokens: 1500,
    timeout: 35000,
  }, env);

  // 3. AI 调用失败
  if (!result.ok) {
    console.error(`[analyze.js] AI 调用失败: ${result.error || 'AI 服务暂不可用'}`);
    return jsonResponse({ message: result.error || 'AI 服务暂不可用' }, 502);
  }

  const content = result.content || '';
  console.log(`[analyze.js] AI 调用成功 content.length=${content.length}`);

  // 4. 尝试 JSON 解析
  try {
    // 有些模型会在 JSON 前后加 markdown 代码块标记
    let jsonStr = content.trim();
    const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      jsonStr = fenced[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // 验证必要字段存在
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
      console.log('[analyze.js] JSON 解析成功，返回 analysis');
      return jsonResponse({ analysis });
    }

    // JSON 解析成功但格式不对
    console.warn('[analyze.js] JSON 解析成功但格式不对，返回 analysisRaw 兜底');
    return jsonResponse({ analysisRaw: content });
  } catch {
    // 5. JSON 解析失败 → 兜底
    console.warn('[analyze.js] JSON 解析失败，返回 analysisRaw 兜底');
    return jsonResponse({ analysisRaw: content });
  }
};
