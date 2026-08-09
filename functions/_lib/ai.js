/**
 * 统一 AI 服务
 * 职责：封装 DashScope API 调用，统一错误处理、超时、重试。
 * 不包含任何业务逻辑（心理测试、塔罗等）。
 *
 * 使用方式：
 *   import { callDashScope } from '../_lib/ai.js';
 *   const result = await callDashScope(prompt, { model: 'qwen-plus' });
 *   if (result.ok) { ... } else { ... result.error }
 */

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

const DEFAULT_OPTIONS = {
  model: 'qwen-plus',
  temperature: 0.7,
  max_tokens: 2000,
};

/**
 * 调用 DashScope Chat Completions
 * @param {string} prompt - 用户消息（必填）
 * @param {object} [options] - 可选配置
 * @param {string} [options.model='qwen-plus'] - 模型名
 * @param {number} [options.temperature=0.7]
 * @param {number} [options.max_tokens=2000]
 * @param {string} [options.systemPrompt] - system 消息
 * @param {number} [options.timeout=30000] - 超时毫秒
 * @param {object} env - Cloudflare Pages env 对象，从中读取 DASHSCOPE_API_KEY
 * @returns {Promise<{ok:boolean, content?:string, error?:string}>}
 */
export async function callDashScope(prompt, options = {}, env = {}) {
  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    console.error('[ai.js] DASHSCOPE_API_KEY 未配置（env 中读取不到）');
    return { ok: false, error: 'DASHSCOPE_API_KEY 未配置' };
  }

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    console.error('[ai.js] prompt 不能为空');
    return { ok: false, error: 'prompt 不能为空' };
  }

  const model = options.model || DEFAULT_OPTIONS.model;
  const temperature = options.temperature ?? DEFAULT_OPTIONS.temperature;
  const maxTokens = options.max_tokens ?? DEFAULT_OPTIONS.max_tokens;
  const timeout = options.timeout || 30000;

  const messages = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  // 尝试请求，最多 2 次（首次 + 1 次重试，仅 5xx 时重试）
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const resp = await fetch(`${DASHSCOPE_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        lastError = `API 返回 ${resp.status}: ${errText.slice(0, 200)}`;
        console.error(`[ai.js] DashScope 请求失败 attempt=${attempt + 1}: ${lastError}`);
        // 仅 5xx 重试，4xx 不重试
        if (resp.status < 500) break;
        continue;
      }

      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content;
      if (content) {
        console.log(`[ai.js] DashScope 调用成功 model=${model} contentLength=${content.length}`);
        return { ok: true, content };
      }
      lastError = 'API 返回格式异常，无 choices[0].message.content';
      console.error(`[ai.js] DashScope 返回格式异常: ${JSON.stringify(data).slice(0, 300)}`);
      break; // 格式异常不重试
    } catch (e) {
      if (e.name === 'AbortError') {
        lastError = `请求超时（${timeout / 1000}s）`;
      } else {
        lastError = `网络错误: ${e.message}`;
      }
      console.error(`[ai.js] DashScope 请求异常 attempt=${attempt + 1}: ${lastError}`);
      // 网络错误继续重试
    }
  }

  console.error(`[ai.js] DashScope 最终失败: ${lastError || '未知错误'}`);
  return { ok: false, error: lastError || '未知错误' };
}
