/**
 * KeyCooldownPolicy —— 密钥失效熔断时长的单一真源（W1 共享原语，2026-05-29）。
 *
 * 背景：密钥体系收敛重构（docs/architecture/secret-system-consolidation-plan.md）W1。
 * 此前两套熔断各写一份：
 *   - user_api_keys（LLM）：KeyErrorClassifier 按错误分类给动态 cooldownMs（成熟）。
 *   - secret_keys（admin/BYOK 工具）：SecretKeysService.pickActiveKey 固定 5min，不分错误类型。
 * W1 把"错误码 → cooldown 时长"的策略抽成这一份纯函数，两路复用：
 *   - classifier 复用下面的常量（DRY，行为不变）；
 *   - secret_keys.pickActiveKey 改用 cooldownMsForCode(lastErrorCode)，升级为动态熔断。
 *
 * 纯函数，无 NestJS 依赖，可被任意层 import。
 */

/** 标准熔断时长档（ms）。INFINITE = 永久熔断，直到手动 replace / re-test。 */
export const KEY_COOLDOWN_MS = {
  /** 瞬时类（超时）：很快自愈 */
  SHORT: 30 * 1000,
  /** 限流类：分钟级自愈 */
  RATE_LIMIT: 60 * 1000,
  /** provider 级故障 / 未分类失败：保守中等冷却（保持 secret_keys 旧默认） */
  PROVIDER_OR_UNKNOWN: 5 * 60 * 1000,
  /** 坏 key / 配额耗尽 / 解密失败：等人工处理（替换 / 充值），不自动重试 */
  INFINITE: Number.POSITIVE_INFINITY,
} as const;

/**
 * 把归一化错误码映射到 key 自身的熔断时长（ms）。
 *
 * 兼容两套来源的错误码：
 *   - KeyErrorClassifier 的 reason（AUTH_FAILED / RATE_LIMIT_KEY / QUOTA_EXCEEDED / TIMEOUT / PROVIDER_DOWN / ...）
 *   - ProviderProbe / SearchService 的 lastErrorCode（含 QUOTA_EXHAUSTED / NETWORK_ERROR / DECRYPTION_FAILED / RATE_LIMIT_KEY / ...）
 *
 * 未识别 / null / 空 → PROVIDER_OR_UNKNOWN（保守 5min，保持 secret_keys 旧行为，不至于把没标准错误码的失败永久熔断）。
 */
export function cooldownMsForCode(code: string | null | undefined): number {
  switch ((code ?? "").toUpperCase()) {
    // 坏 key / 解密失败 / 配额耗尽 → 永久熔断（等替换或充值）
    case "AUTH_FAILED":
    case "DECRYPTION_FAILED":
    case "QUOTA_EXCEEDED":
    case "QUOTA_EXHAUSTED":
      return KEY_COOLDOWN_MS.INFINITE;
    // 限流（单 key / provider）→ 分钟级
    case "RATE_LIMIT_KEY":
    case "RATE_LIMIT":
    case "RATE_LIMIT_PROVIDER":
      return KEY_COOLDOWN_MS.RATE_LIMIT;
    // 超时 → 短冷却
    case "TIMEOUT":
      return KEY_COOLDOWN_MS.SHORT;
    // provider 级故障 → 中等冷却
    case "PROVIDER_DOWN":
    case "PROVIDER_5XX":
    case "NETWORK_ERROR":
      return KEY_COOLDOWN_MS.PROVIDER_OR_UNKNOWN;
    // 未分类 / 未知 → 保守中等（与 secret_keys 旧固定 5min 一致）
    default:
      return KEY_COOLDOWN_MS.PROVIDER_OR_UNKNOWN;
  }
}

/** 是否永久熔断（直到人工 replace / re-test）。 */
export function isPermanentCooldown(ms: number): boolean {
  return !Number.isFinite(ms);
}
