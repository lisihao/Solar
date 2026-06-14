# AI Social → Agent Team 重构设计

> **Status**: Active (W1 开始 2026-05-16)
> **Branch**: `refactor/ai-social-agent-team`
> **Tracking**: GenesisPod Agent Teams workflow

## 目标

把 AI Social 从单体 adapter + 同步链式编排，重构成对齐 `agent-playground` 形态的 Agent Team —— 复用 `ai-harness` 的 Pipeline / Runner / 韧性 / 学习能力，复用 `ai-engine` 的 LLM / 内容处理 / 凭证能力，**消除自实现的 puppeteer 编排、手工调度、god class**。

## 诊断报告

### 1. 当前架构成熟度评分

| 维度        | 评分    | 关键证据                                                                                                                                       |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Facade 合规 | ✅ 100% | LLM 走 `ChatFacade.chat()` / Engine 反向端口 `SOCIAL_PUBLISH_PORT` / 无 SDK 直调                                                               |
| God class   | ❌ 60%  | `wechat.adapter.ts` **2135 行** / `ai-social.service.ts` **1388 行**，单文件包揽 puppeteer + cookies + image + saveDraft + LLM + state machine |
| 抽象缺失    | ❌ 40%  | puppeteer 100% 自实现，无 `BrowserContextTool`；retry/delay/state machine 散在各处                                                             |
| 平台一致性  | ❌ 50%  | XHS 走 MCP / WeChat 自实现 puppeteer，重构 Agent Team 时定向困难                                                                               |
| 编排成熟度  | ❌ 30%  | `setInterval(60s)` 手工调度 / 同步链式 / 无 mission lifecycle / 无 checkpoint                                                                  |
| 学习闭环    | ❌ 0%   | 失败重发只 retry 不归因，无 postmortem，PR #97-110 撞墙 14 轮因此放大                                                                          |

**总成熟度 60%**。

### 2. 业务流分析

当前 publish 一篇文章走 5 大步骤（高度同步耦合）：

```
1. initConnection → startLoginSession → verifyConnection
2. publish-executor.execute(contentId) → status: PENDING → PUBLISHING
3. content-version.generateVersion → ChatFacade LLM 改写标题/digest
4. wechat.adapter.publish() 内部：
   ├─ cookies 恢复 + goto + 4-fold selector retry
   ├─ summarizeTitle (LLM)
   ├─ uploadImages (PR #111 完整 schema)
   ├─ runSaveDraftAttempts (PR #111 v2-multi-suffixed-count1-har)
5. UPDATE status = PUBLISHED/FAILED
```

天然 Agent 拆分点：

- **LoginAgent**（initConnection + verifyConnection 状态机）
- **TransformAgent**（generateVersion 平台适配）
- **PlatformProbeAgent**（schema 探测 + capability audit）
- **ComposeAgent**（正文 HTML 注入 + cover schema）
- **PublishAgent**（执行 puppeteer/MCP/API）
- **VerifyAgent**（发布后 URL 校验）
- **ScheduleAgent**（轮询 → bullmq 化）

## 目标态架构

### 1. 9 Agent 角色（对齐 Playground 8 + 新增 PublishExecutor）

```
SocialPublishMission（对标 playground mission）
├─ Leader           — Mission 唯一负责人，4 milestone (plan/assess/signoff/postmortem)
├─ Steward          — 资源守门 (budget/cost/concurrency/session-health)
├─ PlatformProbe    — 平台 schema 探测 + capability audit
│                     [对标 Researcher]
├─ ContentTransformer — 跨平台内容适配 (标题压缩/digest/字数)
│                     [对标 Reconciler]
├─ CoverArtist      — 封面生成/选择/裁剪 (含 crop_multi schema)
│                     [对标 Analyst]
├─ Composer         — 正文 HTML schema 注入 (rich_pages wxw-img 等)
│                     [对标 Writer]
├─ PolishReviewer   — 内容润色 + SEO + 合规 (复用 CritiqueRefineService)
│                     [对标 Reviewer]
├─ PublishExecutor  — 平台发布执行 (puppeteer/MCP/API) ★ AI Social 独有
└─ PublishVerifier  — 发布后 URL 抓取 + 索引检测 + 内容回读
                      [对标 Verifier]
```

### 2. 12-stage Pipeline

```
S1  budget-eval         (Steward)        — 预算 + session-health 闸
S2  platform-probe      (PlatformProbe)  — 平台 schema 探测
S3  content-transform   (ContentTransformer, parallel/platform)
S4  leader-assess       (Leader)         — 评审转换结果
S5  cover-craft         (CoverArtist)    — 封面 + crop_multi
S6  body-compose        (Composer)       — 正文 HTML schema
S7  polish-review       (PolishReviewer) — CritiqueRefine + sanitize
S8  publish-execute     (PublishExecutor, parallel)
S8b section-quality     — 单平台失败重试 (复用 chapter-pipeline)
S9  publish-verify      (Verifier)
S10 leader-signoff      (Leader)
S11 mission-persist     — socialContent + ReportArtifact
S12 self-evolution      (fire-and-forget) — FailureLearner
```

### 3. 复用能力清单

#### 从 `ai-harness/facade` 复用

```typescript
// Pipeline 编排
(MissionPipelineOrchestrator, defineMissionPipeline, ALL_STAGE_PRIMITIVES);

// Runner（多平台并发用 LeaderWorkerLoop）
(LeaderWorkerLoop, AgentExecutorService, ExecutionCheckpointService);

// 质量门
(CritiqueRefineService, ReportQualityGateService);

// 韧性 & 学习
(CircuitBreakerService, FailureLearnerService, PostmortemClassifierService);
(MissionHealthMonitor, MissionLivenessGuard);

// 记忆 & 事件
(HierarchicalMemoryCascadeService, DomainEventBus, EventRelayFramework);

// Mission 生命周期
(MissionRerunOrchestrator, MissionAbortRegistry);
```

#### 从 `ai-engine/facade` 复用

```typescript
AiChatService; // 保留现状
ImageMatchingService; // 替代 cover hardcoded
sanitizeMarkdownBody; // 18 条 markdown 清理规则
KeyResolverService; // BYOK 凭证（session 加密改它管）
ToolRegistry; // W2 注册 BrowserContextTool
```

#### W2 新增到 `ai-engine/tools/categories/automation/`

```
BrowserContextTool       // 封 puppeteer goto/click/waitForSelector/page.evaluate/cookies/screenshot
                         // 是所有平台 PublishExecutor 唯一的 puppeteer 入口
```

## 5 波次迁移路径

### W1: 前台 workflow 顶部 stepper（**当前进行中**）

> **目标**：UI 立即可见对齐 Playground 风格 + 0 backend 改动 + 解耦后端节奏。

- 改 `frontend/app/ai-social/create/page.tsx` layout `flex-row → flex-col`
- 改 `frontend/components/ai-social/create/StepNavigation.tsx`：w-72 sidebar → top horizontal stepper
- 4 步骤紧凑 stepper（Source / Platform / Account / Content）
- 复用 `frontend/components/playground-ui/` 的 StatusPill / Card 风格

**验证**：本地启 frontend dev server，4 步骤 stepper 在顶部，点击切换正常，store 状态不变。

### W2: BrowserContextTool 抽到 Engine ✅ (2026-05-16)

- ✅ 新增 `backend/src/modules/ai-engine/tools/categories/automation/browser-context.tool.ts`
- ✅ 实现 ITool 接口（12 op）：openPage / closePage / goto / click / type / press / waitForSelector / waitForFunction / getCookies / setCookies / screenshot / evaluate
- ✅ 单测覆盖：25 个 case，mock puppeteer Page + BrowserContext
- ✅ 注册到 ToolRegistry：`tools.provider.ts` + `BUILTIN_TOOLS.BROWSER_CONTEXT`
- ✅ facade export：`ai-engine/facade/index.ts` 暴露 `BUILTIN_TOOLS`
- ✅ wechat.adapter 小试：行 336 `page.cookies()` → `readContextCookies(contextId)` 通过 ToolRegistry.get(browser-context).execute
- ✅ 3 个 wechat.adapter spec 同步加 ToolRegistry mock；132/132 spec 全绿

**设计要点**：

- 单 dispatcher tool（input.op = enum）+ 通过 contextId 复用 BrowserService 的 Page，不持有 Page 状态
- sideEffect = 'idempotent'（无平台直发 op，mission 重跑可重入）
- 只暴露 generic primitives；平台特定 page.evaluate(业务 fetch) 留 adapter，不污染通用 tool
- Page-level cookies() 改 BrowserContext-level cookies()（puppeteer 新 API；下游 domain 过滤兼容）

### W3: God class 拆分

- `wechat.adapter.ts` 2135 行 → 4 子服务：
  - `wechat-login.service.ts`（cookies 恢复 + 登录验证）
  - `wechat-image-upload.service.ts`（W2 后已存在，扩充）
  - `wechat-content-compose.service.ts`（正文 HTML schema 注入）
  - `wechat-save-draft.service.ts`（schema 选择 + API 调用）
- `ai-social.service.ts` 1388 行 → 3 子服务：
  - `platform-connection.service.ts`（连接生命周期）
  - `mission-executor.service.ts`（W4 改为 Agent Team 入口）
  - `mcp-bridge.service.ts`（XHS MCP）
- 每文件 <500 行
- spec 跟着拆 + 全量真发回归

### W4: Pipeline + Agent Team 接入

- 建 `backend/src/modules/ai-app/social/agents/{role}/SKILL.md` × 9 角色
- 每 role 一个 service 类（如 `services/roles/composer.service.ts`）
- `services/mission/workflow/social-pipeline-dispatcher.service.ts`（对标 PlaygroundPipelineDispatcher）
- `services/mission/workflow/social-business-orchestrator.service.ts`（stage hook builders）
- `publish-executor.service.ts` 重写：调 `MissionPipelineOrchestrator.executePipeline()`
- 前台 W1 stepper + 后端 12 stage 联动（WebSocket `social.mission:lifecycle` 事件）

### W5: XHS 也走 Agent Team + 韧性 + 学习

- XHS MCP 路径包成 `PublishExecutor.publishViaMcp()` 子能力（与 puppeteer 同级）
- 多平台并发：`LeaderWorkerLoop`
- `CircuitBreakerService` 接 session-health（失效自愈）
- `FailureLearnerService` 接 postmortem（PR #97-110 14 轮撞墙的回避机制）
- `MissionHealthMonitor` 替代 `session-health-check.scheduler.ts` 手工 `setInterval(60s)`

## SKILL.md 模板

```markdown
---
id: social.composer
name: Composer
duties: [body-compose, image-injection]
allowedTools: [browser-context, image-matching]
allowedModels: [chat]
---

# Soul

你是 GenesisPod AI Social 的 Composer，负责把 ContentTransformer 输出的正文文本，注入符合目标平台的 HTML schema。

核心职责：

1. 识别正文里的 <img> 标签，替换为平台特定 schema（如 WeChat 的 rich_pages wxw-img js_insertlocalimg + data-imgfileid + data-aistatus）
2. 包裹必要的容器节点（如 WeChat 的 <section style="text-align:center;" nodeleaf="">）
3. 移除外站图床引用（防盗链）

<!-- duty:body-compose:start -->

# Body Compose

按 [N] 段落顺序处理正文文本：

1. 抽取所有 <img src=...> 节点，对每张外站图调 BrowserContextTool.uploadCover() 拿 file_id + cdn_url
2. 替换为完整平台 schema HTML
3. 拼回完整 content0 字段

输入：content text + platform spec
输出：HTML 字符串（含完整平台 schema）

<!-- duty:body-compose:end -->
```

## 功能保活红线（用户硬要求 2026-05-16）

> **"功能上务必确保可用！！！！"** —— 用户明确指令。

**每波次合并前必须真发回归通过**，验证 PR #111 修好的 WeChat 草稿发布功能不退化：

1. 草稿箱列表卡缩略图正常显示
2. 草稿编辑器正文图正常渲染
3. saveDraft 响应 `cover_check_info.err_format` 为空
4. type=10 / type=77 行为符合 HAR 实证基线
5. session 健康检查、登录恢复、外链图上传链路全部可用
6. 用户手动点击群发后真实发送成功（如 W1-W3 不涉及发布链路改动可豁免）

**W2/W3/W4/W5 涉及 publish 链路时**，必须：

- 真发一次 WeChat 长图文（>2000 字 + 多正文图 + 外部 cover URL）
- 真发一次 XHS（W4 后）
- 双平台并发 mission（W5 后）
- 失败注入测试（W5 后，模拟 session 失效 / 平台拒绝）

**禁止行为**：

- ❌ 重构期间用"未来修复"占位（占位文档/TODO 不算交付）
- ❌ 临时关闭旧测试（保留 spec，测试覆盖必须持续 ≥85%）
- ❌ 跳过真发验证（pre-push 通过 ≠ 功能正常）

## 验证标准

每波次必须满足：

- `npm run verify:full` 全过（lint + type + test + build）
- pre-push hook 5 项过（god-class / arch / type-check / build / changed-tests）
- 真发回归（Railway 部署后真发一次，对照截图验证）
- **功能保活红线 6 项**（见上）
- 完成后 commit message 含 W{N} 标记 + 功能保活验证摘要

## 风险与对策

| 风险                             | 对策                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| W3 拆分破坏现有 spec             | spec 跟着拆，名字 → 子服务 spec，原 wechat.adapter.spec 保留集成测试                       |
| W4 改动太大 review 困难          | 拆 PR：先 SKILL.md + role services，再 dispatcher + orchestrator，再 publish-executor 切换 |
| 前后端节奏不一致                 | W1 完成后立即拉 PR 不等 backend，W4 后端联调时 frontend WebSocket schema 才需要变          |
| Puppeteer ops 跨 worktree 测试难 | W2 BrowserContextTool 用 mock Page，集成测试只在 fix-wechat worktree 真跑                  |

## 文档维护

- 每波次完成后回填 commit hash 到本文件
- 完成 commit 后 push 到 `refactor/ai-social-agent-team` 分支
- 全部完成后开总 PR squash merge 到 main

---

**最后更新**: 2026-05-16
**维护者**: Claude Code
