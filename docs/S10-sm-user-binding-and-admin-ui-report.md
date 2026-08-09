# S10: S/M 互动倾向测试 - 用户身份绑定与后台 UI 优化报告

## 概述

本次迭代为 S/M 互动倾向测试（S10 功能）补充了**登录用户身份绑定**能力，并优化了后台管理界面的展示。此前 S/M 测试结果仅以 `visitor_token` 匿名保存，无法区分登录用户与游客。本次升级后：

- 登录用户完成测试后，结果会关联其 `user_id`
- 后台 S/M 测试 Tab 可显示用户昵称/邮箱，未登录用户显示"游客"
- 数据库新增 `user_id` 字段，兼容已有游客记录

## 变更清单

### 1. 数据库迁移

**文件**: `docs/migrations/2026-08-09-S10-sm-user-binding.sql`

```sql
ALTER TABLE sm_test_results ADD COLUMN user_id INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_sm_test_results_user
    ON sm_test_results(user_id, created_at DESC);
```

- `user_id` 可空，兼容已有游客记录
- 新增索引，便于后台按用户查询

### 2. Schema 更新

**文件**: `schema.sql`

- `sm_test_results` 表新增 `user_id INTEGER DEFAULT NULL` 字段
- 新增 `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL`
- 新增 `idx_sm_test_results_user` 索引

### 3. 后端保存接口

**文件**: `functions/api/sm-save.js`

- 导入 `getCurrentUser` 从 `_lib/auth.js`
- 从 session cookie 解析登录用户身份
- 将 `user_id` 写入 `sm_test_results` 表
- 未登录用户 `user_id` 为 `NULL`，继续使用 `visitor_token`

### 4. 前端测试页面

**文件**: `sm-test.html`

- `saveResult()` 中检测用户登录状态
- 已登录用户附带 `userId`（后端也会从 cookie 解析，双保险）

### 5. 后台统计接口

**文件**: `functions/api/admin/sm-stats.js`

- 最近记录查询使用 `LEFT JOIN users` 获取用户昵称和邮箱
- 返回 `userDisplayName` 和 `userEmail` 字段

### 6. 后台管理 UI

**文件**: `new_admin.html`

- 最近记录表格新增"访客"列（原"访客标识"列改为显示用户/游客）
- 登录用户显示昵称或邮箱前缀
- 未登录用户显示"游客"（灰色样式）
- 表头从"访客标识"改为"访客"

## 数据流

```
用户完成测试
    ↓
sm-test.html saveResult()
    ↓
POST /api/sm-save
    ↓
sm-save.js 解析 session cookie → getCurrentUser()
    ↓
INSERT INTO sm_test_results (visitor_token, user_id, ...)
    ↓
后台 /api/admin/sm-stats → LEFT JOIN users → 显示用户/游客
```

## 兼容性

- **已有游客记录**：`user_id` 为 `NULL`，后台显示"游客"，不受影响
- **未登录用户**：继续使用 `visitor_token` 匿名保存
- **登录用户**：结果关联 `user_id`，后台可识别

## 上线步骤

1. 执行数据库迁移：
   ```bash
   wrangler d1 execute <DB_NAME> --remote --file docs/migrations/2026-08-09-S10-sm-user-binding.sql
   ```

2. 部署代码（Cloudflare Pages 自动部署）

## 验证

- [x] 登录用户完成测试后，后台显示用户昵称/邮箱
- [x] 未登录用户完成测试后，后台显示"游客"
- [x] 已有游客记录不受影响
- [x] 不影响已有心理测试功能
