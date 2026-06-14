/**
 * CapabilityFeatureFlagsService —— v3.1 §B.7 feature flag 体系
 *
 * 3 个旗标：
 *   - ENABLE_CAPABILITY_SELF_HEAL    self-heal 总开关（默认开）
 *   - ENABLE_CAPABILITY_PROBE        probe daemon 总开关（默认开）
 *   - ENABLE_CAPABILITY_OVERRIDES_WRITE  admin/BYOK 写入开关（默认开）
 *
 * 解析优先级（每个旗标）：
 *   1. Redis key `capability:flags:<NAME>`（可热切换，最高优）
 *      - 值 'true'/'1' → 开；'false'/'0' → 关；其它/缺失 → fallback
 *   2. process.env.<NAME>（同上语义）
 *   3. 硬编码默认 true（兜底）
 *
 * 缓存：Redis 查询不缓存（旗标量小 + 调用频率低；热切换语义要求实时）。
 *   若热路径性能问题，B+ 加 5s in-memory TTL 缓存。
 *
 * fail-open：Redis 查询异常 → fallback env / 默认值（不阻断业务）。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";

import { CacheService } from "../../../../../common/cache/cache.service";

const REDIS_PREFIX = "capability:flags:";

export type FlagName =
  | "ENABLE_CAPABILITY_SELF_HEAL"
  | "ENABLE_CAPABILITY_PROBE"
  | "ENABLE_CAPABILITY_OVERRIDES_WRITE";

@Injectable()
export class CapabilityFeatureFlagsService {
  private readonly logger = new Logger(CapabilityFeatureFlagsService.name);

  constructor(@Optional() private readonly cache?: CacheService) {}

  async isSelfHealEnabled(): Promise<boolean> {
    return this.resolveFlag("ENABLE_CAPABILITY_SELF_HEAL");
  }

  async isProbeEnabled(): Promise<boolean> {
    return this.resolveFlag("ENABLE_CAPABILITY_PROBE");
  }

  async isOverridesWriteEnabled(): Promise<boolean> {
    return this.resolveFlag("ENABLE_CAPABILITY_OVERRIDES_WRITE");
  }

  /**
   * 解析单个 flag：Redis → env → 默认 true。
   *
   * Redis 值 'true'/'1' = 开，'false'/'0' = 关；其它 = 不命中（继续 fallback）。
   * env 同语义；不设 = 不命中。
   */
  private async resolveFlag(name: FlagName): Promise<boolean> {
    // 1. Redis 优先（热切换）
    if (this.cache) {
      try {
        const redisVal = await this.cache.get<string>(`${REDIS_PREFIX}${name}`);
        if (redisVal !== undefined) {
          const parsed = parseBool(redisVal);
          if (parsed !== null) return parsed;
        }
      } catch (err) {
        this.logger.warn(
          `[flags] redis read failed for ${name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    // 2. env fallback
    const envVal = process.env[name];
    if (envVal !== undefined) {
      const parsed = parseBool(envVal);
      if (parsed !== null) return parsed;
    }
    // 3. 默认开
    return true;
  }
}

function parseBool(v: string | undefined | null): boolean | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "on" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "off" || s === "no") return false;
  return null;
}
