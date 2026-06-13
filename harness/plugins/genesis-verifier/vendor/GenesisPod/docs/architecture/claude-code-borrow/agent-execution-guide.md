# Claude Code v2.1.88 → GenesisPod 借鉴落地手册

> **文档定位**：Agent（Claude Code / sub-agent / 人）按图执行的工程改造手册。每张任务卡含强成功标准、文件白名单、必读上下文、可验证步骤、DoD、回滚预案。
>
> **不是**："架构思辨"或"技术分享"。
>
> **调研基线**：2026-05-06，4 路并行调研 `d:/projects/codes/claude-code-build`（Anthropic Claude Code v2.1.88 从泄露 sourcemap 还原的 1916 个 TS 文件）。
>
> **对标项目**：Anthropic 官方 Claude Code（注释里的"1,279 sessions wasted ~250K API calls/day"类规模化运维教训是迄今最权威的 agent harness 参考）。

---

## 目录

- [0. 使用说明](#0-使用说明)
- [1. 北极星与边界](#1-北极星与边界)
- [2. 架构对照速查表](#2-架构对照速查表)
- [3. 反向洞察（Anthropic 自己踩出来的坑）](#3-反向洞察anthropic-自己踩出来的坑)
- [4. P0 任务卡（6 张，必抄）](#4-p0-任务卡6-张必抄)
  - [P0-1 microcompact + cache_edits](#p0-1-microcompact--cache_edits-api-)
  - [P0-2 退出信号 needsFollowUp](#p0-2-退出信号-needsfollowup-而非-stop_reason)
  - [P0-3 Tool maxResultSizeChars 自动落盘](#p0-3-tool-maxresultsizechars--自动落盘)
  - [P0-4 Read-before-Edit 守门](#p0-4-read-before-edit-守门filestatecache)
  - [P0-5 SKILL.md frontmatter-only 注入](#p0-5-skillmd-frontmatter-only-注入--skillinvoketool)
  - [P0-6 Hook 18 事件 + 退出码协议](#p0-6-hook-18-事件--退出码-2block--api-error-skip)
- [5. P1 任务卡（10 张，值得抄）](#5-p1-任务卡10-张值得抄)
- [6. P2 战略储备](#6-p2-战略储备)
- [7. Sub-agent 执行规约](#7-sub-agent-执行规约)
- [8. PR 提交与验证](#8-pr-提交与验证)
- [9. 失败回滚原则](#9-失败回滚原则)
- [10. 沉淀机制](#10-沉淀机制)
- [附录 A：Claude Code 关键文件位置索引](#附录-a-claude-code-关键文件位置索引)
- [附录 B：GenesisPod 接入锚点索引](#附录-b-genesis-接入锚点索引)

---

## 0. 使用说明

### 谁来读

| 角色                              | 用法                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| **主 Claude Code**                | 接到改造需求时，按 P0/P1 任务卡选一张，对照"必读上下文"读完 → 派 sub-agent / 自己执行 |
| **sub-agent**（用 Task 工具派出） | 主 Agent 只把对应任务卡 + Sub-agent prompt 模板 attach 给它，不要做"自由发挥"型派活   |
| **人类工程师**                    | 当 RFC 提案的事实底稿；改造 PR Review 时按"DoD 清单"逐项核对                          |

### 三条最重要原则

1. **每张任务卡都是"独立可交付"的最小单元**——一张卡 = 一个 PR（最多 1-2 个 commit），不允许跨卡耦合实施
2. **强成功标准**——任务卡的 DoD 是可执行命令（`npm run verify:quick` / 具体 spec），不是"做完了"这种感觉判断
3. **不许扩大白名单**——sub-agent 必须严格限定在白名单内修改；遇到必须改其他文件 → 回主 Agent 决策，不自己加

### 路线图（不是承诺，是排序）

```
W1:  P0-2 needsFollowUp 改造        (3-5d, react-loop 类，改动小)
W1:  P0-6 stop hook skip on API err (1-2d, 防死循环)
W2:  P0-3 maxResultSizeChars        (1w, tool interface + storage)
W3:  P0-5 SKILL.md frontmatter-only (1-2w, 含 SkillInvokeTool)
W4-5: P0-1 microcompact cache_edits (2w, 长期最大省钱单点)
W6:  P0-4 Read-before-Edit + WeakRef
W7+: P1-3 streaming-time tool       (3-4w，单 react-loop 试点)

并行:P1-2 conditional skills（跟 P0-5 一起做）
W10+:P1-1 18 事件 hook 谱 + JSON 协议
W12+:P1-9 Settings 多源 + managed-only

P2 看产品节奏走
```

---

## 1. 北极星与边界

### 北极星

GenesisPod ai-harness/engine 持续向 **Anthropic Managed Agent / Claude Agent SDK 形态**靠拢（沿用 [project_north_star_anthropic_managed_agent](memory) 既定方向），**而不是泛义 SOTA**。

### 边界（明确不做）

- ❌ **不复刻 Claude Code 的 React/Ink TUI**——GenesisPod 是 Web 形态，UI 层另起炉灶
- ❌ **不引入 `buddy/` 类装饰品**——Claude Code 的鸭子动画 sprite 不在借鉴范围
- ❌ **不抄 `protectedNamespace.ts` 命名空间锁**——公开构建中是 stub
- ❌ **不抄 Bedrock/Vertex provider 适配的具体实现**——GenesisPod 已用 LiteLLM 路径
- ❌ **不为单一用例做 P2 战略级抽象**——P2 任务卡只在产品节奏到位时启动

### 强成功标准

- **token 成本**：长 mission（agent-playground 12-stage pipeline）相对当前基线 **-40% 以上**（P0-1 落地后）
- **稳定性**：mission 卡死类问题（参考 [project_stage_emit_missing](memory)）下降到接近 0（P0-2 + P0-6 落地后）
- **prompt 体积**：duty.md 类内联 prompt 占用相对当前 **-50% 以上**（P0-5 落地后）

---

## 2. 架构对照速查表

> 与本手册 P0/P1 任务卡一一对应。"差距评级"决定优先级。

| 维度                     | Claude Code 设计                                                             | GenesisPod 现状                                     | 差距 | 任务卡   |
| ------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------- | ---- | -------- |
| Agent loop 退出信号      | `needsFollowUp = (assistant content 含 tool_use)`；显式弃用 `stop_reason`    | 6 个 loop 部分依赖 finalize / stop_reason           | 🟡   | **P0-2** |
| 上下文压缩               | 4 层金字塔（budget/snip/microcompact/autoCompact）+ `cache_edits` API        | `cache-control-planner.ts` 有起步，缺 `cache_edits` | 🔴   | **P0-1** |
| Tool 大输出              | `maxResultSizeChars` 每 tool 自带阈值，超限自动落盘 + preview                | 业务自己截断                                        | 🔴   | **P0-3** |
| Read-before-Edit         | `readFileState` LRU 时间戳，未读/外部更新 → 拒写                             | 无                                                  | 🔴   | **P0-4** |
| Skill 注入               | frontmatter-only（name+description+whenToUse ≤ 250 字符），1% context budget | duty.md 全文塞 Leader prompt                        | 🔴   | **P0-5** |
| Hook 协议                | 18 事件 + 退出码 2=block + JSON `updatedInput` + API error skip stop hook    | 4 事件，无 block 语义                               | 🔴   | **P0-6** |
| AbortController          | WeakRef 双弱引用                                                             | 标准 EventEmitter                                   | 🟡   | P1-7     |
| Tool 并发                | `partitionToolCalls` 按 `isConcurrencySafe(input)` 切 batch                  | category 级（已显式 inspired by）                   | 🟡   | P1-1     |
| Skill 条件激活           | frontmatter `paths:` glob 命中才上桌                                         | 无                                                  | 🟡   | P1-2     |
| streaming 期 tool 执行   | LLM stream 中 read-only tool 已开跑                                          | 等完整返回再起跑                                    | 🟡   | P1-3     |
| Withhold-then-retry      | PTL/413/Media/MaxOutput 先不发 SDK 消费方，先恢复                            | facade 处理但无分级                                 | 🟡   | P1-4     |
| ToolSearch + shouldDefer | tool schema 推迟加载，模型按需拉                                             | 全部一次性放 prompt                                 | 🟡   | P1-5     |
| MCP annotations 标准映射 | `readOnlyHint / destructiveHint / openWorldHint` 直接喂 capability           | mcp adapter 手写                                    | 🟡   | P1-6     |
| MEMORY.md 写入守护       | 200 行 + 25KB 硬截断                                                         | 无                                                  | 🟡   | P1-8     |
| Settings 多源            | 6 source 优先级 + `allowManagedHooksOnly` 锁                                 | 单层                                                | 🟡   | P1-9     |
| `@path` include          | 5 层深度 + 循环检测                                                          | 无                                                  | 🟡   | P1-10    |
| SDK 形态                 | 窄面 + NDJSON 控制协议 20 subtype                                            | REST 多 controller × DTO                            | 🔴   | P2-1     |

---

## 3. 反向洞察（Anthropic 自己踩出来的坑）

> 这些注释从 Claude Code 源码里直接抄出来。每条对应 GenesisPod 已踩过或将踩的坑。**任何 PR 不允许违反**。

| 反向坑                                                         | 后果                                                | 出处                               | 对应 GenesisPod 教训                            |
| -------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------- | ----------------------------------------------- |
| `stop_reason === 'tool_use'` 不可靠                            | 偶发漏判终止                                        | `query.ts:553-557`                 | [project_stage_emit_missing_2026_05_06](memory) |
| stop_reason 在 `message_delta` 才到，不是 `content_block_stop` | 永远读到 null                                       | `QueryEngine.ts:802-808`           | —                                               |
| `assistantMessages.push` 用原对象、yield 用 clone              | 改原对象破 prompt cache                             | `query.ts:742-787`                 | —                                               |
| API error 不跑 stop hook                                       | hook 注 token → PTL → retry 死循环                  | `query.ts:1262-1264`               | [project_p1_react_runaway_fix](memory)          |
| 必须有 autocompact 断路器                                      | 否则不可恢复的"context 永远超限"日烧 250K API calls | `query.ts:262`（注释明文）         | —                                               |
| fallback 时必须 strip thinking signature                       | signature 与模型绑定，跨模型 400                    | `query.ts:925-929`                 | —                                               |
| pinnedEdits 必须每轮重插同位置                                 | 否则字节漂移，cache 命中率从 90%→0                  | `claude.ts:3127`                   | —                                               |
| Sub-agent 默认禁用 cached microcompact                         | 写 module-level state 会跨 thread 污染              | `microCompact.ts:272-285`          | [feedback_lint_staged_stash_safety](memory)     |
| fallback 后必须 yield 配对 tool_result 占位                    | 否则 invalid_request                                | `query.ts:984`                     | —                                               |
| `streamingToolExecutor.discard()` 必须存在                     | 否则 partial tool 的 tool_use_id 与新一轮不匹配     | `StreamingToolExecutor.ts:153-204` | —                                               |

---

## 4. P0 任务卡（6 张，必抄）

> **每张任务卡的结构**：编号 + 目标 + 收益 + 工作量 + 文件白名单 + 必读上下文 + 实施步骤 + DoD + 验证命令 + 回滚预案 + 不允许的事 + Sub-agent prompt 模板。

---

### P0-1 microcompact + `cache_edits` API ⭐⭐⭐

#### 元信息

- **目标**：实现"删旧 tool_result 仍命中 prompt cache"路径，长 mission token 成本 -40~60%
- **收益**：[project_railway_pod_heartbeat_recycle](memory) 类长跑 mission 成本/延迟双降
- **工作量**：2 周（Anthropic 优先，OpenAI/Gemini fallback inline）
- **依赖**：无；可独立交付

#### 文件白名单（sub-agent 只许改这些）

```
backend/src/modules/ai-harness/runner/context/cache-control-planner.ts          # 决策入口
backend/src/modules/ai-harness/runner/context/context-compactor.ts              # 压缩主流程
backend/src/modules/ai-harness/runner/context/microcompact-planner.service.ts   # 新建
backend/src/modules/ai-harness/runner/context/__tests__/microcompact-planner.spec.ts  # 新建
backend/src/modules/ai-engine/llm/services/ai-api-caller.service.ts             # cache_edits 注入
backend/src/modules/ai-engine/llm/services/prompt-cache-coordinator.service.ts  # 协调
backend/src/modules/ai-engine/llm/services/__tests__/prompt-cache-coordinator.service.spec.ts
backend/src/modules/ai-engine/llm/types.ts                                      # CacheEditsBlock 类型
```

#### 必读上下文

**Claude Code 源（必读）**：

- `d:/projects/codes/claude-code-build/src/services/compact/microCompact.ts:253-530`（三种 microcompact 路径）
- `d:/projects/codes/claude-code-build/src/services/api/claude.ts:3052-3211`（cache_edits API 编织 + pinnedEdits 重发约束）
- `d:/projects/codes/claude-code-build/src/services/compact/autoCompact.ts:241-269`（autoCompact 触发 + 断路器）

**GenesisPod 现状（必读）**：

- `backend/src/modules/ai-harness/runner/context/cache-control-planner.ts`（现有 cache_control marker 规划）
- `backend/src/modules/ai-harness/runner/context/context-compactor.ts`（现有压缩流程）
- `backend/src/modules/ai-engine/llm/services/ai-api-caller.service.ts`（请求构造入口）

#### 实施步骤（含 checkpoint）

1. **新建类型定义** → `types.ts` 增 `CacheEditsBlock`：

   ```ts
   interface CacheEditsBlock {
     type: "cache_edits";
     edits: Array<{ type: "delete"; cache_reference: string }>;
   }
   ```

   ✅ Checkpoint：`npm run type-check`（无新错）

2. **新建 `microcompact-planner.service.ts`**：决策"删哪些旧 tool_result"
   - 输入：messages + token usage + cache marker 位置
   - 输出：`{ edits: [{cache_reference: tool_use_id}], strategy: 'cached' | 'inline' }`
   - 关键约束：`cache_reference` 严格小于最后一个 cache_control marker（参 `claude.ts:3180-3186`）
   - 同时实现 inline fallback（time-based gap > 阈值 → 直接改 tool_result content）
     ✅ Checkpoint：单测覆盖三种场景（cached / inline / no-op）

3. **`prompt-cache-coordinator.service.ts` 接入 pinnedEdits**：
   - 第一次插入 cache_edits 后，存到 session 级 state
   - 后续每轮请求**必须在原位重插同 block**（字节级一致），否则前缀漂移
     ✅ Checkpoint：补一条 spec 验证 "连续 3 轮请求 → cache_edits block 字节级相同"

4. **`ai-api-caller.service.ts` 在 user message content 注入 cache_edits**：
   - Anthropic provider → 注入；OpenAI/Gemini → 跳过走 inline
   - capability matrix 判断（参 [project_llm_capability_matrix_2026_05_06](memory) 已有 StructuredOutputRouter 模式）
     ✅ Checkpoint：mock provider，验证 anthropic body 含 cache_edits、openai 不含

5. **`context-compactor.ts` 接入决策**：在 microcompact 前先尝试 cached 路径，失败/不适用走 inline，再失败走 autoCompact
   ✅ Checkpoint：long-running mission e2e 验证 cache_read_input_tokens 增长

6. **加断路器**（参考 P0-6 同类原则）：
   ```ts
   const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;
   ```
   ✅ Checkpoint：spec 模拟连续失败 3 次后熔断

#### DoD 清单

- [ ] `npm run type-check` 通过
- [ ] 新建 spec ≥ 8 条全绿（cached / inline / fallback / pinnedEdits 重发 / 断路器 / 多 provider 切换）
- [ ] 全量 `npm run test:quick` 不引入新失败
- [ ] `npm run verify:arch` 通过（Facade 边界、单向依赖）
- [ ] Railway prod 跑一次长 mission（agent-playground 12-stage），观测 `cache_deleted_input_tokens` > 0 且 `cache_read_input_tokens` 持续命中
- [ ] [project_claude_code_borrow_plan_2026_05_06](memory) 中 P0-1 状态回填 commit hash + "✅ 落地"

#### 不允许的事

- ❌ 改任何 ai-app/ 模块（这是 harness/engine 层改造）
- ❌ 改 cache_control marker 现有规划逻辑（仅在 cache_edits 之外补充）
- ❌ 在 sub-agent / forked agent 启用 cached MC（必须禁用，参 `microCompact.ts:272-285`，否则跨 thread 污染）
- ❌ "顺便"重构 ai-api-caller.service.ts 其他无关部分

#### 回滚预案

```bash
# 单文件回滚
git checkout HEAD~1 -- backend/src/modules/ai-harness/runner/context/cache-control-planner.ts

# 永远不要：
# git checkout -- .
# git restore .
# git reset --hard
```

#### Sub-agent prompt 模板

```
你是 GenesisPod ai-harness 改造助手。

【任务】：实施 P0-1 microcompact + cache_edits API（详见 docs/architecture/claude-code-borrow/agent-execution-guide.md §4 P0-1）

【白名单】只允许修改以下文件：
  - backend/src/modules/ai-harness/runner/context/cache-control-planner.ts
  - backend/src/modules/ai-harness/runner/context/context-compactor.ts
  - backend/src/modules/ai-harness/runner/context/microcompact-planner.service.ts (新建)
  - backend/src/modules/ai-harness/runner/context/__tests__/microcompact-planner.spec.ts (新建)
  - backend/src/modules/ai-engine/llm/services/ai-api-caller.service.ts
  - backend/src/modules/ai-engine/llm/services/prompt-cache-coordinator.service.ts
  - backend/src/modules/ai-engine/llm/services/__tests__/prompt-cache-coordinator.service.spec.ts
  - backend/src/modules/ai-engine/llm/types.ts

【必读上下文】先读完再动手：
  - d:/projects/codes/claude-code-build/src/services/compact/microCompact.ts:253-530
  - d:/projects/codes/claude-code-build/src/services/api/claude.ts:3052-3211
  - backend/src/modules/ai-harness/runner/context/cache-control-planner.ts (现状)
  - backend/src/modules/ai-engine/llm/services/ai-api-caller.service.ts (现状)

【DoD】每完成一步必须验证：
  - npm run type-check 通过
  - npm run test:quick 不引入新失败
  - 新建 spec ≥ 8 条全绿（cached/inline/fallback/pinnedEdits/断路器/多 provider）
  - npm run verify:arch 通过

【硬约束】（违反任意一项立即中止）：
  - cache_reference 必须 < 最后一个 cache_control marker
  - pinnedEdits 必须每轮重插原位（字节级一致）
  - sub-agent / forked agent 默认禁用 cached MC
  - 不许改 ai-app/ 任何文件
  - 不许 git checkout -- . / git reset --hard
  - 错改一律用反向 Edit 修，不用全局 revert

完成后报告：修改的文件、新增 spec、验证命令输出。不要 commit，等主 Agent 审查。
```

---

### P0-2 退出信号 `needsFollowUp` 而非 `stop_reason`

#### 元信息

- **目标**：6 个 loop 全部改用"assistant content 含未执行 tool_use block"判定终止，弃用 `stop_reason`
- **收益**：消除 [project_stage_emit_missing_2026_05_06](memory) 类"该终止没终止 / 该继续没继续"的偶发卡死
- **工作量**：3-5 天

#### 文件白名单

```
backend/src/modules/ai-harness/runner/loop/react-loop.ts
backend/src/modules/ai-harness/runner/loop/reflexion-loop.ts
backend/src/modules/ai-harness/runner/loop/plan-act-loop.ts
backend/src/modules/ai-harness/runner/loop/leader-worker-loop.ts
backend/src/modules/ai-harness/runner/loop/simple-loop.ts
backend/src/modules/ai-harness/runner/loop/__tests__/*.spec.ts
backend/src/modules/ai-harness/agents/abstractions/agent-loop.interface.ts  # 若需要扩接口
```

#### 必读上下文

- `d:/projects/codes/claude-code-build/src/query.ts:553-557` —— 注释明文"stop_reason 不可靠"
- `d:/projects/codes/claude-code-build/src/QueryEngine.ts:802-808` —— stop_reason 在 message_delta 才到的细节
- 当前 6 个 loop 文件每个的循环退出条件

#### 实施步骤

1. 在 `agent-loop.interface.ts`（或 helper）抽一个 `hasUnexecutedToolUse(assistantContent): boolean` 工具函数
2. 6 个 loop 逐个替换循环退出判定 → 用新 helper 判
3. 保留 finalize action 路径作为显式终止信号（不冲突）
4. 每改一个 loop，**立刻跑对应 `__tests__/<loop>.spec.ts` 验证不回归**
5. 补 1 条 spec：模拟 LLM 返回 `stop_reason='end_turn'` 但 content 里仍有 tool_use → loop **不退出**继续执行

#### DoD 清单

- [ ] 6 个 loop 文件的退出判定全部走 `hasUnexecutedToolUse`
- [ ] 每个 loop 的 spec 全绿
- [ ] 新增"stop_reason 矛盾 content"防回归 spec ≥ 6 条（每 loop 一条）
- [ ] `npm run verify:quick` 通过

#### 不允许的事

- ❌ 修改 finalize action 路径（这是另一套终止信号，不冲突）
- ❌ 改 loop 之外的文件（如 tool-invoker / context-manager）
- ❌ 用 `stop_reason` 做"提示终止"也不行——一律改成"看 content"

#### Sub-agent prompt 模板（精简）

```
任务：P0-2 needsFollowUp 改造（详见 docs/architecture/claude-code-borrow/agent-execution-guide.md §4 P0-2）。

白名单：6 个 loop 文件 + 各自 __tests__。绝不许改其他。

必读：
  - d:/projects/codes/claude-code-build/src/query.ts:553-557（解释 stop_reason 为什么不可靠）
  - 现状：backend/src/modules/ai-harness/runner/loop/react-loop.ts（先看这个）

每改一个 loop 立刻跑对应 spec。完成后给出 6 个 loop 的 diff + spec 输出。
```

---

### P0-3 Tool `maxResultSizeChars` + 自动落盘

#### 元信息

- **目标**：每 tool 自带输出阈值，超限自动落盘 + 给模型 preview + path
- **收益**：消除 [project_prod_observed_issues_2026_05_04](memory) 中 "axios 50MB 撑爆 turn"
- **工作量**：1 周

#### 文件白名单

```
backend/src/modules/ai-engine/tools/abstractions/tool.interface.ts
backend/src/modules/ai-engine/tools/middleware/output-truncator.middleware.ts  # 新建
backend/src/modules/ai-engine/tools/middleware/__tests__/output-truncator.middleware.spec.ts
backend/src/modules/ai-engine/tools/middleware/index.ts
backend/src/modules/ai-engine/tools/registry/tool-registry.ts                    # 注入 middleware
backend/src/modules/ai-harness/runner/tool-invoker/tool-invoker.ts               # 调用点接 middleware
backend/src/modules/ai-engine/tools/output-manager/spill-storage.service.ts      # 新建（调 platform/storage）
backend/src/modules/ai-engine/tools/output-manager/__tests__/spill-storage.service.spec.ts
backend/src/modules/ai-engine/tools/registry/builtin-tools/*.ts                  # 给每个 builtin tool 设默认 maxResultSizeChars
```

#### 必读上下文

- `d:/projects/codes/claude-code-build/src/Tool.ts:466`（`maxResultSizeChars` 字段定义）
- `d:/projects/codes/claude-code-build/src/services/tools/toolExecution.ts`（`processToolResultBlock` 落盘逻辑）
- `d:/projects/codes/claude-code-build/src/tools/BashTool/BashTool.tsx:77`（30000 字符阈值参考）
- GenesisPod：`backend/src/modules/ai-engine/tools/abstractions/tool.interface.ts`（接口扩展点）
- GenesisPod：`backend/src/modules/platform/storage/`（落盘后端）

#### 实施步骤

1. 给 `IToolDefinition` 加 `maxResultSizeChars?: number` 字段（默认 30_000）
2. 新建 `output-truncator.middleware.ts`：
   - 输入：tool result + tool definition
   - 超阈值 → 落盘到 `infra/storage`（带 toolUseId 命名）+ 返回 `{ preview, spillPath }` 给模型
   - 不超 → passthrough
3. tool-registry 注入 middleware（参 `project_tools_skills_mechanism_pr12_2026_05_01` 已有 middleware pipeline 模式）
4. 给每个 builtin tool 设合理阈值：Bash 30K / Web 100K / RAG 50K / Read 不限
5. 补 spec：模拟 50K bytes 输出 → 验证落盘 + preview 返回

#### DoD 清单

- [ ] `IToolDefinition` 接口扩展 + 类型检查通过
- [ ] `output-truncator.middleware.ts` 完成 + 单测 ≥ 4 条
- [ ] `spill-storage.service.ts` 完成 + 单测 ≥ 3 条
- [ ] tool-invoker 集成，业务无感（旧 tool 不设阈值默认 30K）
- [ ] e2e：playground mission 跑一次确认大输出落盘正常

#### 不允许的事

- ❌ 改 storage 模块本身（用现有 API 即可）
- ❌ 给所有 tool 强制阈值（Read 类应保持 Infinity）
- ❌ "顺便"改 tool registry 其他逻辑

---

### P0-4 Read-before-Edit 守门（fileStateCache）

#### 元信息

- **目标**：所有"先读后写"语义的工具，强制时间戳/版本守门；未读 / 外部已改 → 拒写
- **收益**：消除 [feedback_no_lying_assertion](memory) / [feedback_lint_staged_pulled_other_session](memory) 类"未验证就改"
- **工作量**：1 周
- **推广面**：fs / DB row / external API state 全部 read-modify-write 场景

#### 文件白名单

```
backend/src/modules/ai-engine/tools/runtime/file-state-cache.service.ts          # 新建（LRU）
backend/src/modules/ai-engine/tools/runtime/__tests__/file-state-cache.service.spec.ts
backend/src/modules/ai-engine/tools/abstractions/tool-context.interface.ts       # 注入 readFileState
backend/src/modules/ai-engine/tools/middleware/read-before-write.middleware.ts   # 新建
backend/src/modules/ai-engine/tools/middleware/__tests__/read-before-write.middleware.spec.ts
backend/src/modules/ai-engine/tools/registry/builtin-tools/file-edit/*.ts        # Edit 类工具接入
backend/src/modules/ai-engine/tools/registry/builtin-tools/file-write/*.ts
```

#### 必读上下文

- `d:/projects/codes/claude-code-build/src/tools/FileEditTool/*.ts:275, 452, 520`（核心三处守门）
- `d:/projects/codes/claude-code-build/src/Tool.ts:158-300`（ToolContext 注入 readFileState 的方式）
- GenesisPod：`backend/src/modules/ai-engine/tools/abstractions/tool.interface.ts:9-92`（现有 ToolContext）

#### 实施步骤

1. `file-state-cache.service.ts`：LRU cache，key = path/resourceId，value = `{readAt, mtime, contentHash}`
2. `ToolContext` 加 `readFileState?: FileStateCache`（可选，未注入则跳过守门）
3. `read-before-write.middleware.ts`：写工具前比对
   - 未读过 → throw `ReadBeforeWriteError("Must Read first")`
   - 读过但盘上 mtime > cache.mtime → throw `StaleStateError("Resource changed externally")`
4. Edit / Write 类 tool 接 middleware
5. spec ≥ 6 条（首次写 / 已读再写 / 读后外部改 / 多 tool 并发读写 / DB 场景模拟 / 错误信息正确）

#### DoD 清单

- [ ] `file-state-cache.service.ts` LRU 实现 + spec ≥ 4
- [ ] `read-before-write.middleware.ts` + spec ≥ 6
- [ ] Edit / Write 类 builtin tools 全部接入
- [ ] 文档化：`docs/architecture/ai-engine/tools.md` 加一节 "Read-before-Write 协议"

---

### P0-5 SKILL.md frontmatter-only 注入 + SkillInvokeTool

#### 元信息

- **目标**：Leader prompt 只放每 skill 的 `name + description + when_to_use ≤ 250 字符`；agent 调 `SkillInvokeTool` 时才 attach 全文
- **收益**：消除 [project_skill_sediment_2026_05_01](memory) 提到"17 个 SKILL.md 沉淀完了但 agent 删不掉内联 prompt"；prompt 体积 -50%+
- **工作量**：1-2 周

#### 文件白名单

```
backend/src/modules/ai-engine/skills/loader/parsing/*.ts                          # frontmatter 解析强化
backend/src/modules/ai-engine/skills/loader/__tests__/*.spec.ts
backend/src/modules/ai-engine/skills/runtime/skill-invoke-tool.ts                 # 新建
backend/src/modules/ai-engine/skills/runtime/__tests__/skill-invoke-tool.spec.ts
backend/src/modules/ai-engine/skills/registry/skill-registry.ts                   # 注入策略
backend/src/modules/ai-app/playground/services/chat/leader-chat.service.ts  # Leader prompt 改造
backend/src/modules/ai-app/playground/playground.config.ts                  # config 增 prompt budget 配置
docs/architecture/ai-harness/skills.md                                            # 协议文档
```

#### 必读上下文

- `d:/projects/codes/claude-code-build/src/tools/SkillTool/prompt.ts:21-29, 92-110`（注入 budget 1% + 250 字符上限）
- `d:/projects/codes/claude-code-build/src/skills/loadSkillsDir.ts:100-105`（frontmatter token 估算）
- `d:/projects/codes/claude-code-build/src/commands/createSkillCommand.ts:344-399`（attach 时机：调用 Skill 工具时）
- GenesisPod：`backend/src/modules/ai-engine/skills/loader/`（现有解析）
- GenesisPod：`backend/src/modules/ai-app/playground/services/chat/leader-chat.service.ts`（当前 duty.md 全文塞 prompt 现状）
- 必读 [project_skill_sediment_2026_05_01](memory) 与 [reference_two_skill_registries](memory)（项目有 2 个 SkillRegistry，先确认改的是哪个）

#### 实施步骤

1. Frontmatter parser 严格化：`name` / `description ≤ 250 字符` / `when_to_use ≤ 250 字符` / `paths?` / `model?`
2. 新建 `skill-invoke-tool.ts`：参数 `{ skill_name: string, args?: string }`，返回 SKILL.md 全文 attach 到当前消息流
3. SkillRegistry 提供 `listSkillsForPrompt()`：返回 frontmatter-only 摘要
4. `leader-chat.service.ts` Leader system prompt 改造：
   - 替换"全文塞 18 个 duty.md"为 `listSkillsForPrompt()` 摘要 + "调 SkillInvokeTool 拉详情"指引
   - **保留 fallback flag**：环境变量 `LEADER_PROMPT_FULL_DUTIES=true` 走旧路径，便于灰度
5. e2e：跑一次完整 mission，对比 prompt token 数；预期 -50%+

#### DoD 清单

- [ ] frontmatter parser 严格化 + spec
- [ ] `SkillInvokeTool` 完成 + spec
- [ ] Leader prompt 改造（含灰度 flag）
- [ ] e2e 跑 mission，token 数前后对比报告（贴在 PR description）
- [ ] 文档 `docs/architecture/ai-harness/skills.md` 更新协议

#### 不允许的事

- ❌ 删旧的 duty.md 文件（先保留，等灰度结束）
- ❌ 改 ai-engine/skills/loader 之外的 skill 实现细节
- ❌ 同时改另外一个 SkillRegistry（参 [reference_two_skill_registries](memory)，先确认主线再动）

---

### P0-6 Hook 18 事件 + 退出码 2=block + API error skip

#### 元信息

- **目标**：扩 hook-registry 到 18 事件 + JSON `updatedInput` 协议 + API error 时跳过 stop hook（防死循环）
- **收益**：guardrail / RBAC / quota 校验从业务层 if-else → hook 配置化
- **工作量**：1.5 周

#### 文件白名单

```
backend/src/modules/ai-harness/agents/abstractions/hook.interface.ts
backend/src/modules/ai-harness/agents/core/hook-registry.ts
backend/src/modules/ai-harness/agents/core/__tests__/hook-registry.spec.ts
backend/src/modules/ai-harness/agents/core/__tests__/hook-registry.integration.spec.ts
backend/src/modules/ai-harness/runner/loop/*.ts                                  # 接入新事件
backend/src/modules/ai-harness/runner/loop/__tests__/*.spec.ts
backend/src/modules/ai-harness/runner/tool-invoker/tool-invoker.ts                # PreToolUse 时机
backend/src/modules/ai-harness/runner/context/context-compactor.ts                # PreCompact / PostCompact
backend/src/modules/ai-harness/lifecycle/mission-lifecycle/*.ts                   # SessionStart / SessionEnd
docs/architecture/ai-harness/hooks.md                                             # 协议文档
```

#### 必读上下文

- `d:/projects/codes/claude-code-build/src/utils/hooks/hooksConfigManager.ts:26-260`（18 事件元数据）
- `d:/projects/codes/claude-code-build/src/types/hooks.ts:28-176`（JSON 输出 schema）
- `d:/projects/codes/claude-code-build/src/query.ts:1262-1264`（**关键**：API error 跳过 stop hook 的注释）
- GenesisPod：`backend/src/modules/ai-harness/agents/core/hook-registry.ts`（现有 4 事件）
- GenesisPod：[project_p1_react_runaway_fix_2026_04_29](memory)（已有的 retry runaway 教训）

#### 实施步骤

1. 扩 `HookEvent` enum 到 18 项（参附录 A 列表）
2. `HookOutput` 类型新增 `decision` / `updatedInput` / `additionalContext` / `async` / `asyncTimeout`
3. hook-registry 加 `skipOnApiError: boolean` 标志（默认 true 给 stop hook）
4. 各事件触发点接入：
   - `PreToolUse` / `PostToolUse` / `PostToolUseFailure` → tool-invoker
   - `PreCompact` / `PostCompact` → context-compactor
   - `SessionStart(startup|resume|clear|compact)` / `SessionEnd` → mission-lifecycle
   - `Stop` / `StopFailure` → loop 终止时（**API error 路径跳过！**）
   - `SubagentStart` / `SubagentStop` → SubagentSpawner
5. spec ≥ 18 条（每事件至少一条）+ 1 条 "API error 时 stop hook 不跑" 防回归

#### DoD 清单

- [ ] HookEvent enum 18 项
- [ ] HookOutput JSON 协议完整
- [ ] 18 事件触发点全部接入
- [ ] API error skip stop hook 防回归 spec
- [ ] hooks.md 文档更新协议
- [ ] 与现有 EventEmitter2 通知系统不冲突（互补，不替代）

#### 不允许的事

- ❌ 替代现有 EventEmitter2 通知系统（hook 是"同步阻断 + 可改输入"的，通知系统是"异步广播"，互补）
- ❌ 给所有事件设 skipOnApiError = true（只给 Stop / PostToolUse 类）

---

## 5. P1 任务卡（10 张，值得抄）

> **结构精简**：只列目标、白名单、关键引用、DoD。完整开工时再扩到 P0 卡的详细程度。

### P1-1 Tool capability flags 矩阵 + buildTool fail-closed 工厂

- **目标**：`isReadOnly / isConcurrencySafe / isDestructive / isOpenWorld / interruptBehavior`，每项默认值往保守方向兜
- **白名单**：`ai-engine/tools/abstractions/`、`ai-engine/tools/builder/` 、`ai-engine/tools/concurrency/`
- **必读**：`d:/projects/codes/claude-code-build/src/Tool.ts:402-437, 783`
- **DoD**：tool-concurrency.service.ts 升级到 input 级；buildTool 工厂替代 abstract class 继承；spec ≥ 6

### P1-2 Conditional skills（frontmatter `paths:` glob 激活）

- **目标**：duty.md 加 `paths: ['backend/**/*.ts']`，命中文件路径才激活
- **白名单**：`ai-engine/skills/loader/parsing/`、`ai-engine/skills/registry/`
- **必读**：`d:/projects/codes/claude-code-build/src/skills/loadSkillsDir.ts:997-1058`
- **DoD**：含/不含 paths 两类 skill 各 spec 3 条

### P1-3 Streaming-time tool execution + sibling abort

- **目标**：read-only tool 在 LLM stream 时已开跑；Bash 错误级联取消同 batch 其他 Bash
- **白名单**：`ai-harness/runner/tool-invoker/`、`ai-harness/runner/loop/react-loop.ts`（单点试点）
- **必读**：`d:/projects/codes/claude-code-build/src/services/tools/StreamingToolExecutor.ts:40-519`
- **DoD**：延迟基线 vs 改造后对比 ≥ 30% 改善（agent-playground mission 取均值）；含 `discard()` 实现
- **工作量**：3-4 周（最大单卡）

### P1-4 Withhold-then-retry 错误协议

- **目标**：PTL/413/Media/MaxOutput 错误先 withhold → collapse → reactiveCompact → resume；全失败才暴露
- **白名单**：`ai-harness/runner/loop/`、`ai-engine/llm/services/ai-chat-retry.service.ts`
- **必读**：`d:/projects/codes/claude-code-build/src/query.ts:1085-1255`
- **DoD**：3 类错误（PTL / max_output / media）各 spec ≥ 3；断路器 `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3`

### P1-5 ToolSearch + shouldDefer + alwaysLoad

- **目标**：MCP tool 默认 deferred，prompt 不放 schema，agent 用 ToolSearch 工具按需拉
- **白名单**：`ai-engine/tools/abstractions/`、`ai-engine/tools/registry/`、`ai-engine/tools/search-fusion/`、新建 `ai-engine/tools/runtime/tool-search-tool.ts`
- **必读**：`d:/projects/codes/claude-code-build/src/tools/ToolSearchTool/prompt.ts`
- **DoD**：MCP tool 数 ≥ 20 时，初始 prompt 不含 schema；ToolSearch 拉取后可调用

### P1-6 MCP annotations → capability flags 标准映射

- **目标**：`readOnlyHint / destructiveHint / openWorldHint` 直接喂 capability；`inputJSONSchema` 跳过 Zod
- **白名单**：`ai-engine/tools/adapters/mcp-adapter/`
- **必读**：`d:/projects/codes/claude-code-build/src/services/mcp/client.ts:1766-2000`、`MCPTool.ts`
- **DoD**：现有 MCP tool 接入测试通过；`_meta['anthropic/searchHint' | 'alwaysLoad']` 支持

### P1-7 AbortController WeakRef 树

- **目标**：父-子 controller 用 WeakRef 双弱引用；子 abort 自动从父 listener 摘除
- **白名单**：`ai-harness/runner/concurrency/`、`ai-harness/agents/core/`
- **必读**：`d:/projects/codes/claude-code-build/src/utils/abortController.ts:68-99`
- **DoD**：长 mission 跑 100 turn 后 listener count ≤ 阈值；spec 验证 GC 后 listener 自动清

### P1-8 MEMORY.md 写入守护（200 行 + 25KB 硬截断）

- **目标**：Memory 索引超限时写入端拒绝并报警，引导拆 topic 文件
- **白名单**：`ai-harness/memory/`、新建 `ai-harness/memory/index/index-guard.service.ts`
- **必读**：`d:/projects/codes/claude-code-build/src/memdir/memdir.ts:34-103`
- **DoD**：超限 → throw + 引导信息；正常写入不受影响

### P1-9 Settings 多源合并 + managed-only 锁

- **目标**：6 source 优先级（cliArg/policy/project/user/session/local）+ `allowManagedHooksOnly`
- **白名单**：`backend/src/modules/platform/settings/`
- **必读**：`d:/projects/codes/claude-code-build/src/utils/settings/types.ts:435-499`
- **DoD**：admin 在 policy 锁住 hook → user/project 改不了

### P1-10 `@path` include + 5 层深度 + 循环检测

- **目标**：duty.md / SKILL.md / CLAUDE.md 之间互相 `@./shared.md`，自动展开
- **白名单**：`ai-engine/skills/loader/parsing/`、新建 `parsing/include-resolver.ts`
- **必读**：`d:/projects/codes/claude-code-build/src/utils/claudemd.ts`
- **DoD**：5 层 + 循环 + 不存在路径三类边界 spec

---

## 6. P2 战略储备

> **不主动起**——P2 等明确产品需求触发再启动。当前只做"知识储备"。

| #    | 机制                                                    | 触发条件                                 | Claude Code 位置                                                |
| ---- | ------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| P2-1 | 窄面 SDK + NDJSON 控制协议                              | open-api L4 重构启动 / 外部 SDK 用户出现 | `controlSchemas.ts:552-663`                                     |
| P2-2 | 三段权限流（control_request can_use_tool）              | 多租户 RBAC 复杂化                       | `structuredIO.ts` + `RemoteSessionManager.handleControlRequest` |
| P2-3 | Cron PID-lock + watchScheduledTasks daemon API          | 定时任务多 REPL 并发触发                 | `cronScheduler.ts` + `cronTasksLock.ts`                         |
| P2-4 | UpstreamProxy CONNECT-over-WS + 子进程凭据注入          | 企业版安全合规要求 secret 不出父进程堆   | `upstreamproxy.ts:160-199`                                      |
| P2-5 | Sub-agent 协议改 user-role `<task-notification>` XML    | 现有 OpenAI handoff 路线遇到边界问题     | `coordinatorMode.ts:148-160`                                    |
| P2-6 | Bash AST `parseForSecurity` 拆 `&&`/`;` 后逐段 ACL 匹配 | shell 类工具 ACL 粒度不够时              | `BashTool.tsx:445-468`                                          |

---

## 7. Sub-agent 执行规约

> 抄自 [CLAUDE.md "Sub-Agent 管控（血的教训）"](../../../.claude/CLAUDE.md)，**Agent 派活前必读**。

### 派活前主 Agent 必做

1. **明确白名单**：从对应任务卡复制文件白名单，写进 sub-agent prompt
2. **附完整上下文**：必读 Claude Code 源（带行号）+ 必读 GenesisPod 现状文件 + 相关 memory（如 `[project_skill_sediment_2026_05_01](memory)`）
3. **写明 DoD**：所有 DoD 项变成 sub-agent 必须输出的"已验证"列表
4. **指定提交策略**：默认 sub-agent **不 commit**，结果回主 Agent 审查后再统一 commit（参 [feedback_parallel_subagent_coverage_push](memory)，例外是大规模 spec 攻坚时中途 commit）

### Sub-agent prompt 通用模板

```
你是 GenesisPod ai-{harness|engine|infra} 改造助手。

【任务】实施 {任务卡编号}（详见 docs/architecture/claude-code-borrow/agent-execution-guide.md §{4|5} {任务卡编号}）

【白名单】只允许修改以下文件：
  {从任务卡复制白名单清单}

【必读上下文】先读完再动手：
  Claude Code 源（金标准）：
    - {路径:行号}
  GenesisPod 现状：
    - {路径}
  相关 memory：
    - {memory 文件名}

【DoD】每完成一步立刻验证：
  - {DoD 项 1，含具体验证命令}
  - {DoD 项 2}
  ...

【硬约束】（违反任意一项立即中止并报告）：
  - 不许改白名单外任何文件
  - 不许 git checkout -- . / git restore . / git reset --hard / git clean -fd / rm -rf
  - 不许新建 .module.ts / page.tsx / Sidebar.tsx 等入口文件
  - 不许在 sub-agent / forked agent 启用任何写 module-level state 的逻辑
  - 错改一律用反向 Edit 修，不用全局 revert
  - 输出超 2K 字时落盘到 storage，不直接塞回主 Agent

【交付】
  完成后报告：
    1. 修改的文件 + diff 摘要
    2. 新增 spec 名称 + 通过情况
    3. 验证命令实际输出（粘贴 type-check / test:quick 关键行）
  不要 commit；交回主 Agent 审查。
```

### 派活后主 Agent 必做（审查阶段）

1. **逐文件 diff 审查**：`git diff <每个被修改的文件>` 逐个核对在白名单内
2. **对照 DoD 清单**：sub-agent 报告的"已验证"项必须实际跑过（重跑 `npm run verify:quick` 确认）
3. **越权检查**：发现修改了白名单外文件 → 反向 Edit 回退该文件，不用 `git checkout -- .`
4. **commit 前再过一遍 [CLAUDE.md "交付前自检清单"](../../../.claude/CLAUDE.md)**

---

## 8. PR 提交与验证

### Commit 风格

```
feat(ai-harness/runner): P0-2 退出信号改用 needsFollowUp（弃用 stop_reason）

- 6 个 loop 全部改用 hasUnexecutedToolUse 判定终止
- 新增防回归 spec：stop_reason='end_turn' 但 content 含 tool_use → 不退出
- 关闭 [project_stage_emit_missing_2026_05_06] 提到的偶发卡死类问题

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

格式约束：

- 小写 `type(scope)`：scope 用模块路径段（`ai-harness/runner` / `ai-engine/tools`）
- header < 100 字符，不带句号
- 一个 commit 只做一张任务卡的事，不混合无关变更

### PR 拆分原则

| 任务卡                   | PR 拆分建议                                                     |
| ------------------------ | --------------------------------------------------------------- |
| P0-2（小改造）           | 1 个 PR                                                         |
| P0-1 / P0-5（中改造）    | 1-2 个 PR（如 "type 定义+类型基建" + "落地+e2e"）               |
| P1-3 streaming（大改造） | 3-5 个 PR（abstractions / single-loop POC / 推广 / e2e / 文档） |

### 必跑验证命令

每张任务卡完成必跑：

```bash
npm run type-check          # 类型检查
npm run test:quick          # 快速测试
npm run verify:arch         # 架构边界 spec
npm run verify:changed      # 变更智能验证（推 PR 前）
```

涉及前端：必须通过 Railway 远程环境实际访问 UI 验证（参 [feedback_e2e_must_visit_ui](memory)）

### 灰度策略

- P0-1 / P0-5 这类影响 token 成本/prompt 体积的改造，落地时**带环境变量灰度**（如 `LEADER_PROMPT_FULL_DUTIES=true` 走旧路径）
- 灰度跑 ≥ 3 天 + ≥ 10 次 e2e mission 无回归后才删旧路径

---

## 9. 失败回滚原则

> [feedback_no_global_revert_even_single_file](memory) + [CLAUDE.md "Git 安全操作"](../../../.claude/CLAUDE.md) 复述。

**禁止命令**（绝不用）：

```
git checkout -- .          # 全局回退
git restore .              # 同上
git reset --hard           # 丢弃所有变更
git clean -fd              # 删未跟踪文件
rm -rf <未确认归属的目录>
```

**正确做法**：

| 情况                     | 做法                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| 单文件错改且能反向修     | `Edit` 反向修复，不 revert                                                                         |
| 单文件需回退到 HEAD      | `git checkout HEAD -- path/to/specific/file`（但先 `git diff path` 确认内容不是别 session 的工作） |
| Sub-agent 越权创建了文件 | `git status` 列出 → 逐个确认是本次创建的 → 单独 `rm <file>`                                        |
| 大量回退（罕见）         | 停下来问主 Agent / 用户，**不要批量 revert**                                                       |

---

## 10. 沉淀机制

> 每完成一张任务卡必做。

1. **memory 回填**：在对应 memory 文件（如 `project_claude_code_borrow_plan_2026_05_06.md`）的对应任务卡条目下回填：
   - commit hash
   - 状态（✅ 落地 / ⏪ moot / ⏸ blocked）
   - 关键发现（如灰度数据、token 节省比例）

2. **新教训沉淀**：本次实施过程中发现的非显然问题，写进 memory：
   - `feedback_*.md` —— 用户给的指导/修正
   - `project_*.md` —— 本次实施特有的工程教训
   - `reference_*.md` —— 外部资源/工具坑

3. **文档回填**：
   - 本手册（`agent-execution-guide.md`）的对应任务卡 DoD 打勾 ✅
   - 必要时更新 `docs/architecture/ai-{harness|engine|infra}/<topic>.md` 的协议章节

4. **PR description 模板**：

   ```markdown
   ## 任务卡

   P0-X / P1-X：<标题>（详见 docs/architecture/claude-code-borrow/agent-execution-guide.md）

   ## 改动摘要

   - <文件 1>：<一句话>
   - <文件 2>：<一句话>

   ## DoD 验证

   - [x] type-check 通过
   - [x] 新增 spec ≥ N 条全绿
   - [x] verify:arch 通过
   - [x] e2e（如适用）：<结果数据>
   - [x] memory 已回填

   ## 灰度（如适用）

   <环境变量名 + 灰度策略>

   ## 关联

   - Memory: project_claude_code_borrow_plan_2026_05_06
   ```

---

## 附录 A：Claude Code 关键文件位置索引

| 主题                                   | 路径                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| 主 agent loop                          | `d:/projects/codes/claude-code-build/src/query.ts:241-1729`                   |
| microcompact 三种路径                  | `src/services/compact/microCompact.ts:253-530`                                |
| `cache_edits` API 编织                 | `src/services/api/claude.ts:3052-3211`                                        |
| autoCompact + 断路器                   | `src/services/compact/autoCompact.ts:160-269`                                 |
| StreamingToolExecutor                  | `src/services/tools/StreamingToolExecutor.ts:40-519`                          |
| Tool 并发分批                          | `src/services/tools/toolOrchestration.ts:91-116`                              |
| Tool 大接口（60+ 字段）                | `src/Tool.ts:362-695`                                                         |
| buildTool fail-closed 工厂             | `src/Tool.ts:783`                                                             |
| `maxResultSizeChars` 字段              | `src/Tool.ts:466`                                                             |
| MCP → Tool 映射                        | `src/services/mcp/client.ts:1766-2000` + `src/tools/MCPTool/MCPTool.ts`       |
| AgentTool 多 spawn                     | `src/tools/AgentTool/runAgent.ts:248-973`                                     |
| coordinator `<task-notification>` 协议 | `src/coordinator/coordinatorMode.ts:80-369`                                   |
| BashTool sandbox + AST                 | `src/tools/BashTool/BashTool.tsx:33,445-468`                                  |
| Skills 加载 4 优先级                   | `src/skills/loadSkillsDir.ts:638-714`                                         |
| Skill frontmatter 注入 budget（1%）    | `src/tools/SkillTool/prompt.ts:21-29,92-110`                                  |
| Skill 正文懒加载                       | `src/commands/createSkillCommand.ts:344-399`                                  |
| Conditional skills `paths:` 激活       | `src/skills/loadSkillsDir.ts:997-1058`                                        |
| Hooks 18 事件                          | `src/utils/hooks/hooksConfigManager.ts:26-260`                                |
| Hooks JSON 输出 schema                 | `src/types/hooks.ts:28-176`                                                   |
| Memory 200 行 / 25KB 硬截断            | `src/memdir/memdir.ts:34-103`                                                 |
| CLAUDE.md 多层加载                     | `src/utils/claudemd.ts:1-26`                                                  |
| `@path` include 5 层深度               | `src/utils/claudemd.ts`（搜 `MAX_INCLUDE_DEPTH`）                             |
| AbortController WeakRef                | `src/utils/abortController.ts:68-99`                                          |
| FileEditTool readFileState 守门        | `src/tools/FileEditTool/*.ts:275,452,520`                                     |
| SDK 公开门面                           | `src/entrypoints/agentSdkTypes.ts:1-443`                                      |
| NDJSON 控制协议                        | `src/cli/structuredIO.ts:1-80` + `src/services/sdk/controlSchemas.ts:552-663` |
| Cron + PID lock                        | `src/utils/{cronScheduler,cronTasks,cronTasksLock}.ts`                        |
| UpstreamProxy                          | `src/upstreamproxy/upstreamproxy.ts:1-286` + `relay.ts:1-120`                 |

### Hook 18 事件完整列表

```
PreToolUse / PostToolUse / PostToolUseFailure
PermissionDenied / PermissionRequest
SessionStart(startup|resume|clear|compact) / SessionEnd
Stop / StopFailure
SubagentStart / SubagentStop
PreCompact / PostCompact
TaskCreated / TaskCompleted
Elicitation / ElicitationResult
FileChanged / WorktreeCreate
Notification / UserPromptSubmit / Setup / TeammateIdle / CwdChanged / InstructionsLoaded
```

> GenesisPod 落地优先：前 12 项（`PreToolUse` / `PostToolUse` / `SessionStart` / `Stop` / `SubagentStart` / `SubagentStop` / `PreCompact` / `PostCompact`）覆盖即可。

---

## 附录 B：GenesisPod 接入锚点索引

| 主题                    | GenesisPod 路径                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Agent loop 6 形态       | `backend/src/modules/ai-harness/runner/loop/{react,reflexion,plan-act,leader-worker,simple}-loop.ts` + `loop-registry.ts`        |
| 上下文压缩              | `backend/src/modules/ai-harness/runner/context/{cache-control-planner,context-compactor,priority-pruner,token-estimator}.ts`     |
| LLM 调用入口            | `backend/src/modules/ai-engine/llm/services/{ai-chat,ai-api-caller,ai-chat-failover-caller,prompt-cache-coordinator}.service.ts` |
| Tool 抽象               | `backend/src/modules/ai-engine/tools/abstractions/tool.interface.ts`                                                             |
| Tool registry           | `backend/src/modules/ai-engine/tools/registry/tool-registry.ts` + `categories/`                                                  |
| Tool middleware         | `backend/src/modules/ai-engine/tools/middleware/`                                                                                |
| Tool concurrency        | `backend/src/modules/ai-engine/tools/concurrency/tool-concurrency.service.ts`                                                    |
| Skill loader            | `backend/src/modules/ai-engine/skills/loader/{parsing,loading,caching}/`                                                         |
| Skill registry          | `backend/src/modules/ai-engine/skills/registry/`（注意 [reference_two_skill_registries](memory) 有 2 个）                        |
| Hook registry           | `backend/src/modules/ai-harness/agents/core/hook-registry.ts`                                                                    |
| Hook 接口               | `backend/src/modules/ai-harness/agents/abstractions/hook.interface.ts`                                                           |
| Mission lifecycle       | `backend/src/modules/ai-harness/lifecycle/mission-lifecycle/`                                                                    |
| Memory（运行时）        | `backend/src/modules/ai-harness/memory/{vector,working,checkpoint,consolidation,indexing}/`                                      |
| Storage（落盘）         | `backend/src/modules/platform/storage/`                                                                                          |
| Settings                | `backend/src/modules/platform/settings/`                                                                                         |
| Tool sandbox            | `backend/src/modules/ai-engine/tools/sandbox/`                                                                                   |
| Pricing registry        | `backend/src/modules/ai-engine/llm/pricing/model-pricing.registry.ts`                                                            |
| Agent playground 业务层 | `backend/src/modules/ai-app/playground/services/chat/leader-chat.service.ts`                                                     |

---

## 文档维护

- **维护者**：主 Claude Code（每次 P0/P1 任务卡完成时回填）
- **版本**：v1.0（2026-05-06 初版）
- **关联 memory**：
  - [project_claude_code_borrow_plan_2026_05_06](memory) —— 原始借鉴清单
  - [reference_claude_code_v2_1_88_source](memory) —— 路径索引
  - [project_north_star_anthropic_managed_agent](memory) —— 北极星目标

> **更新这份文档的红线**：
>
> - 任务卡 DoD 变更必须在文档里改，不能口头约定
> - 新发现的"反向洞察"必须补到 §3
> - P2 升级到 P0/P1 时同步移动 + 写明触发条件
