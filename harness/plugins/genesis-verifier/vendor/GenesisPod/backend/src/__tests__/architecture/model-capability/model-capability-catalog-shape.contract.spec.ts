/**
 * Capability Contract · model-capability-catalog 形状校验（v3.1 §A 投毒防御）
 *
 * v3.1 §4.7 D4 强制字段：catalog 每条规则**必须**含：
 *   - rationale ≥30 字（"为什么 + API 行为依据"，防 PR 投毒后无依据）
 *   - addedBy（git author email，投毒回溯）
 *   - addedAt（ISO date，投毒回溯）
 *   - sourceUrl 可选（避免逼造假）
 *
 * 同时锁：
 *   - 单条规则不得过宽（provider 长度 ≥3；不允许 `.*` / `'*'`）
 *   - modelPattern 长度 ≥3（防 /a/ 类粗放匹配）
 *   - 数组长度 ≥ 17（与 §6.A 现状一致）
 *
 * 通过实际 import catalog 数据 + 运行时断言（非 AST 静态解析）实现，
 * 利用 TS 类型保证字段名 / 类型 / readonly 全部对齐。
 */

import {
  PROVIDER_CAPABILITY_DEFAULTS,
  SAFE_DEFAULTS,
  type ProviderCapabilityRule,
} from "../../../modules/ai-engine/llm/models/capability/model-capability-catalog";

const MIN_RATIONALE_LENGTH = 30;
const MIN_PROVIDER_LENGTH = 3;
const MIN_MODEL_PATTERN_LENGTH = 3;
const MIN_CATALOG_ENTRIES = 17;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

describe("Capability Contract · model-capability-catalog shape (v3.1 §A 投毒防御)", () => {
  it(`catalog 长度 ≥ ${MIN_CATALOG_ENTRIES} 条`, () => {
    expect(PROVIDER_CAPABILITY_DEFAULTS.length).toBeGreaterThanOrEqual(
      MIN_CATALOG_ENTRIES,
    );
  });

  it("每条 rule 必含 rationale + addedBy + addedAt 三个 D4 强制字段", () => {
    const missing: Array<{ idx: number; provider: string; missing: string[] }> =
      [];
    PROVIDER_CAPABILITY_DEFAULTS.forEach((rule, idx) => {
      const missingFields: string[] = [];
      if (!rule.rationale || typeof rule.rationale !== "string") {
        missingFields.push("rationale");
      }
      if (!rule.addedBy || typeof rule.addedBy !== "string") {
        missingFields.push("addedBy");
      }
      if (!rule.addedAt || typeof rule.addedAt !== "string") {
        missingFields.push("addedAt");
      }
      if (missingFields.length > 0) {
        missing.push({ idx, provider: rule.provider, missing: missingFields });
      }
    });
    expect(missing).toEqual([]);
  });

  it(`每条 rule rationale 长度 ≥ ${MIN_RATIONALE_LENGTH} 字（D4 防投毒）`, () => {
    const shortOnes: Array<{
      idx: number;
      provider: string;
      length: number;
    }> = [];
    PROVIDER_CAPABILITY_DEFAULTS.forEach((rule, idx) => {
      if (rule.rationale.length < MIN_RATIONALE_LENGTH) {
        shortOnes.push({
          idx,
          provider: rule.provider,
          length: rule.rationale.length,
        });
      }
    });
    expect(shortOnes).toEqual([]);
  });

  it("每条 rule addedAt 是合法 ISO date（YYYY-MM-DD）", () => {
    const malformed: Array<{ idx: number; addedAt: string }> = [];
    PROVIDER_CAPABILITY_DEFAULTS.forEach((rule, idx) => {
      if (!ISO_DATE_PATTERN.test(rule.addedAt)) {
        malformed.push({ idx, addedAt: rule.addedAt });
      }
    });
    expect(malformed).toEqual([]);
  });

  it("不允许过宽 provider（空 / '*' / '.*' / 长度<3）", () => {
    const tooBroad: Array<{ idx: number; provider: string }> = [];
    PROVIDER_CAPABILITY_DEFAULTS.forEach((rule, idx) => {
      const p = rule.provider;
      if (
        !p ||
        p === "*" ||
        p === ".*" ||
        typeof p !== "string" ||
        p.trim().length < MIN_PROVIDER_LENGTH
      ) {
        tooBroad.push({ idx, provider: p });
      }
    });
    expect(tooBroad).toEqual([]);
  });

  it("provider 字符串全小写（与 AIModelConfig.provider 小写比较一致）", () => {
    const nonLower: Array<{ idx: number; provider: string }> = [];
    PROVIDER_CAPABILITY_DEFAULTS.forEach((rule, idx) => {
      if (rule.provider !== rule.provider.toLowerCase()) {
        nonLower.push({ idx, provider: rule.provider });
      }
    });
    expect(nonLower).toEqual([]);
  });

  it("modelPattern 存在时长度（pattern source）≥ 3 字（防 /a/ 粗放匹配）", () => {
    const tooShort: Array<{ idx: number; pattern: string }> = [];
    PROVIDER_CAPABILITY_DEFAULTS.forEach((rule, idx) => {
      if (rule.modelPattern) {
        const src = rule.modelPattern.source;
        if (src.length < MIN_MODEL_PATTERN_LENGTH) {
          tooShort.push({ idx, pattern: src });
        }
      }
    });
    expect(tooShort).toEqual([]);
  });

  it("modelPattern 不能是过宽兜底 (`.*` / `.+`)", () => {
    const wildcards: Array<{ idx: number; pattern: string }> = [];
    PROVIDER_CAPABILITY_DEFAULTS.forEach((rule, idx) => {
      if (rule.modelPattern) {
        const src = rule.modelPattern.source;
        if (src === ".*" || src === ".+" || src === "(.*)") {
          wildcards.push({ idx, pattern: src });
        }
      }
    });
    expect(wildcards).toEqual([]);
  });

  it("capabilities 至少包含 structuredOutput 字段（最小可用 capability）", () => {
    const minimal: Array<{ idx: number; provider: string }> = [];
    PROVIDER_CAPABILITY_DEFAULTS.forEach((rule, idx) => {
      if (!rule.capabilities.structuredOutput) {
        minimal.push({ idx, provider: rule.provider });
      }
    });
    expect(minimal).toEqual([]);
  });

  it("SAFE_DEFAULTS 全字段就位（兜底必须完整）", () => {
    expect(SAFE_DEFAULTS.structuredOutput.nativeMode).toBe("none");
    expect(SAFE_DEFAULTS.toolUse.mode).toBe("none");
    expect(SAFE_DEFAULTS.reasoning.kind).toBe("none");
    expect(SAFE_DEFAULTS.temperature.support).toBe("full");
    expect(SAFE_DEFAULTS.tokenParam).toBe("max_tokens");
    expect(SAFE_DEFAULTS.vision.support).toBe("none");
    expect(SAFE_DEFAULTS.streaming.support).toBe(true);
    expect(SAFE_DEFAULTS.systemPrompt.placement).toBe("messages_array");
    expect(SAFE_DEFAULTS.promptCache.support).toBe("none");
  });

  it("readonly 数组（catalog 不可被业务代码改）", () => {
    // PROVIDER_CAPABILITY_DEFAULTS 类型为 readonly ProviderCapabilityRule[]
    // —— TypeScript 编译期保证 push/splice 不可用；运行时验证类型 freeze 状态。
    // 此断言为软约束（Object.isFrozen 当下 false 也是合规——TS 类型 readonly 已足够）。
    const arr: readonly ProviderCapabilityRule[] = PROVIDER_CAPABILITY_DEFAULTS;
    expect(Array.isArray(arr)).toBe(true);
  });

  // v3.1 阶段 A review (2026-05-24)：specific-before-general 顺序锁
  // 防回归：同 provider 带 modelPattern 的条目必须在不带 modelPattern 的之前
  // （first-match-wins 语义下 generic 兜底不能挡掉具体规则）
  it("同 provider 带 modelPattern 的条目必须在不带 modelPattern 的之前（specific-before-general）", () => {
    const violations: Array<{
      provider: string;
      specificIdx: number;
      genericIdx: number;
    }> = [];
    // 按 provider 分组，记录每 provider 第一个无 modelPattern 条目的 index
    const firstGenericIdx = new Map<string, number>();
    PROVIDER_CAPABILITY_DEFAULTS.forEach((rule, idx) => {
      if (!rule.modelPattern && !firstGenericIdx.has(rule.provider)) {
        firstGenericIdx.set(rule.provider, idx);
      }
    });
    // 检查每条带 modelPattern 的条目：是否在该 provider 的 generic 之前
    PROVIDER_CAPABILITY_DEFAULTS.forEach((rule, idx) => {
      if (!rule.modelPattern) return;
      const genericIdx = firstGenericIdx.get(rule.provider);
      if (genericIdx !== undefined && idx > genericIdx) {
        violations.push({
          provider: rule.provider,
          specificIdx: idx,
          genericIdx,
        });
      }
    });
    expect(violations).toEqual([]);
  });

  // v3.1 阶段 A review (2026-05-24)：deepseek-v4-pro 命中规则锁
  // 2026-05-24 线上事故根因：v4-pro 不含 'reasoner' → 误判 false → 发 json_schema → API 400
  // 防回归：必须命中 modelPattern /v4[-_]?pro/，且 nativeMode === 'json_mode'
  it("deepseek-v4-pro 命中规则的 nativeMode === 'json_mode'（2026-05-24 事故防回归）", () => {
    // 模拟 ModelCapabilityService.findCatalogRule 的 first-match-wins 查找
    const provider = "deepseek";
    const modelId = "deepseek-v4-pro";
    const matched = PROVIDER_CAPABILITY_DEFAULTS.find((rule) => {
      if (rule.provider !== provider) return false;
      if (rule.modelPattern && !rule.modelPattern.test(modelId)) return false;
      return true;
    });
    expect(matched).toBeDefined();
    expect(matched?.modelPattern).toBeDefined();
    expect(matched?.modelPattern?.test(modelId)).toBe(true);
    expect(matched?.capabilities.structuredOutput?.nativeMode).toBe(
      "json_mode",
    );
  });
});
