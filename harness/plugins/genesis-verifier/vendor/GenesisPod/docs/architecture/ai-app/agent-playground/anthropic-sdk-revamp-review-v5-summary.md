# v5 多角色评审收敛总结

**评审日期**：2026-05-04
**评审角色**：architect / arch-auditor / security-auditor / reviewer（4 路并行）
**评审对象**：[`anthropic-sdk-revamp-plan-v5.md`](./anthropic-sdk-revamp-plan-v5.md)（2350 行，重点 §11 Plugin 系统）

**评审产出**：

- [v5-architect](./anthropic-sdk-revamp-review-v5-architect.md)：4 P0 + 6 P1 + 5 P2 + 7 通过项
- [v5-arch-auditor](./anthropic-sdk-revamp-review-v5-arch-auditor.md)：3 CRITICAL + 3 HIGH
- [v5-security](./anthropic-sdk-revamp-review-v5-security.md)：2 CRITICAL + 3 HIGH + 4 MEDIUM + 2 LOW
- [v5-reviewer](./anthropic-sdk-revamp-review-v5-reviewer.md)：3 P0 + 5 P1 + 工作量重估

---

## 1. 评审结论

**v5 不能直接进 R0.5 PR-1 实施。** 4 路评审独立得出一致结论：方案方向正确（plugin 化是 base layer 瘦身的合理路径，IPlugin / HookBus / capability 框架对标业界 SOTA），但在**接口契约边界、安全姿势、看护衔接、工作量估算**四个维度存在必修问题。

**修订路径**：v5 → v5.1（合并所有 P0/CRITICAL）→ 评审通过 → R0.5 实施。**预计修订工作量 1-2 天**（接口/文档修订，不需要写代码）。

---

## 2. 修订项汇总（按优先级排序）

### 2.1 P0 / CRITICAL（共 12 项，必进 v5.1）

#### 设计契约边界（5 项）

| ID              | 来源                     | 问题                                                                                                                                       | v5.1 修订                                                                                                                                                                                                                                                                                  |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CRIT-1**      | security                 | payload 在 hook 链中是 mutable，capability 不 guard payload 写入，prompt injection 路径完全打通                                            | `IHookContext<P>` 改 `payload: Readonly<P>` + `Object.freeze`；新增 `ctx.replacePayload(newPayload)` 接口，capability gate 检查调用方持有 `write:llm-payload`；写入后给后续 plugin 的是 frozen copy                                                                                        |
| **CRIT-2**      | security                 | OSS 版无外部 plugin 签名校验，src/plugins/ 是零摩擦后门                                                                                    | PluginLoader 区分 `src/plugins/`（内置受代码审查）vs `node_modules/@genesis/plugins-*/`（外部，强制签名）；公钥锁定在 `plugin-core/security/trusted-keys.json`；`PLUGIN_TRUST_MODE=strict` 环境变量强制要求签名                                                                            |
| **C2 + P0-2**   | arch-auditor + architect | `IPluginContext.getService<T>()` 实现路径完全没说清——ServiceToken 类型、与 NestJS DI 容器边界、SDK 第三方场景如何拿 service 都缺失         | 决策路径 A：plugin-core 持有 `Injector` 引用（NestJS ModuleRef-like 包装层），`getService` 内部走 ModuleRef.get + capability check；决策路径 B：PluginLoader 在 init 时把 plugin 声明的 services 静态注入。**v5.1 锁定方案 A**（更灵活），明确 ServiceToken 是 `unique symbol` 不是 string |
| **C3**          | arch-auditor             | hook payload 类型放哪里——plugin import 会破坏分层；harness/engine import plugin-core 会形成循环                                            | 在 `src/plugin-core/abstractions/hook-payloads/` 定义**泛化版** payload 类型（如 `LlmRequestPayload = { request: unknown; meta: Record<string, unknown> }`）；harness/engine 在 fire 调用点做 cast；plugin 侧 cast 回业务类型；payload 类型不依赖任何 module                               |
| **P0-1 + P0-1** | architect + reviewer     | ToolPipeline 5 middleware 强语义顺序仅靠 priority 数字不够；abort 后 after 半段未定义；TimeoutMiddleware 需要 `wrap` 语义不是 before/after | 新增 `TOOL_WRAP` hook（带 AbortSignal 的包装语义），timeout/sandbox 用 `TOOL_WRAP` 不是 `TOOL_BEFORE/AFTER`；`abort()` 携带 `reason: "cache-hit" \| "timeout" \| "denied"`，定义 abort 后是否 fire `TOOL_AFTER` 的明确规则（默认 fire 但 payload 含 abortReason）                          |

#### §0 红线被破坏（1 项，最严重）

| ID       | 来源      | 问题                                                                                                                                                     | v5.1 修订                                                                                                                                                                            |
| -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P0-3** | architect | `AiHarnessModule.forFeature({ pluginOverrides })` 必然引入 `appName` 入 hook payload 才能让 per-agent override 生效——直接破坏 §0 base layer 业务无关红线 | **删除模块级 forFeature override**；只保留 yaml 全局配置 + tag-based 配置（按 plugin tag 配置而非 ai-app 名）；ai-app 业务差异通过 SKILL.md frontmatter 表达，不通过 plugin override |

#### 术语 / 自相矛盾（2 项）

| ID       | 来源      | 问题                                                                                                                                                          | v5.1 修订                                                                                                                                                                 |
| -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0-4** | architect | v3 §3.2 业务级 stage hook（`extractDecision/accountability`）与 v5 §11 plugin hook（`LLM_REQUEST/TOOL_BEFORE`）是两个不同物种，全文 100+ 次"hook"未做术语区分 | 全文统一术语：业务级叫 **"stage callback"** 或 **"primitive hook"**；plugin 级叫 **"platform hook"**；§11 章节加显著说明框；§11.4 hook 表格新增"是否对外部 plugin 开放"列 |
| **P0-2** | reviewer  | §1 决策锁定第 6 条"不做 NestJS forFeature dynamic module"vs §11.6 forFeature override 自相矛盾                                                                | 同 P0-3，删除 forFeature；§1 决策第 6 条不变                                                                                                                              |

#### 看护衔接（2 项）

| ID     | 来源         | 问题                                                                                                                                    | v5.1 修订                                                                                                                                                                                                                                                |
| ------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | arch-auditor | layer-boundaries.spec.ts `fileLayer()` 基于 `modules/([^/]+)/` 正则，对 `src/plugin-core/` + `src/plugins/` 静默返回 null——7 条断言假绿 | 扩展 `fileLayer()` 识别新目录：`/^src/plugin-core/` → `"plugin-core"` 层；`/^src/plugins/([^/]+)/` → `"plugin:<domain>"` 层；新增 6 项断言（plugin 不得 import harness/engine 内部、harness/engine 不得 import plugins/ 实现等）。此修订作为 PR-0 必备项 |
| **H1** | arch-auditor | §11.13 ESLint 规则路径格式 `files: ["src/modules/ai-harness/**"]` 缺 `**` 前缀，规则静默失效                                            | 修正为 `files: ["**/modules/ai-harness/**"]`（与现有规则风格一致）；plugin 侧补充 ai-app 禁令：`patterns: ["@/modules/ai-app/**"]`                                                                                                                       |

#### 安全 / 行为正确（2 项）

| ID         | 来源     | 问题                                                                                                                   | v5.1 修订                                                                                                                                                                            |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **HIGH-3** | security | cache plugin abort 后 TaskProfile / billing / audit 失控                                                               | abort 路径必须 fire `LLM_CACHE_HIT` / `TOOL_CACHE_HIT` 事件；TaskProfile cache key 强制包含 `creativity` + `outputLength` 维度；billing/audit plugin 通过监听 cache-hit 事件仍能记录 |
| **P0-3**   | reviewer | PluginLoader 工作量从 2 天 → 5 天（NestJS 生命周期 / ModuleRef.get / forwardRef 循环依赖 / @Interval supervisor 注册） | §9 R0.5 时间表从 1.5-2 周 → 3.5-4 周；§11.12 PR-3 工作量从 2 天 → 5 天；其他 PR 同步重估（见 §3）                                                                                    |

### 2.2 HIGH（共 6 项，进 v5.1）

| ID                                | 来源                 | 问题                                                                                                                 | v5.1 修订                                                                                                                                                                                                                                                    |
| --------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **H2**                            | arch-auditor         | 双轨期 1 周看护实质失效                                                                                              | PR-4/5/6 双轨期临时增加 ESLint allowlist 注释模式 + 看护 spec 排除该 1 周；PR-11 完成后强制看护恢复                                                                                                                                                          |
| **H3**                            | arch-auditor         | plugin 配置强类型导出路径缺失                                                                                        | 在 plugin-core 提供 `IPluginConfigSchemas` 配置类型桶，ai-app override 时通过桶 import 不通过具体 plugin 路径                                                                                                                                                |
| **HIGH-1**                        | security             | telemetry plugin 通过 logger 记录完整 LLM payload 绕过敏感数据规则                                                   | `read:llm-payload` 拆分为 `read:llm-payload:meta` + `read:llm-payload:full`；logger 内置 PII scrubber（`messages[].content` 截断、`headers.authorization` 遮蔽）                                                                                             |
| **HIGH-2**                        | security             | events:subscribe 无 namespace 强制                                                                                   | `IPluginEventBus.subscribe` 内核侧强制前缀 `${pluginId}:${topic}`；跨 namespace 订阅须声明 `events:cross-subscribe:{targetPluginId}`                                                                                                                         |
| **P1-1 ~ P1-5**                   | architect / reviewer | CORE_HOOKS 缺 `TOOL_EXECUTE`（影响 sandbox plugin）/ 双根目录加载时序 / R0.5 时机 / IPlugin 契约 / plugin 间通信约定 | §11.4 CORE_HOOKS 加 `TOOL_EXECUTE`（即上面的 TOOL_WRAP）；§11.2 加"启动期 plugin-core 先于 AppModule 实例化"说明；§4 R0.5 时机锁定为"R0 全 5 项收完后才进 R0.5"；§11.3 IPlugin 加 dispose 必须幂等约束；§11 加 plugin 间仅通过 hook payload 通信的强约束声明 |
| **MED-1 ~ MED-4 + LOW-1 + LOW-2** | security             | redis 隔离 / coreVersionRange 处置 / 路径穿越 / experimental 通知 / 不可逆副作用 / 安全 plugin 不得被 ai-app 关闭    | NamespacedRedisClient 封装 / coreVersionRange 失败一律 fail-fast / PluginLoader path.resolve 校验 / experimental 自动 emit DEPRECATED_HOOK_FIRED / security 类 plugin 标 `overridable: false`                                                                |

### 2.3 P2（5 项，可后修，不阻塞 R0.5）

- 业务级 stage callback 改名 / 文档体量拆分（§11 → 独立 plugin-system-design.md，主方案保留摘要）/ 测试矩阵优化建议 / DX 工具链（CLI 脚手架后置）/ 非关键 plugin 命名细节

---

## 3. 工作量与时间表重估

| 阶段                | v5 估        | v5.1 真实估  | 偏差原因                                                                   |
| ------------------- | ------------ | ------------ | -------------------------------------------------------------------------- |
| Stage 0（PR-1/2/3） | 4.5 天       | 7-8 天       | PR-3 PluginLoader 涉及 NestJS 生命周期 / ModuleRef / forwardRef 循环依赖   |
| Stage 1（PR-4/5/6） | 3 天         | 4-5 天       | TOOL_WRAP hook 新增 + AbortSignal 接入 + 双轨期 timeout 路径特殊处理       |
| Stage 2（PR-7~10）  | 6-8 天       | 10-12 天     | 每个 plugin 增加 NestJS DI 接入 + 配置类型桶 import + capability gate 校验 |
| Stage 3（PR-11/12） | 2.5 天       | 5-6 天       | ObservabilityModule @Global 11 provider 拆 3 个 PR / 看护扩展              |
| **R0.5 合计**       | **1.5-2 周** | **3.5-4 周** |                                                                            |
| Phase 1 总时间表    | 14 周        | **16-17 周** | R0.5 +2 周影响 W3-W4 → W3-W6                                               |

**结论**：v5.1 §9 时间表必须更新；R0.5 不是"插队 1.5-2 周"而是"插队 3.5-4 周"，但仍不影响 R1 主线（R1 之前必须完成 plugin-core）。

---

## 4. 通过项（4 路评审一致认可，v5.1 保持不变）

1. plugin-core / plugins 双根目录决策（不放 ai-app/）—— 4 路一致认可
2. onion middleware 模式 + zero-cost fast-path —— architect / reviewer 认可
3. SDK 三层包发布形态（@genesis/harness-core + essential + 域子包）—— architect 认可
4. manifest.coreVersionRange + payload 版本化设计 —— architect / security 认可
5. plugin 之间不直接互调（仅通过 hook payload）的强约束 —— arch-auditor / security 一致认可
6. 26 plugin 盘点完整性 —— reviewer 通过代码核实
7. R0.5 4 个高价值 plugin（telemetry-otel / tool-cache-redis / rate-limit / sandbox-isolated-vm）覆盖典型机制 —— architect 认可

---

## 5. v5.1 修订工作清单（按修订顺序）

1. **§11.3 IHookContext 接口**：payload Readonly + replacePayload + capability gate（CRIT-1）
2. **§11.3 IPluginContext.getService**：决策方案 A（plugin-core 持有 Injector）+ ServiceToken 是 symbol（C2 + P0-2）
3. **§11 新增 hook payload 类型设计章节**：`src/plugin-core/abstractions/hook-payloads/` 泛化版 payload（C3）
4. **§11.4 CORE_HOOKS 加 TOOL_WRAP**：替换 timeout / sandbox 实现路径（P0-1）
5. **§11.6 删除 forFeature pluginOverrides**：保留 yaml + tag-based（P0-3 + P0-2 reviewer）
6. **§11 全文 + §3.2 术语区分**：stage callback vs platform hook（P0-4）
7. **§11.13 ESLint 路径修正 + 补 ai-app 禁令**：`**/modules/...` 风格（H1 + H3）
8. **§11.13 layer-boundaries.spec 扩展**：fileLayer 识别新目录 + 6 项新断言（C1）
9. **§11.7 abort 生命周期**：cache-hit 事件 + TaskProfile 维度（HIGH-3）
10. **§11.9 + §11.10 安全姿势升级**：外部 plugin 信任分级 + 签名校验 OSS 边界（CRIT-2）
11. **§11 全文 HIGH/MED 修订**：PII scrubber / events namespace / NamespacedRedisClient / coreVersion fail-fast / path.resolve / experimental 通知（HIGH-1/2 + MED-1~4）
12. **§9 时间表更新**：R0.5 1.5-2 周 → 3.5-4 周；Phase 1 14 周 → 16-17 周
13. **§11.12 PR 工作量更新**：每 PR 真实数字
14. **§4 R0.5 时机说明**：必须 R0 全 5 项收完才进 R0.5（P1）
15. **新建 standards/19-plugin-system-governance.md**：plugin / plugin-core 与 5 层架构边界规范

---

## 6. 总评 + 进入 R0.5 前置条件

**v5 → v5.1 路径明确**：上面 15 项修订全部 fold 进 v5.1，预计 1-2 天工作量（纯文档/接口修订）。

**v5.1 通过后才能进 R0.5**：Stage 0 第一个 PR（PR-0：CRITICAL 修订作为前置）必须先于 PR-1（plugin-core abstractions）。

**架构合规度**：v5 直接实施会让 9.8/10 跌到 8.5-9.0/10（layer-boundaries.spec 静默通过 + 业务名渗透）；v5.1 实施可保持 9.8+/10。

**安全姿势**：v5 不达 SDK 发布要求（CRIT-1 + CRIT-2 形同虚设）；v5.1 修复后达到企业级 plugin 系统安全基线。

**下一步行动**：

1. 立即开始 v5 → v5.1 修订（fold 上面 15 项）
2. v5.1 落定后归档 v5（`_archive/2026-q2/`）
3. 创建 R0.5 PR-0 任务（包含 layer-boundaries.spec 扩展 + ESLint 路径修复 + DS1/DS2/payload 设计决策书）
4. PR-0 通过 + R0 全 5 项收完 → 进 R0.5 PR-1（plugin-core abstractions）
