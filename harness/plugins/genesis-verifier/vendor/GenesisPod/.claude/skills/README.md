# Skills Directory

> GenesisPod 的 Claude Code 技能库，采用 Progressive Disclosure 结构。

## Skills vs Commands

| 特性         | Skills (本目录)       | Commands                 |
| ------------ | --------------------- | ------------------------ |
| **位置**     | `.claude/skills/`     | `.claude/commands/`      |
| **调用方式** | AI 自动根据上下文使用 | 用户输入 `/command` 触发 |
| **用途**     | 领域知识库、专业指导  | 快捷指令、工作流         |

## 分类导航

| 分类          | 技能数量 | 主要用途                         | 导航                                      |
| ------------- | -------- | -------------------------------- | ----------------------------------------- |
| AI            | 8        | AI/LLM 开发、多 Agent 协作       | [ai/](ai/README.md)                       |
| Development   | 9        | 前后端开发、数据库、Git          | [development/](development/README.md)     |
| Architecture  | 5        | Schema、安全、文档处理、秘钥工具 | [architecture/](architecture/README.md)   |
| Data          | 2        | 数据管道、知识图谱               | [data/](data/README.md)                   |
| Operations    | 4        | DevOps、调试、部署               | [operations/](operations/README.md)       |
| Quality       | 3        | 测试、代码审查、性能             | [quality/](quality/README.md)             |
| Workflow      | 3        | 规划、执行、验证                 | [workflow/](workflow/README.md)           |
| Collaboration | 1        | 并行调查                         | [collaboration/](collaboration/README.md) |
| **总计**      | **35**   | -                                | -                                         |

## Progressive Disclosure 结构

每个技能采用分层结构，减少 Claude 上下文占用：

```
skill-name/
├── SKILL.md        # 核心概念 (<150 行)
│   ├── YAML frontmatter (boundaries, handoff)
│   ├── 快速参考
│   └── 架构图
└── references/     # 详细文档 (按需加载)
    ├── implementation-guide.md
    ├── code-examples.md
    └── troubleshooting.md
```

### SKILL.md 模板

```yaml
---
name: skill-name
description: |
  简短描述（1-2 句）。
  触发关键词: keyword1, keyword2
  不适用于: 排除场景（→ 使用其他 skill）
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [tag1, tag2]
boundaries:
  includes: [职责1, 职责2]
  excludes: [排除1]
  handoff:
    - skill: other-skill
      when: 移交条件
---
```

## 快速查找

```
What are you building?
├── AI feature → ai/
├── API endpoint → development/api-developer
├── Database change → architecture/schema-architect
├── Frontend component → development/frontend-expert
├── Production issue → operations/debug-ops
└── Tests → quality/testing-suite
```

## 最近更新 (2025-01)

### Progressive Disclosure 重构

- 所有 SKILL.md 精简至 <150 行（平均减少 73%）
- 详细文档迁移至 `references/` 子目录
- 添加 YAML frontmatter（boundaries, handoff）
- 创建分类导航索引（README.md）

### 合并的技能

- `testing-suite` ← testing-expert + e2e-testing-orchestrator + verification-automation
- `devops-platform` ← deployment-ops + iac-manager + monitoring-ops
- `frontend-expert` ← frontend-builder + frontend-ui-debugger
- `data-pipeline-expert` ← data-collection-expert + data-quality-manager

## 技能边界设计

每个技能文件 (SKILL.md) 现在包含 `boundaries` 字段：

```yaml
boundaries:
  includes:
    - "明确包含的职责"
  excludes:
    - "明确排除的职责"
  handoff:
    - skill: "other-skill"
      when: "何时移交给其他技能"
```

## 使用说明

1. **选择技能**：根据任务类型选择对应分类下的技能
2. **查看边界**：阅读 `boundaries` 了解技能范围
3. **技能移交**：当任务超出当前技能范围时，参考 `handoff` 切换技能

## 技能依赖图

```
                    ┌─────────────────────┐
                    │  schema-architect   │
                    │   (架构设计入口)      │
                    └──────────┬──────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
           ▼                   ▼                   ▼
    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
    │ api-developer│   │frontend-expert│  │ai-app-developer│
    └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
           │                   │                   │
           └───────────────────┼───────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   testing-suite     │
                    │   (质量保证层)       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   devops-platform   │
                    │   (部署运维层)       │
                    └─────────────────────┘
```
