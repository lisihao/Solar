---
name: Report Template
description: |
  Unified report formatting standard for all AI App modules.
  Defines 13 content types with 3-layer enforcement (Prompt → Post-processing → Frontend).
  Trigger keywords: report, template, formatting, report-template, writing-standards
  Not for: Document export (-> document-generation), Frontend UI layout (-> frontend-expert)
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [report, template, formatting, ai-engine, standards]
boundaries:
  includes:
    - Report formatting constants and prompt standards
    - Post-processing pipeline for markdown report content
    - Frontend markdown component rendering rules
  excludes:
    - Document export (DOCX/PDF/PPTX)
    - Report business logic (topic selection, data collection)
  handoff:
    - skill: document-generation
      when: Exporting report to DOCX/PDF/PPTX
    - skill: ai-app-developer
      when: Report business logic (research flow, agent orchestration)
    - skill: prompt-engineering
      when: Designing new prompt constants for report sections
---

# Report Template Skill

> Canonical spec: `references/report-template-spec.md`
> Standard: `.claude/standards/15-report-template.md`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  AI App Shared Layer (ai-app/shared/report-template/)       │
│  ┌──────────────────┐  ┌──────────────────────────────┐    │
│  │ constants/        │  │ pipeline/                     │    │
│  │ - Prompt 常量     │  │ - 40+ transform functions     │    │
│  │ - 写作标准        │  │ - splitEnumerationToList      │    │
│  │ - 格式限制        │  │ - boldSummaryPrefixes         │    │
│  │ - 图表规范        │  │ - repairMarkdownTables        │    │
│  └──────────────────┘  └──────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Barrel Export (index.ts)                              │  │
│  │ import from "@/modules/ai-app/shared/report-template" │  │
│  └──────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  AI App Layer (consumers)                                   │
│  ┌────────────────┐ ┌──────────┐ ┌──────────┐             │
│  │ Topic Insights  │ │ Research │ │ Writing  │             │
│  │ (current user)  │ │ (future) │ │ (future) │             │
│  └────────────────┘ └──────────┘ └──────────┘             │
├─────────────────────────────────────────────────────────────┤
│  Frontend Layer                                             │
│  ┌───────────────────────┐ ┌──────────────────────┐       │
│  │ createMarkdownComponents │ │ FigureRenderer      │       │
│  │ - blockquote (卡片)    │ │ - 图表统一渲染       │       │
│  │ - list (分层标识)      │ │                      │       │
│  │ - strong (结语紫色)    │ │                      │       │
│  └───────────────────────┘ └──────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## Key Files

```
backend/src/modules/ai-app/shared/report-template/    # Shared module
├── constants/
│   └── report-writing-standards.ts    # L1: Prompt 常量 (13 types)
├── pipeline/
│   └── report-formatting.utils.ts     # L2: 后处理函数 (40+)
└── index.ts                           # barrel export

backend/src/modules/ai-app/insight/             # Consumer (business logic，后端模块目录，前端路由为 ai-insights)
├── services/report/
│   └── report-assembler.service.ts    # L2: 管线编排 (imports from shared)

frontend/
├── lib/report/
│   └── createMarkdownComponents.tsx   # L3: markdown 渲染组件
├── components/ai-insights/charts/
│   └── FigureRenderer.tsx             # L3: 图表卡片渲染
```

**Import path:** `import { ... } from "@/modules/ai-app/shared/report-template";`

## 13 Content Types

| #   | Type               | Prompt Constant              | Post-processing               | Frontend           |
| --- | ------------------ | ---------------------------- | ----------------------------- | ------------------ |
| 1   | Title              | -                            | -                             | `<h1>`             |
| 2   | Executive Summary  | `EXECUTIVE_SUMMARY_FORMAT`   | `enforceExecSummarySections`  | standard           |
| 3   | TOC                | -                            | -                             | link list          |
| 4   | Chapter Highlights | `CHAPTER_HIGHLIGHTS`         | `bulletifyBlockquoteItems`    | styled card        |
| 5   | Dimension Body     | `HEADING_HIERARCHY` + 3 more | 40+ functions                 | standard + links   |
| 6   | Lists              | `FORMATTING_LIMITS`          | `repairOrderedListContinuity` | layered markers    |
| 7   | Blockquote         | `FORMATTING_LIMITS`          | -                             | default blockquote |
| 8   | Figures            | `CHART_STANDARDS`            | `resolveChartPlaceholders`    | `<FigureRenderer>` |
| 9   | Tables             | -                            | `repairMarkdownTables`        | `<table>`          |
| 10  | Supplementary      | `SYNTHESIS_FORMATTING`       | shared pipeline               | standard           |
| 11  | Conclusion         | -                            | dedup logic                   | purple bold        |
| 12  | References         | `CITATION_STANDARDS`         | 5 cleanup functions           | hyperlinks         |
| 13  | Math               | `PROFESSIONAL_TONE`          | `mergeAdjacentMathBlocks`     | KaTeX              |

## Pipeline Execution Stages

Reports enforce this spec at every stage of generation:

```
Agent 初稿 ──→ Leader 审核 ──→ 维度后处理 ──→ 全文整合 ──→ 前端渲染
   L1              L1            L2             L2           L3
(Prompt)       (Prompt)     (transform)    (transform)   (components)
```

1. **Agent 初稿**: 每个 Agent 的 system prompt 注入写作标准常量
2. **Leader 审核**: Leader prompt 包含格式检查项，退回不合格稿件
3. **维度后处理**: `processDimensionContent()` 对单维度执行 L2 管线
4. **全文整合**: `postProcessFinalReport()` 对完整报告执行 L2 管线
5. **前端渲染**: `createMarkdownComponents` + `FigureRenderer` 执行 L3

## Adding a New Content Type

1. Define format rules in `references/report-template-spec.md`
2. Add prompt constant in `report-writing-standards.ts`
3. Implement post-processing function in `report-formatting.utils.ts`
4. Wire into pipeline (`processDimensionContent` / `postProcessFinalReport`)
5. Add frontend rendering in `createMarkdownComponents.tsx` if needed
6. Update standard `.claude/standards/15-report-template.md`
7. Update execution matrix in spec

## New AI App Module Integration

When a new module (e.g., Research, Writing) needs report generation:

```typescript
// 1. Import from shared module (NOT from topic-insights)
import {
  getWritingStandards,
  getExecutiveSummaryFormat,
  splitEnumerationToList,
  boldSummaryPrefixes,
  repairMarkdownTables,
  // ... other formatting functions as needed
} from "@/modules/ai-app/shared/report-template";

// 2. Inject into Agent prompt
const systemPrompt = `
${getWritingStandards(language)}
${getExecutiveSummaryFormat(language)}
...your business-specific instructions...
`;

// 3. Post-process generated content using individual functions
let processed = rawContent;
processed = splitEnumerationToList(processed);
processed = boldSummaryPrefixes(processed);
processed = repairMarkdownTables(processed);
// ... apply the functions relevant to your report type
```

## Key Rules (from spec)

- **Heading hierarchy**: Only `###` and `####` in dimension body, `#####` forbidden
- **Bold limit**: Max 2 per sub-section, only for core judgments, each ≤30 chars
- **Blockquote limit**: Max 1 per dimension, max 8 total, each ≤80 chars
- **Figure limit**: Max 2 per dimension, max 12-14 total
- **Enumeration**: Chinese patterns (一是/二是) auto-split to bullet lists
- **References**: Title as hyperlink, URL invisible, `[N]` clickable to anchor
- **Conclusion**: Bold text renders as purple (`text-purple-700`)
