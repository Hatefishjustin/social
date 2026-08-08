# S09 Phase 5 上线前验证报告

> 版本：v1.0
> 日期：2026-08-08
> 阶段：Phase 5（上线前代码层验证完成）
> 状态：**未执行线上 D1 migration**

---

## 1. Git 检查

执行 `git status --short` 结果：

### 1.1 S09 修改文件（16 个，均为本方案预期变更）

| 文件 | 变更原因 | 状态 |
|---|---|---|
| `index.html` / `login.html` / `user.html` / `profile.html` / `match.html` / `chat.html` / `campus.html` / `qa.html` / `tarot.html` / `tarot-history.html` / `admin.html` / `new_admin.html` | track.js 引入 + 业务埋点（match/qa/tarot 3 处） | ✅ S09 |
| `auth.js` | 登录成功埋点状态机 | ✅ S09 |
| `functions/api/view.js` | 升级支持新字段（兼容旧调用） | ✅ S09 |
| `schema.sql` | S09 字段/表文档同步 | ✅ S09 |

### 1.2 S09 新增文件

```
track.js                                       # 埋点 SDK
functions/_lib/schema.js                       # 迁移兼容检测
functions/event.js                             # /api/event
functions/api/admin/dashboard.js               # 数据总览
functions/api/admin/page-stats.js              # 页面分析
functions/api/admin/askbox-list.js             # 提问箱列表
functions/api/admin/askbox-questions.js        # 提问箱问题
functions/api/admin/user-activity.js           # 用户时间线
docs/migrations/2026-08-08-S09-analytics-upgrade.sql
docs/S05-后台数据中心升级分析报告.md
docs/S09-Phase2-后端API开发报告.md
docs/S09-Phase3-埋点系统开发报告.md
docs/S09-Phase4-后台数据中心UI开发报告.md
```

### 1.3 非 S09 变更（用户既有未提交）

- `functions/askbox/answer.js`、`functions/wall.js`：Phase 1 前已存在未提交修改，**非本方案触碰**，保持原样
- `index.html.bak*`、`.wrangler/`、图片素材等：项目既有未跟踪文件

### 1.4 临时文件检查

- ✅ 无 `.insert_track.py` / `.track_check.txt` / `.sql_check.txt` / `.api_check.txt` / `.verify.txt` 残留（均已清理）
- ✅ 无调试输出文件

---

## 2. 数据库迁移 SQL 检查（docs/migrations/2026-08-08-S09-analytics-upgrade.sql）

### 2.1 逐项核对

| 检查项 | 结果 | 详情 |
|---|---|---|
| 语法 | ✅ | 全部为标准 SQLite 语句，无语法错误 |
| ALTER activity_log 6 字段 | ✅ | device / os / browser / referrer / page_path / detail_json，全部 `TEXT DEFAULT ''`，**幂等安全**（若已存在会报错但不会损坏数据） |
| ALTER page_views 5 字段 | ✅ | visitor_token / referrer / device / os / browser，全部 `TEXT DEFAULT ''` |
| CREATE INDEX 7 个 | ✅ | activity_log×2 + page_views×3 + askbox_visits×2，全部 `IF NOT EXISTS` |
| askbox_visits 建表 | ✅ | `id AUTOINCREMENT` + `target_user_id NOT NULL` + `visitor_id`/`user_id`/`referrer` + `created_at`，外键：target_user_id→users CASCADE、user_id→users SET NULL |
| 数据保留 | ✅ | 仅 ALTER ADD COLUMN + CREATE TABLE，**不删除任何数据** |
| 预留设计 | ✅ | user_interest_labels / 收藏仅注释，未建表 |

### 2.2 执行安全提示

- 风险点：若线上已迁移过（重复执行）ALTER 会报 "duplicate column name" 错误
- 缓解：执行前先跑验证 SQL（文件末尾已附），确认字段不存在再执行
- **本报告确认：未执行迁移**

---

## 3. API 静态验证

### 3.1 新 API（Phase 2 已建，全部通过 node --check）

| API | 路由文件 | 鉴权 | 迁移兼容 | 结论 |
|---|---|---|---|---|
| `/api/event` | `functions/event.js` | 无（白名单+限长） | `hasColumn(activity_log,'device')` 双分支 | ✅ |
| `/api/view`（升级） | `functions/api/view.js` | 会话识别 | `hasColumn(page_views,'visitor_token')` 双分支 | ✅ |
| `/api/admin/dashboard` | `functions/api/admin/dashboard.js` | `getCurrentUser`+`isAdmin` | `hasColumn`×2（visitor_token/askbox_visits） | ✅ |
| `/api/admin/page-stats` | `functions/api/admin/page-stats.js` | `getCurrentUser`+`isAdmin` | `hasColumn`×2（visitor_token/referrer） | ✅ |
| `/api/admin/askbox-list` | `functions/api/admin/askbox-list.js` | `getCurrentUser`+`isAdmin` | `hasTable(askbox_visits)` | ✅ |
| `/api/admin/askbox-questions` | `functions/api/admin/askbox-questions.js` | `getCurrentUser`+`isAdmin` | **不依赖新表新字段**，完全兼容 | ✅ |
| `/api/admin/user-activity` | `functions/api/admin/user-activity.js` | `getCurrentUser`+`isAdmin` | `hasColumn(activity_log,'device')` | ✅ |

### 3.2 前端引用验证（new_admin.html）

```
/api/admin/dashboard      → 存在 ✅
/api/admin/page-stats     → 存在 ✅
/api/admin/askbox-list    → 存在 ✅
/api/admin/askbox-questions → 存在 ✅
```

### 3.3 路由规范性

- 全部按 Cloudflare Pages Functions 约定：`functions/api/admin/*.js` → `/api/admin/*` 路由
- `/api/event` 为根级 `functions/event.js` → `/api/event`
- 与现有 `/api/admin/users`、`/api/admin/tarot-*` 等既有模式一致

### 3.4 SQL 逻辑抽查

- dashboards：`COUNT(DISTINCT COALESCE(NULLIF(visitor_token,''), 'anon:'||user_id))` UV 口径正确
- askbox-list：LEFT JOIN + HAVING question_count>0（迁移前）或 visit_count>0（迁移后），动态拼接
- user-activity：activity_log + page_views 合并，字段动态按 hasColumn 选择

---

## 4. 前端验证（new_admin.html）

### 4.1 9 菜单完整性

```
数据总览(dashboard) 用户活动(activity) 提问箱管理(askbox)
页面分析(pages)     用户管理(users)   心理测评(quiz)
塔罗数据(tarot)     内容审核(reports)  系统设置(settings)
```

- ✅ 全部 9 个 `.tab-btn` 存在，`data-tab` 与 `#tab-<name>` 一一对应
- ✅ switchTab() 覆盖全部 9 个分支
- ✅ 初始启动 = `switchTab('dashboard')`（数据总览默认）

### 4.2 API 请求路径

- ✅ 4 个新 API 前端请求路径与后端文件完整对应（见 3.2）
- ✅ 既有 5 模块 API（quiz/tarot/users/reports/admin-activity）保持不动

### 4.3 空状态处理

- ✅ Dashboard：`暂无访问数据，请先浏览网站后再查看`
- ✅ 提问箱：`暂无提问箱数据` / `暂无问题`
- ✅ 页面分析：`暂无访问数据` / `暂无来源数据`
- ✅ 数值安全函数 n()：undefined/null/NaN → 0

---

## 5. 埋点验证（track.js）

| 检查项 | 结果 | 说明 |
|---|---|---|
| 自动 page_view | ✅ | 页面加载自动发 `/api/view` |
| 防重复 | ✅ | `pageViewSent` 标志，单页仅一次 |
| visitor_token | ✅ | localStorage `sm_visitor_token` 优先 + cookie `sm_vt` 备用 |
| trackEvent(action) | ✅ | 映射白名单 + 透传 |
| 发送方式 | ✅ | sendBeacon 优先 + fetch keepalive 备用 |
| 安全 | ✅ | sanitizeDetail 含 @ 丢弃；不采集密码/token/邮件/聊天内容 |
| 数据字段 | ✅ | 发送 visitor_token / page_path / referrer / action |

---

## 6. 已知问题

| # | 问题 | 影响 | 缓解 |
|---|---|---|---|
| 1 | 线上未执行 S09 迁移，UV/提问箱访问量走降级路径 | 数据精度略低 | 接口返回 `uvMode`/`visitMode` 标识；迁移后自动升级 |
| 2 | `functions/askbox/answer.js`、`functions/wall.js` 有用户既有未提交修改 | 非 S09 变更，保持原样 | 上线时可一并 review 或单独 commit |
| 3 | hasColumn/hasTable 每次 isolate 首次 pragma 查询 | 极小性能开销 | 模块级缓存，单 isolate 仅首次 |
| 4 | 9 个 Tab 在手机小屏略显拥挤 | UI 体验 | 保留 nowrap + 响应式缩小 |
| 5 | `/api/event` 无鉴权，理论可被刷 | 统计误报 | action 白名单 + content≤500；如被刷可后续加 IP 频率限制 |
| 6 | 埋点自上线后才开始采集，历史无 page_views/activity 数据 | 后台早期显示空状态 | 符合预期，空状态已做处理 |

---

## 7. 上线建议

### 7.1 推荐上线顺序

1. **代码部署**：将全部 S09 代码（前端 + 后端 + track.js）部署到 Cloudflare Pages
2. **观察运行**：确认现有功能无回归（注册/登录/提问/测评/塔罗全链路）
3. **执行迁移**（本地/低峰）：`wrangler d1 execute <DB_NAME> --file docs/migrations/2026-08-08-S09-analytics-upgrade.sql`
   - 先跑验证 SQL 确认字段/表不存在
   - 若 ALTER 报 duplicate column 说明已执行过，忽略即可
4. **迁移后复检**：浏览器访问 `/api/admin/dashboard` 确认 `uvMode` 切换为 `visitor_token`、`visitMode` 切换为 `askbox_visits`
5. **数据积累**：迁移后正常使用 1-3 天积累 page_views / activity_log 数据
6. **后台确认**：管理员登录 `/admin.html`，核对数据总览/提问箱/页面分析/用户活动数据是否与预期一致

### 7.2 关键注意事项

- ❌ **确认未执行迁移**（本报告仅验证，不执行）
- ✅ 迁移前备份：建议先 `wrangler d1 export <DB_NAME> --remote --output=backup.sql`
- ✅ 迁移在低峰期（如凌晨）执行，避免影响在线用户