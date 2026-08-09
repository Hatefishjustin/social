# S11：心理测评支持匿名记录 + 后台展示优化报告

- 日期: 2026-08-10
- 需求: 后台「心理测评」数据板块无法看到匿名测评记录；「用户活动」板块需同类行为折叠
- 涉及环境: 生产 D1（soulmirror）

---

## 一、问题根因（需求1）

1. **前端** `match.html`：`autoSaveRecordIfLoggedIn()` 仅在登录时调用 `/records` 保存测评，
   匿名用户完成测评后没有落库。
2. **后端** `functions/records.js`：POST `/records` 要求登录（`if (!user) return 401`），
   匿名请求被直接丢弃。
3. **数据库** `quiz_results.user_id` 为 `INTEGER NOT NULL`，即使放行匿名也无法写入。
4. **后台查询**：`quiz-stats-local.js` / `quiz-readings-local.js` 已使用 `LEFT JOIN`
   （不会过滤匿名），但未返回 `visitor_token`，后台无匿名身份可追踪。
5. **S/M 测试链路**（`sm-test.html` → `/api/sm-save`）已支持匿名保存，但后台将匿名显示为
   「游客」，且未展示 visitor_token。

## 二、修改内容

### 1. 数据库迁移 `docs/migrations/2026-08-10-S11-quiz-anonymous.sql`

- 重建 `quiz_results` 表：
  - `user_id` 由 `NOT NULL` 改为可空（NULL = 匿名访客）
  - 新增 `visitor_token TEXT DEFAULT ''`（匿名访客标识，用于后台追踪）
- **全量保留已有数据**（id 不变、记录数不变、关联关系不变）
- 安全处理：D1 强制外键，`DROP TABLE` 会对 `tarot_readings.linked_quiz_id` 触发
  `ON DELETE SET NULL`；迁移前备份该引用、重建后恢复，确保零丢失。
- 本地 SQLite 模拟验证通过（外键 ON 场景）：
  - 迁移前 2 条记录 → 迁移后 2 条记录
  - `tarot_readings` 关联 2 条 → 恢复后仍 2 条
  - 匿名插入（user_id=NULL + visitor_token）成功，AUTOINCREMENT 正常延续

**线上执行命令：**
```bash
wrangler d1 execute <DB_NAME> --remote --file docs/migrations/2026-08-10-S11-quiz-anonymous.sql
```

### 2. 前端 `match.html`

- `autoSaveRecordIfLoggedIn` → `autoSaveRecord`：
  - 匿名用户也保存测评记录
  - 通过 `window.SMTrack.getVisitorToken()` 生成/读取 `visitor_token` 并随请求提交
  - 登录用户仍由后端从 session cookie 解析身份

### 3. 保存接口 `functions/records.js`

- POST `/records` 支持匿名：
  - 登录用户 → 写入 `user_id`（visitor_token 存在时一并记录）
  - 匿名用户 → `user_id = NULL` + `visitor_token`
  - 迁移未执行时（无 `visitor_token` 列）保持旧的"仅登录可保存"行为，不报错

### 4. 后台查询接口

- `functions/api/admin/quiz-stats-local.js`：最近记录返回 `visitorToken`；
  统计 SQL 本就统计全部记录（含匿名）。
- `functions/api/admin/quiz-readings-local.js`：列表与详情返回 `visitorToken`。
- `functions/api/admin/sm-stats.js`：无需改动（已返回 visitorToken / user_id）。

### 5. 后台页面 `new_admin.html`

- **心理测评（SoulMirror 源）**：
  - 登录用户：显示用户名/邮箱 + 用户ID
  - 匿名用户：显示「匿名用户」 + visitor_token（短显，悬停看完整）
- **测评详情弹窗**：同上，额外显示「访客标识」
- **S/M 测试**：登录用户显示名称 + 用户ID；匿名显示「匿名用户」 + visitor_token

### 6. 用户活动折叠（需求2）

- `functions/admin-activity.js`：返回 `visitor_id`（匿名折叠分组依据）
- `new_admin.html`：
  - 新增折叠逻辑：**相同用户 + 相同操作 + 连续时间范围内（相邻间隔 ≤ 5 分钟）→ 折叠成一条**
  - 折叠条展示：操作名 + `×N` 次数徽标 + 时间范围（最早 ~ 最新）
  - 点击可展开/收起明细（逐条时间 + 内容）
  - 分组依据：登录用户按 `user_id`，匿名按 `visitor_id`，兜底 IP

## 三、验证

- 后端 JS：`node --check` 全部通过
- 前端内联 JS（match.html / new_admin.html）：语法检查通过
- 折叠逻辑：Node 单测通过（同用户同操作连续 4 条折叠为 1 条、不同用户/操作/超时窗不折叠）
- 迁移：本地 SQLite 模拟 D1 外键强制场景通过

## 四、上线步骤

1. 执行迁移：`wrangler d1 execute <DB_NAME> --remote --file docs/migrations/2026-08-10-S11-quiz-anonymous.sql`
2. 部署 Worker / Pages：`wrangler pages deploy`（或按项目现有流程）
3. 验证：
   - 匿名访问 `/match.html` 完成测评 → 后台「心理测评」SoulMirror 源出现「匿名用户」记录
   - 同一匿名用户多次测评 → 记录携带相同 visitor_token
   - 后台「用户活动」连续同类操作折叠显示

> 注：不删除任何已有数据；迁移仅重建表结构并全量保留数据。
