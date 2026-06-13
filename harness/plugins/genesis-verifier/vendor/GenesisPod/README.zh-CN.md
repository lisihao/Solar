<div align="center">

# GenesisPod

**开源、企业级的 AI 深度研究、内容生产与多 Agent 协作平台。**

[English](./README.md) · [简体中文](./README.zh-CN.md)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Commercial license available](https://img.shields.io/badge/license-commercial%20available-green.svg)](./COMMERCIAL-LICENSE.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)
[![Secret scan: gitleaks](https://img.shields.io/badge/secret%20scan-gitleaks-informational.svg)](./.github/workflows/gitleaks.yml)

</div>

---

## GenesisPod 是什么？

GenesisPod 是一个全栈平台，用于在生产环境中构建和运行 **AI 研究与多 Agent 工作流**。
它在一个严格分层、**架构受治理**的后端之上，提供了完整的产品面——深度研究、多
Agent 编排、文档/PPT 生成、长文写作、RAG 与知识图谱。

项目以 **AGPL-3.0 完整开源**，并为闭源与 SaaS 用途提供[商业授权](./COMMERCIAL-LICENSE.md)。

### 为什么又一个 AI 平台？

差异点是**可被验证的架构纪律**。多数 Agent 框架在一年内就退化成交叉引用的乱麻。
GenesisPod 通过三道独立门禁——ESLint 规则、jest 架构 spec 套件、pre-push + CI 合并
门禁——强制其 5 层边界（`open-api → ai-app → ai-harness → ai-engine → platform`），
让代码库在增长时仍保持结构清晰。架构合规度是**每次 push 都机器校验**的，而不是
wiki 里一张会与现实脱节的图。

## 功能

- **AI Research** —— 多步规划、资料采集与报告生成。
- **Agent Playground** —— 多 Agent 任务编排，含实时追踪、token/成本核算、结构化报告产物。
- **AI Ask / Insights** —— 多模型问答与话题洞察。
- **AI Office / Slides / Writing / Social** —— 文档、演示、长文与社媒内容生成。
- **Library / RAG / Knowledge Graph** —— 知识摄取、检索与沉淀。
- **BYOK 与多模型** —— OpenAI、Anthropic、Gemini、Grok、DeepSeek 及任意 LiteLLM
  兼容提供方，配套一等公民的 secrets 模块。
- **Admin** —— 模型、工具、Secrets、数据源与系统管理。

## 架构

monorepo，包含三个运行时：

| 包            | 技术栈                                                                   |
| ------------- | ------------------------------------------------------------------------ |
| `frontend/`   | Next.js 14, React 18, TypeScript, Tailwind, Zustand, SWR, TanStack Query |
| `backend/`    | NestJS 10, Prisma, PostgreSQL 16, Redis 7, Socket.IO                     |
| `ai-service/` | FastAPI（辅助 AI 服务）                                                  |

后端按 5 个顶层模块分层，**严格单向依赖**（每层只能依赖其下方的层）：

```
open-api    →  对外 / Admin / MCP 接口                          (L4)
ai-app      →  业务应用（research、teams、office、writing ...）  (L3)
ai-harness  →  多 Agent 运行时、生命周期、评测、协议            (L2.5)
ai-engine   →  通用 AI 基元（LLM、tools、RAG、knowledge、planning）(L2)
platform    →  认证、凭证/密钥、存储、credits、通知              (L1)
```

L1 的真实目录是 `backend/src/modules/platform/`（其层概念名为 “ai-infra”）。
`ai-app` 只能经各层 facade 访问下层；`ai-harness` 可用 `ai-engine`，但
`ai-engine` 绝不导入 `ai-harness`。完整结构见 [`STRUCTURE.md`](./STRUCTURE.md)。

## 快速开始

### 环境要求

- Node.js `>= 20`，npm `>= 9`
- Docker / Docker Compose
- 至少一个模型提供方的 API Key（如 `OPENAI_API_KEY`）

### 运行

```bash
# 1. 安装
npm install

# 2. 配置——复制模板并填入你的 key（切勿提交 .env）
cp .env.example .env

# 3. 启动基础设施（postgres + redis + flaresolverr）
npm run db:setup

# 4. 初始化数据库
cd backend
npm run prisma:generate && npm run prisma:migrate && npm run prisma:seed
cd ..

# 5. 启动全栈
npm run dev
```

默认端口：前端 `http://localhost:3000`、后端 `http://localhost:3001`、
AI 服务 `http://localhost:5000`。

单独启动某一端：`npm run dev:frontend` / `dev:backend` / `dev:ai`。

### 最小环境变量

`DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`，以及一个提供方 key（`OPENAI_API_KEY`
或其他）。登录、存储、第三方集成见 `.env.example`。

## 开发

| 命令                  | 用途                      |
| --------------------- | ------------------------- |
| `npm run dev`         | 全栈开发                  |
| `npm run type-check`  | 类型检查                  |
| `npm run test:quick`  | 快速测试                  |
| `npm run verify:arch` | 架构边界检查              |
| `npm run verify:full` | lint + 类型 + 测试 + 构建 |
| `npm run e2e`         | Playwright 端到端         |

提 PR 前请先读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 许可证

GenesisPod 采用**双重授权**：

- **[AGPL-3.0](./LICENSE)** 用于开源与自托管。注意：AGPL 把网络使用视为分发——
  若你把修改版跑成服务，必须公开你的源码改动。
- **[商业授权](./COMMERCIAL-LICENSE.md)** 用于闭源产品、专有 SaaS，或需要质保/SLA/
  赔偿时。联系：**hello@gens.team**。

不确定该选哪个？见[决策表](./COMMERCIAL-LICENSE.md#中文)。

## 贡献

欢迎贡献。请阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)，并注意首次 PR 需签署一次性
[CLA](./CLA.md)（由机器人自动引导）——这正是双授权模式得以维持的前提。

## 安全

发现漏洞？**请勿**开公开 issue——见 [`SECURITY.md`](./SECURITY.md)。
