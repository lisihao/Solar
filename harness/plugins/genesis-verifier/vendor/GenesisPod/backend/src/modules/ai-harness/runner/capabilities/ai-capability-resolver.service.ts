import { Inject, Injectable, Logger } from "@nestjs/common";
import { getToolIdAliases } from "@/common/ai/tool-id-aliases";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ToolRegistry } from "../../../ai-engine/tools/registry/tool.registry";
import { SkillRegistry } from "../../../ai-engine/skills/registry/skill.registry";
import type { IMCPProvider } from "../../../ai-engine/facade";
import { MCP_PROVIDER_PORT } from "@/modules/ai-engine/facade/abstractions/runtime-deps.tokens";
import { SkillLoaderService } from "../../../ai-engine/skills/loader/loading/skill-loader.service";
import { SkillPromptBuilder } from "../../../ai-engine/skills/builder/skill-prompt-builder.service";
import {
  CapabilityUsageLog,
  SkillPromptBundle,
  ToolBundle,
  SkillPromptOptions,
  TokenBudgetConfig,
} from "./types";
// A2 Fix: 使用统一的 BUILTIN_TOOLS 常量，与 TeamMemberAgent 保持一致
import { BUILTIN_TOOLS } from "@/modules/ai-harness/agents/abstractions/agent.types";

/**
 * AI 能力解析上下文
 */
export interface AICapabilityContext {
  agentId?: string;
  teamId?: string;
  userId?: string;
  roleId?: string;
  domain?: string;
  memberId?: string;
}

/**
 * D1: 规范化后的上下文（所有字段非空或有默认值）
 */
export interface NormalizedCapabilityContext {
  agentId: string;
  teamId: string | null;
  userId: string;
  roleId: string | null;
  domain: string;
  memberId: string | null;
}

/**
 * D1: Context 验证结果
 */
export interface ContextValidationResult {
  isValid: boolean;
  normalizedContext: NormalizedCapabilityContext;
  warnings: string[];
}

/**
 * MCP 工具信息
 */
export interface MCPToolInfo {
  serverId: string;
  toolName: string;
  description?: string;
}

/**
 * AI 能力解析服务
 * Agent 运行时使用此服务获取可用的 Tools、Skills 和 MCP Tools
 */
@Injectable()
export class AICapabilityResolver {
  private readonly logger = new Logger(AICapabilityResolver.name);

  /**
   * 问题 #1 修复: 团队配置缓存
   * 避免 resolveTokenBudget 每次调用都查询数据库
   */
  private readonly teamConfigCache = new Map<
    string,
    { metadata: Record<string, unknown> | null; timestamp: number }
  >();
  private readonly TEAM_CONFIG_CACHE_TTL = 60000; // 1分钟缓存

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry,
    @Inject(MCP_PROVIDER_PORT) private readonly mcpManager: IMCPProvider,
    private readonly skillLoader: SkillLoaderService,
    private readonly skillPromptBuilder: SkillPromptBuilder,
  ) {}

  /**
   * 解析 Agent 可用的 Tools
   * 优先级：全局配置 → 团队配置 → 角色配置
   */
  async resolveToolsForAgent(context: AICapabilityContext): Promise<string[]> {
    // 1. 获取全局启用的工具
    const enabledTools = await this.getGlobalEnabledTools();

    // 2. 如果有团队，获取团队配置的工具
    let teamTools: string[] = [];
    if (context.teamId) {
      teamTools = await this.getTeamConfiguredTools(context.teamId);
    }

    // 3. 如果有角色，获取角色允许的工具
    let roleAllowedTools: string[] | null = null;
    if (context.roleId) {
      roleAllowedTools = await this.getRoleAllowedTools(context.roleId);
    }

    // 4. 合并并过滤
    let allTools = new Set([...enabledTools, ...teamTools]);

    // 如果有角色限制，只保留角色允许的工具
    if (roleAllowedTools !== null && roleAllowedTools.length > 0) {
      allTools = new Set(
        Array.from(allTools).filter((t) => roleAllowedTools.includes(t)),
      );
    }

    this.logger.debug(
      `Resolved ${allTools.size} tools for agent context: ${JSON.stringify(context)}`,
    );

    return Array.from(allTools);
  }

  /**
   * 解析 Agent 可用的 Skills
   * 可按领域过滤
   * ★ 现在会 enforce allowedDomains + domainOverrides
   */
  async resolveSkillsForAgent(context: AICapabilityContext): Promise<string[]> {
    // 1. 获取全局启用的技能
    const enabledSkills = await this.getGlobalEnabledSkills();

    // 2. 如果有领域限制，过滤
    if (context.domain) {
      // 批量获取 SkillConfig 以检查 allowedDomains 和 domainOverrides
      const skillConfigs = await this.prisma.skillConfig.findMany({
        where: { skillId: { in: enabledSkills } },
        select: {
          skillId: true,
          domain: true,
          allowedDomains: true,
          config: true,
        },
      });
      const configMap = new Map(skillConfigs.map((c) => [c.skillId, c]));

      const filteredSkills = enabledSkills.filter((skillId) => {
        const skill = this.skillRegistry.tryGet(skillId);
        const config = configMap.get(skillId);

        // Domain match: registry domain or config domain matches context or is common/general
        const effectiveDomain = skill?.domain ?? config?.domain ?? null;
        const domainMatch =
          effectiveDomain === context.domain ||
          effectiveDomain === "common" ||
          effectiveDomain === "general" ||
          effectiveDomain === null;

        // allowedDomains enforcement: if non-empty, domain must be in list
        if (
          config?.allowedDomains &&
          config.allowedDomains.length > 0 &&
          !config.allowedDomains.includes(context.domain!)
        ) {
          return false;
        }

        // domainOverrides enforcement: check per-domain toggle
        const configJson = config?.config as Record<string, unknown> | null;
        const domainOverrides = configJson?.domainOverrides as
          | Record<string, { enabled: boolean }>
          | undefined;
        if (domainOverrides?.[context.domain!]?.enabled === false) {
          return false;
        }

        return domainMatch;
      });

      this.logger.debug(
        `Resolved ${filteredSkills.length} skills for domain ${context.domain}`,
      );

      return filteredSkills;
    }

    this.logger.debug(`Resolved ${enabledSkills.length} skills`);

    return enabledSkills;
  }

  /**
   * 解析 Agent 可用的 MCP Tools
   */
  async resolveMCPToolsForAgent(
    context: AICapabilityContext,
  ): Promise<MCPToolInfo[]> {
    // 1. 获取全局启用的 MCP 服务器
    const enabledServers = await this.prisma.mCPServerConfig.findMany({
      where: { enabled: true },
    });

    // 2. 获取已连接服务器的工具
    const mcpTools: MCPToolInfo[] = [];

    for (const server of enabledServers) {
      const client = this.mcpManager.getClient(server.serverId);
      if (client?.connected) {
        try {
          const tools = await client.listTools();
          for (const tool of tools) {
            mcpTools.push({
              serverId: server.serverId,
              toolName: tool.name,
              description: tool.description,
            });
          }
        } catch (error: unknown) {
          this.logger.warn(
            `Failed to list tools from MCP server ${server.serverId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    // 3. 如果有成员级别配置，合并
    if (context.memberId) {
      const memberMCPTools = await this.getMemberMCPTools(context.memberId);
      mcpTools.push(...memberMCPTools);
    }

    this.logger.debug(`Resolved ${mcpTools.length} MCP tools`);

    return mcpTools;
  }

  /**
   * 解析 Agent 可用的所有能力
   */
  async resolveAllCapabilities(context: AICapabilityContext): Promise<{
    tools: string[];
    skills: string[];
    mcpTools: MCPToolInfo[];
  }> {
    const [tools, skills, mcpTools] = await Promise.all([
      this.resolveToolsForAgent(context),
      this.resolveSkillsForAgent(context),
      this.resolveMCPToolsForAgent(context),
    ]);

    return { tools, skills, mcpTools };
  }

  /**
   * 检查工具是否可用
   */
  async isToolAvailable(
    toolId: string,
    context: AICapabilityContext,
  ): Promise<boolean> {
    const availableTools = await this.resolveToolsForAgent(context);
    return availableTools.includes(toolId);
  }

  /**
   * 检查技能是否可用
   */
  async isSkillAvailable(
    skillId: string,
    context: AICapabilityContext,
  ): Promise<boolean> {
    const availableSkills = await this.resolveSkillsForAgent(context);
    return availableSkills.includes(skillId);
  }

  /**
   * 获取工具配置
   */
  async getToolConfig(toolId: string): Promise<Record<string, unknown> | null> {
    for (const candidateToolId of getToolIdAliases(toolId)) {
      const config = await this.prisma.toolConfig.findUnique({
        where: { toolId: candidateToolId },
      });

      if (config?.config) {
        return config.config as Record<string, unknown>;
      }
    }

    return null;
  }

  /**
   * 获取技能配置
   */
  async getSkillConfig(
    skillId: string,
  ): Promise<Record<string, unknown> | null> {
    const config = await this.prisma.skillConfig.findUnique({
      where: { skillId },
    });

    return config?.config as Record<string, unknown> | null;
  }

  /**
   * ★ NEW: 获取工具的 Function Definitions
   * 用于 LLM Function Calling
   * A3 Fix: 现在包含 MCP 工具
   */
  async getToolFunctionDefinitions(
    context: AICapabilityContext,
  ): Promise<
    import("../../../ai-engine/tools/abstractions/tool.interface").FunctionDefinition[]
  > {
    // 1. 获取内置工具的 Function Definitions
    const toolIds = await this.resolveToolsForAgent(context);
    const builtinDefinitions =
      this.toolRegistry.getFunctionDefinitions(toolIds);

    // 2. A3 Fix: 获取 MCP 工具的 Function Definitions
    const mcpTools = await this.resolveMCPToolsForAgent(context);
    const mcpDefinitions = await this.getMCPToolFunctionDefinitions(mcpTools);

    // 3. 合并返回
    return [...builtinDefinitions, ...mcpDefinitions];
  }

  /**
   * A3 Fix: 将 MCP 工具转换为 FunctionDefinition 格式
   * 问题 #2 修复: 改进异常处理和日志记录
   */
  private async getMCPToolFunctionDefinitions(
    mcpToolsInfo: MCPToolInfo[],
  ): Promise<
    import("../../../ai-engine/tools/abstractions/tool.interface").FunctionDefinition[]
  > {
    const definitions: import("../../../ai-engine/tools/abstractions/tool.interface").FunctionDefinition[] =
      [];
    const skippedTools: string[] = [];

    // 从 MCP Manager 获取完整的工具定义
    for (const info of mcpToolsInfo) {
      try {
        const client = this.mcpManager.getClient(info.serverId);
        if (!client?.connected) {
          skippedTools.push(
            `${info.serverId}:${info.toolName} (not connected)`,
          );
          continue;
        }

        const tools = await client.listTools();
        const tool = tools.find((t) => t.name === info.toolName);

        if (!tool) {
          skippedTools.push(`${info.serverId}:${info.toolName} (not found)`);
          continue;
        }

        // 转换为 FunctionDefinition 格式
        // 使用 serverId:toolName 作为唯一标识，避免与内置工具冲突
        definitions.push({
          name: `mcp_${info.serverId}_${tool.name}`,
          description: tool.description || info.description || tool.name,
          parameters:
            tool.inputSchema as import("../../../ai-engine/tools/abstractions/tool.interface").JSONSchema,
        });
      } catch (error) {
        skippedTools.push(`${info.serverId}:${info.toolName} (error)`);
        this.logger.warn(
          `Failed to get MCP tool definition for ${info.serverId}:${info.toolName}: ${(error as Error).message}`,
        );
      }
    }

    // 记录跳过的工具，便于排查问题
    if (skippedTools.length > 0) {
      this.logger.debug(
        `[MCP] Skipped ${skippedTools.length} tools: ${skippedTools.join(", ")}`,
      );
    }

    return definitions;
  }

  /**
   * ★ NEW: 获取工具包（支持精简模式）
   * 用于 Agent 运行时，默认返回精简摘要以节省 Token
   *
   * @param context - 能力解析上下文
   * @param compact - 是否使用精简模式（默认 true）
   * @returns ToolBundle 包含工具列表和 Token 估算
   */
  async getToolBundle(
    context: AICapabilityContext,
    compact = true,
  ): Promise<ToolBundle> {
    const toolIds = await this.resolveToolsForAgent(context);

    if (toolIds.length === 0) {
      return {
        compactTools: [],
        usedTools: [],
        estimatedTokens: 0,
        isCompact: compact,
      };
    }

    const compactTools = this.toolRegistry.getCompactSummaries(toolIds);
    const estimatedTokens = this.toolRegistry.estimateTokens(toolIds, compact);

    this.logger.debug(
      `Built tool bundle: ${toolIds.length} tools, ~${estimatedTokens} tokens (compact=${compact})`,
    );

    const bundle: ToolBundle = {
      compactTools,
      usedTools: toolIds,
      estimatedTokens,
      isCompact: compact,
    };

    // 如果不使用精简模式，也获取完整定义
    if (!compact) {
      bundle.fullDefinitions =
        this.toolRegistry.getFunctionDefinitions(toolIds);
    }

    return bundle;
  }

  /**
   * ★ K4: 默认 Token 预算配置
   * 可以通过环境变量或数据库配置覆盖
   */
  private readonly defaultTokenBudget: TokenBudgetConfig = {
    skillPromptDefault: 4000,
    skillPromptMax: 8000,
    toolDefinitionDefault: 2000,
    systemMessageReserved: 1000,
  };

  /**
   * ★ NEW: 获取 Skills 的 Prompt Bundle
   * 用于注入到 System Message
   *
   * K4 Fix: 支持动态 Token 预算配置
   * @param context - 能力解析上下文
   * @param options - Skill Prompt 构建选项（可选）
   */
  async getSkillPrompts(
    context: AICapabilityContext,
    options?: SkillPromptOptions,
  ): Promise<SkillPromptBundle> {
    const skillIds = await this.resolveSkillsForAgent(context);

    if (skillIds.length === 0) {
      return {
        content: "",
        usedSkills: [],
        estimatedTokens: 0,
        wasTrimmed: false,
        skippedSkills: [],
      };
    }

    // K4: 动态获取 Token 预算
    const maxTokenBudget = await this.resolveTokenBudget(context, options);

    // 使用类型守护函数确保 domain 的类型安全
    const domain = this.validateSkillDomain(context.domain) || "general";

    // 使用 SkillLoaderService 加载 Skills（从文件系统）
    const skills = await this.skillLoader.getSkillsForTask({
      domain,
      additionalSkillIds: skillIds,
      maxTokenBudget,
    });

    if (skills.length === 0) {
      return {
        content: "",
        usedSkills: [],
        estimatedTokens: 0,
        wasTrimmed: false,
        skippedSkills: [],
      };
    }

    // 使用 SkillPromptBuilder 组装 Prompts
    const buildResult = this.skillPromptBuilder.buildSystemPrompt(skills, {
      maxTokens: maxTokenBudget,
      includeMetadata: options?.includeMetadata ?? false,
    });

    this.logger.debug(
      `Built skill prompts for ${buildResult.usedSkills.length} skills (budget: ${maxTokenBudget}): ${buildResult.usedSkills.join(", ")}`,
    );

    return {
      content: buildResult.prompt,
      usedSkills: buildResult.usedSkills,
      estimatedTokens: buildResult.estimatedTokens,
      wasTrimmed: buildResult.wasTrimmed,
      skippedSkills: buildResult.skippedSkills,
    };
  }

  /**
   * ★ K4: 解析 Token 预算
   * 优先级：options > 用户配置 > 团队配置 > 默认值
   * 问题 #1 修复: 使用缓存避免 N+1 查询
   */
  private async resolveTokenBudget(
    context: AICapabilityContext,
    options?: SkillPromptOptions,
  ): Promise<number> {
    // 1. 如果 options 中指定了预算，直接使用
    if (options?.maxTokenBudget) {
      // 限制在最大值以内
      return Math.min(
        options.maxTokenBudget,
        this.defaultTokenBudget.skillPromptMax,
      );
    }

    // 2. 如果有团队，尝试从缓存或数据库获取 metadata
    if (context.teamId) {
      const teamMetadata = await this.getTeamMetadataCached(context.teamId);
      if (teamMetadata && typeof teamMetadata.skillTokenBudget === "number") {
        return Math.min(
          teamMetadata.skillTokenBudget,
          this.defaultTokenBudget.skillPromptMax,
        );
      }
    }

    // 3. 返回默认值
    return this.defaultTokenBudget.skillPromptDefault;
  }

  /**
   * ★ K4: 获取当前 Token 预算配置
   * 用于诊断和管理界面显示
   */
  getTokenBudgetConfig(): TokenBudgetConfig {
    return { ...this.defaultTokenBudget };
  }

  /**
   * 问题 #1 修复: 获取团队 metadata（带缓存）
   * 避免频繁查询数据库
   */
  private async getTeamMetadataCached(
    teamId: string,
  ): Promise<Record<string, unknown> | null> {
    // 检查缓存
    const cached = this.teamConfigCache.get(teamId);
    if (cached && Date.now() - cached.timestamp < this.TEAM_CONFIG_CACHE_TTL) {
      return cached.metadata;
    }

    // 从数据库获取
    try {
      const team = await this.prisma.aITeamTemplate.findUnique({
        where: { id: teamId },
        select: { metadata: true },
      });

      const metadata = team?.metadata as Record<string, unknown> | null;

      // 更新缓存
      this.teamConfigCache.set(teamId, {
        metadata,
        timestamp: Date.now(),
      });

      return metadata;
    } catch {
      // 出错时返回 null，不缓存错误状态
      return null;
    }
  }

  /**
   * ★ NEW: 记录能力使用日志
   * 所有 Tool/Skill 调用都应该记录到 AIUsageLog
   */
  async logCapabilityUsage(log: CapabilityUsageLog): Promise<void> {
    try {
      await this.prisma.aIUsageLog.create({
        data: {
          capabilityType: log.capabilityType,
          capabilityId: log.capabilityId,
          userId: log.userId,
          teamId: log.teamId,
          agentId: log.agentId,
          success: log.success,
          duration: log.duration,
          tokensUsed: log.tokensUsed,
          errorCode: log.errorCode,
        },
      });

      this.logger.debug(
        `Logged ${log.capabilityType} usage: ${log.capabilityId} (success=${log.success})`,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to log capability usage: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ==================== Private Methods ====================

  /**
   * 获取全局启用的工具
   * ★ 默认启用所有注册的工具，只有显式设置 enabled: false 的才禁用
   * Fix: 之前的逻辑是"只返回 enabled: true 的工具"，导致未配置的工具不可用
   */
  private async getGlobalEnabledTools(): Promise<string[]> {
    // 获取所有已注册的工具 ID
    const registeredToolIds = new Set(
      this.toolRegistry.getAll().map((t) => t.id),
    );

    // 获取显式禁用的工具（enabled: false）
    const disabledConfigs = await this.prisma.toolConfig.findMany({
      where: { enabled: false },
      select: { toolId: true },
    });

    const disabledToolIds = new Set(disabledConfigs.map((c) => c.toolId));

    // ★ 返回所有已注册的工具，排除显式禁用的
    // 这样未配置的工具默认为启用状态
    return Array.from(registeredToolIds).filter(
      (toolId) => !disabledToolIds.has(toolId),
    );
  }

  /**
   * 获取全局启用的技能
   * ★ 默认启用所有注册的技能，只有显式设置 enabled: false 的才禁用
   */
  private async getGlobalEnabledSkills(): Promise<string[]> {
    // 获取所有已注册的技能 ID
    const registeredSkillIds = new Set(
      this.skillRegistry.getAll().map((s) => s.id),
    );

    // 获取显式禁用的技能（enabled: false）
    const disabledConfigs = await this.prisma.skillConfig.findMany({
      where: { enabled: false },
      select: { skillId: true },
    });

    const disabledSkillIds = new Set(disabledConfigs.map((c) => c.skillId));

    // ★ 返回所有已注册的技能，排除显式禁用的
    return Array.from(registeredSkillIds).filter(
      (skillId) => !disabledSkillIds.has(skillId),
    );
  }

  /**
   * 获取团队配置的工具
   * A1 Fix: 使用 capabilityToToolIds 获取完整的工具列表
   */
  private async getTeamConfiguredTools(teamId: string): Promise<string[]> {
    // 从团队模板获取配置的能力
    const team = await this.prisma.aITeamTemplate.findUnique({
      where: { id: teamId },
      include: {
        members: {
          select: {
            capabilities: true,
          },
        },
      },
    });

    if (!team) {
      return [];
    }

    // 收集所有成员的能力
    const tools = new Set<string>();
    for (const member of team.members) {
      for (const capability of member.capabilities) {
        // A1 Fix: 使用 capabilityToToolIds 获取完整工具列表
        const toolIds = this.capabilityToToolIds(capability);
        for (const toolId of toolIds) {
          tools.add(toolId);
        }
      }
    }

    return Array.from(tools);
  }

  /**
   * 获取角色允许的工具
   */
  private async getRoleAllowedTools(roleId: string): Promise<string[]> {
    // 获取配置了角色限制的工具
    const configs = await this.prisma.toolConfig.findMany({
      where: {
        enabled: true,
        OR: [
          { allowedRoles: { isEmpty: true } }, // 空数组表示所有角色
          { allowedRoles: { has: roleId } },
        ],
      },
      select: { toolId: true },
    });

    return configs.map((c) => c.toolId);
  }

  /**
   * 获取成员配置的 MCP 工具
   */
  private async getMemberMCPTools(memberId: string): Promise<MCPToolInfo[]> {
    const member = await this.prisma.aITeamMemberTemplate.findUnique({
      where: { id: memberId },
      select: { mcpTools: true },
    });

    if (!member?.mcpTools) {
      return [];
    }

    // mcpTools 是 JSON 格式
    const mcpToolsConfig = member.mcpTools as Array<{
      serverId: string;
      toolName: string;
      description?: string;
    }>;

    return mcpToolsConfig.map((t) => ({
      serverId: t.serverId,
      toolName: t.toolName,
      description: t.description,
    }));
  }

  /**
   * 验证并返回有效的 SkillDomain
   * 如果 domain 不是字符串或为空，返回 null
   */
  private validateSkillDomain(
    domain: string | undefined,
  ):
    | import("../../../ai-engine/skills/types/skill-md.types").SkillDomain
    | null {
    if (!domain || typeof domain !== "string") {
      return null;
    }
    return domain;
  }

  /**
   * 将 AICapability 枚举映射到工具 ID 列表
   * A1 Fix: 完整覆盖所有 AICapability 枚举值
   * A2 Fix: 使用 BUILTIN_TOOLS 常量，与 TeamMemberAgent.CAPABILITY_TOOL_MAPPING 保持同步
   * 返回该能力对应的所有相关工具
   */
  private capabilityToToolIds(capability: string): string[] {
    // A2 Fix: 使用 BUILTIN_TOOLS 常量确保与 TeamMemberAgent 映射一致
    const mapping: Record<string, string[]> = {
      TEXT_GENERATION: [
        BUILTIN_TOOLS.TEXT_GENERATION,
        BUILTIN_TOOLS.TEMPLATE_RENDER,
      ],
      CODE_GENERATION: [
        BUILTIN_TOOLS.CODE_GENERATION,
        BUILTIN_TOOLS.PYTHON_EXECUTOR,
        BUILTIN_TOOLS.JAVASCRIPT_EXECUTOR,
      ],
      CODE_REVIEW: [
        BUILTIN_TOOLS.CODE_GENERATION,
        BUILTIN_TOOLS.DATA_VALIDATION,
      ],
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
      REASONING: [
        BUILTIN_TOOLS.TEXT_GENERATION,
        BUILTIN_TOOLS.STRUCTURED_OUTPUT,
      ],
      MATH: [BUILTIN_TOOLS.PYTHON_EXECUTOR, BUILTIN_TOOLS.DATA_ANALYSIS],
      TRANSLATION: [BUILTIN_TOOLS.TEXT_GENERATION],
      SUMMARIZATION: [
        BUILTIN_TOOLS.TEXT_GENERATION,
        BUILTIN_TOOLS.STRUCTURED_OUTPUT,
      ],
    };

    return mapping[capability] || [];
  }

  // ==================== D1: Context Validation ====================

  /**
   * D1: 验证并规范化上下文
   * 确保所有必要字段都有默认值，记录警告
   */
  validateAndNormalizeContext(
    context: AICapabilityContext,
  ): ContextValidationResult {
    const warnings: string[] = [];

    // 验证并设置默认值
    const normalizedContext: NormalizedCapabilityContext = {
      agentId: context.agentId || "default-agent",
      teamId: context.teamId || null,
      userId: context.userId || "system",
      roleId: context.roleId || null,
      domain: context.domain || "general",
      memberId: context.memberId || null,
    };

    // 记录警告
    if (!context.agentId) {
      warnings.push("No agentId provided, using default-agent");
    }
    if (!context.userId) {
      warnings.push("No userId provided, using system");
    }
    if (!context.domain) {
      warnings.push("No domain provided, using general");
    }

    // 验证 ID 格式（如果提供）
    if (context.teamId && !this.isValidUUID(context.teamId)) {
      warnings.push(`Invalid teamId format: ${context.teamId}`);
    }
    if (context.memberId && !this.isValidUUID(context.memberId)) {
      warnings.push(`Invalid memberId format: ${context.memberId}`);
    }

    // 记录警告日志
    if (warnings.length > 0) {
      this.logger.debug(
        `[D1] Context validation warnings: ${warnings.join("; ")}`,
      );
    }

    return {
      isValid: true, // 即使有警告也认为有效（使用默认值）
      normalizedContext,
      warnings,
    };
  }

  /**
   * D1: 创建带默认值的上下文
   * 便捷方法，用于调用者不需要完整上下文时
   */
  createDefaultContext(
    overrides?: Partial<AICapabilityContext>,
  ): AICapabilityContext {
    return {
      agentId: "default-agent",
      userId: "system",
      domain: "general",
      ...overrides,
    };
  }

  /**
   * D1: 验证 UUID 格式
   */
  private isValidUUID(str: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }
}

// 保持向后兼容的类型别名
export type CapabilityContext = AICapabilityContext;
