import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from "class-validator";

/**
 * ★ Security: bounded-size JSON validator
 *
 * 防御巨型 topicConfig 等 Record<string, unknown> 字段的 DoS 向量：
 * - 限制序列化后 ≤ 20KB
 * - 限制递归深度 ≤ 5 层（防深度嵌套内存攻击）
 * - 仅接受 plain object（拒绝 array）
 */
@ValidatorConstraint({ name: "IsBoundedJsonObject", async: false })
export class IsBoundedJsonObjectConstraint implements ValidatorConstraintInterface {
  private static readonly MAX_BYTES = 20_000;
  private static readonly MAX_DEPTH = 5;

  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== "object" || Array.isArray(value)) return false;

    if (!this.withinDepth(value, IsBoundedJsonObjectConstraint.MAX_DEPTH)) {
      return false;
    }

    try {
      const serialized = JSON.stringify(value);
      return (
        Buffer.byteLength(serialized, "utf8") <=
        IsBoundedJsonObjectConstraint.MAX_BYTES
      );
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a plain object, max 20KB serialized, max depth 5`;
  }

  private withinDepth(value: unknown, depth: number): boolean {
    if (depth < 0) return false;
    if (value === null || typeof value !== "object") return true;
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (!this.withinDepth(v, depth - 1)) return false;
    }
    return true;
  }
}
