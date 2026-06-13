/**
 * CapabilityRegistry —— 能力执行端口注册表（平台共享，@Global via MarketplaceModule）。
 *
 * 能力家在 onModuleInit 注册自己的 runner；消费方（company / 任何 app）按 manifest.id
 * （可选 version）解析 runner 后执行。与 MissionPipelineRegistry（recipe 注册）对称：
 * 那个管"配方注册"，这个管"按市场 id 解析到可执行能力"——闭合"采用引用→执行"链路。
 */
import { Injectable, Logger } from "@nestjs/common";
import { capabilityKey, type CapabilityManifest } from "./capability-manifest";
import type { ICapabilityRunner } from "./capability-runner.port";

@Injectable()
export class CapabilityRegistry {
  private readonly log = new Logger(CapabilityRegistry.name);
  /** key = `${id}@${version}` */
  private readonly runners = new Map<string, ICapabilityRunner>();
  /** id → 最新版本（resolve 只给 id 时取此）。今天每 id 仅一版。 */
  private readonly latest = new Map<string, string>();

  /** 能力家 onModuleInit 调用，注册一个可执行能力。 */
  register(runner: ICapabilityRunner): void {
    const { id, version } = runner.manifest;
    const key = capabilityKey(id, version);
    if (this.runners.has(key)) {
      this.log.warn(`capability "${key}" 已注册，忽略重复注册`);
      return;
    }
    this.runners.set(key, runner);
    this.latest.set(id, version); // 单版现状：直接覆盖为最新
    this.log.log(`registered capability "${key}" (${runner.manifest.kind})`);
  }

  /**
   * 按 id（可选 version）解析 runner。
   * 不给 version → 取该 id 最新（兼容现状裸 listingId）。未来公开市场可在此做
   * semver range 协商。
   */
  resolve(id: string, version?: string): ICapabilityRunner | undefined {
    const v = version ?? this.latest.get(id);
    if (!v) return undefined;
    return this.runners.get(capabilityKey(id, v));
  }

  /** 列出所有已注册能力的 manifest（目录投影可用）。 */
  list(): CapabilityManifest[] {
    return Array.from(this.runners.values()).map((r) => r.manifest);
  }

  /** 测试用。 */
  clearForTest(): void {
    this.runners.clear();
    this.latest.clear();
  }
}
