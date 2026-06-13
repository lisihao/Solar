# Contributing to GenesisPod / 贡献指南

[English](#english) · [中文](#中文)

First: thank you. GenesisPod aims to be a best-in-class, fully open multi-agent
AI platform, and that only happens with a healthy contributor community.

---

## English

### TL;DR

1. Open an issue first for anything non-trivial (bug repro or feature proposal).
2. Fork → branch → code → `npm run verify:quick` → PR.
3. The **CLA Assistant** bot will ask you to sign the [CLA](./CLA.md) on your
   first PR. This is required (it keeps the dual-license model viable).
4. Keep PRs focused: one logical change per PR.

### Development setup

See the [Quick Start](./README.md#quick-start) in the README. Minimum:

```bash
npm install
npm run db:setup        # postgres + redis + flaresolverr via Docker
npm run dev             # full stack
```

### Project layout

This is a monorepo: `frontend/` (Next.js), `backend/` (NestJS), `ai-service/`
(FastAPI). The backend is layered top-to-bottom into `open-api / ai-app /
ai-harness / ai-engine / platform` (the L1 `platform/` module was historically
called `ai-infra`). See [`STRUCTURE.md`](./STRUCTURE.md).

### Code standards (enforced)

- **TypeScript only**, no `any`. Functional React components + hooks.
- **No `console.log`** — use the NestJS `Logger`. **No emoji in code/UI** — use
  Lucide icons.
- **No hardcoded model names** (e.g. `gpt-4o`). Route LLM calls through
  `AiChatService.chat()` + `TaskProfile`.
- **Architecture boundaries are enforced.** `ai-app` must import `ai-engine`
  only through its facade; `ai-engine` must not import `ai-harness`. Violations
  are blocked by ESLint, a jest arch-spec suite, and a pre-push/CI gate.
- Run `npm run verify:arch` if you touched module boundaries.

### Before you open a PR

```bash
npm run type-check
npm run test:quick
npm run verify:arch      # if architecture/imports changed
npm run audit:ui-discipline   # if you touched frontend UI
```

### Commit & PR conventions

- Conventional Commits: `feat(module): ...`, `fix(module): ...`,
  `refactor`, `docs`, `test`, `chore`. Header lowercase, < 100 chars, no period.
- One commit = one logical change.
- Fill in the PR template; link the issue it closes.

### Reporting bugs / proposing features

Use the issue templates. For security issues, **do not** open a public issue —
see [`SECURITY.md`](./SECURITY.md).

---

## 中文

### 一句话流程

1. 任何非琐碎改动先开 issue（bug 复现或功能提案）。
2. Fork → 建分支 → 写代码 → `npm run verify:quick` → 提 PR。
3. 首次 PR 时 **CLA Assistant** 机器人会请你签署 [CLA](./CLA.md)，这是**必须**的
   （它让双授权模式得以维持）。
4. PR 保持聚焦：一个 PR 只做一件逻辑上的事。

### 开发环境

见 README 的[快速开始](./README.zh-CN.md#快速开始)。最小启动：

```bash
npm install
npm run db:setup        # 通过 Docker 起 postgres + redis + flaresolverr
npm run dev             # 全栈
```

### 项目结构

这是一个 monorepo：`frontend/`（Next.js）、`backend/`（NestJS）、`ai-service/`
（FastAPI）。后端自上而下按 `open-api / ai-app / ai-harness / ai-engine /
platform` 分层（L1 的 `platform/` 模块旧称 `ai-infra`），详见
[`STRUCTURE.md`](./STRUCTURE.md)。

### 代码规范（强制）

- **仅 TypeScript**，禁止 `any`。React 用函数组件 + hooks。
- **禁止 `console.log`** —— 用 NestJS `Logger`。**代码/UI 禁止 emoji** —— 用
  Lucide 图标。
- **禁止硬编码模型名**（如 `gpt-4o`）。LLM 调用走 `AiChatService.chat()` +
  `TaskProfile`。
- **架构边界强制执行。** `ai-app` 只能经 facade 导入 `ai-engine`；`ai-engine`
  不得导入 `ai-harness`。违规会被 ESLint、jest 架构 spec 套件与 pre-push/CI 门禁
  拦截。
- 改动模块边界后请跑 `npm run verify:arch`。

### 提 PR 前

```bash
npm run type-check
npm run test:quick
npm run verify:arch          # 若改动了架构 / import
npm run audit:ui-discipline  # 若改动了前端 UI
```

### 提交与 PR 约定

- Conventional Commits：`feat(module): ...`、`fix(module): ...`、`refactor`、
  `docs`、`test`、`chore`。header 小写、< 100 字符、无句号结尾。
- 一个 commit 只做一件逻辑上的事。
- 填写 PR 模板；关联其关闭的 issue。

### 上报 bug / 提议功能

使用 issue 模板。安全问题**不要**开公开 issue —— 见 [`SECURITY.md`](./SECURITY.md)。
