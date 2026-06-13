/**
 * MCP Resource Provider
 *
 * 将 GenesisPod 的知识库和内部数据暴露为 MCP Resources，
 * 让外部 AI 工具（Claude Code、Cursor 等）可以读取 GenesisPod 管理的内容。
 *
 * 资源 URI 规范:
 * - genesis://capabilities         → 能力摘要
 * - genesis://tools                → 工具列表
 * - genesis://skills               → 技能列表
 * - genesis://agents               → Agent 列表
 * - genesis://teams                → Team 配置列表
 * - genesis://models               → 可用模型列表
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  IMCPResourceProvider,
  MCPResource,
  MCPResourceContent,
} from "../abstractions/mcp-server.interface";
import { ToolRegistry, SkillRegistry } from "../../../../ai-engine/facade";
import { TeamRegistry, ChatFacade } from "../../../../ai-harness/facade";
import { AgentRegistry } from "../../../../ai-harness/facade";
import type { IPlanBasedAgent } from "../../../../ai-harness/facade";
import { APP_CONFIG } from "../../../../../common/config/app.config";
import { ResearchToolHandler } from "../tools/research-tool-handler";

/** 研究结果资源 URI 前缀 */
const RESEARCH_RESULT_PREFIX = "genesis://research/result/";

@Injectable()
export class MCPResourceProvider implements IMCPResourceProvider {
  private readonly logger = new Logger(MCPResourceProvider.name);

  constructor(
    private readonly facade: ChatFacade,
    @Optional() private readonly toolRegistry?: ToolRegistry,
    @Optional() private readonly skillRegistry?: SkillRegistry,
    @Optional() private readonly agentRegistry?: AgentRegistry,
    @Optional() private readonly teamRegistry?: TeamRegistry,
    @Optional() private readonly researchToolHandler?: ResearchToolHandler,
  ) {}

  async listResources(): Promise<MCPResource[]> {
    const resources: MCPResource[] = [
      {
        uri: "genesis://capabilities",
        name: `${APP_CONFIG.brand.fullName} Capabilities`,
        description:
          "Overview of all available AI capabilities, tools, skills, and agents",
        mimeType: "application/json",
      },
      {
        uri: "genesis://tools",
        name: "Available Tools",
        description:
          "List of all registered tools with their schemas and categories",
        mimeType: "application/json",
      },
      {
        uri: "genesis://skills",
        name: "Available Skills",
        description:
          "List of all registered skills organized by domain and layer",
        mimeType: "application/json",
      },
      {
        uri: "genesis://agents",
        name: "Available Agents",
        description: "List of all registered agents with their capabilities",
        mimeType: "application/json",
      },
      {
        uri: "genesis://teams",
        name: "Team Configurations",
        description:
          "Available team configurations for multi-agent collaboration",
        mimeType: "application/json",
      },
      {
        uri: "genesis://models",
        name: "Available AI Models",
        description: "List of all configured and available AI models",
        mimeType: "application/json",
      },
      {
        uri: `${RESEARCH_RESULT_PREFIX}{taskId}`,
        name: "Research Result",
        description:
          "Retrieve a completed deep research result by taskId. " +
          "Call genesis_deep_research first to get a taskId, then read " +
          `${RESEARCH_RESULT_PREFIX}<taskId> to fetch the report (cached 30 min). ` +
          "Use this to recover results if your SSE connection was interrupted.",
        mimeType: "application/json",
      },
    ];

    return resources;
  }

  async readResource(uri: string): Promise<MCPResourceContent> {
    this.logger.log(`Reading resource: ${uri}`);

    try {
      // 动态前缀：研究结果检索（SSE 断连后的恢复路径）
      if (uri.startsWith(RESEARCH_RESULT_PREFIX)) {
        const taskId = uri.slice(RESEARCH_RESULT_PREFIX.length);
        return this.readResearchResult(uri, taskId);
      }

      switch (uri) {
        case "genesis://capabilities":
          return this.readCapabilities();
        case "genesis://tools":
          return this.readTools();
        case "genesis://skills":
          return this.readSkills();
        case "genesis://agents":
          return this.readAgents();
        case "genesis://teams":
          return this.readTeams();
        case "genesis://models":
          return this.readModels();
        default:
          return {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({ error: "Resource not found" }),
          };
      }
    } catch (error) {
      this.logger.error(
        `Failed to read resource ${uri}: ${(error as Error).message}`,
      );
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({ error: "Resource read failed" }),
      };
    }
  }

  private async readCapabilities(): Promise<MCPResourceContent> {
    const toolCount = this.toolRegistry?.size() || 0;
    const skillCount = this.skillRegistry?.size() || 0;
    const agentCount = this.agentRegistry?.size() || 0;
    const teamCount = this.teamRegistry?.size() || 0;

    const toolStats = this.toolRegistry?.getStats();
    const skillStats = this.skillRegistry?.getStats();

    const data = {
      engine: "genesis-ai",
      version: "1.0.0",
      summary: {
        totalTools: toolCount,
        totalSkills: skillCount,
        totalAgents: agentCount,
        totalTeams: teamCount,
      },
      toolCategories: toolStats?.byCategory || {},
      skillDomains: skillStats?.byDomain || {},
      skillLayers: skillStats?.byLayer || {},
      features: [
        "multi-model-chat",
        "web-search",
        "deep-research",
        "team-collaboration",
        "content-analysis",
        "writing-assistance",
        "memory-management",
        "tool-execution",
        "agent-orchestration",
        "streaming-support",
      ],
    };

    return {
      uri: "genesis://capabilities",
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2),
    };
  }

  private readTools(): MCPResourceContent {
    const tools = this.toolRegistry?.getAll() || [];
    const data = tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      tags: tool.tags || [],
      enabled: tool.enabled !== false,
      inputSchema: tool.inputSchema,
    }));

    return {
      uri: "genesis://tools",
      mimeType: "application/json",
      text: JSON.stringify({ tools: data, count: data.length }, null, 2),
    };
  }

  private readSkills(): MCPResourceContent {
    const skills = this.skillRegistry?.getAll() || [];
    const data = skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      domain: skill.domain,
      layer: skill.layer,
      tags: skill.tags || [],
      requiredTools: skill.requiredTools || [],
      version: skill.version,
    }));

    return {
      uri: "genesis://skills",
      mimeType: "application/json",
      text: JSON.stringify({ skills: data, count: data.length }, null, 2),
    };
  }

  private readAgents(): MCPResourceContent {
    const agents: IPlanBasedAgent[] = this.agentRegistry?.getAll() || [];
    const data = agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities: agent.capabilities,
      requiredTools: agent.requiredTools,
    }));

    return {
      uri: "genesis://agents",
      mimeType: "application/json",
      text: JSON.stringify({ agents: data, count: data.length }, null, 2),
    };
  }

  private readTeams(): MCPResourceContent {
    const configs = this.teamRegistry?.getAllConfigs() || [];
    const data = configs.map((config) => ({
      id: config.id,
      name: config.name,
      description: config.description,
      type: config.type,
      deliverableTypes: config.deliverableTypes,
      availableSkills: config.availableSkills,
      availableTools: config.availableTools,
    }));

    return {
      uri: "genesis://teams",
      mimeType: "application/json",
      text: JSON.stringify({ teams: data, count: data.length }, null, 2),
    };
  }

  private readResearchResult(uri: string, taskId: string): MCPResourceContent {
    if (!taskId) {
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          error: "Missing taskId",
          hint: `Use URI format: ${RESEARCH_RESULT_PREFIX}<taskId>`,
        }),
      };
    }

    if (!this.researchToolHandler) {
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({ error: "Research handler not available" }),
      };
    }

    const cached = this.researchToolHandler.getCachedResult(taskId);

    if (!cached) {
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          taskId,
          status: "not_found",
          message:
            "Result not found. Either the taskId is invalid, the research is still running, " +
            "or the result expired (cached for 30 minutes after completion).",
        }),
      };
    }

    if (cached.isError) {
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          taskId,
          status: "error",
          error: cached.data,
          storedAt: cached.storedAt,
        }),
      };
    }

    this.logger.log(`Research result retrieved via resources/read: ${taskId}`);
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify({
        taskId,
        status: "complete",
        result: cached.data,
        storedAt: cached.storedAt,
      }),
    };
  }

  private async readModels(): Promise<MCPResourceContent> {
    try {
      const models = await this.facade.getAvailableModels();
      return {
        uri: "genesis://models",
        mimeType: "application/json",
        text: JSON.stringify({ models, count: models.length }, null, 2),
      };
    } catch {
      return {
        uri: "genesis://models",
        mimeType: "application/json",
        text: JSON.stringify({
          models: [],
          count: 0,
          error: "Unable to fetch models",
        }),
      };
    }
  }
}
