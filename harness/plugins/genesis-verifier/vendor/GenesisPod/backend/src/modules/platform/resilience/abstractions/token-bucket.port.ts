/**
 * Token bucket store 端口（L1 platform/resilience 抽象）
 *
 * 2026-06-03 W1-2 归位：token-bucket 是通用韧性基元（标准算法，非可换 backend），
 * 从 ai-engine/reliability/rate-limit 下沉到 platform/resilience。端口定义在被实现方
 * 所在层（L1），引擎层的 RPM 策略（RateLimitService）向下 import 该端口（L2→L1 合法）。
 */
export interface ITokenBucketStore {
  /** 试图消耗 n 个 token；成功 true，失败 false */
  tryConsume(
    key: string,
    capacity: number,
    refillPerSec: number,
    n?: number,
  ): Promise<boolean>;
}
