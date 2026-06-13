/**
 * NoopRuntimeEnvironment — 默认 fallback 实现
 *
 * **不要注册到 NestJS DI container。** 此类仅供单元测试 / 手动实例化使用。
 * NestJS 单例无法把 userId 通过 constructor 参数注入，会让所有 agent 共享
 * 同一个 anonymous 实例，跨用户串数据。
 *
 * 用法：
 *   new NoopRuntimeEnvironment("test-user", "test-workspace")
 *
 * 业务层未注入真实 RuntimeEnvironmentResolver 时，Harness 用本实现：
 *   - byok 永远 platform
 *   - credit 永远充足
 *   - 所有 model 永远可用
 *   - quota 永远空
 *   - suggestFallback 永远返回 abort（让 caller 自己决定）
 */

import type {
  ByokStatus,
  ICreditState,
  IFallbackHint,
  IModelAvailability,
  IQuotaSnapshot,
  IRuntimeEnvironment,
} from "../../agents/abstractions/runtime-env.interface";

// 故意不加 @Injectable —— 防止误注册到 NestJS container。
export class NoopRuntimeEnvironment implements IRuntimeEnvironment {
  constructor(
    public readonly userId: string = "anonymous",
    public readonly workspaceId?: string,
  ) {}

  async getByokStatus(): Promise<ByokStatus> {
    return "platform";
  }

  async getCreditState(): Promise<ICreditState> {
    return { balance: Number.MAX_SAFE_INTEGER, currency: "credit" };
  }

  async getModelAvailability(modelId: string): Promise<IModelAvailability> {
    return { modelId, available: true };
  }

  async listAvailableModels(): Promise<readonly IModelAvailability[]> {
    return [];
  }

  async getQuotaSnapshot(): Promise<IQuotaSnapshot> {
    return {};
  }

  async suggestFallback(input: {
    failedModelId?: string;
    reason: string;
  }): Promise<IFallbackHint> {
    return {
      action: "abort",
      reason: `noop runtime: cannot suggest fallback for ${input.reason}`,
    };
  }
}
