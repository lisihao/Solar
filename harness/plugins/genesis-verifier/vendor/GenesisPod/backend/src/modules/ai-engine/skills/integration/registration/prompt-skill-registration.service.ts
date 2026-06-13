/**
 * AI Engine - Prompt Skill Bridge
 *
 * 将 SkillLoaderService 加载的 SKILL.md 定义桥接到 SkillRegistry。
 * - 只创建 PromptSkillAdapter (prompt 模式)
 * - code-based skills (已在 SkillRegistry 中) 自动优先
 * - SkillsMP 安装的 skills 通过此桥接自动进入执行管线
 */

import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { SkillRegistry } from "../../registry/skill.registry";
import { SkillLoaderService } from "../../loader/loading/skill-loader.service";
import { SkillPromptBuilder } from "../../builder/skill-prompt-builder.service";
import { SkillContentService } from "../../content/skill-content.service";
import { CHAT_PROVIDER_PORT } from "../../../facade/abstractions/runtime-deps.tokens";
import type { IChatProvider } from "../../../facade";
import { SkillMdDefinition } from "../../types/skill-md.types";
import {
  PromptSkillAdapter,
  PromptSkillExecutionCallback,
} from "../adapters/prompt-skill.adapter";
import { ISkill } from "../../abstractions/skill.interface";
import { PrismaService } from "@/common/prisma/prisma.service";

export interface PromptSkillRegistrationResult {
  registered: string[];
  skipped: string[];
  errors: Array<{ id: string; error: string }>;
}

@Injectable()
export class PromptSkillRegistrationService {
  private readonly logger = new Logger(PromptSkillRegistrationService.name);

  /** Execution metrics callback shared by all adapters */
  private executionCallback: PromptSkillExecutionCallback;

  constructor(
    private readonly skillRegistry: SkillRegistry,
    private readonly skillLoader: SkillLoaderService,
    private readonly promptBuilder: SkillPromptBuilder,
    private readonly prisma: PrismaService,
    private readonly skillContentService: SkillContentService,
    @Optional()
    @Inject(CHAT_PROVIDER_PORT)
    private readonly facade?: IChatProvider,
    private readonly moduleRef?: ModuleRef,
  ) {
    // Create a shared callback that logs execution to AIUsageLog + updates usage count
    this.executionCallback = (params) => {
      // Fire-and-forget: log to AIUsageLog
      void this.prisma.aIUsageLog
        .create({
          data: {
            capabilityType: "skill",
            capabilityId: params.skillId,
            success: params.success,
            duration: params.duration,
            errorCode: params.errorCode ?? null,
            modelUsed: params.modelUsed ?? null,
            skillVersion: params.skillVersion ?? null,
            inputTokens: params.inputTokens ?? null,
            outputTokens: params.outputTokens ?? null,
            domain: params.domain ?? null,
            userId: params.userId ?? null,
            tokensUsed:
              (params.inputTokens ?? 0) + (params.outputTokens ?? 0) || null,
          },
        })
        .catch((err: Error) =>
          this.logger.debug(`AIUsageLog write failed: ${err.message}`),
        );

      // Fire-and-forget: update usage count
      void this.skillContentService.recordUsage(params.skillId);
    };
  }

  /**
   * 注册指定域的所有 SKILL.md 为 PromptSkillAdapter
   * 已有 code-based skill 的 ID 自动跳过
   */
  async registerDomain(domain: string): Promise<PromptSkillRegistrationResult> {
    const skills = await this.skillLoader.loadLocalSkills(domain);
    return this.registerDefinitions(skills);
  }

  /**
   * 注册一批 SkillMdDefinition
   */
  registerDefinitions(
    definitions: SkillMdDefinition[],
  ): PromptSkillRegistrationResult {
    const facade = this.getChatProvider();
    const result: PromptSkillRegistrationResult = {
      registered: [],
      skipped: [],
      errors: [],
    };

    for (const def of definitions) {
      const skillId = def.metadata.id;

      try {
        // Skip skills marked as 'provider' (have NestJS code implementation)
        if (def.metadata.executionMode === "provider") {
          result.skipped.push(skillId);
          continue;
        }

        // Skip if code-based skill already registered (code-based takes priority)
        const existing = this.skillRegistry.tryGet(skillId);
        if (existing && !this.isPromptAdapter(existing)) {
          this.logger.debug(`Skip "${skillId}": code-based skill exists`);
          result.skipped.push(skillId);
          continue;
        }

        // Skip if already registered as PromptSkillAdapter (avoid duplicate)
        if (existing && this.isPromptAdapter(existing)) {
          result.skipped.push(skillId);
          continue;
        }

        // Create PromptSkillAdapter and register
        const adapter = new PromptSkillAdapter(
          def,
          facade,
          this.promptBuilder,
          this.executionCallback,
        );
        this.skillRegistry.register(adapter);
        result.registered.push(skillId);
      } catch (error) {
        this.logger.error(
          `Failed to register "${skillId}": ${(error as Error).message}`,
        );
        result.errors.push({ id: skillId, error: (error as Error).message });
      }
    }

    this.logger.log(
      `[PromptSkillRegistration] registered=${result.registered.length}, ` +
        `skipped=${result.skipped.length}, errors=${result.errors.length}`,
    );
    return result;
  }

  private isPromptAdapter(skill: ISkill): boolean {
    return (skill as PromptSkillAdapter).isPromptSkillAdapter === true;
  }

  private getChatProvider(): IChatProvider {
    if (this.facade) {
      return this.facade;
    }

    if (this.moduleRef) {
      return this.moduleRef.get<IChatProvider>(CHAT_PROVIDER_PORT, {
        strict: false,
      });
    }

    throw new Error("CHAT_PROVIDER_PORT is not available");
  }
}
