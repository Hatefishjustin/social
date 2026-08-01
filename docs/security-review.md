# 心镜（SoulMirror）社交独立站 · P0 安全问题审核报告

> 本文档基于 `docs/security-fix-plan.md`，结合当前源码对 **P0 级问题（S-01 ~ S-04）** 进行二次审核与风险评估。
> 生成时间：2026-08-01
> 性质：**仅审核报告**。本报告不修改任何代码、不修改数据库、不提交 Git。

---

## 0. 审核结论速览

| 编号 | 问题 | 是否需立即修改 | 修改风险 | 影响现有用户 | 需数据库迁移 |
|------|------|:---:|:---:|:---:|:---:|
| S-01 | `content_violations` 字段不一致 | ✅ **是（功能性故障）** | 低 | ✅ 是（敏感词消息发送失败） | ✅ 是 |
| S-02 | 6 位登录码可暴力枚举 | ⚠️ **建议尽快，非紧急** | 中 | ⚠️ 部分（登录流程改动） | ✅ 是 |
| S-03 | IP 自动登录会话劫持 | ✅ **是（真实越权）** | 中 | ✅ 是（登录体验变化） | ⚠️ 视方案 |
| S-04 | `/analyze` 无限流滥用 | ⚠️ **建议尽快，非紧急** | 低 | ❌ 否 | ❌ 否 |

**核心结论**：四个 P0 中，**S-01 与 S-03 属于"当前正在发生"的真实问题**，应优先处理；S-02 与 S-04 属于"潜在风险"，可排期处理。原计划将四者并列 P0 略偏保守，建议按本报告调整执行顺序。

---

## 1. S-01 · `content_violations` 表字段与代码不一致

### 1.1 是否真的需要立即修改
✅ **需要，且优先级最高。** 经源码核实，`functions/chat/send.js` 在命中敏感词时执行：
```js
INSERT INTO content_violations (match_id, sender_id, content, violation_type, created_at) VALUES (?, ?, ?, ?, ?)
```
而 `schema.sql` 中 `content_violations` 表定义为 `user_id, report_id, action, admin_id, admin_note`。**字段名完全对不上**。

关键点：该 `INSERT` **未包裹在 try/catch 中**。因此一旦命中敏感词：
- 若线上表结构与 `schema.sql` 一致 → `INSERT` 抛"列不存在"异常 → **整条消息发送请求返回 500**，用户无法发送含敏感词的消息。
- 后续 `SELECT violation_type FROM content_violations WHERE match_id = ?` 同样失败 → 累计严重度自动关闭逻辑失效。

这**不是潜在漏洞，而是当前正在发生的功能性故障**，直接影响现有用户发消息。

### 1.2 修改风险
**低。** 采用"方案 A（新增字段）"时，`send.js` 代码完全不动，仅改 `schema.sql` + 线上 `ALTER TABLE`，风险集中在数据库迁移本身。

### 1.3 是否影响现有用户
✅ **是。** 当前含敏感词的消息发送会失败（500），用户已受影响。修复后恢复正常。

### 1.4 是否需要数据库迁移
✅ **是。** 需在 `schema.sql` 记录迁移说明，并在线上 D1 执行：
```sql
ALTER TABLE content_violations ADD COLUMN match_id INTEGER;
ALTER TABLE content_violations ADD COLUMN sender_id INTEGER;
ALTER TABLE content_violations ADD COLUMN content TEXT;
ALTER TABLE content_violations ADD COLUMN violation_type TEXT;
```
> ⚠️ 迁移前需先确认线上 `content_violations` 实际表结构（`wrangler d1 execute --command "PRAGMA table_info(content_violations)"`），避免与 `schema.sql` 假设不符。

---

## 2. S-02 · 6 位登录码可暴力枚举

### 2.1 是否真的需要立即修改
⚠️ **建议尽快，但非"立即"级。** 经源码核实，`functions/auth/verify.js` 生成 6 位纯数字码（10^6 组合），有效期 30 分钟，写入 `device_codes` 表，**无尝试次数限制**。

**风险成立的前提**：
1. 攻击者需知道目标 `user_id`（或能枚举）。
2. 攻击者需在 30 分钟内对校验接口发起大量尝试。
3. 校验接口（`code-login.js`）当前无 IP 限流。

**实际影响评估**：该登录码是"跨浏览器登录"的辅助手段，且登录码会出现在重定向 URL `/?login_code=` 中（存在 Referrer/日志泄露风险）。暴力枚举成功后可获得目标用户会话。**风险真实但触发条件较多**，属于"潜在风险"而非"正在发生"。

### 2.2 修改风险
**中。** 涉及登录流程改动：
- 若提高熵（改字母+数字），需同步前端 `login.html` 的输入提示与校验。
- 若加 `attempts`/`locked` 字段，需处理"锁定后用户如何重新登录"的兜底（重新发码）。
- 若缩短有效期，需确认前端倒计时逻辑。

### 2.3 是否影响现有用户
⚠️ **部分影响。** 登录码格式变化会改变用户输入习惯；锁定机制可能误伤正常用户（如输错几次被锁）。

### 2.4 是否需要数据库迁移
✅ **是**（若加尝试次数/锁定字段）：
```sql
ALTER TABLE device_codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_codes ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
```
> 若仅提高熵 + 缩短有效期（不改表），则**无需迁移**，风险更低，建议优先采用此轻量方案。

---

## 3. S-03 · IP 自动登录会话劫持

### 3.1 是否真的需要立即修改
✅ **需要，且为真实越权漏洞。** 经源码核实，`functions/auth/auto-login.js` 逻辑为：
```js
SELECT user_id FROM ip_trust WHERE ip = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1
// 命中后直接为该 user_id 创建 session
```
而 `verify.js` 在登录成功后会写入 `ip_trust (ip, user_id)`，有效期 5 分钟。

**漏洞成立**：在校园网 / NAT / 代理等**共享 IP** 环境下，用户 A 登录后 5 分钟内，**同 IP 的用户 B 访问 `/auth/auto-login` 即可无密码获得用户 A 的会话**。这是典型的会话劫持，且本项目定位为校园社交站，共享 IP 场景**非常常见**，风险被放大。

### 3.2 修改风险
**中。** 涉及登录体验核心流程：
- 若加设备指纹（`IP + UA`），需同步 `verify.js` 写入逻辑与 `auto-login.js` 校验逻辑。
- 若改为"显式确认"（移除自动登录），需改前端登录流程，体验变化较大。
- 若缩短信任窗口，改动最小。

### 3.3 是否影响现有用户
✅ **是。** 自动登录是"邮箱确认后免输码"的便利功能，任何改动都会影响该流程的体验。需权衡安全与便利。

### 3.4 是否需要数据库迁移
⚠️ **视方案**：
- 方案 1（加 `ua_hash` 设备指纹）→ ✅ 需迁移：
  ```sql
  ALTER TABLE ip_trust ADD COLUMN ua_hash TEXT;
  ```
- 方案 3（移除自动登录，改显式确认）→ ❌ 无需迁移，但需改前端流程。
- **建议**：优先采用"缩短窗口 + 加 UA 指纹"的组合，兼顾安全与体验。

---

## 4. S-04 · `/analyze` 无需登录且无限流

### 4.1 是否真的需要立即修改
⚠️ **建议尽快，但非"立即"级。** 经源码核实，`functions/analyze.js` 的 `onRequestPost` **未调用 `getCurrentUser`**，也未做频率限制。但已有基础防护：
- 有 `rawText` 长度限制（12000 字符）。
- 响应带 `Cache-Control: no-store`。
- 调用 `callDashScope` 有超时（35s）。

**实际影响评估**：攻击者可无限调用消耗 DashScope AI 配额与费用（成本/DoS 风险），但**不涉及数据泄露或越权**。属于"资源滥用"类风险，非"正在发生"的数据安全事故。

### 4.2 修改风险
**低。** 增加登录校验 + 限流，不影响正常用户（正常用户本就登录后使用测评功能）。

### 4.3 是否影响现有用户
❌ **否。** 正常登录用户不受影响；仅未登录的匿名调用会被拦截。

### 4.4 是否需要数据库迁移
❌ **否**（若限流用 KV 或复用现有表）。若新增独立限流表则需迁移，建议优先用 KV 或复用 `rate_limits`（见 S-05）。

---

## 5. 推荐执行顺序

> 依据"是否正在发生 + 影响面 + 改动风险"综合排序。

| 顺序 | 编号 | 理由 |
|:---:|------|------|
| 1 | **S-01** | 正在发生的功能性故障，影响用户发消息，改动风险最低（仅加字段） |
| 2 | **S-03** | 真实越权漏洞，校园共享 IP 场景高发，需尽快封堵 |
| 3 | **S-02** | 潜在暴力枚举风险，建议用"提高熵+缩短有效期"轻量方案 |
| 4 | **S-04** | 资源滥用风险，加登录校验+限流，改动小 |

> 建议 S-01 与 S-03 作为**第一批**（本周内），S-02 与 S-04 作为**第二批**（两周内）。

---

## 6. 每一步预计修改文件

### 第 1 步 · S-01
| 文件 | 改动 |
|------|------|
| `schema.sql` | 为 `content_violations` 表补充 `match_id`、`sender_id`、`content`、`violation_type` 字段定义 + 迁移注释 |
| `functions/chat/send.js` | **无需改动**（方案 A） |
| 线上 D1 | 执行 4 条 `ALTER TABLE` |

### 第 2 步 · S-03
| 文件 | 改动 |
|------|------|
| `functions/auth/verify.js` | 写入 `ip_trust` 时增加 `ua_hash`（或缩短窗口） |
| `functions/auth/auto-login.js` | 校验时增加 `ua_hash` 匹配（或改为显式确认） |
| `schema.sql` | 补充 `ip_trust.ua_hash` 字段 + 迁移注释 |
| 线上 D1 | 执行 `ALTER TABLE ip_trust ADD COLUMN ua_hash TEXT;` |

### 第 3 步 · S-02
| 文件 | 改动 |
|------|------|
| `functions/auth/verify.js` | 提高登录码熵（字母+数字）或改为 8 位数字；缩短有效期至 10 分钟 |
| `functions/auth/code-login.js` | 增加尝试次数限制 / 失败计数（若采用） |
| `login.html` | 同步登录码输入提示与校验 |
| `schema.sql` | 补充 `attempts`/`locked` 字段（若采用）+ 迁移注释 |
| 线上 D1 | 执行对应 `ALTER TABLE`（若采用） |

### 第 4 步 · S-04
| 文件 | 改动 |
|------|------|
| `functions/analyze.js` | 开头调用 `getCurrentUser`，未登录返回 401；增加限流 |
| `functions/_lib/rate-limit.js` | 新增统一限流工具（可复用 S-05 方案） |
| `functions/_lib/ai.js` | 可选：在 AI 层统一加限流 |
| `schema.sql` | 若新增 `rate_limits` 表则补充定义 + 迁移注释 |

---

## 7. 测试方案

### 通用前置
- 在本地/预览环境（`wrangler pages dev`）验证，避免直接改线上。
- 每次改动前先备份线上 D1（`wrangler d1 export`）。

### S-01 测试
1. 迁移后，用含敏感词（如"色情"）的消息发送，确认能正常入库且不报 500。
2. 连续发送触发累计严重度，确认自动关闭会话逻辑生效。
3. 正常消息发送回归，确认不受影响。

### S-03 测试
1. 登录后 5 分钟内，用**同 IP 不同 UA** 访问 `/auth/auto-login`，确认不再自动登录（UA 指纹生效）。
2. 用**同 IP 同 UA** 访问，确认正常自动登录。
3. 超过信任窗口后访问，确认不自动登录。

### S-02 测试
1. 生成登录码，确认新格式（字母+数字或 8 位）正确。
2. 连续输错 N 次，确认被锁定/拒绝。
3. 正常输入正确码，确认登录成功。
4. 前端 `login.html` 输入框校验与提示正常。

### S-04 测试
1. 未登录调用 `/analyze`，确认返回 401。
2. 登录后正常调用，确认返回分析结果。
3. 高频调用，确认触发限流返回 429。
4. 超长 `rawText`，确认返回 400。

---

## 8. 回滚方案

### 通用原则
- 所有改动**先备份**（代码走 Git 分支、数据库走 `wrangler d1 export`）。
- 数据库迁移**只增不改不删**，保证可逆。

### S-01 回滚
- 代码：`send.js` 未改动，无需回滚。
- 数据库：新增的 4 个字段为**纯新增**，不影响旧逻辑。若需回滚，可保留字段（不删除，避免破坏数据），仅回滚代码即可。**不建议删除字段**（可能已有新数据写入）。

### S-03 回滚
- 代码：回滚 `verify.js` / `auto-login.js` 到上一版本。
- 数据库：`ua_hash` 为新增字段，回滚代码后该字段闲置，可保留。

### S-02 回滚
- 代码：回滚 `verify.js` / `code-login.js` / `login.html`。
- 数据库：`attempts`/`locked` 为新增字段，回滚代码后闲置，可保留。

### S-04 回滚
- 代码：回滚 `analyze.js` / `rate-limit.js`。
- 数据库：若新增 `rate_limits` 表，回滚代码后该表闲置，可保留（或后续清理）。

> **回滚核心原则**：所有数据库迁移均为"新增字段/表"，不删除、不修改既有列，因此回滚只需回滚代码，数据库可安全保留，避免数据丢失。

---

## 9. 风险提示与遗留事项

1. **线上表结构确认**：S-01 迁移前务必用 `PRAGMA table_info(content_violations)` 确认线上实际结构，防止与 `schema.sql` 假设不符。
2. **`code-login.js` 未读取**：S-02 的校验逻辑（`code-login.js`）本次未读取，实施前需确认其校验方式，避免方案与实际不符。
3. **`_middleware.js` 域名重定向**：涉及登录流程改动时，需确认自定义域名重定向不会影响 `/auth/*` 路径。
4. **S-03 方案权衡**：若采用"移除自动登录"，需评估对现有用户登录便利性的影响，建议先灰度。
5. **本报告仅覆盖 P0**：P1/P2 问题（S-05~S-14）不在本次审核范围，建议后续单独评审。

---

*本报告基于静态源码分析，具体实施以实际线上环境为准。所有改动须遵守 `.clinerules` 规范。*
