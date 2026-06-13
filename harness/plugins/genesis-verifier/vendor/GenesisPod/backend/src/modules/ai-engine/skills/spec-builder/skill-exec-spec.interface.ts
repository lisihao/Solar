/**
 * ISkillExecSpec — agent runner 的精简执行规约（v5.1 R1-A0 / §3.3.2）
 *
 * 设计：从 ISkill（业务侧定义）转成最小执行 spec：
 *   - id: skill 的唯一标识（agent runner trace 用）
 *   - systemPrompt: SKILL.md instructions body（runner 直接传 LLM）
 *   - allowedTools: 解析后的 ITool 引用列表（已查 ToolRegistry）
 *   - allowedModels: SKILL.md frontmatter 的模型白名单（可选）
 *   - outputSchema: zod schema（已从 OutputSchemaRegistry 解析）
 *
 * ISkillExecSpec 是**纯数据对象**，不含函数引用，可 structuredClone（hook payload 友好）。
 */
import type { ZodType } from "zod";

export interface ISkillExecSpec {
  /** Skill id（runner trace 用） */
  readonly id: string;

  /** SKILL.md instructions body（unparsed prompt 模板）*/
  readonly systemPrompt: string;

  /** 已解析的 tool id 白名单（PluginPipeline / ToolRegistry 用） */
  readonly allowedToolIds: ReadonlyArray<string>;

  /** SKILL.md frontmatter 的 allowedModels，未指定时空数组（runner 退回 TaskProfile） */
  readonly allowedModels: ReadonlyArray<string>;

  /** 输出 zod schema；SKILL.md 无 outputSchemaRef 时为 z.unknown() */
  readonly outputSchema: ZodType;

  /** 调试元数据（业务无关）*/
  readonly meta: {
    readonly skillVersion?: string;
    readonly skillDomain?: string;
  };
}
