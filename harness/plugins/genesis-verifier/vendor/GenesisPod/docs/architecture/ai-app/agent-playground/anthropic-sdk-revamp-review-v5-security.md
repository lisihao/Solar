# v5 评审 - security-auditor

**审计对象**: `anthropic-sdk-revamp-plan-v5.md` §11.5 / §11.9 / §11.10 / §11.13
**审计时间**: 2026-05-04
**审计员**: security-auditor agent

---

## CRITICAL（必须修，否则不能进 R0.5）

### CRIT-1: payload 在 hook 链中是 mutable object，write:llm-payload 无实质拦截

**位置**: §11.3 `IHookContext<P>` / §11.5 `write:llm-payload` / §11.7 LLM 调用改造

`HookBus.fire` 把 `payload` 直接传入 `IHookContext`，接口定义中 `payload` 字段无 `readonly` / `Readonly<P>` 修饰，也无 `Object.freeze` 调用。这意味着：

1. **任何 plugin 不需要声明 `write:llm-payload`** 就能直接 mutate `ctx.payload.request` 的字段——capability gate 只 guard `getService()`，不 guard payload 写入。
2. 拥有 `read:llm-payload` 的 telemetry plugin 与拥有 `write:llm-payload` 的 guardrail plugin 看到的是同一个对象引用。恶意/被入侵 plugin 在第一个 handler 里改了 `ctx.payload.request.messages`，后续所有 plugin 及 terminal 都看到被篡改的版本。

**风险**: prompt injection 路径完全打通——任何 hook 链里的 plugin 都可以在 `engine.llm.request` 注入额外系统提示，而 capability gate 无法阻止（gate 只检查 `getService`，不检查 payload mutation）。

**必须修**:

- `IHookContext<P>` 中 `payload` 字段类型改为 `Readonly<P>`（深度 readonly），fire 时 `Object.freeze(payload)` 或使用 `structuredClone`。
- 需要合法修改 payload 的 plugin（如 guardrail-input sanitizer）必须通过 `ctx.replacePayload(newPayload)` 接口，该接口在内核侧检查调用者是否持有 `write:llm-payload` capability，然后生成新的 frozen copy 传给后续 handler。
- 这不是实现细节，是 `write:llm-payload` capability 存在的前提——当前设计里这个 capability 是空声明。

---

### CRIT-2: OSS 版本无签名校验，src/plugins/ 目录是零摩擦后门

**位置**: §11.9 第 3 点 / §11.13 风险登记"第三方 plugin 注入恶意逻辑 P1"

方案明确：签名校验"接口 v1 预留，企业版启用"。这意味着 OSS 版本下：

- 任何能写 `src/plugins/` 目录的人（供应链攻击、恶意 PR、被入侵的 CI）都可以放置一个 plugin，声明 `read:llm-payload` + `service:redis` + `service:http`，合法地读全部 LLM payload 并 exfiltrate 到外部。
- 没有 npm package 级别的完整性校验（第三方 plugin 通过 npm 安装时，loader 扫描逻辑不区分内置 vs 第三方 plugin 的信任级别——§11 未定义该区分）。

风险等级被标为 P1 是错误的：一旦 SDK 发布，这个攻击面对所有下游用户开放，实质是 P0。

**必须修**:

- R0.5 上线前至少做到：**文件系统来源白名单**——PluginLoader 区分两类来源：`src/plugins/`（内置，受代码审查信任）vs `node_modules/@genesis/plugins-*/`（外部，需额外校验）。外部 plugin 在 OSS 版本中默认要求 manifest.signature 非空，公钥锁定在 `plugin-core/security/trusted-keys.json`，无签名拒绝加载。
- 将风险等级从 P1 升为 P0，进 R0.5 前明确处置方案（不要求 v1 实现，但要求明确 OSS 的信任边界文档）。

---

## HIGH

### HIGH-1: telemetry plugin 可合法记录完整 LLM payload 到日志，绕过敏感数据规则

**位置**: §11.3 `IPluginContext.logger` / §11.5 `read:llm-payload`

项目 CLAUDE.md 明确"禁止 console.log（用 Logger）"、不得在日志打印敏感信息。但 plugin 的 isolated logger 只是加了前缀，没有任何内容过滤。一个声明了 `read:llm-payload` 的 telemetry plugin（性能调试场景）可以：

```typescript
async handle(ctx: IHookContext<LlmRequestPayload>) {
  this.logger.debug("LLM request", ctx.payload.request); // 含 user PII / system prompt
  return ctx.next();
}
```

这在开发环境完全合法（logger 前缀无法过滤内容），但生产日志里完整 LLM payload 包含用户 PII 和 API key（如果 multi-key plugin 将 key 附加到 request header 的话）。

**修复方向**: IPluginContext.logger 需要一个"敏感字段遮蔽"层（PII scrubber），对已知敏感字段（`messages[].content` 超 N 字符时截断、`headers.authorization` 完整遮蔽）自动处理。或者 `read:llm-payload` capability 强制拆分为 `read:llm-payload:meta`（missionId/agentId/model）和 `read:llm-payload:full`，后者需要额外审核，生产 profile 默认禁用。

---

### HIGH-2: events:subscribe capability 无法阻止跨 namespace sniffing

**位置**: §11.3 `IPluginEventBus` / §11.5 `events:subscribe` / §11.9 第 4 点

方案说"events 自动加 namespace""受限事件总线（仅自己 namespace）"，但接口定义 `IPluginEventBus` 未在文档中给出具体实现契约：仅靠"namespace 前缀"的实现，如果底层是同一个 EventEmitter 实例，plugin 通过直接操作底层 bus 或利用 EventEmitter 的 `eventNames()` / `rawListeners()` API 仍可枚举所有已注册事件。

更具体的问题：`events:subscribe` capability 粒度是"能订阅"，没有细分到"仅订阅自己 namespace"——一个持有 `events:subscribe` 的 plugin 能否 subscribe `*` 或 `plugin-b.*`？文档没有明确禁止。

**修复方向**: `IPluginEventBus.subscribe(topic, handler)` 在内核侧强制前缀 `${pluginId}:${topic}`，subscribe 时过滤非本 namespace topic，`events:subscribe` capability 含义改为"能发布/订阅自己 namespace 的事件"；跨 namespace 订阅须声明单独 capability `events:cross-subscribe:{targetPluginId}`，默认不允许。

---

### HIGH-3: cache plugin abort 短路后 TaskProfile 映射丢失，质量与审计失控

**位置**: §11.7 LLM 调用改造 / §11.3 HookBus `abort()` / 项目 CLAUDE.md TaskProfile 规范

`tool-cache-redis` plugin 命中后调用 `ctx.abort()`，HookBus 抛出 `HookAbortError`，`terminal`（即 `AiChatService` 真实 LLM 调用）被跳过。问题：

1. `AiChatService.chat()` 的 `TaskProfile → temperature/maxTokens` 映射在 terminal 中执行，cache 命中时整段逻辑被绕过——返回的 cached response 是用**当时的 TaskProfile** 生成的，但消费方（当前调用）可能有不同的 `creativity` / `outputLength` 需求，两者不一定兼容。
2. 计费 / token usage 归因 plugin 也监听 `LLM_RESPONSE`，cache 命中时 abort 是否也跳过了 billing 记录？方案没有说明 abort 时 response hook 是否仍 fire。
3. 审计日志里这笔调用是"cache hit"还是"LLM call"，对下游的 quality evaluation 和 token budget 计算有本质区别，但 v5 未定义 abort 后的生命周期事件。

**修复方向**: 定义 abort 后的 `LLM_CACHE_HIT` 事件（或在 HookAbortError 里携带 `reason: "cache-hit"` + cached payload），让 billing / audit plugin 能在 abort 路径里仍记录一条"cache hit"记录。TaskProfile cache key 必须包含 `creativity` + `outputLength` 维度。

---

## MEDIUM

### MED-1: getService 拿到 redis client 后无 key namespace 隔离

声明 `service:redis` 拿到原始 RedisClient，可执行 `KEYS *`、`SCAN`、`DEL gen:*`。`keyPrefix` 是 plugin 自己业务逻辑，不是内核强制隔离。

**修复方向**: `getService("redis")` 返回 `NamespacedRedisClient`，强制所有命令 key 加 `plugin:${pluginId}:` 前缀，屏蔽 KEYS/SCAN/FLUSHDB。

---

### MED-2: coreVersionRange 校验失败处置方式未定义

启动期 `checkCoreCompat` 失败的处置路径未说明（fail-fast vs skip）。SDK 升级后下游用户可能因 core 升级导致旧 plugin 静默 skip，无任何警告。

**修复方向**: coreVersionRange 不兼容一律 fail-fast 并给出明确错误信息 `PluginIncompatibleCoreError`，无论 `required` 值。

---

### MED-3: PluginLoader 动态加载路径未做路径穿越防护

`scan("src/plugins/")` 扫描目录并动态 import。未说明：

1. 是否限制扫描范围严格在 `src/plugins/` 树内
2. manifest `id` 字段是否被用于构造文件路径（路径穿越风险）
3. 外部 plugin npm 包的 `main` 入口是否校验

**修复方向**: PluginLoader `path.resolve` + `path.relative` 校验目标在允许根内；manifest id 与文件系统路径解耦。

---

### MED-4: stability="experimental" hook 破坏无用户通知机制

experimental hook 被 deprecated 或 major bumped 时，已注册了该 hook 的 plugin 如何收到通知？`payloadVersions` 不匹配时 HookBus 跳过是静默还是有 warning？

**修复方向**: HookBus version 不匹配必须 emit `WARN` 日志；experimental hook 进入 deprecation 时 fire 端 emit `DEPRECATED_HOOK_FIRED` 事件。

---

## LOW

### LOW-1: supervisor 熔断不可逆副作用无对策

熔断前已完成的外部副作用（HTTP POST / redis write）不可逆。建议在风险登记里明确"首次副作用不可逆"，required=false plugin 安全边界依赖审计而非熔断。

### LOW-2: ai-app 层 pluginOverrides 允许禁用安全 plugin

`ResearchModule` 示例展示 `"security/sandbox-isolated-vm": { enabled: false }`——意味着每个 ai-app 可自主禁用安全 plugin。建议将 `security/*` 类 plugin 标记为 `overridable: false`。

---

## 必须补充的安全机制

1. **payload immutability 机制**：`IHookContext.payload: Readonly<P>` + `ctx.replacePayload(newPayload)` capability gate
2. **NamespacedRedisClient 封装**：getService("redis") 返回受限 client
3. **外部 plugin 信任分级**：PluginLoader 区分内置 vs 外部，外部强制签名校验
4. **abort 生命周期事件**：必须 fire `LLM_CACHE_HIT` / `TOOL_CACHE_HIT` 事件
5. **PII scrubber 层**：`read:llm-payload:full/meta` 拆分 或 logger 内置遮蔽
6. **coreVersionRange 不兼容一律 fail-fast**

---

## 总评

**安全姿势是否达到 SDK 发布要求**: 否

三层 capability gate 框架方向正确，但存在一个根本性设计漏洞（CRIT-1: payload mutable 使 `write:llm-payload` capability 形同虚设）和一个发布前信任边界缺口（CRIT-2: OSS 版本无外部 plugin 签名校验）。这两点在 SDK 面向第三方发布时将直接开放 prompt injection 和供应链攻击面。

**进 R0.5 前必须先做的**:

1. 修复 CRIT-1：`IHookContext.payload` 强制 `Readonly<P>` + `ctx.replacePayload()` capability-gated 接口
2. 明确 CRIT-2 的 OSS 信任边界：明确"外部 plugin 未经签名校验"的安全含义，提供 `PLUGIN_TRUST_MODE=strict` 环境变量强制要求签名
3. 补充 HIGH-3 abort 生命周期事件定义（影响计费和质量审计正确性）

HIGH-1（PII 日志泄露）和 HIGH-2（events sniffing）可在 R0.5 阶段完成，但需在 PR-1（接口定义 PR）中预留接口点，不能等到 R0.5-E。
