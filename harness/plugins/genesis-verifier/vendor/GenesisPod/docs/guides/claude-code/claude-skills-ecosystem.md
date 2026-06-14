# Claude Skills 生态分析

> Agent Skills 开放标准的生态系统、核心逻辑和发展趋势。

---

## 核心生态逻辑

```
┌─────────────────────────────────────────────────────────────────┐
│                    开放标准 (agentskills.io)                     │
│                  "Write Once, Use Everywhere"                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   ┌─────────┐        ┌──────────┐        ┌──────────┐
   │Anthropic│        │  OpenAI  │        │ 其他平台  │
   │ Claude  │        │  Codex   │        │ Cursor   │
   │ Code    │        │ ChatGPT  │        │ VS Code  │
   └────┬────┘        └────┬─────┘        │ Gemini   │
        │                  │              │ Goose    │
        └──────────────────┼──────────────┘
                           │
                    ┌──────▼──────┐
                    │  SKILL.md   │
                    │  统一格式    │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐       ┌──────────┐       ┌──────────┐
   │官方 Skills│      │社区市场   │       │企业私有   │
   │ Anthropic│      │ SkillsMP │       │ 内部 Skills│
   │ Partners │      │ GitHub   │       └──────────┘
   └─────────┘       └──────────┘
```

**核心理念**：通过开放标准统一 AI Agent 的能力扩展方式，实现"一次编写，多平台运行"。

---

## 生态现状

| 维度         | 状态                                           |
| ------------ | ---------------------------------------------- |
| **标准采纳** | OpenAI、Microsoft、Cursor、Gemini 等已采用     |
| **合作伙伴** | Atlassian、Figma、Canva、Stripe、Zapier 等 10+ |
| **社区评价** | Simon Willison："可能比 MCP 更重要"            |
| **市场规模** | SkillsMP 已索引 9000+ DevOps skills            |

---

## 三层生态结构

### 1. 标准层 - 统一接口

```yaml
# 一次编写，多平台运行
---
name: My Skill
description: Does something useful
---
Instructions here...
```

- **开放标准**：[agentskills.io](https://agentskills.io/home)
- **格式简单**：Markdown + YAML，无需复杂工具链
- **跨平台**：Claude、Codex、Cursor、VS Code 通用

### 2. 平台层 - 多端支持

| 平台         | Skills 位置       | 状态      |
| ------------ | ----------------- | --------- |
| Claude Code  | `.claude/skills/` | ✅ 官方   |
| OpenAI Codex | `.codex/skills/`  | ✅ 已采用 |
| VS Code      | 内置支持          | ✅ 已采用 |
| Cursor       | 原生支持          | ✅ 已采用 |
| Gemini CLI   | 支持中            | ✅ 已采用 |
| GitHub       | 原生支持          | ✅ 已采用 |
| Goose        | 支持中            | ✅ 已采用 |
| Amp          | 支持中            | ✅ 已采用 |
| OpenCode     | 支持中            | ✅ 已采用 |

### 3. 内容层 - 技能来源

```
官方 Skills (Anthropic)
├── 文档处理 (docx, pdf, pptx, xlsx)
├── 设计创意 (canvas-design, algorithmic-art)
└── 开发工具 (mcp-builder, webapp-testing)

合作伙伴 Skills
├── Atlassian (Jira, Confluence)
├── Figma (设计协作)
├── Stripe (支付集成)
└── Zapier (自动化)

社区 Skills
├── SkillsMP 市场 (9000+ indexed)
├── GitHub 仓库 (80+ curated collections)
└── 个人/团队自建
```

---

## 核心竞争逻辑

### 1. 网络效应

```
更多平台采用 → 更多开发者贡献 → 更丰富的 Skills → 更多平台采用
     ↑                                                    │
     └────────────────────────────────────────────────────┘
```

### 2. 锁定策略（反向锁定）

| 传统策略 | Anthropic 策略           |
| -------- | ------------------------ |
| 锁定用户 | 开放标准，用户可迁移     |
| 专有格式 | 通用格式，竞争者被迫兼容 |
| 封闭生态 | 开放生态，成为事实标准   |

**结果**：不锁定用户，但锁定整个生态。竞争者（OpenAI、Google）被迫采用相同标准。

### 3. 企业价值链

```
组织知识 → 封装为 Skills → 版本控制 → 团队复用 → 提升效率
    │                                              │
    └──────────── 知识资产化 ◄─────────────────────┘
```

---

## 与 MCP 的关系

| 维度         | MCP (Model Context Protocol) | Skills                 |
| ------------ | ---------------------------- | ---------------------- |
| **定位**     | 工具连接协议                 | 知识/工作流封装        |
| **复杂度**   | 需要服务端实现               | 纯 Markdown 文件       |
| **用途**     | 连接外部 API/数据库/工具     | 封装专业知识/流程      |
| **开发成本** | 较高（需编程）               | 极低（写文档）         |
| **关系**     | 互补，非竞争                 | Skills 可调用 MCP 工具 |

**Simon Willison 的观点**：

> "Skills 可能比 MCP 更重要 - 它们更简单，更容易被采纳。任何能读取文件系统的 LLM 工具都可以使用它们。"

### 协同工作模式

```
┌─────────────────────────────────────────────────────────┐
│  SKILL.md                                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 指令：使用 Jira MCP 创建任务                      │   │
│  │ 步骤：1. 查询项目 2. 创建 Issue 3. 分配成员       │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│                          ▼                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │ MCP Server: Jira Integration                     │   │
│  │ Tools: create_issue, assign_user, query_project  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 对不同角色的价值

### 对 Skill 开发者

| 价值               | 说明                                       |
| ------------------ | ------------------------------------------ |
| 一次构建，多处部署 | 同一 Skill 可用于 Claude、Codex、Cursor 等 |
| 低门槛             | 只需 Markdown，无需复杂编程                |
| 开源分发           | 通过 GitHub 免费分发                       |
| 商业机会           | 企业级 Skills 可商业化                     |

### 对平台/Agent

| 价值         | 说明                      |
| ------------ | ------------------------- |
| 即插即用能力 | 用户可自行扩展 Agent 能力 |
| 减少开发成本 | 复用社区 Skills           |
| 生态竞争力   | 支持开放标准 = 更大生态   |

### 对企业/团队

| 价值       | 说明                       |
| ---------- | -------------------------- |
| 知识资产化 | 组织知识封装为可复用资产   |
| 版本控制   | Git 管理，可追溯           |
| 团队协作   | 共享最佳实践               |
| 一致性     | 跨成员、跨项目保持一致行为 |

---

## 生态发展预测

### 短期（3-6 个月）

1. **标准化市场**：类似 npm/pip 的 Skills 包管理器
2. **质量评级**：星级评分、下载量、安全审计
3. **依赖管理**：Skills 之间的依赖声明和解析
4. **版本控制**：语义化版本，兼容性管理

### 中期（6-12 个月）

1. **企业目录**：私有 Skills 市场，组织知识资产化
2. **IDE 深度集成**：VS Code/Cursor 原生 Skills 浏览器
3. **认证体系**：官方认证的高质量 Skills
4. **商业模式**：付费 Skills、企业订阅

### 长期（1-2 年）

1. **行业标准库**：医疗、法律、金融等垂直领域
2. **AI 原生工作流**：基于 Skills 的自动化流水线
3. **跨 Agent 协作**：不同 Agent 通过 Skills 协同

---

## 对开发者的意义

```
┌─────────────────────────────────────────────────────────┐
│  投资 Skills 开发 = 投资跨平台 AI 能力                    │
│                                                         │
│  ✅ 一次编写，多平台运行                                  │
│  ✅ 简单的 Markdown 格式，低门槛                          │
│  ✅ 可版本控制，可团队协作                                │
│  ✅ 开放标准，无供应商锁定                                │
│  ✅ 社区生态，持续增长                                    │
└─────────────────────────────────────────────────────────┘
```

### 建议行动

1. **学习标准**：熟悉 SKILL.md 格式规范
2. **创建项目 Skills**：将团队知识封装为 Skills
3. **参与社区**：贡献到 GitHub、SkillsMP
4. **关注发展**：跟踪 [agentskills.io](https://agentskills.io) 标准演进

---

## 资源链接

### 官方资源

- [Agent Skills 开放标准](https://agentskills.io/home)
- [Anthropic Skills 仓库](https://github.com/anthropics/skills)
- [OpenAI Skills 仓库](https://github.com/openai/skills)
- [Anthropic 官方博客](https://claude.com/blog/skills)

### 文档指南

- [Claude Code Skills 文档](https://code.claude.com/docs/en/skills)
- [OpenAI Codex Skills 文档](https://developers.openai.com/codex/skills)
- [OpenCode Skills 文档](https://opencode.ai/docs/skills/)

### 社区市场

- [SkillsMP 市场](https://skillsmp.com/)
- [Awesome Agent Skills](https://github.com/heilcheng/awesome-agent-skills)
- [Awesome Claude Skills](https://github.com/travisvn/awesome-claude-skills)

### 分析文章

- [VentureBeat: Anthropic launches enterprise Agent Skills](https://venturebeat.com/ai/anthropic-launches-enterprise-agent-skills-and-opens-the-standard)
- [Simon Willison: OpenAI adopting skills](https://simonwillison.net/2025/Dec/12/openai-skills/)
- [Claude Skills Deep Dive](https://mikhail.io/2025/10/claude-code-skills/)

---

## 相关文档

- [Claude Skills 完整指南](./claude-skills-guide.md) - 开发方式、安装方法、最佳实践

---

**最后更新**: 2025-01-11
