# Coding Agent 底层支撑可行性评估与落地方案

> **真实目标（2026-05-21 澄清后）**：不是做面向用户的 coding 应用，而是建一个**内部 coding-agent 能力（底层支撑）**，作为 **AI Research / AI Insight** 流水线的最后一步「原型物化」：研究/洞察产出 → 调用此能力 → 生成一个能跑、能预览的**产品原型**。
>
> **原型形态：轻重都要**——
>
> - **轻**：前端 / Web 交互原型（点击 demo、dashboard、落地页、数据可视化）。
> - **重**：全栈可运行 MVP（带后端 / 数据库 / 多语言 / 真实 API）。
>
> 设计核心：**上层共用，执行后端按任务分流**——轻走浏览器（免费），重走真容器（按需付费）。
>
> 评估方法：5 个维度并行派探查代理逐一 Read 真实源码，交叉核对，**不凭记忆/不猜测**。
> 状态：评估完成（已按"轻重双层"目标改写）。待决策项见 §11。
> 最后更新：2026-05-21

---

## 1. 结论先行（TL;DR）

**可行。"轻重都要"不是负担，而正是 port 解耦设计存在的理由：一套上层 + 两个可换的执行后端。**

- **一条共用脊柱**：PrototypeAgent + coding 工具 + 与 Research/Insight 的集成 + `ProjectBundle`（多文件项目产物抽象）——轻重任务**完全共用**，只在最底层"执行/预览后端"分流。
- **轻任务（前端原型）**：执行搬进**用户浏览器**（Sandpack / WebContainers），服务端不跑容器。→ 绕开"执行基座为零"、绕开"Railway 跑不了容器"、大幅缓解"RCE 安全红线"。**用开源免费的 Sandpack 起步，$0。**
- **重任务（全栈 MVP）**：执行走**外部真容器沙箱**（E2B / Modal / Fly Machines），暴露端口出预览 URL。这把原评估里的容器成本/安全/部署问题局限在**这一层**，且**只在任务真需要时才触发**。
- **关键策略**：**先建脊柱 + 轻后端**（免费、最快端到端验证），**再把重后端当"第二个适配器"接上**——上层零改动。加重 = 加适配器，**不是重写**。
- **Railway 始终只当后端宿主**；重任务的容器执行放到 E2B/Modal/Fly，不在 Railway 跑（平台不支持动态拉容器，详见 §10）。

> 一句话：脊柱 + 轻后端是**数周的中等能力建设**；重后端是**可增量叠加的一个适配器 + 按需的容器成本**。两者共用一套 agent/工具/集成，靠一个"执行路由"按任务选层。

---

## 2. 评估方法与读过的真实代码

| 维度            | 关键文件（节选）                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 运行循环 Runner | `ai-harness/runner/loop/react-loop.ts`(2069行)、`runner/tool-invoker/tool-invoker.ts`、`runner/executor/agent-executor.service.ts`、`evaluation/thresholds.constants.ts`             |
| 工具系统 Tools  | `ai-engine/tools/abstractions/tool.interface.ts`、`base/base-tool.ts`、`registry/tool.registry.ts`、`middleware/tool-pipeline.ts`、`adapters/mcp/*`                                  |
| 执行/产物       | `ai-engine/tools/categories/execution/container-executor.tool.ts`(stub)、`ai-infra/storage/runtime/r2-storage.service.ts`、`infra/onprem/docker-compose.yml`、`backend/package.json` |
| 限额/状态/韧性  | `guardrails/budget/*`、`guardrails/resources/*`、`memory/checkpoint/*`、`lifecycle/supervisor/*`                                                                                     |
| 注册/编排/链路  | `agents/core/agent-factory.ts`、`agents/abstractions/identity.interface.ts`、`teams/registry/team-registry.ts`、`ai-app/teams/*`、`facade/index.ts`                                  |

---

## 3. 分层就绪度（针对"原型物化"双层目标）

| 维度                  | 就绪度        | 现状                                                          | 差距（轻 / 重）                                                                      |
| --------------------- | ------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Agent 定义/注册/Teams | 就绪 4/5      | `IAgentIdentity`、`AgentFactory`、`TeamRegistry`、Facade 齐全 | 加一个 PrototypeAgent skill 经 facade 暴露；轻重共用                                 |
| 工具抽象              | 部分 3/5      | `ITool`+管道+`sideEffect`+落盘+MCP 已集成                     | 轻：虚拟文件树工具（简单）；重：加 install/run-server/db 工具                        |
| 运行循环 Runner       | 部分 3/5      | perceive→reason→act→reflect、并行工具、circuit breaker、Abort | 轻：循环短够用；**重：需补 autocompact + MAX_CONSECUTIVE_FAILURES + loop 级 resume** |
| 限额/状态             | 部分 2.5/5    | Redis token 预算、模型降级、checkpoint 存储                   | 轻：压力小；**重：需单任务成本硬停 + 实时预估 + 执行计费**                           |
| 执行/预览             | 缺失→分层解决 | 后端零执行能力；已有 R2 静态托管                              | **轻：浏览器预览（绕过后端沙箱）；重：外部容器沙箱（E2B/Modal）**                    |

> 注：原评估的 P0 缺口（执行沙箱、长程循环、成本失控、Railway 容器）**只在"重"这一层重新出现**，且被 port 隔离到外部 provider；"轻"这一层基本无此负担。

---

## 4. scope：共用脊柱 vs 分层差异

**共用脊柱（轻重一致，先建）**：

- PrototypeAgent / PrototypeSkill（ai-harness）
- 面向虚拟项目的 coding 工具（file-write / apply-edit / scaffold-from-template / read-project）
- `ProjectBundle` 产物抽象（多文件树 + 元数据）
- 与 Research/Insight 的契约 + facade 暴露
- 执行路由 `SandboxRouter`（按任务选层）

**分层差异（只在执行/预览后端）**：
| | 轻（前端原型） | 重（全栈 MVP） |
|---|---|---|
| 后端 | 浏览器 Sandpack / WebContainer | 外部容器沙箱 E2B / Modal / Fly |
| 执行位置 | 用户浏览器（客户端） | 外部 provider（服务端编排） |
| 预览 | 浏览器内 iframe / 可发布到 R2 | 沙箱暴露端口 → 公开预览 URL |
| 工具增量 | 无 | install-deps / run-server / db-migrate |
| 循环 | 短（生成→预览→修复） | 长（需 autocompact / resume / 成本硬停） |
| 成本 | 近免费 | 按用量（仅该任务） |
| 安全 | 浏览器天然隔离 | 容器隔离 + 白名单 + 人审批 |

---

## 5. 推荐架构

### 5.1 分层（一套上层 + 可换执行后端）

```
AI Research / AI Insight (现有 ai-app)
   └─ 流水线末步「物化原型」(经 facade，输入=结构化原型规格)
        └─ Harness 能力: PrototypeAgent / PrototypeSkill        ← 共用脊柱
              └─ coding 工具 (ai-engine/tools/coding)            ← 共用脊柱
                   └─ ProjectBundle (多文件项目产物)            ← 共用脊柱
                        └─ SandboxRouter（按 ExecutionProfile 选层）← 共用脊柱
                              ├─ Tier-1 浏览器：Sandpack / WebContainer   ← 轻，免费
                              └─ Tier-2 容器：E2B / Modal / Fly Machines  ← 重，按需付费
                                    （Railway 只当后端宿主，不跑容器）
```

> 分层依据（遵守 MECE）：PrototypeAgent/Skill → `ai-harness`；coding 工具 → `ai-engine/tools`（项目唯一 tools）；R2 托管 → 已有 `ai-infra/storage`；Tier-2 容器后端 → `ai-infra/execution` 适配器；Tier-1 预览运行时在客户端，不进后端分层。

### 5.2 SandboxRouter：按任务选层（类比现有 LLM 的 TaskProfile 路由）

- 输入 `ExecutionProfile`：`{ needsServer, needsDatabase, language, deps }`（由原型规格推导）。
- 规则：纯前端 / 仅 Node 前端工具链 → **Tier-1**；要后端/DB/非 JS/真实 API → **Tier-2**。
- 与你现有"LLM 按 TaskProfile 自动选模型"同构——执行也按 profile 自动选后端。
- 路由结果对上层透明：PrototypeAgent 和工具不关心代码最终在浏览器还是容器里跑。

### 5.3 coding 工具

- **共用**：`scaffold-from-template` / `file-write` / `apply-edit`（`idempotent`）/ `read-project`（`none`，可缓存）/ `build-verify`。
- **重任务增量**：`install-deps` / `run-server` / `db-migrate`（仅 Tier-2 启用，经沙箱端口执行）。
- 全部走现有 `ITool` + 中间件管道（权限/限流/超时/落盘）。

---

## 6. 与 Research / Insight 的集成

- **契约**：输入 = 结构化原型规格（页面/组件/数据/交互；全栈则含数据模型/接口）；输出 = `ProjectBundle`（文件树 + 预览/发布 URL + tier 标记）。
- **接入点**：mission-pipeline 末步「materialize」，经 `ai-harness/facade` 暴露 `generatePrototype(spec)`，Research/Insight 报告生成后调用。
- **同辈参照**：AI Office 已做"文档/PPT/设计"的模板化 artifact 生成；本能力是其兄弟——产物从"文档"变"可运行代码"，可复用模板/生成范式。

---

## 7. 预览 / 运行选型

**Tier-1 轻（前端）**
| 方案 | 成本 | 许可 | 建议 |
|---|---|---|---|
| Sandpack（CodeSandbox） | 免费 | 开源 MIT/Apache | **MVP 首选**：零费用零后端即时预览 |
| WebContainers（StackBlitz） | 商用需 license | 个人/教育/开源免费 | 需真 dev server/HMR/Next dev 时升级；需 COOP/COEP 头，限 Chromium/Firefox |
| 服务端 build → R2 | 近免费（已有 R2） | — | 作"发布/分享"步；build 时 `--ignore-scripts`+受限 worker 防 RCE |

**Tier-2 重（全栈）**
| 方案 | 成本 | 备注 |
|---|---|---|
| E2B | 免费额度起 / 开源可自托管 | Firecracker，专为 AI agent，暴露端口出预览 URL，**首选** |
| Modal | ~$30/月免费额度起 | serverless 容器，web endpoint |
| Fly Machines | 按用量 | REST API 秒级起停 microVM；可自管 |

> 各家免费额度/定价变动频繁，立项前以官网 pricing 为准。

---

## 8. 分阶段路线图（每阶段带可验证目标）

**Phase 0 — 探针（2–3 天）**：前端嵌 Sandpack，手喂一个 React 文件树出 live preview。验证：浏览器跑起生成的原型，$0。

**Phase 1 — 脊柱 + 轻后端 MVP（1.5–2.5 周）**：PrototypeAgent + 轻量 coding 工具 + `ProjectBundle` + `SandboxRouter`（先只有 Tier-1）+ facade `generatePrototype`。验证：给真实研究规格，自动生成可在 Sandpack 跑起来的前端原型，无需人工补文件。

**Phase 2 — 轻任务韧性 + 发布（1.5–2 周）**：构建错误自修复循环；服务端 build → R2 持久分享 URL；单任务 token 硬停。验证：首版报错能自修复至可跑；产出可分享持久 URL。

**Phase 3 — 重后端适配器（2–3 周，含外部沙箱接入）**：实现 Tier-2 适配器（E2B 首选）+ SandboxRouter 接入重任务工具（install/run-server/db）；ReActLoop 补 autocompact + MAX_CONSECUTIVE_FAILURES + loop resume；执行计费。验证：给一份全栈规格，自动生成并在容器沙箱跑起带后端的 MVP，出预览 URL，全程不失控、可计费。

**Phase 4 — 生产化（按需）**：重任务并发隔离 / 资源限额 / otel；评估自托管 E2B vs 托管账单。

> 顺序要点：**脊柱在 Phase 1 一次建好，轻后端先上**（免费快验证）；**重后端是 Phase 3 增量叠加的适配器**，不回头改上层。

---

## 9. 成本

- **轻（Sandpack + 已有 R2）**：$0 额外基础设施（仅 LLM token）。
- **重（E2B/Modal）**：按用量，**仅全栈任务触发**；免费额度覆盖 dev/MVP 量级。
- **SandboxRouter** 确保：不需要全栈的任务不会烧容器成本。

---

## 10. 主要风险

1. **重任务把原 P0 带回来**：执行沙箱、长程循环失控、成本失控——但被 port 隔离在 Tier-2 + 外部 provider，且仅按需触发。
2. **Railway 不能动态拉容器**（无 docker socket / 非特权 / 无 ephemeral 容器原语）→ 重任务执行必须走 E2B/Modal/Fly，Railway 只当后端宿主。
3. **WebContainers 商用许可** + 需 COOP/COEP 头、限 Chromium/Firefox → 轻任务 MVP 用 Sandpack 规避。
4. **服务端 build 的 RCE**（R2 发布步）→ `--ignore-scripts` + 受限 worker，或只在浏览器沙箱构建。
5. **生成质量**：靠模板约束 + build-verify + 自修复，别指望一次成。

---

## 11. 待决策项

| #   | 决策               | 推荐                                                                 | 影响            |
| --- | ------------------ | -------------------------------------------------------------------- | --------------- |
| A   | 执行路由方式       | 规格里**显式声明** tier（Research/Insight 知道产物类型）+ 启发式兜底 | 选层准确性      |
| B   | 轻任务预览运行时   | MVP 用 **Sandpack（免费）**，高保真再上 WebContainer                 | 成本 / 保真度   |
| C   | 重任务容器后端     | **E2B**（免费额度起 + 可自托管 + 端口预览）                          | 成本 / 自主可控 |
| D   | 是否要持久分享 URL | 要 → 服务端 build → 已有 R2                                          | 产物可分享性    |
| E   | 原型技术栈模板     | 锁 1–2 个（vite-react-ts + Tailwind；全栈加 Next/Express + SQLite）  | 生成一致性      |

---

## 12. 方案评审纪要（2026-05-21 三方评审）

> 由架构 / 产品 / 技术风险三位评审员独立 Read 本方案 + 真实源码后给出，本节为汇总裁决。三方均「有条件通过」。

### 12.1 综合结论：有条件通过

方向认可（轻重双层 + port 解耦 + 容器外置 + Sandpack 起步免费 + 仅重任务触发容器成本，且与现有端口反转范式 `SOCIAL_PUBLISH_PORT`、韧性护栏、tool `sideEffect` 机制对得上）。但**当前文档不足以启动后端编码**，须先补齐 §12.4 阻塞条件。
**Phase 0 / 规格转换 spike 可无条件先开**——纯前端、零后端架构改动、最便宜的价值验证。

### 12.2 最重要发现：最大风险被一笔带过 + 已有可复用范式被忽略

（PM 提出，架构 / 技术认同）方案把「研究报告（叙事 markdown + keyFindings + dataPoints）→ 原型规格（页面/组件/数据/交互）」当成已知输入跳过——**而这才是整条链路最难、最决定成败的一步**。代码库已有两套现成范式，必须复用或论证差异：

- slides 引擎「意图驱动设计链条」(`ai-app/office/slides/docs/ARCHITECTURE.md` §1.1)：input→意图→目标→逻辑→模板→渲染，正是「叙事→结构化产物规格」的完整实现。
- `ai-app/office/slides/presets/research.tutorial.json`：`sourceType: research-project` → 产物的契约范式。
- `ai-app/research/project/research-project-output.service.ts`：用严格 JSON schema 把 LLM 产出约束成结构化产物（FAQ/BRIEFING_DOC 等）。

### 12.3 跨评审分歧及裁决

| 分歧         | 架构意见                         | 产品意见                                                | 裁决                                                                                                                          |
| ------------ | -------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 脊柱抽象时机 | Phase 1 一次建好（但须正确归位） | 延后到 Phase 3 真有第二后端再抽，Phase 1 用最朴素单文件 | **采纳 PM**：按 YAGNI（CLAUDE.md 简洁优先），Phase 1 不建 SandboxRouter/ProjectBundle；架构归位规则作为「将来建时」的约束保留 |

### 12.4 合并阻塞条件（补齐后方可启动后端 Phase 1）

**产品 / 范围**

- [P1] 补「规格转换」专章，论证与 slides 意图链条 + research preset 的复用/差异（最高优先）
- [P2] MVP 重切到「规格转换价值验证」：Phase 1 前插 ~1 周 spike，设两个二元 gate（信息架构准确性 ≥4/5；相对已有 PPT 的不可替代价值 ≥3/5），不过则停
- [P3] Phase 3 全栈重后端移出时间表，降级为「待验证假设」（缺真实用户故事）

**架构 / 设计**（建时遵守，避免违反 MECE 单向依赖）

- [A1] SandboxRouter 拆三段归位：端口→`ai-engine/tools/abstractions`、决策→`ai-harness/runner`、适配器→`ai-infra/execution`（防 engine 反向碰预算）
- [A2] `IExecutionSandbox` 写真实方法签名 + session 生命周期归属（如 `prepare/installDeps/startServer→{previewUrl,sessionId}/exec/dispose`）
- [A3] 「共用脊柱」收窄为「工具契约 + ProjectBundle + facade 入口」；agent loop / 工具集 / guardrail 按 tier 分两套 spec（与 `agent-factory.pickLoop` 现实一致）
- [A5] 拍板 materialize 接入方式（新增 `IStagePrimitive` 进 `ALL_STAGE_PRIMITIVES` vs app 外挂）+ PrototypeAgent 的 app 归属

**技术 / 安全**

- [T1] 服务端 build 的 RCE 防护给具体方案（放进 E2B 统一执行，或 nsjail/seccomp）；`--ignore-scripts` 不能单独作防护（LLM 生成的 `vite.config.js` 等在 build 时仍是任意代码执行）
- [T2] 浏览器沙箱隔离边界明确：Sandpack iframe `sandbox` 属性（`allow-scripts` 不 `allow-same-origin`）+ 多租户 / 分享 URL 的跨用户隔离
- [T3] E2B「可自托管」立项前核实（评审认为此声称过于乐观）+ Plan B（Fly/Modal）切换成本
- [T4] PrototypeAgent 作为 sub-agent 的 isolation 要求（对应 CLAUDE.md Sub-Agent 管控）
- [T5] 重任务循环反向洞察落地不止 #5：补 #4（API error 不跑 stop hook，防 retry storm）+ #9（fallback 后 yield 配对 tool_result 占位，防 invalid_request）；#8 sub-agent 禁 cached microcompact

### 12.5 非阻塞改进项 + 事实勘误

- [A4] coding destructive 工具（install/run-server/db）标 `sideEffect: destructive` + `requiredEntitlements` + identity `forbiddenTools` 限轻任务 agent 不可调
- ProjectBundle 复用 R2 `uploadText/uploadBuffer` + Zod 校验范式（仿 `ReportArtifactZodSchema`），不另起持久化/URL 体系
- 首版只锁 E2B 一个适配器（YAGNI），Modal/Fly 标「未来可能」，不进首版端口设计
- 补产品消费链路（谁触发 / 怎么迭代 / 存储版本归属 / 失败 UX / 与 office 产物的差异定位），对齐 office 版本树范式（`content-studio.md`）
- 事实勘误：①Sandpack ≠ 真 Vite（内置打包器兼容层，`import.meta.env`/`?raw` 等会失败）→ 待决策 E 改为「Sandpack 兼容的 React 栈」；②`container-executor.tool.ts` 是按 dockerode 设计的纯 stub，E2B 适配器是**从头写**不是填空；③`react-loop.ts` 的 ContextManager 是 `@Optional()` 注入，PrototypeAgent wiring 漏注入会致 autocompact **静默跳过**；④tool-pipeline 默认管道未启用 TimeoutMiddleware，coding 工具超时需自实现

### 12.6 下一步

1. （可立即，无阻塞）启动 Phase 0 / 规格转换 spike——最便宜的价值验证。
2. 按 §12.4 修订本文档，再过一轮放行后端 Phase 1。

---

## 附：本评估未改动任何源码，所有结论基于实际 Read 的文件（见 §2）。

> 历史说明：初版按"自主操作代码库的 coding agent / 独立 ai-app/coding 应用"评估；2026-05-21 先澄清为"Research/Insight 前端原型物化底层支撑"，再澄清为"**轻重双层（前端原型 + 全栈 MVP）都要**"，据此整体改写为双层架构。**归档位置**：本能力是 ai-harness 层的跨 app 底层支撑（被 Research/Insight 复用），非 ai-app 应用，故文档由 `docs/architecture/ai-app/coding/` 迁至 `docs/architecture/ai-harness/coding-agent/`。
