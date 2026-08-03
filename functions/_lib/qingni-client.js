/**
 * Cloudflare Pages Function 共享库
 * 路径: /functions/_lib/qingni-client.js
 * 职责: 轻匿（qntwx.com，uniCloud 应用）数据获取客户端
 *       封装 uniCloud 网关协议：签名、匿名认证、clientDB 查询。
 * 说明:
 *   - 纯 Web 标准 API（fetch / crypto.subtle / TextEncoder），无 Node 专属 API。
 *   - HMAC-MD5 使用纯 JS 实现（Web Crypto 不支持 MD5）。
 *   - 凭据从 env 读取：QINGNI_SPACE_ID / QINGNI_CLIENT_SECRET / QINGNI_ENDPOINT。
 *   - 不包含任何业务逻辑，仅供导入功能复用。
 *
 * 使用方式:
 *   import { queryAskBoxInfo, queryAskBoxQuestions } from '../_lib/qingni-client.js';
 *   const info = await queryAskBoxInfo(env, urlCode);
 *   if (info.ok) { ... } else { ... info.error }
 */

// 默认端点（可被 env.QINGNI_ENDPOINT 覆盖）
const DEFAULT_ENDPOINT = 'https://api.next.bspapp.com/client';

// ─────────────────────────────────────────────
// 纯 JS MD5 实现（Web Crypto 不支持 MD5，故自实现）
// 参考标准 MD5 算法，输出 32 位小写 hex。
// ─────────────────────────────────────────────

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = [];
for (let i = 0; i < 64; i++) {
  MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
}

function md5RotateLeft(x, c) {
  return (x << c) | (x >>> (32 - c));
}

function md5AddUnsigned(a, b) {
  const lsw = (a & 0xffff) + (b & 0xffff);
  const msw = (a >> 16) + (b >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xffff);
}

function md5ToHexStr(value) {
  let s = '';
  for (let i = 0; i < 4; i++) {
    s += ('0' + ((value >>> (i * 8)) & 0xff).toString(16)).slice(-2);
  }
  return s;
}

/**
 * 计算字节数组的 MD5（小写 hex）
 * @param {Uint8Array} bytes - 输入字节
 * @returns {string} 32 位小写 hex
 */
function md5Bytes(bytes) {
  const len = bytes.length;

  // 填充：补 0x80，再补 0 直到 length ≡ 56 (mod 64)，最后 8 字节为原始 bit 长度
  const paddedLen = (((len + 8) >> 6) + 1) << 6;
  const data = new Uint8Array(paddedLen);
  data.set(bytes);
  data[len] = 0x80;
  // 小端写入原始长度（bit）
  const bitLen = len * 8;
  const dv = new DataView(data.buffer);
  dv.setUint32(paddedLen - 8, bitLen >>> 0, true);
  dv.setUint32(paddedLen - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < paddedLen; offset += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      M[i] = dv.getUint32(offset + i * 4, true);
    }

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F;
      let g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = md5AddUnsigned(F, A);
      F = md5AddUnsigned(F, MD5_K[i]);
      F = md5AddUnsigned(F, M[g]);
      A = D;
      D = C;
      C = B;
      B = md5AddUnsigned(B, md5RotateLeft(F, MD5_S[i]));
    }

    a0 = md5AddUnsigned(a0, A);
    b0 = md5AddUnsigned(b0, B);
    c0 = md5AddUnsigned(c0, C);
    d0 = md5AddUnsigned(d0, D);
  }

  return md5ToHexStr(a0) + md5ToHexStr(b0) + md5ToHexStr(c0) + md5ToHexStr(d0);
}

/**
 * 计算字符串的 MD5（小写 hex）
 * @param {string} str - 输入字符串（UTF-8）
 * @returns {string} 32 位小写 hex
 */
function md5(str) {
  return md5Bytes(new TextEncoder().encode(str));
}

/**
 * HMAC-MD5（纯 JS 实现，基于字节数组）
 * @param {string} key - 密钥
 * @param {string} message - 消息
 * @returns {string} 32 位小写 hex
 */
function hmacMd5(key, message) {
  const blockSize = 64;
  let k = new TextEncoder().encode(key);
  if (k.length > blockSize) {
    k = hexToBytes(md5Bytes(k));
  }
  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = (k[i] || 0) ^ 0x36;
    opad[i] = (k[i] || 0) ^ 0x5c;
  }
  const msgBytes = new TextEncoder().encode(message);
  const inner = new Uint8Array(blockSize + msgBytes.length);
  inner.set(ipad);
  inner.set(msgBytes, blockSize);
  const innerHash = md5Bytes(inner);
  const outer = new Uint8Array(blockSize + 16);
  outer.set(opad);
  outer.set(hexToBytes(innerHash), blockSize);
  return md5Bytes(outer);
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}


// ─────────────────────────────────────────────
// 签名
// ─────────────────────────────────────────────

/**
 * 计算 uniCloud 请求签名（x-serverless-sign）
 * 算法：body 顶层字段按 key 排序，过滤空值后按 key=value 用 & 拼接，
 *       再用 clientSecret 做 HMAC-MD5，输出 hex。
 * @param {object} body - 请求体
 * @param {string} clientSecret - 空间密钥
 * @returns {string} 签名 hex
 */
export function sign(body, clientSecret) {
  let n = '';
  Object.keys(body)
    .sort()
    .forEach(function (key) {
      if (body[key]) {
        n = n + '&' + key + '=' + body[key];
      }
    });
  n = n.slice(1);
  return hmacMd5(clientSecret, n);
}

// ─────────────────────────────────────────────
// 底层请求封装
// ─────────────────────────────────────────────

/**
 * 读取轻匿客户端配置
 * @param {object} env - Cloudflare Pages env
 * @returns {{spaceId:string, clientSecret:string, endpoint:string}}
 */
function getConfig(env = {}) {
  return {
    spaceId: env.QINGNI_SPACE_ID,
    clientSecret: env.QINGNI_CLIENT_SECRET,
    endpoint: env.QINGNI_ENDPOINT || DEFAULT_ENDPOINT,
  };
}

/**
 * 发起 uniCloud 网关请求（带签名）
 * @param {object} env - Cloudflare Pages env
 * @param {object} body - 请求体
 * @param {string} [token] - 可选 accessToken（认证后携带）
 * @param {number} [timeout=15000] - 超时毫秒
 * @returns {Promise<{ok:boolean, data?:any, status?:number, error?:string}>}
 */
export async function request(env, body, token, timeout = 15000) {
  const { spaceId, clientSecret, endpoint } = getConfig(env);
  if (!spaceId || !clientSecret) {
    return { ok: false, error: 'QINGNI_SPACE_ID / QINGNI_CLIENT_SECRET 未配置' };
  }

  const sig = sign(body, clientSecret);
  const headers = {
    'Content-Type': 'application/json',
    'x-serverless-sign': sig,
  };
  if (token) {
    headers['x-basement-token'] = token;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await resp.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = null;
    }
    if (!resp.ok) {
      return { ok: false, status: resp.status, data: json, error: `HTTP ${resp.status}` };
    }
    return { ok: true, status: resp.status, data: json };
  } catch (e) {
    if (e.name === 'AbortError') {
      return { ok: false, error: `请求超时（${timeout / 1000}s）` };
    }
    return { ok: false, error: `网络错误: ${e.message}` };
  }
}

/**
 * 匿名认证，获取 accessToken（有效期 600 秒）
 * @param {object} env - Cloudflare Pages env
 * @returns {Promise<{ok:boolean, token?:string, error?:string}>}
 */
export async function anonymousAuthorize(env) {
  const { spaceId } = getConfig(env);
  const body = {
    method: 'serverless.auth.user.anonymousAuthorize',
    params: '{}',
    spaceId,
    timestamp: Date.now(),
  };
  const res = await request(env, body);
  if (!res.ok) {
    return { ok: false, error: res.error || '认证请求失败' };
  }
  const token = res.data && res.data.data && res.data.data.accessToken;
  if (!token) {
    return { ok: false, error: '认证响应缺少 accessToken' };
  }
  return { ok: true, token };
}

/**
 * 调用 uniCloud 云函数（含 clientDB）
 * @param {object} env - Cloudflare Pages env
 * @param {string} token - accessToken
 * @param {string} name - 云函数名（如 DCloud-clientDB）
 * @param {object} data - 函数参数
 * @returns {Promise<{ok:boolean, data?:any, error?:string}>}
 */
export async function callFunction(env, token, name, data = {}) {
  const { spaceId } = getConfig(env);
  const body = {
    method: 'serverless.function.runtime.invoke',
    params: JSON.stringify({ functionTarget: name, functionArgs: data || {} }),
    spaceId,
    timestamp: Date.now(),
    token,
  };
  const res = await request(env, body, token);
  if (!res.ok) {
    return { ok: false, error: res.error || '云函数调用失败' };
  }
  return { ok: true, data: res.data };
}

// ─────────────────────────────────────────────
// clientDB 查询封装
// ─────────────────────────────────────────────

/**
 * 用 url_code 查询提问箱信息（ask_box_info）
 * @param {object} env - Cloudflare Pages env
 * @param {string} urlCode - 分享码（如 TNMY2E）
 * @returns {Promise<{ok:boolean, box?:object, error?:string}>}
 */
export async function queryAskBoxInfo(env, urlCode) {
  if (!urlCode || typeof urlCode !== 'string') {
    return { ok: false, error: 'url_code 无效' };
  }
  const auth = await anonymousAuthorize(env);
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }

  const command = {
    $db: [
      { $method: 'collection', $param: ['ask_box_info'] },
      {
        $method: 'where',
        $param: [
          "default_url_code=='" + urlCode + "'||custom_url_code=='" + urlCode + "'",
        ],
      },
      { $method: 'get', $param: [] },
    ],
  };
  const data = { action: undefined, command, multiCommand: false };

  const res = await callFunction(env, auth.token, 'DCloud-clientDB', data);
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  const inner = res.data && res.data.data && res.data.data.data;
  if (res.data && res.data.data && res.data.data.code === 0 && Array.isArray(inner)) {
    return { ok: true, box: inner[0] || null };
  }
  return { ok: false, error: 'ask_box_info 查询失败', data: res.data };
}

/**
 * 用 user_id 查询公开问答列表（ask_box_question）
 * 仅读取 is_public_reply=true 且 status=1 的公开数据。
 * @param {object} env - Cloudflare Pages env
 * @param {string} userId - 提问箱主人 user_id
 * @param {object} [options]
 * @param {number} [options.limit=50] - 单次拉取条数
 * @param {number} [options.skip=0] - 跳过条数
 * @param {number} [options.days=365] - 只取最近 N 天
 * @returns {Promise<{ok:boolean, questions?:Array, count?:number, error?:string}>}
 */
export async function queryAskBoxQuestions(env, userId, options = {}) {
  if (!userId || typeof userId !== 'string') {
    return { ok: false, error: 'user_id 无效' };
  }
  const limit = options.limit || 50;
  const skip = options.skip || 0;
  const days = options.days || 365;
  const timeThreshold = Date.now() - days * 86400000;

  const auth = await anonymousAuthorize(env);
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }

  const command = {
    $db: [
      { $method: 'collection', $param: ['ask_box_question'] },
      {
        $method: 'where',
        $param: [
          "user_id=='" + userId + "'&&is_public_reply==true&&status==1&&create_time>" + timeThreshold,
        ],
      },
      { $method: 'field', $param: ['question,create_time,chat_list,update_time'] },
      { $method: 'orderBy', $param: ['update_time desc'] },
      { $method: 'skip', $param: [skip] },
      { $method: 'limit', $param: [limit] },
      { $method: 'get', $param: [{ getCount: true }] },
    ],
  };
  const data = { action: undefined, command, multiCommand: false };

  const res = await callFunction(env, auth.token, 'DCloud-clientDB', data);
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  const inner = res.data && res.data.data && res.data.data.data;
  if (res.data && res.data.data && res.data.data.code === 0 && Array.isArray(inner)) {
    return {
      ok: true,
      questions: inner,
      count: res.data.data.count || inner.length,
    };
  }
  return { ok: false, error: 'ask_box_question 查询失败', data: res.data };
}
