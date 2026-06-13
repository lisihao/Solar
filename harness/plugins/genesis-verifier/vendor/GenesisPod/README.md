<div align="center">

# GenesisPod

**An open-source, enterprise-grade platform for AI deep research, content production, and multi-agent collaboration.**

[English](./README.md) · [简体中文](./README.zh-CN.md)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Commercial license available](https://img.shields.io/badge/license-commercial%20available-green.svg)](./COMMERCIAL-LICENSE.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)
[![Secret scan: gitleaks](https://img.shields.io/badge/secret%20scan-gitleaks-informational.svg)](./.github/workflows/gitleaks.yml)

</div>

---

## What is GenesisPod?

GenesisPod is a full-stack platform for building and running **AI research and
multi-agent workflows** in production. It ships a complete product surface — deep
research, multi-agent orchestration, document/slide generation, long-form
writing, RAG and knowledge graphs — on top of a strictly layered, **architecture-
governed** backend.

It is **fully open source under AGPL-3.0**, with a [commercial license](./COMMERCIAL-LICENSE.md)
available for closed-source and SaaS use.

### Why another AI platform?

The differentiator is **architectural discipline you can verify**. Most agent
frameworks rot into a tangle of cross-imports within a year. GenesisPod enforces
its 5-layer boundaries (`open-api → ai-app → ai-harness → ai-engine → platform`)
through three independent gates — ESLint rules, a jest architecture-spec suite,
and a pre-push + CI merge gate — so the structure stays sound as the codebase
grows. The architecture compliance is **machine-checked on every push**, not a
diagram in a wiki that drifts from reality.

## Features

- **AI Research** — multi-step planning, source gathering, and report generation.
- **Agent Playground** — multi-agent mission orchestration with live tracing,
  token/cost accounting, and structured report artifacts.
- **AI Ask / Insights** — multi-model Q&A and topic insights.
- **AI Office / Slides / Writing / Social** — document, presentation, long-form,
  and social content generation.
- **Library / RAG / Knowledge Graph** — ingestion, retrieval, and knowledge
  consolidation.
- **BYOK & multi-provider** — OpenAI, Anthropic, Gemini, Grok, DeepSeek, and any
  LiteLLM-compatible provider, with a first-class secrets module.
- **Admin** — model, tool, secrets, data-source, and system management.

## Architecture

A monorepo with three runtimes:

| Package       | Stack                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| `frontend/`   | Next.js 14, React 18, TypeScript, Tailwind, Zustand, SWR, TanStack Query |
| `backend/`    | NestJS 10, Prisma, PostgreSQL 16, Redis 7, Socket.IO                     |
| `ai-service/` | FastAPI (auxiliary AI service)                                           |

The backend is layered into five top-level modules with a **strict one-way
dependency direction** (each layer may depend only on the ones below it):

```
open-api    →  external / admin / MCP surface          (L4)
ai-app      →  business applications (research, teams, office, writing, ...)  (L3)
ai-harness  →  multi-agent runtime, lifecycle, evaluation, protocols          (L2.5)
ai-engine   →  reusable AI primitives (LLM, tools, RAG, knowledge, planning)  (L2)
platform    →  auth, credentials/secrets, storage, credits, notifications     (L1)
```

The L1 directory is `backend/src/modules/platform/` (its conceptual layer name
is "ai-infra"). `ai-app` reaches the lower layers only through their facades;
`ai-harness` may use `ai-engine` but `ai-engine` never imports `ai-harness`. See
[`STRUCTURE.md`](./STRUCTURE.md) for the full map.

## Quick start

### Requirements

- Node.js `>= 20`, npm `>= 9`
- Docker / Docker Compose
- At least one model provider API key (e.g. `OPENAI_API_KEY`)

### Run it

```bash
# 1. Install
npm install

# 2. Configure — copy the template and fill in your keys (never commit .env)
cp .env.example .env

# 3. Start infrastructure (postgres + redis + flaresolverr)
npm run db:setup

# 4. Initialize the database
cd backend
npm run prisma:generate && npm run prisma:migrate && npm run prisma:seed
cd ..

# 5. Start the full stack
npm run dev
```

Default ports: frontend `http://localhost:3000`, backend `http://localhost:3001`,
AI service `http://localhost:5000`.

Run a single side with `npm run dev:frontend` / `dev:backend` / `dev:ai`.

### Minimum environment variables

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, and one provider key
(`OPENAI_API_KEY` or another). For login, storage, and integrations see
`.env.example`.

## Development

| Command               | Purpose                      |
| --------------------- | ---------------------------- |
| `npm run dev`         | full-stack dev               |
| `npm run type-check`  | TypeScript check             |
| `npm run test:quick`  | fast tests                   |
| `npm run verify:arch` | architecture-boundary checks |
| `npm run verify:full` | lint + type + test + build   |
| `npm run e2e`         | Playwright end-to-end        |

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR.

## License

GenesisPod is **dual-licensed**:

- **[AGPL-3.0](./LICENSE)** for open-source and self-hosted use. Note: AGPL
  treats network use as distribution — if you run a modified version as a
  service, you must publish your source changes.
- **[Commercial license](./COMMERCIAL-LICENSE.md)** for closed-source products,
  proprietary SaaS, or when you need warranty/SLA/indemnity. Contact
  **hello@gens.team**.

Not sure which you need? See the [decision table](./COMMERCIAL-LICENSE.md#which-one-do-i-need-quick-guide).

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and
note that a one-time [CLA](./CLA.md) signature is required (automated via a bot
on your first PR) — this is what keeps the dual-license model possible.

## Security

Found a vulnerability? **Do not** open a public issue — see [`SECURITY.md`](./SECURITY.md).
