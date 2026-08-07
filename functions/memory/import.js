/**
 * Cloudflare Pages Function
 * 路径: /functions/memory/import.js
 * 路由: /memory/import
 * 方法: POST preview / POST confirm
 * 功能: 「匿名记忆导入」通用框架
 *       - preview: 接收来源链接，返回 mock 预览数据（当前未接入具体平台抓取）
 *       - confirm: 确认导入，将预览数据写入 D1（content_imports + imported_questions）
 * 说明: 当前为通用框架，未接入轻匿 API。未来接入平台时替换 preview 的 mock 逻辑即可。
 */

import { getCurrentUser } from '../_lib/auth.js';
import { queryAskBoxInfo, queryAskBoxQuestions } from '../_lib/qingni-client.js';


function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// 从来源链接中提取平台标识（当前仅做通用解析，未接入具体平台）
function parseSourceUrl(sourceUrl) {
  if (!sourceUrl || typeof sourceUrl !== 'string') return null;
  let url;
  try {
    url = new URL(sourceUrl);
  } catch (e) {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  // 平台标识映射（未来可扩展）
  const platformMap = {
    'qntwx.com': 'lightbox',
  };
  const platform = platformMap[host] || host;
  // 取路径最后一段作为 source_id（如轻匿 url_code）
  const segments = url.pathname.split('/').filter(Boolean);
  const sourceId = segments.length ? segments[segments.length - 1] : null;
  return { platform, sourceId, sourceUrl };
}

// 生成 mock 预览数据（未接入真实平台抓取）
function buildMockPreview(parsed) {
  const now = Date.now();
  return {
    platform: parsed.platform,
    sourceUrl: parsed.sourceUrl,
    sourceId: parsed.sourceId,
    title: '我的匿名记忆（示例）',
    avatar: '',
    totalCount: 3,
    questions: [
      {
        sourceQuestionId: 'mock-1',
        question: '你最近一次感到开心是什么时候？',
        answer: '和朋友一起看了一场日落，那一刻很放松。',
        sourceCreatedAt: now - 86400000 * 3,
      },
      {
        sourceQuestionId: 'mock-2',
        question: '如果回到过去，你想对十年前的自己说什么？',
        answer: '别害怕，慢慢来，一切都会好起来的。',
        sourceCreatedAt: now - 86400000 * 2,
      },
      {
        sourceQuestionId: 'mock-3',
        question: '你最喜欢自己身上的哪个特质？',
        answer: '大概是真诚吧，愿意对重要的人坦诚相待。',
        sourceCreatedAt: now - 86400000,
      },
    ],
  };
}

// 每页拉取条数（轻匿公开问答）
const LIGHTBOX_PAGE_SIZE = 50;

/**
 * 解析 chat_list，提取「问题」与「回答」
 * 规则（依据 Phase 0/2 确认的 chat_list 语义）：
 *   - is_self: false → 提问者（匿名）消息
 *   - is_self: true 或带 user_id → 箱主（回复者）消息
 *   - 第一条消息通常是问题本身（与 question 字段一致）
 *   - 回答 = 箱主所有消息内容拼接（按时间顺序，多轮用 \n 连接）
 */
function parseChatList(question, chatList) {
  if (!Array.isArray(chatList) || chatList.length === 0) {
    return { question: question || '', answer: '' };
  }
  const ownerMsgs = [];
  for (const msg of chatList) {
    const isOwner = msg.is_self === true || (msg.user_id && msg.user_id.length > 0);
    if (isOwner && msg.content) {
      ownerMsgs.push(msg.content);
    }
  }
  return {
    question: question || '',
    answer: ownerMsgs.join('\n'),
  };
}

/**
 * 拉取轻匿全部公开问答（自动分页）
 * @returns {Promise<{ok:boolean, questions?:Array, total?:number, error?:string}>}
 */
async function fetchAllLightboxQuestions(env, userId) {
  const all = [];
  let skip = 0;
  let total = null;
  while (true) {
    const res = await queryAskBoxQuestions(env, userId, {
      limit: LIGHTBOX_PAGE_SIZE,
      skip,
      days: 3650, // 拉取近 10 年，覆盖全部公开问答
    });
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
    if (total === null) total = res.count;
    all.push(...res.questions);
    if (res.questions.length < LIGHTBOX_PAGE_SIZE) break;
    skip += LIGHTBOX_PAGE_SIZE;
  }
  return { ok: true, questions: all, total };
}

/**
 * 生成轻匿真实预览数据（调用 qingni-client.js）
 * 流程：url_code → ask_box_info → ask_box_question（全部分页）→ 解析 chat_list
 * @returns {Promise<{ok:boolean, preview?:object, error?:string, code?:string}>}
 */
async function buildLightboxPreview(env, parsed) {
  const urlCode = parsed.sourceId;
  if (!urlCode) {
    return { ok: false, code: 'invalid_url', error: '链接缺少 url_code' };
  }

  // 1. 获取提问箱信息
  const info = await queryAskBoxInfo(env, urlCode);
  if (!info.ok) {
    // 区分「认证失败」与「查询失败」
    if (/认证|token|accessToken/i.test(info.error || '')) {
      return { ok: false, code: 'auth_failed', error: '轻匿认证失败，请稍后重试' };
    }
    return { ok: false, code: 'fetch_failed', error: '轻匿请求失败：' + (info.error || '未知错误') };
  }
  const box = info.box;
  if (!box) {
    return { ok: false, code: 'box_not_found', error: '未找到该链接对应的提问箱' };
  }

  // 2. 获取全部公开问答
  const qres = await fetchAllLightboxQuestions(env, box.user_id);
  if (!qres.ok) {
    if (/认证|token|accessToken/i.test(qres.error || '')) {
      return { ok: false, code: 'auth_failed', error: '轻匿认证失败，请稍后重试' };
    }
    return { ok: false, code: 'fetch_failed', error: '轻匿请求失败：' + (qres.error || '未知错误') };
  }

  // 3. 无公开问答
  if (!qres.questions || qres.questions.length === 0) {
    return { ok: false, code: 'no_public', error: '该提问箱暂无公开问答' };
  }

  // 4. 解析 chat_list，转换为 SoulMirror preview 格式
  const preview = {
    platform: 'lightbox',
    sourceUrl: parsed.sourceUrl,
    sourceId: urlCode,
    title: box.box_description || `轻匿提问箱 ${urlCode}`,
    avatar: box.bg_img || '',
    totalCount: qres.questions.length,
    questions: qres.questions.map((q) => {
      const parsedChat = parseChatList(q.question, q.chat_list);
      return {
        sourceQuestionId: q._id,
        question: parsedChat.question,
        answer: parsedChat.answer,
        sourceCreatedAt: q.create_time || null,
      };
    }),
  };

  return { ok: true, preview };
}


// POST：根据 body.action 分发 preview（预览）或 confirm（确认导入）
export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const action = body.action || 'preview';

  // ---- preview：返回 mock 预览数据（不写库）----
  if (action === 'preview') {
    const sourceUrl = body.sourceUrl || body.source_url;
    const parsed = parseSourceUrl(sourceUrl);
    if (!parsed) {
      return jsonResponse({ error: 'invalid_url', message: '请输入有效的来源链接' }, 400);
    }
    // 轻匿（lightbox）走真实抓取；其他平台暂用 mock 兜底
    if (parsed.platform === 'lightbox') {
      const result = await buildLightboxPreview(env, parsed);
      if (!result.ok) {
        return jsonResponse({ ok: false, error: result.code, message: result.error }, 400);
      }
      return jsonResponse({ ok: true, preview: result.preview });
    }
    const preview = buildMockPreview(parsed);
    return jsonResponse({ ok: true, preview });

  }

  // ---- confirm：确认导入，写入 D1 ----
  if (action === 'confirm') {
    const preview = body.preview;
    if (!preview || !Array.isArray(preview.questions) || preview.questions.length === 0) {
      return jsonResponse({ error: 'invalid_preview', message: '预览数据无效' }, 400);
    }

    const now = Date.now();

    // 0. 同来源防重复导入（仅 lightbox 平台生效，不影响其他平台）
    //    规则：同一用户 + 同一 lightbox source_id 只允许「成功导入(imported)」一次。
    //    importing（上次写入中断）/ failed（上次写入失败）的记录允许清理后重新导入，
    //    避免失败一次后留下脏记录导致永久无法重试。
    if (preview.platform === 'lightbox' && preview.sourceId) {
      const imported = await env.DB.prepare(
        `SELECT id FROM content_imports
         WHERE user_id = ? AND platform = 'lightbox' AND source_id = ? AND status = 'imported'
         LIMIT 1`
      ).bind(user.id, preview.sourceId).first();
      if (imported) {
        return jsonResponse({
          ok: false,
          code: 'already_imported',
          message: '该提问箱已经导入过',
        }, 400);
      }

      // 清理上次未完成（importing/failed）的旧批次：
      // 级联删除其 imported_questions 明细，让本次以全新批次重新完整导入。
      // （askbox_questions 侧由步骤 2 的逐条去重检测兜底，不会重复插入。）
      const stale = await env.DB.prepare(
        `SELECT id FROM content_imports
         WHERE user_id = ? AND platform = 'lightbox' AND source_id = ? AND status IN ('importing', 'failed')
         LIMIT 50`
      ).bind(user.id, preview.sourceId).all();
      for (const row of (stale.results || [])) {
        await env.DB.prepare(
          `DELETE FROM content_imports WHERE id = ?`
        ).bind(row.id).run();
      }
    }

    // 1. 写入导入批次（初始状态为 importing，所有操作成功后改为 imported）
    //    使用 importing 中间状态：
    //    - 防止并发 confirm 重复写入（已存在的 importing/imported 记录都会被拦截）
    //    - 若后续步骤失败，状态停留在 importing，可被识别为「未完成」供后续重试
    const importResult = await env.DB.prepare(
      `INSERT INTO content_imports (user_id, platform, source_url, source_id, title, avatar, total_count, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'importing', ?)`
    ).bind(
      user.id,
      preview.platform || '',
      preview.sourceUrl || '',
      preview.sourceId || '',
      preview.title || '',
      preview.avatar || '',
      preview.questions.length,
      now
    ).run();

    const importId = importResult.meta.last_row_id;

    // 2. 分批写入明细。
    //    Cloudflare D1 batch() 单次最多 100 条 statements：
    //    - 每条问答生成最多 2 条 stmt（imported_questions + 可能 1 条 askbox_questions）
    //    - 每批最多 25 条问答（= 至多 50 stmts），循环执行，
    //      避免公开问答 ≥51 条时一次 batch 超过 100 条上限导致整体回滚、导入失败。
    //    askbox_questions 改为「逐条 SELECT 去重 + 普通 INSERT」：
    //    - 替代原 INSERT...SELECT...WHERE NOT EXISTS 复合写法，规避 D1 batch 兼容性风险
    //    - 去重条件保留 (target_id + content + answer_content + asker_id IS NULL匿名导入)
    const BATCH_QUESTIONS = 25;
    try {
      for (let i = 0; i < preview.questions.length; i += BATCH_QUESTIONS) {
        const slice = preview.questions.slice(i, i + BATCH_QUESTIONS);
        const stmts = [];
        for (const q of slice) {
          stmts.push(
            env.DB.prepare(
              `INSERT OR IGNORE INTO imported_questions (import_id, source_question_id, question, answer, source_created_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(
              importId,
              q.sourceQuestionId || q.source_question_id || '',
              q.question || '',
              q.answer || '',
              q.sourceCreatedAt || q.source_created_at || null,
              now
            )
          );

          // 同步写入站内提问箱：导入的问答全部展示在导入者自己的提问箱（匿名提问者）
          const askboxAnswer = (q.answer || '').trim();
          const askboxTime = q.sourceCreatedAt || q.source_created_at || now;
          const questionText = q.question || '';
          // 逐条去重检测：同一导入者(target_id=user.id) + 匿名导入(asker_id IS NULL)
          //                  + 相同问题 + 相同回答
          const dup = await env.DB.prepare(
            `SELECT id FROM askbox_questions
             WHERE target_id = ? AND content = ? AND asker_id IS NULL
               AND COALESCE(answer_content, '') = COALESCE(?, '')
             LIMIT 1`
          ).bind(user.id, questionText, askboxAnswer || '').first();
          if (!dup) {
            stmts.push(
              env.DB.prepare(
                `INSERT INTO askbox_questions (asker_id, target_id, content, is_anonymous, answer_content, answered_at, created_at)
                 VALUES (NULL, ?, ?, 1, ?, ?, ?)`
              ).bind(
                user.id,
                questionText,
                askboxAnswer || null,
                askboxAnswer ? askboxTime : null,
                askboxTime
              )
            );
          }
        }
        if (stmts.length > 0) {
          await env.DB.batch(stmts);
        }
      }
    } catch (e) {
      // 任一批写失败 → 标记 failed，允许用户重新导入（步骤0会清理历史脏记录）
      console.error('import batch failed:', e.message);
      try {
        await env.DB.prepare(
          `UPDATE content_imports SET status = 'failed' WHERE id = ?`
        ).bind(importId).run();
      } catch (e2) {
        console.error('mark import failed:', e2.message);
      }
      return jsonResponse({ ok: false, error: 'import_failed', message: '导入失败：' + e.message }, 400);
    }

    // 3. 全部写入成功 → 更新状态为 imported
    //    若步骤 2 任一批失败（抛出异常被捕获），此 UPDATE 不执行，状态为 failed 可重试
    await env.DB.prepare(
      `UPDATE content_imports SET status = 'imported' WHERE id = ?`
    ).bind(importId).run();

    return jsonResponse({ ok: true, importId, totalCount: preview.questions.length });
  }

  return jsonResponse({ error: 'invalid_action', message: '不支持的操作' }, 400);
};


export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
