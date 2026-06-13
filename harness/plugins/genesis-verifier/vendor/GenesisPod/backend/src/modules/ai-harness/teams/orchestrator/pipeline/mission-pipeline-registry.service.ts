/**
 * MissionPipelineRegistry — pipeline config 注册表（v5.1 §3.1 R1-B）
 *
 * ai-app 模块在 onModuleInit 注册自己的 PipelineConfig；
 * 控制器 / API 通过 registry.get(pipelineId) 拿 config 后交给 Orchestrator 执行。
 *
 * 业务无关：registry 只存 id → config，不知道 id 含义；
 * id collision 抛错（与 plugin / output-schema registry 一致策略）。
 */
import { Injectable } from "@nestjs/common";
import {
  type MissionPipelineConfig,
  validatePipelineConfig,
} from "./mission-pipeline-config";
import { ALL_STAGE_PRIMITIVES } from "../../services/stages";
import type { IStagePrimitive } from "../../services/stages/abstractions";

@Injectable()
export class MissionPipelineRegistry {
  private readonly configs = new Map<string, MissionPipelineConfig>();
  private readonly primitives = new Map<string, IStagePrimitive>();

  constructor() {
    // 启动期把 ALL_STAGE_PRIMITIVES 注册进 primitive 表
    for (const p of ALL_STAGE_PRIMITIVES) {
      this.primitives.set(p.id, p);
    }
  }

  /** 注册 PipelineConfig（ai-app onModuleInit 调用）*/
  register(config: MissionPipelineConfig): void {
    validatePipelineConfig(config);
    if (this.configs.has(config.id)) {
      throw new Error(
        `[MissionPipelineRegistry] duplicate pipeline id: "${config.id}"`,
      );
    }
    // 校验每 step 的 primitive id 在 ALL_STAGE_PRIMITIVES 中存在
    for (const s of config.steps) {
      if (!this.primitives.has(s.primitive)) {
        throw new Error(
          `[MissionPipelineRegistry:${config.id}] step "${s.id}" references unknown primitive "${s.primitive}"`,
        );
      }
    }
    this.configs.set(config.id, config);
  }

  /** 按 id 取 config；不存在抛错 */
  get(id: string): MissionPipelineConfig {
    const c = this.configs.get(id);
    if (!c) {
      throw new Error(
        `[MissionPipelineRegistry] pipeline "${id}" not found. Did you call registry.register() in your ai-app onModuleInit?`,
      );
    }
    return c;
  }

  has(id: string): boolean {
    return this.configs.has(id);
  }

  /** 解析 step.primitive id → IStagePrimitive 实例（Orchestrator 用）*/
  resolvePrimitive(id: string): IStagePrimitive {
    const p = this.primitives.get(id);
    if (!p) {
      throw new Error(
        `[MissionPipelineRegistry] primitive "${id}" not registered`,
      );
    }
    return p;
  }

  /** 列出所有 pipeline id（按字母序）*/
  listIds(): string[] {
    return Array.from(this.configs.keys()).sort();
  }

  size(): number {
    return this.configs.size;
  }

  /** 测试用 */
  clearForTest(): void {
    this.configs.clear();
  }
}
