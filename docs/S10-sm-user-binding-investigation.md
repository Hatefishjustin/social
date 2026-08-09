# S10: S/M 互动倾向测试 - 用户身份绑定问题排查报告

> **排查日期**: 2026-08-09
> **问题描述**: 登录用户完成 S/M 测试后，后台仍显示"游客"，`sm_test_results.user_id` 未正确保存。
> **排查方式**: 只读代码摸底，不修改任何文件。

---

## 1. 登录机制分析

### 1.1 架构总览

```
┌──────────────────────────────────────────────────┐
│                   前端 (Browser)                   │
│  auth.js → 全局模块 → window.Auth.getUserId()     │
│  track.js → window.Track (埋点+访客标识)           │
│  Cookie: session (HttpOnly, Secure, SameSite=Lax) │
│  Cookie: sm_vt (访客标识, 非HttpOnly)              │
│  localStorage: sm_visitor_token (访客标识)         │
└────────────────────┬─────────────────────────────┘
                     │ fetch /session (credentials: same-origin)
                     │ POST /api/sm-save
                     ▼
┌──────────────────────────────────────────────────┐
│               Cloudflare Pages Functions           │
│  _lib/auth.js → getCurrentUser(request, env)      │
│    ↓ 解析 Cookie header 中的 session token         │
│    ↓ SELECT sessions JOIN users                   │
│    ↓ 返回 { id, email, displayName, ... }          │
│  session.js → GET /session (前端获取用户信息)       │
└────────────────────┬─────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────┐
│                    D1 Database                     │
│  sessions(token, user_id, expires_at)              │
│  users(id, email, display_name, ...)               │
│  sm_test_results(..., user_id)                    │
└──────────────────────────────────────────────────┘
```

### 1.2 Cookie 详情

| 项目 | 详情 |
|------|------|
| **Cookie 名称** | `session` |
| **Cookie 属性** | `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30天) |
| **设置时机** | `/auth/verify` (邮箱魔法链接验证) 或 `/auth/code-login` (登录码) |
| **Cookie 内存储** | 64 字符随机 hex token（对应 `sessions.token`） |
| **localStorage** | **不用于认证**。仅 `sm_visitor_token` 用于匿名访客追踪 |

### 1.3 后端鉴权方式

**核心函数**: `functions/_lib/auth.js` 中的 `getCurrentUser(request, env)`

```js
// 1. 从 Cookie header 中解析 session token
const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');

// 2. 查 sessions JOIN users
SELECT sessions.expires_at, users.id, users.email, users.display_name, ...
FROM sessions JOIN users ON sessions.user_id = users.id
WHERE sessions.token = ?

// 3. 检查是否过期 (Date.now() > expires_at)
// 4. 返回 { id, email, displayName, avatarUrl, isAdmin }
```

该函数被多个 API 端点复用：
- `functions/session.js` — `GET /session`（前端获取用户信息）
- `functions/api/sm-save.js` — `POST /api/sm-save`
- `functions/api/sm-analyze.js` — `POST /api/sm-analyze`
- `functions/api/admin/sm-stats.js` — `GET /api/admin/sm-stats`

### 1.4 前端身份获取方式

**文件**: `auth.js` (根目录)

```js
// 初始化时调用 GET /session，返回:
{ loggedIn: true, userId, email, displayName, avatarUrl, isAdmin }

// 全局暴露
window.Auth = {
  isLoggedIn(),  // user !== null
  getUserId(),   // user.userId
  getEmail(),    // user.email
  onAuthChange(fn),
  ...
};
```

`auth.js` 内部维护 `var user = null`，通过 `refresh()` 调用 `/session` 填充。所有页面通过 `<script src="/auth.js">` 引入。

### 1.5 参照标准：已正确识别用户的 Quiz 保存

**文件**: `functions/quiz/save.js` — `POST /quiz/save`

| 对比项 | quiz/save.js (正确) | sm-save.js (待修复) |
|--------|---------------------|---------------------|
| `getCurrentUser` 实现 | 文件内**内联**实现（独立副本） | 从 `_lib/auth.js` **导入** |
| 返回 null 时的处理 | **返回 401 拒绝** | 降级为匿名（user_id=null），继续保存 |
| 写入字段 | 强制写入 `user_id` | 仅 `hasUserId` 为 true 时写入 |
| SQL 结构 | 固定包含 `user_id` | 动态切换（有无 `user_id` 列） |

**关键差异**：quiz 要求登录（401），S/M 测试允许匿名。但 S/M 测试在用户已登录时未能正确保存 `user_id`。

---

## 2. S/M 保存链路逐节点分析

### 2.1 节点一：前端提交 (`sm-test.html` saveResult())

```js
async function saveResult(){
  // Step 1: 获取访客标识
  let visitorToken = '';
  if (window.SMTrack && window.SMTrack.getVisitorToken) {  // ⚠️ 见下方分析
    visitorToken = window.SMTrack.getVisitorToken();
  }

  // Step 2: 获取用户ID（双保险：后端也会从 cookie 解析）
  let userId = null;
  if (window.Auth && window.Auth.isLoggedIn && window.Auth.isLoggedIn()) {
    userId = window.Auth.getUserId();
  }

  // Step 3: 发送 POST
  await fetch('/api/sm-save', {
    method: 'POST',
    credentials: 'same-origin',      // ✅ 携带 session cookie
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sScore, mScore, switchScore, trustScore, consentScore,
      resultType,
      visitorToken,
      userId,                        // ⚠️ 后端并未使用此字段
    })
  });
}
```

**发现**:
- ✅ `credentials: 'same-origin'` — Cookie 会被携带
- ✅ `userId` 通过 `window.Auth.getUserId()` 获取 — 依赖 `auth.js` 初始化完成
- ⚠️ `window.SMTrack` — **可能未定义**（详情见下）
- ⚠️ 前端传入的 `userId` — 后端 `sm-save.js` **并未读取 `body.userId`**，而是独立从 session cookie 解析

### 2.2 SMTrack 访客标识问题

`sm-test.html` 引用 `<script src="/track.js"></script>`，并期待 `window.SMTrack` 对象。

**`track.js` 实际暴露**：

```js
// track.js 末尾（推测，基于代码风格）
window.Track = { trackEvent, ... };
```

**`track.js` 中的访客标识**：
- `localStorage` key: `sm_visitor_token`
- Cookie key: `sm_vt`
- 变量名: `visitorToken`

如果 `window.SMTrack` 确实不存在于 `track.js` 中，则 `visitorToken` 始终为空字符串。这是次要问题，不影响用户绑定。

> **判定**: 需确认 `track.js` 是否暴露了 `window.SMTrack`。若未暴露，`visitorToken` 始终为空。

### 2.3 节点二：后端保存 (`functions/api/sm-save.js`)

```js
import { getCurrentUser } from '../_lib/auth.js';

export const onRequestPost = async ({ request, env }) => {
  // 1. 解析请求体（使用前端传入的评分数据）
  // 2. 计算 visitorToken = body.visitorToken
  // 3. 调用 getCurrentUser() 从 session cookie 解析用户
  const user = await getCurrentUser(request, env);
  if (user && user.id) { userId = user.id; }

  // 4. 检查 user_id 列是否存在
  const hasUserId = await hasColumn(env, 'sm_test_results', 'user_id');

  // 5. 分支写入
  if (hasUserId) {
    INSERT INTO sm_test_results (visitor_token, user_id, ...) VALUES (?, ?, ?, ...)
  } else {
    // ⚠️ 降级路径：不包含 user_id
    INSERT INTO sm_test_results (visitor_token, ...) VALUES (?, ...)
  }
};
```

**关键发现**：

| 步骤 | 状态 | 说明 |
|------|------|------|
| `getCurrentUser()` 调用 | ✅ 正确 | 从 `_lib/auth.js` 导入，逻辑与 `quiz/save.js` 一致 |
| session cookie 解析 | ✅ 正确 | 从 `Cookie` header 解析 `session` token |
| 用户查询 | ✅ 正确 | `SELECT sessions JOIN users WHERE token = ?` |
| Debug 日志 | ✅ 已添加 | 输出 Cookie 是否存在、getCurrentUser 返回值 |
| **user_id 写入条件** | ⚠️ **关键** | 依赖 `hasColumn(env, 'sm_test_results', 'user_id')` 返回值 |

### 2.4 节点三：数据库 Schema

**迁移文件**: `docs/migrations/2026-08-09-S10-sm-user-binding.sql`

```sql
ALTER TABLE sm_test_results ADD COLUMN user_id INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_sm_test_results_user ON sm_test_results(user_id, created_at DESC);
```

**`schema.sql` 中的定义**（已更新）:
```sql
CREATE TABLE IF NOT EXISTS sm_test_results (
    ...
    user_id INTEGER DEFAULT NULL,    -- ← 已包含
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
```

**但注意**：`sm_test_results` 表最初是由迁移 `2026-08-09-S10-sm-test.sql` 创建的，**该初始迁移不包含 `user_id` 字段**。`user_id` 字段是第二个迁移 `S10-sm-user-binding.sql` 通过 `ALTER TABLE ADD COLUMN` 添加的。

---

## 3. 后台显示链路分析

### 3.1 后端统计接口 (`functions/api/admin/sm-stats.js`)

```
GET /api/admin/sm-stats
  ↓
getCurrentUser() → 验证管理员身份（user.isAdmin）
  ↓
hasColumn(env, 'sm_test_results', 'user_id') → 判断是否启用用户绑定
  ↓
[有 user_id] → LEFT JOIN users ON r.user_id = u.id → 返回 userDisplayName, userEmail
[无 user_id] → 只查 sm_test_results 基础字段 → 不返回用户信息
```

**最近记录 SQL（有 user_id 时）**:
```sql
SELECT r.*, u.display_name AS user_display_name, u.email AS user_email
FROM sm_test_results r
LEFT JOIN users u ON r.user_id = u.id
ORDER BY r.created_at DESC LIMIT 20
```

- ✅ 使用了 `LEFT JOIN`（正确，游客的 user_id 为 NULL 也能返回）
- ✅ 返回了 `userDisplayName` 和 `userEmail`
- ✅ 同时返回 `userBinding` 标志位（标记是否已启用绑定）

### 3.2 前端后台 UI (`new_admin.html`)

根据已有报告 `S10-sm-user-binding-and-admin-ui-report.md`，前端已更新：
- 最近记录表格新增"访客"列
- 登录用户显示昵称/邮箱
- 未登录用户显示"游客"

---

## 4. 根因定位

### 4.1 最可能根因：`user_id` 列迁移未执行（概率最高）

**证据链**：

1. `sm-save.js` 中的分支逻辑：
   ```js
   const hasUserId = await hasColumn(env, 'sm_test_results', 'user_id');
   if (hasUserId) {
     // INSERT with user_id
   } else {
     // INSERT without user_id ← 降级路径
   }
   ```

2. `sm_test_results` 表最初创建时（`2026-08-09-S10-sm-test.sql`）**不包含 `user_id` 字段**。

3. `user_id` 字段由独立迁移（`2026-08-09-S10-sm-user-binding.sql`）通过 `ALTER TABLE ADD COLUMN` 添加。

4. 如果该迁移**未在线上 D1 执行**，则 `hasColumn()` 返回 `false`，所有登录用户的 `user_id` 都不会写入数据库。

5. `getCurrentUser()` 本身工作正常（由 debug 日志和 quiz/save.js 验证），能正确解析用户身份 — 但解析出的 `userId` 因为没有 `user_id` 列而无法写入。

**验证方法**：
- 检查线上 wrangler 日志中 `[sm-save.js][DEBUG]` 的输出
- 直接对 D1 执行 `SELECT * FROM pragma_table_info('sm_test_results')` 确认是否有 `user_id` 列
- 如果 debug 日志显示 "Cookie存在" 且 "getCurrentUser返回: {...}" 但 "最终userId: null" — 则不是此根因
- 如果 debug 日志显示 "最终userId: 123" (非 null)，则确认是 **迁移未执行导致降级路径不写入 user_id**

### 4.2 次要可能根因：Cookie 传递问题

如果 debug 日志显示 "Cookie存在: 不存在"：
- 可能是 Cloudflare Pages 配置导致 Cookie 被剥离
- 可能是 `Secure` Cookie 在非 HTTPS 环境不发送
- 可能是 `_middleware.js` 有额外的 Cookie 处理逻辑

**但概率较低**，因为同一个 Cookie (`session`) 在 `/session` 端点和 `quiz/save.js` 中都能正常工作。

### 4.3 前端 userId 冗余但未被后端使用

前端 `sm-test.html` 已经通过 `window.Auth.getUserId()` 获取了 `userId` 并放在请求体中。但后端 `sm-save.js` 完全忽略 `body.userId`，独立从 cookie 解析。这不是 bug，但意味着即使前端传了正确的 userId，后端也不会使用它作为备用。

---

## 5. 修复建议

### 5.1 确认性排查（先执行）

```bash
# 1. 检查 D1 线上是否有 user_id 列
wrangler d1 execute <DB_NAME> --remote --command "SELECT name FROM pragma_table_info('sm_test_results') WHERE name='user_id';"

# 2. 如果返回空 → 确认迁移未执行
# 3. 如果返回一行 → 迁移已执行，需要检查 debug 日志
```

### 5.2 方案A：迁移未执行（最高优先级）

```bash
# 执行迁移
wrangler d1 execute <DB_NAME> --remote --file docs/migrations/2026-08-09-S10-sm-user-binding.sql

# 验证
wrangler d1 execute <DB_NAME> --remote --command "SELECT name FROM pragma_table_info('sm_test_results');"
```

执行后无需改代码 — `sm-save.js` 中的 `hasColumn()` 会返回 `true`，自动走正确的 INSERT 路径。

### 5.3 方案B：增加后端兜底（代码增强）

**文件**: `functions/api/sm-save.js`

即使迁移已执行，也建议增加以下兜底：

```js
// 在 getCurrentUser() 解析后，增加前端 userId 作为备用
const frontendUserId = body.userId ? parseInt(body.userId, 10) : null;

let userId = null;
const user = await getCurrentUser(request, env);
if (user && user.id) {
  userId = user.id;
} else if (frontendUserId && Number.isInteger(frontendUserId)) {
  // 降级：使用前端传入的 userId（仅当 cookie 解析失败时）
  userId = frontendUserId;
}
```

**注意**：仅当 cookie 解析失败时使用前端 userId 作为备用，不能作为主方案（前端传入的 userId 可从浏览器伪造）。

### 5.4 方案C：修复 SMTrack 引用（次要）

**文件**: `sm-test.html` — `saveResult()`

检查 `track.js` 暴露的全局对象名称：
- 如果是 `window.Track`：修改为 `window.Track.getVisitorToken`
- 如果是 `window.SMTrack`：无需修改（但需确认 track.js 确实暴露了此对象）

建议统一为从 `track.js` 导出的 `getToken()` 函数，而非依赖特定的全局对象名。

### 5.5 方案D：清理 debug 日志（后续）

`sm-save.js` 中的 `[TEMP-DEBUG]` 日志在问题确认后应移除，避免线上日志噪音。或者改为仅在 `userId` 为 null 时输出 warn 日志。

---

## 6. 修复优先级

| 优先级 | 操作 | 预计解决 |
|--------|------|----------|
| **P0** | 执行 `S10-sm-user-binding.sql` 迁移 | 95% 可能解决 |
| P1 | 验证线上 debug 日志确认根因 | 辅助 P0 |
| P2 | 增加前端 userId 兜底（方案B） | 防护性增强 |
| P3 | 修复 SMTrack 引用（方案C） | visitor_token 写入 |
| P4 | 清理 debug 日志（方案D） | 代码整洁 |

---

## 附录：关键文件索引

| 文件 | 用途 |
|------|------|
| `auth.js` | 前端登录模块，暴露 `window.Auth` |
| `track.js` | 前端埋点SDK，暴露 `window.Track`，管理 visitor_token |
| `functions/_lib/auth.js` | 后端 `getCurrentUser()` 共享函数 |
| `functions/session.js` | `GET /session` — 前端获取登录用户信息 |
| `functions/auth/code-login.js` | `POST /auth/code-login` — 登录码登录 |
| `functions/auth/verify.js` | `GET/POST /auth/verify` — 邮箱魔法链接验证 |
| `sm-test.html` | S/M 测试前端页面 |
| `functions/api/sm-save.js` | `POST /api/sm-save` — 保存测试结果 |
| `functions/api/admin/sm-stats.js` | `GET /api/admin/sm-stats` — 后台统计 |
| `docs/migrations/2026-08-09-S10-sm-test.sql` | 初始创建 sm_test_results 表（**无 user_id**） |
| `docs/migrations/2026-08-09-S10-sm-user-binding.sql` | 新增 user_id 列 + 索引（**需执行**） |
| `schema.sql` | 完整 schema（已包含 user_id） |
| `functions/quiz/save.js` | 参照标准：正确保存 user_id 的 Quiz 保存 |
| `functions/_lib/schema.js` | `hasTable()` / `hasColumn()` 检测工具 |
| `docs/S10-sm-user-binding-and-admin-ui-report.md` | 此前用户绑定改造报告 |
