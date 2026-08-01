# 心镜（SoulMirror）社交独立站 · 安全问题修复计划

> 本文档基于 `.clinerules`、`docs/project-analysis.md`、`docs/security-audit.md` 制定。
> 生成时间：2026-08-01
> 说明：本计划**仅做方案设计，不修改任何代码**。所有改动需在确认后按 `.clinerules` 规范实施。

---

## 0. 修复优先级总览

| 优先级 | 编号 | 问题 | 是否需数据库迁移 |
|--------|------|------|------------------|
| 🔴 P0 | S-01 | `content_violations` 表字段与代码不一致，违规记录写入会失败 | ✅ 是 |
| 🔴 P0 | S-02 | 6 位登录码可暴力枚举，`device_codes` 无尝试次数限制 | ✅ 是 |
| 🔴 P0 | S-03 | IP 信任自动登录可被同 IP 用户利用（会话劫持） | ✅ 是 |
| 🔴 P0 | S-04 | `/analyze` 无需登录且无限流，可滥用 AI 消耗配额 | ❌ 否 |
| 🟠 P1 | S-05 | 模块级 `Map` 限流在 Workers 多实例下无效 | ✅ 是 |
| 🟠 P1 | S-06 | 前端 UGC 渲染存在存储型 XSS 风险 | ❌ 否 |
| 🟠 P1 | S-07 | 活动日志长期累积敏感信息，无清理机制 | ✅ 是 |
| 🟠 P1 | S-08 | 认证逻辑在多个业务函数中重复实现 | ❌ 否 |
| 🟡 P2 | S-09 | 登出仅删除当前会话，多设备会话仍有效 | ❌ 否 |
| 🟡 P2 | S-10 | 会话 Cookie 未使用 `__Host-` 前缀 | ❌ 否 |
| 🟡 P2 | S-11 | `avatarUrl` 未校验 URL 协议（`javascript:` 等） | ❌ 否 |
| 🟡 P2 | S-12 | 头像 base64 存 D1 体积大，查询开销高 | ✅ 是 |
| 🟡 P2 | S-13 | 错误响应结构不一致、缺少 `Cache-Control: no-store` | ❌ 否 |
| 🟡 P2 | S-14 | 前端页面缺少 CSP 等安全响应头 | ❌ 否 |

---

## 🔴 P0 · 高优先级（必须优先修复）

### S-01 · `content_violations` 表字段与代码不一致

**风险原因**
`functions/chat/send.js` 在写入违规记录时使用 `match_id, sender_id, content, violation_type` 四个字段，但 `schema.sql` 中 `content_violations` 表定义的是 `user_id, report_id, action, admin_id, admin_note`。字段名完全对不上，导致：
- 插入语句会因"列不存在"报错，违规记录**无法写入**。
- 后续查询 `SELECT violation_type FROM content_violations WHERE match_id = ?` 也会失败，导致**敏感词自动关闭会话的累计严重度逻辑失效**。

**影响范围**
- `functions/chat/send.js`（写入 + 累计严重度查询）
- `schema.sql`（表结构定义）
- 线上 D1 数据库 `content_violations` 表

**修改文件**
- `schema.sql`
- `functions/chat/send.js`

**修改方案**
二选一（推荐方案 A，改动最小且符合现有代码逻辑）：
- **方案 A（推荐）**：在 `schema.sql` 中为 `content_violations` 表**新增** `match_id`、`sender_id`、`content`、`violation_type` 字段（保留原有字段以兼容），并同步线上 `ALTER TABLE`。`send.js` 代码无需改动。
- **方案 B**：修改 `send.js`，将违规记录写入改为使用现有字段（`user_id`、`action`、`admin_note`），并调整累计严重度查询逻辑。改动面较大，需重写违规统计逻辑。

**是否需要数据库迁移**
✅ **是**。需在 `schema.sql` 记录迁移说明，并在线上 D1 执行：
```sql
ALTER TABLE content_violations ADD COLUMN match_id INTEGER;
ALTER TABLE content_violations ADD COLUMN sender_id INTEGER;
ALTER TABLE content_violations ADD COLUMN content TEXT;
ALTER TABLE content_violations ADD COLUMN violation_type TEXT;
```
（若采用方案 B 则无需迁移，但需改代码。）

---

### S-02 · 6 位登录码可暴力枚举

**风险原因**
`functions/auth/verify.js` 生成的跨设备登录码为 6 位纯数字（仅 10^6 = 100 万种组合），且 `device_codes` 表**无尝试次数限制**、无失败计数。攻击者可在 30 分钟有效期内对同一 `user_id` 或同一 IP 暴力枚举，一旦命中即可获得该用户会话。

**影响范围**
- `functions/auth/verify.js`（生成登录码）
- `schema.sql`（`device_codes` 表）
- 线上 D1 数据库

**修改文件**
- `schema.sql`
- `functions/auth/verify.js`
- 前端 `login.html`（若登录码输入流程需要展示错误/锁定提示）

**修改方案**
1. **增加尝试次数限制**：在 `device_codes` 表新增 `attempts`（失败次数）与 `locked`（是否锁定）字段；校验时若 `attempts >= 5` 或已锁定则拒绝。
2. **缩短有效期**：将登录码有效期从 30 分钟缩短至 10 分钟。
3. **提高熵**：将 6 位纯数字改为 6 位字母+数字（大小写 + 数字，约 56 亿组合），或至少改为 8 位数字。
4. **失败计数**：校验失败时 `attempts = attempts + 1`，达到阈值后锁定该码。
5. **IP 限流**：对同一 IP 的登录码校验尝试做限流（可复用 S-05 的 D1 限流方案）。

**是否需要数据库迁移**
✅ **是**。需在 `schema.sql` 记录迁移说明，并在线上 D1 执行：
```sql
ALTER TABLE device_codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_codes ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
```

---

### S-03 · IP 信任自动登录可被同 IP 用户利用

**风险原因**
`functions/auth/auto-login.js` 仅依据 `CF-Connecting-IP` 判断是否自动登录。在校园网 / NAT / 代理等共享 IP 环境下，用户 A 登录后 5 分钟内，**同 IP 的用户 B 访问 `/auth/auto-login` 即可自动获得用户 A 的会话**，造成会话劫持。`ip_trust` 表以 `(ip, user_id)` 为主键，`INSERT OR REPLACE` 会覆盖同 IP 旧记录，进一步放大风险。

**影响范围**
- `functions/auth/auto-login.js`
- `functions/auth/verify.js`（写入 `ip_trust`）
- `schema.sql`（`ip_trust` 表）
- 线上 D1 数据库

**修改文件**
- `functions/auth/auto-login.js`
- `functions/auth/verify.js`
- `schema.sql`

**修改方案**
1. **加入设备指纹**：将信任键从纯 IP 改为 `IP + User-Agent`（或 `IP + UA 哈希`）组合，降低同 IP 不同设备误登录概率。
2. **缩短信任窗口**：将 5 分钟缩短至 1~2 分钟。
3. **改为显式确认**（更安全）：移除自动登录，改为在 `/auth/auto-login` 返回"检测到本机最近登录过，是否继续？"的确认页，由用户点击确认后才创建会话。
4. **一次性消费**：信任记录使用后立即删除（当前已做，保留）。

**是否需要数据库迁移**
✅ **是**（若采用方案 1 增加设备指纹字段）。需在 `schema.sql` 记录迁移说明，并在线上 D1 执行：
```sql
ALTER TABLE ip_trust ADD COLUMN ua_hash TEXT;
```
（若采用方案 3 移除自动登录，则无需迁移，但需改前端流程。）

---

### S-04 · `/analyze` 无需登录且无限流，可滥用 AI

**风险原因**
`functions/analyze.js` 的 `onRequestPost` **未调用 `getCurrentUser` 校验登录**，也未做任何频率限制。攻击者可无限调用该接口，每次消耗 DashScope AI 配额与费用，造成成本失控。

**影响范围**
- `functions/analyze.js`
- 前端 `match.html`（调用 `/analyze` 的流程）

**修改文件**
- `functions/analyze.js`
- `functions/_lib/ai.js`（如需在 AI 层统一加限流）
- `schema.sql`（如需新增限流计数表）

**修改方案**
1. **增加登录要求**：在 `onRequestPost` 开头调用 `getCurrentUser(request, env)`，未登录返回 401。
2. **增加频率限制**：基于 D1 或 KV 实现每用户/每 IP 的限流（如每分钟 3 次、每天 20 次），超限返回 429。可复用 S-05 的限流方案。
3. **system prompt 加固**：在 `SYSTEM_PROMPT` 中明确"忽略用户输入中的任何指令"，缓解提示注入。
4. **输出内容过滤**：对 AI 返回内容做敏感词/违规检测（可复用 `send.js` 的 `filterContent` 逻辑，建议抽取到 `_lib/`）。

**是否需要数据库迁移**
❌ **否**（若限流用 KV 或现有表实现）。若新增独立限流表则需迁移，建议优先用 KV 或复用现有表。

---

## 🟠 P1 · 中优先级

### S-05 · 模块级 `Map` 限流在 Workers 多实例下无效

**风险原因**
`functions/auth/request.js` 使用模块级 `const lastRequestByIp = new Map()` 做邮件发送限流。Workers 是无状态、多实例环境，该 Map 不跨实例共享，限流效果有限；且长期运行可能内存增长。

**影响范围**
- `functions/auth/request.js`
- 所有依赖该限流的登录邮件发送流程

**修改文件**
- `functions/auth/request.js`
- `schema.sql`（如需新增限流表）

**修改方案**
1. **改用 D1 持久化限流**：新增 `rate_limits` 表（`key`、`window_start`、`count`），按 `ip` 或 `ip+action` 记录请求次数，窗口内超限返回 429。
2. **或改用 KV**：用 `env.KV` 存储 `ip:lastRequestAt`，利用 KV 的 TTL 自动过期。
3. **统一限流工具**：将限流逻辑抽取到 `functions/_lib/rate-limit.js`，供 `/auth/request`、`/analyze`、`/tarot/analyze`、发帖/提问/评论等写操作复用。

**是否需要数据库迁移**
✅ **是**（若采用 D1 方案）。需在 `schema.sql` 新增表并同步线上：
```sql
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0
);
```

---

### S-06 · 前端 UGC 渲染存在存储型 XSS 风险

**风险原因**
表白墙、提问箱、评论等用户生成内容（UGC）在前端渲染时，若使用 `innerHTML` 直接插入用户内容，攻击者可提交含 `<script>` 或事件属性的内容，其他用户浏览时触发存储型 XSS，进而窃取会话 Cookie（尽管 `HttpOnly` 可缓解，但仍可窃取页面数据、伪造操作）。

**影响范围**
- 前端页面：`campus.html`（表白墙）、`qa.html`（提问箱）、`chat.html`（聊天）、`index.html`（通知/反馈）、`profile.html`、`user.html`
- 后端 `functions/wall.js`、`functions/askbox.js`、`functions/chat/*`（若需在写入时做转义/过滤）

**修改文件**
- 前端各 UGC 渲染页面（改用 `textContent` 或统一转义函数）
- 建议新增 `frontend-utils.js`（或复用现有脚本）提供 `escapeHtml()` 工具

**修改方案**
1. **前端渲染转义**：所有 UGC 渲染统一使用 `textContent` 赋值，或使用 `escapeHtml()` 转义后再 `innerHTML`。
2. **后端输出过滤**：在写入时对 `content` 做 HTML 转义或剥离 `<script>` 标签（注意与敏感词过滤叠加）。
3. **配置 CSP**：为前端页面配置内容安全策略（见 S-14），作为纵深防御。

**是否需要数据库迁移**
❌ **否**。

---

### S-07 · 活动日志长期累积敏感信息，无清理机制

**风险原因**
`activity_log` 表记录 `ip`、`user_agent`、`country`、`city`、`user_email`、`content`（截断 500 字）等个人敏感信息，且表注释为"写入/只追不删"，**无自动清理机制**。长期累积构成隐私合规风险（如《个人信息保护法》对数据最小化与保留期限的要求）。

**影响范围**
- `schema.sql`（`activity_log` 表）
- 线上 D1 数据库
- 写入 `activity_log` 的各业务函数

**修改文件**
- `schema.sql`
- 新增清理逻辑（可复用现有 cron `*/5 * * * *`，或新增定时任务）

**修改方案**
1. **定期清理**：新增 cron 任务（在 `wrangler.toml` 的 `[triggers]` 声明），定期删除超过保留期（如 90 天）的 `activity_log`、`page_views`、`login_tokens`、`device_codes` 记录。
2. **敏感字段脱敏**：对 `content` 做脱敏（如截断、去除邮箱/手机号），或对 `ip` 做哈希/掩码存储。
3. **隐私政策**：在站点明确告知用户匿名内容的真实可追溯性（管理员可见 IP/邮箱）。

**是否需要数据库迁移**
❌ **否**（清理逻辑不改变表结构）。若需新增脱敏字段则需迁移，建议优先用清理策略。

---

### S-08 · 认证逻辑在多个业务函数中重复实现

**风险原因**
`getCurrentUser`、`parseCookie`、`jsonResponse` 在 `functions/wall.js`、`functions/askbox.js`、`functions/admin-activity.js`、`functions/api/admin/quiz-stats.js`、`functions/chat/*`、`functions/admin/support-*.js` 等多个文件中重复实现，而 `functions/_lib/auth.js` 已有统一实现。重复实现易导致：
- 认证逻辑不一致（如部分实现未返回 `isAdmin`）。
- 后续安全修复需在多处同步修改，易遗漏。

**影响范围**
- 所有重复实现 `getCurrentUser` 的业务函数（见上）

**修改文件**
- 各业务函数（统一改为 `import { getCurrentUser } from '../_lib/auth.js'`）
- `functions/_lib/auth.js`（如需补充 `isStaff` 等能力）

**修改方案**
1. 将各业务函数中的 `parseCookie` + `getCurrentUser` 重复实现替换为 `import { getCurrentUser } from '../_lib/auth.js'`。
2. 将 `jsonResponse` 抽取到 `functions/_lib/response.js`（或并入 `auth.js`），统一响应结构。
3. 在 `_lib/auth.js` 中补充 `isStaff(userId, env)` 辅助函数，供客服接口复用。

**是否需要数据库迁移**
❌ **否**。

---

## 🟡 P2 · 低优先级（建议在 P0/P1 完成后处理）

### S-09 · 登出仅删除当前会话，多设备会话仍有效

**风险原因**
`functions/logout.js` 仅删除当前 Cookie 对应的 session token。若用户在多设备登录，登出一个设备后其他设备会话仍有效，存在会话残留风险。

**影响范围**
- `functions/logout.js`

**修改文件**
- `functions/logout.js`

**修改方案**
1. 登出时删除该用户**全部**会话：先解析当前 session 获取 `user_id`，再 `DELETE FROM sessions WHERE user_id = ?`。
2. 或提供"退出所有设备"选项（前端加按钮，后端新增接口）。

**是否需要数据库迁移**
❌ **否**。

---

### S-10 · 会话 Cookie 未使用 `__Host-` 前缀

**风险原因**
`functions/auth/verify.js`、`functions/auth/auto-login.js`、`functions/auth/code-login.js` 设置的 `session` Cookie 未使用 `__Host-` 前缀。`__Host-` 前缀可强制 Cookie 仅来自安全源、不携带 `Domain` 属性，进一步降低被跨域注入/劫持的风险。

**影响范围**
- `functions/auth/verify.js`
- `functions/auth/auto-login.js`
- `functions/auth/code-login.js`
- `functions/logout.js`（清除 Cookie 时需同步改名）

**修改方案**
1. 将 Cookie 名从 `session` 改为 `__Host-session`，并确保不设置 `Domain` 属性。
2. 同步更新所有读取 `session` Cookie 的地方（`_lib/auth.js` 的 `parseCookie` 调用、`logout.js` 等）。
3. 注意：`__Host-` 前缀要求 Cookie 必须带 `Secure` 且无 `Domain`，当前已满足 `Secure`，需确认无 `Domain`。

**是否需要数据库迁移**
❌ **否**。

---

### S-11 · `avatarUrl` 未校验 URL 协议

**风险原因**
`functions/api/profile.js`（PUT）对 `avatarUrl` 仅截断 1000 字符，未校验 URL 协议。若前端用 `innerHTML` 渲染头像 URL，`javascript:` 等协议可触发 XSS。

**影响范围**
- `functions/api/profile.js`
- 前端 `profile.html`、`user.html`（头像渲染）

**修改方案**
1. 后端校验 `avatarUrl` 协议白名单（仅允许 `http:` / `https:`），非法返回 400。
2. 前端渲染头像时使用 `textContent` 或对 URL 做协议校验。

**是否需要数据库迁移**
❌ **否**。

---

### S-12 · 头像 base64 存 D1 体积大

**风险原因**
`avatars.image_data` 以 base64 文本存储于 D1。头像较大时显著增加数据库体积与查询开销，影响性能与成本。

**影响范围**
- `schema.sql`（`avatars` 表）
- `functions/api/avatar.js`（上传/读取）
- 前端头像渲染

**修改方案**
1. 改用 Cloudflare R2 对象存储保存头像文件，数据库仅存 R2 对象 URL。
2. 新增 `avatars` 表的 `object_key` 或复用 `users.avatar_url` 字段。
3. 迁移现有 base64 数据到 R2（一次性脚本）。

**是否需要数据库迁移**
✅ **是**（若新增字段）。需在 `schema.sql` 记录迁移说明，并在线上 D1 执行：
```sql
ALTER TABLE avatars ADD COLUMN object_key TEXT;
```
（若直接复用 `users.avatar_url` 存 R2 URL，则无需迁移，但需迁移现有数据。）

---

### S-13 · 错误响应结构不一致、缺少 `Cache-Control: no-store`

**风险原因**
部分接口返回 `{ error: 'xxx' }`，部分返回 `{ message: 'xxx' }`，部分返回 `{ ok: true }`，前端错误处理难以统一。且部分涉及用户数据的接口（如 `functions/api/profile.js`、`functions/api/admin/*`）缺少 `Cache-Control: no-store`，可能被缓存导致数据泄露或陈旧。

**影响范围**
- 所有后端函数（统一响应结构）
- `functions/api/profile.js`、`functions/api/admin/*`（补 `no-store`）

**修改方案**
1. 统一错误响应结构为 `{ error: 'xxx', message: 'xxx' }`（或统一为 `{ ok: false, error }`）。
2. 所有涉及用户数据的接口统一加 `Cache-Control: no-store`（可并入 `_lib/response.js` 的 `jsonResponse`）。

**是否需要数据库迁移**
❌ **否**。

---

### S-14 · 前端页面缺少 CSP 等安全响应头

**风险原因**
未发现 CSP（内容安全策略）头。配置 CSP 可缓解 XSS、数据注入等风险，是纵深防御的重要一环。

**影响范围**
- 前端所有页面（`*.html`）
- `functions/_middleware.js`（如需统一加响应头）

**修改方案**
1. 在 `functions/_middleware.js` 或各页面响应中配置 CSP 头（如 `default-src 'self'`、`script-src 'self'`、`img-src 'self' data:` 等）。
2. 补充 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY` 等安全头。
3. 注意：配置 CSP 前需梳理页面内联脚本/样式，避免误伤现有功能。

**是否需要数据库迁移**
❌ **否**。

---

## 附：审计中"需确认"项的核实结论

以下为 `security-audit.md` 中标记"需确认"的项，本次已核实：

| 审计项 | 核实结论 |
|--------|----------|
| `functions/api/admin/reports-admin.js` 是否校验管理员 | ⚠️ **该文件不存在**（`functions/api/admin/` 下仅有 `analytics.js`、`quiz-stats.js`、`users.js`）。现有 admin 接口均校验 `isAdmin`，无越权。 |
| `functions/api/admin/support.js` 是否校验客服角色 | ⚠️ **该文件不存在**。实际为 `functions/admin/support-matches.js`、`support-poll.js`、`support-send.js`，均校验 `isStaff`（`staff_accounts` 表），无越权。 |
| `functions/chat/*` 是否校验参与者身份 | ✅ 已核实 `send.js`、`history.js` 均校验 `user_a = ? OR user_b = ?`，无 IDOR。 |
| `functions/api/avatar.js` 是否限制本人 | ⚠️ 需进一步确认（本次未读取该文件），建议实施时核查。 |
| `_middleware.js` 是否放行自定义域名 | ⚠️ 需确认线上配置，避免重定向死循环。 |

---

## 修复实施建议顺序

1. **第一批（P0，立即）**：S-01 → S-02 → S-03 → S-04。这些涉及会话安全、越权、AI 滥用与数据写入失败，风险最高。
2. **第二批（P1，尽快）**：S-05 → S-06 → S-07 → S-08。涉及限流、XSS、隐私与代码一致性。
3. **第三批（P2，排期）**：S-09 → S-10 → S-11 → S-12 → S-13 → S-14。多为加固与体验优化。

> 每批完成后建议进行一次回归测试；P0 全部完成后建议进行一次线上渗透测试验证。

---

*本计划基于静态分析，具体实现细节以源码为准。所有代码改动须遵守 `.clinerules` 规范（原生技术栈、ES Module、参数化 SQL、复用 `_lib`、先更新 `schema.sql` 再同步线上 D1）。*
