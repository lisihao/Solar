/**
 * TeamMemberAgent - AI Teams 成员 Agent
 *
 * 将 TopicAIMember 转换为具备工具调用能力的 Agent
 * 根据成员的角色、能力和专业领域自动配置可用工具
 */

import { Injectable, Logger } from "@nestjs/common";
import { AICapability, AgentWorkStyle } from "@prisma/client";
import {
  BUILTIN_TOOLS,
  type BuiltinToolId,
  ToolRegistry,
  type ITool,
  type ToolContext,
} from "@/modules/ai-harness/facade";

/**
 * 团队成员角色类型
 */
export type TeamMemberRole =
  | "researcher" // 研究员：信息搜集与分析
  | "analyst" // 分析师：数据分析与洞察
  | "writer" // 作家：内容创作与文档
  | "developer" // 开发者：代码生成与技术
  | "designer" // 设计师：视觉设计与创意
  | "moderator" // 主持人：协调与组织
  | "leader" // Leader：任务分配与决策
  | "general"; // 通用：基础能力

/**
 * MCP 工具配置
 * A3 Fix: 添加 MCP 工具支持
 */
export interface MCPToolConfig {
  serverId: string;
  toolName: string;
  description?: string;
}

/**
 * 成员 Agent 配置
 */
export interface TeamMemberAgentConfig {
  memberId: string;
  displayName: string;
  role: TeamMemberRole;
  capabilities: AICapability[];
  expertiseAreas: string[];
  workStyle: AgentWorkStyle | null;
  isLeader: boolean;
  customTools?: BuiltinToolId[];
  /** A3 Fix: MCP 工具配置 */
  mcpTools?: MCPToolConfig[];
}

/**
 * 工具执行上下文
 */
export interface ToolExecutionContext {
  topicId: string;
  memberId: string;
  messageId?: string;
  prompt: string;
  resources?: string[];
}

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
  success: boolean;
  toolType: BuiltinToolId;
  output: unknown;
  duration: number;
  error?: string;
}

@Injectable()
export class TeamMemberAgent {
  private readonly logger = new Logger(TeamMemberAgent.name);

  /**
   * 角色到工具类型的映射
   * 每个角色有一组默认可用的工具
   */
  private static readonly ROLE_TOOL_MAPPING: Record<
    TeamMemberRole,
    BuiltinToolId[]
  > = {
    researcher: [
      BUILTIN_TOOLS.WEB_SEARCH,
      BUILTIN_TOOLS.WEB_SCRAPER,
      BUILTIN_TOOLS.RAG_SEARCH,
      BUILTIN_TOOLS.KNOWLEDGE_GRAPH,
      BUILTIN_TOOLS.DATA_FETCH,
      BUILTIN_TOOLS.SHORT_TERM_MEMORY,
    ],
    analyst: [
      BUILTIN_TOOLS.DATA_ANALYSIS,
      BUILTIN_TOOLS.PYTHON_EXECUTOR,
      BUILTIN_TOOLS.DATA_FETCH,
      BUILTIN_TOOLS.DATABASE_QUERY,
      BUILTIN_TOOLS.DATA_VALIDATION,
      BUILTIN_TOOLS.DATA_CLEANING,
      BUILTIN_TOOLS.STRUCTURED_OUTPUT,
    ],
    writer: [
      BUILTIN_TOOLS.TEXT_GENERATION,
      BUILTIN_TOOLS.EXPORT_DOCX,
      BUILTIN_TOOLS.EXPORT_PDF,
      BUILTIN_TOOLS.TEMPLATE_RENDER,
      BUILTIN_TOOLS.WEB_SEARCH,
      BUILTIN_TOOLS.RAG_SEARCH,
    ],
    developer: [
      BUILTIN_TOOLS.CODE_GENERATION,
      BUILTIN_TOOLS.PYTHON_EXECUTOR,
      BUILTIN_TOOLS.JAVASCRIPT_EXECUTOR,
      BUILTIN_TOOLS.SQL_EXECUTOR,
      BUILTIN_TOOLS.GITHUB_INTEGRATION,
      BUILTIN_TOOLS.SHELL_EXECUTOR,
    ],
    designer: [
      BUILTIN_TOOLS.IMAGE_GENERATION,
      BUILTIN_TOOLS.EXPORT_IMAGE,
      BUILTIN_TOOLS.EXPORT_PPTX,
      BUILTIN_TOOLS.TEMPLATE_RENDER,
    ],
    moderator: [
      BUILTIN_TOOLS.TEXT_GENERATION,
      BUILTIN_TOOLS.AGENT_HANDOFF,
      BUILTIN_TOOLS.CONSENSUS_MECHANISM,
      BUILTIN_TOOLS.AGENT_COMMUNICATION,
      BUILTIN_TOOLS.SHORT_TERM_MEMORY,
    ],
    leader: [
      BUILTIN_TOOLS.TEXT_GENERATION,
      BUILTIN_TOOLS.TASK_DELEGATION,
      BUILTIN_TOOLS.AGENT_HANDOFF,
      BUILTIN_TOOLS.CONSENSUS_MECHANISM,
      BUILTIN_TOOLS.WORKFLOW_ORCHESTRATION,
      BUILTIN_TOOLS.HUMAN_APPROVAL,
      BUILTIN_TOOLS.SHORT_TERM_MEMORY,
      BUILTIN_TOOLS.LONG_TERM_MEMORY,
    ],
    general: [
      BUILTIN_TOOLS.TEXT_GENERATION,
      BUILTIN_TOOLS.WEB_SEARCH,
      BUILTIN_TOOLS.SHORT_TERM_MEMORY,
    ],
  };

  /**
   * AICapability 到 BuiltinToolId 的映射
   * 将 Prisma 枚举映射到工具类型
   */
  private static readonly CAPABILITY_TOOL_MAPPING: Record<
    AICapability,
    BuiltinToolId[]
  > = {
    TEXT_GENERATION: [
      BUILTIN_TOOLS.TEXT_GENERATION,
      BUILTIN_TOOLS.TEMPLATE_RENDER,
    ],
    CODE_GENERATION: [
      BUILTIN_TOOLS.CODE_GENERATION,
      BUILTIN_TOOLS.PYTHON_EXECUTOR,
      BUILTIN_TOOLS.JAVASCRIPT_EXECUTOR,
    ],
    CODE_REVIEW: [BUILTIN_TOOLS.CODE_GENERATION, BUILTIN_TOOLS.DATA_VALIDATION],
    IMAGE_GENERATION: [
      BUILTIN_TOOLS.IMAGE_GENERATION,
      BUILTIN_TOOLS.EXPORT_IMAGE,
    ],
    IMAGE_ANALYSIS: [
      BUILTIN_TOOLS.OCR_RECOGNITION,
      BUILTIN_TOOLS.DATA_ANALYSIS,
    ],
    WEB_SEARCH: [BUILTIN_TOOLS.WEB_SEARCH, BUILTIN_TOOLS.WEB_SCRAPER],
    URL_FETCH: [BUILTIN_TOOLS.WEB_SCRAPER, BUILTIN_TOOLS.DATA_FETCH],
    DOCUMENT_ANALYSIS: [
      BUILTIN_TOOLS.FILE_PARSER,
      BUILTIN_TOOLS.RAG_SEARCH,
      BUILTIN_TOOLS.DATA_ANALYSIS,
    ],
    REASONING: [BUILTIN_TOOLS.TEXT_GENERATION, BUILTIN_TOOLS.STRUCTURED_OUTPUT],
    MATH: [BUILTIN_TOOLS.PYTHON_EXECUTOR, BUILTIN_TOOLS.DATA_ANALYSIS],
    TRANSLATION: [BUILTIN_TOOLS.TEXT_GENERATION],
    SUMMARIZATION: [
      BUILTIN_TOOLS.TEXT_GENERATION,
      BUILTIN_TOOLS.STRUCTURED_OUTPUT,
    ],
  };

  /**
   * 专业领域关键词到工具的映射
   */
  private static readonly EXPERTISE_TOOL_MAPPING: Record<
    string,
    BuiltinToolId[]
  > = {
    // 技术领域
    编程: [BUILTIN_TOOLS.CODE_GENERATION, BUILTIN_TOOLS.PYTHON_EXECUTOR],
    开发: [BUILTIN_TOOLS.CODE_GENERATION, BUILTIN_TOOLS.GITHUB_INTEGRATION],
    数据库: [BUILTIN_TOOLS.DATABASE_QUERY, BUILTIN_TOOLS.SQL_EXECUTOR],
    前端: [BUILTIN_TOOLS.CODE_GENERATION, BUILTIN_TOOLS.JAVASCRIPT_EXECUTOR],
    后端: [
      BUILTIN_TOOLS.CODE_GENERATION,
      BUILTIN_TOOLS.PYTHON_EXECUTOR,
      BUILTIN_TOOLS.SQL_EXECUTOR,
    ],
    // 数据领域
    数据分析: [BUILTIN_TOOLS.DATA_ANALYSIS, BUILTIN_TOOLS.PYTHON_EXECUTOR],
    机器学习: [BUILTIN_TOOLS.PYTHON_EXECUTOR, BUILTIN_TOOLS.DATA_ANALYSIS],
    统计: [BUILTIN_TOOLS.DATA_ANALYSIS, BUILTIN_TOOLS.PYTHON_EXECUTOR],
    // 创意领域
    设计: [BUILTIN_TOOLS.IMAGE_GENERATION, BUILTIN_TOOLS.EXPORT_IMAGE],
    写作: [BUILTIN_TOOLS.TEXT_GENERATION, BUILTIN_TOOLS.EXPORT_DOCX],
    文案: [BUILTIN_TOOLS.TEXT_GENERATION],
    // 研究领域
    研究: [
      BUILTIN_TOOLS.WEB_SEARCH,
      BUILTIN_TOOLS.RAG_SEARCH,
      BUILTIN_TOOLS.KNOWLEDGE_GRAPH,
    ],
    调研: [BUILTIN_TOOLS.WEB_SEARCH, BUILTIN_TOOLS.DATA_FETCH],
  };

  constructor(private readonly toolRegistry: ToolRegistry) {}

  /**
   * 根据成员配置解析可用工具列表
   */
  resolveTools(config: TeamMemberAgentConfig): BuiltinToolId[] {
    const tools = new Set<BuiltinToolId>();

    // 1. 基于角色添加工具
    const roleTools = TeamMemberAgent.ROLE_TOOL_MAPPING[config.role] || [];
    roleTools.forEach((tool) => tools.add(tool));

    // 2. 基于 AICapability 添加工具
    config.capabilities.forEach((cap) => {
      const capTools = TeamMemberAgent.CAPABILITY_TOOL_MAPPING[cap] || [];
      capTools.forEach((tool) => tools.add(tool));
    });

    // 3. 基于专业领域添加工具
    config.expertiseAreas.forEach((area) => {
      // 模糊匹配专业领域
      Object.entries(TeamMemberAgent.EXPERTISE_TOOL_MAPPING).forEach(
        ([keyword, expertiseTools]) => {
          if (area.includes(keyword) || keyword.includes(area)) {
            expertiseTools.forEach((tool) => tools.add(tool));
          }
        },
      );
    });

    // 4. Leader 额外添加协作工具
    if (config.isLeader) {
      [
        BUILTIN_TOOLS.TASK_DELEGATION,
        BUILTIN_TOOLS.WORKFLOW_ORCHESTRATION,
        BUILTIN_TOOLS.CONSENSUS_MECHANISM,
        BUILTIN_TOOLS.HUMAN_APPROVAL,
      ].forEach((tool) => tools.add(tool));
    }

    // 5. 添加自定义工具
    if (config.customTools) {
      config.customTools.forEach((tool) => tools.add(tool));
    }

    // 6. 所有成员都有基础记忆工具
    tools.add(BUILTIN_TOOLS.SHORT_TERM_MEMORY);

    this.logger.debug(
      `[resolveTools] Member ${config.displayName} (${config.role}): ${tools.size} tools resolved`,
    );

    return Array.from(tools);
  }

  /**
   * A3 Fix: 解析成员配置的 MCP 工具列表
   * 返回成员配置中的 MCP 工具，用于传递给 Agent 执行器
   */
  resolveMCPTools(config: TeamMemberAgentConfig): MCPToolConfig[] {
    if (!config.mcpTools || config.mcpTools.length === 0) {
      return [];
    }

    this.logger.debug(
      `[resolveMCPTools] Member ${config.displayName}: ${config.mcpTools.length} MCP tools configured`,
    );

    return config.mcpTools;
  }

  /**
   * A3 Fix: 解析成员的所有工具（内置工具 + MCP 工具）
   * 返回一个包含所有工具信息的结构
   */
  resolveAllTools(config: TeamMemberAgentConfig): {
    builtinTools: BuiltinToolId[];
    mcpTools: MCPToolConfig[];
  } {
    return {
      builtinTools: this.resolveTools(config),
      mcpTools: this.resolveMCPTools(config),
    };
  }

  /**
   * 根据角色描述推断成员角色
   */
  inferRoleFromDescription(
    roleDescription: string | null | undefined,
  ): TeamMemberRole {
    if (!roleDescription) return "general";

    const description = roleDescription.toLowerCase();

    // Leader 检测
    if (
      description.includes("leader") ||
      description.includes("领导") ||
      description.includes("负责人") ||
      description.includes("项目经理")
    ) {
      return "leader";
    }

    // 研究员检测
    if (
      description.includes("研究") ||
      description.includes("调研") ||
      description.includes("researcher")
    ) {
      return "researcher";
    }

    // 分析师检测
    if (
      description.includes("分析") ||
      description.includes("数据") ||
      description.includes("analyst")
    ) {
      return "analyst";
    }

    // 开发者检测
    if (
      description.includes("开发") ||
      description.includes("程序") ||
      description.includes("工程师") ||
      description.includes("developer") ||
      description.includes("engineer")
    ) {
      return "developer";
    }

    // 设计师检测
    if (
      description.includes("设计") ||
      description.includes("美术") ||
      description.includes("ui") ||
      description.includes("designer")
    ) {
      return "designer";
    }

    // 作家检测
    if (
      description.includes("写作") ||
      description.includes("文案") ||
      description.includes("编辑") ||
      description.includes("writer")
    ) {
      return "writer";
    }

    // 主持人检测
    if (
      description.includes("主持") ||
      description.includes("协调") ||
      description.includes("moderator")
    ) {
      return "moderator";
    }

    return "general";
  }

  /**
   * 获取工具实例列表
   */
  getToolInstances(toolTypes: BuiltinToolId[]): ITool[] {
    const tools: ITool[] = [];

    for (const type of toolTypes) {
      if (this.toolRegistry.has(type)) {
        const tool = this.toolRegistry.get(type);
        tools.push(tool);
      } else {
        this.logger.warn(`[getToolInstances] Tool not found: ${type}`);
      }
    }

    return tools;
  }

  /**
   * 执行单个工具
   */
  async executeTool(
    toolType: BuiltinToolId,
    input: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    try {
      if (!this.toolRegistry.has(toolType)) {
        return {
          success: false,
          toolType,
          output: null,
          duration: Date.now() - startTime,
          error: `Tool not found: ${toolType}`,
        };
      }

      const tool = this.toolRegistry.get(toolType);

      // 构建工具上下文
      const toolContext: ToolContext = {
        executionId: context.messageId || `task_${Date.now()}`,
        toolId: toolType,
        taskId: context.messageId || `task_${Date.now()}`,
        userId: context.memberId,
        workspaceId: context.topicId,
        createdAt: new Date(),
      };

      // 执行工具
      const result = await tool.execute(input, toolContext);

      return {
        success: result.success,
        toolType,
        output: result.data,
        duration: Date.now() - startTime,
        error: result.error?.message,
      };
    } catch (error) {
      this.logger.error(`[executeTool] Failed to execute ${toolType}:`, error);

      return {
        success: false,
        toolType,
        output: null,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 批量执行多个工具（并行）
   */
  async executeToolsParallel(
    executions: Array<{
      toolType: BuiltinToolId;
      input: Record<string, unknown>;
    }>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult[]> {
    const promises = executions.map(({ toolType, input }) =>
      this.executeTool(toolType, input, context),
    );

    return Promise.all(promises);
  }

  /**
   * 批量执行多个工具（顺序）
   */
  async executeToolsSequential(
    executions: Array<{
      toolType: BuiltinToolId;
      input: Record<string, unknown>;
    }>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const { toolType, input } of executions) {
      const result = await this.executeTool(toolType, input, context);
      results.push(result);

      // 如果工具执行失败，可以选择中断或继续
      if (!result.success) {
        this.logger.warn(
          `[executeToolsSequential] Tool ${toolType} failed, continuing...`,
        );
      }
    }

    return results;
  }

  /**
   * 生成工具调用的 Function Calling Schema
   * 用于传递给 LLM 进行工具选择
   */
  generateFunctionCallingSchema(toolTypes: BuiltinToolId[]): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    const schemas: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }> = [];

    for (const type of toolTypes) {
      if (this.toolRegistry.has(type)) {
        const tool = this.toolRegistry.get(type);
        schemas.push({
          name: type,
          description: tool.description,
          parameters: tool.inputSchema as Record<string, unknown>,
        });
      }
    }

    return schemas;
  }

  /**
   * 构建成员的系统提示词增强部分
   * 描述该成员可用的工具能力
   */
  buildToolsSystemPrompt(toolTypes: BuiltinToolId[]): string {
    if (toolTypes.length === 0) {
      return "";
    }

    const toolDescriptions = toolTypes
      .map((type) => {
        if (!this.toolRegistry.has(type)) return null;
        const tool = this.toolRegistry.get(type);
        return `- ${type}: ${tool.description}`;
      })
      .filter(Boolean)
      .join("\n");

    return `
## 可用工具

你可以使用以下工具来完成任务：

${toolDescriptions}

当需要使用工具时，请明确说明你要使用的工具名称和参数。
`;
  }

  /**
   * 根据工作风格调整工具执行策略
   */
  getExecutionStrategy(workStyle: AgentWorkStyle | null): {
    parallel: boolean;
    maxConcurrent: number;
    retryOnFailure: boolean;
    timeoutMs: number;
  } {
    switch (workStyle) {
      case "AUTONOMOUS":
        return {
          parallel: true,
          maxConcurrent: 5,
          retryOnFailure: true,
          timeoutMs: 60000,
        };
      case "COLLABORATIVE":
        return {
          parallel: true,
          maxConcurrent: 3,
          retryOnFailure: true,
          timeoutMs: 45000,
        };
      case "ANALYTICAL":
        return {
          parallel: false,
          maxConcurrent: 1,
          retryOnFailure: true,
          timeoutMs: 90000,
        };
      case "CREATIVE":
        return {
          parallel: true,
          maxConcurrent: 4,
          retryOnFailure: false,
          timeoutMs: 60000,
        };
      case "SUPPORTIVE":
        return {
          parallel: false,
          maxConcurrent: 2,
          retryOnFailure: true,
          timeoutMs: 30000,
        };
      default:
        return {
          parallel: true,
          maxConcurrent: 3,
          retryOnFailure: true,
          timeoutMs: 45000,
        };
    }
  }
}
