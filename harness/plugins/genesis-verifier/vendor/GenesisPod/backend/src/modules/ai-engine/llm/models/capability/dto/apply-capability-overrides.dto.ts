/**
 * v3.1 B.3 admin/BYOK capability_overrides 写入 DTO（共享）
 *
 * 校验栈（class-validator 入口层 + zod service 层双校）：
 *   - reason: @IsString + @MinLength(30) + @MaxLength(2000)
 *   - patch:  @IsObject —— service 内 ModelCapabilitiesOverridesSchema.safeParse
 *            做形状严校（zod .strict() 拒 typo）
 *
 * DELETE 路由复用 reason 字段（patch 字段忽略）。
 *
 * 放在 ai-engine/llm/models/capability/dto/ —— admin 与 BYOK 两个 controller 共享，
 * 不能放 admin/dto（ai-app/byok 跨层导）也不能放 ai-app/byok/dto（admin 跨层导）。
 */

import { IsObject, IsString, MaxLength, MinLength } from "class-validator";

import type { ModelCapabilitiesOverrides } from "../model-capability.types";

export class ApplyCapabilityOverridesDto {
  /**
   * capability_overrides patch 体（与现有 deep-merge）。
   * 形状由 ModelCapabilitiesOverridesSchema (zod .strict()) 严校于 service。
   */
  @IsObject()
  patch!: ModelCapabilitiesOverrides;

  /**
   * 写入原因，≥30 字符（audit traceability）。
   */
  @IsString()
  @MinLength(30, {
    message:
      "capability override reason must be ≥30 chars for audit traceability",
  })
  @MaxLength(2000)
  reason!: string;
}

export class DeleteCapabilityOverridesDto {
  @IsString()
  @MinLength(30, {
    message:
      "capability override reason must be ≥30 chars for audit traceability",
  })
  @MaxLength(2000)
  reason!: string;
}
