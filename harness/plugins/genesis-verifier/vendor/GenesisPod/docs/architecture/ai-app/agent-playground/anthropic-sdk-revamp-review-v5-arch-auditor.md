# v5 评审 - arch-auditor

**审计日期**: 2026-05-04
**审计对象**: anthropic-sdk-revamp-plan-v5.md §11 全章 + §0 / §3.1 / §4 / §9 / §10
**审计员**: Arch Auditor Agent v2.0
**参考基线**: 9.8/10（PR-X-N, 2026-05-01）

---

## 合规风险（按等级）

### CRITICAL

**C1：plugin-core 与 layer 模型完全脱轨，spec 盲区**

现有 `layer-boundaries.spec.ts` 的 `fileLayer()` 函数基于 `modules/([^/]+)/` 路径模式识别层归属。`src/plugin-core/` 和 `src/plugins/` 不在 `src/modules/` 下，`fileLayer()` 对这两个目录的所有文件返回 `null`，意味着：

- 所有 `src/plugin-core/**/*.ts` 文件的 import 完全跳过所有现有 7 条断言
- 所有 `src/plugins/**/*.ts` 文件同上
- plugin 内部 import 任何 `modules/ai-harness/**` 内部路径，现有 spec 一条都不会触发

这不是"断言会被破坏"，而是"断言对新目录无感知"，是更危险的盲区。旧有 9.8/10 基线的 spec 覆盖率在 v5 引入新根目录后立即退化到未知水平。

**C2：IPluginContext.getService() 必然持有 NestJS ModuleRef，是隐式反向依赖**

`IPluginContext.getService<T>(token: ServiceToken<T>): T` 声明在 `src/plugin-core/abstractions/`，plugin-core 自称不依赖 harness/engine 任何业务符号。但 `getService()` 的实现体（`PluginContextImpl`）必须持有某种 DI 容器引用才能兑现 `getService("redis")`。

v5 §11.3 只说"plugin 拿不到 NestJS ModuleRef"，但没说 `PluginContextImpl` 本身如何获得 redis client。两条可能路径：

1. `PluginContextImpl` 在构造时注入 `ModuleRef`（plugin-core 间接依赖 NestJS DI，不是业务依赖，但打破"不依赖任何 module"的声明）
2. `PluginContextImpl` 在构造时注入具体 client 对象（谁负责构造？必然是 AppModule 或 PluginLoader，此时 PluginLoader 成了胶水层，持有 harness/engine/infra 的所有 service 引用）

路径 2 意味着 PluginLoader（plugin-core 内部）要显式 import 并注入 `RedisService`、`PrismaService` 等 ai-infra 服务——plugin-core 就不再是"不依赖任何 module"的纯内核，而是隐式依赖 ai-infra。方案在 §11.3 和 §11.8 中完全回避了这个实现细节，是 P0 设计空白。

**C3：hook payload 类型定义在哪里——循环依赖未解决**

§11.4 定义了 8 个 CORE_HOOKS，payload 类型（如 `{ __version: 1, request: ChatRequest }`）中的 `ChatRequest` 来自 ai-engine/llm。plugin 要实现 `HookHandler<{ request: ChatRequest }>` 就必须 import `ChatRequest`。

v5 提出两条路，均有问题：

- **定义在 plugin-core**：plugin-core 必须 import `ChatRequest`（来自 ai-engine），打破"不依赖 engine 任何符号"
- **定义在 harness/engine**：plugin 要 import harness/engine 内部路径，打破"plugin 不得 import harness/engine 内部"

§11.13 给的 ESLint 规则禁止 `src/plugins/**` import `@/modules/ai-harness/**` 和 `@/modules/ai-engine/**`，但完全没有说明 payload 类型从哪里来。如果 payload 类型重新定义在 plugin-core 的 `hook-payloads/` 子目录（独立于 harness/engine 的副本），则出现类型重复；如果靠 TypeScript structural typing 绕过，则失去编译期类型安全。这个循环依赖是 v5 架构的核心未解问题。

---

### HIGH

**H1：ESLint 规则路径模式与实际 src 根目录不匹配**

§11.13 给出的 ESLint 扩展：

```js
files: ["src/modules/ai-harness/**", "src/modules/ai-engine/**"],
```

项目实际文件在 `backend/src/modules/ai-harness/**`，ESLint 配置位于 `backend/.eslintrc.js`，`files` 相对于配置文件根路径解析。现有规则全部使用 `**/modules/ai-engine/**/*.ts` 风格的 glob，而 §11.13 使用 `src/modules/...`（缺 `**` 前缀）。这个路径模式不会命中任何文件，规则静默失效。

同样的问题出现在 plugin 侧：

```js
files: ["src/plugins/**"],
```

应为 `**/src/plugins/**` 或 `backend/src/plugins/**`（取决于 ESLint root 位置）。

**H2：双轨期架构看护误判风险**

PR-4 让 `engine/tools/registry` 同时维持旧 cache/middleware 实现（直接 import）和新 `HookBus.fire(TOOL_BEFORE/AFTER)`。此时：

- 旧的 `ToolCacheService` import 仍存在于 engine/tools/registry
- 新的 `HookBus` import（来自 plugin-core）也存在

现有 `layer-boundaries.spec.ts` 不覆盖 plugin-core 的导入，engine → plugin-core 的依赖方向合法还是违规，spec 没有断言。`fileLayer("plugin-core/...")` 返回 null，`importLayer("../plugin-core/hook-bus")` 也返回 null，双向盲区。

双轨期 Stage 1-2 约 1 周，这段时间内架构看护实质上是瞎的。

**H3：ai-app 层通过 `AiHarnessModule.forFeature({ pluginOverrides })` 配置 plugin——pluginOverrides 配置对象是否会引入 import**

§11.6 示例中 ai-app 模块声明：

```typescript
AiHarnessModule.forFeature({
  pluginOverrides: {
    "resilience/rate-limit": { config: { perAgentRpm: { research: 100 } } },
    "security/sandbox-isolated-vm": { enabled: false },
  },
});
```

plugin id 是字符串，无需 import。但如果某个 pluginOverride 的 config 需要强类型（比如 rate-limit 的 `RateLimitConfig` 类型），ai-app 开发者可能直接 `import { RateLimitConfig } from 'src/plugins/resilience/rate-limit'`。v5 没有提供 plugin 配置类型的对外导出路径（facade 或 plugin-core 桶），这是一个 **极可能导致未来违规** 的设计遗漏。

---

### MEDIUM

**M1：layer-boundaries.spec.ts 的 listTsFiles 会扫描 plugin-core 和 plugins，但 fileLayer 返回 null**

`listTsFiles(SRC_ROOT)` 从 `backend/src` 开始递归扫描所有 .ts 文件。加入 `src/plugin-core/` 和 `src/plugins/` 后，这些文件全部进入 `ALL_FILES`。但所有 7 条现有断言都是"当 `fileLayer(file) === 'ai-engine'` 时检查 import"——fileLayer 对新目录返回 null，条件不满足，断言跳过。

表面看测试不会失败，实际上对新目录零覆盖。测试绿不等于合规，这是静默通过的假绿问题。

**M2：L3.5 ai-app/\_meta 与 src/plugins/ 边界有模糊地带**

`ai-app/_meta/custom-agents` 是"为多个 ai-app 提供通用容器，本身不是单一业务"。`src/plugins/` 是"平台横切能力，不含业务语义"。

两者都在 "L3 之下但不属于 L2.5" 这一概念空间。规范文档（standards/16/17/18）目前没有 plugin 系统的定位描述。如果 plugin 想访问用户 ID（request context）需要走什么路径？如果 custom-agents 需要注册 plugin override 呢？这个边界在方案中没有给出判别口诀，未来新成员容易将业务逻辑下沉到 plugin。

**M3：§11.13 ESLint 新规则只禁止 plugins import ai-harness/ai-engine 内部，但没有禁止 plugins import ai-app**

`src/plugins/` 是横切能力，不能含任何 ai-app 业务语义。但 §11.13 给出的 plugin 侧规则只写了：

```js
{ group: ["@/modules/ai-harness/**", "@/modules/ai-engine/**"], message: "..." }
{ group: ["../**/plugins/**"], message: "..." }
```

遗漏了禁止 `@/modules/ai-app/**` 的规则。plugin 监听 `MISSION_START` hook 时，payload 中可能含有 `missionId`，plugin 开发者可能去 import ai-app 层的 PlaygroundMissionStore 类型——这既是 facade 穿透，也是 plugin 获得了业务语义。

**M4：verify:arch 命令是否覆盖新 spec 文件**

§11.13 建议新增 `backend/src/__tests__/architecture/plugin-system.spec.ts`。现有 `npm run verify:arch` 是否会自动包含这个新文件，取决于 jest 配置的 testMatch 模式。需要确认新 spec 文件在 `verify:arch` 路径内（而不是只在 `npm run test`）。

---

## 现有看护必须扩展的清单

### layer-boundaries.spec.ts：必须新增 5 项断言

1. `plugin-core 不得 import src/modules/ai-harness/**`（只允许 import ai-infra 中的通用基础服务）
2. `plugin-core 不得 import src/modules/ai-engine/**`（payload 类型必须独立定义在 plugin-core）
3. `plugin-core 不得 import src/modules/ai-app/**`
4. `src/plugins/** 不得 import src/modules/ai-harness 内部路径`（允许 plugin-core facade 路径）
5. `src/plugins/** 不得 import src/plugins/[其他域]/**`（plugin 间不互调）

同步修改 `fileLayer()` 函数，识别 `plugin-core` 和 `plugins` 两个新层归属：

```typescript
if (rel.startsWith("plugin-core/")) return "plugin-core";
if (rel.startsWith("plugins/")) return "plugins";
```

同步修改 `importLayer()` 函数，识别 `src/plugin-core/` 和 `src/plugins/` 的相对路径 import。

### ESLint 必须新增 4 条规则（修正 §11.13 的路径格式）

1. `files: ["**/src/modules/ai-harness/**/*.ts", "**/src/modules/ai-engine/**/*.ts"]`，禁止 import `**/plugins/**`（修正路径格式，将 `src/modules/...` 改为 `**/modules/...`）
2. `files: ["**/src/plugins/**/*.ts"]`，禁止 import `**/modules/ai-harness/**`、`**/modules/ai-engine/**`、`**/modules/ai-app/**`、`../**/plugins/**`（补充遗漏的 ai-app 禁令，修正路径格式）
3. `files: ["**/src/plugin-core/**/*.ts"]`，禁止 import 任何 `**/modules/**`（plugin-core 纯内核，不依赖任何业务 module）
4. 为 plugin 配置类型导出专设 `plugin-core/plugin-configs/` 桶，禁止 ai-app 直接 import `src/plugins/**/config.schema.ts`

### pre-push hook

无需修改结构，但 `verify:arch` 脚本必须确认 `plugin-system.spec.ts` 在其 testPathPattern 内。建议在 `package.json` 的 `verify:arch` 命令中明确 `--testPathPattern="architecture|plugin-system"`。

---

## 必须前置解决的设计空白（进 R0.5 PR-1 前）

**DS1：IPluginContext.getService() 实现方案必须明确**

需要在 §11.3 补充 `PluginContextImpl` 的构造方式：

选项 A — PluginLoader 在 AppModule 启动时注入 capability-gated service map（`Map<ServiceToken, unknown>`），plugin-core 只依赖这个 map，不依赖具体 service 类型。plugin-core 知道 `ServiceToken`（一个字符串或 Symbol），不知道 `RedisService` 类。这样 plugin-core 对 ai-infra 无 import 依赖。

选项 B — AppModule 负责构造 `PluginContextImpl` 并传入具体 service 引用，plugin-core 只定义 `IPluginContext` 接口不提供实现。实现在 `src/app/plugin-context.factory.ts`（L4 层）。这样依赖方向是 L4 → plugin-core，plugin-core 无反向依赖。

两个选项都可行，但必须在 PR-1 前明确，否则 PR-3（PluginLoader + PluginConfigService）会无法实现 `init(ctx, config)` 中的 `ctx`。

**DS2：hook payload 类型的归属必须在 PR-1 明确**

推荐方案：在 `src/plugin-core/hook-payloads/` 定义所有 hook payload 类型，用 generic/abstract 类型（如 `LlmRequestPayload { request: Record<string, unknown>; meta: HookMeta }`）而非直接引用 `ChatRequest`。harness/engine 内部在 `HookBus.fire()` 调用点做强类型 cast：

```typescript
// engine/llm/services/ai-chat.service.ts
await this.hookBus.fire<LlmRequestPayload, ChatResponse>(
  CORE_HOOKS.LLM_REQUEST,
  { __version: 1, request: req as Record<string, unknown>, meta },
  terminal,
);
```

plugin 处理 payload 时拿到 `LlmRequestPayload`，如需还原强类型自行 cast。这样 plugin-core 完全不 import ai-engine 符号。

---

## 建议补充的规范文档

**standards/19-plugin-system-governance.md**（新增，必须在 R0.5 PR-1 前完成）：

应包含以下判别口诀和规则：

- Plugin 定位："平台横切能力，无业务语义，无 ai-app 知识"；与 L3.5 \_meta 的区别："\_meta 服务于 ai-app 通用容器（含业务语义），plugins 不含任何业务语义"
- Plugin 层级位置：plugin-core 在 L1 以下（平台基础设施），plugins 在 L1 与 L2 之间的横切层
- hook payload 类型定位：必须在 plugin-core/hook-payloads/ 定义，不得从 harness/engine 直接引用
- plugin 配置类型导出：必须通过 plugin-core 桶，ai-app 不直接 import plugins/\*\*/config.schema.ts
- capability vs hook 一致性规则（补充 §11.5 的机器可检查版本）
- 双轨期看护：Stage 1-2 期间需人工 PR review 确认无跨层直接 import，不能完全依赖 spec（因为 spec 对 plugin-core 无感知）

---

## 总评

**合规等级保持 9.8/10：否**

引入 `src/plugin-core/` 和 `src/plugins/` 两个新根目录后，现有 `layer-boundaries.spec.ts` 对这两个目录完全无感知（fileLayer 返回 null，所有 7 条断言跳过）。9.8/10 基线是在没有 plugin 目录的代码库上建立的，新目录加入后合规分实际退化到未知，直到新 spec 断言落地并通过才能恢复。

**必须前置补充看护（进 R0.5 PR-1 前必须全部就位）**：

1. `layer-boundaries.spec.ts` 扩展 fileLayer/importLayer 识别 plugin-core/plugins
2. 新增 `plugin-system.spec.ts`（§11.13 已给出骨架，但需补充 ai-app 禁令断言）
3. ESLint 规则路径格式修正（§11.13 的 `src/modules/...` 改为 `**/modules/...`）
4. §11.13 ESLint plugin 侧规则补充禁止 import ai-app
5. 解决 DS1（IPluginContext.getService 实现方案）
6. 解决 DS2（hook payload 类型归属）
7. 新增 standards/19-plugin-system-governance.md

**可放行进 R0.5：否（有条件放行）**

必须满足：①上述 1-4 ESLint/spec 看护在 PR-1 同 PR 提交；②DS1/DS2 设计决策在 PR-1 开工前书面确认（一段话即可，不需要完整 standards 文档）；③standards/19 可以在 PR-3 前完成（不阻塞 PR-1/PR-2）。满足这三条后可进入 R0.5。

---

_评审模型: Arch Auditor Agent v2.0_
_参考文件: `backend/src/__tests__/architecture/layer-boundaries.spec.ts` + `backend/.eslintrc.js` + v5 plan §0/§3.1/§4/§9/§10/§11_
