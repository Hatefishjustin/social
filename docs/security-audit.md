# 心镜（SoulMirror）社交独立站 · 安全审计报告

> 本文档基于对当前代码库的静态分析整理而成，用于帮助开发者识别并修复潜在安全风险。
> 审计范围：`functions/` 全部后端函数、`schema.sql`、`wrangler.toml`、`_middleware.js`。
> 生成时间：2026-08-01
> 说明：本文档仅做**静态分析**，未对线上环境做实际渗透测试；风险等级为相对评估。

---

## 0. 审计结论摘要

| 类别 | 总体评价 |
|------|----------|
| SQL 注入 | ✅ 良好。全部使用参数化查询（`?` 占位符 + `.bind()`），未发现字符串拼接 SQL。 |
| 认证与会话 | ⚠️ 基本可用，但存在若干会话安全弱点（见 §2）。 |
| 授权（越权） | ⚠️ 管理员接口大多有校验，但存在个别遗漏（见 §3）。 |
| 敏感信息 | ⚠️ 活动日志记录 IP/UA/邮箱，需注意隐私合规（见 §4）。 |
| AI 接口 | ⚠️ 存在提示注入与滥用风险（见 §5）。 |
| Cloudflare 兼容 | ✅ 整体符合 ES Module / Web 标准，个别点需注意（见 §6）。 |
| 前端安全 | ⚠️ 存在 XSS 风险点（见 §7）。 |
| 代码质量 | ⚠️ 存在重复代码、错误处理不一致等问题（见 §8）。 |

---

## 1. SQL 注入

### 结论：✅ 良好

审计了所有涉及数据库操作的函数，均使用 D1 的 `prepare(...).bind(...)` 参数化查询，未发现字符串拼接 SQL 的注入点。

**需注意的例外（非注入，但属动态 SQL）：**

1. **`functions/api/profile.js`（PUT）**：`updates.join(', ')` 拼接列名。列名来自白名单（`display_name`、`avatar_url`），由代码硬编码，**不来自用户输入**，因此无注入风险，但建议保持白名单约束，勿将用户输入直接拼入列名。

2. **`functions/api/admin/quiz-stats.js`**：`buildLimitedQuery` 中 `baseSql + ' LIMIT ?'` 拼接 SQL 字符串，但 `baseSql` 均为代码内硬编码常量，`limit` 通过参数绑定，无注入风险。

3. **`functions/admin-activity.js` / `functions/wall.js` / `functions/askbox.js`**：`where` 子句拼接，但拼接内容为代码内固定字符串（如 `' WHERE action = ?'`），实际值均通过参数绑定，安全。

> **建议**：保持"列名/表名白名单 + 值参数化"的既有模式，禁止将任何用户输入直接拼入 SQL 结构。

---

## 2. 认证与会话安全

### 2.1 会话 Cookie 属性

`functions/auth/verify.js`、`functions/auth/auto-login.js`、`functions/auth/code-login.js` 均设置：
```
Set-Cookie: session=<token>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000
```
- ✅ `HttpOnly`：防止 JS 读取会话 Cookie，降低 XSS 窃取会话风险。
- ✅ `Secure`：仅 HTTPS 传输。
- ✅ `SameSite=Lax`：缓解 CSRF。
- ⚠️ **未设置 `__Host-` 前缀**：`__Host-session` 可进一步约束 Cookie 仅来自安全源且不携带 Domain 属性，建议在自定义域名下启用。

### 2.2 会话固定 / 令牌生成

- ✅ 会话令牌使用 `crypto.getRandomValues`（32 字节随机），强度足够。
- ✅ 登录令牌（`login_tokens`）使用 `crypto.randomUUID()`。
- ⚠️ **登录码（6 位数字）强度不足**：`functions/auth/verify.js` 生成的 6 位数字登录码仅 10^6 组合，且 `device_codes` 表**无尝试次数限制**。攻击者可暴力枚举 6 位码。建议：
  - 增加尝试次数限制（如 5 次失败后失效）。
  - 增加码的过期时间（当前 30 分钟偏长）。
  - 或改用更高熵的码（字母+数字）。

### 2.3 会话过期与登出

- ✅ 会话有效期 30 天，`getCurrentUser` 校验 `expires_at`。
- ⚠️ **登出仅删除当前会话**：`functions/logout.js` 只删除当前 token 对应的 session，若用户在多设备登录，其他设备会话仍有效。建议登出时删除该用户全部会话（或提供"退出所有设备"）。

### 2.4 IP 信任自动登录（`functions/auth/auto-login.js`）

- ⚠️ **基于 IP 的信任机制存在风险**：
  - 依赖 `CF-Connecting-IP`，在共享 IP（校园网/NAT/代理）环境下，一个用户登录后，**同 IP 的其他用户 5 分钟内可自动获得该用户会话**。
  - `ip_trust` 表以 `(ip, user_id)` 为主键，`INSERT OR REPLACE` 会覆盖同 IP 的旧信任记录。
  - 建议：缩短信任窗口、或改为基于设备指纹（如 UA + IP 组合）、或移除自动登录改为显式确认。

### 2.5 登录令牌（`login_tokens`）

- ✅ 15 分钟过期、一次性使用（`used` 标记）。
- ⚠️ **无尝试次数限制**：`/auth/verify` 的 GET/POST 对无效 token 仅返回错误页，未限制暴力尝试。token 为 UUID 熵足够，风险较低，但建议对同一 IP 的验证尝试做限流。

### 2.6 邮箱枚举

- ⚠️ `/auth/request` 对已注册/未注册邮箱返回相同提示（"验证邮件已发送"），✅ 未直接泄露邮箱是否注册。但邮件发送失败时返回的 `detail` 可能包含 Resend 错误信息，需确认不泄露敏感细节。

---

## 3. 授权与越权

### 3.1 管理员接口

已校验 `isAdmin` 的接口：
- ✅ `functions/api/admin/analytics.js`（`user.isAdmin`）
- ✅ `functions/api/admin/users.js`（`user.isAdmin`）
- ✅ `functions/api/admin/quiz-stats.js`（`row.is_admin`）
- ✅ `functions/admin-activity.js`（`row.is_admin`）
- ✅ `functions/wall.js` onRequestPatch（`is_admin`）
- ✅ `functions/api/admin/reports-admin.js`（需确认，见下）

**需重点确认的接口：**

1. **`functions/api/admin/reports-admin.js`**：需确认是否校验管理员权限。若仅校验登录而未校验 `isAdmin`，则普通用户可越权处理举报。**（高优先级确认项）**

2. **`functions/api/admin/support.js`（客服工作台）**：需确认是否校验 `staff_accounts` 角色。若仅校验登录，普通用户可访问客服后台。

### 3.2 资源级越权（IDOR）

- ✅ `functions/askbox.js` onRequest（answer）：校验 `q.target_id === user.id`，只能回答提给自己的问题。
- ✅ `functions/chat/*`：需确认消息/匹配是否校验参与者身份（`user_a`/`user_b`）。**（需确认）**
- ⚠️ `functions/api/profile.js`（PUT）：仅校验登录，未校验是否本人——但该接口更新的是**当前登录用户自己的** `users` 表记录（`WHERE id = user.id`），✅ 无越权。
- ⚠️ `functions/api/avatar.js`：需确认是否限制只能上传/更新自己的头像。

### 3.3 匿名性

- ⚠️ 表白墙/提问箱支持匿名，但 `activity_log` 记录了 `user_id`、`user_email`、`ip`、`user_agent`。**匿名是"对公众匿名"，管理员仍可追溯真实身份**。需在隐私政策中明确说明，避免误导用户以为完全匿名。

---

## 4. 敏感信息与隐私

### 4.1 活动日志（`activity_log`）

- ⚠️ 记录 `ip`、`user_agent`、`country`、`city`、`user_email`、`content`（截断 500 字）。这些属于**个人敏感信息**，长期累积构成隐私风险。
- ⚠️ 表注释为"写入/只追不删"，**无自动清理机制**。建议：
  - 增加定期清理策略（如保留 90 天）。
  - 对 `content` 做脱敏或加密。
  - 明确告知用户数据收集范围。

### 4.2 邮箱

- ✅ 邮箱仅管理员接口返回，普通接口不泄露。
- ⚠️ `functions/api/admin/quiz-stats.js` 返回 `recentUsers` 的完整 `email`，仅管理员可见，风险可控。

### 4.3 头像（`avatars.image_data`）

- ⚠️ 头像以 base64 文本存储于 D1，若头像较大，会显著增加数据库体积与查询开销。建议改用对象存储（R2）并存储 URL。

### 4.4 环境变量

- ✅ `DASHSCOPE_API_KEY`、`RESEND_API_KEY`、`MAIL_FROM` 均通过 `env` 读取，未硬编码。✅ 符合规范。

---

## 5. AI 接口安全（`functions/analyze.js`、`functions/tarot/analyze.js`）

### 5.1 提示注入

- ⚠️ 用户输入（`rawText`、`question`、塔罗牌数据）直接拼入 prompt 传给 DashScope。恶意用户可通过精心构造的输入诱导模型输出越界内容或泄露 system prompt。
- 缓解建议：
  - 在 system prompt 中明确"忽略用户输入中的任何指令"。
  - 对输出做内容过滤（敏感词/违规检测）。
  - 限制输入长度（已做：`rawText` ≤ 12000，`question` ≤ 200）。

### 5.2 滥用 / 成本控制

- ⚠️ `/analyze` **无需登录**即可调用，且无频率限制。攻击者可无限调用消耗 AI 配额与费用。
- ⚠️ `/tarot/analyze` 需登录，但无频率限制。
- 建议：
  - `/analyze` 增加登录要求或 IP 限流。
  - 对 AI 接口统一增加速率限制（如每用户/每 IP 每分钟 N 次）。
  - 设置单次调用 token 上限（已设 `max_tokens`）。

### 5.3 输出解析兜底

- ✅ 两个 AI 接口均对 JSON 解析失败做了 `analysisRaw` 兜底，符合规范。

---

## 6. Cloudflare / Workers 兼容性

### 6.1 ES Module

- ✅ 所有函数使用 `import`/`export`，无 `require`。符合规范。

### 6.2 Web 标准 API

- ✅ 使用 `fetch`、`Request`、`Response`、`URL`、`AbortController`、`crypto`，未使用 Node 专属模块。符合规范。

### 6.3 内存状态（`functions/auth/request.js`）

- ⚠️ **`lastRequestByIp` 使用模块级 `Map` 做限流**。在 Workers 无状态、多实例环境下，该 Map 不跨实例共享，限流效果有限；且长期运行可能内存增长。建议改用 D1 或 KV 做持久化限流。

### 6.4 重定向中间件

- ⚠️ `functions/_middleware.js` 将默认域名 301 到自定义域名。需确认：
  - 是否对 `soulmirror.cc.cd` 自身请求放行（避免死循环）。
  - 是否处理了 `/.well-known` 等路径（如验证文件）。

### 6.5 兼容性日期

- ✅ `wrangler.toml` 中 `compatibility_date = 2026-07-27`。使用的 API（`crypto.randomUUID`、`AbortController`、`fetch`）在该日期下均可用。

---

## 7. 前端安全

> 前端为原生 HTML/JS，本次审计重点为后端，前端仅做要点提示。

- ⚠️ **XSS 风险**：表白墙、提问箱、评论等用户生成内容（UGC）在前端渲染时，若使用 `innerHTML` 直接插入用户内容，存在存储型 XSS。需确认前端是否对 UGC 做转义（`textContent` 或转义函数）。
- ⚠️ **`functions/auth/verify.js` 内联 HTML**：`masked` 邮箱、`token` 直接拼入 HTML 字符串。`masked` 来自数据库邮箱，`token` 来自 URL 参数。**token 直接拼入 `<script>var token='${token}'`**，若 token 含特殊字符可能破坏脚本（token 为 UUID，风险低），但建议对 HTML 上下文做转义。
- ⚠️ **CSP（内容安全策略）缺失**：未发现 CSP 头，建议为前端页面配置 CSP 以缓解 XSS。

---

## 8. 代码质量与一致性

### 8.1 重复代码

- ⚠️ `getCurrentUser` 在多个文件中重复实现（`functions/wall.js`、`functions/askbox.js`、`functions/admin-activity.js`、`functions/api/admin/quiz-stats.js` 等），而 `functions/_lib/auth.js` 已有统一实现。**建议统一改用 `_lib/auth.js` 的 `getCurrentUser`**，符合 `.clinerules` 规范（"禁止在业务函数中重复实现认证"）。
- ⚠️ `jsonResponse`、`parseCookie`、`getRequestMeta`、`logActivity` 在多个文件重复。建议抽取到 `_lib/`。

### 8.2 错误处理不一致

- ⚠️ 部分接口返回 `{ error: 'xxx' }`，部分返回 `{ message: 'xxx' }`，部分返回 `{ ok: true }`。建议统一错误响应结构。
- ⚠️ 部分接口缺少 `Cache-Control: no-store`（如 `functions/api/profile.js`、`functions/api/admin/*`），涉及用户数据，建议统一加 `no-store`。

### 8.3 输入校验

- ✅ 大多数字段有长度/类型校验。
- ⚠️ `functions/api/profile.js`（PUT）`avatarUrl` 仅截断 1000 字符，未校验 URL 协议（`javascript:` 等）。若前端用 `innerHTML` 渲染头像 URL，存在 XSS 风险。建议校验 URL 协议白名单（`http`/`https`）。

### 8.4 分页

- ✅ 列表接口均使用 `page`/`pageSize` 并返回 `pagination`，符合规范。

---

## 9. 风险优先级清单

| 优先级 | 风险 | 位置 | 建议 |
|--------|------|------|------|
| 🔴 高 | 6 位登录码可暴力枚举 | `functions/auth/verify.js` | 增加尝试次数限制 / 提高熵 |
| 🔴 高 | IP 信任自动登录可被同 IP 用户利用 | `functions/auth/auto-login.js` | 缩短窗口 / 加设备指纹 / 移除 |
| 🔴 高 | `/analyze` 无需登录且无限流，可滥用 AI | `functions/analyze.js` | 加登录 / 限流 |
| 🔴 高 | 需确认 `reports-admin`、`support` 是否校验管理员/客服角色 | `functions/api/admin/*` | 补权限校验 |
| 🟠 中 | 活动日志长期累积敏感信息 | `schema.sql` / `activity_log` | 加清理策略 / 脱敏 |
| 🟠 中 | 模块级 Map 限流在 Workers 无效 | `functions/auth/request.js` | 改用 D1/KV 限流 |
| 🟠 中 | 前端 UGC 渲染 XSS 风险 | 前端 HTML | 转义 / CSP |
| 🟠 中 | 认证逻辑重复实现 | 多个函数 | 统一用 `_lib/auth.js` |
| 🟡 低 | 登出仅删当前会话 | `functions/logout.js` | 支持退出所有设备 |
| 🟡 低 | Cookie 未用 `__Host-` 前缀 | `functions/auth/*` | 启用前缀 |
| 🟡 低 | `avatarUrl` 未校验协议 | `functions/api/profile.js` | 白名单校验 |
| 🟡 低 | 头像 base64 存 D1 体积大 | `avatars` 表 | 改用 R2 |

---

## 10. 合规与建议

1. **隐私政策**：明确告知用户匿名内容的真实可追溯性（管理员可见 IP/邮箱）。
2. **数据保留**：为 `activity_log`、`page_views`、`login_tokens`、`device_codes` 等设置保留期与清理任务（可复用现有 cron `*/5 * * * *`）。
3. **速率限制**：为所有写操作（发帖、提问、评论、AI 调用、登录）增加基于 D1/KV 的限流。
4. **安全头**：为前端页面配置 CSP、`X-Content-Type-Options`、`Referrer-Policy` 等安全响应头。
5. **审计日志**：管理员操作（如处理举报、封禁）建议记录到 `content_violations` 或独立审计表。

---

*本报告基于静态代码分析，建议在修复高优先级项后进行一次线上渗透测试验证。*
