/**
 * AI Engine - Skill Sandbox Service
 *
 * 在隔离环境中测试 Skill，不影响生产指标。
 */

import { Injectable, Logger, Inject } from "@nestjs/common";
import { SkillRegistry } from "../registry/skill.registry";
import { SkillPromptBuilder } from "../builder/skill-prompt-builder.service";
import { SkillContentService } from "../content/skill-content.service";
import { CHAT_PROVIDER_PORT } from "../../facade/abstractions/runtime-deps.tokens";
import type { IChatProvider } from "../../facade";
import { PromptSkillAdapter } from "../integration/adapters/prompt-skill.adapter";
import { parseSkillMd } from "../loader/parsing/skill-parser";

interface TestExecutionOptions {
  model?: string;
  taskProfile?: {
    creativity?: "deterministic" | "low" | "medium" | "high";
    outputLength?:
      | "minimal"
      | "short"
      | "medium"
      | "standard"
      | "long"
      | "extended";
  };
}

export interface TestExecutionResult {
  success: boolean;
  output: unknown;
  duration: number;
  tokensUsed: number;
  promptPreview: string;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  variables: string[];
  estimatedTokens: number;
}

@Injectable()
export class SkillSandboxService {
  private readonly logger = new Logger(SkillSandboxService.name);

  constructor(
    private readonly skillRegistry: SkillRegistry,
    private readonly promptBuilder: SkillPromptBuilder,
    private readonly skillContentService: SkillContentService,
    @Inject(CHAT_PROVIDER_PORT)
    private readonly facade: IChatProvider,
  ) {}

  /**
   * Test execution: run a skill with test input, no production metrics recorded
   */
  async testExecution(
    skillId: string,
    input: unknown,
    options?: TestExecutionOptions,
  ): Promise<TestExecutionResult> {
    const startTime = Date.now();

    try {
      // Get skill definition from DB or registry
      const definition = await this.getSkillDefinition(skillId);
      if (!definition) {
        return {
          success: false,
          output: null,
          duration: 0,
          tokensUsed: 0,
          promptPreview: "",
          error: `Skill not found: ${skillId}`,
        };
      }

      // Override taskProfile if provided
      if (options?.taskProfile) {
        definition.metadata.taskProfile = {
          ...(definition.metadata.taskProfile ?? {}),
          ...options.taskProfile,
        };
      }

      // Build prompt preview
      const buildResult = this.promptBuilder.buildSystemPrompt([definition], {
        context: input as Record<string, unknown>,
        maxTokens: definition.metadata.tokenBudget ?? 4000,
      });

      // Create adapter WITHOUT execution callback (no metrics recorded)
      const adapter = new PromptSkillAdapter(
        definition,
        this.facade,
        this.promptBuilder,
      );

      // Execute
      const result = await adapter.execute(input, {
        executionId: `sandbox-${Date.now()}`,
        skillId,
        createdAt: new Date(),
      });

      return {
        success: result.success,
        output: result.data,
        duration: Date.now() - startTime,
        tokensUsed: result.metadata.tokensUsed ?? 0,
        promptPreview: buildResult.prompt.substring(0, 2000),
        error: result.error?.message,
      };
    } catch (error) {
      this.logger.warn(
        `[Sandbox] Test execution failed for ${skillId}: ${(error as Error).message}`,
      );
      return {
        success: false,
        output: null,
        duration: Date.now() - startTime,
        tokensUsed: 0,
        promptPreview: "",
        error: (error as Error).message,
      };
    }
  }

  /**
   * Validate skill content without calling LLM
   */
  validateSkillContent(
    content: string,
    frontmatter?: Record<string, unknown>,
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Try parsing as SKILL.md
    if (!frontmatter) {
      try {
        parseSkillMd(content);
      } catch (error) {
        errors.push(`Parse error: ${(error as Error).message}`);
      }
    }

    // 2. Check for required frontmatter fields
    if (frontmatter) {
      if (!frontmatter.name && !frontmatter.id) {
        errors.push("Missing required field: name or id");
      }
    }

    // 3. Check content is not empty
    if (!content || content.trim().length === 0) {
      errors.push("Prompt content is empty");
    }

    // 4. Extract variables
    const variableMatches = content.match(/\{\{(\w+)\}\}/g) ?? [];
    const variables = [
      ...new Set(variableMatches.map((m) => m.replace(/\{\{|\}\}/g, ""))),
    ];

    // 5. Warnings
    if (content.length > 20000) {
      warnings.push(
        `Content is very long (${content.length} chars). Consider splitting.`,
      );
    }
    if (variables.length === 0) {
      warnings.push(
        "No {{variables}} found. The prompt may not be parameterized.",
      );
    }

    // 6. Estimate tokens
    const estimatedTokens = Math.ceil(content.length / 4);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      variables,
      estimatedTokens,
    };
  }

  /**
   * Dry run: build the prompt without calling LLM
   */
  async dryRun(
    skillId: string,
    input: unknown,
  ): Promise<{ promptPreview: string; estimatedTokens: number } | null> {
    const definition = await this.getSkillDefinition(skillId);
    if (!definition) return null;

    const buildResult = this.promptBuilder.buildSystemPrompt([definition], {
      context: input as Record<string, unknown>,
      maxTokens: definition.metadata.tokenBudget ?? 4000,
    });

    return {
      promptPreview: buildResult.prompt,
      estimatedTokens: buildResult.estimatedTokens,
    };
  }

  /**
   * Get skill definition from registry or DB content
   */
  private async getSkillDefinition(skillId: string) {
    // Try DB first (may have user-edited content)
    const dbContent =
      await this.skillContentService.getFullSkillDefinition(skillId);
    if (dbContent?.promptContent && dbContent.frontmatter) {
      return this.skillContentService.parseDbContentToDefinition(
        skillId,
        dbContent.promptContent,
        dbContent.frontmatter,
      );
    }

    // Fall back to loaded skills
    const registered = this.skillRegistry.tryGet(skillId);
    if (registered && (registered as PromptSkillAdapter).isPromptSkillAdapter) {
      // PromptSkillAdapter wraps a definition — access is private, so we
      // return null and let the caller handle registry-based execution
      return null;
    }

    return null;
  }
}
