# LLM 格式能力矩阵 + 自适应支持策略

**日期：** 2026-05-25
**作者：** Claude Code（基于代码 grep + 官方 docs web 核查）
**触发：** 线上 deepseek-v4-flash 因 `response_format: {type:"json_schema"}` 被拒崩 mission（`791166ca3` 已修），暴露 capability catalog 与各 provider 真实 API 已漂移。
**配套文档：** [model-capability-driven-runtime.md](./model-capability-driven-runtime.md)（capability 系统机制）

---

## 0. TL;DR

1. **结构化输出（structured output）是各大模型差异最大、最容易踩坑的维度**，有 5 种互不兼容的"原生模式"：`json_schema_strict` / `json_schema` / `json_mode(json_object)` / `tool_use` / `gemini_response_schema` / `gbnf_grammar`，外加永远兜底的 `prompt`。
2. **我们已有数据驱动的 capability 机制**（catalog + 4 级 override + self-heal + fallback chain），架构是对的。
3. **但 catalog 是手维护的，已经在漂移**：本次核查发现 ≥3 条过时（DeepSeek 已修、**Anthropic 严重过时**、Gemini 部分过时）。
4. **运行时还有一个韧性缺口**：response_format 被 provider 拒时，不会自动沿 fallback chain 降级，而是当 non-retryable 判死。
5. **自适应方向**：catalog 当"种子" + 运行时降级闭环 + self-heal 回写 + 定期 probe 核查，让"漂移"自愈而不是靠人肉追。

---

## 1. 我们的能力模型（先讲我们怎么抽象）

`backend/src/modules/ai-engine/llm/capability/model-capability.types.ts` 把每个模型抽象成 **9 个能力维度**，与具体 provider 解耦：

| 维度                             | 取值                                                                                                                 | 说明                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `structuredOutput.nativeMode`    | `json_schema_strict` / `json_schema` / `json_mode` / `tool_use` / `gemini_response_schema` / `gbnf_grammar` / `none` | 该模型**首选**的结构化输出方式                    |
| `structuredOutput.fallbackChain` | 上述模式数组                                                                                                         | 首选失败后的降级序列（派生时末尾自动补 `prompt`） |
| `toolUse.mode`                   | `openai_functions` / `anthropic_tools` / `gemini_function_calling` / `none`                                          | 函数调用协议                                      |
| `toolUse.parallelCalls`          | bool                                                                                                                 | 是否支持并行工具调用                              |
| `reasoning.kind`                 | `reasoning_effort` / `extended_thinking` / `opaque` / `none`                                                         | 推理模型的暴露方式                                |
| `reasoning.exposeContent`        | `thinking_block` / `reasoning_field` / `none`                                                                        | 推理 token 在哪个字段                             |
| `temperature.support`            | `full` / `none`                                                                                                      | 是否接受 temperature                              |
| `tokenParam`                     | `max_tokens` / `maxOutputTokens`                                                                                     | token 上限字段名                                  |
| `vision.support`                 | `image_url` / `native_multimodal` / `none`                                                                           | 视觉输入方式                                      |
| `systemPrompt.placement`         | `messages_array` / `top_level_system_field`                                                                          | system prompt 放哪                                |
| `promptCache.support`            | `anthropic_cache_control` / `openai_prompt_cache` / `gemini_cached_content` / `none`                                 | prompt 缓存机制                                   |

**能力解析优先级**（`ModelCapabilityService.resolveCapabilities`，first-win）：

```
1. userOverrides       (用户个人偏好，BYOK 用户自己改)
2. aiModelOverrides    (admin fleet-wide 配置)
3. self-heal overrides (运行时学到的失败 → 自动降级，Redis)
4. catalog 默认        (model-capability-catalog.ts，本文重点)
5. SAFE_DEFAULTS       (全 'none' 保守兜底 → 只走 prompt)
```

结构化输出最终派生成一条链：`deriveStructuredOutputChain(caps)` = `[nativeMode, ...fallbackChain, 'prompt']`（去重）。

---

## 2. 各大模型当前格式状态（2026-05 web 核查）

> ⚠️ = 与我们 catalog 当前值**不一致**，需更新。✅ = catalog 与现实一致。

### 2.1 结构化输出

| Provider                                                  | 现实（2026-05 官方核查）                                                                                                                                                                                    | 我们 catalog                                    | 状态                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| **OpenAI**                                                | `json_schema` strict 是生产默认（CFG 引擎约束 token），JSON Mode 已 legacy。gpt-4o-2024-08-06+ / o1 全支持                                                                                                  | `json_schema_strict` → [json_schema, json_mode] | ✅                                                                     |
| **Anthropic Claude**                                      | **已上线原生 Structured Outputs**：`output_format`（JSON 输出）+ `strict:true`（严格 tool use），beta header `structured-outputs-2025-11-13`，Sonnet 4.5 / Opus 4.1/4.6/4.7 / Haiku 4.5 支持                | `tool_use` only                                 | ⚠️ **严重过时**：我们还在强制 tool_use，没用上 Claude 原生 strict JSON |
| **Google Gemini**                                         | `responseSchema` + `responseMimeType`；**新增 `response_json_schema`**（更完整 JSON Schema）；Gemini 2.5 保 key 顺序；Gemini 3 可结构化输出 + 内置工具并用。⚠️ Interactions API 2026-05 有 breaking changes | `gemini_response_schema` → [json_mode]          | ⚠️ 部分过时：未用 `response_json_schema`；需复核 May-2026 API 变更     |
| **DeepSeek**                                              | 仅 V4-flash + V4-pro；**只支持 `json_object`，不支持 `json_schema`**；严格 schema 仅经 tool_use                                                                                                             | `json_mode`（已修 `791166ca3`）                 | ✅（本次刚修）                                                         |
| **xAI Grok**                                              | OpenAI-compatible，支持 json_schema strict（grok-2/3）                                                                                                                                                      | `json_schema_strict` → [json_schema, json_mode] | 🔶 未重新核查，likely OK                                               |
| **Mistral / Qwen / Moonshot / Zhipu GLM / Doubao / Groq** | OpenAI-compatible，普遍 `json_object`，无 strict json_schema                                                                                                                                                | `json_mode`                                     | 🔶 likely OK（OpenAI-compat 长尾）                                     |
| **Cohere**                                                | Command-R 无 response_format                                                                                                                                                                                | `none` → prompt                                 | ✅                                                                     |
| **Ollama / vLLM（本地）**                                 | GBNF grammar 最可靠                                                                                                                                                                                         | `gbnf_grammar`                                  | ✅                                                                     |
| **OpenRouter**                                            | 按底层模型透传（claude→tool_use / gemini→responseSchema / 其它→json_schema lenient）                                                                                                                        | 二级 pattern 匹配（claude/gemini/通用三条）     | ✅ 设计正确                                                            |

### 2.2 其它维度速记（差异点）

- **token 上限字段**：Gemini 用 `maxOutputTokens`（camelCase），其余 `max_tokens`。
- **system prompt 放置**：Anthropic / Gemini 顶层独立字段；OpenAI-compat 全在 `messages[]`。
- **prompt 缓存**：Anthropic `cache_control`（24h，结构化 schema 也缓存）；OpenAI 自动；Gemini `cachedContent`；其余无。
- **推理暴露**：OpenAI `reasoning_effort` 参数；Anthropic `thinking_block`；DeepSeek `reasoning_content` 字段；Gemini opaque。
- **prefill**：Anthropic **2026-04 起最新模型不再支持 message prefilling** —— 如果我们的 JSON 哄骗用 assistant-prefill，需检查。

---

## 3. 我们系统的支持情况（诚实评估）

### 3.1 做得对的

- ✅ **数据驱动**：能力是 catalog 数据，不是散落 `if (provider==='x')` 判断（v3.1 §0 D5 反模式已治理，有 ESLint + contract spec 看护）。
- ✅ **4 级 override**：用户 / admin / self-heal / catalog 分层，BYOK 用户可自配。
- ✅ **派生链 + prompt 永远兜底**：任何未知模型至少能走 prompt + 后解析，不会发未知字段崩。
- ✅ **self-heal**：运行时学到"某模型不支持 X" → Redis 回写 override，下次不再犯。
- ✅ **catalog 投毒防御**：rationale ≥30 字 + addedBy + addedAt + sourceUrl 强制字段 + contract spec。

### 3.2 三个真实缺口（本次暴露）

**缺口 A — catalog 手维护，已漂移（数据问题）**
catalog 全部 `addedAt: 2026-05-23`，两天就发现 ≥3 条过时（DeepSeek / Anthropic / Gemini）。模型 API 演进速度 > 人肉追的速度。

**缺口 B — 运行时不沿 fallback chain 降级（韧性问题）**
派生链有 `[json_schema, json_mode, prompt]`，但 `ai-api-caller` 遇到 `response_format type unavailable` 当 non-retryable `PROVIDER_API_ERROR` 直接判死，**没自动降到 json_mode**。self-heal 只救"下次"，救不了当次 → 整个 mission 崩。这是 deepseek 事故里"为什么 fallbackChain 没救场"的答案。

**缺口 C — Anthropic 原生能力没用上（能力浪费）**
Claude 已有原生 strict JSON（`output_format`），我们还在用 tool_use 绕。功能能跑但非最优（多一层 tool 包装 + 没用上 schema 缓存）。

---

## 4. 后续如何自适应支持更多（路线）

按"投入 / 收益"排序：

### R1 — 闭环运行时降级（缺口 B，最高优先）

让 `ai-api-caller` 在收到"结构化输出相关的 INVALID_REQUEST"时，**自动沿派生链走下一个 strategy 重试当次请求**，而不是判死。

- 识别信号：错误消息含 `response_format` / `json_schema` / `unavailable` / `not support` + INVALID_REQUEST
- 行为：当前 strategy 失败 → 取派生链下一个（json_schema→json_mode→prompt）→ 重发**当次** → 成功则继续，并触发 self-heal 回写
- 收益：任何 provider 临时/永久拒某种 response_format，mission 都不再崩；catalog 漂移也能被运行时兜住
- 风险：热路径改动，需 integration 验证（建议配可跑 mission 的 staging）

### R2 — self-heal → catalog 反馈回路（缺口 A，治本）

self-heal 现在只写 Redis override（per-user/临时）。增加：当**同一 (provider, model, 降级方向)** 在 N 个不同用户 / M 次累计触发 → 生成一条"catalog 建议变更"告警（写日志 / admin dashboard / 甚至 PR draft），让人类确认后固化进 catalog。

- 收益：把"线上真实失败"变成 catalog 自我修正的信号源，漂移自愈
- 已有基建：`capability-self-heal.service.ts` + `capability-probe.service.ts`（batchReset）已存在，扩一个聚合统计即可

### R3 — 定期 capability probe（主动核查）

`capability-probe.service.ts` 已有雏形。扩成：对每个已配置 (provider, model) 定期发一个**最小结构化探针请求**（"返回 {ok:true}"），记录哪种 response_format 真能用，与 catalog 比对，不一致即告警。

- 收益：不等线上 mission 崩就发现漂移（DeepSeek 这次是线上 mission 崩才发现）
- 注意：探针有成本（每模型每周期一次最小调用），按 BYOK key 限频

### R4 — 升级 Anthropic 到原生 structured outputs（缺口 C）

catalog Anthropic 条目：`tool_use` → 新增 `anthropic_structured_output` nativeMode（用 `output_format` + beta header），tool_use 降为 fallback。

- 前置：需在 `structured-output/adapters.ts` 加 Anthropic `output_format` adapter + beta header 注入
- 收益：用上 Claude 原生 strict JSON + schema 缓存；少一层 tool 包装
- 风险：beta header（`structured-outputs-2025-11-13`），需确认我们用的 Claude 版本 + SDK 支持

### R5 — catalog 条目加"鲜度"元数据 + 过期看护

每条加 `verifiedAt`（最后人工/probe 核查日期）。加一个 audit：`verifiedAt` 超 90 天的条目 → 提醒复核。把"2026-05-23 一次性填完就不管了"变成"持续核查"。

---

## 5. 落地优先级建议

| 项                                    | 类型     | 优先级  | 阻碍                                                                         |
| ------------------------------------- | -------- | ------- | ---------------------------------------------------------------------------- |
| R1 运行时降级闭环                     | 韧性     | 🔴 最高 | 热路径，需 staging 验证                                                      |
| catalog 修 Anthropic + Gemini（数据） | 数据修正 | 🔴 高   | 需确认 adapter 支持（Anthropic output_format / Gemini response_json_schema） |
| R2 self-heal→catalog 反馈             | 自适应   | 🟡 中   | 扩聚合统计                                                                   |
| R3 定期 probe                         | 自适应   | 🟡 中   | 探针成本 + 限频                                                              |
| R4 Anthropic 原生升级                 | 能力     | 🟡 中   | 需写 adapter + beta header                                                   |
| R5 鲜度元数据                         | 治理     | 🟢 低   | catalog schema 加字段 + audit                                                |

**一句话**：架构（数据驱动 + 多级 override + self-heal）已经对了，问题是**数据会过时 + 运行时降级没闭环**。先做 R1（运行时遇拒自动降级，止血任何漂移）+ 修 Anthropic/Gemini catalog（眼下最大的两条过时），再做 R2/R3 让漂移自愈。

---

## Sources（web 核查依据）

- [Anthropic Structured Outputs — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Gemini Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini Interactions API breaking changes (May 2026)](https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026)
- [DeepSeek JSON Output docs](https://api-docs.deepseek.com/guides/json_mode)
- [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

---

**最后更新**: 2026-05-25
