# v5 评审 - architect

> 视角：系统架构师，只看 v5 新增部分（§0 新红线 + §3.1 双根目录 + §4/§9 R0.5 时机 + §10 R0.5 验收 + §11 全章）。
> 立场：方案能不能进 R0.5 PR-1 实施。只列问题，不写褒奖。

---

## P0（致命，必修）

### P0-1: §11.7 ToolPipeline plugin 化丢失中间件强顺序契约

- **问题**：§11.7 把 ToolPipeline 5 个 middleware（permission / validation / timeout / progress / cache）全部 plugin 化，宣称仅靠 `manifest.priority` 数字保证顺序。但这 5 个之间是**强语义约束**，不是数字偏好：
  - permission **必须**在所有外层（cache 不能命中未授权调用）
  - cache 命中后**必须**调用 `ctx.abort()` 跳过 terminal —— §11.3 HookBus 把 `HookAbortError` 设计成"业务级 abort 透传"，但**没说 abort 之后还会不会跑 outer onion 的 after 阶段**（telemetry plugin 必须能看到 cache hit 的 result，否则遥测漏数据）
  - rate-limit 必须在 validation 之后（不要为非法请求消配额）
  - timeout 必须包住 terminal，不能包住 cache（缓存命中是同步的，不需要 watchdog）

  这些用 priority 数字（0/100/200…）表达，每一次调整都需要全局 review priority 表。

- **影响**：
  - PR-8 cache plugin 一旦 priority 配错，可放行未授权工具调用（安全事故）
  - PR-7 telemetry 在 cache hit 路径丢失 LLM/tool 副作用记账（遥测黑洞）
  - 三年后的开发者无法仅看 manifest 知道"我这个 plugin 应该排第几"

- **建议**：
  1. 在 IPluginManifest 加 `phase: "guard" | "preprocess" | "core" | "postprocess" | "observe"` 5 段强语义阶段，priority 仅在同 phase 内排序
  2. HookBus 改成 5 段串联（guard → preprocess → core → postprocess → observe），不允许跨段 abort 跳过 observe
  3. `abort()` 必须 always 触发 onion 的 after 半段（telemetry / hook trace 必须看到 abort 路径），文档要写死："abort 不等于 short-circuit observability"
  4. §11.3 HookBus 实现要补一段 spec 用例：「permission abort 后 telemetry plugin 仍收到 after 事件」

---

### P0-2: §11.10 SDK 发布形态与 §11.13 plugin 边界看护互相违背

- **问题**：§11.13 强约束「plugin 不得 import `src/modules/ai-harness/**` 与 `src/modules/ai-engine/**` 内部」+ §11.3 IPluginContext 仅暴露 `getService<T>(token: ServiceToken<T>)` 受 capability 约束。但 plugin 实际需要拿 `RedisService / PrismaService / HttpService / TraceService` 等 NestJS provider 才能工作（§11.6 sandbox-isolated-vm plugin 要 Redis、tool-cache plugin 要 Redis、telemetry plugin 要 OTel SDK）。

  **未回答的关键问题**：
  - `ServiceToken<T>` 的具体值是什么？是字符串还是 InjectionToken？
  - 这些 token 定义在哪里？plugin-core/abstractions（plugin 看得见 token 但看不见实现）？还是 ai-infra（违反"plugin 不 import infra 内部"）？
  - `getService()` 的实现需要拿到 NestJS Injector / ModuleRef，但 §11.3 又强调"plugin 拿不到 ModuleRef"——平台内核怎么把 NestJS DI 容器暴露给 plugin-core 而不暴露给 plugin？
  - SDK 发布时（§11.10），第三方 plugin 装在用户工程里，怎么访问用户工程的 NestJS service？是要求用户在 manifest 里声明 token？token 名怎么稳定？

- **影响**：plugin-core 如果要做"capability gate + DI 抽象"，本身就是一套迷你 DI 框架。这是隐藏的 1-2 周工作量，PR 序列里没体现。如果 SDK 第三方 plugin 拿不到 service，§11.10 三层包发布形态就是空的。

- **建议**：
  1. 新增 §11.3.1：明确 `ServiceToken<T>` 是 `string | symbol`（不是 NestJS InjectionToken），由 plugin-core 维护一个 `PlatformServiceRegistry`，平台启动期把 `redis / prisma / http / tracer / logger` 等基础 service 用稳定 token 注册进去
  2. plugin manifest 声明的 capability `service:redis` 对应 token `"@genesis/service:redis"`，capability gate 校验白名单
  3. 明确"NestJS DI 仅供 plugin-core 自己用，不透传给 plugin"——plugin 拿到的永远是经过 PlatformServiceRegistry 的封装实例，**不是** NestJS provider 直接引用
  4. R0.5 PR 序列加 PR-3.5：PlatformServiceRegistry + 4 个基础 token（redis/prisma/http/tracer）落地 spec，0.5 天工作量

---

### P0-3: §11.6 ai-app `forFeature({ pluginOverrides })` 与全局 plugin 加载顺序冲突

- **问题**：§11.6 同时存在两个"plugin 配置入口"：
  1. **全局 yaml**（`src/plugins/plugins.config.yaml`）：在 PluginLoader 启动期加载 → §11.8 启动期实例化所有 plugin → 注册 hook handler 到 HookBus
  2. **ai-app 模块 forFeature**（`AiHarnessModule.forFeature({ pluginOverrides })`）：NestJS module 级别配置

  **未回答的关键问题**：
  - 全局加载在 `AppModule` bootstrap 期就完成了 hook 注册（plugin init() 已跑完），但 `AiHarnessModule.forFeature({ pluginOverrides: { "rate-limit": { config: { perAgentRpm: { research: 100 } } } } })` 在哪个时机生效？
  - 同一个 plugin 同时被 research 和 writing-team 两个 ai-app 用 `forFeature` override 不同 config，runtime 上是**两个 plugin 实例**还是**一个实例 + per-mission scoped config**？
  - 如果是一个实例，rate-limit plugin 在 hook handler 内部怎么知道当前 mission 来自 research 还是 writing-team？payload 里有 `appName` 吗？这又把 ai-app 业务名硬性引入 plugin 接口（违反 §0 业务无关红线）

- **影响**：
  - rate-limit plugin 如果用 forFeature override 实现"按 ai-app 不同限速"，必然要在 hook payload 里塞 `appName`，**直接破坏 §0 base layer 业务无关红线**
  - research/writing-team 任何配置冲突都没有冲突解决规则
  - 工程上同事会两套配置都写一遍，不知道哪个生效

- **建议**：
  1. **删掉 forFeature pluginOverrides**，全部走 yaml + 环境变量。plugin config 只在 yaml 一处定义
  2. 如果必须 per-app override，改成 plugin 内部按 `payload.meta.tenantTag` 路由（tenantTag 是 generic 概念，由 ai-app 在 hook fire 时通过 caller-injected config 注入），plugin 不感知 ai-app 名
  3. §11.6 整段重写，明确"plugin 配置全局唯一 source of truth = yaml；ai-app 不自定义 plugin 行为，只能通过 hook payload 传 generic 元数据"
  4. 这一改动同步移除 §3.1 目录图里 "ai-app 仅通过 forFeature pluginOverrides 声明使用哪些 plugin" 这句

---

### P0-4: §3.2 业务 hook 与 §11 plugin hook 是两套不同 hook 机制，文档未明确区分，会导致读者混淆

- **问题**：v3 §3.2 7 个 stage primitive 用"hook"（如 `extractDecision / dispatchAssessActions / accountability / perItemPipeline`），是**业务级回调函数**，由 ai-app 在 stage primitive 调用栈内同步注入；v5 §11 plugin "hook"（如 `LLM_REQUEST / TOOL_BEFORE / MISSION_START`）是**plugin onion middleware**，由 HookBus 异步分发。两者都叫 "hook"，且都触发"在某事件时插入逻辑"，但：
  - 注册机制不同（前者 config 字典 vs 后者 PluginRegistry）
  - 调用机制不同（前者 hooks.extractDecision(args) vs 后者 hooks.fire(HOOK_ID, payload, terminal)）
  - 谁能写不同（前者 ai-app 内业务代码 vs 后者 plugin 实现）
  - 生命周期不同（前者 mission 期 vs 后者全局启动期 init）

  全文搜索"hook"出现 100+ 次，没有任何一节告诉读者"这两个 hook 是不同的东西"。§3.2 §3.1 把 §11 plugin hook 列为"v5 新增"，但 §3.2 业务 hook 不变，读者会以为业务 hook 也归到 plugin 系统下管理。

- **影响**：
  - 实施期开发者会混淆，比如把 `accountability` hook 写成 plugin（错位 6-7 周工作量）
  - 评审期评审者无法判断某个 hook 应该走哪条路径
  - 三年后新人完全无法理解架构

- **建议**：
  1. 新增 §11.0「术语区分」小节，开篇列表对照：

  | 维度   | Stage Hook (业务级，§3.2)        | Plugin Hook (横切级，§11) |
  | ------ | -------------------------------- | ------------------------- |
  | 注册者 | ai-app 在 config                 | plugin manifest           |
  | 触发者 | StagePrimitive                   | HookBus.fire()            |
  | 作用域 | 单次 mission 内                  | 全局启动期注册            |
  | 例子   | extractDecision / accountability | LLM_REQUEST / TOOL_BEFORE |
  | 命名   | camelCase                        | dot.lowercase             |
  2. 把 §3.2 的术语统一成 **stage hook** 或 **business hook**，把 §11 的术语统一成 **plugin hook** 或 **platform hook**
  3. ESLint 看护规则要明确两类 hook 注册路径不能交叉（业务级 hook 不得用 HookBus.fire 触发，反之亦然）

---

## P1（重要，应修）

### P1-1: §11.4 首批 8 个 CORE_HOOKS 不足以支撑 §10 的 4 个 R0.5 plugin 验收

- **问题**：逐 plugin 检查需要的 hook：
  - `telemetry-otel`：要监听 LLM_REQUEST/RESPONSE / TOOL_BEFORE/AFTER / MISSION_START/END → ✅ CORE 8 hook 内
  - `tool-cache-redis`：要 TOOL_BEFORE 读 cache、TOOL_AFTER 写 cache → ✅
  - `rate-limit`：要 LLM_REQUEST 计 LLM tokens、TOOL_BEFORE 计 tool 调用 → ✅
  - `sandbox-isolated-vm`：替换的是 **engine/safety/security/sandbox**——sandbox 触发点是 tool execution **内部**（terminal 函数里跑用户代码），不是 TOOL_BEFORE/AFTER（那只能拦不能替换）。**CORE 8 hook 里没有 TOOL_EXECUTE 或类似的"替换 terminal"hook**

- **影响**：§10 R0.5 验收第 4 项"sandbox-isolated-vm plugin 落地"做不出来。要么追加 hook（破坏 R0.5 范围），要么 PR-10 实质上不能合并。

- **建议**：
  1. 在 CORE_HOOKS 加第 9 个 `TOOL_EXECUTE: "engine.tool.execute"`，特殊语义"plugin 可以**替换** terminal 实现"（不是 wrap）
  2. 或者把 sandbox plugin 推迟到 R0.5-E 第二批（先验证 wrapping 类 plugin，再做 substitution 类 plugin）
  3. §11.4 补充 hook 设计语义分类：**wrapping hook**（包住 terminal）vs **substitution hook**（替代 terminal）vs **observation hook**（只读不写），三类调用约束不同

---

### P1-2: §3.1 双根目录 `src/plugin-core/` 与 `src/plugins/` 在 NestJS 工程中的加载方式未交代

- **问题**：§11.2 写"plugin-core 在 src 根，对应概念上比 ai-infra 更底层；不属于任何 module，是平台内核"——但 NestJS bootstrap 是通过 `AppModule.imports` 拉起整个 module 树。plugin-core/plugin-core.module.ts（§3.1 目录图列出了）必须被某个上级 module imports 才会被实例化。

  **未交代**：
  - PluginCoreModule 是被 AppModule 直接 import？还是 AiHarnessModule import？
  - 加载顺序：plugin-core 必须先于 harness/engine 完成 init（hook handler 注册要在 hook fire 前），NestJS module 初始化顺序如何保证？
  - PluginLoader.load() 是 `OnModuleInit` 还是 `OnApplicationBootstrap`？前者会在 AppModule 树构造时跑（早），但此时 harness/engine provider 可能还没 init done

- **影响**：实施期会发现 plugin-core onModuleInit 跑完时 harness/engine 的 hook fire 调用栈已经在跑（如果同步触发），可能导致 hook 注册晚于第一次 fire，handler 静默丢失。

- **建议**：
  1. §11.2 加一段「加载时序保证」：明确 PluginCoreModule 由 AppModule 直接 import 且 imports 数组里**第一项**（NestJS 不保证按 imports 顺序初始化，但 imports 拓扑会让被依赖的先初始化——AiHarnessModule / AiEngineModule 必须 imports PluginCoreModule）
  2. 强制 plugin init 走 `OnApplicationBootstrap` 而非 `OnModuleInit`（应用启动最末尾，所有 provider 已就绪）
  3. 添加架构 spec：`plugin-system-bootstrap-order.spec.ts`，启动一个最小 fixture 验证 hook fire 之前 PluginLoader.load() 已完成

---

### P1-3: §4 R0.5 时机选在 R0 未收尾时插入，存在依赖冲突

- **问题**：用户背景写「R0 已经做到 R0-A1-d，剩 R0-A2/A3/A5 待办」。R0 没收尾的具体内容包括：
  - R0-A2/A3/A5 涉及 harness 26 文件 playground 字面清理 + 17 SKILL.md 下推
  - **R0 看护 1+2+3** 还没全量启用（base-layer-business-leakage spec / ESLint no-restricted-syntax / PR self-check）

  v5 在 R0 收尾前插入 R0.5（plugin 系统）：
  - PR-1~PR-3 plugin-core 落地：相对独立，不受 R0 影响
  - PR-4~PR-6 关键路径打 hook：harness/engine 这些文件正是 R0-A2 要清理的对象，会出现 R0-A2 的 PR 与 PR-4~6 互相冲突 rebase
  - PR-11 删除旧实现（harness/tracing/otel + harness/guardrails/rate-limit）：这些目录里仍有 R0 阶段的业务字面（旧实现里历史遗留），删除时连带处理 vs R0 单独处理两种走法都不优雅

- **影响**：R0 + R0.5 并行 6+ PR，merge conflict 概率高；R0 看护未启用时 R0.5 PR 可能引入新的业务字面（plugin 命名时不慎写 "agent-playground" 例子），事后才被看护抓出。

- **建议**：
  1. **R0 必须先全部收尾 + 看护启用**，再开 R0.5 PR-1。R0 + 看护就位是 R0.5 的硬前置
  2. 若并行不可避免，PR-4~PR-6 至少要等 R0-A2 完成（手动 rebase 一次 vs 反复 rebase）
  3. §9 时间表把 R0.5 起始时间写成「R0 完成后立即」，不是 W3-W4 固定时间
  4. §11.13 风险登记加一项「R0/R0.5 并行 PR 冲突」P1 级

---

### P1-4: §11.3 IPlugin 接口缺少错误处理与重入边界声明

- **问题**：IPlugin 仅定义 `init / healthCheck / dispose`，没有定义：
  - hook handler 内部能否 throw？throw 后 supervisor 怎么处理（§11.3 HookBus 的 catch 已经覆盖，但 plugin 自己看不到 supervisor 配置）
  - hook handler 是否允许调 `ctx.next()` 多次（典型 retry 场景）？多次会怎样？
  - hook handler 内部能否再 fire 另一个 hook（嵌套 fire）？嵌套深度上限？
  - dispose 是否保证在 init 失败的 plugin 上调用？dispose throw 怎么处理？
  - `init / dispose` 是否幂等？

- **影响**：第三方 plugin 作者无法判断契约边界；§11.10 SDK 发布后 issue 区会被这类问题塞满。

- **建议**：在 §11.3 IPlugin 接口下加「契约规则」block，逐条明确以上 5 点。例：
  - "hook handler 内 throw 等同 supervisor.onPluginError；required=true 时致命，否则跳过"
  - "ctx.next() 严禁多次调用（onion 一次性流程），多次调用抛 HookContractError"
  - "嵌套 fire 允许，HookBus 内置最大嵌套深度 8 层，超出抛 HookOverflowError"
  - "init 必须幂等；dispose 保证在 init 成功后调用，init 失败的 plugin 不调 dispose"

---

### P1-5: §11.3 plugin 之间不直接互调（仅通过 hook payload 通信）的约束举证不足

- **问题**：§11.2 第 5 条强约束"plugin 之间不直接互调，仅通过 hook payload 通信"。但实际场景：
  - **rate-limit + budget-billing 协作**：rate-limit 决定是否限流，budget-billing 决定是否扣额度。两者都监听 LLM_REQUEST，谁先谁后？budget-billing 怎么知道 rate-limit 是否已经决定限流（限流的请求不该扣费）？
  - **circuit-breaker + telemetry 协作**：circuit-breaker open 时 telemetry 是否还要记 metric？
  - **multi-key + pricing 协作**：multi-key 切换 key 后 pricing 算账要按当前 key 的费率

  仅靠 hook payload 通信意味着：
  - payload 字段必须**所有 plugin 协商一致**（rate-limit 在 payload 里塞 `__rateLimitVerdict`，budget-billing 检查这个字段）
  - 字段名是隐式契约，没在 manifest 声明
  - 一旦 plugin 顺序变（priority 变），上面字段读不到

- **影响**：plugin 数量从 4 个扩展到 26 个时（R0.5-E），plugin 间隐式 payload 约定会爆炸（每对相邻 plugin 都有自己的"潜规则字段"）。

- **建议**：
  1. 引入 **HookPayloadAnnotation** 概念：plugin 在 manifest 声明它会在 payload 上写哪些字段（`writes: ["__rateLimitVerdict", "__rateLimitMeta"]`）+ 它会读哪些字段（`reads: ["__rateLimitVerdict"]`）
  2. PluginLoader 启动期校验：plugin A reads X 必须 plugin B writes X 且 priority(B) > priority(A)
  3. 或者干脆放弃"不直接互调"原则，允许 plugin 通过 PluginRegistry.lookup(otherPluginId) 拿到对方实例（受 capability `plugin:read:rate-limit` 控制）—— 这更显式

---

### P1-6: §11.5 PluginCapability 定义过于粗粒度，无法表达租户/敏感度边界

- **问题**：capability 列举：`service:redis / read:llm-payload / write:memory / hook:HOOK_ID / events:publish`。问题：
  - `read:llm-payload` 是全局开关——监听 LLM_REQUEST 的 plugin 全都能读 prompt，prompt 含用户敏感数据（PII）。telemetry plugin 只需要看 token 数和 model name，不需要看 prompt 内容
  - `service:postgres` 给 plugin 整个 PrismaService，plugin 可以查任何表
  - 没有"读 own data only"的 sandboxing

- **影响**：安全审计时无法宣称"plugin 最小特权"。§11.10 SDK 第三方 plugin 装在企业用户工程时会被合规拒绝。

- **建议**：
  1. capability 改成两段式 `<resource>:<scope>:<level>`，例如 `llm-payload:metadata:read`（只能读 token/model 等元数据，不含 prompt 内容）
  2. payload 在 fire 前按 capability 投影：telemetry 只声明 `metadata:read` → HookBus 给它的 payload 自动 redact 掉 prompt 内容
  3. 这是 SDK 发布的硬合规要求；企业版必须有，社区版可放宽

---

## P2（改进，可后修）

### P2-1: §11.1 26 个 plugin 盘点中存在跨域归类争议

- **问题**：`tool-permission-rbac` 在 security 域，`capability-guard-rbac` 也在 security 域——两者都是 RBAC 但作用域不同（一个在 tool 调用、一个在 capability 网关）。`embedding-openai` 在 rag-backend，但 embedding 是通用 LLM 调用，归 llm-augment 也合理。盘点表格在 §11.10 SDK 子包发布时会按域拆包，归类不稳定会导致版本切换时用户工程要改 import path。

- **建议**：在 §11.1 表后加一段「归类原则」：domain = **替换发生时换什么**（替换 RAG backend = rag-backend 域，替换 LLM provider = llm-augment 域），不是按"模块所在层"归类。

### P2-2: §11.12 PR 序列估时偏乐观（1.5-2 周完成 12 PR）

- **问题**：12 PR 含 4 个完整 plugin（每个 plugin 含 manifest + impl + spec + e2e + benchmark），PR-7~PR-10 各 1 天估时偏紧。§11.11 测试策略含"故障注入测 / 性能基线 benchmark"——这两类每个 plugin 至少 0.5 天。

- **建议**：§9 时间表 W3-W4（2 周）→ W3-W4.5（2.5 周）。或者 PR-7~PR-10 每个 1.5-2 天。

### P2-3: §11.6 plugins.config.yaml 用 yaml 不是 ts

- **问题**：项目其他 config 全是 `.ts`（如 `app.config.ts`），yaml 引入新工具链（解析器、schema 校验、IDE 支持差）。

- **建议**：改成 `plugins.config.ts` 导出 `PluginsConfig` 对象，IDE 即时类型检查；环境变量插值用 `process.env.X`。yaml 仅在 SDK 发布场景给非 TS 用户用。

### P2-4: §11.4 hook id 字符串型 vs enum 型选择未论证

- **问题**：`HookId = string`（开放集合）vs `HookId = keyof typeof CORE_HOOKS`（封闭枚举）的取舍没写。开放集合允许 plugin 自定义 hook（生态扩展），但 typo 难抓；封闭枚举 typo 编译期发现，但 plugin 想加新 hook 要改 core。

- **建议**：写明"core hook 用强枚举（enum/const literal），plugin 自定义 hook 用 string 但需在 manifest.exposesHooks 声明 + 启动期注册到 HookRegistry"。

### P2-5: §11.13 架构看护 spec 用 ESLint 路径过滤 + jest 双重，但缺少 plugin 间互不可见看护

- **问题**：§11.13 第 5 项规则只禁止"plugin 不得 import 其他 plugin"——但没禁止 plugin 通过 `getService()` 拿其他 plugin 实例（§11.3 IPluginContext 设计目标声称"plugin 拿不到其他 plugin 实例"，但 spec 没强制）。

- **建议**：plugin-system.spec.ts 增加用例：`getService("plugin:other-plugin-id")` 必须 throw。

---

## 通过项（v3 → v5 改进确认）

- §0.1 新增"横切关注点必须从内核剥离到 plugin"红线，与 base layer 业务无关原则正交并列，治理意图清晰
- §3.1 双根目录 `src/plugin-core/` + `src/plugins/` 概念定位正确（不属于任何 module，是平台内核）—— **但加载方式仍需补完**（见 P1-2）
- §11.3 HookBus onion middleware + zero-cost fast-path 设计正确（无 handler 时直接 terminal）
- §11.8 启动期 fail-fast + 运行时 fail-soft + supervisor 三段式可靠性策略业界标准
- §11.10 SDK 发布形态分层（core / essential / per-domain）合理
- §11.11 测试策略覆盖 7 个层级齐全
- §11.13 架构看护 ESLint + jest 双重拦截路径正确

---

## 总评

**v5 不可以直接进 R0.5 PR-1 实施。** 必须先修以下 4 项 P0：

| P0   | 摘要                                                                               | 修复成本                         |
| ---- | ---------------------------------------------------------------------------------- | -------------------------------- |
| P0-1 | ToolPipeline plugin 化的 phase/priority 强语义 + abort 后 observability 必跑       | 0.5 天文档 + 0.5 天 HookBus 实现 |
| P0-2 | IPluginContext.getService 与 NestJS DI 边界 + ServiceToken/PlatformServiceRegistry | 1 天文档 + 0.5 天 spec           |
| P0-3 | forFeature pluginOverrides 与 yaml 配置二选一（建议删 forFeature）                 | 0.5 天文档                       |
| P0-4 | stage hook vs plugin hook 术语区分 + 全文 grep replace                             | 0.5 天文档                       |

修完 P0 后再修 P1-1（CORE_HOOKS 加 TOOL_EXECUTE）和 P1-3（R0.5 起点改成 R0 完成后），即可进 PR-1。其余 P1（4-6）可在 R0.5 PR-1~PR-3 实施期边做边补到 v5.1。

**核心担忧**：v5 在不破坏 v3 既有结论前提下塞进了一整套 plugin 系统，章节量从 v3 的 §1-§10 扩展到 §11，但 §3.2 业务 hook 与 §11 plugin hook 是**两个不同物种**，文档没有显式标记，会让实施期开发者错把业务 hook 也当 plugin 写。在 R0.5 PR-1 提交前必须把 P0-4 术语区分写清楚，否则 R1（R0.5 之后）的 stage primitive 实现会被 plugin 化思维污染。

**额外建议**：v5 体量已超 2350 行，建议把 §11 拆出独立文档 `plugin-system-design.md`，主方案 v5 仅保留 §11 摘要 + 链接。便于 plugin 系统单独迭代到 v2/v3 而不污染主方案。
