/**
 * Prompt Version & Hash Metadata
 *
 * ★ Evaluation-driven optimization foundation
 *
 * 目的：让每一份质量评分都能回溯到"哪个 prompt 版本 + 哪个模型"的组合，
 * 从而支撑业界标准的 prompt telemetry（LangSmith / Langfuse / PromptLayer 风格）。
 *
 * 维护规则：
 * - 变更任一 prompt 模板字符串时，手工 bump 对应的版本号（语义化）
 * - 自动计算的 hash 用于精确比对（版本号可能同版本内微调，hash 不同）
 * - hash 取 sha256 前 16 hex 字符，足够去重且不浪费存储
 */

import { createHash } from "crypto";
import {
  SECTION_WRITING_SYSTEM_PROMPT,
  DIMENSION_RESEARCH_SYSTEM_PROMPT,
} from "./dimension-research.prompt";
import { REPORT_SYNTHESIS_SYSTEM_PROMPT } from "./report-synthesis.prompt";
import { REPORT_EDITING_SYSTEM_PROMPT } from "./report-editing.prompt";

/** 计算 prompt 的稳定哈希（前 16 hex 字符） */
export function hashPrompt(template: string): string {
  return createHash("sha256")
    .update(template, "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** Prompt 元数据 */
export interface PromptMetadata {
  version: string;
  hash: string;
}

/**
 * 已知 prompt 的版本号（变更 template 时 bump）。
 * 采用语义化版本：
 * - 小范围微调（措辞、排版）：+0.1
 * - 增删维度/要求/输出格式：+1.0
 */
export const PROMPT_VERSIONS = {
  SECTION_WRITING: "v3.1",
  DIMENSION_RESEARCH: "v3.0",
  REPORT_SYNTHESIS: "v3.0",
  REPORT_EDITING: "v2.1",
  SECTION_SELF_EVAL: "v1.0",
  REPORT_EVALUATION: "v1.0",
  SECTION_REMEDIATION: "v1.0",
} as const;

export type PromptName = keyof typeof PROMPT_VERSIONS;

/**
 * 构建期预计算的 prompt 元数据表。
 * 模块加载时一次性计算，运行时 O(1) 读取。
 */
export const PROMPT_METADATA: Record<PromptName, PromptMetadata> = {
  SECTION_WRITING: {
    version: PROMPT_VERSIONS.SECTION_WRITING,
    hash: hashPrompt(SECTION_WRITING_SYSTEM_PROMPT),
  },
  DIMENSION_RESEARCH: {
    version: PROMPT_VERSIONS.DIMENSION_RESEARCH,
    hash: hashPrompt(DIMENSION_RESEARCH_SYSTEM_PROMPT),
  },
  REPORT_SYNTHESIS: {
    version: PROMPT_VERSIONS.REPORT_SYNTHESIS,
    hash: hashPrompt(REPORT_SYNTHESIS_SYSTEM_PROMPT),
  },
  REPORT_EDITING: {
    version: PROMPT_VERSIONS.REPORT_EDITING,
    hash: hashPrompt(REPORT_EDITING_SYSTEM_PROMPT),
  },
  // 以下 prompt 在 quality 服务里是 inline 字符串，hash 不能在此预计算；
  // 暂时仅暴露 version，hash 在对应服务内按需计算。
  SECTION_SELF_EVAL: {
    version: PROMPT_VERSIONS.SECTION_SELF_EVAL,
    hash: "inline", // inline in section-self-eval.service.ts
  },
  REPORT_EVALUATION: {
    version: PROMPT_VERSIONS.REPORT_EVALUATION,
    hash: "inline", // inline in report-evaluation.service.ts
  },
  SECTION_REMEDIATION: {
    version: PROMPT_VERSIONS.SECTION_REMEDIATION,
    hash: "inline", // inline in section-remediation.service.ts
  },
};

/** 获取 prompt 元数据（带 fallback） */
export function getPromptMetadata(name: PromptName): PromptMetadata {
  return PROMPT_METADATA[name];
}
