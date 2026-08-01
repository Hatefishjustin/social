# 心镜（SoulMirror）社交独立站 · 项目分析文档

> 本文档基于对当前代码库的静态分析整理而成，用于帮助开发者快速理解项目全貌。
> 生成时间：2026-08-01

---

## 1. 项目概览

**心镜（SoulMirror）** 是一个面向中学生和大学生的匿名校园社交平台，核心特色是**基于科学心理测评的匹配**。用户完成心理测评后，系统根据依恋理论、大五人格、五种爱之语、价值观等维度计算匹配度，并支持私信聊天、随机匹配、表白墙、匿名提问箱、塔罗牌解读等功能。

### 技术栈
| 层面 | 技术 |
|------|------|
| 平台 | Cloudflare Pages（静态站点 + Functions 边缘函数） |
| 后端运行时 | Cloudflare Pages Functions（Workers 兼容，ES Module） |
| 数据库 | Cloudflare D1（SQLite 兼容），绑定名 `DB` |
| 辅助数据库 | `QUIZ_DB`（yourlover-db，心理测评站数据，仅管理员统计用） |
| AI 服务 | 阿里云 DashScope（通义千问），默认模型 `qwen-plus` |
| 前端 | 原生 HTML + 原生 JavaScript（无框架、无构建工具） |
| 配置 | `wrangler.toml`（项目名 `soulmirror`，cron `*/5 * * * *`） |
| 自定义域名 | `soulmirror.cc.cd` |

---

## 2. 目录结构

```
social/
├── index.html            # 首页（功能入口 + 通知 + 今日之问 + 反馈）
├── login.html            # 登录页
├── match.html            # 心理测评匹配页
├── chat.html             # 私信 & 匹配对话页
├── campus.html           # 校园表白墙
├── qa.html               # 匿名提问箱
├── tarot.html            # 塔罗牌抽牌页
├── tarot-history.html    # 塔罗历史记录页
├── profile.html          # 个人主页
├── user.html             # 用户资料页
├── admin.html            # 管理后台
├── new_admin.html        # 新版管理后台
├── admin-support.html    # 客服工作台
├── auth.js               # 前端认证脚本（全局引入）
├── tarot-deck.js         # 塔罗牌牌库数据
├── schema.sql            # 数据库完整 Schema（唯一权威）
├── wrangler.toml         # Cloudflare 配置
├── README.md             # 说明（当前仅"测试"）
└── functions/            # 后端函数（路由即文件）
    ├── _middleware.js    # 默认域名 301 重定向
    ├── _lib/
    │   ├── auth.js       # 共享认证 getCurrentUser
    │   └── ai.js         # 共享 AI 调用 callDashScope
    ├── analyze.js        # /analyze 心理测评 AI 分析
    ├── admin-activity.js # /admin-activity 活动日志查询
    ├── askbox.js         # /askbox 提问箱
    ├── logout.js         # /logout 登出
    ├── session.js        # /session 会话
    ├── wall.js           # /wall 表白墙
    ├── wall-comments.js  # /wall-comments 评论
    ├── wall-like.js      # /wall-like 点赞
    ├── api/
    │   └── admin/
    │       ├── analytics.js   # /api/admin/analytics 数据概览
    │       ├── quiz-stats.js  # /admin/quiz-stats 测评站统计
    │       └── users.js       # /api/admin/users 用户列表
    ├── admin/
    │   ├── support-matches.js # /admin/support/matches 客服会话列表
    │   ├── support-poll.js    # /admin/support/poll 客服轮询
    │   └── support-send.js    # /admin/support/send 客服发消息
    ├── auth/             # 认证相关子路由
    ├── chat/             # 聊天模块
    │   ├── start.js      # 定向私信开聊
    │   ├── send.js       # 发消息（含敏感词过滤）
    │   ├── history.js    # 历史消息
    │   ├── list.js       # 会话列表
    │   ├── match.js      # 申请匹配（后门路由到客服）
    │   ├── poll.js       # 轮询新消息
    │   ├── close.js      # 关闭会话
    │   ├── mark_read.js  # 标记已读
    │   ├── report.js     # 举报
    │   └── profile.js    # 个人资料（测评后创建）
    ├── quiz/             # 测评模块
    └── tarot/
        ├── analyze.js    # /tarot/analyze 塔罗 AI 解读
        └── history.js    # /tarot/history 塔罗历史
```

---

## 3. 数据库 Schema 概览（schema.sql）

数据库包含以下核心表（均为毫秒级时间戳 `Date.now()`）：

| 表 | 用途 | 关键字段 |
|----|------|---------|
| `users` | 用户 | email(唯一), display_name, is_admin |
| `login_tokens` | 邮箱登录令牌 | token, email, expires_at, used, pending_result_json |
| `sessions` | 会话 | token, user_id, expires_at |
| `ip_trust` | IP 信任 | ip, user_id, expires_at |
| `profiles` | 个人资料 | nickname, gender(男/女/保密), age_group(中学生/大学生), scores_json, is_active |
| `avatars` | 头像 | image_data |
| `profile_visits` | 主页访问记录 | visitor_id, target_user_id |
| `quiz_results` | 测评结果 | headline, scores_json, answers_json |
| `matches` | 匹配/会话 | user_a, user_b, match_score, status(pending/accepted/rejected/closed), is_shadow |
| `messages` | 聊天消息 | match_id, sender_id, content, is_read, is_system |
| `wall_posts` | 表白墙帖子 | content, tag, is_anonymous, likes_count, comments_count, is_featured |
| `wall_comments` | 表白墙评论 | post_id, content, is_anonymous |
| `wall_likes` | 表白墙点赞 | post_id, user_id (UNIQUE) |
| `askbox_questions` | 提问箱 | asker_id, target_id, content, is_anonymous, answer_content |
| `notifications` | 通知 | user_id, type, target_type, target_id, actor_id, is_read |
| `feedback` | 意见反馈 | type, content, status(open), admin_note |
| `reports` | 举报 | reporter_id, reported_id, match_id, reason, status |
| `content_violations` | 内容违规 | user_id, report_id, action, admin_id |
| `contact_requests` | 我想认识TA | post_id, from_user_id, to_user_id, message |
| `staff_accounts` | 客服账号 | user_id, role(support/admin), max_concurrent, is_online |
| `daily_questions` | 今日之问 | date(唯一), question, option_a~d |
| `daily_answers` | 今日之问答案 | question_id, user_id, option_key (UNIQUE) |
| `activity_log` | 活动日志（只追不删） | user_id, action, target_type, ip, country, city, is_anonymous |
| `page_views` | 页面访问统计 | page, user_id, is_logged_in |
| `device_codes` | 跨设备登录码 | code, user_id, expires_at, used |
| `tarot_readings` | 塔罗抽牌记录 | spread_type(single/three), question, cards_json, headline, analysis_json, linked_quiz_id |

**注意**：`reports` 表的 `reported_id` 字段是通过迁移添加的（见 schema.sql 注释），线上需执行 `ALTER TABLE`。

---

## 4. 核心业务流程

### 4.1 认证流程
- 前端全局引入 `auth.js`，提供 `Auth.isLoggedIn()`、`Auth.showLoginModal()`、`Auth.onAuthChange()`。
- 登录采用**邮箱验证码/令牌**方式：`login_tokens` 表存令牌，`sessions` 表存会话。
- 后端通过 `functions/_lib/auth.js` 的 `getCurrentUser(request, env)` 解析 Cookie 中的 `session` 令牌，返回 `{ id, email, displayName, avatarUrl, isAdmin }`。
- 管理员接口额外校验 `isAdmin` 或 `staff_accounts` 表。

### 4.2 心理测评 → 匹配 → 聊天
1. 用户在 `match.html` 完成 41 道问卷（依恋、大五人格、爱之语、价值观）。
2. 前端调用 `/chat/profile`（POST）创建 `profiles` 记录（含 `scores_json`）。
3. 用户点击匹配 → `/chat/match`（POST）：
   - 优先匹配同 `age_group` 的活跃用户（可指定 `targetUserId`）。
   - **后门逻辑**：实际将 `user_b` 设为客服账号（`staff_accounts`），`is_shadow=1`，即"随机匹配"实际路由到客服。
   - 计算 `match_score`（依恋 35% + 大五 25% + 爱之语 20% + 价值观 20%）。
4. 聊天通过 `/chat/send`、`/chat/poll`、`/chat/history`、`/chat/list` 等实现。
5. 定向私信通过 `/chat/start` 复用或新建 `accepted` 会话。

### 4.3 敏感词过滤与安全（/chat/send）
- 分级敏感词：`high`（色情、赌博、毒品、自杀等）与 `low`（微信、QQ、电话等联系方式）。
- 命中词替换为 `**`，记录到 `content_violations`。
- 严重度：`high`×2 + `low`×1。单次 ≥3 或累计 ≥6 自动关闭会话。
- 举报 `/chat/report` 会冻结会话并写入 `reports`。

### 4.4 表白墙 / 提问箱
- 表白墙：`/wall`（发帖/列表）、`/wall-like`（点赞）、`/wall-comments`（评论），支持匿名。
- 提问箱：`/askbox`，支持匿名提问与回答。

### 4.5 塔罗牌（AI 解读）
- 前端 `tarot-deck.js` 提供牌库，`tarot.html` 抽牌（单张或过去-现在-未来三张）。
- `/tarot/analyze` 调用 DashScope，**自动结合用户最近一次心理测评结果**（`linked_quiz_id`）生成解读。
- 结果保存到 `tarot_readings`，`/tarot/history` 查看历史。

### 4.6 今日之问
- `/api/daily-question`：GET 获取当日问题与投票结果，POST 提交答案。
- 数据存 `daily_questions` / `daily_answers`。

### 4.7 管理后台
- `/api/admin/analytics`：数据概览（用户数、浏览量、内容量、匿名统计等）。
- `/api/admin/users`：用户列表（含各维度活动计数）。
- `/admin/quiz-stats`：查询**心理测评站（yourlover）**的 `QUIZ_DB` 数据。
- `/admin-activity`：活动日志分页查询。
- `/admin/support/*`：客服工作台（会话列表、轮询、发消息）。

---

## 5. 共享工具（_lib）

### `functions/_lib/auth.js`
- `getCurrentUser(request, env)`：解析 `session` Cookie，JOIN `sessions` + `users`，校验过期时间，返回用户信息或 `null`。

### `functions/_lib/ai.js`
- `callDashScope(prompt, options, env)`：封装 DashScope Chat Completions。
- 从 `env.DASHSCOPE_API_KEY` 读取密钥（禁止硬编码）。
- 支持 `model`、`temperature`、`max_tokens`、`systemPrompt`、`timeout`。
- 内置 2 次重试（仅 5xx 重试）、超时 AbortController。
- 返回 `{ ok, content }` 或 `{ ok: false, error }`。

---

## 6. 关键约定与规范（.clinerules 摘要）

1. **原生技术栈**：禁止引入框架、构建工具、npm 依赖。
2. **路由即文件**：`functions/xxx.js` → `/xxx`，使用 `onRequestGet/Post/Put/Options` 命名导出。
3. **共享逻辑复用**：认证用 `_lib/auth.js`，AI 用 `_lib/ai.js`，禁止重复实现。
4. **JSON 响应**：统一 `jsonResponse(body, status)`，`Content-Type: application/json; charset=utf-8`。
5. **输入校验**：非法输入返回 400，未登录返回 401，无权限返回 403。
6. **SQL 参数化**：所有 SQL 用 `?` 占位符 + `.bind()`，禁止字符串拼接。
7. **时间戳**：统一毫秒级 `Date.now()`。
8. **数据库**：`schema.sql` 是唯一权威，变更先更新 schema.sql，禁止破坏性操作。
9. **敏感信息**：禁止硬编码 API Key，通过 `env` 读取。
10. **ES Module**：禁止 CommonJS（`require`）、Node 专属 API（`fs`、`path`）。

---

## 7. 注意事项 / 潜在问题

- **`_middleware.js`**：仅当 hostname 为 `soulmirror.disabled.pages.dev` 时 301 重定向到 `soulmirror.cc.cd`。注意该域名带 `disabled`，实际默认域名可能不同，需确认线上配置。
- **`/chat/match` 后门**：随机匹配实际路由到客服账号（`is_shadow=1`），这是有意设计（客服兜底），但需注意客服在线状态与负载分配。
- **`/chat/send` 违规记录**：`content_violations` 表 schema 中定义了 `user_id`、`report_id`、`action`、`admin_id` 字段，但 send.js 插入时使用了 `match_id`、`sender_id`、`content`、`violation_type` 字段——**字段名不一致**，需确认线上表结构是否已对齐（schema.sql 中 `content_violations` 未包含这些字段，存在潜在不匹配风险）。
- **`/chat/close` 与 `/chat/report`**：插入系统消息时 `sender_id` 使用 `0`，而 `messages.sender_id` 外键引用 `users(id)`，`0` 可能违反外键约束（取决于 D1 是否启用外键）。
- **`/chat/match` 的 `onRequestGet`**：JOIN `profiles` 时用 `m.user_b`，但随机匹配时 `user_b` 是客服，可能返回客服资料而非真实匹配对象。
- **`README.md`** 内容仅为"测试"，建议补充项目说明。
- **`wrangler.toml`** 未声明 `[[d1_databases]]` 绑定（`DB`、`QUIZ_DB`），需在 Cloudflare Dashboard 或 wrangler 配置中确认绑定。

---

## 8. 前端页面清单

| 页面 | 功能 |
|------|------|
| `index.html` | 首页：功能卡片入口、通知面板、今日之问、意见反馈 |
| `login.html` | 登录 |
| `match.html` | 心理测评问卷 + 匹配 |
| `chat.html` | 会话列表 + 聊天窗口 |
| `campus.html` | 校园表白墙 |
| `qa.html` | 匿名提问箱 |
| `tarot.html` | 塔罗抽牌 + AI 解读 |
| `tarot-history.html` | 塔罗历史记录 |
| `profile.html` | 个人主页 |
| `user.html` | 用户资料 |
| `admin.html` / `new_admin.html` | 管理后台 |
| `admin-support.html` | 客服工作台 |

---

*本文档为静态分析产物，具体实现细节以源码为准。*
