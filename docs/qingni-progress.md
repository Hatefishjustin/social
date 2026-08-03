# SoulMirror 轻匿导入开发进度

> 项目：SoulMirror（心镜）社交独立站
> 日期：2026-08-03
> 阶段：全部完成 ✅（Phase 0~Phase 4 已全部完成并上线）
> 说明：本文档为历史记录，轻匿导入功能已开发完成并部署上线。

---

## 1. 项目目标

- SoulMirror 需要支持用户输入轻匿（qntwx.com）公开分享链接，自动获取公开问答。
- 将获取到的公开问答导入 `content_imports` + `imported_questions` 两张表。
- 不影响现有 askbox（提问箱）系统。
- 不修改用户系统。
- 不破坏已有数据库。
- 主流程为「输入链接自动导入」，不采用手动复制方案。

---

## 2. 已确认技术事实

### 2.1 轻匿技术栈

- uni-app
- uniCloud
- H5 SPA（单页应用）
- 数据不是 HTML 内嵌，而是运行时通过 uniCloud SDK 请求获取

### 2.2 数据集合

- `ask_box_info`：提问箱信息
  - 字段：`_id`、`user_id`、`default_url_code`、`custom_url_code`、`ban_channel`、`bg_img`、`question_show`、`ban_questioner_id`、`box_description`、`question_num`、`reply_question_num`、`channel_list`
- `ask_box_question`：问答列表
  - 字段：`_id`、`question`、`chat_list`、`create_time`、`update_time`、`is_public_reply`、`status`
  - `chat_list` 为对话数组，每条消息：`content`、`is_self`、`create_time`、`file_id`、`file_where`、`user_id`（回复者）、`location`

### 2.3 url_code 查询逻辑

```
url_code → ask_box_info → user_id → ask_box_question
```

即：先用 url_code 查 `ask_box_info` 拿到 `user_id`，再用 `user_id` 查 `ask_box_question`。

### 2.4 API 端点

```
POST https://api.next.bspapp.com/client
```

### 2.5 spaceId

```
mp-5dcb9f9e-a8e8-4d51-a064-e30f76421e0a
```

### 2.6 clientDB 调用方式

- 通过 `DCloud-clientDB` 云函数调用（`serverless.function.runtime.invoke`，functionTarget = `DCloud-clientDB`）。
- 认证流程：
  1. `anonymousAuthorize` 获取 accessToken
  2. 请求头携带 `x-basement-token` 与 `x-serverless-sign`

---

## 3. 已完成研究（Phase 0 全部通过 ✅）

### 3.1 签名算法（已验证 ✅）

- clientSecret 已从前端 bundle 定位：
  ```
  bXt46OTsd+sQiENPhLf7Vg==
  ```
- `x-serverless-sign` 算法：**HMAC-MD5**
  - body 顶层字段按 key 排序
  - 过滤空值后按 `key=value` 用 `&` 拼接成 queryString
  - 用 clientSecret 作为密钥做 HMAC-MD5，输出 hex
- 已通过真实请求验证（HTTP 200，返回 accessToken）。

### 3.2 anonymousAuthorize（已验证 ✅）

- body：`{ method: 'serverless.auth.user.anonymousAuthorize', params: '{}', spaceId, timestamp }`
- 返回 `data.accessToken`（有效期 600 秒）。

### 3.3 clientDB 查询（已验证 ✅）

**关键突破：解决了 `xxx.where() is not supported` 问题。**

正确构造 command 的方式（从 `_qingni_vendors.js` 逆向 SDK 源码得出）：

1. **`action` 字段必须为 `undefined`**（普通查询无 `.action()` 时，`getAction()` 返回 undefined）。之前错误地用了 `action: 'get'`。
2. **操作类型（`get`）作为 `$db` 数组的最后一个元素**，而不是放在 `action` 字段。
3. **`where` 参数为字符串 JQL 表达式**（unicloud-db 组件传字符串）。

**`ask_box_info` 查询 command：**
```js
const command = {
  $db: [
    { $method: 'collection', $param: ['ask_box_info'] },
    { $method: 'where', $param: ["default_url_code=='TNMY2E'||custom_url_code=='TNMY2E'"] },
    { $method: 'get', $param: [] },
  ],
};
const data = { action: undefined, command, multiCommand: false };
```

**`ask_box_question` 查询 command（带分页/排序/计数）：**
```js
const command = {
  $db: [
    { $method: 'collection', $param: ['ask_box_question'] },
    { $method: 'where', $param: ["user_id=='xxx'&&is_public_reply==true&&status==1&&create_time>xxx"] },
    { $method: 'field', $param: ['question,create_time,chat_list,update_time'] },
    { $method: 'orderBy', $param: ['update_time desc'] },
    { $method: 'skip', $param: [0] },
    { $method: 'limit', $param: [5] },
    { $method: 'get', $param: [{ getCount: true }] },
  ],
};
```

**响应结构：**
```json
{
  "success": true,
  "data": {
    "code": 0,
    "errCode": 0,
    "data": [ ...查询结果... ],
    "count": 24
  }
}
```
- 查询结果在 `res.data.data`（数组）
- 总数在 `res.data.count`（当 `getCount: true` 时）

### 3.4 真实数据样例（已验证 ✅）

**`ask_box_info`（url_code=TNMY2E）：**
```json
{
  "_id": "68558e72337a9f51211db5a5",
  "user_id": "68558e71eef9cbdc97de1bba",
  "default_url_code": "TNMY2E",
  "custom_url_code": "",
  "box_description": "",
  "question_num": 24,
  "reply_question_num": 24,
  "channel_list": [{"name":"微博","channel":"weibo"}, ...]
}
```

**`ask_box_question`（user_id=68558e71eef9cbdc97de1bba，count=24）：**
```json
{
  "_id": "6996ff884b924763154febff",
  "question": "hi是我",
  "chat_list": [
    { "content": "hi是我", "is_self": false, "create_time": 1771503495330, "file_id": "", "file_where": "_id=='none'" },
    { "content": "我才看到", "create_time": 1785724224251, "user_id": "68558e71eef9cbdc97de1bba", "file_id": "", "location": {} }
  ],
  "create_time": 1771503495330,
  "update_time": 1785724224251
}
```

**`chat_list` 语义：**
- `is_self: false` → 提问者（匿名）的消息
- `is_self: true` 或带 `user_id` → 箱主（回复者）的消息
- 第一条消息通常是问题本身（`question` 字段与第一条 `chat_list[0].content` 一致）

### 验证脚本

- `_qingni_verify.js`（根目录，临时文件，验证后删除）
  - 实现了 `sign()`（HMAC-MD5）、`anonymousAuthorize()`、`callFunction()`、`queryAskBoxInfo()`、`queryAskBoxQuestions()`
  - 运行方式：`node _qingni_verify.js [url_code]`
  - 已验证：签名 ✅、认证 ✅、ask_box_info 查询 ✅、ask_box_question 查询 ✅

---

## 4. 当前状态（全部完成 ✅）

所有 Phase 0~Phase 4 已全部完成并上线。

---

## 5. 已有 SoulMirror 代码状态

### 已有

- `functions/memory/import.js`：通用导入框架
  - 路由：`/memory/import`
  - `preview`：当前返回 mock 数据（`buildMockPreview`）
  - `confirm`：已可写入 D1（`content_imports` + `imported_questions`）
  - 认证：复用 `functions/_lib/auth.js` 的 `getCurrentUser`
- `memory.html`：导入页面
- `content_imports` 表（schema.sql 第 409-421 行）
- `imported_questions` 表（schema.sql 第 423-432 行）
- 迁移文件：`docs/migrations/2026-08-03-S03-content-import.sql`

### 当前状态

- `preview` 仍为 mock，未接入真实轻匿 API。
- `confirm` 已可以写入 D1。
- 未接入真实轻匿 API。

### 表结构（关键字段）

`content_imports`：
- `id`、`user_id`、`platform`、`source_url`、`source_id`、`title`、`avatar`、`total_count`、`status`、`created_at`

`imported_questions`：
- `id`、`import_id`、`source_question_id`、`question`、`answer`、`source_created_at`、`created_at`
- 唯一索引：`(import_id, source_question_id)` 用于去重

---

## 6. 下一步开发计划

按顺序执行：

### Phase 1：实现 `qingni-client.js`（当前阶段）

位置：`functions/_lib/qingni-client.js`

实现：
- UUID token 生成
- `anonymousAuthorize`
- `sign` 计算（HMAC-MD5）
- uniCloud 请求封装（`callFunction`）
- clientDB 查询封装（`queryAskBoxInfo`、`queryAskBoxQuestions`）

凭据（spaceId / clientSecret）改为环境变量/Secret（如 `env.QINGNI_SPACE_ID` / `env.QINGNI_CLIENT_SECRET`），禁止硬编码密钥进业务代码。

### Phase 2：真实查询

```
url_code → ask_box_info → ask_box_question
```

只读取：
- `is_public_reply = true`
- `status = 1`

### Phase 3：接入 `memory/import.js`

- 替换 mock preview 为真实抓取。
- 将 `ask_box_question` 的 `question` + `chat_list` 转换为 `imported_questions` 的 `question` + `answer`。

### Phase 4：上线测试

- 确认导入写入 `content_imports` + `imported_questions`。

---

## 7. 给下一次 AI 的启动说明

> 下一次开发前请先阅读本文件，不要重新分析轻匿协议。Phase 0 已通过，从 Phase 1（实现 qingni-client.js）继续。

### 关键提醒

- 凭据（spaceId / clientSecret）当前硬编码在 `_qingni_verify.js`，正式实现 `qingni-client.js` 时应改为环境变量/Secret（如 `env.QINGNI_SPACE_ID` / `env.QINGNI_CLIENT_SECRET`），禁止硬编码密钥进业务代码。
- 遵循 `.clinerules`：ES Module 语法、无 Node 专属 API、参数化 SQL、复用 `_lib`、CORS + `onRequestOptions`、输入校验、毫秒时间戳。
- 不修改现有 askbox 功能、不修改用户系统、不破坏已有数据库。
- 不创建重复表（复用 `content_imports` + `imported_questions`）。
- 不 mock 数据，优先真实链路验证。
- `_qingni_verify.js` 及所有 `_tmp_*.js` 为临时文件，验证完成后删除。

---

## 8. Phase 4-2 完成记录（2026-08-03）

> 阶段：完善用户侧导入体验 + 接入 memory.html 前端流程 + preview→confirm 完整闭环 + 错误提示与状态反馈。

### 8.1 本次改动文件

| 文件 | 改动 |
| --- | --- |
| `memory.html` | 完善前端导入流程：输入校验（`extractUrlCode` 支持完整链接/纯分享码）、错误提示差异化（`friendlyError` 错误码映射）、加载态（`setLoading` + spinner）、preview 元信息（来源/标题/条数）、成功反馈（导入成功卡片 + 查看我的记忆/继续导入） |
| `functions/memory/list.js` | **新增**：读取当前登录用户已导入记忆的 API（`GET /memory/list`），按时间倒序返回导入批次 + 问答明细，仅返回本人数据（隐私隔离） |
| `user.html` | 新增「我的记忆」模块（仅本人可见）：调用 `/memory/list`，展示导入批次（头像/标题/平台/条数/导入时间/前3条问答摘要/来源链接），空态与错误态处理 |

### 8.2 前端流程闭环

```
memory.html 输入链接 → POST /memory/import (preview) → 展示预览
→ 点击确认 → POST /memory/import (confirm) → 写库 content_imports + imported_questions
→ 成功卡片 → 「查看我的记忆」跳转 /user.html?userId=<uid>
→ user.html「我的记忆」模块 GET /memory/list 展示已导入记忆
```

- 同来源防重复导入：confirm 阶段拦截（`already_imported`），前端 `friendlyError` 映射为友好提示。
- 未登录：preview 前校验 `Auth.isLoggedIn()`，未登录提示并弹出登录框。

### 8.3 测试结果

**后端回归（`_qingni_confirm_test.js`）**：preview 24 条 → confirm 写库 → 防重复拦截，全部通过。

**新增 `_qingni_list_test.js`（`node _qingni_list_test.js`）**：15/15 通过
- 场景1：已导入用户返回 200 + 导入批次 + 问答明细 ✅
- 场景2：未导入用户返回空数组 ✅
- 场景3：未登录返回 401 ✅
- 场景4：隐私隔离（他人看不到本人数据）✅

**前端走查**：memory.html 与 user.html 的字段与后端 API 返回结构完全匹配；`Auth.getUserId()` 与 `Auth.getUser().userId` 一致，跳转闭环正确。

### 8.4 部署状态（已上线 ✅）

- 本地代码：已完成 ✅
- Git：已提交 ✅
- GitHub：已 push ✅
- Cloudflare：已触发部署 ✅
- 数据库：迁移 S03 已执行到线上 D1 ✅
- 临时文件：已全部删除 ✅
