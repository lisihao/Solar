# W4 Implementation Plan — AI Social Agent Team

> **Status**: Active (PR-1 开始 2026-05-16)
> **Parent**: [agent-team-refactor.md](./agent-team-refactor.md) §W4
> **Branch**: `refactor/ai-social-agent-team`
> **Rule**: 严格 mirror `ai-app/agent-playground` 模式；编排骨架全用 `ai-harness/facade`，LLM/Tool/凭证全用 `ai-engine/facade`，**ai-app/social 只写 prompt + thin service + stage hook**

## 决策

1. **跳过 W3 god class 拆分**：`wechat.adapter.ts` 2135 行 + `ai-social.service.ts` 1388 行保留不动；新 mission 路径绕过它，旧链路慢慢退役
2. **完全 mirror playground**：目录结构、文件命名、注入模式、register flow 100% 复制 `ai-app/agent-playground/`
3. **0 自实现编排**：不写自己的 dispatcher 状态机 / 不写 retry 调度 / 不写 mission lifecycle；全 inject harness 现成 service
4. **基于 BrowserContextTool (W2)**：所有 puppeteer 操作走 `ToolRegistry.get(browser-context).execute(input, ctx)`，PublishExecutor 唯一入口

## 9 Agent Role 映射（playground 8 + social 独有 PublishExecutor）

| Role               | Playground 对标 | social 职责（核心 duty）                                               |
| ------------------ | --------------- | ---------------------------------------------------------------------- |
| Leader             | Leader          | M0 plan / M1 assess-transform / M6 foreword / M7 sign-off              |
| Steward            | Steward         | 预算 + session-health + concurrency + key health 4 闸                  |
| PlatformProbe      | Researcher      | 平台 schema 探测 + capability audit + saveDraft 字段集生成             |
| ContentTransformer | Reconciler      | 跨平台内容适配（标题压缩 ≤30 字 / digest / WeChat type=10 字段）       |
| CoverArtist        | Analyst         | 封面生成/选择/裁剪（含 crop_multi schema / fallback placehold.co）     |
| Composer           | Writer          | 正文 HTML schema 注入（rich_pages wxw-img / js_insertlocalimg 等）     |
| PolishReviewer     | Reviewer        | 内容润色 + SEO + 合规（复用 CritiqueRefineService）                    |
| PublishExecutor ★  | (无)            | 平台发布执行（puppeteer via BrowserContextTool / MCP via XHS adapter） |
| PublishVerifier    | Verifier        | 发布后 URL 抓取 + 索引检测 + 内容回读                                  |

## 12 Stage → Harness Primitive 映射

| Stage ID                      | Primitive  | Mode              | Role               | timeoutMs |
| ----------------------------- | ---------- | ----------------- | ------------------ | --------- |
| s1-budget-eval                | persist    | budget-pre        | (none)             | 30_000    |
| s2-platform-probe             | research   | platform-schema   | platformProbe      | 300_000   |
| s3-content-transform          | synthesize | platform-adapt    | contentTransformer | 600_000   |
| s4-leader-assess-transform    | assess     | leader            | leader             | 300_000   |
| s5-cover-craft                | synthesize | cover             | coverArtist        | 600_000   |
| s6-body-compose               | draft      | html-schema       | composer           | 600_000   |
| s7-polish-review              | review     | critique-refine   | polishReviewer     | 600_000   |
| s8-publish-execute            | synthesize | publish-via-tool  | publishExecutor    | 1_200_000 |
| s8b-publish-retry             | review     | retry             | publishExecutor    | 600_000   |
| s9-publish-verify             | review     | verify-url        | publishVerifier    | 300_000   |
| s10-leader-signoff            | signoff    | leader            | leader             | 120_000   |
| s11-mission-persist           | persist    | final             | (none)             | 60_000    |
| s12-self-evolution (postlude) | learn      | (fire-and-forget) | (none)             | -         |

> 业务 mode（如 `platform-schema` / `cover` / `publish-via-tool`）由 social-business-orchestrator 的 stage hook builder 处理；harness `MissionPipelineOrchestrator` 只看 primitive 调度，mode 是 hook 子类型 hint。

## 文件清单（mirror playground 模板）

```
backend/src/modules/ai-app/social/
├── agents/
│   ├── leader/                       SKILL.md + leader.agent.ts + index.ts
│   ├── steward/                      SKILL.md + steward.agent.ts + index.ts
│   ├── platform-probe/               SKILL.md + platform-probe.agent.ts + index.ts
│   ├── content-transformer/          SKILL.md + content-transformer.agent.ts + index.ts
│   ├── cover-artist/                 SKILL.md + cover-artist.agent.ts + index.ts
│   ├── composer/                     SKILL.md + composer.agent.ts + index.ts
│   ├── polish-reviewer/              SKILL.md + polish-reviewer.agent.ts + index.ts
│   ├── publish-executor/             SKILL.md + publish-executor.agent.ts + index.ts
│   ├── publish-verifier/             SKILL.md + publish-verifier.agent.ts + index.ts
│   └── index.ts                      (barrel)
├── services/
│   ├── roles/                        leader / steward / platform-probe / ... × 9
│   └── mission/
│       ├── workflow/
│       │   ├── stages/               s1-s12 stage adapters × 12
│       │   ├── social-pipeline-dispatcher.service.ts
│       │   └── social-business-orchestrator.service.ts
│       └── lifecycle/
│           ├── social-mission-store.service.ts
│           └── social-mission-event-buffer.service.ts
├── utils/
│   └── skill-md-loader.ts            (copy playground util — 后续若有第 3 个 ai-app 用到再抽 engine)
├── social.config.ts                  (pipeline + 9 role + 13 step 定义)
└── ai-social.gateway.ts              (WebSocket; mirror agent-playground.gateway.ts)
```

## 5 PR 拆解（每 PR ≤ 1500 行新增，独立通过 pre-push hook）

### PR-1: 骨架 + plan + 9 SKILL.md 占位 ✅ (2026-05-16)

- ✅ 本 plan doc
- ✅ `utils/skill-md-loader.ts` copy 自 playground
- ✅ `agents/{role}/SKILL.md` × 9：leader 完整版（含 4 duties: plan/assess-transform/foreword/signoff）+ 其他 8 个骨架（仅 soul block，duties 留空待 PR-2）
- ✅ `agents/{role}/index.ts` × 9 + `agents/index.ts` 顶层 barrel
- ✅ **不动 module**（避免注册空 domain）；**不写 social.config.ts**（等 stage adapter）
- ✅ **所有 SKILL.md `allowedModels: []`** —— 不硬编码模型名（CLAUDE.md 红线）；模型选择由下游 ChatFacade + TaskProfile + ModelPricingRegistry 自动决定
- ✅ 验证：`__tests__/skill-md-skeleton.spec.ts` 56/56 pass（9 role × 6 断言 + 2 整体断言）

### PR-2: 完整 9 SKILL.md（duty 内容填充）✅ (2026-05-16)

- ✅ 8 个 SKILL.md duty 详细内容填充：
  - steward → duty:budget-eval（4 闸表 + 输出 schema + 拒签触发）
  - platform-probe → duty:probe-platform（goto + evaluate sniff + dry-run saveDraft + ret code 表）
  - content-transformer → duty:transform-for-platform（WeChat/XHS/Twitter 各自字数 + 字段规则）
  - cover-artist → duty:craft-cover（三级 fallback + crop_multi schema + placehold.co 兜底色）
  - composer → duty:compose-body（PR #111 WeChat rich_pages 字节级 schema + XHS plain text）
  - polish-reviewer → duty:polish-review（CritiqueRefineService critique+refine + 极限词词典）
  - publish-executor → duty:publish-to-platform（browser-context goto+evaluate + ret code 重试矩阵）
  - publish-verifier → duty:verify-publish（URL/diff/image/ack 4 维度回读）
- ✅ leader 在 PR-1 已完整（4 duties）
- ✅ spec 更新：`all 9 roles have non-empty duties (PR-2 filled them)` 56/56 pass

### PR-3a: 9 agent.ts + duty-loader util ✅ (2026-05-16)

- ✅ 9 个 `agents/{role}/{role}.agent.ts`：每个含 zod Input/Output schema（leader 是 4-phase discriminated union；其他 8 个是单 duty 输入输出）+ `@DefineAgent` 装饰器（id / version / identity / loop=react / toolCategories / taskProfile / budget）+ `buildSystemPrompt()` 调 `buildPromptFromDuty(agentDir, dutyName, vars)`
- ✅ 9 个 `agents/{role}/index.ts` barrel 导出 Agent 类 + 类型
- ✅ `agents/index.ts` 顶层 barrel
- ✅ `utils/duty-loader.ts` copy 自 playground（{{var}} / {{#if}} / {{#each}} 最小模板）
- ✅ Spec `__tests__/duty-loader-integration.spec.ts`：12 duty 全部能 build 非空 prompt + 包含 soul/duty 分隔符；总 415/415 pass

### PR-3b: 9 role service + SocialAgentInvoker ✅ (2026-05-16)

- ✅ `services/roles/social-agent-invoker.service.ts`：thin AgentRunner wrapper（注入 AbortRegistry signal + SocialEventRelay "social." 前缀广播 + tickCost 桥接 MissionBudgetPool）
- ✅ `services/roles/social-event-relay.ts`：thin extends EventRelayFramework with "social" namespace
- ✅ `services/roles/runner-state.util.ts`：normalizeRunnerState（copy from playground）
- ✅ 9 role service（leader/steward/platform-probe/content-transformer/cover-artist/composer/polish-reviewer/publish-executor/publish-verifier）：每个 Injectable + run() 调 invoker.invoke + tickCost
- ✅ services/roles/index.ts barrel

### PR-3c: 13 stage adapter + workflow foundation ✅ (2026-05-16)

- ✅ `services/mission/workflow/mission-context.ts`：MissionInvariants + 10 phase ctx 类型（Plan/Transform/Assess/Craft/Compose/Polish/Publish/Verify/Signoff/Persist）+ MissionContext 合成
- ✅ `services/mission/workflow/mission-deps.ts`：CommonDeps（log/emit/lifecycle/markStageDegraded + 9 role service + AgentInvoker + failureLearner/postmortemClassifier）
- ✅ `services/mission/workflow/narrative.util.ts`：`social.agent:narrative` 事件 emit + 13 stage / 9 role 类型
- ✅ 13 stage adapter（每个 ~80-150 行）：
  - s1-mission-budget-eval（Steward 4 闸 + emit social.mission:started/gated）
  - s2-platform-probe（多平台 schema 探测）
  - s3-content-transform（多平台并发 ConcurrencyLimiter / markStageDegraded 单平台失败）
  - s4-leader-assess-transform（Leader M1 verdict per platform / reject 平台跳过 s5+）
  - s5-cover-craft / s6-body-compose / s7-polish-review（多平台并发）
  - s8-publish-execute（唯一副作用 stage）
  - s8b-publish-retry（≤ 2 轮按 retry matrix 重试）
  - s9-publish-verify（仅 PUBLISHED 平台）
  - s10-leader-signoff（M6 foreword + M7 signoff）
  - s11-mission-persist（emit social.mission:completed + leader_journal）
  - s12-self-evolution（postlude fire-and-forget FailureLearner.recordFailure）
- ✅ stages/index.ts barrel 导出 13 runXxxStage
- 验证：type-check 0 error

### PR-4: dispatcher + business-orchestrator + social.config.ts

- `services/mission/workflow/social-pipeline-dispatcher.service.ts`（mirror playground dispatcher，注入 MissionRuntimeShellService / MissionStageBindingsService / MissionPipelineOrchestrator / MissionCheckpointService）
- `services/mission/workflow/social-business-orchestrator.service.ts`（含 13 个 buildSXxxHooks 方法）
- `social.config.ts` 完整 13-step pipeline 定义 + roles + dag
- `services/mission/lifecycle/social-mission-store.service.ts` + `social-mission-event-buffer.service.ts`
- `ai-social.gateway.ts` WebSocket（DomainEventBus.registerAdapter(SocketBroadcastAdapter)）
- `ai-social.module.ts` 加 `onApplicationBootstrap` 调 `PromptSkillBridge.registerDomain("social")` + provider 注册全部新文件

### PR-5: mission entry + publish-executor 切换 + 真发回归

- `ai-social.controller.ts` 加 `POST /api/ai-social/mission/run`（接 dispatcher.runMission）
- `publish-executor.service.ts` 切换：原同步链式 → `dispatcher.runMission()`
- 真发 WeChat 长图文（>2000 字 + 多正文图 + 外部 cover URL）回归验证 PR #111 publish 不退化
- 真发 XHS（W4 后含 publishExecutor publishViaMcp）
- 双平台并发 mission 验证（LeaderWorkerLoop）

## 功能保活红线（W4 期间硬要求）

> **PR-5 真发回归通过前，旧 publish-executor.service.execute() 同步链式路径不下线**。即使 PR-1~PR-4 落地，前端调用仍走旧路径；只在 PR-5 切换 + 真发回归通过后才切流量。

每个 PR commit message 必须含：

- W4-PR{N} 标记
- 该 PR 的功能保活摘要（哪些功能不变 / 哪些迁移到 mission 路径）

## 风险与对策

| 风险                                 | 对策                                                             |
| ------------------------------------ | ---------------------------------------------------------------- |
| skill-md-loader 复制造成双源         | 后续若第 3 个 ai-app 用到，抽到 ai-engine/skills（YAGNI 暂留）   |
| social.config.ts dag.successors 漏配 | mirror playground，每 stage 必须列剩余所有 stage                 |
| stage rerun 链覆盖错误               | resetFields 严格按 ctxWrites + dbWrites 推导，与 playground 一致 |
| WebSocket event 命名冲突             | 用 `social.` 前缀（playground 用 `agent-playground.`）           |
| PR-5 真发失败                        | 旧 publish-executor 不下线，立即切回；PR-6 修后重切              |

---

**最后更新**: 2026-05-16
**维护者**: Claude Code
