/**
 * Slides Team Member - 团队成员基类
 *
 * 封装 Skill 调用，提供统一的执行接口
 */

import { Injectable, Logger } from "@nestjs/common";
import { SkillRegistry } from "@/modules/ai-harness/facade";
import { TeamFacade } from "@/modules/ai-harness/facade";
import {
  SlidesTask,
  SlidesTeamMemberRole,
  SLIDES_TEAM_MEMBERS,
  SkillExecutionContext,
} from "./types";
import { resolveEffectiveSkillId } from "../skill-resolver";

export interface TaskExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
}

@Injectable()
export class SlidesTeamMember {
  private readonly logger = new Logger(SlidesTeamMember.name);

  constructor(
    private readonly skillRegistry: SkillRegistry,
    private readonly teamFacade: TeamFacade,
  ) {}

  /**
   * 执行任务
   */
  async executeTask(
    task: SlidesTask,
    context: SkillExecutionContext,
  ): Promise<TaskExecutionResult> {
    const startTime = Date.now();

    // ★ 安全处理：如果 skillId 包含逗号，只取第一个并规范化
    let skillId = task.skillId;
    if (skillId.includes(",")) {
      skillId = skillId.split(",")[0].trim();
      this.logger.warn(
        `[executeTask] Skill ID contained comma, normalized: "${task.skillId}" → "${skillId}"`,
      );
    }

    // ★ Skills-driven substitution (Phase B)
    // If the mission has resolvedSkills (preset/override/policy applied) and
    // the Leader's chosen skill maps to a known slot, try to redirect to the
    // resolver-bound skill. Falls back silently to the original when the
    // substitute isn't registered, so missions never fail on a bad binding.
    // When substitution succeeds, we cache the looked-up skill to avoid a
    // redundant registry query further down.
    const originalSkillId = skillId;
    const resolution = resolveEffectiveSkillId(
      skillId,
      context.globalContext.resolvedSkills,
    );
    let substitutedSkill: ReturnType<SkillRegistry["tryGet"]> | null = null;
    if (resolution.substituted) {
      substitutedSkill = this.skillRegistry.tryGet(resolution.effectiveSkillId);
      if (substitutedSkill) {
        this.logger.log(
          `[executeTask] Skill substituted via slot '${resolution.slot}': ` +
            `${originalSkillId} → ${resolution.effectiveSkillId}`,
        );
        skillId = resolution.effectiveSkillId;
      } else {
        this.logger.warn(
          `[executeTask] Substitute skill '${resolution.effectiveSkillId}' ` +
            `(slot '${resolution.slot}') is not registered — falling back to '${originalSkillId}'`,
        );
      }
    }

    this.logger.log(
      `[executeTask] Executing task ${task.id}: ${task.title} with skill ${skillId}`,
    );

    try {
      // 获取 Skill (使用 tryGet 避免抛出异常)
      // 若上游替换已成功命中，直接复用，避免重复查询
      let skill = substitutedSkill ?? this.skillRegistry.tryGet(skillId);

      if (!skill) {
        this.logger.log(
          `[executeTask] Skill not found: ${skillId}, trying prefix variants`,
        );

        // 尝试带 slides- 前缀
        skill = this.skillRegistry.tryGet(`slides-${skillId}`);
        if (skill) {
          this.logger.log(
            `[executeTask] Found skill with slides- prefix: slides-${skillId}`,
          );
        }

        // 尝试去掉 slides- 前缀（orchestrator 可能加了前缀，但 SKILL.md 注册时没有）
        if (!skill && skillId.startsWith("slides-")) {
          const unprefixed = skillId.slice("slides-".length);
          skill = this.skillRegistry.tryGet(unprefixed);
          if (skill) {
            this.logger.log(
              `[executeTask] Found skill by removing slides- prefix: ${unprefixed}`,
            );
          }
        }

        if (!skill) {
          this.logger.error(
            `[executeTask] Skill not found with any ID variant: ${skillId}`,
          );
          return {
            success: false,
            error: `Skill not found: ${skillId}`,
            duration: Date.now() - startTime,
          };
        }
      }

      const targetSkill = skill;

      if (!targetSkill) {
        return {
          success: false,
          error: `Skill not found: ${task.skillId}`,
          duration: Date.now() - startTime,
        };
      }

      // 构建 Skill 输入
      const skillInput = this.buildSkillInput(task, context, targetSkill);

      // 执行 Skill（通过 Facade，内部处理 LLM 适配器注入）
      const skillResult = await this.teamFacade.executeSkill(
        targetSkill,
        skillInput,
        {
          executionId: context.executionId,
          skillId: task.skillId,
          sessionId: context.sessionId,
          userId: "",
          createdAt: new Date(),
        },
      );

      if (!skillResult.success) {
        return {
          success: false,
          error: skillResult.error?.message || "Skill execution failed",
          duration: Date.now() - startTime,
        };
      }

      this.logger.log(
        `[executeTask] Task ${task.id} completed successfully in ${Date.now() - startTime}ms`,
      );

      return {
        success: true,
        result: skillResult.data,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[executeTask] Task ${task.id} failed: ${errorMsg}`);

      return {
        success: false,
        error: errorMsg,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 构建 Skill 输入
   *
   * - PromptSkillAdapter: 使用 InputBindingResolver 从 SKILL.md inputs 声明自动解析
   * - Code-based skills: 保留手动 switch/case 映射
   */
  private buildSkillInput(
    task: SlidesTask,
    context: SkillExecutionContext,
    skill: NonNullable<ReturnType<SkillRegistry["tryGet"]>>,
  ): unknown {
    // 优先使用 outputManager（新规范），回退到 previousOutputs（兼容）
    const getOutput = <T>(skillId: string): T | undefined => {
      if (context.outputManager) {
        return context.outputManager.get<T>(skillId);
      }
      return (context.previousOutputs[skillId] ||
        context.previousOutputs[`slides-${skillId}`]) as T | undefined;
    };

    // 基础输入（始终包含，供 prompt 和 code skills 使用）
    const baseInput = {
      task: task.description,
      context: {
        input: task.input,
        sourceText: context.globalContext.sourceText,
        outline: context.globalContext.outline,
        themeId: context.globalContext.themeId,
        stylePreference: context.globalContext.stylePreference,
      },
      previousOutputs: context.previousOutputs,
    };

    // ★ PromptSkillAdapter: 声明式 InputBinding 解析（通过 Facade 封装）
    const resolved = this.teamFacade.resolveSkillInputBindings(skill, {
      outputManager: context.outputManager,
      context: {
        ...context.globalContext,
        sessionId: context.sessionId,
      },
      input: task.input as Record<string, unknown>,
      previousOutputs: context.previousOutputs,
    });
    if (resolved !== null) {
      // PromptSkillAdapter: 只传 task 描述 + 声明式绑定的输入
      // 不包含 previousOutputs（避免将全部 skill 输出重复传入 LLM，导致超出 context 限制）
      // 不包含 context.sourceText（SKILL.md 声明 required: sourceText 的 skill 已通过 resolved.sourceText 获取）
      return {
        task: task.description,
        themeId: context.globalContext.themeId,
        stylePreference: context.globalContext.stylePreference,
        ...resolved,
      };
    }
    // resolveSkillInputBindings returns null in three cases:
    //   (a) not a PromptSkillAdapter → falls through to the code-based switch below
    //   (b) PromptSkillAdapter with no declared bindings → uses minimal input (intended)
    //   (c) PromptSkillAdapter with declared bindings but skillInputBindingResolver unavailable
    //       → graceful degradation: falls back to minimal input, bindings silently skipped.
    //       This is intentional; the skill will still execute with task description only.
    if ((skill as { isPromptSkillAdapter?: boolean }).isPromptSkillAdapter) {
      return {
        task: task.description,
        themeId: context.globalContext.themeId,
        stylePreference: context.globalContext.stylePreference,
      };
    }

    // ★ Code-based skills: 手动映射（保持向后兼容）
    switch (task.skillId) {
      case "page-type-selection":
      case "slides-page-type-selection": {
        const outline = getOutput<{ slides?: unknown[] }>("outline");
        return outline?.slides || [];
      }

      case "page-pipeline":
      case "slides-page-pipeline": {
        const outlineResult =
          getOutput("outline-planning") || context.globalContext.outline;
        const outlinePages = (outlineResult as { pages?: unknown[] })?.pages;
        this.logger.log(
          `[buildSkillInput] page-pipeline: outline exists=${!!outlineResult}, pages=${outlinePages?.length || 0}, outputManager keys=${context.outputManager?.keys().join(", ") || "N/A"}`,
        );
        return {
          outline: outlineResult,
          sourceText: context.globalContext.sourceText,
          themeId: context.globalContext.themeId || "genspark-dark",
          stylePreference: context.globalContext.stylePreference || "dark",
          sessionId: context.sessionId,
          ...baseInput,
        };
      }

      case "quality-audit":
      case "slides-quality-audit":
        return {
          pages: getOutput("pages") || [],
          ...baseInput,
        };

      default:
        return baseInput;
    }
  }

  /**
   * 获取成员信息
   */
  getMemberInfo(role: SlidesTeamMemberRole) {
    return SLIDES_TEAM_MEMBERS[role];
  }

  /**
   * 检查成员是否有指定技能
   */
  hasSkill(role: SlidesTeamMemberRole, skillId: string): boolean {
    const member = SLIDES_TEAM_MEMBERS[role];
    return (
      member.skills.includes(skillId) ||
      member.skills.includes(`slides-${skillId}`)
    );
  }
}
