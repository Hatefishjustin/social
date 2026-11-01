# 心镜 SoulMirror

面向中学生和大学生的匿名校园社交与自我探索平台。核心能力包括：41 题心理测评与匹配、匿名提问箱、表白墙、动态、塔罗解读与一对一聊天。

- 线上地址：<https://soulmirror-255.pages.dev>
- 自定义域名：<https://soulmirror.cc.cd>（中国大陆部分网络可能无法访问）
- 技术栈：Cloudflare Pages + Pages Functions + D1，原生 HTML / CSS / JavaScript，无框架、无构建、无 npm 依赖

## 目录结构

```
.
├── *.html                 # 页面（index / match / chat / campus / qa / tarot / user / profile ...）
├── auth.js                # 前端登录态与登录弹窗
├── track.js               # 前端埋点
├── tarot-deck.js          # 塔罗牌数据
├── schema.sql             # 数据库权威结构（新环境按此建库）
├── functions/             # Pages Functions，文件路径即路由
│   ├── _lib/              # 共享库：auth / ai / ip / ua / visitor / schema / ratelimit
│   ├── api/               # JSON 接口
│   ├── auth/              # 邮箱登录
│   ├── chat/              # 匹配与会话
│   ├── askbox/            # 提问箱
│   └── admin/             # 客服工作台
├── docs/
│   ├── migrations/        # D1 迁移 SQL
│   ├── 接管分析报告-2026-11-01.md
│   ├── 多端同步手册.md
│   └── security-*.md      # 安全审计与修复计划
└── 交接文档.md
```

## 本地开发

需要 Node.js（仅用于本地运行 Wrangler，不引入项目依赖）与 Cloudflare 账号。

```bash
# 安装 wrangler（全局，仅一次）
npm install -g wrangler

# 登录
wrangler login

# 本地预览（D1 使用本地模拟库）
wrangler pages dev . --d1=DB
```

本地预览不会连接线上数据库。需要真实数据时，先导出备份，再在本地导入。

## 部署

本项目通过 Cloudflare Pages 的 Git 集成部署：推送到 `main` 后自动构建。

D1 绑定需在 Cloudflare Dashboard 配置：

1. Pages → `soulmirror-255` → Settings → Functions → D1 database bindings
2. 变量名：`DB`，选择数据库 `db`

环境变量（Secrets）：

| 名称 | 用途 |
| --- | --- |
| `DASHSCOPE_API_KEY` | 阿里云百炼 / qwen-plus，用于 AI 解读 |
| `RESEND_API_KEY` | Resend，用于发送登录验证邮件 |
| `MAIL_FROM` | 发件人地址（需在 Resend 验证域名） |
| `QINGNI_SPACE_ID` | 轻匿导入（可选） |
| `QINGNI_CLIENT_SECRET` | 轻匿导入（可选） |

## 数据库

`schema.sql` 是新环境的权威结构。已有环境按 `docs/migrations/` 中的日期顺序执行增量迁移。

```bash
# 备份
wrangler d1 export db --remote --output=backup.sql

# 执行迁移
wrangler d1 execute db --remote --file docs/migrations/2026-11-01-S13-security-hardening.sql
```

## 开发约定

- 路由即文件：`functions/xxx.js` → `/xxx`，导出 `onRequestGet/Post/Put/Options`
- 认证统一使用 `functions/_lib/auth.js` 的 `getCurrentUser`
- AI 调用统一使用 `functions/_lib/ai.js` 的 `callDashScope`
- SQL 一律参数化，禁止拼接用户输入
- 时间统一使用毫秒时间戳 `Date.now()`
- 不引入框架、构建步骤或 npm 运行时依赖

完整规范见 `.clinerules`，协作与多端同步见 `docs/多端同步手册.md`。

## 文档

- [交接文档](交接文档.md)
- [接管分析报告](docs/接管分析报告-2026-11-01.md)
- [多端同步手册](docs/多端同步手册.md)
- [安全审计](docs/security-audit.md)
- [安全修复计划](docs/security-fix-plan.md)
