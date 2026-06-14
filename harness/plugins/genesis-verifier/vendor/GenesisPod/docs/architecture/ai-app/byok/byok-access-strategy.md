# BYOK 访问策略 + 命名说明（模型 / 工具 / 技能）

> 权威参考。来源：核对 `tool-key-resolver.service.ts`、`user-tools.service.ts`、
> `ai-model-config.service.ts`、`user-skills.service.ts`、`prisma/schema/models.prisma`
> 后整理（2026-06-08）。目的：把三类资源各自"谁付费、谁控制、默认是什么"讲清。

## TL;DR — 三类资源策略一览

| 资源                                                         | 是否有平台兜底                 | 控制机制                                      | 默认                               | 申请系统资源的授权类型 | "缺 Key" 时                              |
| ------------------------------------------------------------ | ------------------------------ | --------------------------------------------- | ---------------------------------- | ---------------------- | ---------------------------------------- |
| **LLM 模型**（chat / summary / embedding / image / rerank…） | **否**                         | **硬编码严格 BYOK**（无开关）                 | 严格——必须用户自配                 | `MODEL_GRANT`          | 直接报错，绝不回退 admin（带 userId 时） |
| **工具**（搜索/抓取 API：Tavily / Firecrawl / OpenAlex…）    | **是**                         | `User.toolKeyFallbackMode`（STRICT/FALLBACK） | **FALLBACK**（平台提供、开箱即用） | `TOOL_GRANT`           | FALLBACK→走平台 admin key；STRICT→报错   |
| **技能**（本地 prompt 能力，SKILL.md）                       | **不适用**（技能无自己的 key） | `SKILL_GRANT` 授权（无 BYOK 开关）            | 需申请授权                         | `SKILL_GRANT`          | 技能跑时借用户的模型 + 工具              |

**一句话**：模型永远严格 BYOK（无开关）；工具默认平台兜底（`toolKeyFallbackMode` 默认 FALLBACK）；技能是授权制（无 BYOK 开关，跑时复用模型/工具）。

## 各资源详解

### 1. LLM 模型 —— 无条件严格 BYOK

- 解析入口：`AiModelConfigService.pickBYOKModelForUser(modelType, userId)`。
- 顺序：`UserModelConfig`（个人 BYOK）→ `KeyAssignment`（已授权的系统模型，仍属 BYOK 范围）→ **null**。
- **带 userId 时绝不回退 admin AIModel**（2026-05-12 / 05-25 严格 BYOK 升级，用户政策「所有 AI 调用统一 BYOK，绝不用 admin」）。仅无 userId 的后台 cron 才允许 admin 兜底。
- **不读 `toolKeyFallbackMode`** —— 模型的严格性是写死的，没有"模型 FALLBACK 模式"。
- 想用系统模型 → 走 `MODEL_GRANT`（申请 + admin 批准）。

### 2. 工具 —— 默认平台兜底（`toolKeyFallbackMode` 开关）

- 解析入口：`ToolKeyResolverService.resolveToolKey(toolId, userId)`。
- 顺序：用户自有 key（user-scoped secrets，多 key + 熔断 failover）→ `TOOL_GRANT` 授权的 admin key → **`toolKeyFallbackMode` 决定是否兜底平台 admin key** → 失败。
  - `FALLBACK`：缺 key 自动走 admin 平台 key（admin 没配 → null → UI 显示「未配置 Key」）。
  - `STRICT`：抛 `NoToolKeyError`，不烧 admin 池。
- **默认 `@default(FALLBACK)`**（`User.toolKeyFallbackMode`）。新用户开箱即用；存量 STRICT 用户已于 2026-06-07（PR #209）迁移为 FALLBACK。
- UI 状态徽章（`/me/tools`）：`user`=自有 key、`granted`=被授权、`platform`=FALLBACK 平台兜底、`none`=「未配置 Key」。

### 3. 技能 —— 授权制（`SKILL_GRANT`）

- 状态来源：`UserSkillsService` 读 `AuthorizationGrant` / `AuthorizationRequest` 里 `type=SKILL_GRANT` 的记录。
- 技能是**本地 prompt 能力**（SKILL.md 正文），**没有自己的 API key**。运行时它调用：用户的 **BYOK 模型**（严格）+ 它用到的**工具**（受 `toolKeyFallbackMode` 控制）。
- 所以"技能的 BYOK"= 授权（申请使用某系统技能，admin 批准），**没有 STRICT/FALLBACK 开关**。

## 命名说明

- **`toolKeyFallbackMode`**（原 `byokMode`，2026-06-08 PR #210 改名）：只控制**工具** key 的平台兜底。原名 `byokMode` 名不副实——字面像"管所有 BYOK"，实则不碰模型/技能。
- 三个授权类型命名清晰：`MODEL_GRANT` / `TOOL_GRANT` / `SKILL_GRANT`。
- 历史遗留的内部不一致（注释曾写"默认 STRICT"、模型 apiKeyId 误标"按 byokMode 决定"）已随改名一并订正。

## 开放问题

- 模型是否也要一个"平台计量兜底"模式（对齐 monetization 设计里的「计量版 SYSTEM key」，反转 2026-05-05 strict-BYOK）？见 [monetization/subscription-byok-credit-system-design.md](../../monetization/subscription-byok-credit-system-design.md)。若启用，模型才会有类似工具的 FALLBACK 概念；目前模型无此开关。
