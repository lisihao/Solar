# 14 - Skills 开发规范 | Skills Development Standard

> **优先级**: 🔴 MUST
> **更新日期**: 2026-02-08
> **适用范围**: 所有 AI Engine / AI App 中的 Skill 文件
> **对齐标准**: [Agent Skills Specification (agentskills.io)](https://agentskills.io/specification), MCP Tool Definition, OpenAI Function Calling

---

## 目录

1. [概述](#1-概述)
2. [业界标准对齐](#2-业界标准对齐)
3. [文件格式规范](#3-文件格式规范)
4. [目录结构规范](#4-目录结构规范)
5. [Frontmatter 字段规范](#5-frontmatter-字段规范)
6. [Content Body 规范](#6-content-body-规范)
7. [命名规范](#7-命名规范)
8. [执行模式规范](#8-执行模式规范)
9. [脚本规范](#9-脚本规范)
10. [输入输出规范](#10-输入输出规范)
11. [解析器行为规范](#11-解析器行为规范)
12. [现状合规审计](#12-现状合规审计)
13. [改造计划](#13-改造计划)
14. [检查清单](#14-检查清单)

---

## 1. 概述

### 1.1 什么是 Skill

Skill 是 AI Engine 中的**可复用能力单元**，通过 SKILL.md 文件声明式定义，由 SkillMdRuntime 自动转为可执行的 ISkill 实例。

### 1.2 为什么需要规范

当前系统存在三种互不兼容的 Skill 格式：

| 格式                         | 位置                      | 数量 | 问题                                    |
| ---------------------------- | ------------------------- | ---- | --------------------------------------- |
| `.skill.md`（扁平文件）      | writing/, topic-insights/ | 20   | 自定义格式，与 Claude Code 官方规范偏离 |
| `.skill.ts`（TypeScript 类） | office/slides/            | 21   | 硬编码，解析器不可见，无法配置扩展      |
| `SKILL.md`（目录结构）       | .claude/skills/           | 36   | Claude Code 官方格式，但仅用于开发辅助  |

**本规范统一所有 Skill 为一种格式，与业界标准对齐。**

### 1.3 规范适用对象

- `backend/src/modules/ai-app/*/skills/` 下的所有业务 Skill
- `backend/src/modules/ai-engine/skills/` 中的解析器和运行时
- 未来新增的任何 Skill

---

## 2. 业界标准对齐

### 2.1 对齐的标准

| 标准                        | 来源                                                                                       | 我们采纳的部分                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **Agent Skills Spec**       | [agentskills.io](https://agentskills.io/specification) (Anthropic, 2025-12)                | 文件格式、目录结构、`name` + `description` 必填、渐进式加载          |
| **MCP Tool Definition**     | [modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2025-11-25)        | `inputSchema` / `outputSchema` 用 JSON Schema、工具命名 snake_case   |
| **OpenAI Function Calling** | [platform.openai.com](https://platform.openai.com/docs/guides/function-calling)            | JSON Schema draft 2020-12、strict mode `additionalProperties: false` |
| **Semantic Kernel**         | [learn.microsoft.com](https://learn.microsoft.com/en-us/semantic-kernel/concepts/plugins/) | snake_case 函数名、参数必须有 description                            |
| **SemVer 2.0**              | [semver.org](https://semver.org/)                                                          | 版本号 MAJOR.MINOR.PATCH                                             |

### 2.2 命名约定业界共识

| 元素               | 业界共识                                                | 本项目采纳                                   |
| ------------------ | ------------------------------------------------------- | -------------------------------------------- |
| Skill 目录名       | kebab-case（Agent Skills Spec）                         | kebab-case                                   |
| Skill ID / `name`  | kebab-case（Agent Skills Spec）                         | kebab-case                                   |
| 脚本内函数名       | snake_case（OpenAI / SK / LangChain 共识）              | 采纳 snake_case                              |
| 脚本内参数名       | snake_case（全框架共识，因 LLM 训练语料以 Python 为主） | 采纳 snake_case                              |
| JSON Schema 属性名 | camelCase（JS/TS 生态）或 snake_case（Python 生态）     | 采纳 camelCase（与现有 TypeScript 代码一致） |

### 2.3 JSON Schema 版本

**采纳 JSON Schema draft 2020-12**。

原因：Anthropic API 严格要求 2020-12，OpenAI 也兼容。使用更高版本可避免跨平台兼容问题。

---

## 3. 文件格式规范 🔴 MUST

### 3.1 唯一文件格式：SKILL.md

所有 Skill **必须**使用 `SKILL.md` 文件定义。

```
skill-name/
└── SKILL.md          # 必需，固定文件名
```

**禁止**：

- ❌ `*.skill.md`（扁平文件命名）— 必须改为 `skill-name/SKILL.md`
- ❌ `*.skill.ts`（TypeScript 硬编码）— 必须迁移为 SKILL.md + 可选 scripts/
- ❌ 任何不含 YAML frontmatter 的 `.skill.md` 文件

### 3.2 文件结构

```markdown
---
# YAML Frontmatter（元数据声明层）
name: skill-name
description: What this skill does and when to use it
# ... 更多字段
---

# Skill 标题

Markdown 内容体（指令层）
用于 prompt 模式的系统提示词，或 script 模式的文档说明
```

### 3.3 文件大小限制

| 限制            | 值       | 原因                                   |
| --------------- | -------- | -------------------------------------- |
| SKILL.md 总行数 | < 500 行 | Agent Skills Spec 建议，约 5000 tokens |
| Frontmatter     | < 100 行 | 元数据应简洁                           |
| Content Body    | < 400 行 | 超长内容移到 references/               |

---

## 4. 目录结构规范 🔴 MUST

### 4.1 Skill 目录结构

每个 Skill 是一个**独立目录**，目录名即 Skill ID：

```
{skill-id}/
├── SKILL.md              # 必需：元数据 + 指令
├── scripts/              # 可选：script/hybrid 模式的可执行代码
│   ├── execute.ts        # 入口文件（scriptEntry 指向此处）
│   └── helpers/          # 辅助模块（大型脚本拆分用）
└── references/           # 可选：补充文档（渐进式加载）
    └── examples.md       # 详细示例、Few-shot 等
```

### 4.2 模块内 Skills 目录

Skills 目录位于 AI App 模块的 `skills/` 子目录下：

```
backend/src/modules/ai-app/{module}/skills/
├── {skill-id-1}/
│   └── SKILL.md
├── {skill-id-2}/
│   ├── SKILL.md
│   └── scripts/
│       └── execute.ts
└── {skill-id-3}/
    ├── SKILL.md
    └── references/
        └── examples.md
```

### 4.3 各模块 Skills 路径

| 模块        | Skills 路径                    | domain 值  |
| ----------- | ------------------------------ | ---------- |
| AI Writing  | `ai-app/writing/skills/`       | `writing`  |
| AI Insights | `ai-app/insight/skills/`       | `research` |
| AI Slides   | `ai-app/office/slides/skills/` | `office`   |
| 未来模块    | `ai-app/{module}/skills/`      | `{module}` |

---

## 5. Frontmatter 字段规范

### 5.1 官方字段（Agent Skills Spec 定义）🔴 MUST

这些字段与 Agent Skills Spec 完全对齐，**必须正确使用**：

| 字段          | 类型   | 必填  | 约束                                  | 说明               |
| ------------- | ------ | ----- | ------------------------------------- | ------------------ |
| `name`        | string | 🔴 是 | 1-64 字符，kebab-case，匹配目录名     | Skill 唯一标识符   |
| `description` | string | 🔴 是 | 1-1024 字符，**英文**，包含触发关键词 | 描述能力和何时使用 |

```yaml
# 正确
name: outline-planning
description: Generate structured page outlines for presentations based on task decomposition results

# 错误
name: OutlinePlanning          # ❌ 不是 kebab-case
name: slides-outline-planning  # ❌ 不要加 domain 前缀（用 domain 字段区分）
description: 大纲规划           # ❌ 必须用英文（LLM 匹配准确度更高）
```

### 5.2 官方可选字段 🟡 SHOULD

| 字段            | 类型     | 默认值   | 说明                                             |
| --------------- | -------- | -------- | ------------------------------------------------ |
| `allowed-tools` | string[] | 无限制   | 限制可用工具列表（空格分隔或 YAML 数组）         |
| `model`         | string   | 当前模型 | 指定 LLM 模型（如 `claude-sonnet-4-5-20250929`） |
| `license`       | string   | -        | 许可证（如 `Apache-2.0`）                        |
| `compatibility` | string   | -        | 环境要求（最大 500 字符）                        |
| `metadata`      | object   | -        | 自定义键值对容器                                 |

### 5.3 扩展字段（本项目定义）

扩展字段放在 `metadata` 容器内或作为顶层字段。为保持与官方 spec 的兼容性，**业务扩展字段统一放在顶层**（解析器同时支持两种位置）。

#### 5.3.1 必填扩展字段 🔴 MUST

| 字段        | 类型        | 约束                                                       | 说明                                           |
| ----------- | ----------- | ---------------------------------------------------------- | ---------------------------------------------- |
| `version`   | string      | SemVer 格式 `X.Y.Z`                                        | 版本号，遵循 [SemVer 2.0](https://semver.org/) |
| `domain`    | SkillDomain | `writing` \| `research` \| `office` \| `general` \| 自定义 | 所属业务领域                                   |
| `layer`     | SkillLayer  | 见 5.3.3                                                   | 执行层级（替代旧的数字 layer）                 |
| `taskTypes` | string[]    | 至少一项，禁止默认 `["*"]`                                 | 适用的任务类型列表                             |

```yaml
# 正确
version: "1.2.0"
domain: office
layer: planning
taskTypes: [slides-generation, presentation-planning]

# 错误
version: "1.0"           # ❌ 必须三段式 X.Y.Z
domain: slides            # ❌ 应该用 office（slides 是 office 的子场景）
taskTypes: ["*"]          # ❌ 禁止通配符，必须显式声明
```

#### 5.3.2 可选扩展字段 🟡 SHOULD

| 字段           | 类型                                  | 默认值  | 说明                     |
| -------------- | ------------------------------------- | ------- | ------------------------ |
| `priority`     | number                                | 50      | 0-100，数字越大越优先    |
| `author`       | string                                | -       | 作者标识                 |
| `source`       | `local` \| `skillsmp` \| `custom-url` | `local` | 来源类型                 |
| `tags`         | string[]                              | `[]`    | 分类标签，用于搜索和过滤 |
| `tokenBudget`  | number                                | -       | 估算的 token 消耗        |
| `enabled`      | boolean                               | `true`  | 是否启用                 |
| `dependencies` | string[]                              | `[]`    | 依赖的其他 Skill name    |

#### 5.3.3 layer 值定义

| 值              | 执行顺序 | 说明                 | 示例 Skills                           |
| --------------- | -------- | -------------------- | ------------------------------------- |
| `understanding` | 1        | 意图分析、内容理解   | content-analyzer, task-decomposition  |
| `planning`      | 2        | 大纲规划、结构设计   | outline-planning, slide-thinking      |
| `design`        | 3        | 模板选择、布局设计   | template-matcher, page-type-selection |
| `content`       | 4        | 内容生成、压缩、补充 | content-compression, data-supplement  |
| `rendering`     | 5        | 模板渲染、图表生成   | template-rendering, chart-renderer    |
| `optimization`  | 6        | 布局优化、术语统一   | layout-optimizer, terminology-unifier |
| `quality`       | 7        | 质量审核、一致性检查 | quality-audit, fact-checker           |

### 5.4 Runtime 字段（SkillMdRuntime 专用）

| 字段             | 类型                             | 默认值    | 说明                                         |
| ---------------- | -------------------------------- | --------- | -------------------------------------------- |
| `executionMode`  | `prompt` \| `script` \| `hybrid` | 自动推断  | 执行模式（见第 8 节）                        |
| `scriptEntry`    | string                           | -         | 脚本入口路径，相对于 SKILL.md                |
| `outputKey`      | string                           | 同 `name` | SkillOutputManager 存储键                    |
| `taskProfile`    | object                           | -         | LLM 调用参数                                 |
| `outputSchema`   | object                           | -         | 输出 JSON Schema（draft 2020-12）            |
| `inputSchema`    | object                           | -         | 输入 JSON Schema                             |
| `inputs`         | object                           | -         | 声明式输入绑定（从 SkillOutputManager 读取） |
| `outputs`        | object                           | -         | 声明式输出绑定                               |
| `requiredSkills` | string[]                         | -         | 前置依赖 Skills                              |
| `requiredTools`  | string[]                         | -         | 需要的 Tools                                 |

### 5.5 完整 Frontmatter 示例

```yaml
---
# === Agent Skills Spec 官方字段 ===
name: outline-planning
description: >-
  Generate structured page outlines for slide presentations.
  Triggered when task decomposition is complete and page structure needs planning.
  Produces per-page titles, key points, visual suggestions, and speaker notes.

# === 扩展必填字段 ===
version: "1.0.0"
domain: office
layer: planning
taskTypes: [slides-generation, presentation-planning]

# === 扩展可选字段 ===
priority: 90
author: genesis-ai
source: local
tags: [slides, outline, planning, structure]
tokenBudget: 2000
enabled: true
dependencies: [task-decomposition]

# === Runtime 字段 ===
executionMode: prompt
outputKey: outline-planning
taskProfile:
  creativity: medium
  outputLength: long
inputs:
  taskDecomposition:
    from: task-decomposition
    required: true
requiredSkills:
  - task-decomposition
outputSchema:
  type: object
  required: [pages]
  properties:
    title:
      type: string
    pages:
      type: array
      items:
        type: object
        required: [pageIndex, title, keyPoints]
        properties:
          pageIndex: { type: integer }
          title: { type: string }
          keyPoints:
            type: array
            items: { type: string }
          visualSuggestion: { type: string }
          speakerNotes: { type: string }
        additionalProperties: false
  additionalProperties: false
---
```

---

## 6. Content Body 规范

### 6.1 结构模板 🟡 SHOULD

SKILL.md 的 Markdown 内容体应遵循以下结构：

```markdown
# {Skill 中文名称}

## Role

明确定义 AI 在此 Skill 中的角色。

## Core Principles

列出核心工作原则（3-7 条）。

## Constraints

列出禁止事项和边界条件。

## Output Format

说明输出格式要求（如有 outputSchema 可省略此节）。

## Context Variables

{{#if contextVar}}
条件注入的上下文信息。
{{{contextVar}}}
{{/if}}
```

### 6.2 模板变量 🟡 SHOULD

使用 Handlebars 语法注入动态上下文：

```markdown
{{#if systemPrompt}}

## System Context

{{{systemPrompt}}}
{{/if}}

{{#if previousOutput}}

## Previous Step Output

{{{previousOutput}}}
{{/if}}
```

**规则**：

- 使用三花括号 `{{{var}}}` 输出原始 HTML/Markdown（不转义）
- 使用双花括号 `{{var}}` 输出转义文本
- 条件块用 `{{#if var}}...{{/if}}`
- 变量名用 camelCase

### 6.3 语言要求

| 位置               | 语言            | 原因                       |
| ------------------ | --------------- | -------------------------- |
| `name` 字段        | 英文 kebab-case | 标识符，程序处理           |
| `description` 字段 | **英文**        | LLM 触发匹配准确度         |
| Content Body       | 中文或英文      | 系统提示词，LLM 理解无障碍 |
| `tags`             | 英文            | 搜索和分类                 |
| 代码注释           | 英文            | 与代码风格规范一致         |

---

## 7. 命名规范 🔴 MUST

### 7.1 Skill ID（`name` 字段）

| 规则                 | 说明                   | 示例                                                 |
| -------------------- | ---------------------- | ---------------------------------------------------- |
| kebab-case           | 小写字母 + 连字符      | `outline-planning`                                   |
| 1-64 字符            | Agent Skills Spec 限制 |                                                      |
| 无 domain 前缀       | 用 `domain` 字段区分   | `outline-planning`（不是 `slides-outline-planning`） |
| 目录名一致           | 目录名 = `name` 值     | `outline-planning/SKILL.md`                          |
| 无连续连字符         | `a--b` 不合法          |                                                      |
| 不以连字符开头或结尾 | `-name-` 不合法        |                                                      |

```
# 正确
outline-planning
content-compression
template-rendering

# 错误
slides-outline-planning     # ❌ 不要加 domain 前缀
outlinePlanning             # ❌ 不是 kebab-case
OUTLINE_PLANNING            # ❌ 不是 kebab-case
outline_planning            # ❌ 下划线不合法（kebab-case 用连字符）
```

### 7.2 脚本函数命名

脚本文件（scripts/execute.ts）中的导出函数和参数使用 **snake_case**：

```typescript
// 正确 — snake_case（业界共识：LLM 训练语料以 Python 为主）
export async function execute(
  input: unknown,
  context: ScriptServices,
): Promise<unknown> {}
export async function pre_process(input: unknown): Promise<unknown> {}
export async function post_process(llm_output: unknown): Promise<unknown> {}

// 错误
export async function doExecute() {} // ❌ camelCase
export async function PreProcess() {} // ❌ PascalCase
```

**例外**：TypeScript 内部辅助函数可使用 camelCase（不暴露给 LLM 的私有函数）。

### 7.3 SkillOutputManager Key

| 规则           | 格式           | 示例                          |
| -------------- | -------------- | ----------------------------- |
| 无 domain 前缀 | kebab-case     | `outline-planning`            |
| 与 `name` 一致 | 除非有特殊理由 | `outputKey: outline-planning` |

### 7.4 taskTypes 值

| 规则       | 格式               | 示例                                          |
| ---------- | ------------------ | --------------------------------------------- |
| kebab-case | 统一风格           | `slides-generation`, `chapter-writing`        |
| 领域内唯一 | 同 domain 下不重复 |                                               |
| 语义清晰   | 描述任务而非 Skill | `dimension-research`（不是 `deep-dive-task`） |

---

## 8. 执行模式规范

### 8.1 三种模式

| 模式     | 触发条件                                               | 适用场景                         |
| -------- | ------------------------------------------------------ | -------------------------------- |
| `prompt` | 默认（无 `scriptEntry`）                               | AI 决策类：内容生成、分析、规划  |
| `script` | 有 `scriptEntry`，body 为空或纯文档                    | 确定性逻辑：模板渲染、图表、算法 |
| `hybrid` | 有 `scriptEntry` + 非空 body + `executionMode: hybrid` | 混合：算法预处理 + LLM 精排      |

### 8.2 模式选择指南 🟡 SHOULD

```
需要 LLM 推理？
├── 是 → 有确定性预/后处理？
│        ├── 是 → hybrid
│        └── 否 → prompt
└── 否 → script
```

### 8.3 prompt 模式要求

- 🔴 `taskProfile` 必填（creativity + outputLength）
- 🔴 Content Body 非空（作为系统提示词）
- 🟡 `outputSchema` 推荐（结构化输出时）
- 🟡 `inputs` 推荐（有前置依赖时）

```yaml
executionMode: prompt
taskProfile:
  creativity: medium # deterministic|low|medium|high
  outputLength: long # minimal|short|medium|long|extended
```

### 8.4 script 模式要求

- 🔴 `scriptEntry` 必填
- 🔴 scripts/ 目录下有对应入口文件
- 🔴 入口文件导出 `execute` 函数
- Content Body 可为空或仅作文档说明

```yaml
executionMode: script
scriptEntry: scripts/execute.ts
```

### 8.5 hybrid 模式要求

- 🔴 `scriptEntry` 必填
- 🔴 Content Body 非空（LLM 提示词部分）
- 🔴 `executionMode: hybrid`（必须显式声明）
- 🔴 脚本导出 `pre_process` 和/或 `post_process`

```yaml
executionMode: hybrid
scriptEntry: scripts/execute.ts
taskProfile:
  creativity: low
  outputLength: short
```

---

## 9. 脚本规范

### 9.1 入口文件格式 🔴 MUST

```typescript
// scripts/execute.ts

import type { ScriptServices } from "@/modules/ai-engine/skills/runtime/script-context";

/**
 * script 模式入口函数
 */
export async function execute(
  input: unknown,
  context: ScriptServices,
): Promise<unknown> {
  // 实现逻辑
}

/**
 * hybrid 模式：LLM 调用前的预处理（可选）
 */
export async function pre_process(
  input: unknown,
  context: ScriptServices,
): Promise<unknown> {
  // 预处理逻辑
}

/**
 * hybrid 模式：LLM 调用后的后处理（可选）
 */
export async function post_process(
  llm_output: unknown,
  context: ScriptServices,
): Promise<unknown> {
  // 后处理逻辑
}
```

### 9.2 脚本约束 🔴 MUST

| 规则                        | 说明                                               |
| --------------------------- | -------------------------------------------------- |
| 禁止直接 import NestJS 服务 | 通过 `context` 参数获取服务引用                    |
| 禁止副作用 import           | 不在模块顶层执行逻辑                               |
| 禁止 `console.log`          | 使用 context 中的 Logger                           |
| 禁止硬编码模型名            | LLM 调用通过 `context.facade.chat()` + TaskProfile |
| 必须 try-catch              | 所有异步操作需错误处理                             |

### 9.3 大型脚本拆分 🟡 SHOULD

当脚本超过 500 行时，拆分为 helpers/ 子模块：

```
template-rendering/
├── SKILL.md
└── scripts/
    ├── execute.ts            # 入口（< 100 行）
    └── helpers/
        ├── variable-extractor.ts
        ├── html-builder.ts
        └── chart-integration.ts
```

---

## 10. 输入输出规范

### 10.1 JSON Schema 版本 🔴 MUST

所有 `inputSchema` 和 `outputSchema` 必须使用 **JSON Schema draft 2020-12**：

```yaml
outputSchema:
  type: object
  required: [title, pages]
  properties:
    title:
      type: string
      description: Presentation title
    pages:
      type: array
      items:
        type: object
        required: [pageIndex, title]
        properties:
          pageIndex: { type: integer, minimum: 0 }
          title: { type: string }
        additionalProperties: false
  additionalProperties: false # 必须显式声明
```

### 10.2 Schema 属性命名 🔴 MUST

JSON Schema 属性使用 **camelCase**（与 TypeScript 代码风格一致）：

```yaml
# 正确
properties:
  pageIndex: { type: integer }
  keyPoints: { type: array }
  speakerNotes: { type: string }

# 错误
properties:
  page_index: { type: integer }   # ❌ snake_case
  PageIndex: { type: integer }    # ❌ PascalCase
```

### 10.3 inputs 绑定格式

```yaml
inputs:
  taskDecomposition: # camelCase 变量名
    from: task-decomposition # kebab-case SkillOutputManager key
    required: true
  previousContent:
    from: content-compression
    required: false
```

### 10.4 taskProfile 值域

| creativity      | 对应 temperature | 适用场景                  |
| --------------- | ---------------- | ------------------------- |
| `deterministic` | 0.1              | JSON 提取、分类、格式转换 |
| `low`           | 0.3              | 分析、总结、结构化输出    |
| `medium`        | 0.7              | 对话、研究、规划          |
| `high`          | 0.9              | 创意写作、头脑风暴        |

| outputLength | 对应 maxTokens | 适用场景           |
| ------------ | -------------- | ------------------ |
| `minimal`    | 500            | 分类标签、简短回答 |
| `short`      | 1500           | 摘要、简评         |
| `medium`     | 4000           | 标准分析、大纲     |
| `long`       | 8000           | 报告、章节         |
| `extended`   | 16000          | 长篇写作           |

---

## 11. 解析器行为规范

### 11.1 必填字段验证 🔴 MUST

解析器（skill-parser.ts）**必须在以下字段缺失时报错**（不自动填充默认值）：

| 字段          | 验证规则                    | 错误信息                                                     |
| ------------- | --------------------------- | ------------------------------------------------------------ |
| `name`        | 非空，kebab-case，1-64 字符 | `Skill missing required field "name"`                        |
| `description` | 非空，1-1024 字符           | `Skill missing required field "description"`                 |
| `version`     | SemVer 格式                 | `Skill "${name}" missing or invalid "version"`               |
| `domain`      | 非空字符串                  | `Skill "${name}" missing required field "domain"`            |
| `layer`       | 合法 SkillLayer 值          | `Skill "${name}" missing or invalid "layer"`                 |
| `taskTypes`   | 非空数组，禁止 `["*"]`      | `Skill "${name}" missing "taskTypes" (wildcard not allowed)` |

### 11.2 可选字段默认值

| 字段            | 默认值             |
| --------------- | ------------------ |
| `priority`      | `50`               |
| `enabled`       | `true`             |
| `source`        | `"local"`          |
| `tags`          | `[]`               |
| `executionMode` | 自动推断（见 8.1） |
| `outputKey`     | 同 `name`          |

### 11.3 name 与目录名一致性检查 🔴 MUST

```
目录: outline-planning/SKILL.md
frontmatter: name: outline-planning

如果不一致 → 报错:
  Skill directory "outline-planning" does not match frontmatter name "outline"
```

---

## 12. 现状合规审计

### 12.1 Writing Skills（9 个 .skill.md）

| 问题                                    | 严重度 | 改造项              |
| --------------------------------------- | ------ | ------------------- |
| 文件格式 `*.skill.md` 而非 `*/SKILL.md` | 🔴     | 迁移为目录结构      |
| `description` 用中文                    | 🟡     | 改为英文            |
| 无 `layer` 字段                         | 🔴     | 补充                |
| `taskTypes` 有效但无标准化              | 🟡     | 统一命名            |
| `priority` 范围 7-10（应为 0-100）      | 🟡     | 重新映射            |
| 无 `executionMode` 字段                 | -      | 默认 prompt，可接受 |
| Handlebars 模板变量使用                 | ✅     | 保持                |

### 12.2 Topic Insights Skills（11 个 .skill.md）

| 问题                            | 严重度 | 改造项             |
| ------------------------------- | ------ | ------------------ |
| 同 Writing 的所有问题           | 同上   | 同上               |
| 所有 `priority: 10`，无区分度   | 🟡     | 按重要性重新分配   |
| 多个 skill 共享相同 `taskTypes` | 🟡     | 细化 taskType 匹配 |

### 12.3 Slides Skills（21 个 .skill.ts）

| 问题                                  | 严重度 | 改造项              |
| ------------------------------------- | ------ | ------------------- |
| TypeScript 硬编码，非 SKILL.md        | 🔴     | 全部迁移为 SKILL.md |
| ID 含 domain 前缀 `slides-*`          | 🔴     | 去除前缀            |
| 无 frontmatter 元数据                 | 🔴     | 创建 SKILL.md       |
| 无 taskTypes / priority / tokenBudget | 🔴     | 补充                |
| `description` 仅在代码注释中          | 🔴     | 移到 SKILL.md       |
| 系统提示词硬编码为常量                | 🔴     | 提取到 Content Body |
| 确定性逻辑耦合在类中                  | 🟡     | 提取到 scripts/     |

### 12.4 前端 .skill.md 文件（3 个误命名）

| 问题                                           | 严重度 | 改造项                       |
| ---------------------------------------------- | ------ | ---------------------------- |
| `page-layout-standard.skill.md` 无 frontmatter | 🔴     | 重命名为 `.md`，移到 guides/ |
| `admin-config-layout.skill.md` 同上            | 🔴     | 同上                         |
| `defect-patterns.skill.md` 同上                | 🔴     | 同上                         |

### 12.5 合规评分

| 模块                  | 当前合规度 | 改造后目标      |
| --------------------- | ---------- | --------------- |
| Writing skills        | 40%        | 100%            |
| Topic Insights skills | 40%        | 100%            |
| Slides skills         | 5%         | 100%            |
| 前端误命名文件        | 0%         | N/A（非 skill） |

---

## 13. 改造计划

### 13.1 Phase 1: Writing / Topic Insights 格式改造

**将 20 个 `.skill.md` 扁平文件迁移为目录结构**

改造前：

```
writing/skills/chapter-writing.skill.md
```

改造后：

```
writing/skills/chapter-writing/SKILL.md
```

**同时补充缺失字段**：

- 补充 `layer`
- `description` 改为英文
- `priority` 范围调整为 0-100
- 添加 `executionMode: prompt`（显式声明）

### 13.2 Phase 2: Slides Skills 迁移

**将 21 个 `.skill.ts` 迁移为 SKILL.md + scripts/**

详见 [skill-md-unified-runtime.md](../../../docs/architecture/ai-engine/plans/skill-md-unified-runtime.md) Phase 2-4。

### 13.3 Phase 3: 前端误命名文件清理

```bash
# 重命名，去掉 .skill 后缀
.claude/skills/frontend/page-layout-standard.skill.md → page-layout-standard.md
.claude/skills/frontend/admin-config-layout.skill.md  → admin-config-layout.md
.claude/skills/frontend/defect-patterns.skill.md      → defect-patterns.md
```

### 13.4 Phase 4: 解析器升级

修改 `skill-parser.ts`：

- 必填字段缺失时报错（不自动填充）
- 验证 `name` 与目录名一致
- 验证 `version` 为 SemVer
- 拒绝 `taskTypes: ["*"]`
- 验证 `layer` 为合法值

---

## 14. 检查清单

### 新增 Skill 检查清单

- [ ] 创建 `skills/{skill-id}/SKILL.md` 目录结构
- [ ] `name` 字段 = 目录名，kebab-case
- [ ] `description` 字段用英文，包含触发关键词
- [ ] `version` 字段为 SemVer 格式 `X.Y.Z`
- [ ] `domain` 字段为合法领域值
- [ ] `layer` 字段为合法层级值
- [ ] `taskTypes` 数组非空，无通配符
- [ ] `executionMode` 与实际内容匹配
- [ ] script/hybrid 模式有 `scriptEntry` 和对应脚本文件
- [ ] prompt 模式有 `taskProfile`
- [ ] 有 `outputSchema` 时使用 JSON Schema draft 2020-12
- [ ] `outputSchema` 中所有 object 有 `additionalProperties: false`
- [ ] Content Body < 400 行
- [ ] 脚本文件导出函数名使用 snake_case

### Code Review 检查清单

- [ ] 无 `*.skill.md` 扁平文件（应为 `*/SKILL.md`）
- [ ] 无 `*.skill.ts` 硬编码 Skill（应迁移为 SKILL.md）
- [ ] Skill ID 无 domain 前缀
- [ ] `description` 使用英文
- [ ] `taskTypes` 无通配符 `["*"]`
- [ ] 脚本未直接 import NestJS 服务
- [ ] 脚本内无 `console.log`
- [ ] 脚本内无硬编码模型名

---

## 相关文档

| 文档                         | 路径                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skills 统一 Runtime 设计方案 | [docs/architecture/ai-engine/plans/skill-md-unified-runtime.md](../../../docs/architecture/ai-engine/plans/skill-md-unified-runtime.md)           |
| Skills 替代编码设计方案      | [docs/architecture/ai-engine/plans/ai-engine-skills-replace-code.md](../../../docs/architecture/ai-engine/plans/ai-engine-skills-replace-code.md) |
| AI 调用规范                  | [docs/guides/development/ai-calling-standards.md](../../../docs/guides/development/ai-calling-standards.md)                                       |
| 代码风格指南                 | [.claude/standards/04-code-style.md](04-code-style.md)                                                                                            |
| 模块依赖规范                 | [.claude/standards/13-module-dependencies.md](13-module-dependencies.md)                                                                          |
| Agent Skills Specification   | [agentskills.io/specification](https://agentskills.io/specification)                                                                              |
| MCP Specification            | [modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2025-11-25)                                                               |

---

**维护者**: Claude Code
**最后更新**: 2026-02-08
**版本**: 1.0
