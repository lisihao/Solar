/**
 * Stage-boundary contract assertions (CI mechanism, 2026-05-22)
 *
 * 治理"契约不同源/漂移"这一类系统性 bug：管线(生产方)算出的值落在 agent
 * inputSchema(消费方)约束之外 → 运行时 InputValidationError → 整个 mission 崩。
 * 历史上反复发生（targetChapterCount 管线[1,25] vs schema[3,25] 等）。
 *
 * 原则（与 ai-app 业务方约定）：
 *   - agent inputSchema 是某输入"合法范围"的**唯一真源**（只编码不变量：类型 +
 *     绝对上下限），不编码业务档位。
 *   - 业务策略（如"章节数随证据走"）单一源在 app 一处常量；生产方 clamp 到该常量。
 *   - 本模块提供 CI 断言：机械验证"生产方能产出的范围 ⊆ 消费方 schema 接受范围"。
 *     任一边漂移 → 契约测试编译期/CI 红，漂移合不进主干。
 *
 * 用法（在 agent 的 *.contract.spec.ts 里）：
 *   const r = assertNumberProducerWithinSchema({
 *     agent: DimensionOutlinePlannerAgent,
 *     field: "targetChapterCount",
 *     producerMin: CHAPTER_COUNT_RANGE.min,
 *     producerMax: CHAPTER_COUNT_RANGE.max,
 *   });
 *   expect(r.ok).toBe(true); // 漂移时 r.ok=false + r.reason 指明哪边超界
 */

import { z } from "zod";
import { readDefineAgentMeta } from "./agent-spec.base";

/** number 字段的上下限（从 Zod schema 内省得到）。无显式约束时为 ±Infinity。 */
export interface NumberFieldBounds {
  min: number;
  max: number;
  /** 是否找到了一个 ZodNumber（false = 字段不存在或非 number） */
  found: boolean;
}

/** 解开 ZodOptional / ZodDefault / ZodEffects / ZodNullable 到内层 schema。 */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let cur: z.ZodTypeAny = schema;
  // 防御无限循环：最多解 10 层
  for (let i = 0; i < 10; i++) {
    const def = (cur as { _def?: Record<string, unknown> })._def;
    if (!def) return cur;
    if ("innerType" in def && def.innerType) {
      cur = def.innerType as z.ZodTypeAny; // ZodOptional / ZodDefault / ZodNullable
      continue;
    }
    if ("schema" in def && def.schema) {
      cur = def.schema as z.ZodTypeAny; // ZodEffects (refine/transform)
      continue;
    }
    return cur;
  }
  return cur;
}

/** 从 ZodObject 取某 number 字段的 [min,max]（处理 optional/default/effects 包裹）。 */
export function getNumberFieldBounds(
  objectSchema: z.ZodTypeAny,
  field: string,
): NumberFieldBounds {
  const obj = unwrap(objectSchema);
  const shapeFn = (obj as { _def?: { shape?: unknown } })._def?.shape;
  const shape =
    typeof shapeFn === "function"
      ? (shapeFn as () => Record<string, z.ZodTypeAny>)()
      : ((obj as { shape?: Record<string, z.ZodTypeAny> }).shape ?? {});
  const raw = shape[field];
  if (!raw) return { min: -Infinity, max: Infinity, found: false };
  const inner = unwrap(raw);
  const checks =
    (inner as { _def?: { checks?: Array<{ kind: string; value?: number }> } })
      ._def?.checks ?? [];
  // 仅当内层确为 ZodNumber 才算找到
  const typeName = (inner as { _def?: { typeName?: string } })._def?.typeName;
  if (typeName !== "ZodNumber")
    return { min: -Infinity, max: Infinity, found: false };
  let min = -Infinity;
  let max = Infinity;
  for (const c of checks) {
    if (c.kind === "min" && typeof c.value === "number") min = c.value;
    if (c.kind === "max" && typeof c.value === "number") max = c.value;
  }
  return { min, max, found: true };
}

export interface ContractAssertResult {
  ok: boolean;
  field: string;
  agentId?: string;
  schemaMin: number;
  schemaMax: number;
  producerMin: number;
  producerMax: number;
  reason?: string;
}

/**
 * 断言"生产方数值范围 [producerMin, producerMax] ⊆ 消费方 agent schema 接受范围"。
 *
 * 传 agent class（读 @DefineAgent 的 inputSchema）或直接传 schema。
 */
export function assertNumberProducerWithinSchema(opts: {
  agent?: new (...args: never[]) => unknown;
  schema?: z.ZodTypeAny;
  field: string;
  producerMin: number;
  producerMax: number;
}): ContractAssertResult {
  let schema = opts.schema;
  let agentId: string | undefined;
  if (!schema && opts.agent) {
    const meta = readDefineAgentMeta(opts.agent);
    schema = meta?.inputSchema as z.ZodTypeAny | undefined;
    agentId = meta?.id;
  }
  const base = {
    field: opts.field,
    agentId,
    producerMin: opts.producerMin,
    producerMax: opts.producerMax,
  };
  if (!schema) {
    return {
      ...base,
      ok: false,
      schemaMin: NaN,
      schemaMax: NaN,
      reason: "no inputSchema found on agent",
    };
  }
  const bounds = getNumberFieldBounds(schema, opts.field);
  if (!bounds.found) {
    return {
      ...base,
      ok: false,
      schemaMin: NaN,
      schemaMax: NaN,
      reason: `field "${opts.field}" is not a number field on the schema`,
    };
  }
  const issues: string[] = [];
  if (opts.producerMin < bounds.min) {
    issues.push(
      `producer 可产出 ${opts.producerMin} < schema min ${bounds.min}（稀缺输入会被 schema 拒）`,
    );
  }
  if (opts.producerMax > bounds.max) {
    issues.push(
      `producer 可产出 ${opts.producerMax} > schema max ${bounds.max}`,
    );
  }
  return {
    ...base,
    ok: issues.length === 0,
    schemaMin: bounds.min,
    schemaMax: bounds.max,
    reason: issues.length ? issues.join("; ") : undefined,
  };
}
