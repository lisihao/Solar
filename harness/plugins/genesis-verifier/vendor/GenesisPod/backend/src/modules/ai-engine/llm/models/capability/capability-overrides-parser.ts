/**
 * capability_overrides JSONB 解析器 —— v3.1 §3.4 优先级 #1/#2 入口
 *
 * 从 ai-model-config.service.ts 抽出（review 2026-05-24 Fix-3），
 * 避免 service god-class 雪崩；B.3/B.4/B.5 复用此纯函数。
 *
 * 行为契约（fail-open）：
 *   - raw === null / undefined → 返回 undefined（行为不变）
 *   - safeParse 成功 → 返回 parsed data
 *   - safeParse 失败 → logger.warn + 返回 undefined（不抛，业务不崩）
 *
 * 必须用 safeParse 不用 parse —— parse throw 会冒泡破坏整个 buildModelConfig，
 * 让 cache 刷新挂掉，影响面失控。
 */
import type { Logger } from "@nestjs/common";

import {
  ModelCapabilitiesOverridesSchema,
  type ModelCapabilitiesOverrides,
} from "./model-capability.types";

export interface ParseCapabilityOverridesOptions {
  /** 来源类别 —— 仅用于 warn 日志区分（admin = AIModel 行 / user = UserModelConfig 行） */
  kind: "admin" | "user";
  /** 模型 id —— 仅用于 warn 日志定位（"<unknown>" 守护未知输入） */
  modelId: string;
  /** 日志器（service 实例的 logger 透传进来，沿用同 context） */
  logger: Logger;
}

/**
 * 解析 capability_overrides JSONB 列；非法 → warn + undefined。
 *
 * @param raw   DB Prisma JSON 字段（unknown 收口；可能是 null/object/任意 JSON）
 * @param opts  日志元数据 + logger
 * @returns     合法 override / undefined（null + 非法都回 undefined）
 */
export function parseCapabilityOverrides(
  raw: unknown,
  opts: ParseCapabilityOverridesOptions,
): ModelCapabilitiesOverrides | undefined {
  if (raw === null || raw === undefined) return undefined;
  const result = ModelCapabilitiesOverridesSchema.safeParse(raw);
  if (result.success) return result.data;
  opts.logger.warn(
    `[parseCapabilityOverrides] ${opts.kind} override rejected for modelId=${opts.modelId}; ` +
      `issues=${JSON.stringify(result.error.issues).slice(0, 200)}`,
  );
  return undefined;
}
