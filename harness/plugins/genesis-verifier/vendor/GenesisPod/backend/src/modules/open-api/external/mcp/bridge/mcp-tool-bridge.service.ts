/**
 * MCP Tool Bridge - 动态工具桥接服务
 *
 * 从 ToolRegistry / SkillRegistry / AgentRegistry 自动生成 MCP Tool 定义，
 * 无需手写 Handler 即可暴露 AI Engine 的全部能力。
 *
 * 设计原则:
 * - Registry 中注册的工具自动暴露，无需逐个手写 Handler
 * - 保留 curated handlers（现有 5 个精选工具）作为高优先级入口
 * - 通过命名前缀区分来源: curated / tool_ / skill_ / agent_
 * - 所有调用统一经过 AIFacade，不绕过 Facade 层
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  ExposedToolWithMeta,
  MCPRequestContext,
  MCPToolResponse,
  MCPToolSource,
} from "../abstractions/mcp-server.interface";
import { ToolRegistry, SkillRegistry } from "../../../../ai-engine/facade";
import {
  ChatFacade,
  ToolFacade,
  AgentFacade,
} from "../../../../ai-harness/facade";
import { AgentRegistry } from "../../../../ai-harness/facade";

interface BridgedToolMeta {
  source: MCPToolSource;
  registryId: string;
  category?: string;
  tags?: string[];
}

@Injectable()
export class MCPToolBridgeService {
  private readonly logger = new Logger(MCPToolBridgeService.name);
  private readonly bridgedToolMeta = new Map<string, BridgedToolMeta>();

  constructor(
    private readonly chatFacade: ChatFacade,
    private readonly toolFacade: ToolFacade,
    private readonly agentFacade: AgentFacade,
    @Optional() private readonly toolRegistry?: ToolRegistry,
    @Optional() private readonly skillRegistry?: SkillRegistry,
    @Optional() private readonly agentRegistry?: AgentRegistry,
  ) {}

  /**
   * 从所有 Registry 动态聚合工具列表
   * 返回 MCP tools/list 兼容格式
   *
   * 使用原子替换模式避免并发调用时元数据丢失
   */
  listBridgedTools(): ExposedToolWithMeta[] {
    const tools: ExposedToolWithMeta[] = [];
    const newMeta = new Map<string, BridgedToolMeta>();

    // 1. ToolRegistry → 直接映射为 MCP Tool
    if (this.toolRegistry) {
      for (const tool of this.toolRegistry.getAll()) {
        if (tool.enabled === false) continue;

        const mcpName = `tool_${tool.id}`;
        const funcDef = tool.toFunctionDefinition();

        tools.push({
          name: mcpName,
          description: `[Tool] ${tool.description}`,
          inputSchema: funcDef.parameters as Record<string, unknown>,
          source: "registry-tool",
          category: tool.category,
          tags: tool.tags,
        });

        newMeta.set(mcpName, {
          source: "registry-tool",
          registryId: tool.id,
          category: tool.category,
          tags: tool.tags,
        });
      }
    }

    // 2. SkillRegistry → 作为高级工具暴露
    if (this.skillRegistry) {
      for (const skill of this.skillRegistry.getAll()) {
        const mcpName = `skill_${skill.id}`;
        const inputSchema = skill.inputSchema || this.buildSkillSchema(skill);

        tools.push({
          name: mcpName,
          description: `[Skill:${skill.domain}] ${skill.description}`,
          inputSchema: inputSchema,
          source: "registry-skill",
          category: skill.domain,
          tags: skill.tags,
        });

        newMeta.set(mcpName, {
          source: "registry-skill",
          registryId: skill.id,
          category: skill.domain,
          tags: skill.tags,
        });
      }
    }

    // 3. AgentRegistry → 作为复合工具暴露
    if (this.agentRegistry) {
      for (const agent of this.agentRegistry.getAll()) {
        const mcpName = `agent_${agent.id}`;

        tools.push({
          name: mcpName,
          description: `[Agent] ${agent.description}`,
          inputSchema: this.buildAgentSchema(agent),
          source: "registry-agent",
          category: "agent",
          tags: agent.capabilities,
        });

        newMeta.set(mcpName, {
          source: "registry-agent",
          registryId: agent.id,
          category: "agent",
          tags: agent.capabilities,
        });
      }
    }

    // 原子替换: 先构建完整新 Map，再一次性替换
    this.bridgedToolMeta.clear();
    for (const [key, value] of newMeta) {
      this.bridgedToolMeta.set(key, value);
    }

    this.logger.log(
      `Bridge discovered ${tools.length} tools ` +
        `(${this.countBySource(tools, "registry-tool")} tools, ` +
        `${this.countBySource(tools, "registry-skill")} skills, ` +
        `${this.countBySource(tools, "registry-agent")} agents)`,
    );

    return tools;
  }

  /**
   * 判断是否为桥接工具
   */
  isBridgedTool(name: string): boolean {
    return (
      name.startsWith("tool_") ||
      name.startsWith("skill_") ||
      name.startsWith("agent_")
    );
  }

  /**
   * 获取桥接工具的元数据
   */
  getBridgedToolMeta(name: string): BridgedToolMeta | undefined {
    return this.bridgedToolMeta.get(name);
  }

  /**
   * 执行桥接工具
   * 统一路由到 AIFacade 的对应方法
   */
  async executeBridgedTool(
    name: string,
    args: Record<string, unknown>,
    context: MCPRequestContext,
  ): Promise<MCPToolResponse> {
    const meta = this.bridgedToolMeta.get(name);
    if (!meta) {
      return {
        content: [{ type: "text", text: `Unknown bridged tool: ${name}` }],
        isError: true,
      };
    }

    try {
      switch (meta.source) {
        case "registry-tool":
          return this.executeRegistryTool(meta.registryId, args, context);
        case "registry-skill":
          return this.executeRegistrySkill(meta.registryId, args, context);
        case "registry-agent":
          return this.executeRegistryAgent(meta.registryId, args, context);
        default:
          return {
            content: [
              { type: "text", text: `Unsupported source: ${meta.source}` },
            ],
            isError: true,
          };
      }
    } catch (error) {
      this.logger.error(
        `Bridge tool execution failed [${name}]: ${(error as Error).message}`,
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Tool execution failed",
              tool: name,
            }),
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * 获取桥接统计
   */
  getStats(): { total: number; bySource: Record<string, number> } {
    const bySource: Record<string, number> = {};
    for (const meta of this.bridgedToolMeta.values()) {
      bySource[meta.source] = (bySource[meta.source] || 0) + 1;
    }
    return { total: this.bridgedToolMeta.size, bySource };
  }

  // =========================================================================
  // Private: Registry Tool Execution
  // =========================================================================

  private async executeRegistryTool(
    toolId: string,
    args: Record<string, unknown>,
    context: MCPRequestContext,
  ): Promise<MCPToolResponse> {
    const result = await this.toolFacade.executeTool({
      toolId,
      input: args,
      context: {
        userId: context.apiKeyId,
        sessionId: context.sessionId,
      },
      timeout: 120_000,
    });

    if (!result.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: result.error?.message || "Tool execution failed",
              code: result.error?.code,
              retryable: result.error?.retryable,
            }),
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            result: result.data,
            metadata: {
              executionId: result.metadata.executionId,
              duration: result.metadata.duration,
              tokensUsed: result.metadata.tokensUsed,
            },
          }),
        },
      ],
    };
  }

  // =========================================================================
  // Private: Skill Execution
  // =========================================================================

  private async executeRegistrySkill(
    skillId: string,
    args: Record<string, unknown>,
    _context: MCPRequestContext,
  ): Promise<MCPToolResponse> {
    // Skills 通过 Facade chat + skill injection 执行
    const task = (args.task as string) || (args.input as string) || "";
    const additionalContext = (args.context as string) || "";

    const messages: Array<{
      role: "user" | "system" | "assistant";
      content: string;
    }> = [];
    if (additionalContext) {
      messages.push({ role: "system", content: additionalContext });
    }
    messages.push({ role: "user", content: task });

    const response = await this.chatFacade.chat({
      messages,
      additionalSkills: [skillId],
      taskProfile: { creativity: "medium", outputLength: "medium" },
      strictMode: true,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            result: response.content,
            model: response.model,
            tokensUsed: response.tokensUsed,
            skillUsed: skillId,
          }),
        },
      ],
      isError: response.isError,
    };
  }

  // =========================================================================
  // Private: Agent Execution
  // =========================================================================

  private async executeRegistryAgent(
    agentId: string,
    args: Record<string, unknown>,
    _context: MCPRequestContext,
  ): Promise<MCPToolResponse> {
    const task = (args.task as string) || "";
    const agentContext = (args.context as string) || "";

    const result = await this.agentFacade.executeAgent({
      agentType: agentId,
      task,
      context: agentContext,
      config: {
        timeout: 180_000,
        maxRetries: 1,
      },
    });

    if (!result.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: result.error || "Agent execution failed",
              retryable: result.retryable,
            }),
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            result: result.content,
            tokensUsed: result.tokensUsed,
            duration: result.duration,
            agentUsed: agentId,
          }),
        },
      ],
    };
  }

  // =========================================================================
  // Private: Schema Builders
  // =========================================================================

  private buildSkillSchema(skill: {
    id: string;
    description: string;
    requiredTools?: string[];
  }): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: `Task for the ${skill.id} skill to perform`,
        },
        context: {
          type: "string",
          description: "Additional context or instructions",
        },
      },
      required: ["task"],
    };
  }

  private buildAgentSchema(agent: {
    id: string;
    name: string;
    description: string;
    capabilities: string[];
  }): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: `Task for the ${agent.name} agent. Capabilities: ${agent.capabilities.join(", ")}`,
        },
        context: {
          type: "string",
          description: "Additional context for the agent",
        },
      },
      required: ["task"],
    };
  }

  private countBySource(
    tools: ExposedToolWithMeta[],
    source: MCPToolSource,
  ): number {
    return tools.filter((t) => t.source === source).length;
  }
}
