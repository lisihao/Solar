# Plugin 系统治理规范（v5.1 R0.5 PR-0 交付 / 2026-05-04 反应式规则修正）

**版本：** 2.0
**强制级别：** MUST
**生效日期：** 2026-05-04（v1.0）/ 2026-05-04（v2.0 反应式规则修正）
**维护者：** Claude Code
**关联：** [16-ai-engine-harness-structure.md](16-ai-engine-harness-structure.md) / [17-extension-governance.md](17-extension-governance.md) / [18-base-layer-file-governance.md](18-base-layer-file-governance.md)
**关联方案：** [docs/architecture/ai-app/agent-playground/anthropic-sdk-revamp-plan-v5.1.md](../../docs/architecture/ai-app/agent-playground/anthropic-sdk-revamp-plan-v5.1.md) §11

---

## 〇、Plugin 抽取规则（v2.0 修正后顶层强约束）

> **历史教训**：v1.0 规范受"26 plugin 批量迁出"清单驱动，导致 W1-a / W1-b 把 timeout / validation / circuit-breaker / rate-limit 等核心 service 误抽成 plugin，全部回滚。v2.0 用规则替代清单。

### 〇.1 充要条件（必须**全部满足**才抽 plugin）

| #   | 条件                                    | 不满足 = 不抽                                       |
| --- | --------------------------------------- | --------------------------------------------------- |
| 1   | **代码库内已存在 ≥ 2 种 backend 实现**  | 单 backend 抽接口 = YAGNI                           |
| 2   | **替换是部署期决策（非 runtime 路由）** | TaskProfile 路由不同模型属 service 内部             |
| 3   | **实现差异是结构性的（非参数化）**      | redis 集群 vs 单机是参数；vm2 vs isolated-vm 是结构 |

### 〇.2 禁止条件（满足任一 = 不抽）

| #   | 禁止情况                              | 反例                                                                      |
| --- | ------------------------------------- | ------------------------------------------------------------------------- |
| 1   | 一个标准算法 / 状态机有公认实现       | token-bucket / circuit-breaker / semaphore / setTimeout race / zod schema |
| 2   | "跨 ai-app 共用 → plugin 候选" 已作废 | rate-limit / pii / pricing / capability-guard 凡平台 service 都跨 app 用  |
| 3   | 协议 transport 层差异                 | SSE vs WebSocket / gRPC vs HTTP — 归 middleware/transport 不归 plugin     |

### 〇.3 反应式抽取流程

1. **触发**：实际场景出现"我要用 X 替换 Y"（如客户要 Qdrant 替 pgvector / 接 Llama Guard 替 detector）
2. **ADR**：写 ≤ 1 页 ADR 记录驱动需求 + 接口设计 + 第二 backend 工作量
3. **同 PR 落地**：抽 IXxxBackend 端口 + 现有实现包成第一 backend + 新 backend 实现 + spec
4. **❌ 禁止**："先抽接口、二期补 backend"（这是预抽伪装成反应式）

### 〇.4 当前 plugin 名册（2026-05-04 锁定）

**真 plugin（已落地，3 个）**：

- `observability/telemetry-otel`（OTel / Datadog / Sentry / disable）
- `storage/tool-cache-redis`（Redis / Memcached / in-memory）
- `security/sandbox-isolated-vm`（vm2 / isolated-vm / worker / disable）

**未来候选（不预抽）**：见 [revamp-plan-v5.1.md §11.1](../../docs/architecture/ai-app/agent-playground/anthropic-sdk-revamp-plan-v5.1.md) "未来候选" 表

### 〇.5 历史误分类（已回归核心）

下列能力曾被 v1.0 §11.1 列为 plugin，2026-05-04 修正后确认归核心：

`tool-timeout` / `tool-validation-zod` → `engine/tools/middleware/`
`rate-limit` / `circuit-breaker` / `concurrency-control` → `engine/safety/resilience/` `engine/tools/concurrency/`
`tool-permission-rbac` / `capability-guard-rbac` / `guardrail-injection` → `engine/safety/{security, guardrails}/`
`telemetry-latency` / `telemetry-llm-events` / `telemetry-attribution` → `harness/tracing/`
`llm-multi-key` / `llm-pricing` / `llm-prompt-adapter` / `llm-output-sanitizer` → `engine/llm/`
`tool-progress-sse/websocket` → `engine/tools/middleware/`
`budget-billing` → `harness/guardrails/billing/`

**任何回退此清单的 PR 提案必须先修订 §〇.1-〇.3 规则**。规则不动 = 决策不变。

---

## 一、目的

本规范把 v5.1 §11 Plugin 系统的关键设计决策固化为项目级强约束，覆盖：

- 〇 Plugin **抽取规则**（v2.0 反应式规则）
- `src/plugins/core/` 内核与 `src/plugins/` 实现的目录边界
- plugin 与 5 层架构（platform（L1）/ ai-engine / ai-harness / ai-app / open-api）的依赖方向
- ~~26 个横切关注点必须以 plugin 形态存在的强制要求~~ → v2.0 改为反应式抽取，参见 §〇
- IPlugin / HookBus / IPluginContext 接口的稳定契约面（SDK 发布预留）
- 安全姿势（CRIT-1 payload immutability + CRIT-2 plugin trust mode）
- 看护机制（layer-boundaries.spec / ESLint / pre-push）扩展规则

本规范在 R0.5 PR-0 阶段交付（v1.0），2026-05-04 修正为 v2.0。所有 plugin 相关 PR 必须遵守 §〇 抽取规则。

---

## 二、目录边界（强约束）

### 规则 1：plugin 系统位于单一 `src/plugins/` 根目录

```
backend/src/plugins/                    ← 单一 plugin 系统根（v1.1 修订：合并 plugins/core + plugins）
  ├── core/                             ★ 平台 plugin 内核（与各域实现并列）
  │   ├── abstractions/                 IPlugin / IPluginManifest / hooks 等接口
  │   ├── hook-bus/                     HookBus + HookTrace
  │   ├── registry/                     PluginRegistry + 拓扑解析
  │   ├── loader/                       PluginLoader + manifest 校验
  │   ├── lifecycle/                    PluginSupervisor + 健康检查
  │   ├── security/                     ServiceProxyRegistry + capability gate + 签名校验预留
  │   └── plugin-core.module.ts
  │
  ├── observability/                    实现域（5 plugin）
  │   ├── telemetry-otel/
  │   ├── telemetry-eval/
  │   └── ...
  ├── resilience/                       实现域（4 plugin）
  ├── security/                         实现域（5 plugin）
  ├── storage/                          实现域（5 plugin）
  ├── rag-backend/                      实现域（2 plugin）
  ├── llm-augment/                      实现域（4 plugin）
  ├── tool-augment/                     实现域（4 plugin）
  │
  └── plugins.config.yaml               项目级 plugin 启用清单
```

**理由**（v5.1.1 修订）：

- plugins/core 与 plugins 实现属于同一个 plugin 系统的不同部分（机制 vs 策略），合并到一个根目录概念耦合更紧凑
- 单一根目录简化看护规则（一条边界 src/plugins/ ↔ src/modules/）
- 业界参考：VSCode / Vite / Webpack 都是 core 与 plugins 同一根目录
- SDK 发布对应性：`plugins/core/` → `@genesis/plugin-core` npm 包；`plugins/<domain>/` → `@genesis/plugins-<domain>` npm 包

**`core/` 命名约定**：在 `src/plugins/` 下与各实现域并列，但**不是实现域**——它是承载 IPlugin / HookBus / Registry 等接口与机制的特殊子目录。新增 plugin 不得放 `core/`；`core/` 只允许有"plugin 系统基础设施"代码。

每个 plugin 形态：

```
src/plugins/<domain>/<plugin-id>/
  ├── plugin.ts                  IPlugin 实现
  ├── manifest.ts                IPluginManifest 静态对象
  ├── config.schema.ts           zod
  ├── README.md
  └── __tests__/
```

**7 大实现域命名锁定**（observability / resilience / security / storage / rag-backend / llm-augment / tool-augment），新增 plugin 必须归入现有域；新增域需修改本规范并经评审。

### 规则 3：plugin 严禁放 `src/modules/ai-app/`

**理由**（v5.1 评审 P0-3 锁定）：

1. **依赖方向**：ai-app 依赖 harness/engine；plugin 在 ai-app/ 下会形成 harness/engine → ai-app 反向依赖
2. **横切关注点不属于业务**：telemetry / sandbox / rate-limit / vector-backend 不是任何 ai-app 的业务能力
3. **plugin 服务多个 ai-app 共享**：归属任一 ai-app 都会导致归属混乱
4. **ai-app 必须能"无 plugin 也能跑"**：plugin 是平台能力的可选增强，ai-app 不该 import plugin 实现细节

**唯一例外**：单个 ai-app 私有横切（极少见）放 `ai-app/<app>/private-plugins/`——目前 26 个 plugin 全部不属于这种情况。

---

## 三、依赖方向（强约束）

### 规则 4：5 层 + plugin 系统的合法依赖图

```
ai-app  →  ai-harness  →  ai-engine  →  platform（L1）
   ↓             ↓             ↓
   └──── 通过 plugins/core HookBus（不直接 import plugin） ────┘
                              ↑
                     plugins/core （无 module 依赖）
                              ↑
                     plugins/* （仅依赖 plugins/core）
```

| 依赖关系                                | 是否允许  | 备注                                       |
| --------------------------------------- | --------- | ------------------------------------------ |
| `ai-app` → `ai-harness/facade`          | ✅        | 现有规则                                   |
| `ai-app` → `ai-engine/facade`           | ✅        | 现有规则                                   |
| `ai-harness` → `ai-engine/facade`       | ✅        | 现有规则                                   |
| `ai-harness` → `plugins/core`           | ✅        | fire hook 用                               |
| `ai-engine` → `plugins/core`            | ✅        | fire hook 用                               |
| `ai-app` → `plugins/core`               | ⚠️ 仅类型 | 仅 hook payload 类型；不应直接调用 HookBus |
| `plugins/*` → `plugins/core`            | ✅        | plugin 实现接口                            |
| `plugins/core` → 任何 module            | ❌        | plugins/core 不依赖业务                    |
| `harness/engine/app` → `plugins/*` 实现 | ❌        | 必须通过 HookBus                           |
| `plugins/<a>` → `plugins/<b>` 实现      | ❌        | plugin 间仅通过 hook payload 通信          |
| 任何层 → `ai-app`                       | ❌        | 现有规则（基础原则）                       |

### 规则 5：hook payload 类型必须定义在 `src/plugins/core/abstractions/hook-payloads/`

**理由**（v5.1 评审 C3 锁定）：plugin 实现 `HookHandler<P>` 必须 import `P`；P 不能在 ai-engine 或 ai-harness（破坏分层），也不能在 plugins/（互相耦合）。唯一安全位置是 plugins/core。

定义形态：**泛化版**（不依赖业务类型）

```typescript
// src/plugins/core/abstractions/hook-payloads/llm.ts
export interface LlmRequestPayload {
  readonly __version: number;
  readonly request: unknown; // ai-engine/llm 的 ChatRequest 不透明引用
  readonly meta: {
    readonly missionId?: string;
    readonly agentId?: string;
    readonly model?: string;
    readonly tenantId?: string;
    readonly agentType?: string; // 业务无关的 agent 标签（非 ai-app 名）
  };
}
```

**类型流向**：harness/engine 在 fire 调用点把业务类型 cast 成 payload；plugin 侧从 `payload.request` cast 回业务类型；plugins/core 不依赖任何 module。

---

## 四、26 个横切关注点必须 plugin 化（强约束）

### 规则 6：以下 26 个能力必须以 plugin 形态存在，不得在 harness/engine 内核承载

**已盘点全集（详见 v5.1 §11.1）**：

- observability：telemetry-otel / eval / latency / llm-events / attribution
- resilience：rate-limit / concurrency / budget-billing / circuit-breaker
- security：sandbox / tool-permission / capability-guard / guardrail-injection / guardrail-pii-moderation
- storage：memory-redis / memory-postgres / checkpoint / event-journal / tool-cache
- rag-backend：embedding（OpenAI/local）/ vector（pgvector/qdrant）
- llm-augment：multi-key / pricing / prompt-adapter / sanitizer
- tool-augment：validation / timeout / progress

### 规则 7：判别口诀（新增能力时按此判断是否应做成 plugin）

1. 如果一个能力**有多种合理实现方式可以替换**（vm2 vs isolated-vm / pgvector vs qdrant），它应该是 plugin
2. 如果一个能力**所有 ai-app 都用得上但没有 ai-app 单独拥有它**，它应该是 plugin
3. 如果一个能力**会跟着发布 SDK 时被用户替换**，它必须是 plugin

---

## 五、稳定接口契约面（SDK 发布预留）

### 规则 8：以下接口标 `@stable`，破坏性变更必须 major bump

```
@stable / 公开承诺面：
  - IPlugin / IPluginManifest / IPluginContext / PluginCapability
  - HookBus.fire / HookBus.register / IHookContext.next / IHookContext.abort
  - IHookContext.replacePayload (CRIT-1)
  - PLUGIN_CATEGORIES 8 大域命名
  - CORE_HOOKS 9 个命名（LLM_REQUEST/RESPONSE / TOOL_BEFORE/WRAP/AFTER / MISSION_START/END / MEMORY_WRITE/READ）
  - 所有 hook payload 接口（在 plugins/core/abstractions/hook-payloads/）

@experimental / 接口可能改：
  - EXTENDED_HOOKS 11 个（AGENT_STEP_BEFORE/AFTER / TEAM_HANDOFF / CHECKPOINT_*  / EMBEDDING/VECTOR_QUERY / SAFETY_*  / CIRCUIT_*）

@internal / 仅内部用：
  - HookBus 内部实现（runWithSupervisor / versionCompat 等）
  - PluginLoader / PluginRegistry 内部实现
  - ServiceProxyRegistry
```

### 规则 9：每 hook payload 必须 versioned

`{ __version: number; ... }` 强制；破坏性变更 bump version；plugin 在 `manifest.payloadVersions` 声明能处理的版本；HookBus 在不兼容时 logger.warn 后跳过该 plugin。

### 规则 10：每 plugin 声明 `coreVersionRange`

semver range（如 `"^1.0.0"`）；启动期 PluginLoader 校验；不兼容**一律 fail-fast**（无论 `required` 字段值），抛 `PluginIncompatibleCoreError`。

---

## 六、设计决策书（DS1 / DS2，PR-0 锁定）

### DS1：IPluginContext.getService 实现路径

**问题**（v5 评审 C2 + P0-2）：plugin 通过 `getService<T>(token: ServiceToken<T>): T` 拿 NestJS service（如 RedisClient），但 plugin 不能持有 ModuleRef / Injector，怎么实现？

**v5.1 锁定方案 A：plugins/core 持有受限 Injector + ServiceProxyRegistry**

```typescript
// src/plugins/core/security/service-proxy-registry.ts
@Injectable()
export class ServiceProxyRegistry {
  constructor(private readonly injector: Injector) {}

  /** 启动期 PluginCoreModule.onApplicationBootstrap 调用 */
  registerInternal<T>(token: ServiceToken<T>, instance: T): void;

  /** plugin 通过 IPluginContext.getService 调到这里 */
  resolve<T>(token: ServiceToken<T>, pluginCtx: IPluginContext): T {
    // 三层校验：
    // ① manifest.capabilities 是否含对应 capability
    // ② profile 是否禁用了该 capability
    // ③ 是否是受信 plugin（内置 / 已签名外部）
    // 返回受限代理（NamespacedRedisClient 等）而非原始 client
  }
}
```

**关键点**：

- ServiceToken 是 `unique symbol`（不是 string，避免 token 撞名）
- 内置 token 全部在 `src/plugins/core/abstractions/service-tokens.ts` 定义
- plugin 拿到的是受限代理，原始 NestJS service 不暴露给 plugin
- SDK 第三方 plugin：只能拿白名单内 token；非白名单 token 抛 `PluginCapabilityError`

**否决方案 B**（PluginLoader 静态注入）：理由是 SDK 第三方场景下静态注入需要修改内核代码，灵活性不够。

### DS2：plugin 间隔离（拒绝直接对象引用）

**问题**：v5.1 §11.9 第 8 点说"plugin 之间仅通过 hook payload 通信，不可同进程对象引用"。具体怎么强制？

**v5.1 锁定**：

1. **IPluginContext 不暴露其他 plugin** —— `getService()` 不接受 plugin id 作为 token；PluginRegistry 不对外暴露
2. **IPluginEventBus 强制 namespace** —— `subscribe(topic)` 内核侧加 `${pluginId}:` 前缀；plugin 不能 subscribe `*` 或其他 plugin namespace；跨 namespace 须声明 `events:cross-subscribe:{targetPluginId}` capability
3. **logger 自动加固定前缀** —— plugin 不能伪造其他 plugin 日志
4. **ESLint** —— `no-restricted-imports` 禁止 `plugins/<a>/*` 导入 `plugins/<b>/*`（详见看护章节）

**唯一合法的 plugin 间通信路径**：通过 hook payload（一个 plugin 在 hook handler 里写入 payload 字段，另一个 plugin 在更下游的 hook 监听者读取）——本质是平台中介通信，仍受 capability gate 控制。

---

## 七、安全姿势（v5.1 CRIT-1 / CRIT-2 必修，PR-1 起强制）

### 规则 11：payload immutability（CRIT-1）

- `IHookContext.payload: Readonly<P>` 强制
- HookBus.fire 端 `Object.freeze(structuredClone(payload))`
- plugin 试图 mutate 引发 TypeError
- 唯一合法修改路径：`ctx.replacePayload(newPayload)`，必须 capability gate（`write:<payload-domain>`）

### 规则 12：plugin 来源信任分级（CRIT-2）

PluginLoader 区分两类来源：

| 来源                                                | 默认信任级别   | OSS 处置                                        | 企业版处置       |
| --------------------------------------------------- | -------------- | ----------------------------------------------- | ---------------- |
| `src/plugins/` 内置                                 | 受代码审查信任 | 直接加载                                        | 推荐签名         |
| `node_modules/@genesis/plugins-*/` 官方第三方       | 需签名         | manifest.signature 必须非空 + 公钥校验          | 强制签名 + audit |
| `node_modules/<其他>/genesis-plugin-*` 非官方第三方 | 不受信         | 默认拒绝；`PLUGIN_TRUST_MODE=permissive` 才允许 | 拒绝             |

公钥固化在 `src/plugins/core/security/trusted-keys.json`。环境变量 `PLUGIN_TRUST_MODE`：

- `strict`（生产推荐）：所有外部 plugin 强制签名
- `permissive`（开发用）：未签名外部 plugin 可加载但 logger.warn

### 规则 13：内核必备防护（HIGH/MED 修订）

- `IPluginContext.logger` 内置 PII scrubber（messages content 截断、headers.authorization 遮蔽）
- `IPluginEventBus.subscribe` 强制 namespace 前缀
- `getService(REDIS_SERVICE)` 返回 `NamespacedRedisClient`（屏蔽 KEYS/SCAN/FLUSHDB）
- `read:llm-payload` 拆分为 `read:llm-payload:meta` + `read:llm-payload:full`，生产 profile 默认禁用 full
- `coreVersionRange` 不兼容一律 fail-fast，无视 `required`

### 规则 14：abort 生命周期事件（HIGH-3）

- `HookAbortError` 必须携带 `reason: "cache-hit" | "rate-limited" | "permission-denied" | "timeout" | string` + `abortPayload`
- abort 路径必须 fire 配套事件（`LLM_CACHE_HIT` / `TOOL_CACHE_HIT`），billing/audit plugin 仍能记录
- TaskProfile（creativity + outputLength）必须入 cache key

---

## 八、看护机制（强约束，R0.5 PR-0 + PR-12 实施）

### 规则 15：layer-boundaries.spec.ts 扩展（PR-0 必备）

```typescript
// backend/src/__tests__/architecture/layer-boundaries.spec.ts
function fileLayer(filePath: string): string | null {
  const m1 = filePath.match(/^src\/modules\/([^/]+)\//);
  if (m1) return m1[1];

  // v5.1 C1 修订：识别新根目录
  if (filePath.startsWith("src/plugins/core/")) return "plugins/core";
  const m2 = filePath.match(/^src\/plugins\/([^/]+)\//);
  if (m2) return `plugin:${m2[1]}`;

  return null;
}

// 新增 9 项断言：
// 1. ai-harness/* 不得 import src/plugins/* 实现
// 2. ai-engine/* 不得 import src/plugins/* 实现
// 3. ai-app/* 不得 import src/plugins/* 实现
// 4. plugins/core 不得 import 任何 src/modules/* 内部
// 5. plugins/core 不得 import src/plugins/* 实现
// 6. src/plugins/* 不得 import src/modules/ai-harness/* 内部
// 7. src/plugins/* 不得 import src/modules/ai-engine/* 内部
// 8. src/plugins/* 不得 import src/modules/ai-app/* 任何路径
// 9. src/plugins/<a>/* 不得 import src/plugins/<b>/*
// + manifest schema 全部合法
// + manifest.capabilities 与 manifest.hooks 一致
```

### 规则 16：ESLint `no-restricted-imports` 扩展（PR-0 必备）

```js
// backend/.eslintrc.js
overrides: [
  {
    files: ["**/modules/ai-harness/**/*.ts", "**/modules/ai-engine/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/plugins/**", "@/plugins/**", "src/plugins/**"],
          message: "harness/engine 不得 import plugin 实现，必须通过 HookBus",
        }],
      }],
    },
  },
  {
    files: ["**/plugins/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@/modules/ai-harness/**", "src/modules/ai-harness/**"], message: "plugin 不得 import harness 内部，仅允许 plugins/core" },
          { group: ["@/modules/ai-engine/**", "src/modules/ai-engine/**"], message: "plugin 不得 import engine 内部，仅允许 plugins/core" },
          { group: ["@/modules/ai-app/**", "src/modules/ai-app/**"], message: "plugin 不得 import ai-app（plugin 是平台横切，与业务无关）" },
          { group: ["../**/plugins/**", "**/plugins/*/[^/]+/**"], message: "plugin 不得 import 其他 plugin（仅通过 hook payload 通信）" },
        ],
      }],
    },
  },
  {
    files: ["**/plugins/core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@/modules/**", "src/modules/**"], message: "plugins/core 是平台内核，不得依赖任何 module" },
          { group: ["**/plugins/**", "@/plugins/**"], message: "plugins/core 不得依赖具体 plugin 实现" },
        ],
      }],
    },
  },
],
```

### 规则 17：pre-push hook 扩展

`.husky/pre-push` 现有第 0 步 `npm run verify:arch` 自动覆盖 layer-boundaries.spec 扩展（spec 跑通即说明 plugin 系统边界合法）。

无需新增 pre-push 步骤，但 `verify:arch` script 必须包含新 9 项断言。

---

## 九、违规处置

### 规则 18：违规分级

| 违规                                               | 等级     | 处置                                   |
| -------------------------------------------------- | -------- | -------------------------------------- |
| harness/engine 直接 import `src/plugins/*`         | CRITICAL | 立即拒推（pre-push）                   |
| plugin 直接 import `src/modules/*` 内部            | CRITICAL | 立即拒推                               |
| plugin 之间互相 import                             | CRITICAL | 立即拒推                               |
| plugin 试图 mutate `IHookContext.payload`          | HIGH     | 运行时 TypeError，但应在 review 期捕获 |
| plugin 未声明 capability 调 `getService`           | HIGH     | 运行时抛 PluginCapabilityError         |
| 在 harness/engine 内核新增不通过 plugin 的横切实现 | HIGH     | PR review 拒绝合并                     |
| 第三方 plugin 未签名（PLUGIN_TRUST_MODE=strict）   | HIGH     | 启动期拒绝加载                         |
| 新增 plugin 未归入 8 大域                          | MEDIUM   | review 修订                            |
| plugin manifest 缺 coreVersionRange                | MEDIUM   | review 修订                            |

### 规则 19：例外申请

在极少数场景下（迁移期 / 兼容性 forwarder），允许通过文件头 `// @plugin-system-allowlist-reason: <reason> + <migration-deadline>` 临时放行——必须含明确迁移期限，超期未迁移视为违规。

---

## 十、与现有 standards 的关系

| 规范                           | 与本规范关系                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 16-ai-engine-harness-structure | 5 层架构基础（L1 platform / L2 ai-engine / L2.5 ai-harness / L3 ai-app / L4 open-api）；本规范在其之上扩展 plugins/core / plugins 双根目录 |
| 17-extension-governance        | 现有"扩展必须经过受控扩展点"规则；本规范增加 plugin 作为新的扩展点                                                                         |
| 18-base-layer-file-governance  | 现有"base layer 业务无关"规则；本规范扩展到"base layer 横切关注点剥离"红线                                                                 |

---

## 十一、变更历史

| 版本 | 日期       | 变更                        |
| ---- | ---------- | --------------------------- |
| 1.0  | 2026-05-04 | 初版（v5.1 R0.5 PR-0 交付） |

---

## 十二、引用

- v5.1 plan：`docs/architecture/ai-app/agent-playground/anthropic-sdk-revamp-plan-v5.1.md` §11
- v5 评审 summary：`docs/architecture/ai-app/agent-playground/anthropic-sdk-revamp-review-v5-summary.md`
- 4 路评审产物：`anthropic-sdk-revamp-review-v5-{architect,arch-auditor,security,reviewer}.md`
