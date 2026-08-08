# S09 Phase 2 后端 API 开发报告

> 版本：v1.0  
> 日期：2026-08-08  
> 阶段：Phase 2（后端 API 开发完成）  
> 前置：Phase 1 S09 migration 已生成（未执行线上迁移）

---

## 1. 修改文件列表

### 1.1 新增文件（8 个）

| 文件 | 类型 | 说明 |
|---|---|---|
| `functions/_lib/schema.js` | 工具库 | D1 表/字段存在性检测（迁移兼容层，模块级缓存） |
| `functions/event.js` | API | `/api/event` 统一行为上报 |
| `functions/api/admin/dashboard.js` | API | 数据总览 |
| `functions/api/admin/page-stats.js` | API | 页面访问统计 |
| `functions/api/admin/askbox-list.js` | API | 提问箱列表 |
| `functions/api/admin/askbox-questions.js` | API | 提问箱问题列表 |
| `functions/api/admin/user-activity.js` | API | 用户行为时间线 |
| `docs/S09-Phase2-后端API开发报告.md` | 文档 | 本报告 |

### 1.2 修改文件（2 个）

| 文件 | 变更内容 | 兼容性 |
|---|---|---|
| `functions/api/view.js` | 升级：支持完整路径、referrer、visitorToken、设备解析；旧版简名自动映射（match→/match.html） | ✅ 旧调用兼容 |
| `schema.sql` | 文档同步：S09 注释 + askbox_visits 表定义 | ✅ 不影响线上 |

> ⚠️ 未修改任何现有业务接口（wall/askbox/auth/quiz/tarot），保持 Phase 2 聚焦。

---

## 2. 新增 API 列表

### 2.1 `/api/event`（POST，无需登录）

统一行为上报，兼容迁移前/后。

**入参：**
```json
{
  "action": "tarot_analyze",        // 必填，白名单，非白名单降级为 other
  "page": "/tarot.html",            // 可选，页面路径
  "target_type": "tarot",           // 可选
  "target_id": "123",               // 可选
  "detail": "三张牌阵"              // 可选，存入 content
}
```

**写入 activity_log（迁移后）：**
- `user_id` / `user_email`（登录态）
- `visitor_id`（匿名身份 cookie）
- `action` / `target_type` / `target_id` / `content`
- `ip` / `country` / `city` / `is_anonymous`
- `device` / `os` / `browser`（后端 UA 解析，无需前端传）
- `referrer` / `page_path`
- `created_at`

**迁移前降级：** 仅写基础字段，不报错。

**Action 白名单：** `page_view, register, login, quiz_completed, quiz_view_result, askbox_view, askbox_view_answer, tarot_analyze, favorite_add, favorite_remove, share, wall_post, askbox_question, askbox_answer, askbox_reply, wall_like, moment_post, moment_like, profile_view, chat_start, memory_import, contact_request, daily_question_answer, other`

### 2.2 `/api/admin/dashboard`（GET，管理员）

**返回：**
```json
{
  "stats": {
    "today": { "pv": 120, "uv": 45, "newUsers": 5, "quiz": 8, "tarot": 3 },
    "total": {
      "uv": 3200, "pv": 15000, "users": 800,
      "questions": 1200, "answers": 850,
      "quiz": 600, "tarot": 400, "askboxVisits": 2500
    }
  },
  "generatedAt": 1783590000000
}
```

**UV 口径：**
- 迁移后：`COUNT(DISTINCT COALESCE(NULLIF(visitor_token,''), 'anon:'||user_id))`
- 迁移前：匿名 PV 数 + 登录去重 user_id 数（降级近似）

### 2.3 `/api/admin/page-stats`（GET，管理员）

参数：`?days=30`（默认 30，范围 1~90）

**返回：**
```json
{
  "pages": [
    { "page": "/index.html", "pv": 5000, "uv": 1200, "last_visit": 1783590000000 }
  ],
  "topReferrers": [{ "source": "直接访问", "count": 8000 }],
  "appliedDays": 30,
  "uvMode": "visitor_token" | "degraded"
}
```

### 2.4 `/api/admin/askbox-list`（GET，管理员）

参数：`?page=1`

**返回（每提问箱）：** `user_id / email / display_name / visit_count / question_count / answer_count / answer_rate / last_question_at`

- 迁移前：`visit_count` 降级为 0
- `answer_rate` = 回答数 / 问题数（保留 2 位小数）

### 2.5 `/api/admin/askbox-questions`（GET，管理员）

参数：`?page=1&target=<userId>&status=answered|unanswered`

**返回（每问题）：** `id / asker_id / asker_email / asker_name / target_id / target_email / target_name / content / is_anonymous / created_at / answered_at / is_answered / answer_visibility / answer_content`

### 2.6 `/api/admin/user-activity`（GET，管理员）

参数：`?page=1&userId=<id>&action=<action>`

**返回：** 行为时间线（合并 activity_log + 该用户最近 page_views 20 条），每条含 `action / content / page_path / referrer / device / os / browser / created_at / source`

---

## 3. 数据流说明

```
前端 track.js / 业务回调
  │ POST /api/event { action, page, target_type, target_id, detail }
  ▼
functions/event.js
  │ ① 解析请求（action 白名单校验、UA→device/os/browser、visitor_id 识别）
  │ ② 检测 activity_log 是否有 device 列（迁移状态）
  │ ③ 写入 activity_log（迁移后全字段 / 迁移前基础字段）
  ▼
后台 new_admin.html（Phase 4 接入）
  │ GET /api/admin/dashboard   → 数据总览卡片
  │ GET /api/admin/page-stats  → 页面分析表格
  │ GET /api/admin/askbox-list → 提问箱概览
  │ GET /api/admin/askbox-questions → 问题明细
  │ GET /api/admin/user-activity → 用户时间线
  ▼
functions/api/admin/*.js（统一 getCurrentUser + isAdmin 鉴权）
  ▼
D1：activity_log / page_views / askbox_visits（迁移后）
```

**页面访问流：**
```
track.js 自动上报
  │ POST /api/view { page: '/tarot.html', referrer, visitorToken }
  ▼
functions/api/view.js
  │ 归一化路径（/tarot.html）、登录态识别、UA 解析
  │ 写入 page_views（迁移后全字段 / 迁移前基础字段）
```

---

## 4. 权限检查

| API | 鉴权 | 说明 |
|---|---|---|
| `/api/event` | 无 | 轻量行为上报，限制 content≤500 字符、action 白名单，低写入成本 |
| `/api/admin/dashboard` | ✅ `getCurrentUser` + `isAdmin` | 非管理员 403 |
| `/api/admin/page-stats` | ✅ 同上 | 同上 |
| `/api/admin/askbox-list` | ✅ 同上 | 同上 |
| `/api/admin/askbox-questions` | ✅ 同上 | 同上 |
| `/api/admin/user-activity` | ✅ 同上 | 同上 |

- 复用 `_lib/auth.js` 的统一 `getCurrentUser`，未新建鉴权系统
- 所有 admin API 返回 403 而非暴露数据

---

## 5. 测试结果

### 5.1 语法检查（已通过）

```bash
node --check functions/_lib/schema.js        ✅
node --check functions/event.js              ✅
node --check functions/api/admin/dashboard.js ✅
node --check functions/api/admin/page-stats.js ✅
node --check functions/api/admin/askbox-list.js ✅
node --check functions/api/admin/askbox-questions.js ✅
node --check functions/api/admin/user-activity.js ✅
node --check functions/api/view.js           ✅
结果: ALL_SYNTAX_OK
```

### 5.2 迁移兼容逻辑验证（静态分析）

| API | 迁移前（无 S09 字段） | 迁移后（S09 已执行） |
|---|---|---|
| `/api/event` | 写基础字段，`hasColumn=false` 分支 | 写全字段 18 列 |
| `/api/view` | 写基础 4 字段，不触碰新列 | 写全字段 9 列 |
| `/api/admin/dashboard` | UV 降级近似；askboxVisits=0 | visitor_token UV + askbox_visits 计数 |
| `/api/admin/page-stats` | UV 降级=PV 近似；topReferrers 空 | 真实 UV + 来源渠道分类 |
| `/api/admin/askbox-list` | visit_count=0，问题/回答率不受影响 | 真实访问量 |
| `/api/admin/askbox-questions` | 完整可用（仅依赖现有字段） | 完整可用 |
| `/api/admin/user-activity` | 基础字段时间线 | 全维度字段时间线 |

> 所有新增 API 均通过 `_lib/schema.js` 的 `hasTable` / `hasColumn` 动态检测，迁移前不报错、不破坏现有接口。

### 5.3 未能执行的测试（需联调环境）

- 真实 D1 数据库联调（需 wrangler d1 execute 或本地 miniflare）
- 端到端埋点 → API → 后台渲染链路（Phase 4 完成前）
- 并发/性能压测（Phase 4 后台接入后统一验证）

---

## 6. 风险说明

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | `/api/event` 无鉴权，可能被恶意刷 | 中 | action 白名单 + content 限长 500；行为表为「只追不删」设计，写入成本低；如确认被刷可后续加 IP 频率限制 |
| 2 | 迁移前 UV 为降级近似值（非真实去重） | 低 | UI 标识 `uvMode`，迁移后自动切换真实口径 |
| 3 | `hasColumn` 每次隔离首先检查一次（模块缓存） | 低 | 单 workers isolate 内仅首次 pragma 查询，性能可忽略 |
| 4 | askbox-list 的 SQL 使用子查询 `visit_count`，数据量大时性能需关注 | 中 | 后续可加物化/定时统计；当前量级（用户×问题）可接受 |
| 5 | `/api/admin/user-activity` 全局模式不合并 page_views（仅 userId 模式合并） | 低 | 设计如此：全局模式避免全量 page_views 膨胀；用户维度已覆盖 |
| 6 | 线上 D1 尚未执行 S09 迁移，新 API 全部走降级路径 | 低 | Phase 3 埋点完成 + 本地验证后统一执行迁移 |
| 7 | `event.js` 与 `api/view.js` 两套写入 activity_log/page_views 逻辑并存 | 低 | 职责分化：event=功能行为，view=页面访问，避免 page_view 洪水 |

---

## 7. 待确认

Phase 2 后端 API 已全部完成并通过语法检查。是否确认进入 **Phase 3：埋点 SDK track.js + 全页面接入**？