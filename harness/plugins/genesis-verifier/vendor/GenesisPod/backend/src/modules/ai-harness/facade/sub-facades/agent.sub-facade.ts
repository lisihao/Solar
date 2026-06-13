/**
 * AgentSubFacade
 * Handles agent execution operations.
 * Plain TypeScript class — NOT @Injectable. Instantiated by AIFacade.
 */

import { Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import {
  CREATIVITY_TO_TEMPERATURE,
  OUTPUT_LENGTH_TO_TOKENS,
} from "../../../ai-engine/llm/types/task-profile.types";
import type { OrchestrationFeature } from "../facade.providers";
import type { AgentExecutionRequest, AgentExecutionResult } from "../types";

export class AgentSubFacade {
  private readonly logger = new Logger(AgentSubFacade.name);

  constructor(private readonly orchestration?: OrchestrationFeature) {}

  async executeAgent(
    request: AgentExecutionRequest,
  ): Promise<AgentExecutionResult> {
    this.logger.debug(
      `[executeAgent] agentType=${request.agentType}, task="${request.task.slice(0, 50)}..."`,
    );

    if (!this.orchestration?.agentExecutor) {
      return {
        success: false,
        content: "",
        tokensUsed: 0,
        duration: 0,
        error: "AgentExecutorService not available",
        retryable: false,
      };
    }

    const startTime = Date.now();

    const executionContext = {
      missionId:
        (request.metadata?.missionId as string) || `agent-${Date.now()}`,
      topicId: (request.metadata?.topicId as string) || "default",
      task: {
        id: `task-${Date.now()}`,
        title: request.task.slice(0, 100),
        description: request.task,
        assigneeId: request.agentType,
      },
      executor: {
        id: request.agentType,
        agentName: request.agentType,
        displayName: request.agentType,
        aiModel: request.model || AIModelType.CHAT,
        isLeader: false,
        systemPrompt: request.systemPrompt,
      },
      systemPrompt: request.systemPrompt || "You are a helpful AI assistant.",
      userPrompt: request.task,
      searchContext: request.context,
    };

    const config = {
      maxTokens: request.config?.maxTokens,
      temperature: request.config?.temperature,
      enableSearch: request.config?.enableSearch ?? false,
      maxRetries: request.config?.maxRetries ?? 3,
      timeout: request.config?.timeout,
    };

    if (request.taskProfile) {
      if (!config.temperature && request.taskProfile.creativity) {
        config.temperature =
          CREATIVITY_TO_TEMPERATURE[request.taskProfile.creativity] ?? 0.7;
      }
      if (!config.maxTokens && request.taskProfile.outputLength) {
        config.maxTokens =
          OUTPUT_LENGTH_TO_TOKENS[request.taskProfile.outputLength] ?? 4000;
      }
    }

    try {
      const result = await this.orchestration.agentExecutor.executeTask(
        executionContext,
        config,
      );

      return {
        success: result.success,
        content: result.content,
        tokensUsed: result.tokensUsed,
        duration: result.duration,
        error: result.error,
        retryable: result.retryable,
        searchResults: result.searchResults,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[executeAgent] Failed after ${duration}ms: ${errorMsg}`,
      );

      return {
        success: false,
        content: "",
        tokensUsed: 0,
        duration,
        error: errorMsg,
        retryable: true,
      };
    }
  }

  isAgentAvailable(agentId: string): boolean {
    if (!this.orchestration?.agentExecutor) {
      return false;
    }
    return this.orchestration.agentExecutor.isAgentAvailable(agentId);
  }
}
