/**
 * v3.1 B.3 写入面共享类型 —— admin / BYOK / self-heal 写入 capability_overrides
 * 的统一入口契约。
 *
 * scope 矩阵（v3.1 §4.2 D2 修订）：
 *   - PERSONAL: user 写自己的 user_model_config 行（BYOK 路径）
 *   - ADMIN:    admin 写 ai_models 全局行（admin override 路径）
 *   - SYSTEM:   self-heal 写 user_model_config 行（actor.role='system'，§4.5）
 *
 * scope='ASSIGNED' 已删除（D2 第一期不做 observation 表，admin endpoint 自愈
 * 不允许写入；任何 ASSIGNED 入参 service 应 ForbiddenException 拒绝）。
 */

import type { ModelCapabilitiesOverrides } from "./model-capability.types";

export type CapabilityOverrideScope = "PERSONAL" | "ADMIN" | "SYSTEM";

export type CapabilityOverrideActorRole = "user" | "admin" | "system";

export type CapabilityOverrideSource =
  | "admin-override"
  | "self-heal-user"
  | "reverse-probe";

export interface CapabilityOverrideTarget {
  kind: "ai_model" | "user_model_config";
  /** 行 id（AIModel.id 或 UserModelConfig.id） */
  id: string;
}

export interface CapabilityOverrideActor {
  /** user id / 'system' for self-heal */
  id: string;
  role: CapabilityOverrideActorRole;
}

export interface ApplyOverrideOptions {
  target: CapabilityOverrideTarget;
  scope: CapabilityOverrideScope;
  actor: CapabilityOverrideActor;
  /**
   * patch 体：与现有 capability_overrides deep-merge（同 key 路径覆盖；不影响其它路径）。
   * 必须先经 ModelCapabilitiesOverridesSchema.safeParse 校验过；service 内会再 parse 一次合并结果防 typo。
   */
  patch: ModelCapabilitiesOverrides;
  source: CapabilityOverrideSource;
  /** ≥30 字符；DTO @MinLength(30) + service 入口 assert */
  reason: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ApplyOverrideResult {
  before: ModelCapabilitiesOverrides | null;
  after: ModelCapabilitiesOverrides;
}

/**
 * v3.1 §B+.4：clearOverrideTransactional 的返回。
 * after 固定为 null（整列被清）。与 ApplyOverrideResult 区分以保非 null 类型严格性。
 */
export interface ClearOverrideResult {
  before: ModelCapabilitiesOverrides | null;
  after: null;
}
