# S09 Phase 3 埋点系统开发报告

> 版本：v1.0
> 日期：2026-08-08
> 阶段：Phase 3（埋点 SDK + 全页面接入完成）
> 前置：Phase 2 后端 API 已就绪

---

## 1. 新增文件

| 文件 | 说明 |
|---|---|
| `track.js` | 全站统一埋点 SDK（页面访问 + 业务事件 + visitor_token 管理） |

---

## 2. 修改页面列表（12 个 HTML + 1 个 JS）

| 文件 | 变更 | 说明 |
|---|---|---|
| `index.html` | +track.js | 页面访问自动上报 |
| `login.html` | +track.js | 页面访问自动上报 |
| `user.html` | +track.js | 页面访问自动上报 |
| `profile.html` | +track.js | 页面访问自动上报 |
| `match.html` | +track.js + 业务事件 | 测试开始/完成/查看结果埋点 |
| `chat.html` | +track.js | 页面访问自动上报 |
| `campus.html` | +track.js | 页面访问自动上报 |
| `qa.html` | +track.js + 业务事件 | 查看提问箱/提交问题埋点 |
| `tarot.html` | +track.js + 业务事件 | 塔罗开始/完成分析埋点 |
| `tarot-history.html` | +track.js | 页面访问自动上报 |
| `admin.html` | +track.js | 页面访问自动上报（跳转前） |
| `new_admin.html` | +track.js | 页面访问自动上报 |
| `auth.js` | 修改 | 登录成功埋点（状态变化检测） |

---

## 3. 已接入事件列表

### 3.1 自动页面访问（12 页面全部接入）

| 事件 | 触发 | 上报接口 |
|---|---|---|
| `page_view` | 页面加载自动发送（单次防重） | `/api/view` |

记录字段：
- `page_path`（完整路径，如 `/qa.html`）
- `visitor_token`（匿名身份，localStorage 优先）
- `referrer`（来源渠道）
- `device` / `os` / `browser`（后端 UA 解析）
- `user_id`（登录态，后端识别）
- `timestamp`

### 3.2 业务事件（trackEvent）

| 前端事件 | 后端 action | 接入位置 | 附带数据 |
|---|---|---|---|
| `login_success` | `login` | auth.js（未登录→已登录状态变化） | user_id |
| `quiz_start` | `quiz_start` | match.html startQuiz() | quiz_type |
| `quiz_complete` | `quiz_completed` | match.html trackCompletion() | quiz_type |
| `quiz_view_result` | `quiz_view_result` | match.html trackCompletion() | quiz_type |
| `askbox_view` | `askbox_view` | qa.html init() | target_user_id |
| `askbox_question_submit` | `askbox_question` | qa.html submitQuestion() | target_user_id |
| `tarot_start` | `tarot_start` | tarot.html startDraw() | spread_type |
| `tarot_complete` | `tarot_analyze` | tarot.html requestAnalysis() 成功时 | spread_type |

> 注：`register`（注册成功）、`create_profile`（创建资料）、`chat_start`（发起聊天）、`share` 等事件的 `trackEvent` 映射与后端白名单均已就绪，本次未对现有业务逻辑做侵入式修改，留给后续页面迭代自然触发。

---

## 4. 数据流说明

```
① 页面访问流
  浏览器打开 /tarot.html
  → track.js 加载（</head> 前，先于业务脚本）
  → 生成/读取 visitor_token（localStorage sm_visitor_token 优先）
  → navigator.sendBeacon → POST /api/view
  → functions/api/view.js（路径归一化 + 登录态识别 + UA 解析）
  → 写入 page_views（迁移后全字段 / 迁移前基础字段）

② 业务事件流
  qa.html 用户点击「发送问题」
  → submitQuestion() 顶部调用 window.trackEvent('askbox_question_submit', {target_user_id})
  → track.js 映射 action + 组装 detail（仅 ID/类型，无敏感内容）
  → navigator.sendBeacon → POST /api/event
  → functions/event.js（action 白名单校验 + UA 解析 + visitor_id 识别）
  → 写入 activity_log（迁移后全字段 / 迁移前基础字段）

③ 登录流
  auth.js refresh() 检测到首次登录
  → maybeTrackLogin() → trackEvent('login_success', {user_id})
  → /api/event 写入 activity_log
```

---

## 5. 性能检查

| 项 | 实现 | 说明 |
|---|---|---|
| 发送方式 | `navigator.sendBeacon` 优先 | 页面卸载场景也能送达，不阻塞 |
| 备用方案 | `fetch keepalive` | 异步、不阻塞渲染 |
| 页面加载影响 | track.js 仅 1 个静态文件 + 零依赖 | 无外部 CDN |
| 防重复 | `pageViewSent` 标志 | 单页面仅发送一次 |
| 防循环 | 无 SPA 路由监听、无定时轮询 | 不会产生循环调用 |
| 失败降级 | 所有 fetch/sendBeacon 异常静默捕获 | 不影响业务 |

---

## 6. 安全检查

| 项 | 实现 |
|---|---|
| 密码/Token | ❌ 完全不采集 |
| 邮箱 | ❌ `sanitizeDetail` 含 `@` 自动丢弃 |
| 私人聊天内容 | ❌ detail 限 200 字符，空格过滤 + 含 `@` 丢弃 |
| detail 限制 | 只保存业务 ID（user_id/target_user_id/askbox_id）与类型（quiz_type/spread_type） |
| visitor_token | `sm_t_<随机串>`，仅用于匿名行为关联，不含任何敏感信息 |
| localStorage | `sm_visitor_token` 仅存随机 ID |
| cookie | `sm_vt`，不使用 HttpOnly（前端需要读取），SameSite=Lax |

---

## 7. 测试结果

### 7.1 语法检查

```
node --check track.js                ✅
node --check functions/event.js      ✅（白名单已补充 quiz_start/tarot_start 等）
node --check auth.js                 ✅（登录埋点状态机）
结果: TRACK_SYNTAX_OK
```

### 7.2 页面接入验证（静态分析）

| 页面 | track.js 引入 | 业务埋点 |
|---|---|---|
| index.html | ✅ | — |
| login.html | ✅ | — |
| user.html | ✅ | — |
| profile.html | ✅ | — |
| match.html | ✅ | quiz_start + quiz_complete + quiz_view_result |
| chat.html | ✅ | — |
| campus.html | ✅ | — |
| qa.html | ✅ | askbox_view + askbox_question_submit |
| tarot.html | ✅ | tarot_start + tarot_complete |
| tarot-history.html | ✅ | — |
| admin.html | ✅ | — |
| new_admin.html | ✅ | — |

### 7.3 未能执行的测试（需联调环境）

- 浏览器端 sendBeacon 实际发送验证
- D1 迁移前后的写入兼容验证（需执行 S09 迁移或本地 miniflare）
- 端到端埋点 → 后台时间线展示（Phase 4 后台接入后统一验证）

---

## 8. 风险说明

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | sendBeacon 在部分旧浏览器不支持 | 低 | fetch keepalive 备用 |
| 2 | 埋点数据可能被恶意伪造 | 低 | 仅做统计用途，不参与业务逻辑 |
| 3 | login 埋点可能因 refresh 时序产生偏差 | 低 | 状态机设计：仅「未登录→已登录」变化时触发一次 |
| 4 | 线上 D1 未迁移，/api/event 与 /api/view 走降级路径 | 低 | 与 Phase 2 设计一致，不报错 |

---

## 9. 待确认

Phase 3 埋点系统已全部完成并通过语法检查。是否确认进入 **Phase 4：new_admin.html 后台升级**？