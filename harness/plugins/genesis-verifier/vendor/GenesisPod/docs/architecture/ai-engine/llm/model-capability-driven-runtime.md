# 模型能力驱动运行时 —— v3.1 架构重构提案

> **状态**:**v3.1 架构重构提案**(2026-05-24 锁定;不是"几天清掉的施工单",启动需先做阶段 0)
> **演进**:v1 未读现状被 4 路评审揭 24 项 blocker → v2 补丁式整合被否决 → v3 5 路独立调研 + 6 项决议 → **v3.1 解决外部评审 4 条 blocker**(蓝图/现状混淆 · self-heal SSOT 分叉 · D6 工时低估 · 全量工时偏激进)
> **触发事件**:线上 mission 撞 `deepseek-v4-pro: response_format type is unavailable` 一上来死;追溯发现 `ai-api-caller.service.ts:371` `modelLower.includes("deepseek-reasoner")` 的 substring 判能力散布整个 engine + harness + ai-app(40+ 处)。
> **范围**:`modules/ai-engine/llm/**` + `modules/ai-harness/runner/**` + `modules/ai-harness/agents/**` + `modules/ai-app/**/services/**`(controllers/DTO 豁免)。
> **设计原则**:能力是数据(DB+JSONB)不是代码;catalog 数据驱动;自愈 SSOT(Redis 只计数,DB 唯一权威);ESLint AST + jest baseline 双层看护;事实驱动,反惯性。
> **当下问题止血**(不阻塞重构,平行做):你立即把可用模型设为默认 CHAT(`/me/ai?tab=models`);已推 #66-#73 failover 链已修 ~80% 场景;deepseek-v4-pro 的 `response_format` 问题等 A 阶段(W3)上线后自动解决。

---

## 0 · v3 决议记录(用户确认)

经多路评审 + 专业建议,以下 6 项设计选择已**用户拍板**作为 v3 基线的不可妥协决议。后文 §3-§6 任何细节与本节冲突以本节为准。

|   #    | 决议                                                                                                                                                                                         | 替代方案                                       | 关键理由                                                                                                                 |
| :----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **D1** | 新增 capability 用 **`capability_overrides JSONB` 列**;既有 19 列(`isReasoning/apiFormat/...`)**保留**                                                                                       | 全部分列 / 全部 JSONB 重构                     | capability 是读取后立即用,不按 capability 查;JSONB 零迁移加字段,与既有列共存                                             |
| **D2** | **第一期只做 `capability_overrides` JSONB**;observation 表(append-only 用户失败统计)**列入 backlog**                                                                                         | 双表(override + observation)                   | 当前无 admin 用户失败统计 UI,observation 表零消费方;**约束保留**:自愈逻辑只允许写 JSONB,禁止写 19 列                     |
| **D3** | catalog 字段命名 **`provider` + `modelPattern`**(对齐 `AIModelConfig.provider` 现状)                                                                                                         | `providerSlug`                                 | 不制造新双源,与既有命名对齐                                                                                              |
| **D4** | catalog 强制字段:**`rationale ≥30 字 + addedBy 必填(git author 自动) + sourceUrl 选填`**                                                                                                     | 仅 ≥10 字                                      | 30 字强制写"为什么 + API 依据";sourceUrl 选填避免逼造假                                                                  |
| **D5** | 治理范围**扩 ai-app/services**(豁免 controllers/DTO)                                                                                                                                         | 仅 ai-engine + ai-harness                      | ai-app 已有 3 处外溢(`m.provider === "xai"` 等);不扩 = 看护无效                                                          |
| **D6** | 老 5 个 structured-output bool 字段(`supports_json_schema_strict/json_schema/tool_use/json_mode/gbnf_grammar`)**F 后直接 drop**(~8h dev + 2 周观察),含 admin endpoint/UI/spec/migration 收口 | 6 周双写 / 3-6 月 deprecation                  | **T1 实证**:运行时 router 只读 `structured_output_strategy`,这 5 个 bool **是死代码**,无双写必要;v3.1 工时上调含全收口面 |
| **D7** | **self-heal SSOT(Y 方案)**:Redis 仅做阈值计数 + Postgres advisory lock,**`capability_overrides JSONB` 是唯一权威 overlay**;A 阶段**无自愈**(只读 capability),B 阶段才上自愈写入              | X 方案(Redis 当权威 overlay)/ Z 方案(A+B 合并) | SSOT 是非妥协的工程纪律,Redis 不该承载权威值;A 单独上线不修当下 mission 死(并行用已推 #66-#73 止血)比"双源永远漂移"好    |

---

## 1 · 现状审计(事实底座 · T1 完整输出)

### 1.1 `AIModelConfig` 双源

| 定义     | 文件:行                                 | 字段范围                                                                                                                                                                            |
| -------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1(子集) | `ai-chat-model-config.service.ts:11-37` | 12 个基础字段,**缺**全部 structured-output 字段                                                                                                                                     |
| #2(超集) | `ai-model-config.service.ts:55-92`      | #1 字段 + **`structuredOutputStrategy / fallbackStrategies / supportsJsonSchemaStrict / supportsJsonSchema / supportsToolUse / supportsJsonMode / supportsGbnfGrammar`** 7 个新字段 |

**两 service 各持一份 ModelConfigCache**;`token_param_name` 的 VARCHAR 长度也已漂移(30 vs 50)。

### 1.2 19 现有 capability 字段全集(读写映射)

| 字段                       | DB 列                         | 写入端                                                               | 读取端(关键)                                                                                                                  |
| -------------------------- | ----------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `isReasoning`              | `is_reasoning`                | admin.service.ts:632,738 / user-models-auto-configure.service.ts:547 | model-fallback / model-resolver / runtime-environment / writing-_ / leader-_ / observability / task-profile-mapper(15+ files) |
| `apiFormat`                | `api_format`                  | admin / auto-configure                                               | ai-api-caller / key-resolver / connection-test                                                                                |
| `supportsTemperature`      | `supports_temperature`        | admin / auto-configure                                               | task-profile-mapper / ai-api-caller                                                                                           |
| `supportsStreaming`        | `supports_streaming`          | admin / auto-configure                                               | ai-chat.service(chatStream 路径)                                                                                              |
| `supportsFunctionCalling`  | `supports_function_calling`   | admin / auto-configure                                               | tool-routing / agent-executor                                                                                                 |
| `supportsVision`           | `supports_vision`             | admin / auto-configure                                               | runtime-environment                                                                                                           |
| `tokenParamName`           | `token_param_name`            | admin / auto-configure                                               | ai-api-caller                                                                                                                 |
| `defaultTimeoutMs`         | `default_timeout_ms`          | admin                                                                | ai-chat-failover-caller                                                                                                       |
| `priority`                 | `priority`                    | admin                                                                | model-fallback / election                                                                                                     |
| `costTier`                 | `cost_tier`                   | seed(无 admin endpoint)                                              | billing-adapter / runtime-environment                                                                                         |
| `rpmLimit`                 | `rpm_limit`                   | admin / user-model-configs                                           | rate-limiting                                                                                                                 |
| `tpmLimit`                 | `tpm_limit`                   | admin / user-model-configs                                           | rate-limiting                                                                                                                 |
| `structuredOutputStrategy` | `structured_output_strategy`  | admin.service.ts:692                                                 | structured-output-router.service.ts:189                                                                                       |
| `fallbackStrategies`       | `fallback_strategies`         | admin.service.ts:693                                                 | structured-output-router.service.ts:192                                                                                       |
| `supportsJsonSchemaStrict` | `supports_json_schema_strict` | admin.service.ts:694                                                 | **🔴 无运行时读者**(D6 死代码证据)                                                                                            |
| `supportsJsonSchema`       | `supports_json_schema`        | admin.service.ts:695                                                 | **🔴 同上**                                                                                                                   |
| `supportsToolUse`          | `supports_tool_use`           | admin.service.ts:696                                                 | **🔴 同上**                                                                                                                   |
| `supportsJsonMode`         | `supports_json_mode`          | admin.service.ts:697                                                 | **🔴 同上**                                                                                                                   |
| `supportsGbnfGrammar`      | `supports_gbnf_grammar`       | admin.service.ts:698                                                 | **🔴 同上**                                                                                                                   |

**UserModelConfig 表缺**:`structuredOutputStrategy/fallbackStrategies/supportsJsonSchema*/supportsToolUse/supportsJsonMode/supportsGbnfGrammar` + `costTier`(7 字段)。BYOK 用户无能力配 structured output。

### 1.3 ~29 处伪 catalog 全集(决定行为)

| 文件:行                                                                                                 | 数据结构                                                                                                                  | 决定什么                         |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------- | ------------------ |
| `structured-output/structured-output-router.service.ts:48-135`                                          | `PROVIDER_DEFAULT_CHAINS` **17 条 + 1 条 FINAL_FALLBACK** `match:(p,m)=>regex`(v3.1 阶段 0 spec 校准;v3 原写 14 为旧数据) | structured-output strategy chain |
| `selection/model-fallback.service.ts:123-141`                                                           | `DEFAULT_REASONING_MODEL_PRIORITY` 11 条 RegExp                                                                           | reasoning fallback 优先级        |
| `selection/model-fallback.service.ts:146-152`                                                           | `DEFAULT_FAST_MODEL_PRIORITY` 5 条 RegExp                                                                                 | fast fallback 优先级             |
| `selection/default-recommendations.config.ts:57-`                                                       | `PROVIDER_PREFERENCE_BY_TYPE` / `EXCLUDED_MODEL_SUBSTRINGS` / `DEFAULT_RECOMMENDATIONS`                                   | auto-configure 推荐表            |
| `types/model.utils.ts:14-40`                                                                            | `inferIsReasoning` 函数 17 行 includes 链                                                                                 | isReasoning 兜底推断             |
| `types/task-profile.types.ts`                                                                           | `MODEL_KNOWN_LIMITS`                                                                                                      | maxTokens 已知上限               |
| `services/ai-model-discovery.service.ts:35-77`                                                          | `formatModelDisplayName / getEnvVarNameForProvider`                                                                       | display 名 + env var 名          |
| `services/ai-direct-key.service.ts:507-524`                                                             | `getRequiredApiKeyName` @deprecated                                                                                       | env var(死代码未删)              |
| `services/ai-chat.service.ts:493-501`                                                                   | `getApiFormatForProvider` 4 段 `provider===`                                                                              | api format 推断                  |
| `services/ai-model-config.service.ts:1339-1383`                                                         | `getIconUrl` 9 段 `lowerName.includes`                                                                                    | icon URL + **种子 capability**   |
| `services/ai-api-caller.service.ts:552-586`                                                             | `getDefaultEndpoint / inferProvider`                                                                                      | endpoint + provider 推断         |
| `adapters/function-calling-llm.adapter.ts:552-616`                                                      | 3 个 `lower.includes` 函数                                                                                                | 同 ai-api-caller(**双源**)       |
| `adapters/universal-llm.adapter.ts:243-256`                                                             | `supportsModel`                                                                                                           | 是否支持该模型(准入)             |
| `user-config/user-models-auto-configure.service.ts:425-549`                                             | `inferMaxTokens / inferCapabilities / inferProviderDefaults`                                                              | BYOK 加模型时启发式默认          |
| `services/ai-connection-test.service.ts:141-167+338`                                                    | switch + includes                                                                                                         | 连接测试路由                     |
| `ai-app/image/generation/image-generation.service.ts:300,372,397,902`                                   | `provider.includes("gemini")                                                                                              |                                  | modelId.includes("imagen")` | 图像 provider 路由 |
| `ai-harness/runner/executor/agent-executor.service.ts:377-382`                                          | `isLargeModel` inline                                                                                                     | defaultMaxTokens                 |
| `ai-app/teams/services/ai/ai-response.service.ts:1222-1225`                                             | `isLargeModel` inline                                                                                                     | outputLength                     |
| `ai-app/insight/services/data/data-source-fetcher.service.ts:829`、`data-source-router.service.ts:2038` | `m.provider === "xai"`                                                                                                    | 数据源过滤                       |
| `open-api/admin/quota/quota.service.ts:221-231`                                                         | 11 段 `lower.includes`                                                                                                    | provider 名归一                  |

### 1.4 5 处函数双源(完全相同代码各自维护)

1. **`inferProvider`**:`ai-api-caller.service.ts:574-586` ⇔ `function-calling-llm.adapter.ts:574-586`(完全同步)
2. **`getDefaultEndpoint`**:同两文件
3. **`getRequiredApiKeyName / getEnvVarNameForProvider`**:`ai-chat.service.ts:507` @deprecated + `ai-direct-key.service.ts:507` @deprecated + `ai-model-discovery.service.ts:63` active —— **3 份**
4. **`MODEL_KNOWN_LIMITS` 与 `inferMaxTokens`**:两套独立 max tokens 推断
5. **`formatModelDisplayName` 与 `buildDisplayName`**:两份独立 provider→display 映射

### 1.5 现有 self-heal 机制(0 个涉及 capability)

| 机制                 | 位置                                                        | 范围                       |
| -------------------- | ----------------------------------------------------------- | -------------------------- |
| per-key failover     | `ai-chat-failover-caller.service.ts`                        | 401/429/quota 换 key       |
| 同 key 重试          | `ai-chat-retry.service.ts`(MAX_RETRIES=3)                   | 5xx 指数退避               |
| 模型级 failover      | `ai-harness/runner/loop/model-failover.util.ts` + 3 个 loop | 换 modelId                 |
| modelType 降级       | `selection/model-policy.ts:53-89`                           | quality-first / cost-first |
| 模型黑名单           | `selection/model-fallback.service.ts:166`                   | 临时拉黑                   |
| structured-output 链 | `router.service.ts:178-220`                                 | strategy chain 降级        |
| circuit breaker      | `model-resolver.service.ts:154-170`                         | 按健康度选                 |

**"capability 自愈"现成机制 = 无**。capability 失配(标志说支持但实际不)无任何机制重学习。本 v3 整套自愈子系统是**从零建**。

### 1.6 BYOK / admin 物理边界(已干净)

`prisma.aIModel.create/update/delete` 全部 8 处都在 `open-api/admin/admin.service.ts`(596/615/742/825/830/861/2225/2231),controller 在 `admin.controller.ts`(`@Post/@Patch/@Delete ai-models...`)。**BYOK 用户无端点写 AIModel**——物理隔离已存在。

### 1.7 现有看护机制(0 个覆盖 modelId 反模式)

- ESLint(`backend/.eslintrc.js`):no-restricted-imports 多处(facade 边界),**无 modelId substring 反模式规则**
- 14 个 `__tests__/architecture/*.spec.ts` contract spec:layer-boundaries / model-policy-funnel / 等,**无 modelId substring 覆盖**
- `.husky/pre-push` 279 行:god-class size guard + 架构边界 jest + 类型检查 + 变更测试 + UI/i18n,**无模型反模式专项**

### 1.8 反模式命中总数

- `model.includes(provider/family)` 决定运行时:**~22 处**(engine 18 + harness 2 + ai-app 4)
- `provider === "X"` 决定行为:**~10 处**(engine 7 + ai-app 3)
- @deprecated 但未删:**3 处**(`getRequiredApiKeyName` 2 份 + 同名第 3 份 active)
- **合计 ~35 处 P0 + 5 处 P1 + ~10 处 P2**(P2 = UI 装饰 / tier 正则保留)

---

## 2 · 问题陈述与案例研究

### 2.1 案例 · `deepseek-v4-pro` 三维正交活样本

2026-05-24 用户实跑 `deepseek-v4-pro` 一上来死。DeepSeek 官方信息:

| 模型                                 | `isReasoning`(吃 reasoning tokens) | `thinkingMode` |           `responseFormatSupport`           |
| ------------------------------------ | :--------------------------------: | :------------: | :-----------------------------------------: |
| `deepseek-chat`(= V4-Flash 非思考)   |                 ❌                 |      none      |                `json_object`                |
| `deepseek-reasoner`(= V4-Flash 思考) |                 ✅                 |     always     |    **none**(thinking 拒 response_format)    |
| `deepseek-v4-pro`                    |                 ✅                 |    optional    | **json_object**(API 现状不支持 json_schema) |
| `deepseek-v4-flash`                  |               视模式               |    optional    |                `json_object`                |

**对老代码的否定**:

```ts
const isDeepseekReasoner = modelLower.includes("deepseek-reasoner");
//   1. v4-pro 不含 reasoner → 判 false → 发 json_schema → 撞拒
//   2. v4-pro 实际是推理模型(isReasoning=true)→ 老逻辑漏判 reasoning_tokens 预算
//   3. v4-pro 即使非 thinking 也不支持 json_schema → API 整体未支持
```

**三条结论里没有任何一条能从模型名"猜"出来**——能力是模型 + provider API 的复合属性,**完全正交**,不能用一个布尔 substring 判。

### 2.2 5 项危害(危害矩阵)

|  #  | 危害                                      | 实证                                                      |
| :-: | ----------------------------------------- | --------------------------------------------------------- |
|  1  | 能力假设错配 → INVALID_REQUEST 一上来判废 | 2026-05-24 实跑:deepseek-v4-pro 发 json_schema 被拒       |
|  2  | 新模型/新版本静默漏判                     | 代码自承"硬编码漏 o4 系列问题";gemini-3 / claude-5 又得补 |
|  3  | 改一个能力要 grep 全仓                    | "deepseek 不支持 X" 改 N 处 includes                      |
|  4  | 能力定义没有单一权威                      | router / api-caller / tier types 三份漂移(T1 §1.4 实证)   |
|  5  | 看护机制缺失                              | 谁都能写 `includes("xai")`,无 lint/test 拦(T1 §1.7)       |

---

## 3 · 数据模型设计

### 3.1 双源消灭(A0 阶段)

**目标态**:`AIModelConfig` 单一来源 + 单一缓存。

**步骤**:

1. 提取 `interface AIModelConfig` 到 `ai-engine/llm/types/model-config.types.ts`,**唯一来源**
2. `ai-model-config.service.ts` 改 `import { AIModelConfig } from "../types/model-config.types"`
3. `ai-chat-model-config.service.ts` 整文件标 `@deprecated`,内部 re-export 兼容防 import 断
4. ripgrep `from.*ai-chat-model-config` 找消费方(~25 处)逐一改成 `AiModelConfigService`
5. 兼容期 1 sprint:让老 service **委托新 service**,不自维护缓存
6. 删空壳文件

**工时**:接口提取 + import 改写 4-6h;消费方迁移 6-10h;**总 12h**。

**回滚**:每步独立 PR,可单步 revert。

### 3.2 capability 字段集(enum 主导)

**核心原则**:enum 优先,bool 仅用于真二态。

**v3 字段表**:

| 字段名(JSONB 内嵌套路径)         | 类型                                                                                                                              | 决定                                                              | 替代                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `structuredOutput.nativeMode`    | enum `'json_schema_strict' \| 'json_schema' \| 'json_mode' \| 'gemini_response_schema' \| 'tool_use' \| 'gbnf_grammar' \| 'none'` | request 体里写哪种 response_format                                | **替代死代码 5 bool**(D6)                                                                                          |
| `structuredOutput.fallbackChain` | enum[]                                                                                                                            | 首选失败按序降级                                                  | 替 `fallbackStrategies`                                                                                            |
| `toolUse.mode`                   | enum `'openai_functions' \| 'anthropic_tools' \| 'gemini_function_calling' \| 'none'`                                             | 工具调用 protocol(三家协议不同)                                   | 替 `supportsFunctionCalling`(老 bool 不区分协议)                                                                   |
| `toolUse.parallelCalls`          | bool                                                                                                                              | 单回合多 tool_call 并发                                           | 新增                                                                                                               |
| `reasoning.kind`                 | enum `'none' \| 'reasoning_effort' \| 'thinking_budget' \| 'extended_thinking' \| 'opaque'`                                       | 是否注 reasoning_effort / thinking.budget_tokens / thinkingConfig | 与既有 `isReasoning` 列**正交**(D1 保留既有列);本字段决定"如何注",isReasoning 仍决定"是否吃 reasoning_tokens 预算" |
| `temperature.support`            | enum `'full' \| 'fixed_1.0' \| 'none'`                                                                                            | full / fixed_1.0(o1 行为) / none                                  | 替既有 `supportsTemperature` bool(老 bool 无法表达 fixed_1.0)                                                      |
| `tokenParam`                     | enum `'max_tokens' \| 'max_completion_tokens' \| 'max_output_tokens' \| 'maxOutputTokens'`                                        | request body token 上限 key 名                                    | 替既有 `tokenParamName` string(防笔误,gemini camelCase 易写错)                                                     |
| `vision.support`                 | enum `'none' \| 'image_url' \| 'base64_only' \| 'native_multimodal'`                                                              | 图片接受方式                                                      | 替既有 `supportsVision` bool                                                                                       |
| `streaming.support`              | bool                                                                                                                              | SSE 流支持                                                        | 保留既有 `supportsStreaming`                                                                                       |
| `context.maxInputTokens`         | int                                                                                                                               | prompt 上限                                                       | 扩展既有 `maxInputTokens`                                                                                          |
| `context.maxOutputTokens`        | int                                                                                                                               | completion 上限                                                   | 复用 `maxTokens`                                                                                                   |
| `systemPrompt.placement`         | enum `'messages_array' \| 'top_level_system_field' \| 'first_user_concat'`                                                        | system 放哪儿                                                     | 新增(消除散落在 caller 的 if-else)                                                                                 |
| `promptCache.support`            | enum `'none' \| 'anthropic_cache_control' \| 'openai_prompt_cache' \| 'gemini_cached_content'`                                    | prompt cache 协议                                                 | 新增(nice-to-have)                                                                                                 |
| `reasoning.exposeContent`        | enum `'none' \| 'thinking_block' \| 'reasoning_field'`                                                                            | 响应是否暴露推理过程                                              | 新增(UI 透出)                                                                                                      |

**显式 drop**(D6):`supportsJsonSchemaStrict / supportsJsonSchema / supportsJsonMode / supportsToolUse / supportsGbnfGrammar` 5 个 bool —— T1 实证零运行时读者,直接删,不双写。

### 3.3 `capability_overrides` JSONB 列(D1)

**Schema**:

```typescript
// AIModel.capability_overrides JSONB (nullable, default null)
// UserModelConfig.capability_overrides JSONB (nullable, default null)
{
  // 任何上面 3.2 表的字段都可在这里覆盖
  structuredOutput?: { nativeMode?: ..., fallbackChain?: [...] },
  toolUse?: { mode?: ..., parallelCalls?: ... },
  reasoning?: { kind?: ..., exposeContent?: ... },
  temperature?: { support?: ... },
  // ...
  // 自愈写入额外字段:
  __meta?: {
    autoDowngraded: boolean,
    selfHealedAt: timestamp,
    selfHealedReason: string,  // short code, 非 raw msg
  }
}
```

**Zod schema 强校验**:写入侧用 `ModelCapabilityOverridesSchema.parse()` 必须通过,防 JSONB 内字段拼写错。

### 3.4 capability 解析优先级(5 级)+ SSOT 边界(D7)

```
resolveCapabilities(modelId, userId) → ModelCapabilities

1. UserModelConfig.capability_overrides (BYOK 用户显式 OR 用户 self-heal 写入 · B 阶段才生效)
2. AIModel.capability_overrides         (admin 显式 override · AuditLog 必写)
3. AIModel 19 既有列 + AiChat-derived  (温度/maxTokens/isReasoning 等,既有形态)
4. ProviderCapabilityDefaults          (代码常量,从 router PROVIDER_DEFAULT_CHAINS 收编)
5. ApiFormatDefaults + HardFallback    (`responseFormatSupport='none'` 全安全兜底)
```

**SSOT 边界(D7 关键)**:**Postgres `capability_overrides JSONB` 是唯一权威 overlay**,Redis **不在优先级链内**——Redis 仅承担:

- **阈值计数器**(同 scopeKey/field/fromValue 3 次/10min 才允许写 DB,见 §4.4)
- **Postgres advisory lock 协调键**(防并发降级写竞态)
- **L1 缓存读穿透补位**(可选,5min TTL,失效靠事件,Postgres 行变更是真值)

**禁止反模式**:Redis 当 capability 权威 / Redis overlay 与 DB 双源并存 / A 阶段写 Redis 当权威(全部 SSOT 违规)。**A 阶段无 self-heal 写入**(只读 capability 链);**B 阶段才开自愈写 JSONB**——这是 D7 的核心,与 §6.1 阶段表必须一致。

**缓存**:

- L1 内存 Map `<scopeKey, ModelCapabilities>` TTL 5min(复用既有 `MODEL_CONFIG_CACHE_TTL`)
- `scopeKey = sha256(provider | modelId | normalize(endpoint))`(T3 设计,跨租户不串)
- 用户层 key `<userId:scopeKey>` 防 PERSONAL/ASSIGNED 串读

**失效**:

- admin 编辑 → `model.capability.changed` 事件 → 各 instance 清本地 key
- 用户编辑 → 同上(只清该 user)
- 5min TTL 自然失效兜底

### 3.5 与 StructuredOutputRouter 收敛(单源)

**选 A:router 改派生视图**,删 router 内 `PROVIDER_DEFAULT_CHAINS` 17 条(+ FINAL_FALLBACK)。

```typescript
class StructuredOutputRouter {
  // 删 resolveChain(model) —— 不再做策略推断
  getAdaptersForChain(chain: readonly Strategy[]): IStructuredOutputAdapter[];
  getAdapter(strategy: Strategy): IStructuredOutputAdapter;
}

class ModelCapabilityService {
  resolveCapabilities(modelId, userId?): Promise<ModelCapabilities>;
  deriveStructuredOutputChain(caps): readonly Strategy[]
    = [caps.structuredOutput.nativeMode, ...caps.structuredOutput.fallbackChain, 'prompt'];
}
```

**provider 启发式**:17 条 `PROVIDER_DEFAULT_CHAINS` + FINAL_FALLBACK 搬到 `ModelCapabilityService` 内的 `ProviderCapabilityDefaults`(作为 §3.4 优先级 #4 的代码常量兜底),**不删能力,换归属**。

### 3.6 `ModelCapabilities` 不出 facade

边界声明:`ModelCapabilities` 类型仅在 `ai-engine/llm/capability/**` + `ai-engine/llm/services/**` 可见。**不**经 `ai-harness/facade` 导出。ai-app 调 `AiChatService.chat()` 是黑盒,不读 caps。若需"推荐 model",在 engine 内增决策接口而非暴露 caps —— 防 ai-app 再生 `if (caps.toolUse.mode === 'parallel')` 散点。

---

## 4 · 安全架构(基于 T3)

### 4.1 10 项威胁模型

|  #  | 攻击者                               | 攻击路径                                                                                | 影响                       | v3 防御                   |
| :-: | ------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------- | ------------------------- |
|  1  | 恶意 BYOK proxy(自建 LiteLLM/Ollama) | err body 写 "unsupported" → 自愈降级 → 钉死全平台                                       | 跨租户全平台退化           | §4.2 scope 隔离           |
|  2  | 普通用户调 admin 端点                | curl `PATCH /admin/ai/models/:id/capabilities` 漏 RolesGuard                            | 任意用户改全局             | §4.5 鉴权                 |
|  3  | 自愈级联跑飞                         | 偶发 5xx → 误判 capability → 一路降到 none → 无复原                                     | 模型变 plain text 永不回复 | §4.6 复原通道             |
|  4  | 200 OK deprecation 误判              | 响应里 "may be deprecated" warning → 关键字匹配吃掉                                     | 正常调用就降级             | §4.3 错误信号严格化       |
|  5  | catalog 投毒 PR                      | `match: {provider: ".*"}` 兜底 → 全平台同时丢能力                                       | 全平台单点失能             | §4.7 投毒防御             |
|  6  | err.message 日志泄露                 | provider 把 prompt/key 尾回填进 error → 日志聚合 → 反推隐私                             | PII / key 泄露             | §4.8 脱敏                 |
|  7  | 并发降级写竞态                       | 同 modelId 5 并发 4xx → 各 worker "读-比较-写" → audit 5 条重复                         | 状态错乱                   | §4.4 advisory lock        |
|  8  | admin override 秒覆盖                | admin 改 `true` → 5 秒内自愈降回 `false`                                                | admin 失去话语权           | §4.4 24h cooling-off      |
|  9  | 凭据/endpoint 变更后旧 caps 残留     | 用户换 key,老降级仍生效                                                                 | "换 key 没用"              | §4.6 反向探测             |
| 10  | 跨 provider 误降级                   | 用户走 OpenRouter 的 gpt-4o 失败 → 降级写到 system gpt-4o 行 → 影响走官方 OpenAI 的用户 | 跨 endpoint 污染           | §4.2 scopeKey 含 endpoint |

### 4.2 Scope 隔离矩阵

**核心原则**:写入 scope **严格等于** (userId, endpoint, model) 三元组;**永不向上越级**。

| 触发源(resolved.source)                                             | 允许写入                                                         | 禁止写入                     | 理由                                                                                              |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| **PERSONAL**(UserModelConfig + 用户 endpoint)                       | `UserModelConfig.capability_overrides`(D2 JSONB 字段,**仅本行**) | `AIModel.*` / 其它 user 行   | 用户自配 proxy 的行为只能影响自己                                                                 |
| **PERSONAL** + system AIModel(用户用 personal key 跑 admin modelId) | `UserModelConfig.capability_overrides`(创建 BYOK 行)             | `AIModel.*` 任何全局表       | endpoint 是用户的,不能改全局                                                                      |
| **ASSIGNED** / **SYSTEM**(admin endpoint)                           | **不允许自愈写入**(D2 第一期不做 observation 表)                 | `AIModel.supports*`          | admin endpoint 失败 = admin 排查,自愈不擅自改全局;**未来加 observation 表后**:只 INSERT 不 UPDATE |
| **admin override 路径**                                             | `AIModel.capability_overrides`(D2 唯一可改全局表路径)            | `UserModelConfig` 任何用户行 | admin 不跨进用户私有配置                                                                          |

**实现**:

- `scopeKey = sha256(provider | modelId | normalize(endpoint))`
- `updateCapabilities(scope: 'admin-override' \| 'self-heal-user', ...)` 参数化;scope='admin-override' 需 admin guard;scope='self-heal-user' 拒绝跨用户写
- 自愈逻辑的 service 入口物理上**只能**写 JSONB 字段,**不能**触及 19 列(代码 + lint 双重禁)

### 4.3 错误信号 4 重严格化(必须全满足才触发降级)

1. **HTTP status 白名单**:仅 400/422。**绝不**:429/5xx/401/403(quota/服务端/鉴权)
2. **error code 白名单**(按 apiFormat 分):
   - openai: `invalid_request_error` + `param ∈ {response_format, tools, tool_choice, functions}`
   - anthropic: `invalid_request_error` + path 含 `response_format` 或 `tool_use`
   - google: `INVALID_ARGUMENT` + `field_violations` 指向 `responseSchema` / `tools`
3. **响应位置严格**:**仅** 4xx 响应体 error 对象。**禁止**扫描:
   - 200 OK 响应里的 warning/notice
   - error.message 自由文本里的 substring(防关键字钓鱼)
4. **反向校验(request-response 一致)**:request **实际发了** `response_format:{type:"json_schema"}`,err 才能映射到 `nativeMode='json_schema'→json_object`。如果只发了 `json_object`,err 最多映射到 `none`,**绝不**反推上层能力。

**降级阶梯固化**(单调):`json_schema_strict → json_schema → json_object → tool_use → none`。禁止跨级跳。

### 4.4 阈值 + 去抖 + 锁

- **单次抖动绝不落 DB**:同 `(scopeKey, field, fromValue)` 三元组 **失败信号 N=3 次 / M=10 分钟** 内才提交
- **计数器**:Redis `INCR` + `EXPIRE M`,key = `cap-downgrade:{scopeKey}:{field}:{fromValue}`
- **Redis 不可用**:降级为只记日志,**绝不写 DB**(fail-closed)
- **并发竞态**:Postgres `pg_try_advisory_xact_lock(hash(scopeKey, field))` 防双写;拿不到锁等下次累计
- **admin 冷静期(cooling-off)**:任何 capability 字段被 admin 显式 PATCH 后,**24h** 内同 (scopeKey, field) 自愈写入**强制禁用**(继续计数但不提交);实现:override 表加 `overrideAt`,自愈写前 `SELECT WHERE overrideAt > NOW() - 24h` 命中即跳过 + 记 `cap.heal.skipped_by_cooling_off`

### 4.5 鉴权 + AuditLog

| 路径                                       | Guard 链                                                                             | 允许 actor                           | 写入                                           | AuditLog 字段                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `PATCH /admin/ai-models/:id/capabilities`  | `JwtAuthGuard + RolesGuard + @Roles('admin')`                                        | admin                                | `AIModel.capability_overrides`                 | `(id, actor, actorRole, scope='global', targetId, field, before, after, reason必填, ipAddress, userAgent, at)` |
| `PATCH /me/model-configs/:id/capabilities` | `JwtAuthGuard + @CurrentUser` + ownership 校验(`existing.userId === currentUser.id`) | user 本人                            | `UserModelConfig.capability_overrides`(仅本行) | `(actor=user.id, scope='user-config', ...)`                                                                    |
| 自愈写回(user scope)                       | 内部 service,无 HTTP                                                                 | `actor='system'`,附 `triggerEventId` | `UserModelConfig.capability_overrides.__meta`  | `(actor='system', triggerRequestId, scopeKey, field, before, after, reason='auto-heal', observationCount, at)` |
| 自愈写回(admin scope)                      | **D2 第一期禁止**                                                                    | —                                    | —                                              | —                                                                                                              |
| admin 批量 reset                           | `JwtAuthGuard + RolesGuard + @Roles('admin')`                                        | admin                                | DELETE 命中行                                  | 每行单独 audit                                                                                                 |

所有 audit 用既有 `AuditLogService`,与业务**同事务**(避免业务成功 audit 失败的不一致)。audit 行不可删不可改(DB trigger 拒 UPDATE/DELETE)。

### 4.6 复原 3 通道(防 false-neg 卡死)

1. **后台反向探测**(probe daemon)
   - 周期:每条 `capability_overrides.__meta.autoDowngraded=true` 行每 6h 探测一次;首次 = `triggeredAt + 6h`
   - 探测形态:最小有效 payload(如 json_schema 探测 `{"type":"object","properties":{"ok":{"type":"boolean"}}}` + system="reply {ok:true}",max_tokens=10)
   - 成功 → 删除 override 字段 + audit `actor=system-probe, action=reset, reason=probe-recovered`
   - 失败 → 推迟下次到 `now + min(2^attempts × 6h, 7d)`,避免对坏 endpoint 持续打扰
   - 探测**不计入** failure 阈值(标记 `isProbe=true`)

2. **admin 一键 reset**
   - `POST /admin/ai/capability-overrides/reset` 支持 `{scope:'all'|'user', userId?, modelId?}`

3. **catalog 升级触发批量 reset**
   - capability catalog 文件有 `version` 字段
   - 启动时检测 version 增长,自动 migration:DELETE 所有 `__meta.actor='self-heal'` 的 override(保留 admin 显式 override)

**闭环**:复原后需重新走阈值才会再降级 → 单次 false-positive 永不卡死。

### 4.7 catalog 投毒防御(D4 强制)

- **CODEOWNERS**:`backend/src/modules/ai-engine/llm/capability/catalog/* @architect-team @ai-platform-leads` ≥2 reviewer required
- **jest 形状测试**(`capability-catalog.spec.ts`):
  - 禁止过宽:`expect(rule.match.provider).not.toBeOneOf(['', null, '*', '.*'])`、`expect(Object.keys(rule.match).length).toBeGreaterThanOrEqual(2)` 单条件不允许
  - `modelPattern` 长度 ≥3(防 `/a/i` 这种)
  - **强制字段**(D4):`rationale.length ≥ 30` + `addedBy` 必填(git author email)+ `addedAt` ISO date 必填 + `sourceUrl` 选填
  - 单条 rule 影响面 ≤ 20 个 AIModel 行(启动时用 DB count 模拟)
- **lint 禁动态 import**:catalog 数据只允许静态 `import`,禁 `require()`
- CI 阶段:catalog diff 触发 `review-required` label,无法 self-merge

### 4.8 脱敏 + 可观测

**错误消息脱敏**(classifier 入口集中实现一次):

- 正则剥离 `sk-* / ya29.* / 任何 ≥20 长度 base64-like` → `[REDACTED-KEY]`
- 剥离 email / IPv4 / phone → `[REDACTED-PII]`
- 剥离引号包裹 prompt 片段(`"..."` 长度 > 50) → `[REDACTED-PROMPT]`
- 截断 max 200 字符
- **`originalMessage` 不存 DB**,只 in-memory 决策用;DB 落 `sanitizedReason`

**Prometheus 指标**:

- `cap_heal_trigger_total{provider, model, scope, field, fromValue, toValue}`
- `cap_heal_skipped_by_cooling_off_total{scope, field}`
- `cap_heal_probe_total{result=recovered|failed, scope, field}`
- `cap_admin_override_total{actor, scope, field}`
- `cap_signal_classified_total{httpStatus, providerErrorCode, accepted=true|false}` ← 4 重严格化漏斗

**告警**:

- `cap_heal_trigger_total` 1h 突增 >50 → oncall page(可能 provider 集体故障或 catalog 投毒)
- `cap_admin_override_total` 1h >10 → admin 与自愈打架,排查
- 单 scopeKey 30 天降级 >3 次 → 邮件提示用户检查 endpoint

### 4.9 失败模式 + 防御

| 失败模式                                                              | 防御                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Redis 挂** → 计数器失效                                             | classifier 检测 Redis 不可达**fail-closed**:跳过所有自愈写入,只写 audit `(action=heal-skipped, reason=counter-unavailable)`,业务请求继续走原 capability                                                                              |
| **probe daemon 崩** → override 永不复原                               | (1) K8s liveness 探测;(2) override 行有 `nextProbeAt` 字段,admin GET 列表时显示"距下次探测 X 小时",超 24h 未探测高亮警告;(3) 用户自助:UI 点"重置我的 capability 缓存",立即删自己 scope 下所有 `__meta.actor='self-heal'` 的 override |
| **classifier 升级引入误判** → false-positive 大量 override → 体验退化 | (1) 改动必须带回归测试集(real provider error fixture 库);(2) 灰度开关 `feature.capability_heal.write_enabled = true \| false \| shadow`,shadow 只记指标不写 DB,新版必须先 shadow 跑 7d 指标稳定再切真写                              |

---

## 5 · 看护机制(基于 T4)

### 5.1 ESLint 自定义规则:`@genesis/no-model-name-string-match`

**位置**:`backend/eslint-rules/no-model-name-string-match.js`(本地 plugin)。

**12 项 AST 触发模式**:

|  #  | 反模式                                                        | AST selector                                                                                                                                    |
| :-: | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
|  1  | `x.includes("deepseek")` / startsWith/endsWith/indexOf/search | `CallExpression[callee.type='MemberExpression'][callee.property.name=/^(includes\|startsWith\|endsWith\|indexOf\|search)$/]` arg = Literal 命中 |
|  2  | `x.match(/deepseek/i)` / `.test()`                            | arg 是 RegExpLiteral / Literal 命中                                                                                                             |
|  3  | `/deepseek/.test(x)`                                          | `CallExpression[callee.object.type='Literal'][callee.property.name='test']`                                                                     |
|  4  | `new RegExp("deep" + "seek")`                                 | `NewExpression[callee.name='RegExp']` arg 静态求值后命中(§5.2)                                                                                  |
|  5  | `x === "deepseek"` / `==`                                     | `BinaryExpression[operator=/^(===\|==\|!==\|!=)$/]` 任一侧 Literal 命中                                                                         |
|  6  | 反向 includes:`"openai-gpt-4".includes(x)`                    | `callee.object` 是 Literal/ArrayExpression,任一 string 命中                                                                                     |
|  7  | switch-case:`switch(x){case "deepseek":...}`                  | `SwitchCase > Literal.test` 命中                                                                                                                |
|  8  | Map 路由:`{deepseek:..., openai:...}[modelId]`                | `MemberExpression[computed=true] > ObjectExpression.object > Property.key.Literal` 命中,Property ≥2                                             |
|  9  | TemplateLiteral:`` `is ${id} deepseek` === x ``               | TemplateLiteral.quasi.raw 命中                                                                                                                  |
| 10  | 字符串拼接:`"deep"+"seek"` / `["dee","pseek"].join("")`       | §5.2 静态求值                                                                                                                                   |
| 11  | atob/decodeURIComponent/Buffer.from 反编码                    | 静态评估解码结果命中                                                                                                                            |
| 12  | Reflect.get / 索引访问:`obj["deepseek"]`                      | `MemberExpression[computed=true][property.type='Literal']` 命中                                                                                 |

### 5.2 共享静态求值器(ESLint + jest 同份代码)

`backend/eslint-rules/_helpers/static-string-eval.ts`:

```typescript
function tryEvalStaticString(node): string | null {
  // Literal → 直接返回
  // TemplateLiteral(无 expression 或可求值)→ 拼接
  // BinaryExpression[op='+'] 两侧可求值 → 拼接
  // CallExpression:Array.join / Array.concat / String.fromCharCode / atob(literal) / Buffer.from(literal,'base64').toString()
  // 否则 null
}
```

求值结果 normalize:`s.toLowerCase().replace(/[-_.\s]/g, "")` → 防 `Gpt_4O` / `gpt.4-o` / `Deep Seek` 等变形绕过。

**承认局限**:跨函数变量传递(`const a="deep"; const b="seek"; foo(a+b)`)拦不住——列已知盲区,靠 CODEOWNERS + review。`eval()` / `new Function(string)` 走独立 `no-eval` 规则。

### 5.3 配套规则:`@genesis/require-disable-reason`

`eslint-disable-next-line @genesis/no-model-name-string-match` 必须配 `// reason: <≥10 字>` 注释,无 reason → 第二条 meta rule 报错。

### 5.4 白名单(AST 路径级,非文件级)

```js
{
  forbiddenNames: require('./eslint-rules/forbidden-model-names.json'),
  allowedASTContexts: [
    // ① catalog:仅允许 Property[key.name=provider|modelPattern|modelId|modelFamily] 的 Literal value
    { whenAncestor: 'Property', whenAncestorKey: ['provider', 'modelPattern', 'modelId', 'modelFamily'], onlyAsValue: true },
    // ② 路由 fallback util:函数名匹配 inferXxxFromName / matchProviderFromId / detectModelFamily
    { whenAncestor: 'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression',
      whenAncestorIdMatches: /^(infer|detect|match|resolve)[A-Z]\w*(FromName|FromId|Provider|Family)$/ },
    // ③ icon 路径:Literal 是 "/icons/(ai|providers)/X.svg"
    { whenSiblingPattern: /^\/icons\/(ai|providers)\// },
  ],
}
```

**测试目录整体豁免**:`**/__tests__/**`、`*.spec.ts`、`*.test.ts`、`**/fixtures/**`(ESLint overrides 关闭规则)。

**关键**:catalog 文件**不**整文件白名单——同一 catalog 文件内若出现 `if (modelId.includes("deepseek"))`,依然报错。

### 5.5 `FORBIDDEN_NAMES` 全集(60+ 项)

```
openai, open-ai, openAi, anthropic, claude, claude-3, claude-sonnet, claude-opus, claude-haiku,
gpt, gpt-3, gpt-3.5, gpt-4, gpt-4o, gpt-4-turbo, gpt-5, o1, o3, o4,
deepseek, deep-seek, deepseek-r1, deepseek-v3, deepseek-v4,
grok, xai, x-ai, grok-2, grok-3, grok-4,
gemini, gemini-pro, gemini-1.5, gemini-2, gemini-3, google-ai, palm, bard,
llama, llama-2, llama-3, meta-llama, mistral, mixtral, mistral-large,
qwen, qwen2, tongyi, dashscope, doubao, ark, volcengine,
moonshot, kimi, kimi-k2, zhipu, glm, glm-4, chatglm,
minimax, abab, yi, 01-ai, yi-large, baichuan,
cohere, command-r, perplexity, sonar, groq,
together, together-ai, fireworks, fireworks-ai, replicate, huggingface, hf,
litellm, openrouter, azure-openai, bedrock, vertex,
imagen, dall-e, flux, midjourney, ideogram
```

匹配前 normalize:`s.toLowerCase().replace(/[-_.\s]/g, "")`。

### 5.6 jest 契约测试

**位置**:`backend/src/__tests__/architecture/no-hardcoded-model-name.spec.ts`

**实现**:用 TypeScript Compiler API(**不**用 grep)——AST 天然不含注释,根治 FP=0。与 ESLint 共享 `tryEvalStaticString`。

**核心断言**:

```typescript
it("hardcoded model-name hits ≤ baseline", () => {
  const baseline = readBaseline();
  const currentHits = scanAll();
  const baselineKeys = new Set(
    baseline.hits.map((h) => `${h.file}:${h.snippet}`),
  );
  const currentKeys = new Set(currentHits.map((h) => `${h.file}:${h.snippet}`));
  // 新增违规硬断言 0
  const added = [...currentKeys].filter((k) => !baselineKeys.has(k));
  expect(added).toEqual([]);
  // 数量只能降:旧违规修一个,baseline 也要减一
  expect(currentHits.length).toBeLessThanOrEqual(baseline.hits.length);
});

it("baseline 不得含已过期条目", () => {
  const today = new Date().toISOString().slice(0, 10);
  const expired = baseline.hits.filter(
    (h) => h.expiresAt && h.expiresAt < today,
  );
  expect(expired).toEqual([]);
});
```

### 5.7 Baseline 锁(只降不升 + 过期约束)

**Baseline 文件**:`backend/src/__tests__/architecture/hardcoded-model-name.baseline.json`

```json
{
  "version": 1,
  "lastUpdated": "2026-XX-XX",
  "hits": [
    {
      "file": "modules/ai-engine/llm/services/...",
      "line": 142,
      "snippet": "...",
      "reason": "C 阶段清扫遗留,W4 清零",
      "ownedBy": "@junjie",
      "expiresAt": "2026-07-01"
    }
  ]
}
```

**CR 补 baseline 流程**:

1. `reason` + `ownedBy` + `expiresAt`(≤8 周后)必填
2. baseline 文件 CODEOWNERS = `@architect-team` 强制 review
3. 任何 PR 修改 baseline +1 architect review

**防 merge conflict 误"解决"**:测试加 `addedAt > 30 天前的条目不许在 PR 新出现` 校验,防被复活成"新增"。

### 5.8 上线顺序(5 阶段防 CI 自锁)

```
①  阶段 F.1:jest baseline 锁先上 — baseline = 当前全集(约 N 处),
            断言"只降不升"。此刻所有人能推。
②  C 阶段并行:按业务域批量清扫,每批同步删 baseline.json 条目
③  阶段 F.2:baseline 清零后(hits.length===0),断言改 toEqual([]),删 baseline.json
④  阶段 F.3:ESLint 规则上线 warn 一周(IDE 显红但不阻塞)
⑤  阶段 F.4:warn→error,pre-commit/pre-push 强拦
⑥  阶段 F.5:pre-push 加 `npm run verify:no-hardcoded-model-name` 二次保险
```

**渐进过渡工具**:`npm run audit:model-names -- --baseline-diff` 输出"距清零还剩 X 条 / 各业务域分布"。

### 5.9 失败模式

1. **白名单 too lenient**:`whenAncestor:'Property'` + `whenAncestorKey:'provider'` 可能被 ShorthandProperty 绕过(`const provider="deepseek"; foo({provider})`)→ 补 `onlyAsValue: true` + 严格判 ShorthandProperty
2. **静态求值器过激进**:`atob` 是项目自定义 mock 同名时误判 → 只信任 `globalThis.atob` / `Buffer.from`,参数链路全静态可证
3. **baseline 被 merge conflict 误"解决"为放宽**:rebase 时两边各加 1 → merge tool 合并 → 校验 `addedAt > 30 天前条目不许新出现`(§5.6 已防)

---

## 6 · 落地路线(基于 T5)

### 6.1 9 阶段切片(v3.1 工时 + SSOT 收敛)

| 阶段                                                   |        周次        | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |                工时                 | 前置         | 回滚成本                                                                          |
| ------------------------------------------------------ | :----------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------: | ------------ | --------------------------------------------------------------------------------- |
| **0** 现状 contract 锁定(v3.1 新增)                    |         W1         | 4 个 jest contract spec 锁不变量:双源 `AIModelConfig` / `inferIsReasoning` 调用方 / `PROVIDER_DEFAULT_CHAINS` 形态 / `structuredOutputStrategy` 真实读者(且 5 个 bool 零读者印证 D6)。**纯附加,不改业务代码**                                                                                                                                                                                                                                                                                                                                                                                   |              **3-4d**               | 无           | git revert,零业务影响                                                             |
| **A0** 双源合并(✅ 已完成 `16ba6c9f5`)                 |         W2         | 提取 `AIModelConfig` interface 到 `types/model-config.types.ts`;`ai-chat-model-config` 委托新 service + `@deprecated`;消费方迁移;阶段 0 双源 spec 演进为单源 baseline(`aimodelconfig-single-source.contract.spec.ts`)。**A0 review 增补**:`isTemperatureSupported` 由 wrapper 上提到 canonical(public sync 方法);wrapper 3 处行为漂移(refreshModelConfigCache 加载全 modelType / getDefaultModelConfig 改读 DB / 严格 BYOK 路径)已在 wrapper JSDoc 文档化                                                                                                                                       |         **18h**(实际 ~14h)          | 阶段 0       | git revert                                                                        |
| **A** capability 只读链(✅ 已完成 `d77776541`,D7 收敛) |         W3         | `ModelCapabilityService`(新)+ catalog **22 条**(17 router 收编 + 4 别名 + deepseek-v4-pro 案例) + 5 级解析;ai-api-caller 删 `isDeepseekReasoner`(+49 行,god-class ≤50);router 改派生视图删 PROVIDER_DEFAULT_CHAINS 17 条。**3 路 review 修订**:facade 硬隔离(`ModelCapabilityService` 移出 module exports + layer-boundaries spec)/ zod 删 cast + `.strict()` / `fallbackChain` undefined=catalog 默认 vs `[]`=显式空 / catalog 顺序锁 + deepseek-v4-pro 防回归 / fail-open 加观测信号 / base spec 注入消除假绿 / AIModelConfig 预留 `aiModelOverrides?+userOverrides?` 字段(B 铺路)            |         **4-5d**(实际 ~5d)          | A0           | git revert,无状态变更                                                             |
| **B** DB + self-heal + admin UI                        |       W4-W5        | 手写 SQL 加 `capability_overrides JSONB`(2 表 nullable);scope 严格 `updateCapabilities` + AuditLog;**Redis 仅做阈值计数 + advisory lock**(D7);错误信号 4 重严格化;admin UI capability 编辑;feature flag `capability.overrides.enabled`                                                                                                                                                                                                                                                                                                                                                          |        **6d**(评审 #5 上调)         | A            | 24h 内 drop column 安全;7d+ 保留列只 deprecated;30d+ 实质不可回                   |
| **B+** apiFormat backfill                              |         W5         | 扫 AIModel,基于 provider 字段填 apiFormat 真值(不用启发式);cost_tier 同步;dry-run + 灰度。**必须 B 上线 24h 内跑完**                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |               **8h**                | B            | 重跑覆盖                                                                          |
| **C** 清扫 P0 反模式                                   |       W6-W7        | 9 处主道 + 3 处 ai-app substring + router 17 条 catalog 全改读 capability;**穷举 grep 清单一个 PR 落**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |       **4-5d**(评审 #5 上调)        | B+           | git revert                                                                        |
| **D** P1 启发式 → 显式 fallback                        |         W7         | `inferIsReasoning` 调用方包成 `config.isReasoning ?? infer(...)`;timeout/cost tier/tokenParam 启发式改读 capability                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |               **2d**                | C            | git revert                                                                        |
| **F** ESLint AST + jest 契约 + baseline 锁             |         W8         | `@genesis/no-model-name-string-match` + `require-disable-reason` + 契约 spec + baseline.json + catalog 投毒形状测试。**5 阶段渐进**(§5.8)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |       **3-4d**(评审 #5 上调)        | C+D          | 摘规则 / 还原 baseline                                                            |
| **G** 老 5 bool drop(**D6 v3.1 上调**)                 | W10(F 后 2 周观察) | **完整删除清单(阶段 0 spec/审视补全)**:(1) `admin.service.ts:694-698` + `:773-777` DTO 透传删 / (2) `admin.controller.ts:474-478` DTO 字段删 / (3) admin UI:`frontend/components/admin/ai-config/AIModelSettings.tsx` + `StructuredOutputCapabilitySection.tsx` 5 字段删 / (4) `ai-model-config.service.ts` buildModelConfig 5 bool 映射删 / (5) interface 字段删(`ai-model-config.service.ts:55-92` 内)/ (6) `prisma/schema/models.prisma` AIModel 5 列 `@map` 删 / (7) 手写 SQL 迁移 `DROP COLUMN` 5 列 / (8) 阶段 0 `structured-output-strategy-readers.contract.spec.ts` 同步删 5 bool 断言 | **8h dev + 2 周观察**(评审 #3 上调) | F + 2 周观察 | DROP 不可逆(但阶段 0 spec 已证零运行时业务读者;前端/admin DTO 透传同步删后无残留) |

**总工时**:**22-26 dev 天 / ~10 周自然时**(评审 #5 / #3 修正,v3 原 14d 估算偏激进)。

**v3.1 vs v3 差异**:

- 新增**阶段 0**(W1,3-4d):锁现状不变量,防 A0 工作期间无意改坏
- **A 阶段无自愈**(D7 收敛):仅 capability 读取,不写 DB 不写 Redis(SSOT 干净;代价:不修当下 mission 死,平行用 #66-#73 止血)
- **B 阶段才上自愈**:Redis 仅计数,JSONB 唯一权威
- 工时全量上调:A0 12→18h / A 3d→5d / B 4d→6d / C 2.5d→5d / F 2d→4d / G 3h→8h+2w / 总 14d→22-26d

### 6.2 阶段依赖图(v3.1 收敛)

```
0 (现状 contract 锁定,jest spec 锁不变量)
   ↓
A0 (双源合并)
   ↓
A (capability 只读链 · 无 self-heal · D7 SSOT 收敛)
   ↓
B (DB capability_overrides JSONB + self-heal write + admin UI + AuditLog,Redis 仅计数+lock)
   ↓
B+ (apiFormat backfill,必须 B 上线 24h 内)
   ↓
C (清扫 9 处 P0 主道 + 3 处 ai-app)
   ↓
D (P1 启发式 → 显式 fallback)
   ↓
F (ESLint AST + jest 契约 + baseline,5 步渐进)
   ↓
G (老 5 bool drop,F 后 ≥2 周观察)
```

**可并行**:F 的 ESLint 规则脚手架可与 C 并行(各自独立文件);admin UI(B 一部分)前后端可并行,协议先冻结。

### 6.3 窗口期 4 类风险 + 缓解

| 窗口                   | 风险                                                                                                     | 缓解                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A 上线 → B 上线        | Redis self-heal 命中但 deploy 清零 Redis(Railway 重启 / 主从切换)→ 用户每次冷启撞 400 一次后才修复       | **A 上线即开埋点统计 self-heal 触发率**;Redis 用 **persistent volume** 而非 ephemeral;TTL 7d 而非默认 1h |
| B 上线 → backfill 跑完 | DB 已加列但 apiFormat 旧值仍是启发式残留 → C 删启发式让旧行炸                                            | backfill 必须**同一窗口** 24h 内跑完;禁止 B 单独上线超过 24h                                             |
| C 上线 → D 上线        | C 删了 substring 但 D 还没改 timeout fallback → 部分模型 timeout 用错(例 o1 用了 default 120s 而非 180s) | C 和 D **同一 PR 或同一天**上线,不允许跨 sprint                                                          |
| F 上线前               | 无 ESLint guard 期间新代码可能引入新 substring → 修完又回来                                              | C 阶段同期 ESLint 规则放 **warn**(非 error),等 D 完才升 error                                            |

### 6.4 5 项硬约束(不可再分)

1. **A0 双源合并必一次性**:两文件 import 替换 ~25 处,半途状态下读哪源都不对
2. **B + B+ backfill 必须 24h 窗口内**:加了列没 backfill = admin UI 显示 null 但 runtime 仍跑启发式,薛定谔
3. **C 清扫 12 处必一个 PR**:删一半留一半让 spec 50% 失败 50% 通过,无法判断回归
4. **self-heal 写 Redis + 读 Redis overlay 必同 PR**:只写不读=浪费;只读不写=永远空
5. **god-class 净增上限 50 行**(pre-push guard 焊死)→ A、C 阶段所有新代码强制走独立文件

### 6.5 工时矩阵(关键文件真实复杂度)

| 文件                               | 现 LOC              | 改动                                            | 测试基线                        | 修测试估算  |
| ---------------------------------- | ------------------- | ----------------------------------------------- | ------------------------------- | ----------- |
| `ai-api-caller.service.ts`         | 1325                | 改 ~15 行 + self-heal 包装抽**独立文件** ~80 行 | 82 spec                         | ~10 个 spec |
| `ai-chat.service.ts`               | 2757                | 净负 ~10 行(删启发式)                           | 129 spec                        | ~12 个 spec |
| `ai-model-config.service.ts`       | 1620                | 改 ~20 行 + 新加 capability getter ~40 行       | 102 spec                        | ~8 个 spec  |
| `ai-chat-model-config.service.ts`  | 418                 | A0 合并后整体删 / 缩到 ~100 行                  | 58 spec                         | 全部重写    |
| 新 `model-capability.service.ts`   | 0 → ~200            | 全新                                            | 0 → ~15 spec                    | 新写        |
| 新 `model-capability-self-heal.ts` | 0 → ~120            | 全新                                            | 0 → ~10 spec                    | 新写        |
| Prisma 迁移 SQL                    | —                   | 2 表 add column nullable + drop 5 列(G)         | 0                               | —           |
| backfill 脚本                      | 0 → ~150            | 新写 + dry-run                                  | 0 → 5 spec                      | 新写        |
| ESLint custom rule                 | 0 → ~100 + fixtures | 新写                                            | 0 → ~12 spec(§5.9 5 FP + 10 FN) | 新写        |

### 6.6 回滚真实矩阵

| 阶段 | 24h                        | 7d                | 30d                       | 不可回原因                                          |
| ---- | -------------------------- | ----------------- | ------------------------- | --------------------------------------------------- |
| A0   | git revert                 | git revert        | 中等(调用方已用新 import) | —                                                   |
| A    | git revert + Redis FLUSHDB | 同左              | 同左                      | Redis 无持久价值数据                                |
| B    | drop column 安全           | 保留列 deprecated | **实质不可回**            | admin 已编辑 `capability_overrides`,drop = 配置丢失 |
| B+   | 重跑覆盖                   | 同左              | 不需回                    | 纯数据修正                                          |
| C    | git revert                 | git revert        | git revert                | 无状态变更                                          |
| D    | git revert                 | git revert        | git revert                | —                                                   |
| F    | 摘规则 / 还原 baseline     | 同左              | 同左                      | 仅静态检查                                          |
| G    | DROP COLUMN 不可逆         | 同左              | 同左                      | **T1 实证零运行时读者,无回归风险**                  |

**缓解**:

- B 的 `capability_overrides` 列**全程 nullable** + 默认 null
- B 上线后加 `feature flag` **`capability.overrides.enabled`**,关 flag 等同回滚不走 override 路径
- 30d 后若要回 B → 改 deprecation 路径(保列、停写、停读)而非 drop

### 6.7 最易超时/回归 + 缓解

**最易超时:A**

- 理由:ai-api-caller 82 spec mock HTTP error 形状严格匹配各家 provider(OpenAI `error.code` / Anthropic `error.type` / Gemini `error.status`),一处 mock 写错 8 个 spec 同时红;加 god-class guard 强制新文件,边写边来回挪
- 缓解:A 开工前先列**全部 8 个 spec 期望** mock 形状,固化为 fixture 文件;self-heal 包装纯函数化(in: error → out: capability patch),不绑 service 类成员

**最易引入回归:C**

- 理由:12 处 substring 横跨 ai-chat / ai-model-config / 注释残留,每处 fallback 不同(timeout 默认 / tokenParamName / isReasoning);改一个忘另一个,prod 小众模型(deepseek-r1 / qwq-32b)走错分支
- 缓解:C 开工前用 `grep -rnE "model.*toLowerCase|\.includes\(['\"](gpt|claude|o1|o3|gemini)"` 列穷尽 12 处清单,每处单独 commit,逐一过 spec;契约测试 baseline(F)先以 warn 模式上线观察 3d,确认 0 退化再升 error

---

## 7 · 验收标准(18 条)

### 7.1 数据模型(4 条)

1. `AIModelConfig` interface 仅在 `ai-engine/llm/types/model-config.types.ts` 单源定义,`ai-chat-model-config.service.ts` 删除或委托
2. `ai-engine/llm/services/**` 和 `ai-harness/runner/**` + `ai-app/**/services/**` 0 处 `includes("deepseek"|"gpt"|"claude"|...)`(controllers/DTO/测试豁免)
3. `capability_overrides JSONB` 字段写入侧用 Zod schema 强校验,拼错 TS 不编译
4. 新加任意 capability 字段:**仅需** catalog 加一条数据 + DB JSONB 字段加 nested key,业务代码 0 改动

### 7.2 安全(4 条)

5. BYOK 用户路径的自愈**仅**写 `UserModelConfig.capability_overrides`,**绝不**写 `AIModel.*`(代码 + lint 双重禁)
6. admin override 端点 `PATCH /admin/ai-models/:id/capabilities` 必须 `@Roles('admin')` + AuditLog 写入
7. 错误信号 4 重严格化全满足:HTTP 400/422 + error code 白名单 + 仅 4xx body + request-response 反向校验
8. 自愈降级需 3 次/10 分钟阈值才落 DB;admin override 后 24h cooling-off 强制禁自愈

### 7.3 看护(4 条)

9. ESLint `@genesis/no-model-name-string-match` 12 项 AST 触发模式全部生效;FN 测试 10 项全过(字符串拼接 / 反向 includes / RegExp / atob / TemplateLiteral / switch / computed access / normalize 后命中)
10. FP 测试 5 项全过(catalog literal / icon 引用 / 测试 fixture / 注释 / inferXxxFromName util)
11. baseline.json 文件 CODEOWNERS = architect-team;baseline 条目必填 `reason / ownedBy / expiresAt`(≤8 周)
12. catalog 形状测试:`rationale ≥30 字` + `addedBy 必填` + 禁止过宽 match(单条件 / `.*` / 长度<3 modelPattern)

### 7.4 反模式清除(3 条)

13. T1 §1.8 列出 ~35 处 P0 反模式,C+D 阶段后清扫至 ≤baseline,F 后 baseline 归 0
14. 删 `isDeepseekReasoner` 后,deepseek-v4-pro / deepseek-reasoner / deepseek-chat 全跑通(集成测试覆盖三种)
15. 故意写 `modelLower.includes("deepseek")` → ESLint 红 + Jest 红 + pre-push 红 全部生效

### 7.5 自愈链路(3 条)

16. provider 报 `response_format unavailable` → 自动降级 + 重试 + DB 写回 + 下次直走对的路径(端到端集成测试)
17. provider 返回 `"response_format field validated"`(含 validated)→ **不**触发降级(误匹配防御测试)
18. 同 modelId 5 并发请求一起撞 400 → `updateCapabilities` 只调一次(advisory lock 防并发竞态)

---

## 8 · 风险与回滚

### 8.1 关键风险

- **B 阶段实质不可逆**:`capability_overrides` JSONB 写入后 drop = 数据丢失。**缓解**:nullable 全程 + feature flag 总开关 + 30d 后改 deprecation 路径
- **Redis 挂导致 fail-closed**:计数器失效时**只 log 不写 DB**,业务请求继续走原 capability(T3 §4.9)
- **G 阶段 DROP COLUMN 不可逆**:T1 实证零运行时读者,无回归(否则 F 阶段可观测会暴露)
- **catalog 投毒**:CODEOWNERS + jest 形状测试 + 强制字段(D4)三重防(§4.7)

### 8.2 Feature Flag 边界

- `capability.overrides.enabled`(总开关):关 = 等同回滚 B,不走 override 路径
- `capability.self_heal.write_enabled = true | false | shadow`:shadow 模式只记指标不写 DB,新版 classifier 必须先 shadow 跑 7d 指标稳定再切真写

---

## 9 · ADR(架构决策记录)

| ADR | 决策                                                            | 理由                                                                                           |
| :-: | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
|  1  | capability 数据存 JSONB(新字段)+ 19 既有列保留(D1)              | 既有列已索引/有 admin 路径;新字段需求会持续变化,JSONB 零迁移成本                               |
|  2  | 第一期不做 observation 表(D2)                                   | 当前无 admin 用户失败统计 UI,零消费方;YAGNI,真需要时再加                                       |
|  3  | catalog 命名 `provider`+`modelPattern`(D3)                      | 对齐 `AIModelConfig.provider` 既有命名,不制造双源                                              |
|  4  | rationale ≥30 字 + addedBy 必填(D4)                             | 30 字强制写"为什么+API 依据",防投毒                                                            |
|  5  | 治理范围扩 ai-app/services(D5)                                  | ai-app 已有 ≥3 处外溢,不扩=看护无效                                                            |
|  6  | 老 5 bool **直接 drop**(D6)                                     | T1 实证零运行时读者,死代码无双写必要                                                           |
|  7  | router 改派生视图,删 PROVIDER_DEFAULT_CHAINS                    | 单一真源原则(MECE);catalog → caps → chain 派生                                                 |
|  8  | 自愈 scope 严格隔离:BYOK 只写 UserModelConfig                   | 多租户安全;BYOK proxy 行为不能跨用户污染                                                       |
|  9  | 错误信号 4 重严格化(HTTP+code+位置+反向)                        | 防自愈被不可信输入污染                                                                         |
| 10  | 阈值 3 次/10 分钟 + advisory lock + 24h cooling-off             | 防单次抖动钉死 + 防 admin 改了立被覆盖 + 防并发竞态                                            |
| 11  | 复原 3 通道(探测 + admin reset + catalog version)               | 防 false-neg 单调卡死                                                                          |
| 12  | ESLint + jest contract 双层 + baseline 锁(只降不升)+ 5 阶段渐进 | 防 CI 自锁 + 防绕过 + 渐进迁移                                                                 |
| 13  | `ModelCapabilities` 不出 facade                                 | 防 ai-app 再生 `if (caps.X)` 散点                                                              |
| 14  | **v3.1 阶段 0 锁现状 contract**(jest spec 锁不变量)             | 防 A0 工作期间 PR 无意改坏双源/inferIsReasoning/router catalog,给 D6 提供"5 bool 零读者"硬证据 |
| 15  | **v3.1 D7 self-heal SSOT**:Redis 仅计数+lock,JSONB 唯一权威     | SSOT 是非妥协纪律;Redis 不该承载权威值;A 无自愈,B 才上                                         |

---

## 10 · v3.1 决议附录(用户拍板 7 项)

(原文见 §0,此处复述供检索)

|   #    | 决议                                                                                           |
| :----: | ---------------------------------------------------------------------------------------------- |
| **D1** | 新增 capability 用 JSONB(`capability_overrides`);既有 19 列保留                                |
| **D2** | 第一期只做 JSONB,observation 表 backlog                                                        |
| **D3** | catalog 字段名 `provider` + `modelPattern`(对齐现状)                                           |
| **D4** | rationale ≥30 字 + addedBy 必填(git author)+ sourceUrl 选填                                    |
| **D5** | 扩 ai-app/services(豁免 controllers/DTO)                                                       |
| **D6** | 老 5 bool **F 后直接 drop**,~8h dev + 2 周观察(v3.1 工时上调)                                  |
| **D7** | **self-heal SSOT(Y 方案)**:Redis 仅计数+lock,JSONB 唯一权威;A 阶段无自愈,B 阶段才上(v3.1 新增) |

---

## 11 · 立即可执行(v3.1 启动 = 阶段 0)

**第一步**:**阶段 0 · 现状 contract 锁定**(W1,3-4d,纯附加,零业务风险)。

**已开始**:派 agent 在 worktree 写 4 个 jest contract spec:

1. `aimodelconfig-dual-source.contract.spec.ts` — 锁双源现状
2. `infer-is-reasoning-callers.contract.spec.ts` — 锁 `inferIsReasoning` 调用方清单
3. `provider-default-chains-shape.contract.spec.ts` — 锁 `PROVIDER_DEFAULT_CHAINS` 形态
4. `structured-output-strategy-readers.contract.spec.ts` — 锁 strategy 读者 + 证 5 bool 零读者(D6 硬证据)

完成后我会:tsc 验证 + jest 全套件验证 + 提交独立 PR 推送 origin/main。

**后续阶段**:阶段 0 推送后启动 **A0**(W2,双源合并);依次推进 A→B→B+→C→D→F→G(~10 周)。

```bash
# A0 实际命令(阶段 0 完成后执行)
git checkout main && git pull
git checkout -b refactor/capability-a0-merge-aimodelconfig-sources
# 1. 提取 interface 到 types/
# 2. 改两个 service 的 import
# 3. ripgrep 消费方逐一迁移
# 4. tsc + 全量 spec + 架构边界 + pre-push
# 5. commit + PR
```

**v3.1 baseline 通过判定(已全部满足)**:

1. ✅ 7 项决议(D1-D7,§0 列出)已锁定
2. ✅ §6 9 阶段时间线 ~10 周认可
3. ✅ §4 自愈 scope/阈值/审计 + D7 SSOT 收敛已认可
4. ✅ v3.1 文档归档 origin/main(本提交)
5. ✅ 阶段 0 已派 agent 执行中

阶段 0 完成 → 推送 → 启动 **A0 阶段**(独立 PR,可独立 revert)。
