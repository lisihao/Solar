/**
 * World Building Types — engine 自有
 *
 * 2026-05-01 (PR-X-M3): 从 ai-harness/runner/executor/interfaces.ts 搬到
 * engine。harness/runner/executor/interfaces.ts re-export 保兼容。
 *
 * 注：HardConstraint / CoreEntity 是跨层共享 domain entity，
 * owner = engine（world-building 是 entity 提取者）。harness 那边的
 * mission-context.interface.ts re-export from engine 消除双定义。
 */

import type { AiCallerFn } from "@/modules/ai-engine/llm/types/ai-caller.types";

/** 世界观设定 - 时代背景 */
export interface WorldSettingsEra {
  period: string;
  year?: string;
  description: string;
}

/** 世界观设定 - 人物 */
export interface WorldSettingsCharacter {
  name: string;
  role: string;
  identity: string;
  traits: string[];
  constraints: string[];
}

/** 世界观设定 - 阵营 */
export interface WorldSettingsFaction {
  name: string;
  description: string;
  keyMembers: string[];
}

/** 世界观设定（完整结构） */
export interface WorldSettings {
  era: WorldSettingsEra;
  characters: WorldSettingsCharacter[];
  factions: WorldSettingsFaction[];
  coreRules: string[];
  prohibitions: string[];
}

/** 内容类型 */
export type ContentType = "novel" | "document" | "research" | "other";

/** 硬性约束 — 跨层共享 domain entity（与 AI Teams 兼容） */
export interface HardConstraint {
  id: string;
  rule: string;
  reason?: string;
  severity: "MUST" | "SHOULD";
}

/** 核心实体 — 跨层共享 domain entity（与 AI Teams 兼容） */
export interface CoreEntity {
  name: string;
  type: string;
  definition: string;
  attributes?: Record<string, string>;
  /**
   * 实体关系（2026-05-01 PR-X-O 从 harness mission-context 合并到这里，
   * 消除双定义；harness side 改 re-export 自此）
   * 例：人物 A 与 阵营 B 的从属关系；组件 X 依赖组件 Y。
   */
  relations?: Array<{
    target: string;
    relation: string;
  }>;
}

/** 世界观构建结果 */
export interface WorldBuildingResult {
  needed: boolean;
  contentType: ContentType;
  settings?: WorldSettings;
  hardConstraints?: HardConstraint[];
  entities?: CoreEntity[];
  tokensUsed: number;
}

/** 上下文初始化服务接口（世界观设定） */
export interface IContextInitializationService {
  detectContentType(
    title: string,
    description: string,
  ): { needed: boolean; contentType: ContentType };

  generateWorldSettings(
    title: string,
    description: string,
    contentType: ContentType,
    aiCaller: AiCallerFn,
    aiModel: string,
  ): Promise<{ settings: WorldSettings; tokensUsed: number }>;

  settingsToConstraints(settings: WorldSettings): HardConstraint[];

  settingsToEntities(settings: WorldSettings): CoreEntity[];

  buildWorldContext(
    title: string,
    description: string,
    aiCaller: AiCallerFn,
    aiModel: string,
  ): Promise<WorldBuildingResult>;
}
