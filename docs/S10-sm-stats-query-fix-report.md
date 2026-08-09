# S10: S/M 后台统计查询失败修复报告

## 问题现象

`new_admin.html` 的 S/M 测试模块显示"查询失败"。

## 根因分析

### 1. 数据库迁移时序问题

S/M 测试功能涉及两个迁移文件：

| 迁移文件 | 作用 | 状态 |
|---------|------|------|
| `2026-08-09-S10-sm-test.sql` | 创建 `sm_test_results` 表（**无 user_id 字段**） | 可能已执行 |
| `2026-08-09-S10-sm-user-binding.sql` | 为 `sm_test_results` 表添加 `user_id` 字段 | **可能未执行** |

如果线上 D1 **只执行了第一个迁移**（创建表），但**没有执行第二个迁移**（添加 user_id），那么 `sm_test_results` 表就没有 `user_id` 字段。

### 2. SQL 查询直接引用不存在的字段

`functions/api/admin/sm-stats.js` 中的最近记录查询直接使用了：

```sql
SELECT r.id, r.visitor_token, r.user_id, ...
FROM sm_test_results r
LEFT JOIN users u ON r.user_id = u.id
```

如果 `sm_test_results` 表没有 `user_id` 字段，SQL 会报错（`no such column: r.user_id`），导致整个查询失败，返回 `db_error`，前端显示"查询失败"。

### 3. 保存接口同样受影响

`functions/api/sm-save.js` 中的 INSERT 语句直接写入了 `user_id` 字段：

```sql
INSERT INTO sm_test_results (visitor_token, user_id, ...) VALUES (?, ?, ...)
```

如果 `user_id` 字段不存在，INSERT 也会失败。

## 修复方案

### 1. `functions/api/admin/sm-stats.js`

- 导入 `hasColumn` 从 `_lib/schema.js`
- 使用 `hasColumn(env, 'sm_test_results', 'user_id')` 检测字段是否存在
- **有 user_id 字段**：正常 JOIN users 表，显示用户昵称/邮箱
- **无 user_id 字段**：降级为仅查询基础字段，不 JOIN users 表
- 错误消息包含具体错误信息（`查询失败: <error message>`），便于排查

### 2. `functions/api/sm-save.js`

- 导入 `hasColumn` 从 `_lib/schema.js`
- 使用 `hasColumn(env, 'sm_test_results', 'user_id')` 检测字段是否存在
- **有 user_id 字段**：正常写入 user_id
- **无 user_id 字段**：降级为仅写入基础字段（不写 user_id）

### 3. 前端 `new_admin.html`

- 无需修改，现有错误处理已能正确显示后端返回的错误消息
- 当 `userId` 为 null 时，`smUserLabel` 正确显示"游客"

## 验证

### 场景 1：线上 D1 已执行 user-binding 迁移

- `hasColumn` 返回 `true`
- 正常 JOIN users 表，显示用户昵称/邮箱
- 游客显示"游客"

### 场景 2：线上 D1 未执行 user-binding 迁移

- `hasColumn` 返回 `false`
- 降级为仅查询基础字段，不 JOIN users 表
- 所有记录显示"游客"
- 统计数据和最近记录正常显示

### 场景 3：sm_test_results 表不存在

- `hasTable` 返回 `false`
- 返回空统计数据，`tableMissing: true`
- 前端显示"暂无记录"

## 上线步骤

1. 部署代码（Cloudflare Pages 自动部署）
2. 建议执行 user-binding 迁移以启用用户绑定：
   ```bash
   wrangler d1 execute <DB_NAME> --remote --file docs/migrations/2026-08-09-S10-sm-user-binding.sql
   ```

## 变更文件

- `functions/api/admin/sm-stats.js` - 降级查询逻辑
- `functions/api/sm-save.js` - 降级写入逻辑
