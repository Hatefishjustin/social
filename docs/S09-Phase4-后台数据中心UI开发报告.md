# S09 Phase 4 后台数据中心 UI 开发报告

> 版本：v1.0
> 日期：2026-08-08
> 阶段：Phase 4（new_admin.html 后台数据中心升级完成）
> 前置：Phase 2 API + Phase 3 埋点已就绪

---

## 1. 修改文件列表

| 文件 | 操作 | 变更 |
|---|---|---|
| `new_admin.html` | 修改（增量） | 9 菜单导航 + 4 新面板 + 渲染函数 + 默认启动 Dashboard |

> 未重写后台架构，保留全部现有模块（用户活动/心理测评/塔罗/用户管理/举报）逻辑与样式。

---

## 2. 新增页面模块

### 2.1 菜单升级（5 → 9）

```
1. 数据总览 Dashboard  ← 新增（默认启动）
2. 用户活动            ← 保留
3. 提问箱管理          ← 新增
4. 页面分析            ← 新增
5. 用户管理            ← 保留
6. 心理测评数据        ← 保留
7. 塔罗数据            ← 保留
8. 内容审核（原举报）  ← 保留（更名）
9. 系统设置            ← 新增（预留）
```

### 2.2 数据总览 Dashboard

- **API**：`GET /api/admin/dashboard`
- **卡片**：今日 PV / 今日 UV / 累计用户 / 今日注册 / 累计提问 / 累计回答 / 测试完成 / 塔罗分析
- **热门口页 Top 10**：页面 / PV / UV / 最近访问
- **空状态**：无数据时显示 `暂无访问数据，请先浏览网站后再查看`，不显示 0 或 NaN
- **刷新按钮**：支持手动刷新

### 2.3 提问箱管理

- **API**：`GET /api/admin/askbox-list`（列表）+ `GET /api/admin/askbox-questions?target=<id>`（详情）
- **列表列**：用户 / 提问箱ID / 访问量 / 收到问题 / 回答数量 / 回答率
- **详情弹窗**：点击「查看问题」打开，展示 时间 / 提问者 / 内容 / 状态（已回答/已回答(私密)/未回答）
- **空状态**：`暂无提问箱数据` / `暂无问题`
- **分页**：支持翻页

### 2.4 页面分析

- **API**：`GET /api/admin/page-stats?days=<N>`
- **时间筛选**：近30天 / 近7天 / 今日
- **热门页面 Top 10**：页面 / PV / UV / 最近访问
- **来源渠道**：横向条形图（直接访问/微信/QQ/微博/其他）
- **空状态**：`暂无访问数据` / `暂无来源数据`

### 2.5 系统设置（预留）

- 静态占位页：显示当前版本 + 预留能力清单（管理员账号管理 / content_violations / 用户画像 labels / 数据导出）

---

## 3. API 调用关系

| 前端模块 | 后端 API | 鉴权 |
|---|---|---|
| 数据总览 | `/api/admin/dashboard` | getCurrentUser + isAdmin |
| 提问箱列表 | `/api/admin/askbox-list` | getCurrentUser + isAdmin |
| 提问箱详情 | `/api/admin/askbox-questions` | getCurrentUser + isAdmin |
| 页面分析 | `/api/admin/page-stats` | getCurrentUser + isAdmin |
| 用户活动（保留） | `/admin-activity` | 后端会话 + is_admin |
| 心理测评（保留） | `/api/admin/quiz-stats*` | getCurrentUser + isAdmin |
| 塔罗（保留） | `/api/admin/tarot-*` | getCurrentUser + isAdmin |
| 用户管理（保留） | `/api/admin/users` | getCurrentUser + isAdmin |
| 内容审核（保留） | `/api/reports-admin` | 后端权限校验 |

---

## 4. 数据展示说明

### 4.1 统计卡片
- 使用现有 `.stat-card` 样式（深色卡片 + 大号数字 + 标签）
- 所有数值经 `n()` 安全函数处理：undefined/null/NaN → 0

### 4.2 表格
- 复用 `.table-scroll` + `table` 样式，支持移动端横向滚动
- 空数据显示 `<div class="empty">` 文案，无 undefined/NaN

### 4.3 图表
- 来源渠道使用纯 CSS 条形图（`.breakdown-list` + `.bar-track/.bar-fill`）
- 未引入任何外部图表库 / npm 依赖
- 热门口页趋势借助现有 `formatDate` 时间格式化

### 4.4 响应式
- 保留现有移动端媒体查询（`@media (max-width:500px)`）
- Tab 多时可横向滚动（白色 nowrap）

---

## 5. 权限检查

### 前端
- `#mainContent` 仅在 `Auth.isLoggedIn()` 时显示
- 未登录显示登录引导，不暴露任何数据模块

### 后端
- 新增 4 个 API 全部使用 `getCurrentUser` + `isAdmin`，非管理员返回 403
- 提问箱问题详情同样受管理员权限保护（普通用户 403）

> 用户要求「后台管理员可以查看问题内容，普通用户权限不能访问」已满足——后端 `/api/admin/askbox-questions` 强制 isAdmin。

---

## 6. 测试结果

### 6.1 静态验证

| 验证项 | 结果 |
|---|---|
| Tab 9 菜单存在 | ✅ |
| 4 个新面板 div 存在 | ✅ |
| loadDashboard / loadAskboxList / loadPageStats / showAskboxQuestions 函数存在 | ✅ |
| switchTab 分支覆盖 dashboard/askbox/pages/settings | ✅ |
| 默认启动 Tab 为 dashboard | ✅ |
| 页面分析时间筛选按钮绑定 | ✅ |
| 空状态文案（暂无访问数据/暂无提问箱数据/暂无问题/暂无来源数据） | ✅ |

### 6.2 后端 API 联调（Phase 2 已验证）
- ✅ 8 个后端文件 `node --check` 全部通过
- ✅ API 参数/返回结构与前端渲染字段完全对齐

### 6.3 未能执行（需线上/联调）
- 浏览器实际渲染（需登录管理员账号访问 `/admin.html`）
- 真实 D1 数据展示（线上未执行 S09 迁移，走降级路径）
- Phase 2/3 端到端埋点 → 后台时间线展示

---

## 7. 风险说明

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | 线上未执行 S09 迁移，UV/访问量走降级路径 | 低 | 接口返回 `uvMode`/`visitMode` 标识；迁移后自动升级 |
| 2 | Tab 数量从 5 增至 9，小屏横向拥挤 | 低 | 保留响应式；`.tab-btn` white-space:nowrap + 自动换行 |
| 3 | 提问箱详情弹窗数据量大时性能 | 低 | 每箱默认按时间倒序取第一页，问题详情懒加载 |
| 4 | 新增模块与后端 API 字段不一致风险 | 低 | 前端已按 API 返回结构精确编写，后端同批开发 |
| 5 | admin.html 跳转壳 + new_admin.html 双文件 | 低 | admin.html 保持不动，改造集中于 new_admin.html |

---

## 8. 待确认

Phase 4 后台数据中心 UI 已全部完成并通过静态验证。

**S09 全部 4 个阶段（迁移设计 → 后端 API → 埋点 SDK → 后台 UI）已完成。**

请确认后执行：
1. **线上 D1 迁移**（`docs/migrations/2026-08-08-S09-analytics-upgrade.sql`，数据库名待确认）
2. **浏览器端到端验证**（管理员登录访问后台）