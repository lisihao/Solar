# 类型感知报告标准体系 — 系统设计方案

> 状态：已实现（Phase 1-3），EVENT 子类型预留
> 日期：2026-03-13
> 关联：topic-insights 模块

## Context

当前 topic-insights 报告写作规范是类型无关的 — MACRO/TECHNOLOGY/COMPANY 共用同一套标准。随着 EVENT 类型即将上线（含五层分析引擎、子类型框架），需要引入**类型感知**的分析框架。

经讨论达成三层架构共识：

- **Layer 1 格式规则**（代码强制）→ 不变
- **Layer 2 通用写作基线**（常量注入）→ 不变
- **Layer 3 类型专属分析框架**（Skill 动态注入）→ **本次新增**

**核心原则**：

- Layer 3 的 Skill 告诉 LLM **如何思考**（分析视角、框架、提问），不涉及格式规范。格式由 Layer 1/2 统一管理。
- **对抗验证**通过复用现有 DEVIL_ADVOCATE 角色 + debate skills 实现，由 Leader 根据类型自动分配。

**实施范围**：

- 已实现：MACRO / TECHNOLOGY / COMPANY（3 种类型）
- 设计预留：EVENT（含五层引擎 + 子类型，待 EVENT 类型上线时实现）

---

## 1. 架构设计

### 三层模型

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: 类型专属分析框架 (Skills)                          │
│  ┌──────────┐ ┌─────────────┐ ┌───────────┐ ┌────────────┐ │
│  │  MACRO   │ │ TECHNOLOGY  │ │  COMPANY  │ │   EVENT    │ │
│  │ PESTLE   │ │ Hype Cycle  │ │ Porter 5F │ │ 五层引擎   │ │
│  │ 宏观趋势 │ │ TRL/采用曲线│ │ 护城河评估│ │ + 子类型   │ │
│  └──────────┘ └─────────────┘ └───────────┘ └────────────┘ │
│  注入方式: chatWithSkills({ additionalSkills })              │
│  Token 预算: 4000 tokens (与现有分析 skills 共享)            │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: 通用写作基线 (Constants)                           │
│  HEADING_HIERARCHY + NARRATIVE_STRUCTURE + PROFESSIONAL_TONE │
│  + FORMATTING_LIMITS + CHAPTER_HIGHLIGHTS + ANALYSIS_DEPTH   │
│  + CITATION_STANDARDS + CHART/TABLE_STANDARDS                │
│  注入方式: getWritingStandards() / getDimensionResearch...() │
│  Token 预算: ~5K chars，嵌入 system prompt 模板              │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: 格式规则 (Code)                                    │
│  Quality Gate 硬校验 + Formatting Pipeline 自动修正           │
│  heading 层级 / bold 密度 / blockquote 限制 / HR 清理        │
│  执行方式: 代码逻辑，不经过 LLM                              │
└─────────────────────────────────────────────────────────────┘
```

### 关键边界

| 边界                        | 说明                                                                              |
| --------------------------- | --------------------------------------------------------------------------------- |
| Layer 2 vs Layer 3 预算隔离 | Layer 2 通过模板变量注入 system prompt；Layer 3 通过 skill 注入通道。两个预算独立 |
| Layer 3 不管格式            | Skills 只提供分析框架和思维指引                                                   |
| Layer 1 类型无关            | Formatting Pipeline 对所有类型一视同仁；Quality Gate 增加类型感知的 soft warning  |
| 对抗验证非新流程            | 复用 DEVIL_ADVOCATE + debate skills，通过 Leader 类型感知的深度推荐触发           |

---

## 2. 涉及文件

| 文件                                                    | 操作   | 说明                                                               |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `config/framework-skills.config.ts`                     | NEW    | 类型→技能/深度/辩论映射注册表                                      |
| `skills/frameworks/macro-analysis.skill.md`             | NEW    | MACRO 分析框架（PESTLE + 宏观趋势三问）                            |
| `skills/frameworks/technology-analysis.skill.md`        | NEW    | TECHNOLOGY 分析框架（Hype Cycle + TRL）                            |
| `skills/frameworks/company-analysis.skill.md`           | NEW    | COMPANY 分析框架（Porter 五力 + 护城河）                           |
| `services/core/leader/leader-planning.service.ts`       | MODIFY | VALID_SKILLS + 框架/辩论注入 + recommendedDepth 注入 Leader prompt |
| `services/quality/report-quality-gate.service.ts`       | MODIFY | 类型感知 soft warning（validateTypeSpecificContent）               |
| `services/dimension/dimension-mission.service.ts`       | MODIFY | 传递 topicType 给 Quality Gate                                     |
| `services/dimension/dimension-writing.service.ts`       | MODIFY | 传递 topicType 给 Quality Gate（select 增加 type）                 |
| `prompts/research-leader.prompt.ts`                     | MODIFY | 增加 {recommendedDepth} 引导 Leader 深度选择                       |
| `config/__tests__/framework-skills.config.spec.ts`      | NEW    | 30 个单元测试                                                      |
| `quality/__tests__/report-quality-gate.service.spec.ts` | MODIFY | +15 个类型感知测试用例                                             |

---

## 3. 扩展模式

### 添加新 EVENT 子类型（零核心代码变更）

1. 新建 `skills/frameworks/event-xxx.skill.md` (max 800 tokens)
2. `framework-skills.config.ts` 的 `EVENT_SUBTYPE_SKILLS` 增加映射
3. `leader-planning.service.ts` 的 `VALID_SKILLS` 增加 skill name

### 添加新主类型

1. Prisma schema 增加 `ResearchTopicType` 枚举值 + 迁移 SQL
2. 新建 `skills/frameworks/{type}-analysis.skill.md` (max 1500 tokens)
3. `framework-skills.config.ts` 的 `FRAMEWORK_SKILLS_BY_TOPIC_TYPE` 增加映射
4. `VALID_SKILLS` 增加 skill name
5. （可选）`validateTypeSpecificContent()` 增加 case 分支

---

## 4. 不需要改的东西

| 组件                                    | 原因                                                   |
| --------------------------------------- | ------------------------------------------------------ |
| `section-writer.service.ts`             | 已通过 `chatWithSkills({ additionalSkills })` 泛化处理 |
| `dimension-mission.service.ts`          | 只做 `assignedSkills` 透传（仅新增 topicType 参数）    |
| `dimension-content-formatting.utils.ts` | 格式规则类型无关                                       |
| `report-writing-standards.constants.ts` | Layer 2 通用基线，类型无关                             |
| `SkillLoaderService`                    | 自动发现 `skills/frameworks/` 下的 .skill.md 文件      |
