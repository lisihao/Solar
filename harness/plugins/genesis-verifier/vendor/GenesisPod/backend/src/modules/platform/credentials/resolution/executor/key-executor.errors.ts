import {
  BYOKError,
  BYOK_ERROR_CODES,
} from "../key-resolver/key-resolver.errors";
import { ClassifiedError } from "@/modules/platform/credentials/governance/key-health/key-error-classifier";

/**
 * Failover 专用错误码（扩展 BYOK_ERROR_CODES）。
 * 设计：复用现有 BYOKError 基类，让前端按 code 路由 UI 提示。
 */
export const FAILOVER_ERROR_CODES = {
  ALL_KEYS_FAILED: "ALL_KEYS_FAILED",
  PROVIDER_COOLDOWN: "PROVIDER_COOLDOWN",
} as const;

/**
 * AllKeysFailedError — chain 内全部 key 都尝试过且都失败。
 * meta.attempts 记录每把 key 的失败原因，便于前端展示明细。
 */
export class AllKeysFailedError extends BYOKError {
  constructor(
    provider: string,
    triedCount: number,
    lastError: ClassifiedError | null,
  ) {
    super(
      // 复用 BYOK_ERROR_CODES 类型定义，但用扩展字符串（运行时 OK，类型用 as cast）
      BYOK_ERROR_CODES.NO_AVAILABLE_KEY,
      `All ${triedCount} API key(s) for provider "${provider}" failed. ` +
        `Last error: ${lastError?.reason ?? "unknown"} - ${lastError?.originalMessage ?? ""}`,
      {
        provider,
        triedCount,
        lastReason: lastError?.reason,
        lastMessage: lastError?.originalMessage,
        canRequest: true,
        requestUrl: "/settings/api-keys",
      },
    );
    // 覆盖 code 字段为 ALL_KEYS_FAILED（特例：前端按此判断）
    Object.defineProperty(this, "code", {
      value: FAILOVER_ERROR_CODES.ALL_KEYS_FAILED,
      writable: false,
      enumerable: true,
    });
  }
}

/**
 * ProviderCooldownError — provider 级 cooldown 期间调用被短路。
 * 业务可在前端展示 "Service temporarily unavailable, please retry in N minutes"。
 */
export class ProviderCooldownError extends BYOKError {
  /** 距 cooldown 解除的剩余毫秒数，供上层（react-loop）按实际时长退避等待。 */
  readonly remainingMs?: number;

  constructor(provider: string, remainingMs?: number) {
    super(
      BYOK_ERROR_CODES.NO_AVAILABLE_KEY,
      `Provider "${provider}" is temporarily unavailable (cooldown). Please try again later.`,
      {
        provider,
        canRequest: false,
      },
    );
    Object.defineProperty(this, "code", {
      value: FAILOVER_ERROR_CODES.PROVIDER_COOLDOWN,
      writable: false,
      enumerable: true,
    });
    this.remainingMs = remainingMs;
  }
}
