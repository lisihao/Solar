/**
 * AI Engine - Prompt Skill Adapter
 *
 * 将 SKILL.md 定义转为 ISkill 实例。
 * 执行逻辑: SKILL.md body → System Prompt → LLM → 解析 JSON → SkillResult
 *
 * 适用于所有 prompt 型 skills (Slides 15 个, SkillsMP 安装的, 社区贡献的)
 *
 * Function Calling 单轮回路（当 SKILL.md allowedTools 非空且 toolRegistry 可用时）：
 *   第 1 次 LLM：传 tools → 可能返回 toolCalls
 *   tool 执行：对每个 tool_use 调 tool.execute()，错误作为 tool_result 拼回
 *   第 2 次 LLM：无 tools，传 tool_call + tool_result messages → 最终文本答复
 */

import { Logger } from "@nestjs/common";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  JsonSchema,
} from "../../abstractions/skill.interface";
import {
  SkillMdDefinition,
  SkillInputBinding,
} from "../../types/skill-md.types";
import type { IChatProvider } from "../../../facade";
import { SkillPromptBuilder } from "../../builder/skill-prompt-builder.service";
import type { ToolRegistry } from "../../../tools/registry/tool.registry";
import type { ToolContext } from "../../../tools/abstractions/tool.interface";

/** Callback for recording execution metrics after each run */
export interface PromptSkillExecutionCallback {
  (params: {
    skillId: string;
    success: boolean;
    duration: number;
    errorCode?: string;
    modelUsed?: string;
    skillVersion?: string;
    inputTokens?: number;
    outputTokens?: number;
    domain?: string;
    userId?: string;
  }): void;
}

export class PromptSkillAdapter implements ISkill<unknown, unknown> {
  private readonly logger: Logger;

  // ========== ISkill metadata ==========
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly layer: SkillLayer;
  readonly domain: string;
  readonly tags?: string[];
  readonly version?: string;
  readonly outputKey?: string;
  readonly requiredSkills?: string[];
  readonly requiredTools?: string[];
  readonly inputSchema?: JsonSchema;
  readonly outputSchema?: JsonSchema;

  /** Marker: this is a SKILL.md adapter, not a code-based skill */
  readonly isPromptSkillAdapter = true;

  /**
   * Get declarative input bindings from SKILL.md frontmatter.
   * Used by InputBindingResolver to auto-resolve inputs.
   */
  getInputBindings(): Record<string, SkillInputBinding> | undefined {
    return this.definition.metadata.inputs;
  }

  /**
   * Get the raw prompt content from the underlying SKILL.md definition.
   * Used by admin UI to display/edit prompt content.
   */
  getPromptContent(): string {
    return this.definition.content;
  }

  /**
   * Get the underlying SKILL.md definition metadata.
   * Used by admin UI to display frontmatter.
   */
  getDefinitionMetadata(): SkillMdDefinition["metadata"] {
    return this.definition.metadata;
  }

  constructor(
    private readonly definition: SkillMdDefinition,
    private readonly facade: IChatProvider,
    private readonly promptBuilder: SkillPromptBuilder,
    private readonly onExecutionComplete?: PromptSkillExecutionCallback,
    private readonly toolRegistry?: ToolRegistry,
  ) {
    const fm = definition.metadata;
    this.id = fm.id;
    this.name = fm.name;
    this.description = fm.description;
    this.layer = fm.layer ?? "content";
    this.domain = fm.domain;
    this.tags = fm.tags;
    this.version = fm.version;
    this.outputKey = fm.outputKey ?? fm.id;
    this.requiredSkills = fm.requiredSkills;
    this.requiredTools = fm.requiredTools;
    this.inputSchema = fm.inputSchema as JsonSchema | undefined;
    this.outputSchema = fm.outputSchema as JsonSchema | undefined;
    this.logger = new Logger(`PromptSkill:${fm.id}`);
  }

  async execute(
    input: unknown,
    context: SkillContext,
  ): Promise<SkillResult<unknown>> {
    const startTime = Date.now();
    const fm = this.definition.metadata;

    try {
      // 1. Build system prompt (SKILL.md body + variable substitution)
      const buildResult = this.promptBuilder.buildSystemPrompt(
        [this.definition],
        {
          context: input as Record<string, unknown>,
          maxTokens: fm.tokenBudget ?? 4000,
        },
      );

      // 2. Serialize input as user message
      const userMessage =
        typeof input === "string" ? input : JSON.stringify(input, null, 2);

      // 3. Resolve allowed tools from SKILL.md frontmatter
      const allowedToolIds: string[] = fm.allowedTools ?? [];
      const resolvedTools = this.resolveTools(allowedToolIds);

      // 4. Build initial message list
      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: buildResult.prompt },
        { role: "user", content: userMessage },
      ];

      // 5. Call LLM via facade
      const taskProfile = fm.taskProfile ?? {
        creativity: "medium",
        outputLength: "medium",
      };

      let finalContent: string;
      let totalTokensUsed = 0;
      let usedModel = "";

      if (resolvedTools.length > 0) {
        // --- Function Calling single-turn loop ---
        const toolDefs = resolvedTools.map((t) => t.toFunctionDefinition());

        // First call: expose tools to the model
        const firstResponse = await this.facade.chat({
          messages,
          taskProfile,
          tools: toolDefs,
        });

        totalTokensUsed += firstResponse.tokensUsed ?? 0;
        usedModel = firstResponse.model ?? "";

        if (firstResponse.toolCalls && firstResponse.toolCalls.length > 0) {
          // Execute each tool call (errors become tool_result content)
          const toolResultMessages: Array<{
            role: string;
            content: string;
          }> = [];

          // Append the assistant's tool_use turn
          toolResultMessages.push({
            role: "assistant",
            content: JSON.stringify({ tool_calls: firstResponse.toolCalls }),
          });

          for (const toolCall of firstResponse.toolCalls) {
            const toolResult = await this.executeToolCall(toolCall, context);
            toolResultMessages.push({
              role: "user",
              content: JSON.stringify({
                tool_call_id: toolCall.id,
                tool_name: toolCall.name,
                result: toolResult,
              }),
            });
          }

          // Second call: get final answer with tool results
          const secondResponse = await this.facade.chat({
            messages: [...messages, ...toolResultMessages],
            taskProfile,
          });

          totalTokensUsed += secondResponse.tokensUsed ?? 0;
          usedModel = secondResponse.model ?? usedModel;
          finalContent = secondResponse.content;
        } else {
          // LLM chose not to call any tools; treat response as final
          finalContent = firstResponse.content;
        }
      } else {
        // --- Prompt-only path (no allowed tools or toolRegistry unavailable) ---
        const response = await this.facade.chat({
          messages,
          taskProfile,
        });
        totalTokensUsed = response.tokensUsed ?? 0;
        usedModel = response.model ?? "";
        finalContent = response.content;
      }

      // 6. Always try JSON extraction (safe fallback to raw content)
      const data = this.extractJson(finalContent);

      const duration = Date.now() - startTime;

      // 7. Fire-and-forget execution metrics callback
      if (this.onExecutionComplete) {
        this.onExecutionComplete({
          skillId: this.id,
          success: true,
          duration,
          modelUsed: usedModel || undefined,
          skillVersion: fm.version,
          inputTokens: totalTokensUsed
            ? Math.ceil(totalTokensUsed * 0.7)
            : undefined,
          outputTokens: totalTokensUsed
            ? Math.ceil(totalTokensUsed * 0.3)
            : undefined,
          domain: fm.domain,
          userId: context.userId,
        });
      }

      return {
        success: true,
        data,
        metadata: {
          executionId: context.executionId,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration,
          tokensUsed: totalTokensUsed,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Execution failed: ${(error as Error).message}`);

      // Fire-and-forget execution metrics callback
      if (this.onExecutionComplete) {
        this.onExecutionComplete({
          skillId: this.id,
          success: false,
          duration,
          errorCode: "PROMPT_SKILL_FAILED",
          skillVersion: fm.version,
          domain: fm.domain,
          userId: context.userId,
        });
      }

      return {
        success: false,
        error: {
          code: "PROMPT_SKILL_FAILED",
          message: (error as Error).message,
          retryable: true,
        },
        metadata: {
          executionId: context.executionId,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration,
        },
      };
    }
  }

  /**
   * Resolve tool IDs from allowedTools frontmatter into ITool instances.
   * Skips IDs not found in the registry and emits a warning for each.
   * Returns empty array when toolRegistry is not available.
   */
  private resolveTools(
    allowedToolIds: string[],
  ): Array<import("../../../tools/abstractions/tool.interface").ITool> {
    if (allowedToolIds.length === 0 || !this.toolRegistry) {
      return [];
    }
    const resolved: Array<
      import("../../../tools/abstractions/tool.interface").ITool
    > = [];
    for (const toolId of allowedToolIds) {
      const tool = this.toolRegistry.tryGet(toolId);
      if (tool) {
        resolved.push(tool);
      } else {
        this.logger.warn(
          `[PromptSkillAdapter:${this.id}] allowed-tools references unknown tool "${toolId}" — skipping`,
        );
      }
    }
    return resolved;
  }

  /**
   * Execute a single tool call from the LLM.
   * Returns the tool result as a JSON-serialisable value.
   * On failure, returns an error object so the LLM can provide a graceful reply.
   */
  private async executeToolCall(
    toolCall: { id: string; name: string; arguments: Record<string, unknown> },
    context: SkillContext,
  ): Promise<unknown> {
    const tool = this.toolRegistry?.tryGet(toolCall.name);
    if (!tool) {
      this.logger.warn(
        `[PromptSkillAdapter:${this.id}] LLM requested tool "${toolCall.name}" which is not in toolRegistry`,
      );
      return { error: `Tool "${toolCall.name}" is not available` };
    }

    try {
      const toolContext: ToolContext = {
        executionId: context.executionId,
        toolId: tool.id,
        userId: context.userId,
        callerType: "skill",
        createdAt: new Date(),
      };
      const result = await tool.execute(toolCall.arguments, toolContext);
      if (result.success) {
        return result.data ?? null;
      }
      return { error: result.error?.message ?? "Tool execution failed" };
    } catch (err) {
      this.logger.warn(
        `[PromptSkillAdapter:${this.id}] Tool "${toolCall.name}" threw: ${(err as Error).message}`,
      );
      return { error: (err as Error).message };
    }
  }

  /**
   * Extract JSON from LLM response
   * Supports: pure JSON / markdown code block / mixed text / truncated JSON
   */
  private extractJson(content: string): unknown {
    // Attempt 1: markdown code block
    const codeBlockMatch = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch {
        /* continue */
      }
    }

    // Attempt 2: direct parse
    try {
      return JSON.parse(content.trim());
    } catch {
      /* continue */
    }

    // Attempt 3: find outermost { } or [ ]
    const braceMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[1]);
      } catch {
        /* continue */
      }
    }

    // Attempt 4: repair truncated JSON (LLM output cut off)
    const repaired = this.repairTruncatedJson(content);
    if (repaired) return repaired;

    // Fallback: return raw content
    this.logger.warn(`JSON extraction failed, returning raw content`);
    return content;
  }

  /**
   * Repair truncated JSON by completing missing brackets
   */
  private repairTruncatedJson(content: string): unknown {
    const jsonStart = content.indexOf("{");
    if (jsonStart === -1) return null;

    let jsonStr = content.slice(jsonStart);
    const openBraces = (jsonStr.match(/{/g) ?? []).length;
    const closeBraces = (jsonStr.match(/}/g) ?? []).length;
    const openBrackets = (jsonStr.match(/\[/g) ?? []).length;
    const closeBrackets = (jsonStr.match(/]/g) ?? []).length;

    jsonStr += "]".repeat(Math.max(0, openBrackets - closeBrackets));
    jsonStr += "}".repeat(Math.max(0, openBraces - closeBraces));

    try {
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }
}
