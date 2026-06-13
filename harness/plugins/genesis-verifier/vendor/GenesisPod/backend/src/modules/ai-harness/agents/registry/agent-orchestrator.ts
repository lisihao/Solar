/**
 * Legacy Agent Orchestrator (migrated from ai-harness/agents/registry)
 *
 * Selects and schedules IPlanBasedAgent instances for execution.
 * @deprecated For new agents use MissionOrchestrator / HarnessedAgent.
 * Migrated: PR-X5 (ai-harness/agents/registry → ai-harness/agents/registry)
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  AgentId,
  AgentInput,
  AgentEvent,
} from "@/modules/ai-harness/agents/abstractions/agent.types";
import { PlanBasedAgentRegistry } from "./plan-based-agent-registry";
import { GuardrailsPipelineService } from "../../../ai-engine/safety/guardrails/guardrails-pipeline.service";
import { AgentConfigService } from "../config/agent-config.service";
import { IPlanBasedAgent } from "../base/plan-based-agent";
// PR-X3: EventJournal → 通过 EventEmitter 事件解耦；CapabilityGuard 已搬到 engine
import { CapabilityGuardService } from "../../guardrails/capability";
import { MissionContext } from "../../../../common/context/mission-context";

/**
 * 状态报告项
 */
export interface AgentStatusReport {
  agentId: AgentId;
  name: string;
  available: boolean;
  executions: number;
  errors: number;
}

/**
 * Agent 编排器
 * 负责选择和调度 Agent 执行任务
 */
@Injectable()
export class AgentOrchestrator {
  private readonly logger = new Logger(AgentOrchestrator.name);
  private readonly guardrailsEnabled: boolean;
  private readonly guardrailsFailClosed: boolean;

  constructor(
    private readonly registry: PlanBasedAgentRegistry,
    @Optional() private readonly agentConfigService?: AgentConfigService,
    @Optional() private readonly guardrailsPipeline?: GuardrailsPipelineService,
    private readonly configService?: ConfigService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly capabilityGuard?: CapabilityGuardService,
  ) {
    this.guardrailsEnabled =
      this.configService?.get<string>("GUARDRAILS_ENABLED") !== "false";
    this.guardrailsFailClosed =
      this.configService?.get<string>("GUARDRAILS_FAIL_CLOSED") === "true";
    if (this.guardrailsEnabled && this.guardrailsPipeline) {
      this.logger.log("Agent Orchestrator guardrails enabled");
    }
  }

  /**
   * 执行 Agent 任务
   * 流式返回执行事件
   */
  async *execute(
    input: AgentInput,
    agentId?: AgentId,
    _userId?: string,
    processId?: string,
  ): AsyncGenerator<AgentEvent> {
    // ★ MissionContext: fallback to AsyncLocalStorage if processId not explicitly provided
    //   (renamed slot 2026-05-11; see mission-context.ts header)
    const resolvedProcessId = processId ?? MissionContext.getAgentProcessId();
    // Input validation with guardrails
    if (this.guardrailsEnabled && this.guardrailsPipeline) {
      try {
        const inputCheck = await this.guardrailsPipeline.processInput({
          content: input.prompt || "",
          userId: _userId,
          context: { agentId, inputType: "agent_execution" },
        });

        if (!inputCheck.passed) {
          this.logger.warn(
            `Agent execution blocked by input guardrail: ${inputCheck.blockedBy}`,
          );
          yield {
            type: "error",
            error: "Request blocked by security policy",
          };
          return;
        }
        // M3 fix：PII 是 redact-not-block（passed=true + transformedContent 脱敏文本）。
        // 之前只看 passed，把**原始未脱敏 prompt** 发给模型。改用脱敏后的 prompt。
        if (typeof inputCheck.transformedContent === "string") {
          input = { ...input, prompt: inputCheck.transformedContent };
        }
      } catch (guardrailError) {
        this.logger.error(
          `Agent input guardrail execution error: ${(guardrailError as Error).message}`,
        );
        if (this.guardrailsFailClosed) {
          yield {
            type: "error",
            error: "Security validation unavailable",
          };
          return;
        }
      }
    }

    // 选择 Agent
    const selectedAgentId = agentId ?? this.selectAgent(input);

    if (!selectedAgentId) {
      yield {
        type: "error",
        error: "No suitable agent found for the request",
      };
      return;
    }

    if (!this.registry.has(selectedAgentId)) {
      yield {
        type: "error",
        error: `Agent not found: ${selectedAgentId}`,
      };
      return;
    }

    const agent = this.registry.get(selectedAgentId);

    this.logger.log(
      `[execute] Using agent: ${agent.id} for prompt: ${input.prompt?.substring(0, 50)}...`,
    );

    // Apply DB-stored runtime config overrides
    await this.applyRuntimeConfig(agent);

    try {
      // 生成执行计划
      const plan = await agent.plan(input);

      if (resolvedProcessId) {
        this.events?.emit("agent.journal.record", {
          processId: resolvedProcessId,
          eventType: "AGENT_PLAN",
          payload: {
            agentId: selectedAgentId,
            stepCount: plan?.steps?.length ?? 0,
          },
        });
      }

      // ★ CapabilityGuard: Check tool access before execution
      if (
        resolvedProcessId &&
        this.capabilityGuard &&
        plan?.toolsRequired?.length
      ) {
        for (const toolId of plan.toolsRequired) {
          const check = await this.capabilityGuard.checkToolAccess(
            resolvedProcessId,
            toolId,
          );
          if (!check.allowed) {
            this.logger.warn(
              `[execute] Tool ${toolId} denied for process ${resolvedProcessId}: ${check.reason}`,
            );
            yield {
              type: "error",
              error: `Tool ${toolId} not permitted: ${check.reason}`,
            };
            return;
          }
        }
      }

      // 执行计划
      for await (const event of agent.execute(plan)) {
        // Output validation with guardrails (only for complete events)
        if (
          event.type === "complete" &&
          this.guardrailsEnabled &&
          this.guardrailsPipeline
        ) {
          try {
            const outputCheck = await this.guardrailsPipeline.processOutput({
              content: JSON.stringify(event.result),
              context: { agentId: selectedAgentId, outputType: "agent_result" },
            });

            if (!outputCheck.passed) {
              this.logger.warn(
                `Agent output blocked by guardrail: ${outputCheck.blockedBy}`,
              );
              yield {
                type: "error",
                error: "Request blocked by security policy",
              };
              this.registry.recordExecution(selectedAgentId, false);
              return;
            }
          } catch (guardrailError) {
            this.logger.error(
              `Agent output guardrail execution error: ${(guardrailError as Error).message}`,
            );
            if (this.guardrailsFailClosed) {
              yield {
                type: "error",
                error: "Security validation unavailable",
              };
              this.registry.recordExecution(selectedAgentId, false);
              return;
            }
          }
        }

        yield event;

        // 记录完成或错误
        if (event.type === "complete") {
          this.registry.recordExecution(selectedAgentId, event.result.success);
          if (resolvedProcessId) {
            this.events?.emit("agent.journal.record", {
              processId: resolvedProcessId,
              eventType: "AGENT_COMPLETE",
              payload: {
                agentId: selectedAgentId,
                success: event.result?.success ?? false,
              },
            });
          }
        } else if (event.type === "error") {
          this.registry.recordExecution(selectedAgentId, false);
        }
      }
    } catch (error) {
      this.logger.error(
        `[execute] Agent execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.registry.recordExecution(selectedAgentId, false);
      if (resolvedProcessId) {
        this.events?.emit("agent.journal.record", {
          processId: resolvedProcessId,
          eventType: "AGENT_ERROR",
          payload: {
            agentId: selectedAgentId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }

      yield {
        type: "error",
        error:
          error instanceof Error ? error.message : "Agent execution failed",
      };
    } finally {
      // Clean up runtime overrides after execution
      if ("clearRuntimeOverrides" in agent) {
        (
          agent as IPlanBasedAgent & { clearRuntimeOverrides(): void }
        ).clearRuntimeOverrides();
      }
    }
  }

  /**
   * Apply DB-stored runtime config to agent before execution
   */
  private async applyRuntimeConfig(agent: IPlanBasedAgent): Promise<void> {
    if (!this.agentConfigService) return;

    try {
      const dbConfig = await this.agentConfigService.getEffectiveConfig(
        agent.id,
      );
      if (!dbConfig || !dbConfig.enabled) return;

      // Apply system prompt override
      if (dbConfig.systemPrompt && "setSystemPromptOverride" in agent) {
        (
          agent as IPlanBasedAgent & {
            setSystemPromptOverride(p: string): void;
          }
        ).setSystemPromptOverride(dbConfig.systemPrompt);
      }

      // Apply model type override
      if (dbConfig.modelType && "setModelTypeOverride" in agent) {
        (
          agent as IPlanBasedAgent & { setModelTypeOverride(m: string): void }
        ).setModelTypeOverride(dbConfig.modelType);
      }

      // Apply task profile override
      if (dbConfig.taskProfile && "setTaskProfileOverride" in agent) {
        (
          agent as IPlanBasedAgent & {
            setTaskProfileOverride(p: Record<string, unknown>): void;
          }
        ).setTaskProfileOverride(
          dbConfig.taskProfile as Record<string, unknown>,
        );
      }

      this.logger.debug(
        `[applyRuntimeConfig] Applied DB config for agent ${agent.id}`,
      );
    } catch (error) {
      this.logger.warn(
        `[applyRuntimeConfig] Failed to apply config for ${agent.id}: ${(error as Error).message}`,
      );
      // Continue with defaults - config failure should not block execution
    }
  }

  /**
   * 选择适合的 Agent
   * 基于加权评分算法选择最匹配的 Agent
   *
   * 评分规则:
   * - 每个匹配关键词 +1 分
   * - 匹配率加成：匹配数/总关键词数
   * - 最高分胜出
   */
  private selectAgent(input: AgentInput): AgentId | null {
    const prompt = input.prompt?.toLowerCase() ?? "";
    const agents = this.registry.getAll();

    let bestAgent: AgentId | null = null;
    let bestScore = 0;

    for (const agent of agents) {
      const config = agent.getConfig();
      const keywords = config.selectionKeywords ?? [];
      if (keywords.length === 0) continue;

      let score = 0;
      let matchCount = 0;

      for (const kw of keywords) {
        if (prompt.includes(kw.toLowerCase())) {
          matchCount++;
          score += 1;
        }
      }

      // 匹配率加成: 匹配关键词占总关键词的比例
      if (matchCount > 0) {
        score += matchCount / keywords.length;
      }

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent.id;
      }
    }

    // 无匹配时返回第一个已注册的 Agent
    if (!bestAgent) {
      const agentIds = this.registry.getAllIds();
      return agentIds.length > 0 ? agentIds[0] : null;
    }

    this.logger.debug(
      `[selectAgent] Selected ${bestAgent} (score: ${bestScore.toFixed(2)}) for prompt: "${prompt.slice(0, 50)}"`,
    );

    return bestAgent;
  }

  /**
   * 获取状态报告
   */
  getStatusReport(): AgentStatusReport[] {
    const stats = this.registry.getStats();
    const agents = this.registry.getAll();

    return agents.map((agent) => ({
      agentId: agent.id,
      name: agent.name,
      available: true,
      executions: stats.byId[agent.id]?.executions || 0,
      errors: stats.byId[agent.id]?.errors || 0,
    }));
  }
}
