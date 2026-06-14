# v5 评审 - reviewer (实操可执行性)

评审日期：2026-05-04
评审人：Reviewer Agent
评审依据：实际读取以下文件后作出判断（非猜测）：

- backend/src/modules/ai-engine/tools/middleware/tool-pipeline.ts
- backend/src/modules/ai-engine/tools/middleware/ 全部 4 个 middleware
- backend/src/modules/ai-engine/tools/cache/tool-result-cache.service.ts
- backend/src/modules/ai-harness/tracing/tracer/otel-tracer.ts
- backend/src/modules/ai-harness/tracing/observability/observability.module.ts
- backend/src/modules/ai-harness/guardrails/resources/rate-limiter.ts
- v5 §11.3 / §11.4 / §11.6 / §11.7 / §11.11 / §11.12

---

## P0 实操致命问题

### P0-1: TimeoutMiddleware 不是 before/after 模式，plugin 化后超时保护静默失效

- 问题：§11.7 把 5 个 middleware 等同处理，但实际 `TimeoutMiddleware` 的核心逻辑在 `wrapExecution()` 方法，不是 `before/after`。`before()` 只设了 `context.timeout`，真正的 Promise.race 要由调用方显式调用 `wrapExecution()`——而现有 `ToolPipeline.execute()` 根本没调这个方法，`tool.execute()` 完全不在 race 里。
- 真实风险：把 timeout 直接改成 TOOL_BEFORE/AFTER plugin 后，`TOOL_BEFORE` 里能设 `context.timeout`，但 `terminal`（即 `registry.invoke(call)`）的 Promise 没有包在 race 里，超时保护静默失效。这不是重构问题，是语义破坏问题。PR-10（sandbox-isolated-vm）有相同问题：sandbox 也需要包裹 terminal 的执行容器，而不是 before/after 钩子。
- 建议修订：在 §11.4 的 hook 集里增加 `TOOL_WRAP: "engine.tool.wrap"` hook，其 terminal 是可被 plugin 替换的执行容器；或者文档明确 timeout/sandbox 两个 plugin 走独立的 AbortSignal 注入机制，不走 TOOL_BEFORE/AFTER。§11.7 的"after 改造"伪代码需要重写。

### P0-2: AiHarnessModule.forFeature 在 §1 已锁定"不做"，但 §11.6 依赖它

- 问题：§1（决策锁定列表）第 6 条明确写"不做 NestJS forFeature dynamic module（spike 即使通过也不做）"。但 §11.6 ai-app 选用方式的整个设计基础是 `AiHarnessModule.forFeature({ pluginOverrides })`。这是文档内部自相矛盾，不是评审意见分歧。
- 真实风险：PR-9（rate-limit plugin）验收条件写了"plugin override"，但 forFeature 被禁，per-module 配置（如 research 用 100 rpm）无法表达，只能退化回全局 yaml，失去 §11.6 最有价值的部分。
- 建议修订：二选一——删除 §11.6 的 forFeature 示例并改为"通过 plugins.config.yaml 的 perApp 节点实现"，或者解除 §1 的 forFeature 禁令并说明为什么 v5 重新允许。必须在 PR-1 动手前决策。

### P0-3: PluginLoader 实现必须持有 ModuleRef，PR-3 工作量严重低估

- 问题：§11.3 的 IPluginContext 给 plugin 提供 `ctx.hooks: IHookRegistrar` 和 `ctx.getService()`。但 plugin 是通过 `PluginLoader` 实例化的 POJO，不在 NestJS DI 容器里，拿不到 @Inject()。`PluginLoader.getService()` 的实现必须由 PluginLoader 内部用 `ModuleRef.get()` 代理——这和 §11.3 说的"不暴露 ModuleRef"正好矛盾：PluginLoader 本身就是 ModuleRef 代理，只是 plugin 看不见。
- 真实风险：这个设计可以做通，但会遭遇 NestJS 循环依赖（PluginLoader 需要 HookBus，HookBus 注册到 plugin-core module，plugin-core module 可能被 harness/engine module 依赖），必须用 forwardRef 解决。另外 PluginLoader.load() 在 onModuleInit 触发，但此时被 plugin 依赖的 CacheService 等 provider 不一定已经初始化，顺序不可预期。
- 建议修订：PR-3 工作量从 2 天改为 5 天，并在 PR-3 描述里写明：PluginLoader 持有 ModuleRef + 使用 `moduleRef.get(token, { strict: false })` + forwardRef 循环依赖规避方案 + PluginLoader 在 onApplicationBootstrap 而非 onModuleInit 执行 load()（保证所有 provider 已就绪）。

---

## P1 实操不清问题

### P1-1: 双轨期 ToolPipeline.execute() 的具体写法缺失

§11.12 Stage 1 说"旧 middleware 同时运行"，但具体 dispatch 逻辑留白。以下是两种可实现方案，文档应选一：

方案 A（串行，hook 为 fast-path）：

```
// PR-4 ToolPipeline.execute()
async execute(call): Promise<Result> {
  // 旧路径：现有 middleware 链不动
  for (const mw of this.middlewares) {
    if (mw.before) await mw.before(...)
  }
  // 新路径：hook（Stage 2 前无 handler，fast-path 零开销）
  return this.hooks.fire(CORE_HOOKS.TOOL_BEFORE, { __version: 1, call }, async () => {
    const result = await this.registry.invoke(call)
    return this.hooks.fire(CORE_HOOKS.TOOL_AFTER, { __version: 1, call, result }, () => result)
  })
}
```

方案 B（feature flag，PLUGIN_HOOKS_ENABLED=1 切换）：灰度可控，但多一个环境变量。

Stage 1 期间 hook 链为空，方案 A 额外开销约 1 个 async function 调用，可接受。建议选 A 并写进 PR-4 描述。

### P1-2: ObservabilityModule 是 @Global() 且有 11 个 provider，PR-11 删它会炸 5+ 处调用方

读代码可见 ObservabilityModule 被 app.module.ts / ai-engine.module.ts / harness.module.ts / topic-insights / common/observability 等至少 5 处直接 import，且 `teams-mission-orchestrator.ts` 直接注入 `TraceCollectorService`。PR-11 要删 `harness/tracing/otel`，这不是"删文件"的工作量，是"把主动消费者改为被动（去掉直接注入，改成 hook 被动接收）"的工作量。

PR-11 应该拆成 3 PR：

1. telemetry-otel plugin 完整实现（Stage 2 的 PR-7 已做，但需覆盖全部 11 个 provider 功能）
2. 把主动消费者的直接注入改为 hook 被动接收，验证行为等价
3. 删 ObservabilityModule 及相关文件

### P1-3: RateLimiter 有内存状态，plugin 化后跨 Pod 限流会退化

现有 `RateLimiter` 滑动窗口数据存在内存 Map，Redis 同步是 fire-and-forget 辅助。单 Pod 测试通过，多 Pod 生产场景内存 rate-limit 不跨 Pod。v5 §11.6 的 yaml 写了 `defaultRpm: 60`，但没说 plugin 内部是纯 Redis 还是内存+Redis。生产部署多 Pod，纯内存无法跨 Pod 限流，这是一个行为可能退化的隐性风险，应在 PR-9 前明确决策（建议：plugin 化后默认纯 Redis，内存模式留作 test profile）。

### P1-4: v3 业务级 hook 与 v5 plugin 级 hook 命名未区分，§11.13 的衔接说明混淆两者

§11.13 写"onAgentStepBefore/After hook 已在 R0.5 落地，R1 直接用"，但没说这两个 hook 属于哪个系统——是 `HookBus.fire("harness.agent.step.before", ...)` 还是 v3 pipeline 的 stage callback binding？如果是 HookBus，则 plugin 能监听 `AGENT_STEP_BEFORE`，意味着 plugin 收到业务语义事件（stage 名、agent 角色），和 §11.5 的 capability 设计产生摩擦（哪个 capability 声明才能监听 agent step？）。

建议在 §11.4 的 hook 命名表里加两列："触发层（infrastructure / orchestration）"和"是否对外部 plugin 开放"，明确区分基础设施 hook（TOOL_BEFORE 等）和编排 hook（AGENT_STEP_BEFORE 等）的访问权限差异。

### P1-5: ValidationMiddleware 的 env 逃生阀在 plugin 化后归谁管

现有 ValidationMiddleware 通过 `STRICT_OUTPUT_VALIDATION_MODE` env 控制 strict/lenient/coerce 三档。plugin 化（tool-validation-zod plugin）后，这个 env 变量还有意义吗？还是改由 `plugins.config.yaml` 的 `config.mode` 控制？生产有依赖 `STRICT_OUTPUT_VALIDATION=0` 逃生阀的代码注释，迁移期不能静默丢失这个能力。文档应在 PR-4 前明确映射关系。

---

## P2 改进建议

### P2-1: PluginSupervisor 里裸 setTimeout 在 NestJS 优雅关闭时不安全

`setTimeout(() => this.tryHalfOpen(pluginId), this.cooldown)` 在应用 teardown 后可能触发，导致访问已销毁的 HookBus。应改为在 `onModuleDestroy` 里 clearTimeout，或改用 `@Interval()` 结合 `onModuleDestroy` 取消。

### P2-2: plugins.config.yaml 的 `${profile == 'development'}` 不是合法 YAML

§11.6 里的 `hookTraceEnabled: ${profile == 'development'}` 是伪代码，不是任何实际 YAML 解析库支持的语法。PluginConfigService 实现者不知道该用哪种插值（YAML anchor / js-yaml custom type / dotenv 变量替换）。应在文档里明确 PluginConfigService 的 interpolation 规范，或者把这一行改成纯 env 变量替换语法 `${HOOK_TRACE_ENABLED:-false}`。

---

## 工作量重估

| 阶段                               | v5 估            | 真实估              | 偏差原因                                                                                                                                           |
| ---------------------------------- | ---------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-1 接口 + manifest schema        | 1 天             | 1.5 天              | ZodSchema 在 manifest 运行时不可 JSON.stringify，序列化方案需设计                                                                                  |
| PR-2 HookBus onion 实现            | 1.5 天           | 2 天                | abort/supervisor/trace/version 四个正交特性同一个类，测试矩阵大                                                                                    |
| PR-3 PluginLoader + ModuleRef 代理 | 2 天             | 5 天                | 最严重低估：NestJS 生命周期顺序 / ModuleRef.get strict:false / forwardRef 循环依赖 / onApplicationBootstrap 时机 / PluginSupervisor @Interval 注册 |
| PR-4 ToolPipeline hook 注入        | 1 天             | 2 天                | P0-1 TimeoutMiddleware 路径需额外设计 TOOL_WRAP 或 AbortSignal 方案                                                                                |
| PR-5 LLM hook 注入                 | 1 天             | 1 天                | LLM 调用路径干净，估算合理                                                                                                                         |
| PR-6 harness/lifecycle + memory    | 1 天             | 2 天                | mission-lifecycle 多处调用方，需逐一确认不破坏 checkpoint/postmortem                                                                               |
| PR-7~PR-10 首批 4 个 plugin        | 4 天             | 8 天                | 每个 plugin 需处理 NestJS DI 接入 + 迁移现有业务逻辑 + spec + P0-1 特殊路径；ObservabilityModule 消费者解耦在 PR-7 就要开始                        |
| PR-11 删旧代码                     | 1 天             | 3 天                | ObservabilityModule @Global() 有 5+ 处消费者需逐一解耦，应拆 3 PR                                                                                  |
| PR-12 import 修复 + 看护 spec      | 1 天             | 1.5 天              | 合理                                                                                                                                               |
| 合计                               | 12 PR / 1.5-2 周 | 12-15 PR / 3.5-4 周 | PR-11 实际要拆 3 个                                                                                                                                |

---

## 总评

- **方案能进 R0.5 PR-1 实施：否**

- **真正实施前必须先解决（优先级排序）：**
  1. P0-2（文档内自相矛盾）：`AiHarnessModule.forFeature` 禁令与 §11.6 设计矛盾，决策成本极低（改文档），但不做则 PR-3 实现者方向不明。必须在 PR-1 动手前决策。

  2. P0-1（TimeoutMiddleware 路径）：在 PR-4 动手前确认 TOOL_WRAP hook 或 AbortSignal 方案，否则 timeout plugin 上线后生产超时保护静默失效，比没有 plugin 更危险。

  3. P0-3（PluginLoader/ModuleRef 设计）：在 PR-3 的 spec 里先写 PluginLoaderService 的构造函数签名和 onApplicationBootstrap 骨架，确认 NestJS DI 集成方向再动工，避免做完才发现循环依赖或 provider token 冲突。

  4. 工作量重估：R0.5 应该按 3.5-4 周排期而非 1.5-2 周。否则 Stage 3（删旧代码）会被压缩，双轨期拖入 R1，增加 R1 维护负担。
