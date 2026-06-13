import { createHash } from "crypto";

/**
 * API Key 健康状态（内部使用）
 */
interface KeyHealth {
  failedAt: number;
  errorCode: number;
}

/**
 * API Key 健康状态（对外导出）
 */
export interface KeyHealthStatus {
  /** 密钥序号 (0-indexed) */
  index: number;
  /** 脱敏显示的密钥 (如 tvly-abcd****xyz) */
  maskedKey: string;
  /** 是否健康可用 */
  isHealthy: boolean;
  /** 最近错误码 (如 HTTP 429) */
  lastError?: string;
  /** 冷却结束时间 (ISO 格式) */
  cooldownUntil?: string;
}

/**
 * 多密钥管理器
 * 提供 API Key 轮换、健康状态追踪、冷却期管理
 *
 * @example
 * ```typescript
 * const manager = new MultiKeyManager('jina', 5 * 60 * 1000);
 * const key = manager.getHealthyKey(keys);
 * if (error) manager.markKeyFailed(key, 429);
 * ```
 */
export class MultiKeyManager {
  /** Key 健康状态 (hash -> KeyHealth) */
  private keyHealthMap = new Map<string, KeyHealth>();
  /** 当前 Key 索引 (用于 Round-Robin) */
  private keyIndex = 0;

  constructor(
    /** 服务标识（用于日志） */
    private readonly serviceName: string,
    /** 冷却时间（毫秒），默认 5 分钟 */
    private readonly cooldownMs: number = 5 * 60 * 1000,
  ) {}

  /**
   * 获取 Key 的哈希值（用于健康状态追踪，避免明文存储）
   */
  private getKeyHash(key: string): string {
    return createHash("sha256")
      .update(`${this.serviceName}:${key}`)
      .digest("hex")
      .substring(0, 16);
  }

  /**
   * 获取用于显示的脱敏密钥
   * 显示前8位 + **** + 后3位
   */
  getMaskedKey(key: string): string {
    if (!key || key.length < 10) {
      return "****";
    }
    const prefix = key.substring(0, 8);
    const suffix = key.substring(key.length - 3);
    return `${prefix}****${suffix}`;
  }

  /**
   * 检查 Key 是否健康（未失败或冷却期已过）
   */
  isKeyHealthy(key: string): boolean {
    const hash = this.getKeyHash(key);
    const health = this.keyHealthMap.get(hash);
    if (!health) return true;
    return Date.now() - health.failedAt >= this.cooldownMs;
  }

  /**
   * 获取一个健康的 Key（Round-Robin 轮换）
   * @returns 健康的 Key，如果全部不健康则返回第一个
   */
  getHealthyKey(keys: string[]): string | null {
    if (!keys || keys.length === 0) return null;

    const startIndex = this.keyIndex;
    let attempts = 0;

    while (attempts < keys.length) {
      const key = keys[this.keyIndex];
      this.keyIndex = (this.keyIndex + 1) % keys.length;
      attempts++;

      if (this.isKeyHealthy(key)) {
        return key;
      }
    }

    // 所有 Key 都不健康，返回第一个（等待冷却最久的）
    this.keyIndex = (startIndex + 1) % keys.length;
    return keys[startIndex];
  }

  /**
   * 标记 Key 失败
   */
  markKeyFailed(key: string, errorCode: number): void {
    const hash = this.getKeyHash(key);
    this.keyHealthMap.set(hash, {
      failedAt: Date.now(),
      errorCode,
    });
  }

  /**
   * 清除 Key 的失败状态（成功时调用）
   */
  clearKeyFailure(key: string): void {
    const hash = this.getKeyHash(key);
    this.keyHealthMap.delete(hash);
  }

  /**
   * 获取所有 Key 的健康状态（供管理后台展示）
   */
  getKeyHealthStatus(keys: string[]): KeyHealthStatus[] {
    const now = Date.now();

    return keys.map((key, index) => {
      const hash = this.getKeyHash(key);
      const health = this.keyHealthMap.get(hash);
      const isHealthy = !health || now - health.failedAt >= this.cooldownMs;

      let cooldownUntil: string | undefined;
      if (health && !isHealthy) {
        const cooldownEnd = new Date(health.failedAt + this.cooldownMs);
        cooldownUntil = cooldownEnd.toISOString();
      }

      return {
        index,
        maskedKey: this.getMaskedKey(key),
        isHealthy,
        lastError: health ? `HTTP ${health.errorCode}` : undefined,
        cooldownUntil,
      };
    });
  }

  /**
   * 判断错误码是否应该触发 Key 标记失败
   */
  static shouldMarkFailed(errorCode: number): boolean {
    // 401 Unauthorized - 无效 Key
    // 429 Too Many Requests - 配额耗尽
    // 432 Custom rate limit (some APIs)
    // 5xx - 服务器错误
    return [401, 429, 432, 500, 502, 503, 504].includes(errorCode);
  }
}

/**
 * 全局多密钥管理器注册表
 * 用于跨服务共享管理器实例
 */
export class MultiKeyRegistry {
  private static managers = new Map<string, MultiKeyManager>();

  /**
   * 获取或创建服务的多密钥管理器
   */
  static getManager(serviceName: string, cooldownMs?: number): MultiKeyManager {
    let manager = this.managers.get(serviceName);
    if (!manager) {
      manager = new MultiKeyManager(serviceName, cooldownMs);
      this.managers.set(serviceName, manager);
    }
    return manager;
  }

  /**
   * 获取服务的健康状态（如果管理器存在）
   */
  static getHealthStatus(
    serviceName: string,
    keys: string[],
  ): KeyHealthStatus[] {
    const manager = this.managers.get(serviceName);
    if (!manager) {
      // 没有管理器，返回全部健康状态
      return keys.map((key, index) => ({
        index,
        maskedKey: new MultiKeyManager(serviceName).getMaskedKey(key),
        isHealthy: true,
      }));
    }
    return manager.getKeyHealthStatus(keys);
  }
}
