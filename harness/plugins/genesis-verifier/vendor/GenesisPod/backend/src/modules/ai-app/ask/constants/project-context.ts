/**
 * GenesisPod 项目上下文
 * 内置项目信息，让 AI Ask 能够回答关于本项目的问题
 */

import { APP_CONFIG } from "@/common/config/app.config";

export const GENESIS_AI_CONTEXT = `
## ${APP_CONFIG.brand.fullName} (AI Teams Engine) 项目概述

**${APP_CONFIG.brand.fullName}** 是一个企业级 AI 深度研究和内容管理平台。
核心价值是帮助用户高效获取、整理、分析和生成高质量内容，通过多 Agent 协作完成复杂任务。

### 技术栈
- **前端**: Next.js 14 (App Router) + TypeScript + Zustand + TailwindCSS + shadcn/ui
- **后端**: NestJS 10 + Prisma ORM + PostgreSQL（统一数据库架构）
- **AI**: LiteLLM (多模型统一接口) + OpenAI/Claude/Grok/Gemini/DeepSeek
- **基础设施**: Docker + Railway + PM2

### 核心功能模块

| 模块 | 功能描述 | 路径 |
|------|----------|------|
| **AI Ask** | 智能问答，支持多模型切换、RAG、工具调用 | \`ai-app/ask/\` |
| **AI Research** | 深度研究平台，含 4 个子模块 | \`ai-app/research/\` |
| **AI Teams** | 多 Agent 协作，辩论碰撞，观点交锋 | \`ai-app/teams/\` |
| **AI Office** | AI 办公套件，PPT/文档/设计生成 | \`ai-app/office/\` |
| **AI Writing** | AI 写作助手，长文本创作 | \`ai-app/writing/\` |
| **AI Image** | AI 图像生成 | \`ai-app/image/\` |
| **AI Social** | AI 社交内容生成，多平台适配 | \`ai-app/social/\` |
| **AI Simulation** | AI 模拟仿真 | \`ai-app/simulation/\` |
| **Library** | 资源库，统一内容管理 | \`content/resources/\` |
| **Collections** | 收藏集，AI 标签/分类/聚类/摘要 | \`content/collections/\` |
| **Notes** | 笔记，AI 解释/要点提取/关联发现/总结 | \`content/notes/\` |
| **Explore** | 内容发现与推荐 | \`content/explore/\` |
| **Knowledge Graph** | 知识图谱 | \`content/knowledge-graph/\` |

### AI Research 子模块

| 子模块 | 描述 |
|--------|------|
| **Deep Research** | 深度研究，多步骤规划、多维度分析、报告生成 |
| **Topic Research** | 主题研究，维度拆解、多轮调研、章节写作、报告综合 |
| **Notebook Research** | 笔记本研究，交互式研究对话 |
| **Fast Research** | 快速研究，轻量级即时回答 |

### 项目结构

\`\`\`
genesis-ai/
├── frontend/                 # Next.js 前端
│   ├── app/                  # App Router 页面
│   │   ├── ai-ask/           # AI 问答
│   │   ├── ai-research/      # AI 研究
│   │   ├── ai-teams/         # AI 团队
│   │   ├── ai-office/        # AI 办公
│   │   ├── ai-writing/       # AI 写作
│   │   ├── ai-image/         # AI 图像
│   │   ├── ai-social/        # AI 社交
│   │   ├── ai-simulation/    # AI 模拟
│   │   ├── library/          # 资源库
│   │   ├── explore/          # 探索发现
│   │   ├── knowledge-graph/  # 知识图谱
│   │   └── admin/            # 管理后台
│   ├── components/           # React 组件
│   ├── hooks/                # React Hooks (core/domain/features)
│   ├── stores/               # Zustand 状态管理
│   └── lib/                  # 工具库
│
├── backend/                  # NestJS 后端
│   └── src/
│       └── modules/
│           ├── ai-engine/    # AI 引擎核心
│           │   ├── facade/   # 统一入口 (AIFacade)
│           │   ├── llm/      # LLM 适配层
│           │   ├── skills/   # 可复用技能
│           │   ├── agents/   # Agent 框架
│           │   ├── teams/    # 多 Agent 协作
│           │   ├── tools/    # 工具调用
│           │   ├── orchestration/ # 任务编排
│           │   ├── memory/   # 对话记忆
│           │   ├── mcp/      # Model Context Protocol
│           │   ├── capabilities/ # 能力声明
│           │   ├── constraint/   # 约束管理
│           │   ├── rag/      # 检索增强生成
│           │   ├── search/   # 搜索集成
│           │   ├── image/    # 图像生成
│           │   └── long-content/ # 长文本处理
│           ├── ai-app/       # AI 应用模块
│           │   ├── ask/      # AI Ask
│           │   ├── research/ # AI Research (deep/topic/notebook/fast)
│           │   ├── teams/    # AI Teams
│           │   ├── office/   # AI Office
│           │   ├── writing/  # AI Writing
│           │   ├── image/    # AI Image
│           │   ├── social/   # AI Social
│           │   ├── simulation/ # AI Simulation
│           │   └── rag/      # RAG 应用
│           ├── content/      # 内容管理
│           │   ├── resources/      # 资源库 (Library)
│           │   ├── collections/    # 收藏集
│           │   ├── notes/          # 笔记
│           │   ├── explore/        # 探索发现
│           │   ├── knowledge-graph/ # 知识图谱
│           │   ├── workspace/      # 工作区
│           │   ├── recommendations/ # 推荐
│           │   ├── reports/        # 报告
│           │   └── feed/           # 信息流
│           ├── ingestion/    # 数据采集 (多源爬取)
│           ├── credits/      # 积分系统 (计费与配额)
│           ├── core/         # 核心模块 (auth, admin, users)
│           ├── integrations/ # 外部集成
│           └── webhooks/     # Webhook
│
└── docs/                     # 文档
\`\`\`

### AI 架构分层

\`\`\`
AI Engine（核心能力层）→ LLM、工具、Agent、技能、记忆、RAG、MCP
     ↓
AI Teams（协作机制层）→ 多 Agent 协作框架
     ↓
AI Apps（应用层）→ Ask / Research / Teams / Office / Writing / Image / Social / Simulation
\`\`\`

### 关键技术组件

#### AI Engine (ai-engine/)
AI 引擎是整个系统的核心，提供：
- **AIFacade**: 统一入口，所有 AI 调用通过此门面
- **LLM 适配器**: 统一接口调用 OpenAI/Claude/Gemini/Grok/DeepSeek
- **Agent 框架**: 基础 Agent 类、Agent Registry、生命周期管理
- **Teams 框架**: 多 Agent 协作，角色分工、任务分解
- **Skills 系统**: 可复用技能模块（任务分解、大纲规划、质量审计等）
- **RAG 管道**: 文档分块、向量化、检索增强生成
- **Tools**: Function Calling 工具调用执行器
- **Memory**: 对话记忆与上下文管理
- **MCP**: Model Context Protocol 支持
- **Orchestration**: 任务编排与流程控制
- **Capabilities/Constraints**: 能力声明与约束管理

#### 积分系统 (credits/)
- **BillingContext**: 基于 AsyncLocalStorage 的计费上下文传播
- **CreditRules**: 按模块和操作类型配置扣费规则
- **交易类型**: AI_ASK, AI_TEAMS, AI_OFFICE, AI_SIMULATION, AI_WRITING, AI_IMAGE, AI_SOCIAL, AI_RESEARCH, AI_INSIGHTS, NOTEBOOK_RESEARCH, AI_PLANNING, LIBRARY, NOTES, COLLECTIONS

### 项目特色

1. **多模型支持**: 通过 AI Engine 统一接入 OpenAI/Claude/Gemini/Grok/DeepSeek
2. **多 Agent 协作**: Teams 框架支持多角色协同完成复杂任务
3. **深度研究**: 4 种研究模式（深度/主题/笔记本/快速）
4. **知识库增强**: RAG 技术让 AI 基于私有知识回答
5. **实时流式输出**: SSE 技术实现打字机效果
6. **积分系统**: 按模块按操作精细化计费和配额管理
7. **企业级架构**: 模块化、分层设计、可扩展
8. **统一数据库**: PostgreSQL + Prisma ORM，简洁高效
`;

/**
 * 项目相关问题的关键词
 */
export const PROJECT_KEYWORDS = [
  "deepdive",
  "deep dive",
  "engine",
  "genesis",
  "项目",
  "代码",
  "代码库",
  "codebase",
  "架构",
  "技术栈",
  "模块",
  "ai-engine",
  "ai engine",
  "ai-office",
  "ai office",
  "ai-ask",
  "ai ask",
  "ai-research",
  "ai research",
  "ai-teams",
  "ai teams",
  "ai-writing",
  "ai writing",
  "ai-image",
  "ai image",
  "ai-social",
  "ai social",
  "ai-simulation",
  "ai simulation",
  "deep research",
  "topic research",
  "notebook research",
  "slides",
  "ppt",
  "知识库",
  "knowledge graph",
  "知识图谱",
  "rag",
  "积分",
  "credits",
  "nestjs",
  "next.js",
  "nextjs",
  "prisma",
  "zustand",
  "前端",
  "后端",
  "frontend",
  "backend",
  "collections",
  "收藏",
  "notes",
  "笔记",
  "library",
  "资源库",
];

/**
 * 检查问题是否与项目相关
 */
export function isProjectRelatedQuery(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  return PROJECT_KEYWORDS.some((keyword) =>
    lowerQuery.includes(keyword.toLowerCase()),
  );
}
