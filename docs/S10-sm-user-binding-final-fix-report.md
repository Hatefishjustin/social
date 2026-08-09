# S10: S/M 互动倾向测试 - 用户身份绑定最终修复报告

> **修复日期**: 2026-08-09
> **修复人**: File Agent (AI)
> **基于报告**: [S10-sm-user-binding-investigation.md](./S10-sm-user-binding-investigation.md)

---

## 1. 根因总结

| 问题 | 说明 |
|------|------|
| **D1 迁移未执行** | `S10-sm-user-binding.sql` 通过 `ALTER TABLE sm_test_results ADD COLUMN user_id` 添加列，线上可能未执行 |
| **hasColumn 降级逻辑** | `sm-save.js` 和 `sm-stats.js` 中通过 `hasColumn(env, 'sm_test_results', 'user_id')` 判断分支，返回 `false` 时不写入/不查询 `user_id` |

**效果**：即使 `getCurrentUser()` 正确解析了登录用户身份，`user_id` 也因降级路径被丢弃，导致后台始终显示"游客"。

---

## 2. 修改文件清单

| # | 文件 | 修改类型 | 说明 |
|---|------|----------|------|
| 1 | `functions/api/sm-save.js` | 代码修改 | 移除 hasColumn 降级 + 清除 DEBUG 日志 |
| 2 | `functions/api/admin/sm-stats.js` | 代码修改 | 移除 hasColumn 降级 + 固定 LEFT JOIN |
| 3 | `sm-test.html` | 无需修改 | `window.SMTrack` 引用正确（track.js 已暴露） |

---

## 3. 修改详情

### 3.1 `functions/api/sm-save.js`

**修改项 1** — 移除 `hasColumn` import：

```diff
- import { hasTable, hasColumn } from '../_lib/schema.js';
+ import { hasTable } from '../_lib/schema.js';
```

**修改项 2** — 移除所有 `[TEMP-DEBUG]` 日志（含 Cookie 内容打印等敏感信息）：

移除块：
```js
const cookieHeader = request.headers.get('Cookie');
console.log('[sm-save.js][DEBUG] Cookie存在:', ...);
console.log('[sm-save.js][DEBUG] Cookie内容(前80字符):', ...);
console.log('[sm-save.js][DEBUG] getCurrentUser返回:', ...);
console.log('[sm-save.js][DEBUG] 最终userId:', ...);
```

保留核心逻辑：
```js
const user = await getCurrentUser(request, env);
if (user && user.id) {
  userId = user.id;
}
```

**修改项 3** — 移除 `hasColumn` 检查和降级 INSERT 分支，固定写入 `user_id`：

```diff
- const hasUserId = await hasColumn(env, 'sm_test_results', 'user_id');
- if (hasUserId) {
-   INSERT INTO sm_test_results (visitor_token, user_id, ...) VALUES (?, ?, ...)
- } else {
-   INSERT INTO sm_test_results (visitor_token, ...) VALUES (?, ...)  // 无 user_id
- }
+ INSERT INTO sm_test_results (visitor_token, user_id, s_score, m_score, switch_score, trust_score, consent_score, result_type, created_at)
+ VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
```

### 3.2 `functions/api/admin/sm-stats.js`

**修改项 1** — 移除 `hasColumn` import：

```diff
- import { hasTable, hasColumn } from '../../_lib/schema.js';
+ import { hasTable } from '../../_lib/schema.js';
```

**修改项 2** — 移除 `hasColumn` 调用和降级分支：

```diff
- const hasUserId = await hasColumn(env, 'sm_test_results', 'user_id');
- let recentRows;
- if (hasUserId) {
-   recentRows = ... LEFT JOIN users ...
- } else {
-   recentRows = ... 无 user_id 字段 ...
- }
+ const recentRows = await db.prepare(
+   `SELECT r.id, r.visitor_token, r.user_id, ... u.display_name, u.email
+    FROM sm_test_results r
+    LEFT JOIN users u ON r.user_id = u.id
+    ORDER BY r.created_at DESC LIMIT 20`
+ ).all();
```

**修改项 3** — `userBinding` 字段改为固定 `true`：

```diff
- userBinding: hasUserId,
+ userBinding: true,
```

### 3.3 `sm-test.html` — 无需修改

确认 `track.js` 末尾已暴露：

```js
window.SMTrack = { trackEvent: trackEvent, getVisitorToken: getOrCreateVisitorToken };
```

`sm-test.html` 中 `saveResult()` 引用 `window.SMTrack.getVisitorToken()` 正确对应，无需修改。

---

## 4. 需要的后续操作

### 4.1 P0 — 执行 D1 迁移（必须）

如果线上 D1 尚未执行 `user_id` 列迁移，代码修复后 INSERT 会因列不存在而报错：

```bash
# 执行迁移
wrangler d1 execute <DB_NAME> --remote --file docs/migrations/2026-08-09-S10-sm-user-binding.sql

# 验证列已存在
wrangler d1 execute <DB_NAME> --remote --command "SELECT name FROM pragma_table_info('sm_test_results') WHERE name='user_id';"
```

迁移内容（`docs/migrations/2026-08-09-S10-sm-user-binding.sql`）：
```sql
ALTER TABLE sm_test_results ADD COLUMN user_id INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_sm_test_results_user ON sm_test_results(user_id, created_at DESC);
```

### 4.2 P1 — 部署验证

部署后验证步骤：
1. 登录用户完成 S/M 测试
2. 查询 D1 确认 `user_id` 已写入：`SELECT id, user_id, visitor_token, result_type FROM sm_test_results ORDER BY created_at DESC LIMIT 5`
3. 后台 `sm-stats` 验证用户昵称/邮箱正确显示

---

## 5. 修复总结

| | 修复前 | 修复后 |
|------|--------|--------|
| **sm-save.js** | hasColumn 降级不写 user_id + DEBUG 日志污染 | 固定 INSERT 含 user_id，无降级，日志清洁 |
| **sm-stats.js** | hasColumn 降级不 JOIN users | 固定 LEFT JOIN，始终返回用户信息 |
| **sm-test.html** | window.SMTrack 引用 | 确认正确，无需修改 |

修复核心思路：**代码层面不再依赖 `hasColumn` 自检降级，强制要求 `user_id` 列存在。** 这要求 D1 迁移必须已执行（列已存在），否则 INSERT 会因列不匹配而报错——这是一种 fail-fast 策略，比"静默降级丢失数据"更安全。
