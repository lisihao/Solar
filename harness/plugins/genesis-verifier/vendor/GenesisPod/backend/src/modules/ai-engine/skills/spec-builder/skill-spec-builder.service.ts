/**
 * SkillSpecBuilder — SKILL.md 数据 → ISkillExecSpec（v5.1 R1-A0 / §3.3.2）
 *
 * 职责：
 *   把 SKILL.md frontmatter + body + outputSchemaRef 转成 runner 用的 ISkillExecSpec
 *   - 解析 allowedTools[] → 仅过滤已在 ToolRegistry 注册的 id（未注册警告但不阻塞）
 *   - 解析 outputSchemaRef → 通过 OutputSchemaRegistry 查 zod schema
 *   - 不验证 prompt body 内容（由 SkillActivator 在运行时渲染时校验）
 *
 * 设计：纯函数 + 可注入依赖（ToolRegistry + OutputSchemaRegistry），便于单测
 */
import { Injectable, Logger } from "@nestjs/common";
import type { ZodType } from "zod";
import { ToolRegistry } from "../../tools/registry/tool.registry";
import {
  OutputSchemaRegistry,
  FREE_TEXT_OUTPUT_SCHEMA,
} from "./output-schema-registry";
import type { ISkillExecSpec } from "./skill-exec-spec.interface";

/**
 * SkillSpecBuilder 输入（独立于 ISkill 行为接口）
 *
 * 来源：
 *   id / instructions / allowedTools / allowedModels / outputSchemaRef
 *   可由 SkillActivator 解析 SKILL.md 后传入
 */
export interface SkillSpecInput {
  /** Skill id（即 SKILL.md frontmatter.name）*/
  readonly id: string;
  /** SKILL.md body 渲染后的 system prompt */
  readonly instructions: string;
  /** SKILL.md frontmatter.allowedTools；undefined 表示全部允许 */
  readonly allowedTools?: ReadonlyArray<string>;
  /** SKILL.md frontmatter.allowedModels；undefined 表示由 TaskProfile 决定 */
  readonly allowedModels?: ReadonlyArray<string>;
  /** SKILL.md frontmatter.outputSchemaRef；undefined 时用 z.unknown() */
  readonly outputSchemaRef?: string;
  /** 调试 metadata */
  readonly version?: string;
  readonly domain?: string;
}

@Injectable()
export class SkillSpecBuilder {
  private readonly logger = new Logger(SkillSpecBuilder.name);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly outputSchemaRegistry: OutputSchemaRegistry,
  ) {}

  /**
   * 从 SkillSpecInput 构建 ISkillExecSpec
   *
   * @throws Error 如果 outputSchemaRef 指定但未在 OutputSchemaRegistry 注册
   *               （fail-fast：避免 runner 运行时才发现 schema 缺失）
   */
  build(input: SkillSpecInput): ISkillExecSpec {
    return {
      id: input.id,
      systemPrompt: input.instructions,
      allowedToolIds: this.resolveAllowedTools(input.id, input.allowedTools),
      allowedModels: input.allowedModels ?? [],
      outputSchema: this.resolveOutputSchema(input.id, input.outputSchemaRef),
      meta: {
        skillVersion: input.version,
        skillDomain: input.domain,
      },
    };
  }

  /**
   * 解析 allowedTools：过滤掉未在 ToolRegistry 注册的 id（warn but continue）
   * undefined 输入 → 返回空数组，runner 自行决定（按 v5.1 §3.3.2 默认全开）
   */
  private resolveAllowedTools(
    skillId: string,
    allowedTools: ReadonlyArray<string> | undefined,
  ): string[] {
    if (!allowedTools) return [];
    const validIds: string[] = [];
    for (const id of allowedTools) {
      if (this.toolRegistry.has(id)) {
        validIds.push(id);
      } else {
        this.logger.warn(
          `[SkillSpecBuilder] skill "${skillId}" declares allowedTool "${id}" which is not registered in ToolRegistry; ignoring`,
        );
      }
    }
    return validIds;
  }

  /**
   * 解析 outputSchemaRef：未指定 → z.unknown()；指定但未注册 → fail-fast
   */
  private resolveOutputSchema(
    skillId: string,
    ref: string | undefined,
  ): ZodType {
    if (!ref) return FREE_TEXT_OUTPUT_SCHEMA;
    if (!this.outputSchemaRegistry.has(ref)) {
      throw new Error(
        `[SkillSpecBuilder] skill "${skillId}" references outputSchema "${ref}" which is not registered. ` +
          `Did you call outputSchemaRegistry.register("${ref}", schema) in your ai-app onModuleInit?`,
      );
    }
    return this.outputSchemaRegistry.get(ref);
  }
}
