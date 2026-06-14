# GenesisPod Agent SDK 范式改造方案 v5（含 Plugin 系统）

**版本：** 5.0
**日期：** 2026-05-04
**状态：** 等待 v5 多角色并行评审（通过即进 R0 实施）
**取代：** v3（v3 plan + review 全部归档）

**前置评审记录：**

- v1 方案：[`anthropic-sdk-revamp-plan-v1.md`](./anthropic-sdk-revamp-plan-v1.md)
- v1 评审（17 项修订）：[`anthropic-sdk-revamp-review-v1.md`](./anthropic-sdk-revamp-review-v1.md)
- v2 方案：[`anthropic-sdk-revamp-plan-v2.md`](./anthropic-sdk-revamp-plan-v2.md)
- v2 评审（7 P0 + 5 P1）：[`anthropic-sdk-revamp-review-v2.md`](./anthropic-sdk-revamp-review-v2.md)
- v3 方案：[`anthropic-sdk-revamp-plan-v3.md`](./anthropic-sdk-revamp-plan-v3.md)
- v3 评审（5 项 P0-NEW）：[`anthropic-sdk-revamp-review-v3.md`](./anthropic-sdk-revamp-review-v3.md)

**v5 vs v3 增量**（不破坏 v3 既有结论，仅新增 + 全文一致性刷新）：

1. **新增 §11 Plugin 系统大章节**（26 个横切 plugin / plugin-core 内核 / SDK 发布形态 / 接口契约 / R0.5 PR 序列）
2. **§0 基本原则增加"横切关注点剥离"红线**（plugin 化作为 base layer 瘦身的强制路径，与现有"业务无关"原则并列）
3. **§3.1 目录图新增 `src/plugin-core/` + `src/plugins/{8 域}/`** 两个新根目录
4. **§4 实施路径插入 R0.5（plugin 内核 + 关键路径打 hook + 4 个高价值 plugin）** 在 R0 收尾后、R1 之前
5. **§9 时间表插入 R0.5** 1.5-2 周
6. **§10 验收增加 plugin 化验收维度**（plugin spec / hook trace / SDK 接口 stable 标识）

**本轮 v5 用户决策**（v3 锁定 + v5 新增）：

1. **本轮实施范围 = phase 1**：R0 + **R0.5** + R1 + R2 + R3-A（playground 改造 + writing-team demo + plugin 系统）
2. **playground 改造期间**：前台 0 改动 + 后台对前台接口 0 改动 + 行为零变化
3. **R4（用户自定义 Agent UI）= phase 2**：本文档完整覆盖目标架构设计，但实施推迟，等 phase 1 稳定后启动
4. **base layer 业务无关原则永久守护**：自动化看护必须能扛住未来所有改动
5. **横切关注点必须 plugin 化**：harness/engine 内核不得继续承载 telemetry / sandbox / cache / rate-limit / multi-key / vector-backend 等 26 个横切实现，全部下推到 `src/plugins/`
6. **plugin 系统从设计期就为 SDK 发布预留对外契约面**：稳定 hook id / payload 版本化 / manifest 自描述 / 签名校验接口预留

**关联规范：** standards/16-ai-engine-harness-structure.md / 17-extension-governance.md / 18-base-layer-file-governance.md

---

## 目录

- [§0 基本原则：base layer 业务无关（永久门槛）](#0-基本原则base-layer-业务无关永久门槛)
- [§1 目标与衡量](#1-目标与衡量)
- [§2 用户体验（三视图）](#2-用户体验三视图)
- [§3 架构设计](#3-架构设计)
  - [§3.1 三层抽象 + L3.5 元层](#31-三层抽象--l35-元层)
  - [§3.2 7 个 stage primitive + hook 注入](#32-7-个-stage-primitive--hook-注入)
  - [§3.3 SKILL.md 单一真相源 + SkillSpecBuilder](#33-skillmd-单一真相源--skillspecbuilder)
  - [§3.4 stateful agent runtime + 跨 stage state 持久化](#34-stateful-agent-runtime--跨-stage-state-持久化)
  - [§3.5 数据模型：每 ai-app 自有表 + IMissionStore 端口](#35-数据模型每-ai-app-自有表--imissionstore-端口)
  - [§3.6 控制层：薄壳 controller in ai-app](#36-控制层薄壳-controller-in-ai-app)
  - [§3.7 前端事件兼容性契约](#37-前端事件兼容性契约)
  - [§3.8 前台 Agent 配置 UI 设计（phase 2 实施）](#38-前台-agent-配置-ui-设计phase-2-实施)
  - [§3.9 用户自定义 Agent 数据模型 + API（phase 2 实施）](#39-用户自定义-agent-数据模型--api-phase-2-实施)
- [§4 实施路径（phase 1 + phase 2）](#4-实施路径phase-1--phase-2)
- [§5 playground 13 stage → 7 primitive 完整映射 + hook 行数估算](#5-playground-13-stage--7-primitive-完整映射--hook-行数估算)
- [§6 风险与缓解](#6-风险与缓解)
- [§7 回滚策略](#7-回滚策略)
- [§8 与 W21/W22 协调](#8-与-w21w22-协调)
- [§9 时间表（诚实数字）](#9-时间表诚实数字)
- [§10 验收标准](#10-验收标准)
- [§11 Plugin 系统（v5 新增）](#11-plugin-系统v5-新增)
  - [§11.1 设计目标 5 维 + 全量 plugin 盘点](#111-设计目标-5-维--全量-plugin-盘点)
  - [§11.2 顶层架构 + plugin-core / plugins 双根目录](#112-顶层架构--plugin-core--plugins-双根目录)
  - [§11.3 核心接口（IPluginManifest / IPlugin / IPluginContext / HookBus）](#113-核心接口)
  - [§11.4 标准 Hook 集 + 命名规范 + payload 版本化](#114-标准-hook-集--命名规范--payload-版本化)
  - [§11.5 PluginCapability 安全声明 + capability gate](#115-plugincapability-安全声明--capability-gate)
  - [§11.6 配置文件 + 模块 override + ai-app 选用方式](#116-配置文件--模块-override--ai-app-选用方式)
  - [§11.7 关键路径改造（Tool / LLM / Mission lifecycle）](#117-关键路径改造tool--llm--mission-lifecycle)
  - [§11.8 可靠性保障（启动期 fail-fast + 运行时 fail-soft + supervisor）](#118-可靠性保障)
  - [§11.9 安全保障（最小特权 + sandbox + 签名校验）](#119-安全保障)
  - [§11.10 SDK 发布形态（@genesis/harness-core + plugin 子包）](#1110-sdk-发布形态)
  - [§11.11 Plugin 测试策略](#1111-plugin-测试策略)
  - [§11.12 R0.5 实施 PR 序列（12 PR / 1.5-2 周）](#1112-r05-实施-pr-序列)
  - [§11.13 与 R0/R1/R2 的衔接 + 风险登记](#1113-与-r0r1r2-的衔接--风险登记)

---

## §0 基本原则：base layer 业务无关（永久门槛）

> **必须在 R1 之前完成 R0 + 永久启用自动化看护。这是一切其他工作的前提。**

### 0.1 原则陈述

按 standards/16/17/18：

| 层                               | 应有                                                                                                                              | **不应有**                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| L1 ai-infra                      | DB / 缓存 / 队列 / 鉴权 / 存储 / 计费                                                                                             | 任何业务语义                                                                                                                                     |
| L2 ai-engine                     | LLM / 工具 / RAG / Skill 定义 / planning / safety / content                                                                       | agent 状态、mission、ai-app 业务名                                                                                                               |
| L2.5 ai-harness                  | agent 运行时（含 agent / mission 状态）+ runner loop + teams 协作模式抽象 + memory / protocols / guardrails / tracing / lifecycle | 具体业务名（playground / research / writing / debate / slides / topic-insights / library / office / ask 等）+ 业务文案 + 业务图标 + 业务能力描述 |
| **L3.5 ai-app/\_meta**（新分类） | 用户自定义 Agent 容器（custom-agents 模块）、Agent template registry 等"为 ai-app 服务的 generic 容器"                            | 具体单一业务的语义                                                                                                                               |
| L3 ai-app                        | 全部产品语义、业务流程、专属规则、业务表                                                                                          | —                                                                                                                                                |

**判别口诀**（16 §二）：

- engine: "不需要知道 agent / mission 是谁就能做的事"
- harness: "必须知道 agent / mission 才有意义的事 —— **但不知道是哪个具体 ai-app**"
- **L3.5 ai-app/\_meta**: "为多个 ai-app 提供通用容器，但本身不是单一业务"

**v5 新增红线：横切关注点必须从内核剥离到 plugin**

base layer 业务无关只是第一道红线；v5 增加第二道**结构性瘦身红线**：

> **harness/engine 内核不得承载横切实现**——telemetry / sandbox / tool-cache / rate-limit / multi-key / circuit-breaker / vector-backend 等 26 个横切关注点，必须以 plugin 形态存在于 `src/plugins/`，通过 plugin-core 提供的 HookBus 注入 harness/engine。

判别口诀：

- "如果一个能力**有多种合理实现方式可以替换**（vm2 vs isolated-vm / pgvector vs qdrant / OpenTelemetry vs Datadog），它就是 plugin 候选"
- "如果一个能力**所有 ai-app 都用得上但没有 ai-app 单独拥有它**（rate-limit / circuit-breaker / pii-moderation），它就是 plugin 候选"
- "如果一个能力**会跟着发布 SDK 时被用户替换**，它必须是 plugin"

详见 §11 Plugin 系统章节。

### 0.2 现存违规盘点（v3 真实数字）

通过 grep 实测得到 R0 真实工作量：

| 违规类型                                                         | 文件数    | occurrence 数      | 清理动作                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | --------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BUILTIN_TEAMS` 在 harness/teams/abstractions                    | 1         | 1 const            | 删除 + 业务名下推到各 ai-app constants                                                                                                                                                                                       |
| `BUILTIN_AGENTS` 在 harness/agents/domain                        | 1         | 1 const + 中文文案 | 删除 + 业务文案下推到 ai-app（`<app>.agent-meta.ts`）                                                                                                                                                                        |
| `BUILTIN_ROLES` 在 harness/teams/abstractions                    | 1         | 1 const            | 删除 + 业务角色名下推（"research-lead/slides-lead"）                                                                                                                                                                         |
| harness 内含 `playground` / `agent-playground` 字面              | 26 文件   | 105 occurrences    | 注释 → 删除；运行时业务条件分支 → 重构成 caller 注入                                                                                                                                                                         |
| harness/builtin-skills/built-in/ 含 playground 业务概念 SKILL.md | 17 个目录 | —                  | **下推到 ai-app**（leader-foreword / leader-mid-mission-assess / leader-signoff / multi-judge-mission-review / mece-mission-planning / report-meta-critic / dimension-research / web-research / ... 全部是 playground 业务） |
| ai-app 引用 `BUILTIN_TEAMS / AGENTS / ROLES`                     | 17 个文件 | —                  | 改用各 ai-app 自定义常量或 generic string                                                                                                                                                                                    |
| postmortem-classifier substring 检查（PR-2 灰色）                | 1 文件    | 4 substrings       | 改 config 注入 patterns                                                                                                                                                                                                      |

**总计：~50 个文件需要改动**。

### 0.3 R0 清理动作（v3 详细）

#### Action 1: 删 `BUILTIN_TEAMS / BUILTIN_AGENTS / BUILTIN_ROLES`

```typescript
// before: harness/teams/abstractions/team.interface.ts
export const BUILTIN_TEAMS = { RESEARCH: "research", ... };

// after
export type TeamId = string;  // 不预知具体 id 列表
// （删除 BUILTIN_TEAMS / BuiltinTeamId）
```

业务名下推到各 ai-app：

```typescript
// ai-app/research/research.constants.ts
export const RESEARCH_TEAM_ID = "research" as const;

// ai-app/office/slides/slides.constants.ts
export const SLIDES_TEAM_ID = "slides" as const;
export const SLIDES_AGENT_META = {
  id: SLIDES_TEAM_ID,
  name: "AI Slides",
  description: "智能 PPT 生成器",
  icon: "📊",
  capabilities: ["自动生成大纲", ...],
};
// 各 ai-app 在 onModuleInit 注册到 TeamRegistry
```

17 个 ai-app importer 同步更新。

#### Action 2: harness 内 26 个文件 playground 字面清理

按"运行时代码 vs 注释"分两种处理：

**注释类**（约 80 occurrences）：直接删除或泛化成 generic 描述。例：

```typescript
// before: "★ 2026-04-30 (PR-X-E): 通用 mission registry primitive（从 playground 上提）"
// after:  "★ 2026-04-30: 通用 mission registry primitive（mission-style ai-app 复用）"
```

**运行时业务条件分支**（约 25 occurrences，最关键）：

实测 `harness/evaluation/critique/report-artifact-assembler.service.ts` L454-480：

```typescript
// before（v2 现状，违规）
if (mission.metadata?.appName === "agent-playground" && mission.metadata?.language === "zh") {
  // playground 当前仅支持中文 mission
  applyChineseSpecificPreprocess(...);
}
```

**修订 v3**：改 caller 注入 config 模式：

```typescript
// after
function assembleArtifact(
  input: AssembleInput,
  config: { preprocessHooks?: ((sections: Section[]) => Section[])[] } = {},
) {
  let result = input.sections;
  for (const hook of config.preprocessHooks ?? []) {
    result = hook(result);
  }
  ...
}

// ai-app 调用时注入业务 hook
// ai-app/agent-playground/services/...
const PLAYGROUND_PREPROCESS_HOOKS = [
  applyChineseSpecificPreprocess,  // 业务专属
];
reportAssembler.assemble(input, { preprocessHooks: PLAYGROUND_PREPROCESS_HOOKS });
```

**全 26 个文件按这个模式逐一审视 + 修订**。

#### Action 3: harness/builtin-skills/built-in/ 17 个 SKILL.md 下推

实测 17 个目录（leader-foreword / leader-mid-mission-assess / leader-signoff / multi-judge-mission-review / mece-mission-planning / report-meta-critic / dimension-research / web-research / dim-chapter-integration / chapter-quality-gate / citation-audit / critical-review / cross-dim-fact-check / cross-dim-synthesis / dimension-quality-review / objective-report-evaluation / budget-stewardship）—— **全部是 playground 业务概念**，应在 ai-app 层。

下推目标：

- 17 个 SKILL.md 全部移到 `ai-app/agent-playground/skills/`
- harness/agents/builtin-skills/ **保留为空目录或仅留通用 skill**（如有真通用的）
- BuiltinSkillCatalog 改为 generic registry（无内置业务 skill），由 ai-app onModuleInit 注册

**注册时序保证（P0-NEW-1 修订）**：

- ai-app 模块**必须** `imports: [AIHarnessFacadeModule]`（或 HarnessSkillsModule），让 ai-app 的 `onModuleInit` 在 SkillLoader 之后执行（NestJS 模块依赖图驱动 init 顺序）
- harness/agents/builtin-skills/skill-loader.ts 修改后：`BUILT_IN_DIR` 仍存在但内容为空时正常（loadAll() 返回 []）；ai-app 自己 register 业务 skill
- 永久门槛：在 R0 看护中加单测约束 `harness/agents/builtin-skills/built-in/` 必须为空目录（防止有人偷偷加回业务 skill）
  ```typescript
  // backend/src/__tests__/architecture/builtin-skills-empty.spec.ts
  it("harness/agents/builtin-skills/built-in 必须为空目录（业务 skill 必须在 ai-app）", () => {
    const dir = path.resolve(
      __dirname,
      "../../modules/ai-harness/agents/builtin-skills/built-in",
    );
    const entries = fs.readdirSync(dir).filter((e) => !e.startsWith("."));
    expect(entries).toEqual([]);
  });
  ```

#### Action 4: postmortem-classifier substring 改 config 注入

```typescript
// after
classify(input: ClassifyInput, patterns: PostmortemPatterns): ClassifyResult { ... }

// ai-app/agent-playground/services/postmortem-patterns.ts
export const PLAYGROUND_POSTMORTEM_PATTERNS = {
  stuckRevision: ["revision:stuck", "chapter:revision"],
  toolTruncation: ["tool:truncated"],
  llmTimeout: ["llm:timeout", "timeout"],
  userCancel: ["user-cancel"],
};
```

### 0.4 自动化看护（永久启用）

#### 看护 1：`base-layer-business-leakage.spec.ts`

```typescript
// backend/src/__tests__/architecture/base-layer-business-leakage.spec.ts
const BLACKLIST_BUSINESS_TERMS = [
  // ai-app 业务名（含连字符 / 下划线变体）
  "playground",
  "agent-playground",
  "agent_playground",
  "research",
  "ai-research",
  "writing",
  "writing-team",
  "debate",
  "debate-team",
  "slides",
  "ai-slides",
  "topic-insights",
  "topic_insights",
  "library",
  "ai-library",
  "office",
  "ai-office",
  "ask",
  "ai-ask",
  "image",
  "ai-image",
  "social",
  "ai-social",
  "simulation",
  "ai-simulation",
  "planning",
  "ai-planning",
  // 业务专属角色名（generic SDK 词如 researcher / writer / reviewer / leader 不在黑名单）
  "research-lead",
  "content-lead",
  "tech-lead",
  "slides-lead",
];

const ALLOWLIST_PATHS = [
  "**/__tests__/**", // 测试文件可有业务名（spec 用例）
  "**/README.md", // 文档可有业务名（举例说明）
  "**/legacy-*.ts", // 兼容性 forwarder（迁移期，必须有迁移期限）
];

const ALLOWLIST_FILE_HEADER = "// @business-allowlist-reason: ";
// 文件头部声明 @business-allowlist-reason 的可放行（必须填理由 + 迁移计划）

describe("base layer business leakage", () => {
  for (const layer of ["ai-engine", "ai-harness", "ai-infra"]) {
    it(`${layer} 不含 ai-app 业务名`, async () => {
      const violations = await scanBusinessLeakage({
        layerRoot: `backend/src/modules/${layer}`,
        blacklist: BLACKLIST_BUSINESS_TERMS,
        allowlistPaths: ALLOWLIST_PATHS,
        allowlistMarker: ALLOWLIST_FILE_HEADER,
      });
      expect(violations).toEqual([]);
    });
  }
});
```

scanner 实现要点：

- 跳过注释（用 TypeScript AST 区分代码 vs 注释；comment node 不算）
- 字符串字面量（`Literal[type=string]`）+ template literal 内字符串都扫
- 标识符不扫（`BUILTIN_TEAMS.SLIDES` 中 `SLIDES` 是 identifier 不算字符串字面量）
- import path 扫描（`from "@/modules/ai-app/agent-playground/..."` 在 base layer 出现 = 致命违规）

#### 看护 2：ESLint `no-restricted-syntax` 完整可执行配置

```js
// backend/.eslintrc.js
module.exports = {
  overrides: [
    {
      files: [
        "src/modules/ai-harness/**/*.ts",
        "src/modules/ai-engine/**/*.ts",
        "src/modules/ai-infra/**/*.ts",
      ],
      excludedFiles: [
        "**/__tests__/**",
        "**/*.spec.ts",
        "**/*.test.ts",
        "**/legacy-*.ts",
      ],
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            selector:
              "Literal[value=/(^|[-_/])playground([-_/]|$)|(^|[-_/])agent-playground([-_/]|$)|(^|[-_/])writing-team([-_/]|$)|(^|[-_/])topic-insights([-_/]|$)|(^|[-_/])ai-(slides|office|library|research|ask|image|social|simulation|planning)([-_/]|$)/i]",
            message: "禁止在 base layer 硬编码 ai-app 业务名，下推到 ai-app 层",
          },
          {
            selector:
              "Literal[value=/research-lead|content-lead|tech-lead|slides-lead/i]",
            message: "禁止在 base layer 硬编码业务角色名，下推到 ai-app 层",
          },
          {
            selector:
              "TemplateElement[value.cooked=/(^|[-_/])playground([-_/]|$)/i]",
            message: "禁止在 base layer template literal 中硬编码业务名",
          },
        ],
      },
    },
  ],
};
```

ESLint 配置已排除 `__tests__/` 和 `legacy-*.ts`；正则用单词边界避免误伤（"playgrounded" / "research" 在合法泛词中不命中）。

#### 看护 3：每 PR self-check（写入 .github/PULL_REQUEST_TEMPLATE.md）

```markdown
## Base Layer 业务无关 Self-Check（影响 harness/engine/infra 的 PR 必填）

- [ ] 本 PR 改动的 base layer 文件 grep 不到 ai-app 业务名
- [ ] 本 PR 改动的 base layer 文件 grep 不到中文产品文案
- [ ] 任何 business literal 改成 caller 注入的参数 / config 字段
- [ ] `npm run verify:arch` + `base-layer-business-leakage.spec.ts` + ESLint 通过
- [ ] 如不符合上述任一条，写入 `legacy-*.ts` 或文件头加 `@business-allowlist-reason:` + 迁移期限
```

### 0.5 R0 工作量（v3 真实重估）

| 子任务                                                                                          | 工作量       |
| ----------------------------------------------------------------------------------------------- | ------------ |
| Action 1: BUILTIN_TEAMS/AGENTS/ROLES 删除 + 17 个 importer 改 + 业务名下推                      | 2 天         |
| Action 2: harness 26 个文件 playground 字面清理（含运行时业务条件分支重构）                     | 4-5 天       |
| Action 3: harness/builtin-skills/built-in 17 个 SKILL.md 下推到 ai-app/agent-playground/skills/ | 2-3 天       |
| Action 4: postmortem-classifier substring 改 config                                             | 0.5 天       |
| 看护 1+2+3 实施 + 全量跑通 + scanner 写法 robust                                                | 1.5 天       |
| **R0 合计**                                                                                     | **10-12 天** |

**R0 不通过，phase 1 全部不能开。**

---

## §1 目标与衡量

### 1.1 北极星

```
开发新 ai-app（mission-style）的全部代码：
  ├── <my-team>.config.ts            ~80 行声明式（MissionPipelineConfig）
  ├── <my-team>.controller.ts        ~30 行薄壳 NestJS controller
  ├── <my-team>.module.ts            ~10 行 NestJS module
  ├── <my-team>-mission.store.ts     ~150 行 IMissionStore 实现（业务表 prisma 操作）
  ├── skills/*.skill.md              3-8 份 SKILL.md (Anthropic frontmatter 标准)
  ├── prisma 业务表 + 手写迁移        业务字段独立列 + metadata JSONB（小字段）
  ├── 业务专属 hook services         ~500-800 行（hook 实现，非 generic 部分）

跑通: controller / mission runner / lifecycle / rerun / export / chat / replay / events 全自动
```

### 1.2 量化验收（v3 诚实数字）

| 指标                                                          | 目标                       | 备注                                                         |
| ------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| 复制 playground → 新 mission-style ai-app 改动文件数          | < 15                       | 不含 SKILL.md 时 < 10                                        |
| 资深开发者新建 ai-app 时间                                    | < 3 天                     | vs 现状 1-2 周                                               |
| AI Agent 自主新建 ai-app 时间                                 | < 6 小时                   | vs 现状不可行                                                |
| playground 业务代码总行数（含 hook，不含 SKILL.md）           | **< 3000 行**              | vs 现状 ~5000 行（v2 估 < 2500 不切实际，hook 估 1500-2000） |
| harness/teams/orchestrator/mission-pipeline-orchestrator 行数 | < 600 行                   |                                                              |
| 每个 stage primitive 平均行数（happy-path）                   | < 250 行                   | 业务专属逻辑通过 hook 注入                                   |
| **harness/engine/infra 业务词命中数（永久门槛）**             | **0**                      | base-layer-business-leakage.spec 守门                        |
| 全量 spec 通过率                                              | 100%（行为零回退）         | —                                                            |
| **playground 前台改动**                                       | **0 行**                   | 用户决策 3：前台/接口/行为零变化                             |
| **playground 后台对前台 API 改动**                            | **0 个 endpoint 签名变化** | 用户决策 3                                                   |

### 1.3 非目标

- **不做 R4 用户自定义 Agent 实施**（设计完整保留在本文档 §3.8 / §3.9，phase 2 启动）
- 不做 harness 顶层结构调整（W17 已完成）
- 不做 prisma schema 大重构
- 不做对外 SDK 包发布
- 不做 generic mission_runs 表
- 不做 NestJS forFeature dynamic module（spike 即使通过也不做）

---

## §2 用户体验（三视图）

### 2.1 视图 A：开发者新建 ai-app（phase 1 落地）

见 §1.1 北极星代码示例。**< 15 文件 + ~250 行业务代码**（不含 hook 和 SKILL.md）即可拉起新 mission-style ai-app。

### 2.2 视图 B：playground 用户（phase 1 期间，零变化）

playground 用户**完全感知不到改造**：

- URL 不变（`/playground`、`/api/v1/agent-playground/*`）
- 事件 type 不变（`agent-playground.mission:failed` 等 27+ 个）
- payload 字段不变（含 `failureCode` 取值集合）
- WebSocket namespace 不变
- 数据库表不变（`agent_playground_missions / events / leader_chats`）
- 报告产物 schema 不变

详见 §3.7 前端事件兼容性契约。

### 2.3 视图 C：高级用户在前台自定义 Agent（phase 2 落地）

通过 **AI 配置 → Agent tab → 创建向导（5 步）** 创建自定义 Agent。详见 §3.8 / §3.9 完整设计。**phase 2 启动**。

---

## §3 架构设计

### §3.1 三层抽象 + L3.5 元层

```
┌─────────────────────────────────────────────────────────┐
│  L3 ai-app/<my-team>/        平台预置 ai-app 层         │
│    ├── <team>.config.ts                                 │
│    ├── <team>.controller.ts (薄壳)                      │
│    ├── <team>.module.ts                                 │
│    ├── <team>-mission.store.ts (impl IMissionStore)     │
│    ├── skills/*.skill.md                                │
│    └── 业务 hook services / business prisma model       │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  L3.5 ai-app/_meta/   ★ 新分类（v3 R4 启用，phase 2）   │
│    └── custom-agents/                                   │
│        ├── custom-agents.controller.ts                  │
│        ├── custom-agents.module.ts                      │
│        ├── custom-agent-config.service.ts               │
│        ├── custom-agent-mission.store.ts                │
│        │   (impl IMissionStore, scoped by agentConfigId)│
│        ├── user-skill.service.ts                        │
│        │   (impl ISkillProvider for SkillRegistry)      │
│        └── custom-agent.config-builder.ts               │
│            (CustomAgentConfig.config Json →             │
│             SerializableMissionPipelineConfig)          │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  L2.5 ai-harness                                        │
│    ├── teams/orchestrator/                              │
│    │     ├── mission-pipeline-orchestrator.service.ts   │
│    │     ├── (existing) adaptive-replanner.service.ts   │
│    │     └── (existing) teams-mission-orchestrator.ts   │
│    ├── teams/services/stages/                           │
│    │     ├── plan / research / assess / synthesize /    │
│    │     │   draft / review / signoff stage-primitive   │
│    │     └── stage-primitive.interface.ts               │
│    ├── teams/registry/                                  │
│    │     ├── (existing) team-registry.ts                │
│    │     └── mission-pipeline-registry.ts (★ 新)        │
│    ├── lifecycle/mission-lifecycle/                     │
│    │     ├── abstractions/                              │
│    │     │     ├── mission-store.interface.ts (★ 新)    │
│    │     │     └── mission-event-store.interface.ts (★) │
│    │     ├── mission-rerun-orchestrator.service.ts (★)  │
│    │     ├── (existing) abort/ownership/health/orphan   │
│    │     └── (existing) failure-learner / postmortem    │
│    └── facade/                                          │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  L2 ai-engine                                           │
│    ├── skills/                                          │
│    │     ├── skill-spec-builder.service.ts (★ R1-A0)    │
│    │     ├── output-schema-registry.ts     (★ R1-A0)    │
│    │     ├── (existing) skill-activator.service.ts      │
│    │     └── (existing) skill.registry.ts               │
│    ├── (existing) tools/registry/                       │
│    └── (existing) llm/services/                         │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  L1 ai-infra (existing, 不动)                           │
└─────────────────────────────────────────────────────────┘

★ v5 新增双根目录（不属于任何 layer，是平台基础设施）：

┌─────────────────────────────────────────────────────────┐
│  src/plugin-core/   平台 plugin 内核（非业务 module）     │
│    ├── abstractions/ (IPlugin / IPluginManifest /        │
│    │                  IPluginContext / HookId 等)        │
│    ├── hook-bus/      (HookBus + HookTrace)              │
│    ├── registry/      (PluginRegistry + 拓扑解析)        │
│    ├── loader/        (PluginLoader + manifest 校验)     │
│    ├── lifecycle/     (PluginSupervisor + 熔断)          │
│    ├── security/      (Capability gate + 签名校验预留)   │
│    └── plugin-core.module.ts                             │
│                                                          │
│    特征：                                                 │
│    • 不依赖 harness/engine/infra/ai-app 任何业务符号       │
│    • 仅暴露 IPlugin / HookBus / PluginRegistry            │
│    • 启动期被 AppModule 直接 import（先于 harness）        │
└─────────────────────────────────────────────────────────┘
                       ↓ 加载 plugin
┌─────────────────────────────────────────────────────────┐
│  src/plugins/   plugin 实现（按 8 大域子目录分类）         │
│    ├── observability/   telemetry-otel / eval / latency... │
│    ├── resilience/      rate-limit / circuit-breaker...  │
│    ├── security/        sandbox / tool-permission...     │
│    ├── storage/         memory-redis / event-journal...  │
│    ├── rag-backend/     embedding / vector...            │
│    ├── llm-augment/     multi-key / pricing...           │
│    ├── tool-augment/    validation / timeout...          │
│    └── plugins.config.yaml  (项目级启用清单)              │
│                                                          │
│    每个 plugin 形态：                                     │
│    plugins/<domain>/<plugin-id>/                         │
│      ├── plugin.ts     (IPlugin 实现)                    │
│      ├── manifest.ts   (IPluginManifest 静态对象)         │
│      ├── config.schema.ts (zod)                          │
│      ├── README.md                                       │
│      └── __tests__/                                      │
└─────────────────────────────────────────────────────────┘
                       ↓ 通过 hook 注入
                  harness / engine
```

**严守 §0**：harness / engine / infra 全 grep 0 命中 ai-app 名 / 中文文案 / emoji。
**v5 新增严守**：harness / engine 不得直接 import `src/plugins/<...>` 具体实现；plugin 不得直接 import harness/engine 内部路径，只能通过 hook 接口接入。架构看护见 §11.13。

### §3.2 7 个 stage primitive + hook 注入

每个 primitive 是 `IStagePrimitive` 实现，输入 `(ctx, config)` 输出 stage outputs。

| Primitive    | 职责（generic）                                                          | 输入 ctx 字段            | 输出 ctx 字段                      | hook 注入点                                                       |
| ------------ | ------------------------------------------------------------------------ | ------------------------ | ---------------------------------- | ----------------------------------------------------------------- |
| `plan`       | 调 leader-style role 输出 dimensions / goals                             | invariants               | `plan: { dimensions, goals, ... }` | `extractDecision`（stateful role 自动）                           |
| `research`   | 按 fanOut 策略 fan-out × N 调 worker role                                | plan                     | `researcherResults[]`              | `perItemPipeline`、`onPatchFailure`                               |
| `assess`     | 调 leader-style role 评估前序产出，决定 retry/abort/continue             | plan + researcherResults | `assessDecision`                   | `dispatchAssessActions`（含 4 路 action 处理）                    |
| `synthesize` | 跨产出聚合，mode 参数（reconcile / analyze）                             | 前序 ctx                 | `synthesisOutput`                  | `singleDimensionShortCircuit`、`compressIfNeeded`                 |
| `draft`      | 调 writer-style role 生成 artifact，含 reflexion + judge consensus retry | 前序 ctx                 | `draft / artifact`                 | `judgeConsensusRetry`、`memoryIndexer`、`reportArtifactAssembler` |
| `review`     | 调 reviewer-style role 评分 + 可选 enhancement hook                      | draft                    | `reviewVerdict`                    | `afterReview`、`scoreScaling`、`objectiveEvalInjection`           |
| `signoff`    | 调 leader-style role 终审 + accountability                               | 全 ctx                   | `signoff`                          | `accountability`（引用 ctx.crossStageState 中的所有累计副作用）   |

**内置无 LLM stage**：

- `persist`：写 IMissionStore.markCompleted/markFailed
- `learn`：异步 fire-and-forget，触发 FailureLearner + memory consolidation；hook：`postmortemClassifier`

**关键设计**：

- 每个 primitive 含核心 happy-path < 250 行
- 业务专属逻辑通过 **hook + crossStageState** 注入
- hook 由 ai-app 提供 SKILL.md 或 service，registry 按 stage 名查找

```typescript
// harness/teams/services/stages/stage-primitive.interface.ts
export interface IStagePrimitive<TIn = unknown, TOut = unknown> {
  readonly id: string;
  run(args: {
    ctx: MissionContext<TIn>;
    role: ResolvedRole;
    config: StageStepConfig;
    hooks: ResolvedHooks;
    crossStageState: CrossStageState;  // ★ v3 新增
  }): Promise<TOut>;
}

// harness/teams/services/stages/abstractions/cross-stage-state.ts
export class CrossStageState {
  // generic key-value 存储，accountability hook 可读所有 stage 写入的副作用
  private readonly store = new Map<string, unknown>();
  set<T>(key: string, value: T): void { ... }
  get<T>(key: string): T | undefined { ... }
  append<T>(key: string, item: T): void { ... }  // for accumulators
}
```

playground hook 写入 crossStageState 业务字段（如 `s4PatchFailures`）：

```typescript
// ai-app/agent-playground/hooks/playground-stage-hooks.ts
export const PLAYGROUND_HOOKS = {
  research: {
    onPatchFailure: ({ ctx, error, dimension, crossStageState }) => {
      crossStageState.append("playground.s4PatchFailures", {
        dimensionId: dimension.id,
        reason: error.message,
        ...
      });
    },
  },
  signoff: {
    accountability: ({ ctx, role, crossStageState }) => {
      const patchFailures = crossStageState.get("playground.s4PatchFailures") ?? [];
      const decisions = ctx.statefulRoleStates[role.id]?.decisions ?? [];
      // 业务规则：patchFailures.length > 0 强制 quality-degraded
      return { ..., forcedDegraded: patchFailures.length > 0, ... };
    },
  },
};
```

### §3.3 SKILL.md 单一真相源 + SkillSpecBuilder

#### 3.3.1 SKILL.md 标准格式（Anthropic-compat）

```markdown
---
name: agent-playground.leader
description: playground 写作 mission 的 Leader
version: "1.0"
allowedTools: [web-search, library-search]
allowedModels: [claude-sonnet-4-6, gpt-5]
activateFor: [leader]
outputSchemaRef: agent-playground.leader-output
---

# Leader 灵魂

...

# Phase: plan

...

# Phase: signoff

{{#if previousDecisions}}

## 你过去的决策（必须引用）

{{#each previousDecisions}}

- [{{phase}}] {{decision}} — {{rationale}}
  {{/each}}
  {{/if}}
  ...
```

#### 3.3.2 R1-A0 必备底座

```typescript
// engine/skills/skill-spec-builder.service.ts
@Injectable()
export class SkillSpecBuilder {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly outputSchemaRegistry: OutputSchemaRegistry,
  ) {}

  build(skill: ISkill): IAgentSpec {
    return {
      id: skill.frontmatter.name,
      systemPrompt: skill.instructions,
      allowedTools: this.resolveAllowedTools(skill.frontmatter.allowedTools),
      allowedModels: skill.frontmatter.allowedModels,
      outputSchema: skill.frontmatter.outputSchemaRef
        ? this.outputSchemaRegistry.get(skill.frontmatter.outputSchemaRef)
        : z.unknown(),
    };
  }

  private resolveAllowedTools(ids: readonly string[] | undefined): IToolRef[] {
    if (!ids) return this.toolRegistry.getAll();  // 默认全开
    return ids.map(id => this.toolRegistry.requireById(id));
  }
}

// engine/skills/output-schema-registry.ts
@Injectable()
export class OutputSchemaRegistry {
  private readonly schemas = new Map<string, z.ZodType>();

  register(id: string, schema: z.ZodType): void {
    if (this.schemas.has(id)) {
      throw new Error(`OutputSchema id collision: ${id}`);
    }
    this.schemas.set(id, schema);
  }

  get(id: string): z.ZodType {
    const s = this.schemas.get(id);
    if (!s) throw new Error(`OutputSchema not found: ${id}`);
    return s;
  }

  has(id: string): boolean { ... }
}
```

ai-app 在 onModuleInit 注册自己的 outputSchema：

```typescript
// ai-app/agent-playground/agent-playground.module.ts
onModuleInit() {
  this.outputSchemaRegistry.register("agent-playground.leader-plan-output", LeaderPlanOutputSchema);
  this.outputSchemaRegistry.register("agent-playground.leader-assess-output", LeaderAssessOutputSchema);
  this.outputSchemaRegistry.register("agent-playground.leader-foreword-output", LeaderForewordOutputSchema);
  this.outputSchemaRegistry.register("agent-playground.leader-signoff-output", LeaderSignoffOutputSchema);
  // ...
}
```

#### 3.3.3 SKILL.md 加载链

```
ai-app SKILL.md 文件 (frontmatter + body)
  ↓
SkillActivator (existing) parses → ISkill
  ↓
SkillSpecBuilder.build(skill) → IAgentSpec
  ↓
AgentRunner.run(spec, input, ctx)
```

**用户自定义 SKILL.md**（phase 2）走同一链路（DB-backed via UserSkillProvider），见 §3.9。

### §3.4 stateful agent runtime + 跨 stage state 持久化

#### 3.4.1 两类 state 解决方案

| state 类型                   | 例子                                                                                                                | 解决方案                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **stateful role decisions**  | leader 跨 plan/assess/foreword/signoff 的 decisions[]                                                               | `ctx.statefulRoleStates[roleId].decisions[]` + IMissionStore.appendDecision 持久化 |
| **cross-stage side effects** | s4PatchFailures（researcher 副作用累计）/ s4PatchRound（leader 全局上限计数）/ outlinePlan（s7 → s8 跨 stage 数据） | `ctx.crossStageState` 通用容器 + IMissionStore.saveCrossStageState 持久化          |

#### 3.4.2 IMissionStore 端口扩展

```typescript
// harness/lifecycle/mission-lifecycle/abstractions/mission-store.interface.ts
export interface IMissionStore<TMission = unknown> {
  // existing: create / getById / listByUser / markCompleted / markFailed / heartbeat / recover

  // ★ v3 新增：stateful state 持久化
  appendDecision(
    missionId: string,
    roleId: string,
    decision: PastDecision,
  ): Promise<void>;
  getDecisions(missionId: string, roleId: string): Promise<PastDecision[]>;
  saveCrossStageState(
    missionId: string,
    key: string,
    value: unknown,
  ): Promise<void>;
  getCrossStageState(missionId: string): Promise<Record<string, unknown>>;
  // 业务专属 method 通过 extension（如 playground 的 appendDimensions）
}
```

#### 3.4.3 playground 表 schema 扩展（手写迁移）

```sql
-- migrations/2026_05_R1_C/migration.sql
ALTER TABLE agent_playground_missions
  ADD COLUMN role_decisions_json JSONB DEFAULT '{}',
  ADD COLUMN cross_stage_state_json JSONB DEFAULT '{}';

-- role_decisions_json 形态: { "leader": [PastDecision, ...] }
-- cross_stage_state_json 形态: { "playground.s4PatchFailures": [...], "playground.s4PatchRound": 2, ... }
```

#### 3.4.4 PlaygroundMissionStore 实现

```typescript
@Injectable()
export class PlaygroundMissionStore implements IMissionStore<AgentPlaygroundMission> {
  async appendDecision(
    missionId: string,
    roleId: string,
    decision: PastDecision,
  ): Promise<void> {
    await this.prisma.$queryRaw`
      UPDATE agent_playground_missions
      SET role_decisions_json = jsonb_set(
        COALESCE(role_decisions_json, '{}'::jsonb),
        ${`{${roleId}}`}::text[],
        COALESCE(role_decisions_json -> ${roleId}, '[]'::jsonb) || ${JSON.stringify(decision)}::jsonb
      )
      WHERE id = ${missionId}
    `;
  }
  // ...
}
```

#### 3.4.5 stage primitive 自动注入 stateful state

```typescript
// harness/teams/services/stages/plan.stage-primitive.ts
async run({ ctx, role, config, hooks, crossStageState }) {
  const previousDecisions = role.stateful
    ? (await ctx.store.getDecisions(ctx.missionId, role.id))
    : [];

  const renderedPrompt = renderSkill(role.skill, { previousDecisions, ... });
  const result = await runner.run(spec, input, { ... });

  if (role.stateful && hooks.extractDecision) {
    const decision = hooks.extractDecision({ result, phase: "plan" });
    await ctx.store.appendDecision(ctx.missionId, role.id, decision);
    ctx.statefulRoleStates[role.id].decisions.push(decision);
  }

  return result;
}
```

#### 3.4.6 崩溃 resume

```typescript
// MissionPipelineOrchestrator.resume(missionId)
async resume(missionId: string) {
  const ctx = await this.hydrateContext(missionId);
  // hydrate:
  // - mission row
  // - role_decisions_json → ctx.statefulRoleStates
  // - cross_stage_state_json → ctx.crossStageState
  // - lastCompletedStage → 跳过已完成 primitive
  return this.runPipelineFrom(ctx, lastCompletedStage + 1);
}
```

### §3.5 数据模型：每 ai-app 自有表 + IMissionStore 端口

按 v1 评审 P0-3，不做 generic mission_runs 表。

#### 3.5.1 IMissionStore 端口（核心）

```typescript
// harness/lifecycle/mission-lifecycle/abstractions/mission-store.interface.ts
export interface IMissionStore<TMission = unknown> {
  create(input: MissionCreateInput): Promise<TMission>;
  getById(id: string, userId: string): Promise<TMission | null>;
  listByUser(userId: string, opts?: ListOpts): Promise<TMission[]>;
  markCompleted(id: string, result: MissionResult): Promise<void>;
  markFailed(id: string, error: MissionError): Promise<void>;
  markCancelled(id: string, reason: string): Promise<void>;
  refreshHeartbeat(id: string, podId: string): Promise<void>;
  recoverOrphanedRunning(thresholdMin: number): Promise<number>;
  recoverPodCrashedRunning(staleSec: number): Promise<number>;

  // stateful state（§3.4）
  appendDecision(
    missionId: string,
    roleId: string,
    decision: PastDecision,
  ): Promise<void>;
  getDecisions(missionId: string, roleId: string): Promise<PastDecision[]>;
  saveCrossStageState(
    missionId: string,
    key: string,
    value: unknown,
  ): Promise<void>;
  getCrossStageState(missionId: string): Promise<Record<string, unknown>>;
}
```

#### 3.5.2 ai-app 自有表 + 实现

playground 保留 `agent_playground_missions` 表 + 加 `role_decisions_json / cross_stage_state_json` 列。`PlaygroundMissionStore implements IMissionStore<AgentPlaygroundMission>`。

writing-team（R3-A demo）建自己的 `writing_team_missions` 表 + `WritingMissionStore implements IMissionStore<WritingMission>`。

#### 3.5.3 用户自定义 Agent generic 表（phase 2 R4，详见 §3.9）

custom-agents 模块用 generic `custom_agent_missions` 表，**但产物拆 `custom_agent_artifacts` 表**（v2 评审 P0-D）。

### §3.6 控制层：薄壳 controller in ai-app

按 v1 评审 P0-2，不做 DynamicMissionController。

```typescript
// ai-app/agent-playground/agent-playground.controller.ts (~30 行薄壳)
@Controller("agent-playground")
@UseGuards(JwtAuthGuard)
export class AgentPlaygroundController {
  constructor(
    private readonly orchestrator: MissionPipelineOrchestrator,
    @Inject(PLAYGROUND_CONFIG_TOKEN) private readonly config: MissionPipelineConfig,
  ) {}

  @Post("team/run")
  run(@Body() dto: unknown, @Request() req: RequestWithUser) {
    return this.orchestrator.run(this.config, dto, req.user.id);
  }

  @Get("missions")
  list(@Request() req: RequestWithUser) {
    return this.orchestrator.listMissions(this.config.id, req.user.id);
  }

  // ... 其他 endpoint thin wrapper
}

// PLAYGROUND_CONFIG_TOKEN 是 module 内定义的 string DI token
export const PLAYGROUND_CONFIG_TOKEN = "PLAYGROUND_CONFIG";

@Module({
  providers: [
    { provide: PLAYGROUND_CONFIG_TOKEN, useValue: PlaygroundConfig },
    AgentPlaygroundController,
    // ...
  ],
})
```

### §3.7 前端事件兼容性契约

> **决策 3 强约束**：playground 改造期间，前台对后台依赖**完全不变**。

#### 3.7.1 Endpoint 契约（byte-equal 保留）

playground REST endpoints（13 个）：

```
GET    /api/v1/agent-playground/missions
GET    /api/v1/agent-playground/missions/resumable
GET    /api/v1/agent-playground/missions/:id
GET    /api/v1/agent-playground/missions/:id/export?format=...
POST   /api/v1/agent-playground/dev/trigger-mission
POST   /api/v1/agent-playground/team/run
POST   /api/v1/agent-playground/missions/:id/rerun
POST   /api/v1/agent-playground/missions/:id/todos/:todoId/rerun
POST   /api/v1/agent-playground/missions/:id/todos/:todoId/local-rerun
POST   /api/v1/agent-playground/missions/:id/cancel
DELETE /api/v1/agent-playground/missions/:id
PATCH  /api/v1/agent-playground/missions/:id
GET    /api/v1/agent-playground/replay/:missionId
GET    /api/v1/agent-playground/missions/:id/leader-chat
POST   /api/v1/agent-playground/missions/:id/leader-chat
```

**v3 约束**：所有路径 + 请求 body 字段 + 响应 body 字段保持 byte-equal。

#### 3.7.2 WebSocket 事件契约（27+ 个 event type）

```
agent-playground.mission:started
agent-playground.mission:completed
agent-playground.mission:failed
agent-playground.mission:cancelled
agent-playground.mission:rejected
agent-playground.mission:warning
agent-playground.mission:budget-warning-soft
agent-playground.mission:budget-warning-hard
agent-playground.mission:manual-rerun-from-todo
agent-playground.mission:evolved
agent-playground.stage:started
agent-playground.stage:completed
agent-playground.agent:lifecycle
agent-playground.agent:thought
agent-playground.agent:action
agent-playground.agent:observation
agent-playground.agent:reflection
agent-playground.agent:error
agent-playground.agent:narrative
agent-playground.agent:validation-rejected
agent-playground.cost:tick
agent-playground.tools:recalled
agent-playground.iteration:progress
agent-playground.dimension:graded
agent-playground.dimension:retrying
agent-playground.dimension:degraded
agent-playground.dimensions:appended
agent-playground.reconciliation:skipped
agent-playground.reconciliation:completed
agent-playground.chapter:writing:started
agent-playground.chapter:writing:completed
agent-playground.chapter:review:started
agent-playground.chapter:review:completed
agent-playground.chapter:revision
agent-playground.chapter:done
agent-playground.report:draft
agent-playground.memory:indexed
agent-playground.leader:goals-set
agent-playground.leader:decision
agent-playground.leader:foreword
agent-playground.leader:signed
agent-playground.leader:rejected-revision-recommended
agent-playground.verifier:verdict
```

**v3 约束**：所有 event type 字符串 + payload 字段名 + payload 取值集合（如 `failureCode` 的所有可能值）byte-equal 保留。

#### 3.7.3 兼容性强制 spec

新建 `backend/src/__tests__/architecture/playground-frontend-contract.spec.ts`：

- 启动时遍历 `agent-playground.events.ts` 注册的 event type，断言完全等于 v2 evolution 之前的快照
- 对每个 endpoint 写 schema 校验 spec（输入 / 输出 / 状态码）
- 改造期间任何破坏跑红 → 阻止合并

### §3.8 前台 Agent 配置 UI 设计（phase 2 实施）

> **设计完整覆盖，但 phase 2 启动**。

#### 3.8.1 AI 配置页 4 个 tab

```
设置 → AI 配置
  ├── BYOK            (existing)
  ├── 模型             (existing)
  ├── Agent           (★ phase 2 新增)
  └── 偏好             (existing)
```

#### 3.8.2 Agent tab 内容

```
我的 Agent
[Agent A] [Agent B] [+ 创建]

平台模板
[📊 PPT 团队] [📝 写作团队] [🔍 研究团队]
```

#### 3.8.3 创建 Agent 5 步向导

```
Step 1: 选类型     [Mission 团队] (MVP 仅此)
Step 2: 选模板     [playground / writing-team / 空白 / 我的复制]
Step 3: 基本信息   名称 / 图标 / 描述 / 左侧菜单分组
Step 4: 角色配置   每角色: SKILL.md 编辑器 + tools picker + models picker + outputSchema picker
Step 5: Topic schema + 预览
```

#### 3.8.4 Step 4 双模式 SKILL.md 编辑器（v3 修订）

**简单模式**（v3 修订：补全 frontmatter 引导）：

```
[5 引导问题（生成 instructions body）]
1. 角色是谁?
2. 主要职责?
3. 输出格式?
4. 拒绝什么?
5. 风格?

[frontmatter wizard（生成 frontmatter）]
- 允许工具: [☑ web-search ☑ library-search] (从 ToolRegistry 拉)
- 允许模型: [☑ claude-sonnet-4-6] (从用户 BYOK 模型列表拉)
- 输出格式:
  ○ 自由文本 (outputSchemaRef = null)
  ○ 平台预置 schema 选择 (从 OutputSchemaRegistry 列出已注册)
  ○ 自定义 JSON schema (Step 5 风格 form-builder)
- 激活时机 (activateFor): [☑ leader] (从 Step 4 角色列表拉)
```

向导聚合 5 引导 + frontmatter wizard → 生成完整 SKILL.md → 存 `user_skills` 表。

**高级模式**：Monaco markdown 编辑器，用户自己写完整 SKILL.md。

#### 3.8.5 Step 5 Topic schema 编辑器（v3 修订，**P0-NEW-2 修订**）

**MVP 字段类型扩展（覆盖 playground 现有 RunMissionInputSchema 全部字段）**：

支持类型：`string | number | boolean | enum | array<string>`

每种类型可选约束：
| 类型 | 可选约束 |
|---|---|
| `string` | minLength / maxLength / pattern / default |
| `number` | min / max / int (boolean) / default |
| `boolean` | default |
| `enum` | values[] (string array) / default |
| `array<string>` | maxItems / itemPattern / default |

**UI 表格示例**（覆盖 playground RunMissionInputSchema 全 15 字段）：

```
[+ 添加字段]
field name              | type           | constraint          | required | default      | description
------------------------|----------------|---------------------|----------|--------------|-------------
topic                   | string         | min=2, max=200      | ☑       |              | 研究主题
depth                   | enum           | quick/standard/deep | ☑       | deep         | 深度档位
language                | enum           | zh-CN/en-US         | ☑       | zh-CN        | 语言
budgetProfile           | enum           | (6 个值)             | ☑       | medium       | 预算档位
styleProfile            | enum           | (4 个值)             | ☑       | executive    | 风格
lengthProfile           | enum           | (6 个值)             | ☑       | standard     | 长度档位
audienceProfile         | enum           | (3 个值)             | ☑       | domain-expert| 受众
withFigures             | boolean        | —                   | ☑       | true         | 是否生成图表
auditLayers             | enum           | (4 个值)             | ☑       | default      | 审计层级
concurrency             | number         | int, min=1, max=10  | ☑       | 3            | 并发度
viewMode                | enum           | (3 个值)             | ☑       | continuous   | 视图模式
maxCredits              | number         | int, max=10000      | ☐       |              | 最大配额
wallTimeMs              | number         | int, min=60000, max=10800000 | ☐ |       | wall-time
budgetMultiplierOverride| number         | min=0.3, max=10     | ☐       |              | 预算倍率覆盖
knowledgeBaseIds        | array<string>  | maxItems=10, uuid   | ☐       |              | 知识库 ID 列表
```

**UI 转 JSON Schema 输出示例**：

```json
{
  "type": "object",
  "required": ["topic", "depth", "language", ...],
  "properties": {
    "topic": { "type": "string", "minLength": 2, "maxLength": 200 },
    "depth": { "type": "string", "enum": ["quick", "standard", "deep"], "default": "deep" },
    "withFigures": { "type": "boolean", "default": true },
    "concurrency": { "type": "integer", "minimum": 1, "maximum": 10, "default": 3 },
    "knowledgeBaseIds": {
      "type": "array",
      "items": { "type": "string", "format": "uuid" },
      "maxItems": 10
    }
  }
}
```

**MVP 不支持**（由 §3.9.1 caveat 处理）：

- nested object（`{ user: { name, age } }`）
- cross-field refinement（`.refine(d => d.depth !== "deep" || d.budget !== "low")`）
- transform / preprocess / superRefine

**后端用 `JSON Schema → zod` 转换器**（runtime 转换，不存 zod 实例到 DB）。

**复制平台模板时的有损警告**（与 §3.9.1 配合）：

- 复制 playground 模板时，UI 给用户 warning：「平台模板含 X 个跨字段约束 / refinement，复制后将丢失，需手动重新声明」

#### 3.8.6 左侧菜单动态项

```typescript
// frontend/components/layout/sidebar.tsx
const { data: customAgents } = useQuery({
  queryKey: ["custom-agents"],
  queryFn: () => fetch("/api/v1/custom-agents"),
  staleTime: 5 * 60 * 1000,  // 5 分钟缓存
});

return (
  <Sidebar>
    <PlatformSection />
    {customAgents.length > 0 && (
      <Section title="我的 Agent" collapsible>
        {customAgents.map(a => (
          <SidebarItem key={a.id} icon={a.icon} label={a.name} href={`/agent/${a.id}`} />
        ))}
      </Section>
    )}
  </Sidebar>
);
```

#### 3.8.7 Agent 运行页（generic MissionUI）

```
GET /agent/:id
  → 渲染:
    Topic 输入表单（按 config.topicSchema 自动生成 form）
    历史 Missions 列表

GET /agent/:id/missions/:missionId
  → 复用 playground 同款 MissionDetailPage 组件（已是 config-driven）
```

### §3.9 用户自定义 Agent 数据模型 + API（phase 2 实施）

> **设计完整覆盖，但 phase 2 启动**。

#### 3.9.1 SerializableMissionPipelineConfig 子集类型（v3 关键）

v2 评审 P0-C 致命问题：`MissionPipelineConfig` 含 zod 实例 / function refs，不可 JSON 序列化。

**v3 修订**：定义 `SerializableMissionPipelineConfig` 子集类型，只允许可序列化字段：

```typescript
// L3.5 ai-app/_meta/custom-agents/abstractions/serializable-mission-pipeline-config.ts
export interface SerializableMissionPipelineConfig {
  id: string;
  endpointPrefix: string;
  eventPrefix: string;
  topicSchemaJsonSchema: JsonSchemaObject; // ★ 用 JSON Schema 而不是 zod
  roles: SerializableRoleSpec[];
  pipeline: SerializableStageStep[];
  hooks?: Record<string, { skillId: string }>; // ★ 仅 skillId 引用，不允许 function
  postmortemPatterns?: PostmortemPatterns;
}

export interface SerializableRoleSpec {
  id: string;
  skillId: string; // ★ 引用 SKILL.md（user_skills 或 builtin）
  loop: "react" | "reflexion" | "leader-worker" | "simple";
  concurrency?: number;
  stateful?: boolean;
}
```

custom-agent.config-builder.ts 把 `SerializableMissionPipelineConfig` runtime 转换为 `MissionPipelineConfig`：

- `topicSchemaJsonSchema` → zod schema（用 `json-schema-to-zod` 库或自写转换器）
- `storeFactory` → 固定 `CustomAgentMissionStore`（所有用户自定义 Agent 共用）
- `hooks.skillId` → SkillRegistry.lookup() 返回的 skill 实例

**关键限制**：用户自定义 Agent 不能有自己的 storeFactory（所有走 generic store）；hook 只能引用 SKILL.md 不能写 function 代码。

#### 3.9.2 prisma 表

```prisma
model CustomAgentConfig {
  id              String   @id @default(uuid())
  userId          String
  workspaceId     String?
  name            String
  description     String?
  icon            String?
  templateId      String?    // 引用平台模板 id
  configJson      Json       // SerializableMissionPipelineConfig
  status          String     // 'draft' | 'active' | 'archived'
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
  @@index([userId, status])
  @@map("custom_agent_configs")
}

model UserSkill {
  id              String   @id @default(uuid())
  userId          String
  name            String   // SKILL.md frontmatter.name
  frontmatterJson Json
  instructions    String   @db.Text
  injectionScanResult Json?  // ★ v3 新增：prompt-injection scanner 结果
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([userId, name])
  @@map("user_skills")
}

model CustomAgentMission {
  id              String   @id @default(uuid())
  agentConfigId   String
  userId          String
  workspaceId     String?
  topicJson       Json     // 按 config.topicSchemaJsonSchema 校验
  status          String
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  // ★ v3：metadata 仅小字段（< 5KB），大产物拆 artifacts 表
  smallMetadataJson Json?
  heartbeatAt     DateTime?
  podId           String?
  roleDecisionsJson    Json @default("{}")
  crossStageStateJson  Json @default("{}")
  @@index([agentConfigId, userId, startedAt])
  @@map("custom_agent_missions")
}

// ★ v3 新增：拆分大产物（修订 v2 评审 P0-D）
model CustomAgentMissionArtifact {
  id           String   @id @default(uuid())
  missionId    String
  artifactType String   // 'report' | 'reconciliation' | 'verdicts' | ...
  content      String   @db.Text  // 报告等大字符串走单独 column；超过 1MB 走对象存储
  storageRef   String?  // 对象存储引用（content 超过 size 阈值时使用）
  createdAt    DateTime @default(now())
  @@index([missionId, artifactType])
  @@map("custom_agent_mission_artifacts")
}

model CustomAgentMissionEvent {
  id          String   @id @default(uuid())
  missionId   String
  type        String
  agentId     String?
  payloadJson Json
  ts          BigInt
  @@index([missionId, ts])
  @@map("custom_agent_mission_events")
}
```

#### 3.9.3 后端 API（在 L3.5 ai-app/\_meta/custom-agents/）

```
ai-app/_meta/custom-agents/
  ├── custom-agents.controller.ts
  ├── custom-agents.module.ts
  ├── abstractions/serializable-mission-pipeline-config.ts
  ├── custom-agent.config-builder.ts
  ├── custom-agent-mission.store.ts (impl IMissionStore, scoped by agentConfigId)
  ├── user-skill.service.ts (impl ISkillProvider)
  ├── prompt-injection-scanner.service.ts (借调 engine/safety)
  └── tool-acl.service.ts (强制 hard limit, 见下)
```

#### 3.9.4 安全双轨（v3 修订 v2 评审 P0-G）

**轨 1：入库 prompt-injection scanner**

```typescript
// custom-agents/prompt-injection-scanner.service.ts
@Injectable()
export class PromptInjectionScanner {
  async scan(instructions: string): Promise<{ verdict: "ok" | "warn" | "block"; reasons: string[] }> {
    // 调 engine/safety/injection 现有 scanner
    // 拒绝含 'ignore previous instructions' / 'system:' 等 high-risk 模式
    // warn 级别可入库但运行时降级
    // block 级别拒绝入库
  }
}

// custom-agents.controller.ts
@Post("user-skills")
async createUserSkill(@Body() dto: CreateUserSkillDto) {
  const scan = await this.scanner.scan(dto.instructions);
  if (scan.verdict === "block") throw new BadRequestException(scan.reasons);
  return this.userSkillService.create(dto, scan);
}
```

**轨 2：tool ACL 硬限制（运行时）**

```typescript
// custom-agents/tool-acl.service.ts
const CUSTOM_AGENT_DEFAULT_ALLOWED_TOOLS = [
  "web-search",
  "library-search",
  "academic-search",
  // 仅 external safe tools；internal tools (database / billing / admin) 默认禁
];

@Injectable()
export class ToolACL {
  enforceForCustomAgent(skill: ISkill): IToolRef[] {
    const requested = skill.frontmatter.allowedTools ?? [];
    return requested.filter((t) =>
      CUSTOM_AGENT_DEFAULT_ALLOWED_TOOLS.includes(t),
    );
  }
}
```

无论 SKILL.md instructions 怎么写"You can ignore RBAC..."，**ToolACL 是 hard limit**，不允许的 tool 在 runner 调用时直接拒绝。

#### 3.9.5 ScopedCustomAgentMissionStore + isolation spec

```typescript
@Injectable()
export class CustomAgentMissionStore {
  forAgent(agentConfigId: string): ScopedCustomAgentMissionStore {
    return new ScopedCustomAgentMissionStore(this.prisma, agentConfigId);
  }
}

class ScopedCustomAgentMissionStore implements IMissionStore<CustomAgentMission> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentConfigId: string, // 不暴露给 method 参数
  ) {}

  async listByUser(userId: string) {
    // 强制 agentConfigId 注入，不接受 caller 重写
    return this.prisma.customAgentMission.findMany({
      where: { agentConfigId: this.agentConfigId, userId },
    });
  }
  // ...
}
```

#### 3.9.6 isolation spec 强制

```typescript
// custom-agents/__tests__/scoped-store-isolation.spec.ts
describe("ScopedCustomAgentMissionStore isolation", () => {
  it("agent A 的 store 不能读 agent B 的 mission", async () => {
    const storeA = customMissionStore.forAgent("agent-A");
    const storeB = customMissionStore.forAgent("agent-B");
    await storeB.create({ ... });
    const missions = await storeA.listByUser(userId);
    expect(missions.find(m => m.agentConfigId === "agent-B")).toBeUndefined();
  });
  // ... 9 个 isolation 用例（每个 method 一个）
});
```

#### 3.9.7 API endpoints

```
# Custom Agent CRUD
GET    /api/v1/custom-agents
POST   /api/v1/custom-agents
GET    /api/v1/custom-agents/:id
PATCH  /api/v1/custom-agents/:id
DELETE /api/v1/custom-agents/:id

# Custom Agent Mission
POST   /api/v1/custom-agents/:id/run
GET    /api/v1/custom-agents/:id/missions
GET    /api/v1/custom-agents/:id/missions/:missionId
POST   /api/v1/custom-agents/:id/missions/:missionId/cancel
POST   /api/v1/custom-agents/:id/missions/:missionId/rerun
GET    /api/v1/custom-agents/:id/missions/:missionId/export

# User Skills
GET    /api/v1/user-skills
POST   /api/v1/user-skills
PATCH  /api/v1/user-skills/:id
DELETE /api/v1/user-skills/:id

# Templates Gallery
GET    /api/v1/agent-templates
GET    /api/v1/agent-templates/:id

# Tool Catalog (existing ToolRegistry expose)
GET    /api/v1/tool-catalog

# Output Schema Catalog (R1-A0 OutputSchemaRegistry expose)
GET    /api/v1/output-schemas
```

WebSocket namespace `/custom-agents`，事件 type `custom-agent.<configId>.*`（按 agentConfigId 隔离 routing）。

---

## §4 实施路径（phase 1 + phase 2）

### Phase 1：playground 改造（本轮实施）

#### R0 基本原则严守（10-12 天，必须先做）

- 4 个 Action（见 §0.3）
- 看护 1+2+3 实施
- 全量 spec + verify:arch + base-layer-business-leakage spec 通过

#### R0.5 Plugin 系统（v5 新增，1.5-2 周，必须在 R1 之前）

**目标**：内核接口就位 + 关键路径打 hook + 4 个高价值 plugin 落地（验证可行性），剩余 22 个 plugin 在 R0.5-E（R1 之后）批量迁出。

详细 PR 序列见 §11.12。摘要：

- **Stage 0**（3 PR）：plugin-core 内核（abstractions / HookBus / Registry / Loader / Supervisor）
- **Stage 1**（3 PR）：harness/engine 关键路径打 hook（TOOL / LLM / MISSION），保留旧实现双轨
- **Stage 2**（4 PR）：4 个高价值 plugin（telemetry-otel / tool-cache-redis / rate-limit / sandbox-isolated-vm）
- **Stage 3**（2 PR）：移除被 plugin 替代的 harness/engine 旧代码

R0.5 验收：

- plugin-core 全部 spec 通过；hook trace 在 dev 环境可观测
- 4 plugin 双轨期 e2e 全绿，p99 性能 < 旧实现 110%
- harness/tracing/otel/ + harness/guardrails/rate-limit/ + engine/tools/cache/ + engine/tools 内嵌 sandbox 旧代码全部移除
- 架构看护扩展：harness/engine 不得 import `src/plugins/`，plugin 不得 import harness/engine 内部路径

#### R1-A0 SkillSpecBuilder + OutputSchemaRegistry（3-5 天）

- engine/skills/skill-spec-builder.service.ts
- engine/skills/output-schema-registry.ts
- 单元测试

#### R1-A 7 个 stage primitive + crossStageState（5-7 天）

- harness/teams/services/stages/ 7 个 primitive
- CrossStageState 容器
- 单元 + integration spec

#### R1-B MissionPipelineOrchestrator + Config + Registry（4-6 天）

- harness/teams/orchestrator/mission-pipeline-orchestrator.service.ts
- harness/teams/registry/mission-pipeline-registry.ts
- defineMissionPipeline(config) helper
- 不 extends TeamConfig，独立类型

#### R1-C IMissionStore / IMissionEventStore 端口 + 持久化扩展（3 天）

- harness/lifecycle/mission-lifecycle/abstractions/mission-store.interface.ts（含 §3.4 stateful state methods）
- 把现有 PlaygroundMissionStore 改成 implements 该端口
- playground 表加 `role_decisions_json / cross_stage_state_json` 列 + 手写迁移

#### R1-D MissionRerunOrchestrator 通用化 + 前端契约 spec（3 天）

- mission-rerun-orchestrator generic 化
- 新增 `playground-frontend-contract.spec.ts`（§3.7）

#### R3-A writing-team demo（先于 R2，5-7 天）

- writing-team 完整实现（< 15 文件）
- e2e 跑通
- 暴露框架问题 → 修 R1

#### R2-A0 playground 18 → 8 SKILL.md 重组（3-5 天）

- 当前 18 个 soul/duty.md → 8 个 SKILL.md（leader / researcher / reconciler / analyst / writer / reviewer / verifier / steward）
- 逐字符对比 prompt 等价

#### R2-A playground.config.ts 双轨上线（5-7 天）

- 创建 playground.config.ts（注意：playground hook 含业务逻辑，约 1500-2000 行）
- prismaTable 指向 PlaygroundMissionStore（保持原表）
- eventPrefix = "agent-playground"（保持现有）
- endpointPrefix = "agent-playground"（保持现有）
- 双轨 feature flag 控制
- mission_runs.metadata 加 `runtime_version: 'legacy' | 'pipeline-v1'`

#### R2-B e2e 等价性验证（5-7 天 + 1 周观察）

- 9 路 mission 矩阵
- 等价性标准（v1 评审 P2-12，6 项行为等价）
- 双轨期至少观察 1 周

#### R2-C 删除 playground 旧实现（3-5 天）

- 删 team.mission.ts / 13 stage / mission-runtime-shell / mission-stage-bindings / mission-context / mission-deps / per-dim-pipeline / runner-state / narrative / report-artifact-sections / word-count-normalizer / duty-loader / 18 个 soul/duty.md
- 保留：playground.config.ts / 8 SKILL.md / 业务 hook services / playground-mission.store / business prisma model / dto / module / 薄 controller

### Phase 2：用户自定义 Agent UI（待 phase 1 稳定后启动）

#### R4-A 后端 ai-app/\_meta/custom-agents 模块（5-7 天）

- prisma：4 个表 + 手写迁移
- custom-agents.module.ts + controller.ts
- CustomAgentMissionStore + ScopedCustomAgentMissionStore
- UserSkillProvider implements ISkillProvider
- PromptInjectionScanner + ToolACL
- isolation spec

#### R4-B 前端 5 步向导（15-20 天 + 1-2 轮 UX iteration）

- frontend/app/settings/ai/agents/ 路径
- create wizard 5 步
- skill-editor 双模式（含 frontmatter wizard）
- topic-form key-value form-builder
- agent runtime 页面 `/agent/:id`（复用 generic MissionUI）
- 左侧菜单 customAgents 动态项

#### R4-C e2e + 用户验收（3-5 天）

- 用户从 0 创建 agent → 跑通 mission → 导出
- e2e playwright

---

## §5 playground 13 stage → 7 primitive 完整映射 + hook 行数估算

| playground stage            | harness primitive                      | hook 注入业务专属                                                                                     | hook 行数估 | playground SKILL.md                                |
| --------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------- |
| s1-budget                   | `persist`(pre) + 通用 budget guard     | budgetEstimator hook                                                                                  | 50          | —                                                  |
| s2-leader-plan              | `plan`                                 | extractDecision hook（plan）                                                                          | 30          | `agent-playground.leader@plan`                     |
| s3-researcher-collect       | `research` (fanOut="byPlanDimensions") | perItemPipeline hook（chapter writer + reviewer + integrator + 5-axis grade）                         | **450**     | `agent-playground.researcher` + 4 chapter SKILL.md |
| s4-leader-assess            | `assess`                               | dispatchAssessActions hook（4 路 action + s4PatchRound + s4PatchFailures 上报）                       | **300**     | `agent-playground.leader@assess`                   |
| s5-reconciler               | `synthesize` (mode="reconcile")        | singleDimensionShortCircuit hook                                                                      | 80          | `agent-playground.reconciler`                      |
| s6-analyst                  | `synthesize` (mode="analyze")          | retryOnceOnNullOutput hook                                                                            | 100         | `agent-playground.analyst`                         |
| s7-writer-outline           | `draft` (sub-stage="outline")          | thoroughPlusGate hook                                                                                 | 80          | `agent-playground.writer@outline`                  |
| s8-writer                   | `draft` (sub-stage="full")             | judgeConsensusRetry + memoryIndexer + reportArtifactAssembler                                         | **450**     | `agent-playground.writer@full`                     |
| s8b-quality-enhancement     | `review` 的 `afterReview` hook         | sectionSelfEval + sectionRemediation 调用                                                             | 200         | `agent-playground.quality-enhance`                 |
| s9-critic                   | `review` (mode="meta-critic")          | scoreScaling hook                                                                                     | 80          | `agent-playground.critic`                          |
| s9b-objective-eval          | `review` (mode="objective")            | objectiveEvalInjection hook                                                                           | 120         | `agent-playground.objective-eval`                  |
| s10-leader-foreword-signoff | `signoff`                              | accountability hook（引用 ctx.statefulRoleStates.leader.decisions + crossStageState.s4PatchFailures） | **180**     | `agent-playground.leader@signoff`                  |
| s11-persist                 | `persist`                              | —                                                                                                     | 0           | —                                                  |
| s12-self-evolution          | `learn`                                | postmortemClassifier + memoryConsolidation                                                            | 150         | —                                                  |

**hook 总行数估**：~2270 行
**playground.config.ts 行数估**：~150 行
**controller / module / store / dto 等总行数估**：~500 行
**8 SKILL.md** 不计入代码行数

**playground 业务代码总数估：~2920 行**（在 §1.2 KPI < 3000 行内）。

---

## §6 风险与缓解

| 风险                                                         | 等级   | 缓解                                                                                                             |
| ------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------- |
| §0 R0 base layer 清理范围超预期                              | HIGH   | 真实 grep 确认范围 + 4 Action 分项分别 commit；如某项卡住可降级（如 builtin-skills 下推留 W22 主线波次）         |
| stateful state 持久化 + crossStageState 持久化 schema 兼容性 | HIGH   | playground 表加新列不影响旧逻辑；新列 default 空对象；双向兼容                                                   |
| 7 stage primitive 抽象漏 playground 特殊逻辑                 | HIGH   | R3-A writing-team demo 先验证；R2-A 双轨期可观察 1 周                                                            |
| 18 → 8 SKILL.md 重组期间 prompt 等价性破坏                   | HIGH   | R2-A0 单独阶段，逐字符对比 prompt                                                                                |
| 前端事件 byte-equal 兼容性破坏                               | HIGH   | playground-frontend-contract.spec 守门                                                                           |
| 双轨期 mission 行为偏差                                      | HIGH   | runtime_version 标记 + 9 路矩阵 + 1 周观察                                                                       |
| Phase 2 用户自定义 Agent SKILL.md 安全                       | MEDIUM | 双轨：入库 scanner + tool ACL hard limit + default disable internal tools                                        |
| Phase 2 SerializableMissionPipelineConfig 表达力不足         | MEDIUM | 不允许 storeFactory / function hooks，只引用 SKILL.md；表达力受限 = MVP 限制；后续可加 server-side hook 注册机制 |
| W21 / W22 主线波次冲突                                       | LOW    | mission-pipeline 在 teams/orchestrator + lifecycle/mission-lifecycle 子聚合，与 W21/W22 正交                     |

---

## §7 回滚策略

- **R0 后回滚**：每个 Action 单独 commit + git revert；如 base-layer-business-leakage spec 暂时不达标可临时增加 allowlist 但**必须**有迁移期限注释
- **R1 完成后但 R2 未做**：harness 多了 mission-pipeline 框架但无 ai-app 用，零回滚成本
- **R2-A 双轨期发现新框架问题**：feature flag 切回 legacy runtime（playground 旧实现仍在）
- **R2-C 删除阶段发现回归**：保留新代码 + 修 bug；新框架已写新数据到 playground 旧表，无双表迁移需求

#### R2-C 真实回滚路径

R2-A 起新代码走 PlaygroundMissionStore 写**playground 旧表**（不是新表），所以 R2-C 删除新代码后旧 controller 仍能读这些数据 — 不需要数据迁移。git revert R2-A/B/C commits 即可。

---

## §8 与 W21/W22 协调

| 主线波次                    | 关系   | 协调点                                                                                                           |
| --------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| W17 engine 顶层重组         | 已完成 | 无影响                                                                                                           |
| W18 命名规范对齐            | ⏳待办 | 本方案产物按命名规范（`.compactor.ts` / `.classifier.ts` / `.utils.ts` 等）                                      |
| W19 harness 命名规范对齐    | ⏳待办 | 同上                                                                                                             |
| W20 扩展治理契约            | ⏳待办 | §0 R0 + 自动化看护是 W20 的具体载体                                                                              |
| W21 memory 契约收敛         | ⏳待办 | R1-C IMissionStore 端口与 W21 checkpoint 主 contract 对齐                                                        |
| W22 base layer 定制代码归位 | ⏳待办 | §0 R0 + R2-C 删除 playground 私有代码 = W22 在 playground 上的具体落地；harness/builtin-skills 17 个下推也是 W22 |

---

## §9 时间表（诚实数字）

```
W1-2:   R0 基本原则违规清理 (10-12 天)
W3-4:   R0.5 Plugin 系统 (12 PR / 1.5-2 周)            ★ v5 新增
        ├─ Stage 0: plugin-core 内核 (3 PR)
        ├─ Stage 1: 关键路径打 hook (3 PR)
        ├─ Stage 2: 4 个高价值 plugin (4 PR)
        └─ Stage 3: 移除旧实现 (2 PR)
W5:     R1-A0 SkillSpecBuilder + OutputSchemaRegistry (3-5 天)
W6:     R1-A 7 stage primitive + crossStageState (5-7 天)
W7-8:   R1-B MissionPipelineOrchestrator + Config + Registry (4-6 天)
        R1-C IMissionStore + 持久化扩展 (3 天)
        R1-D MissionRerunOrchestrator + 前端契约 spec (3 天)
W9:     R3-A writing-team demo (5-7 天)
        ↓ 发现 R1 框架问题 → 修 R1
W10:    R2-A0 playground 18 → 8 SKILL.md 重组 (3-5 天)
W11-12: R2-A playground.config 双轨上线 (5-7 天)
W13:    R2-B e2e 等价性验证（双轨观察 1 周）
W14:    R2-C 删除 playground 旧实现 (3-5 天)
        Phase 1 完成
        ↓
W15-17: Phase 2 R4-A 后端 custom-agents 模块 (5-7 天) + R4-B 前端 5 步向导 (15-20 天) + R4-C 验收 (3-5 天)

★ R0.5-E（R1 完成后做，不阻塞主线）：剩余 22 个 plugin 批量迁出，预估 6-8 PR / 4-6 周

Phase 1 总计 14 周（3.5 个月，比 v3 +2 周）
Phase 2 总计 3 周（如同步推进）
R0.5-E 4-6 周（R1 后并行，不计入主线）
含评审 + 与用户决策来回 buffer 1-2 周
全部完成（不含 R0.5-E）：16-20 周（4-5 个月）
```

---

## §10 验收标准

### R0 验收

- [ ] BUILTIN_TEAMS / BUILTIN_AGENTS / BUILTIN_ROLES 删除，业务名下推到 ai-app
- [ ] harness 26 个文件 playground 字面清理（含运行时业务条件分支）
- [ ] harness/builtin-skills/built-in 17 个 SKILL.md 下推到 ai-app/agent-playground/skills/
- [ ] postmortem-classifier substring 改为 config 注入
- [ ] base-layer-business-leakage.spec.ts 通过（0 命中）
- [ ] ESLint no-restricted-syntax 配置 + lint 通过
- [ ] 全量 spec + verify:arch 通过

### R0.5 验收（v5 新增）

- [ ] `src/plugin-core/` 内核就位（abstractions + HookBus + Registry + Loader + Supervisor）+ 全部单测通过
- [ ] harness 关键路径接 `MISSION_START/END`、`MEMORY_*` hook
- [ ] engine 关键路径接 `LLM_REQUEST/RESPONSE`、`TOOL_BEFORE/AFTER` hook
- [ ] 4 个 plugin 落地：observability/telemetry-otel + storage/tool-cache-redis + resilience/rate-limit + security/sandbox-isolated-vm
- [ ] 双轨期 e2e 全绿，hook 链路 p99 性能 < 旧实现 110%
- [ ] 旧实现移除：harness/tracing/otel + harness/guardrails/rate-limit + engine/tools/cache + engine/tools 内嵌 sandbox
- [ ] 架构看护扩展：harness/engine 不得 import `src/plugins/`；plugin 不得 import harness/engine 内部路径
- [ ] plugin-system-isolation.spec：plugin 互相之间不可见；CapabilityGate 拒绝越权 getService
- [ ] manifest.stability + payloadVersion + coreVersionRange 三个 SDK 接口面字段就位

### R1 验收

- [ ] 7 stage primitive 单元测试覆盖
- [ ] MissionPipelineOrchestrator e2e（mock store）跑通
- [ ] IMissionStore / IMissionEventStore 端口暴露在 facade
- [ ] SkillSpecBuilder 接 SKILL.md → IAgentSpec 验证
- [ ] CrossStageState 容器单测覆盖

### R3-A 验收

- [ ] writing-team < 15 文件实现完整 mission 流程
- [ ] 资深开发者 < 3 天独立完成
- [ ] 跑通 e2e mission

### R2 验收

- [ ] playground 18 → 8 SKILL.md 重组后 prompt 等价（逐字符）
- [ ] R2-B 9 路 mission 等价性达标（按 §6 R2-B 标准）
- [ ] **playground 前台 0 改动验证**（用户决策 3）
- [ ] **playground 后台对前台 API byte-equal**（playground-frontend-contract.spec 通过）
- [ ] R2-C 后 playground 目录文件数 < 35

### Phase 2 R4 验收

- [ ] 用户从 AI 配置页 5 步创建 agent
- [ ] 左侧菜单出现 "我的 Agent / <name>"
- [ ] 点击进入跑通一次 mission
- [ ] 导出 markdown 报告
- [ ] PromptInjectionScanner + ToolACL 安全 spec 通过
- [ ] ScopedCustomAgentMissionStore isolation spec 通过

### 整体验收

- [ ] 新 mission-style ai-app 开发时间：资深 < 3 天 / AI Agent < 6 小时
- [ ] playground 业务代码总行数 < 3000
- [ ] **base-layer-business-leakage.spec：0 命中（永远 0，永久门槛）**
- [ ] 全部 spec / verify:arch / e2e 通过

---

**v3 状态：终审通过（含 P0-NEW-1 / P0-NEW-2 修订），可进 R0 实施。**

**v3 vs v2 关键变更**（响应 v2 评审 7 P0 + 5 P1）：

1. **§0 R0 工作量重估** 3.5 天 → 10-12 天（v2 评审 P0-A）
2. **§0.3 ESLint 配置完整可执行示例**（v2 评审 P0-B）
3. **§3.4 stateful 自洽**：IMissionStore 加 appendDecision/getDecisions + crossStageState 持久化 + 跨 stage 副作用累计（v2 评审 P0-F）
4. **§3.7 新增前端事件兼容性契约**（v2 评审 P2-13 漏掉的）
5. **§3.8.4 简单模式补 frontmatter wizard**（v2 评审 P0-E）
6. **§3.8.5 topic schema 限定 key-value MVP**（v2 评审 §3.7 form-builder 复杂度）
7. **§3.9.1 SerializableMissionPipelineConfig 子集类型**（v2 评审 P0-C）
8. **§3.9.2 custom_agent_artifacts 拆分大产物**（v2 评审 P0-D）
9. **§3.9.4 prompt 注入安全双轨：scanner + tool ACL hard limit**（v2 评审 P0-G）
10. **§3.1 L3.5 ai-app/\_meta 新分类**（v2 评审 P1-H custom-agents 跨边界）
11. **§5 hook 行数估算列**（v2 评审 P1-K）
12. **§9 时间 13 周 → 14-18 周诚实数字**（v2 评审 P1-L）
13. **§3.9.5/6 ScopedCustomAgentMissionStore + isolation spec**（v2 评审 P1-M）
14. **§4 phase 1 / phase 2 分离**（用户决策：本轮只 phase 1）
15. **playground 前台/接口/行为零变化** 写入 §1.2 KPI + §10 验收（用户决策 3）

**v3 终审 P0-NEW 修订**（v3 评审，已落到本文档）：16. **§0.3 Action 3 注册时序保证**：ai-app 模块 imports HarnessSkillsModule + builtin-skills 空目录单测看护（P0-NEW-1）17. **§3.8.5 topic schema 字段类型扩展**：string / number / boolean / enum / array<string>，覆盖 playground 全 15 字段（P0-NEW-2）

**R1 内修项**（v3 评审 P1-NEW，R1 阶段开工前补）：

- P1-NEW-1: §3.7.3 fixture-based spec 实现策略
- P1-NEW-2: stage primitive 通过 storeAdapter DI 拿 store（不放 ctx.store）
- P1-NEW-3: §3.9.1 zod ↔ JSON Schema 有损转换 caveat

**实施过程修项**（v3 评审 P2-NEW，可后修）：

- P2-NEW-1: §9 W3 加 0.5 周 buffer
- P2-NEW-2: §1.2 KPI 调到 < 3500 行或加 buffer 警告
- P2-NEW-3: 拆 IMissionStateStore 子接口（ISP 优化）

**v1 17 项 + v2 12 项 + v3 终审 5 项 = 34 项修订完成**。

---

**v5 vs v3 增量**（v5 用户决策落地）：

1. §0 新增"横切关注点必须从内核剥离到 plugin"红线
2. §3.1 目录新增 `src/plugin-core/` + `src/plugins/` 双根目录
3. §4 Phase 1 实施路径插入 R0.5（plugin 内核 + 4 个高价值 plugin），约 1.5-2 周
4. §9 时间表 Phase 1 12 周 → 14 周，含 R0.5-E（R1 后做剩余 22 plugin 迁出）
5. §10 R0.5 验收新增（plugin spec / hook trace / capability gate / SDK 接口面）
6. **§11 全新章节**：Plugin 系统设计（5 维目标、26 plugin 盘点、plugin-core 接口、HookBus、capability、配置、改造路径、可靠性、安全性、SDK 发布形态、12 PR 序列、衔接与风险）

**v5 状态：等待多角色并行评审（architect / arch-auditor / security-auditor / reviewer），通过即归档 v3 + 进入 R0.5 PR-1 实施。**

---

## §11 Plugin 系统（v5 新增）

> **目标**：把 harness/engine 中 26 个横切关注点从内核剥离到可插拔 plugin，实现内核瘦身 / 能力可替换 / ai-app 按需选用 / 为未来 SDK 发布预留稳定的对外契约面。
>
> **不在范围**：plugin marketplace（v3 之后）/ plugin hot-reload（v2）/ worker-isolated 沙箱（v2）。本章只覆盖 v1 必须落地的范围。

### §11.1 设计目标 5 维 + 全量 plugin 盘点

| 维度           | 关键问题                                                                                  | 落地手段                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **可维护性**   | 三年后新人 1 小时能上手写 plugin？plugin bug 能秒定位？                                   | manifest 自描述 / 启动期拓扑校验 / 每 plugin 独立 spec / hook trace 可观测                                                           |
| **可扩展性**   | 新增 plugin 类型要不要改内核？hook 全集会膨胀失控吗？                                     | 内核仅定义 IPlugin / HookBus / 命名规范，hook id 是字符串开放集合                                                                    |
| **架构领先性** | 对标 Anthropic Agent SDK / OpenAI Assistants / LangChain / Semantic Kernel 做到什么档次？ | onion middleware + manifest + capability declaration（业界标准）+ 双层 hook（harness/engine 各自 hook，业界少见）                    |
| **可靠性**     | 一个坏 plugin 能拖垮整个系统？plugin 异常路径全 cover？                                   | 启动期 fail-fast（required）+ 运行时 isolate（optional 错误不传染）+ plugin-level circuit breaker + 全链路 trace                     |
| **安全性**     | plugin 越权读敏感数据 / 篡改其他 plugin / 注入恶意？                                      | IPluginContext 最小特权（不暴露 raw service）+ capability declaration + 启动期签名校验（接口预留）+ plugin sandbox（v2 worker 隔离） |

**全量 26 个 plugin（按 8 大域分类）**：

| 域                        | Plugin                                                                                                              | 当前位置                                                                         | 替换方式                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **observability**（5）    | telemetry-otel / telemetry-eval / telemetry-latency / telemetry-llm-events / telemetry-attribution                  | `harness/tracing/{otel,eval,latency,llm-events,attribution}`                     | datadog / sentry / 关闭                                |
| **resilience**（4）       | rate-limit / concurrency-control / budget-billing / circuit-breaker                                                 | `harness/guardrails/*` + `engine/tools/concurrency` + `engine/safety/resilience` | redis / 内存 / opossum                                 |
| **security**（5）         | sandbox-isolated-vm / tool-permission-rbac / capability-guard-rbac / guardrail-injection / guardrail-pii-moderation | `engine/safety/security/*` + `engine/safety/guardrails/*`                        | vm2 备选 / OPA / OpenAI moderation                     |
| **storage**（5）          | memory-redis / memory-postgres / checkpoint-redis / event-journal-postgres / tool-cache-redis                       | `harness/memory/*` + `harness/protocols/journal` + `engine/tools/cache`          | redis / postgres / kafka                               |
| **rag-backend**（2 大类） | embedding-openai / embedding-local / vector-pgvector / vector-qdrant                                                | `engine/rag/{embedding,vector}`                                                  | OpenAI / cohere / local + pgvector / qdrant / pinecone |
| **llm-augment**（4）      | llm-multi-key / llm-pricing / llm-prompt-adapter / llm-output-sanitizer                                             | `engine/llm/{key-health,pricing,prompt-adaptation,output-parsing}`               | 单 key / 多 key / 远端 pricing                         |
| **tool-augment**（4）     | tool-validation-zod / tool-timeout / tool-progress-sse / tool-progress-websocket                                    | `engine/tools/middleware/*`                                                      | zod / ajv / SSE / websocket                            |

总计：26 个独立 plugin。预估迁出后 harness 减重 30-40%，engine 减重 25-35%。

### §11.2 顶层架构 + plugin-core / plugins 双根目录

```
┌─────────────────────────────────────────────────────────────┐
│                    ai-app（业务层）                          │
│   仅通过 AiHarnessModule.forFeature({ pluginOverrides })    │
│   声明使用哪些 plugin，不直接 import plugin 实现             │
└────────────────────┬─────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
┌───────────────────┐     ┌───────────────────┐
│  ai-harness       │     │  ai-engine        │
│  在关键路径触发：  │     │  在关键路径触发：  │
│  • MISSION_*      │     │  • LLM_*          │
│  • AGENT_STEP_*   │     │  • TOOL_*         │
│  • TEAM_HANDOFF   │     │  • EMBEDDING/    │
│  • MEMORY_*       │     │    VECTOR_QUERY  │
│  • CHECKPOINT_*   │     │  • SAFETY_*       │
└─────────┬─────────┘     └─────────┬─────────┘
          │ HookBus.fire()          │
          └──────────┬──────────────┘
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  src/plugin-core/   平台 plugin 内核（不依赖业务）            │
│   IPlugin / HookBus / PluginRegistry / Loader / Supervisor  │
└────────────────────┬─────────────────────────────────────────┘
                     │ 加载并实例化
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  src/plugins/   plugin 实现（按 8 域子目录分类）              │
│   observability/ resilience/ security/ storage/             │
│   rag-backend/ llm-augment/ tool-augment/                   │
└─────────────────────────────────────────────────────────────┘
```

**架构原则（强约束）**：

1. **plugin-core 在 src 根**，对应概念上比 ai-infra 更底层；不属于任何 module，是平台内核。
2. **plugins 在 src 根**，按 8 大域子目录分类，避免 26 个平铺；每个域子目录未来对应一个 npm 子包（见 §11.10 SDK 发布形态）。
3. **plugin 不放 ai-app/**——plugin 是平台横切能力不是业务能力；ai-app 依赖 harness/engine，若 plugin 在 ai-app/ 下会形成 harness/engine → ai-app 反向依赖。
4. **harness/engine 不感知具体 plugin**，只感知 hook 接口；plugin 替换不需要改 harness/engine 代码。
5. **plugin 之间不直接互调**，仅通过 hook payload 通信——这是 SDK 发布后保持向后兼容的关键。

### §11.3 核心接口

#### IPluginManifest（plugin 自描述）

```typescript
// src/plugin-core/abstractions/plugin.interface.ts
export interface IPluginManifest {
  /** 全局唯一 plugin id（含域前缀） */
  id: string; // "observability/telemetry-otel"
  /** plugin 自身 semver */
  version: string; // "1.0.0"
  /** 兼容的 plugin-core 版本范围（SDK 发布场景关键字段） */
  coreVersionRange: string; // "^1.0.0"
  /** 单行描述 */
  description: string;
  /** 域分类（8 个之一） */
  category: PluginCategory;
  /** 稳定性等级（SDK 对外承诺面） */
  stability: "stable" | "experimental" | "internal";
  /** 替代关系（同 replaces 值最多 1 enabled） */
  replaces?: string;
  /** 依赖的其他 plugin id */
  dependencies?: string[];
  /** 监听的 hook（启动期校验用） */
  hooks: HookId[];
  /** 能处理的 hook payload 版本矩阵 */
  payloadVersions?: Record<HookId, number[]>;
  /** 所需 capability（plugin 安全模型，见 §11.5） */
  capabilities: PluginCapability[];
  /** 配置 zod schema */
  configSchema?: ZodSchema;
  /** 加载阶段 */
  phase: "bootstrap" | "runtime";
  /** 是否必须（false=optional，加载失败可跳过） */
  required: boolean;
  /** 标签 */
  tags?: string[];
  /** 签名（外部 plugin 推荐启用） */
  signature?: {
    issuer: string;
    sig: string;
    algorithm: "ed25519" | "rsa-sha256";
  };
  /** SDK 发布元信息 */
  homepage?: string;
  repository?: string;
}

export const PLUGIN_CATEGORIES = [
  "observability",
  "resilience",
  "security",
  "storage",
  "rag-backend",
  "llm-augment",
  "tool-augment",
  "experimental",
] as const;

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];
```

#### IPlugin（运行时契约）

```typescript
export interface IPlugin<TConfig = unknown> {
  readonly manifest: IPluginManifest;
  init(ctx: IPluginContext, config: TConfig): Promise<void>;
  healthCheck?(): Promise<PluginHealth>;
  dispose?(): Promise<void>;
}

export interface PluginHealth {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  metrics?: Record<string, number>;
}
```

#### IPluginContext（plugin 与平台的唯一接口，最小特权）

```typescript
export interface IPluginContext {
  readonly manifest: IPluginManifest;
  readonly logger: ILogger; // 自动加 plugin id 前缀，无法伪造
  readonly config: IPluginConfigView; // 只读，仅自己 namespace
  readonly hooks: IHookRegistrar; // 核心接入点
  readonly metrics: IMetricsEmitter; // 轻量遥测（不经 hook，避免循环）
  readonly events: IPluginEventBus; // 受限事件总线（仅自己 namespace）
  /** capability gate：仅当 manifest.capabilities 含 "service:redis" 才能拿到 redis client */
  getService<T>(token: ServiceToken<T>): T;
}
```

**安全设计**：plugin 拿不到 NestJS ModuleRef / Injector / 其他 plugin 实例；唯一获取服务的途径是受 capability 控制的 `getService()`。

#### HookBus（onion middleware 引擎，核心 ~80 行实现）

```typescript
@Injectable()
export class HookBus {
  private handlers = new Map<HookId, HookEntry[]>();

  register<P>(
    hookId: HookId,
    handler: HookHandler<P>,
    options: { priority?: number; pluginId: string; required?: boolean },
  ): void {
    const entries = this.handlers.get(hookId) ?? [];
    entries.push({ handler, ...options, priority: options.priority ?? 0 });
    entries.sort((a, b) => b.priority - a.priority); // 高 priority 在外
    this.handlers.set(hookId, entries);
  }

  /** harness/engine 在关键路径调用 */
  async fire<P, R>(
    hookId: HookId,
    payload: P,
    terminal: () => Promise<R>,
  ): Promise<R> {
    const chain = this.handlers.get(hookId) ?? [];
    if (chain.length === 0) return terminal(); // fast-path 零开销

    let i = 0;
    const dispatch = async (): Promise<unknown> => {
      if (i >= chain.length) return terminal();
      const entry = chain[i++];
      const ctx: IHookContext<P> = {
        hook: hookId,
        payload,
        next: dispatch,
        abort: (reason) => {
          throw new HookAbortError(reason, entry.pluginId);
        },
        meta: this.buildMeta(),
      };
      return this.runWithSupervisor(entry, ctx);
    };
    return dispatch() as Promise<R>;
  }

  private async runWithSupervisor(
    entry: HookEntry,
    ctx: IHookContext,
  ): Promise<unknown> {
    try {
      return await entry.handler(ctx);
    } catch (err) {
      if (err instanceof HookAbortError) throw err; // 业务级 abort 透传
      this.supervisor.onPluginError(entry.pluginId, err);
      if (entry.required) throw err; // required plugin 异常致命
      return ctx.next(); // optional plugin 异常跳过
    }
  }
}
```

**关键设计点**：

- onion 顺序：高 priority 在外（先执行 before、后执行 after）
- `abort()` 显式接口：cache 命中、permission deny 等"我处理掉了，跳过 terminal"
- supervisor 隔离：plugin 异常不导致 hook 链中断（除非 required=true）
- 零开销 fast-path：无 handler 时直接 terminal

### §11.4 标准 Hook 集 + 命名规范 + payload 版本化

#### 命名规范

`{layer}.{aggregate}.{action}` —— 强制 lowercase + dot 分隔。

#### 首批 8 个核心 hook（R0.5 上线）

```typescript
export const CORE_HOOKS = {
  // engine 层（4）
  LLM_REQUEST: "engine.llm.request",
  LLM_RESPONSE: "engine.llm.response",
  TOOL_BEFORE: "engine.tool.before",
  TOOL_AFTER: "engine.tool.after",
  // harness 层（4）
  MISSION_START: "harness.mission.start",
  MISSION_END: "harness.mission.end",
  MEMORY_WRITE: "harness.memory.write",
  MEMORY_READ: "harness.memory.read",
} as const;
```

#### 二批扩展 hook（R0.5-E 全量迁移时新增）

```typescript
export const EXTENDED_HOOKS = {
  AGENT_STEP_BEFORE: "harness.agent.step.before",
  AGENT_STEP_AFTER: "harness.agent.step.after",
  TEAM_HANDOFF: "harness.team.handoff",
  CHECKPOINT_SAVE: "harness.checkpoint.save",
  CHECKPOINT_LOAD: "harness.checkpoint.load",
  EMBEDDING_REQUEST: "engine.embedding.request",
  VECTOR_QUERY: "engine.vector.query",
  SAFETY_INPUT: "engine.safety.input",
  SAFETY_OUTPUT: "engine.safety.output",
  CIRCUIT_OPEN: "engine.circuit.open",
  CIRCUIT_CLOSE: "engine.circuit.close",
} as const;
```

#### Payload 版本化（SDK 兼容性的关键）

每个 hook 的 payload 必须 versioned；fire 时携带 version；plugin 在 manifest 声明 supported 版本。

```typescript
// fire 端
await hooks.fire(
  CORE_HOOKS.LLM_REQUEST,
  {
    __version: 1, // payload version
    request: req,
    meta: { missionId, agentId },
  },
  terminal,
);

// plugin 端
manifest.payloadVersions = {
  "engine.llm.request": [1, 2], // 能处理 v1 / v2 payload
};
// HookBus 在 dispatch 时检查 version 兼容性，不支持则跳过该 plugin
```

### §11.5 PluginCapability 安全声明 + capability gate

```typescript
export type PluginCapability =
  // 基础设施
  | "service:redis"
  | "service:postgres"
  | "service:http"
  | "service:websocket"
  // hook 类
  | `hook:${HookId}`
  // 数据访问
  | "read:llm-payload"
  | "write:llm-payload"
  | "read:tool-payload"
  | "write:tool-payload"
  | "read:memory"
  | "write:memory"
  // 跨 plugin
  | "events:publish"
  | "events:subscribe";
```

**校验三层**：

- 启动期：`manifest.capabilities` 与 `manifest.hooks` 一致性（监听 LLM_REQUEST 必须声明 read:llm-payload）
- 运行时：`ctx.getService("redis")` 必须 capability 含 `service:redis`
- 配置期：`plugins.config.yaml` 可禁用某 capability（生产环境禁用 write:llm-payload）

### §11.6 配置文件 + 模块 override + ai-app 选用方式

#### 项目级配置

```yaml
# src/plugins/plugins.config.yaml
version: 1
profile: ${NODE_ENV:-development}

globals:
  hookTraceEnabled: ${profile == 'development'}
  pluginIsolation: "process-shared"
  failureThreshold: 5

plugins:
  - id: observability/telemetry-otel
    enabled: true
    required: true
    config:
      endpoint: ${OTEL_ENDPOINT}
      sampleRate: 0.1

  - id: resilience/rate-limit
    enabled: true
    config:
      defaultRpm: 60
      perAgentRpm: { researcher: 30 }

  - id: security/sandbox-isolated-vm
    enabled: ${profile == 'production'}
    required: ${profile == 'production'}
    config: { memoryLimit: 256MB, timeout: 30000 }

  - id: storage/tool-cache-redis
    enabled: true
    config: { ttl: 3600, keyPrefix: gen:tool-cache }

  # ... 其余 22 个 plugin
```

#### ai-app 模块层 override（精细化）

```typescript
@Module({
  imports: [
    AiHarnessModule.forFeature({
      pluginOverrides: {
        "resilience/rate-limit": { config: { perAgentRpm: { research: 100 } } },
        "security/sandbox-isolated-vm": { enabled: false }, // research 信任内部 tool
      },
    }),
  ],
})
export class ResearchModule {}
```

**ai-app 不直接 import plugin 实现，仅声明配置。**

### §11.7 关键路径改造（Tool / LLM / Mission lifecycle）

#### ToolPipeline 改造（最高频）

```typescript
// before（现状，散落 5 个 middleware）
async execute(call: ToolCall): Promise<Result> {
  await this.permission.handle(call);
  await this.validation.handle(call);
  this.timeout.armWatchdog(call);
  const result = await this.registry.invoke(call);
  await this.progress.emit(result);
  this.cache.put(call, result);
  return result;
}

// after（plugin 化）
async execute(call: ToolCall): Promise<Result> {
  return this.hooks.fire(CORE_HOOKS.TOOL_BEFORE, { __version: 1, call }, async () => {
    const result = await this.registry.invoke(call);
    return this.hooks.fire(CORE_HOOKS.TOOL_AFTER, { __version: 1, call, result }, async () => result);
  });
}
```

permission / validation / timeout / progress / cache 全部变成 plugin。

#### LLM 调用改造

```typescript
async chat(req: ChatRequest): Promise<ChatResponse> {
  return this.hooks.fire(CORE_HOOKS.LLM_REQUEST, { __version: 1, request: req }, async () => {
    const raw = await this.adapter.call(req);
    return this.hooks.fire(CORE_HOOKS.LLM_RESPONSE, { __version: 1, request: req, raw }, async () => raw);
  });
}
```

7 个原本散落的能力（adapter / multi-key / guardrail-in / guardrail-out / sanitizer / pricing / output-format）全部 plugin 化。

#### Mission lifecycle 改造

```typescript
async startMission(input: MissionInput): Promise<MissionContext> {
  const ctx = this.createContext(input);
  await this.hooks.fire(CORE_HOOKS.MISSION_START, { __version: 1, missionContext: ctx }, async () => ctx);
  return ctx;
}
```

attribution / budget / checkpointer / event-journal 全部监听 `MISSION_START` / `MISSION_END`。

### §11.8 可靠性保障

#### 启动期校验（fail-fast）

```typescript
// src/plugin-core/loader/plugin-loader.service.ts
async load(): Promise<void> {
  const manifests = await this.scan("src/plugins/");

  // ① manifest schema 校验
  for (const m of manifests) this.validator.validate(m);
  // ② replaces 互斥
  this.checkReplacesConflict(manifests);
  // ③ dependencies 拓扑排序（含循环检测）
  const sorted = this.resolver.topologicalSort(manifests);
  // ④ capability ↔ hooks 一致性
  for (const m of sorted) this.validator.checkCapabilityConsistency(m);
  // ⑤ coreVersionRange 兼容性
  for (const m of sorted) this.validator.checkCoreCompat(m, PLUGIN_CORE_VERSION);
  // ⑥ 实例化 + init
  for (const m of sorted) {
    const plugin = await this.instantiate(m);
    try {
      await plugin.init(ctx, config);
      this.registry.set(m.id, plugin);
    } catch (err) {
      if (m.required) throw new PluginBootError(m.id, err);
      this.logger.warn(`Optional plugin ${m.id} init failed, skipped`, err);
    }
  }
}
```

#### 运行时隔离（fail-soft + supervisor）

```typescript
@Injectable()
export class PluginSupervisor {
  private errorCounts = new Map<string, number>();
  private circuit = new Map<string, "closed" | "half-open" | "open">();

  onPluginError(pluginId: string, err: unknown): void {
    const count = (this.errorCounts.get(pluginId) ?? 0) + 1;
    this.errorCounts.set(pluginId, count);

    if (count >= this.threshold) {
      this.circuit.set(pluginId, "open");
      this.hookBus.disable(pluginId);   // 跳过该 plugin handler
      setTimeout(() => this.tryHalfOpen(pluginId), this.cooldown);
    }
  }

  @Interval(30000)
  async healthCheckAll(): Promise<void> { ... }
}
```

#### Hook 链路可观测

```typescript
@Injectable()
export class HookTraceService {
  async traced<R>(hookId: HookId, fn: () => Promise<R>): Promise<R> {
    const span = this.tracer.startSpan(`hook:${hookId}`);
    try {
      return await fn();
    } finally {
      span.end();
    }
  }
}
```

dev 期 `hookTraceEnabled: true` 输出每 hook 链耗时分解（哪个 plugin 慢一目了然）。

### §11.9 安全保障

1. **Plugin 能力最小化**：manifest.capabilities 启动期 + 运行时 + 配置期三重校验
2. **Plugin 沙箱（v2 接口预留）**：默认 process-shared；不可信 plugin 跑 worker_threads
3. **Plugin 签名校验（接口 v1 预留，启用看 profile）**：manifest.signature → PluginSignatureVerifier；公钥固化在内核
4. **Plugin 间隔离**：plugin 拿不到其他 plugin 实例；events 自动加 namespace；logger 加固定前缀

### §11.10 SDK 发布形态

未来发布对外 SDK 时三层包：

```
@genesis/harness-core           ← 必带（约 2-3 万行）
   ├─ plugin-core/              内核：IPlugin / HookBus / Registry / Loader
   ├─ ai-harness/               agent runtime（含 hook 触发点）
   └─ ai-engine/                LLM/tools/RAG 基元（含 hook 触发点）
   特征：自带 hook 接口，无任何 plugin 实现
   用户只用 core 也能跑，但没有 telemetry / cache / rate-limit / sandbox

@genesis/harness-plugins-essential   ← 推荐带（约 0.8-1.2 万行）
   含 5-7 个生产必备 plugin（telemetry-otel / rate-limit / circuit-breaker /
   tool-cache-redis / tool-permission-rbac / llm-multi-key / llm-output-sanitizer）

@genesis/plugins-{domain}            ← 按域细分子包（剩余 plugin）
   • @genesis/plugins-storage
   • @genesis/plugins-security
   • @genesis/plugins-rag-backend
   • @genesis/plugins-llm-augment
   • @genesis/plugins-tool-augment
   • @genesis/plugins-observability-extra
```

**SDK 发布前置条件（v1 必备）**：

- 所有 hook id 标 `stability: "stable"` 或 `"experimental"`
- 所有 hook payload 强制 `__version` 字段，破坏性变更必须 major bump
- manifest.coreVersionRange 强制声明
- IPlugin / HookBus / IPluginContext 接口加 `@stable` JSDoc 标注
- 提供 `@genesis/create-plugin` CLI 脚手架（一行命令生成 plugin 骨架）

### §11.11 Plugin 测试策略

| 层级                 | 测试内容                                                                       | 工具                          |
| -------------------- | ------------------------------------------------------------------------------ | ----------------------------- |
| **plugin-core 单测** | HookBus onion / Registry 拓扑 / Loader 校验 / Supervisor 熔断 / CapabilityGate | jest                          |
| **每 plugin 单测**   | manifest 合法 / init 幂等 / hook handler 行为 / dispose 清理                   | jest                          |
| **plugin 集成测**    | 多 plugin 协作（cache + telemetry + rate-limit）链路正确                       | jest + redis container        |
| **架构看护测**       | harness/engine 不得 import plugin 实现；plugin 不得 import harness/engine 内部 | layer-boundaries.spec.ts 扩展 |
| **回归测**           | 现有 e2e 全绿（plugin 化前后行为等价）                                         | 既有 e2e                      |
| **故障注入测**       | 单 plugin 异常 → 系统继续运行；required plugin 异常 → fail-fast                | chaos test                    |
| **性能基线**         | hook 链零开销 fast-path / 完整链路 p99 < 既有实现 110%                         | benchmark                     |

### §11.12 R0.5 实施 PR 序列（12 PR / 1.5-2 周）

#### Stage 0：内核搭建（3 PR）

| PR       | 内容                                                                                  | 工作量 |
| -------- | ------------------------------------------------------------------------------------- | ------ |
| **PR-1** | `src/plugin-core/abstractions/` 全部接口定义 + manifest 校验器 + spec                 | 1 天   |
| **PR-2** | `HookBus` + onion 实现 + spec（abort / supervisor / trace / payload version）         | 1.5 天 |
| **PR-3** | `PluginRegistry` + `PluginLoader` + `PluginConfigService` + `PluginSupervisor` + spec | 2 天   |

→ 内核就位但还没 plugin 实现。e2e 全绿（无副作用）。

#### Stage 1：关键路径打 hook（3 PR）

| PR       | 内容                                                                        | 工作量 |
| -------- | --------------------------------------------------------------------------- | ------ |
| **PR-4** | engine/tools/registry 接 `TOOL_BEFORE/AFTER` hook（旧 middleware 同时运行） | 1 天   |
| **PR-5** | engine/llm/services 接 `LLM_REQUEST/RESPONSE` hook                          | 1 天   |
| **PR-6** | harness/lifecycle + memory 接 `MISSION_START/END/MEMORY_*` hook             | 1 天   |

→ harness/engine 已具备 hook 触发能力，旧代码仍跑（双轨并存）。

#### Stage 2：首批 4 个高价值 plugin（4 PR）

| PR        | 内容                                                    | 验证目标                           |
| --------- | ------------------------------------------------------- | ---------------------------------- |
| **PR-7**  | `plugins/observability/telemetry-otel/` 完整实现 + spec | hook 监听完整 + capability gate    |
| **PR-8**  | `plugins/storage/tool-cache-redis/` 完整实现 + spec     | abort 短路 + payload version       |
| **PR-9**  | `plugins/resilience/rate-limit/` 完整实现 + spec        | supervisor 熔断 + plugin override  |
| **PR-10** | `plugins/security/sandbox-isolated-vm/` 完整实现 + spec | replaces 互斥 + required fail-fast |

→ 4 plugin 双轨运行，e2e 全绿，性能 p99 < 旧实现 110%。

#### Stage 3：移除旧代码（2 PR）

| PR        | 内容                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **PR-11** | 删除 engine/tools/cache + engine/tools/middleware + harness/tracing/otel + harness/guardrails/rate-limit + engine/tools 内嵌 sandbox |
| **PR-12** | 修复所有遗留 import + 看护 spec 扩展（layer-boundaries 增加 plugin / plugin-core 边界规则）                                          |

→ harness/engine 内核首次实质瘦身。

#### Stage 4：剩余 22 plugin 批量迁出（R0.5-E，R1 后做）

每 PR 处理 3-4 个 plugin（按域分批），不阻塞 R1。预估 6-8 PR / 4-6 周。

### §11.13 与 R0/R1/R2 的衔接 + 风险登记

#### 衔接

```
R0    ✅ 部分done                  base layer 业务名清理
R0.5  新增 1.5-2 周                Plugin 内核 + 关键路径 + 4 plugin
R1    不变                         pipeline 7 stage primitives
      利好：onAgentStepBefore/After hook 已在 R0.5 落地，R1 直接用
R0.5-E（R1 后做）                  剩余 22 plugin 批量迁出
R2/R3/R4 不变
```

#### 风险登记

| 风险                                           | 等级 | 兜底                                                                                             |
| ---------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| Hook 链性能损耗                                | P1   | benchmark 设硬指标 p99 < 110%；fast-path 优化（无 handler 时直接 terminal）；hook trace 开关     |
| Plugin 互相依赖循环                            | P1   | 拓扑排序检测 + 启动期 fail-fast                                                                  |
| 旧代码 + 新 plugin 双轨期不一致                | P2   | 双轨期所有路径加 metric，灰度切流；R0.5 验收必须双轨等价                                         |
| Plugin 配置错误致系统起不来                    | P1   | configSchema 校验 + required=false 时降级；profile=test 默认全 disable                           |
| Telemetry plugin 自身打不进 metric（自指悖论） | P2   | plugin-core 提供独立 IMetricsEmitter 接口（不经 hook）                                           |
| 26 plugin 全迁工作量大                         | P1   | R0.5 只做 4 个验证可行性，剩 22 个排进 R0.5-E（R1 后），不阻塞主线                               |
| 测试矩阵爆炸（26 plugin × N profile）          | P2   | 每 plugin 独立 spec + 集成 spec 选 3-5 个典型组合                                                |
| SDK 发布后 plugin 接口破坏                     | P1   | hook id stability 标注 + payload 版本化 + manifest.coreVersionRange + plugin 自动跳过不兼容 hook |
| Plugin 越权读敏感数据                          | P0   | capability declaration 三层校验 + IPluginContext 最小特权 + 不暴露 ModuleRef                     |
| 第三方 plugin 注入恶意逻辑                     | P1   | manifest.signature + PluginSignatureVerifier（v1 接口预留，企业版启用）+ worker 隔离（v2）       |

#### 架构看护扩展（R0.5 必备）

新增 `backend/src/__tests__/architecture/plugin-system.spec.ts`：

```typescript
describe("plugin system architecture", () => {
  it("harness 不得 import src/plugins/ 内部路径", () => { ... });
  it("engine 不得 import src/plugins/ 内部路径", () => { ... });
  it("plugin 不得 import src/modules/ai-harness 内部路径", () => { ... });
  it("plugin 不得 import src/modules/ai-engine 内部路径", () => { ... });
  it("plugin 不得 import 其他 plugin 实现路径", () => { ... });
  it("plugin manifest schema 全部合法", () => { ... });
  it("plugin capabilities 与 hooks 一致", () => { ... });
});
```

ESLint 配置补充：

```js
{
  files: ["src/modules/ai-harness/**", "src/modules/ai-engine/**"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{ group: ["**/plugins/**", "@/plugins/**"], message: "harness/engine 不得 import plugin 实现" }]
    }]
  }
},
{
  files: ["src/plugins/**"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        { group: ["@/modules/ai-harness/**", "@/modules/ai-engine/**"], message: "plugin 不得 import harness/engine 内部" },
        { group: ["../**/plugins/**"], message: "plugin 不得 import 其他 plugin" }
      ]
    }]
  }
}
```

---
