# ADR 009 — Capability(L3 契约) × Plugin(L1 底座):组合而非合并

> 状态:**Accepted（前瞻落地,含 plugin 硬化前置条件）**　·　日期:2026-06-08
> 关联:`ai-app/marketplace/capability/*`(P2c 引入)、`backend/src/plugins/*`、
> standards/19（plugin capability 模型）、design.md §4.3（市场=平台共享）。

## Context

P2c 为市场能力引入了 `CapabilityManifest` + `ICapabilityRunner` + `CapabilityRegistry`
（版本化清单 + 可插拔 runner 端口 + 解析注册表),manifest 里预留了 `permissions` /
`version` / 注释"未来换沙箱/远程/MCP 实现"。

核实后发现:`backend/src/plugins` 的 **PluginCoreModule 已 wired 在 app.module**（harness
orchestrator 也在用）,且早已实做更强的同类机制:

- `plugin.interface.ts`:`coreVersionRange`(semver range)、`capabilities: PluginCapability[]`
  （细粒度权限模型 + getService 门控）、`signature?`、`replaces`/`overridable`。
- `plugin-loader` / `plugin-supervisor`(健康/熔断) / `hook-bus` / `manifest-validator` /
  `sandbox-isolated-vm`,**6 个已上架插件**（全为一方基础设施:storage/observability/security）。

**问题（MECE 红线）**:项目铁律"同名概念全项目唯一"。现在并存两套意图重叠的
"自描述 + 版本化 + registry 解析 + 未来沙箱化的可扩展单元":`PluginRegistry/PluginManifest`
与 `CapabilityRegistry/CapabilityManifest`。capability 在 L3 用更弱的形式重造了 plugin 已
有的一半。

## Decision

**两者不在同一高度,组合而非合并:**

|      | Capability(L3)                                | Plugin(L1/L2)                           |
| ---- | --------------------------------------------- | --------------------------------------- |
| 本质 | 用户购买并 run 的产品级可执行单元（市场 SKU） | 运维安装、改变平台怎么跑的扩展          |
| 驱动 | 调用式 `runner.run(input, ctx)` → 报告        | 拦截式 挂 hook（TOOL_WRAP/llm.request） |
| 住所 | `ai-app/marketplace`                          | `backend/src/plugins`（顶层平台 SDK）   |

「一份 deep-insight SKU」**不是**一个 TOOL_WRAP 拦截器——硬塞是范畴错误。**capability 这个
L3 调用契约保留。**

但 capability 的"公开市场未来"（签名/沙箱/版本协商/最小特权）**不在 capability 里另起一套**,
而是**借给 plugin 框架兜底**:

- **现在（内部一方市场、可信）**:`ICapabilityRunner` 进程内直跑,`CapabilityRegistry` 轻量
  Map——**保持现状,够用,不动。**
- **公开市场（第三方不可信）那天**:第三方 runner 的"沙箱/远程实现"走 plugin——签名校验、
  capability 门控、健康熔断、隔离执行**全继承 plugin**。落点是一个 **plugin-backed capability
  runner 适配器**,把 L3 调用翻译成 L1 plugin 执行。

### 字段映射（capability → 复用 plugin,不重造）

| CapabilityManifest（L3）                    | 复用 Plugin（L1）                                               | 说明                                                                        |
| ------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `id`                                        | plugin `id`                                                     | 同为稳定解析键                                                              |
| `version` + 未来 range 协商                 | plugin `coreVersionRange`(semver)                               | capability 现状只取 latest;range/fail-fast 走 plugin                        |
| `permissions[]`（现仅占位）                 | `PluginCapability[]` + getService 门控 + PROTECTED_CAPABILITIES | 运行期权限**复用 plugin 模型**;runner 级工具权限可作其子集/扩展，不另立枚举 |
| 注释"未来沙箱/远程/MCP"                     | `sandbox-isolated-vm` + `signature` + `plugin-supervisor`       | 重型隔离/信任/生命周期**全在 plugin**                                       |
| `kind` / `roles` / `stages` / `missionType` | （无对应）                                                      | L3 产品语义,留在 capability                                                 |

### MECE 去重（现在就做,零风险）

`CapabilityManifest` **保持瘦**:`permissions` / `version` 的前瞻字段**注释为"未来映射到
PluginCapability / coreVersionRange,不在此另起一套"**,杜绝平行模型生长。不新增任何重型字段。

## 前置条件（plugin 当"不可信第三方 runner 宿主"前必须硬化）

诚实说明,plugin 现成熟于"一方平台扩展 SDK",尚未实战不可信第三方:

1. **强制签名**:`manifest-validator` 现为 `if (manifest.signature)` 可选校验——第三方须强制。
2. **真沙箱接 runner 执行**:`sandbox-isolated-vm` 真 isolated-vm 现为生产 exporter 注入/测试 mock,
   且服务于拦截式 plugin;需打通"沙箱内跑一个 capability runner"的执行路径。
3. **跑通一个第三方领域能力插件**:现 6 个全是一方基础设施,无第三方领域 runner 先例。

这些是公开市场的**触发条件**,非现在的工作项（YAGNI）。

## Consequences

- ✅ 消除 MECE 重复隐患:capability 不再生长成第二套 signing/sandbox/supervisor。
- ✅ 公开市场来时是"加适配器接 plugin",非"在 capability 里推倒重造"。
- ✅ 现状内部市场零改动、零风险。
- ⚠️ `CapabilityRegistry` 的"registry+port"通用机制现住 L3 `ai-app/marketplace`;若未来上升为
  平台级,可随 plugin-backed 适配器一并上提（本 ADR 不强制现在移动）。

## 不做什么

- ❌ 不把 capability 做成 plugin category（范畴错误）。
- ❌ 不在 capability 里实现签名/沙箱/supervisor。
- ❌ 现在不动 `ICapabilityRunner` 进程内实现、不动 plugin 框架。
