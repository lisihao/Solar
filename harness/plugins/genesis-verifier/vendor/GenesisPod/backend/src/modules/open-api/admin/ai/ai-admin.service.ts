import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  getRegistryToolId,
  isMultiProviderRegistry,
  TOOL_ID_ALIAS_TO_REGISTRY_ID,
} from "@/common/ai/tool-id-aliases";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { EXTERNAL_TOOL_SECRET_MAPPING } from "../../../platform/credentials/storage/secrets/secret-name.catalog";
import { EXTERNAL_TOOL_DEFINITIONS } from "../../../platform/credentials/storage/secrets/external-tool-definitions";
import { DEFAULT_PAGE_SIZE } from "../../../../common/constants/pagination.constants";

/**
 * MCP Tool 类型定义
 */
interface MCPToolInfo {
  name: string;
  description?: string;
}

/**
 * ★ 内置工具 → 外部 provider 类别映射
 * 将内置工具 ID 关联到 EXTERNAL_TOOL_DEFINITIONS 的 category，
 * 用于判断该内置工具的密钥是否已通过外部 provider 配置。
 */
const BUILTIN_TOOL_TO_PROVIDER_CATEGORY: Record<string, string> = {
  "web-search": "Web Search",
  "web-scraper": "Content Extraction",
  "audio-generation": "TTS",
};

/**
 * 可执行工具接口
 */
interface ExecutableTool {
  execute(
    input: Record<string, unknown>,
    context?: Record<string, unknown>,
  ): Promise<unknown>;
}

/**
 * 类型守卫：检查工具是否可执行
 */
function isExecutableTool(tool: unknown): tool is ExecutableTool {
  return (
    typeof tool === "object" &&
    tool !== null &&
    "execute" in tool &&
    typeof (tool as ExecutableTool).execute === "function"
  );
}

/**
 * 错误类型辅助函数
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
import {
  ToolRegistry,
  SkillRegistry,
  SkillLoaderService,
  SkillContentService,
  SearchService,
  MultiKeyRegistry,
  KeyHealthStatus,
} from "../../../ai-engine/facade";
import { MCPManager } from "../../../ai-harness/facade";
import { SecretsService } from "../../../platform/credentials/storage/secrets/secrets.service";
import { enrichToolsWithSecretHealth } from "./tool-secret-health.helper";
import { analyzeToolResult } from "./tool-test-result.helper";

/**
 * AI 能力管理服务
 * 管理 Tools、Skills 和 MCP 服务器配置
 * 使用数据库持久化配置
 */
/**
 * 技能定义类型
 */
interface SkillDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string;
  layer: string;
  domain: string;
  tags: string[];
  requiredTools: string[];
  requiredSkills: string[];
}

@Injectable()
export class AIAdminService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AIAdminService.name);

  // 缓存技能定义，避免重复计算
  private skillDefinitionsCache: SkillDefinition[] | null = null;
  private skillDefinitionsCacheTime: number = 0;
  private readonly CACHE_TTL_MS = 60000; // 1 分钟缓存

  // MCP 健康检查定时器
  private mcpHealthCheckInterval: NodeJS.Timeout | null = null;
  private readonly MCP_HEALTH_CHECK_INTERVAL_MS = 60000; // 60 秒检查一次
  private readonly MCP_MAX_RETRIES = 3;
  private readonly MCP_RETRY_DELAY_MS = 5000; // 5 秒重试间隔

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry,
    private readonly skillLoaderService: SkillLoaderService,
    private readonly skillContentService: SkillContentService,
    private readonly mcpManager: MCPManager,
    private readonly secretsService: SecretsService,
    private readonly searchService: SearchService,
  ) {}

  /**
   * 模块初始化时加载配置
   */
  async onModuleInit() {
    await this.initializeConfigs();
    // 启动 MCP 健康检查定时器
    this.startMCPHealthCheck();
  }

  /**
   * 模块销毁时清理定时器
   */
  onModuleDestroy() {
    if (this.mcpHealthCheckInterval) {
      clearInterval(this.mcpHealthCheckInterval);
      this.mcpHealthCheckInterval = null;
    }
  }

  /**
   * 获取能力使用次数统计（按类型分组）
   * 用于在 UI 上显示工具/技能的使用次数
   */
  async getUsageCountsByType(
    capabilityType: "tool" | "skill" | "mcp",
  ): Promise<Record<string, number>> {
    const stats = await this.prisma.aIUsageLog.groupBy({
      by: ["capabilityId"],
      where: { capabilityType },
      _count: { capabilityId: true },
    });

    const result: Record<string, number> = {};
    for (const stat of stats) {
      result[stat.capabilityId] = stat._count.capabilityId;
    }
    return result;
  }

  /**
   * 初始化配置 - 同步工具/技能配置 + 连接 MCP 服务器
   */
  private async initializeConfigs() {
    try {
      // ★ 1. 同步工具配置：为所有注册的工具创建数据库记录（默认启用）
      await this.syncToolConfigs();

      // ★ 2. 同步技能配置：为所有注册的技能创建数据库记录（默认启用）
      await this.syncSkillConfigs();

      // 3. 加载 MCP 服务器配置并自动连接
      const mcpServers = await this.prisma.mCPServerConfig.findMany({
        where: { enabled: true, autoConnect: true },
      });

      this.logger.log(
        `[MCP Auto-Connect] Found ${mcpServers.length} servers to auto-connect: ${mcpServers.map((s) => s.serverId).join(", ") || "none"}`,
      );

      for (const server of mcpServers) {
        this.logger.log(
          `[MCP Auto-Connect] Attempting to connect: ${server.serverId} (transport: ${server.transport})`,
        );
        try {
          // M2 Fix: 从 SecretsService 解析 API 密钥
          const env = await this.resolveMCPServerEnv(server);

          // 注册到 MCPManager
          if (server.transport === "stdio" && server.command) {
            this.mcpManager.registerServer({
              id: server.serverId,
              name: server.name,
              transport: "stdio",
              command: server.command,
              args: server.args || [],
              env,
            });
          } else if (server.transport === "sse" && server.url) {
            this.mcpManager.registerServer({
              id: server.serverId,
              name: server.name,
              transport: "http",
              url: server.url,
              env,
            });
          }

          // 自动连接
          await this.mcpManager.connect(server.serverId);
          this.logger.log(
            `[MCP Auto-Connect] ✓ Successfully connected: ${server.serverId}`,
          );

          // 记录连接成功状态
          await this.updateMCPServerConnectionStatus(server.serverId, {
            connected: true,
            lastConnectedAt: new Date().toISOString(),
            lastError: null,
          });
        } catch (error: unknown) {
          const errorMsg = getErrorMessage(error);
          this.logger.error(
            `[MCP Auto-Connect] ✗ Failed to connect ${server.serverId}: ${errorMsg}`,
          );

          // 记录连接失败状态
          await this.updateMCPServerConnectionStatus(server.serverId, {
            connected: false,
            lastError: errorMsg,
            lastErrorAt: new Date().toISOString(),
          });
        }
      }

      this.logger.log(
        `[MCP] Initialization complete: ${mcpServers.length} servers processed`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to initialize configs: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * 启动 MCP 健康检查定时器
   * 定期检查所有应该自动连接的服务器，如果断开则尝试重连
   */
  private startMCPHealthCheck(): void {
    this.mcpHealthCheckInterval = setInterval(async () => {
      await this.checkAndReconnectMCPServers();
    }, this.MCP_HEALTH_CHECK_INTERVAL_MS).unref();

    this.logger.log(
      `MCP health check started (interval: ${this.MCP_HEALTH_CHECK_INTERVAL_MS / 1000}s)`,
    );
  }

  /**
   * 检查并重连断开的 MCP 服务器
   */
  private async checkAndReconnectMCPServers(): Promise<void> {
    try {
      // 获取所有应该自动连接的服务器
      const servers = await this.prisma.mCPServerConfig.findMany({
        where: { enabled: true, autoConnect: true },
      });

      for (const server of servers) {
        const client = this.mcpManager.getClient(server.serverId);
        const isConnected = client?.connected ?? false;

        if (!isConnected) {
          this.logger.log(
            `MCP server ${server.serverId} is disconnected, attempting reconnect...`,
          );

          // 尝试重连（带重试）
          await this.reconnectMCPServerWithRetry(server);
        }
      }
    } catch (error) {
      this.logger.error(
        `MCP health check failed: ${getErrorMessage(error as Error)}`,
      );
    }
  }

  /**
   * 带重试机制的 MCP 服务器重连
   */
  private async reconnectMCPServerWithRetry(server: {
    serverId: string;
    name: string;
    transport: string;
    command: string | null;
    args: string[];
    url: string | null;
    secretKey: string | null;
    apiKey: string | null;
    metadata: Prisma.JsonValue;
  }): Promise<boolean> {
    for (let attempt = 1; attempt <= this.MCP_MAX_RETRIES; attempt++) {
      try {
        // 解析环境变量
        const env = await this.resolveMCPServerEnv({
          serverId: server.serverId,
          secretKey: server.secretKey,
          apiKey: server.apiKey,
          metadata: server.metadata,
        });

        // 注册或更新服务器配置
        if (server.transport === "stdio" && server.command) {
          await this.mcpManager.registerOrUpdateServer({
            id: server.serverId,
            name: server.name,
            transport: "stdio",
            command: server.command,
            args: server.args || [],
            env,
          });
        } else if (server.transport === "sse" && server.url) {
          await this.mcpManager.registerOrUpdateServer({
            id: server.serverId,
            name: server.name,
            transport: "http",
            url: server.url,
            env,
          });
        }

        // 尝试连接
        await this.mcpManager.connect(server.serverId);

        // 更新连接状态到 metadata
        await this.updateMCPServerConnectionStatus(server.serverId, {
          connected: true,
          lastConnectedAt: new Date().toISOString(),
          lastError: null,
        });

        this.logger.log(
          `Successfully reconnected MCP server: ${server.serverId} (attempt ${attempt})`,
        );
        return true;
      } catch (error) {
        const errorMsg = getErrorMessage(error as Error);
        this.logger.warn(
          `Reconnect attempt ${attempt}/${this.MCP_MAX_RETRIES} failed for ${server.serverId}: ${errorMsg}`,
        );

        // 更新错误状态
        await this.updateMCPServerConnectionStatus(server.serverId, {
          connected: false,
          lastError: errorMsg,
          lastErrorAt: new Date().toISOString(),
        });

        // 如果不是最后一次尝试，等待后重试
        if (attempt < this.MCP_MAX_RETRIES) {
          await this.sleep(this.MCP_RETRY_DELAY_MS * attempt); // 指数退避
        }
      }
    }
    return false;
  }

  /**
   * 辅助函数：延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * ★ 同步工具配置
   * 为所有在 ToolRegistry 中注册但没有数据库记录的工具创建默认配置（enabled=true）
   * 确保数据库是唯一真相来源
   */
  private async syncToolConfigs(): Promise<void> {
    try {
      const registeredTools = this.toolRegistry.getAll();
      const existingConfigs = await this.prisma.toolConfig.findMany({
        select: { toolId: true, secretKey: true },
      });
      const existingConfigMap = new Map(
        existingConfigs.map((c) => [c.toolId, c]),
      );

      // 预查所有 Secret 名称，用于自动关联
      const allSecrets = await this.prisma.secret.findMany({
        where: { isActive: true, deletedAt: null },
        select: { name: true },
      });
      const activeSecretNames = new Set(allSecrets.map((s) => s.name));

      // ★ 1. 为新工具创建配置（含自动关联 secretKey）
      const missingTools = registeredTools.filter(
        (tool) => !existingConfigMap.has(tool.id),
      );

      if (missingTools.length > 0) {
        await this.prisma.toolConfig.createMany({
          data: missingTools.map((tool) => {
            const mappedSecret = EXTERNAL_TOOL_SECRET_MAPPING[tool.id] ?? null;
            const secretKey =
              mappedSecret && activeSecretNames.has(mappedSecret)
                ? mappedSecret
                : null;
            return {
              toolId: tool.id,
              displayName: tool.name,
              description: tool.description,
              category: tool.category,
              enabled: true,
              tags: tool.tags || [],
              secretKey,
            };
          }),
          skipDuplicates: true,
        });

        this.logger.log(
          `Synced ${missingTools.length} tool configs: ${missingTools.map((t) => t.id).join(", ")}`,
        );
      }

      // ★ 2. 补全已有配置中缺失的 secretKey 关联
      const patchPromises: Promise<unknown>[] = [];
      for (const [toolId, existing] of existingConfigMap) {
        if (existing.secretKey) continue; // 已关联，跳过
        const mappedSecret = EXTERNAL_TOOL_SECRET_MAPPING[toolId] ?? null;
        if (mappedSecret && activeSecretNames.has(mappedSecret)) {
          patchPromises.push(
            this.prisma.toolConfig.update({
              where: { toolId },
              data: { secretKey: mappedSecret },
            }),
          );
        }
      }
      if (patchPromises.length > 0) {
        await Promise.all(patchPromises);
        this.logger.log(
          `Auto-linked ${patchPromises.length} tool secret(s) from EXTERNAL_TOOL_SECRET_MAPPING`,
        );
      }

      // ★ 3. 恢复 Provider ID alias 行
      // 前端用 provider ID（如 openalex）保存和查询配置，
      // 但 syncToolConfigs 步骤 1 只为 registry ID（如 openalex-search）创建行。
      // 如果 provider alias 行在之前的重启中被删除，需要从 registry tool 行恢复。
      // 反之亦然：如果 provider 行有 secretKey 而 registry 行没有，也需要同步。
      const providerSyncPromises: Promise<unknown>[] = [];
      // Re-fetch configs after step 1 & 2 mutations
      const updatedConfigs = await this.prisma.toolConfig.findMany({
        select: {
          toolId: true,
          displayName: true,
          description: true,
          category: true,
          enabled: true,
          tags: true,
          secretKey: true,
          config: true,
          requiresAuth: true,
          allowedRoles: true,
        },
      });
      const updatedConfigMap = new Map(
        updatedConfigs.map((c) => [c.toolId, c]),
      );

      for (const [providerId, registryId] of Object.entries(
        TOOL_ID_ALIAS_TO_REGISTRY_ID,
      )) {
        if (providerId === registryId) continue;
        const providerConfig = updatedConfigMap.get(providerId);
        const registryConfig = updatedConfigMap.get(registryId);

        // Case A: registry row exists, provider alias row missing → materialize alias row
        if (registryConfig && !providerConfig) {
          providerSyncPromises.push(
            this.prisma.toolConfig.upsert({
              where: { toolId: providerId },
              create: {
                toolId: providerId,
                displayName: registryConfig.displayName,
                description: registryConfig.description,
                category: registryConfig.category,
                enabled: registryConfig.enabled,
                tags: registryConfig.tags,
                secretKey: registryConfig.secretKey,
                config: registryConfig.config as
                  | Prisma.InputJsonValue
                  | undefined,
                requiresAuth: registryConfig.requiresAuth,
                allowedRoles: registryConfig.allowedRoles,
              },
              update: {
                displayName: registryConfig.displayName,
                description: registryConfig.description,
                category: registryConfig.category,
                enabled: registryConfig.enabled,
                tags: registryConfig.tags,
                secretKey: registryConfig.secretKey,
                config: registryConfig.config as
                  | Prisma.InputJsonValue
                  | undefined,
                requiresAuth: registryConfig.requiresAuth,
                allowedRoles: registryConfig.allowedRoles,
              },
            }),
          );
        }

        // Case B: provider alias row exists, registry row missing → materialize registry row
        if (providerConfig && !registryConfig) {
          providerSyncPromises.push(
            this.prisma.toolConfig.upsert({
              where: { toolId: registryId },
              create: {
                toolId: registryId,
                displayName: providerConfig.displayName,
                description: providerConfig.description,
                category: providerConfig.category,
                enabled: providerConfig.enabled,
                tags: providerConfig.tags,
                secretKey: providerConfig.secretKey,
                config: providerConfig.config as
                  | Prisma.InputJsonValue
                  | undefined,
                requiresAuth: providerConfig.requiresAuth,
                allowedRoles: providerConfig.allowedRoles,
              },
              update: {
                displayName: providerConfig.displayName,
                description: providerConfig.description,
                category: providerConfig.category,
                enabled: providerConfig.enabled,
                tags: providerConfig.tags,
                secretKey: providerConfig.secretKey,
                config: providerConfig.config as
                  | Prisma.InputJsonValue
                  | undefined,
                requiresAuth: providerConfig.requiresAuth,
                allowedRoles: providerConfig.allowedRoles,
              },
            }),
          );
        }
      }

      if (providerSyncPromises.length > 0) {
        await Promise.all(providerSyncPromises);
        this.logger.log(
          `Synced ${providerSyncPromises.length} provider↔registry alias config(s)`,
        );
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to sync tool configs: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * ★ 同步技能配置
   * 为所有在 SkillRegistry 中注册但没有数据库记录的技能创建默认配置（enabled=true）
   */
  private async syncSkillConfigs(): Promise<void> {
    try {
      const registeredSkills = this.skillRegistry.getAll();
      const existingConfigs = await this.prisma.skillConfig.findMany({
        select: { skillId: true },
      });
      const existingSkillIds = new Set(existingConfigs.map((c) => c.skillId));

      // 找出没有数据库记录的技能
      const missingSkills = registeredSkills.filter(
        (skill) => !existingSkillIds.has(skill.id),
      );

      if (missingSkills.length === 0) {
        return;
      }

      // 批量创建默认配置
      await this.prisma.skillConfig.createMany({
        data: missingSkills.map((skill) => ({
          skillId: skill.id,
          displayName: skill.name,
          description: skill.description,
          layer: skill.layer || "content",
          domain: skill.domain || "common",
          enabled: true, // 默认启用
          tags: skill.tags || [],
        })),
        skipDuplicates: true,
      });

      this.logger.log(
        `Synced ${missingSkills.length} skill configs: ${missingSkills.map((s) => s.id).join(", ")}`,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to sync skill configs: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * M2 Fix: 解析 MCP 服务器的环境变量
   * 支持从 Secret Manager 获取 API 密钥
   * 支持从 metadata.env 读取用户配置的环境变量
   */
  private async resolveMCPServerEnv(server: {
    serverId: string;
    secretKey?: string | null;
    apiKey?: string | null;
    metadata?: unknown;
  }): Promise<Record<string, string> | undefined> {
    const env: Record<string, string> = {};

    // 1. 从 metadata.env 读取用户配置的环境变量（Configure 对话框保存的）
    const metadata = server.metadata as Record<string, unknown> | null;
    const metadataEnv = (metadata?.env as Record<string, string>) || {};
    for (const [key, value] of Object.entries(metadataEnv)) {
      if (typeof value === "string" && value) {
        // 检查是否是 secret 引用（$secret:SECRET_NAME 格式）
        if (value.startsWith("$secret:")) {
          const secretName = value.replace("$secret:", "");
          const secretValue =
            await this.secretsService.getValueInternal(secretName);
          if (secretValue) {
            env[key] = secretValue;
          } else {
            this.logger.warn(
              `Secret "${secretName}" not found for env var ${key} in MCP server ${server.serverId}`,
            );
          }
        } else {
          // 直接使用值
          env[key] = value;
        }
      }
    }

    // 2. 优先使用 secretKey（新方式：从 Secret Manager 获取）
    if (server.secretKey) {
      const apiKey = await this.secretsService.getValueInternal(
        server.secretKey,
      );
      if (apiKey) {
        // 根据 secretKey 名称推断环境变量名
        // 例如 TAVILY_API_KEY -> TAVILY_API_KEY
        env[server.secretKey] = apiKey;
        // 同时设置通用的 API_KEY 环境变量
        env["API_KEY"] = apiKey;
      } else {
        this.logger.warn(
          `Secret "${server.secretKey}" not found for MCP server ${server.serverId}`,
        );
      }
    }
    // 3. 兼容旧方式：直接使用 apiKey 字段（已弃用）
    else if (server.apiKey) {
      env["API_KEY"] = server.apiKey;
    }

    // 记录解析结果（不记录实际值，只记录 key）
    if (Object.keys(env).length > 0) {
      this.logger.log(
        `Resolved env vars for MCP server ${server.serverId}: ${Object.keys(env).join(", ")}`,
      );
    } else {
      this.logger.warn(
        `No env vars resolved for MCP server ${server.serverId}. metadata.env: ${JSON.stringify(Object.keys(metadataEnv))}`,
      );
    }

    return Object.keys(env).length > 0 ? env : undefined;
  }

  // ==================== Tools ====================

  /**
   * ★ 2026-05-07 (PR-S0a): 工具别名映射对外公开。
   * 把 backend `tool-id-aliases.ts`（唯一真理源）派生的两件事情一次返回：
   *   1. aliasToRegistry：provider id → registry id 完整映射
   *   2. multiProviderRegistryIds：N:1 父 registry id 集合（前端 bridge 不
   *      从这些 parent 继承 secretKey 给 sibling provider，详见 v1.4 §1.2）
   * 前端 `useToolAliases()` 启动时拉一次，消除双源硬编码。
   */
  getToolAliases(): {
    aliasToRegistry: Record<string, string>;
    multiProviderRegistryIds: string[];
  } {
    const counts = new Map<string, number>();
    for (const registryId of Object.values(TOOL_ID_ALIAS_TO_REGISTRY_ID)) {
      counts.set(registryId, (counts.get(registryId) ?? 0) + 1);
    }
    const multiProviderRegistryIds: string[] = [];
    for (const [id, count] of counts) {
      if (count >= 2) multiProviderRegistryIds.push(id);
    }
    return {
      aliasToRegistry: { ...TOOL_ID_ALIAS_TO_REGISTRY_ID },
      multiProviderRegistryIds,
    };
  }

  /**
   * 获取所有工具配置
   * ★ 从 ToolRegistry 获取实际注册的工具，确保 Admin 与运行时一致
   * ★ 同时返回外部工具的配置（如 firecrawl、jina 等），这些工具不在 Registry 中
   */
  async getToolConfigs() {
    // ★ 直接从 ToolRegistry 获取所有已注册的工具
    const registeredTools = this.toolRegistry.getAll();
    const registeredToolIds = new Set(registeredTools.map((t) => t.id));

    // 获取数据库中的配置
    const dbConfigs = await this.prisma.toolConfig.findMany();
    const configMap = new Map(dbConfigs.map((c) => [c.toolId, c]));

    // ★ 2026-05-12: alias config 回填——历史 migration 直接 INSERT alias toolId
    //   （如 'industry-report' 带 config.sources[]），后续 registry 注册名为
    //   canonical（'industry-report-search'）。dedup 后 alias 行被隐藏，若
    //   canonical 行 config 为空，前端读 canonical 会丢数据。此处 reverse-lookup
    //   alias → canonical：canonical config 空时用 alias 的非空 config 填回。
    const aliasesByRegistry = new Map<string, string[]>();
    for (const [aliasId, registryId] of Object.entries(
      TOOL_ID_ALIAS_TO_REGISTRY_ID,
    )) {
      if (aliasId === registryId) continue;
      const arr = aliasesByRegistry.get(registryId) ?? [];
      arr.push(aliasId);
      aliasesByRegistry.set(registryId, arr);
    }
    const isEmptyConfig = (cfg: unknown): boolean => {
      if (cfg === null || cfg === undefined) return true;
      if (typeof cfg !== "object") return false;
      return Object.keys(cfg as Record<string, unknown>).length === 0;
    };
    const resolveEffectiveConfig = (
      registryToolId: string,
      ownConfig: Prisma.JsonValue | null | undefined,
    ): Prisma.JsonValue | null => {
      if (!isEmptyConfig(ownConfig)) return ownConfig ?? null;
      const aliases = aliasesByRegistry.get(registryToolId) ?? [];
      for (const aliasId of aliases) {
        const aliasCfg = configMap.get(aliasId)?.config;
        if (!isEmptyConfig(aliasCfg)) return aliasCfg ?? null;
      }
      return ownConfig ?? null;
    };

    // ★ 内置工具（在 Registry 中）
    const builtinTools = registeredTools.map((tool) => {
      const dbConfig = configMap.get(tool.id);
      const effectiveConfig = resolveEffectiveConfig(tool.id, dbConfig?.config);

      return {
        id: dbConfig?.id || tool.id,
        toolId: tool.id,
        name: tool.name,
        displayName: dbConfig?.displayName || tool.name,
        description: dbConfig?.description || tool.description,
        category: dbConfig?.category || tool.category,
        enabled: dbConfig?.enabled ?? true,
        implemented: true, // ★ 所有 Registry 中的工具都是已实现的
        tags: dbConfig?.tags || tool.tags || [],
        config: effectiveConfig,
        secretKey: dbConfig?.secretKey || null,
        requiresAuth: dbConfig?.requiresAuth || false,
        allowedRoles: dbConfig?.allowedRoles || [],
        // ★ 新增：工具元信息
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      };
    });

    // ★ 外部工具配置（在数据库中但不在 Registry 中）
    // 这些是 API 服务配置，如 firecrawl、jina、elevenlabs 等
    //
    // ★ 2026-05-11 W3r5: 1:1 alias dedup
    //   PR-S0a syncToolConfigs 为每个 alias 维护双行（toolId=arxiv +
    //   toolId=arxiv-search），让前后端历史代码各用各 id 都能 patch。但
    //   1:1 alias（aliasCount === 1）这种"假冗余"在 UI 上是同概念双行
    //   （displayName 都是 "ArXiv Search"），用户视觉混乱。
    //
    //   策略：DB 双行保留不动（保兼容 PATCH /tools/:aliasId），但 admin
    //   list 返回前剔除 1:1 alias 行。N:1 case（tavily/perplexity 多 provider
    //   → web-search）保留所有 provider 行（每个独立 key 必须分行）。
    const registryAliasCount = new Map<string, number>();
    for (const [aliasId, registryId] of Object.entries(
      TOOL_ID_ALIAS_TO_REGISTRY_ID,
    )) {
      if (aliasId === registryId) continue; // 自映射不算 alias
      registryAliasCount.set(
        registryId,
        (registryAliasCount.get(registryId) ?? 0) + 1,
      );
    }
    const isRedundant1to1Alias = (toolId: string): boolean => {
      const registryId = TOOL_ID_ALIAS_TO_REGISTRY_ID[toolId];
      if (!registryId || registryId === toolId) return false;
      const aliasCount = registryAliasCount.get(registryId) ?? 0;
      // 仅 1:1 (该 registry 只有这一个 alias) + canonical 在 Registry 才剔除
      return aliasCount === 1 && registeredToolIds.has(registryId);
    };

    const externalToolConfigs = dbConfigs
      .filter((c) => !registeredToolIds.has(c.toolId))
      .filter((c) => !isRedundant1to1Alias(c.toolId))
      .map((c) => ({
        id: c.id,
        toolId: c.toolId,
        name: c.displayName || c.toolId,
        displayName: c.displayName || c.toolId,
        description: c.description || null,
        category: c.category || "external",
        enabled: c.enabled,
        implemented: false, // 外部工具不在 Registry 中
        tags: c.tags || [],
        config: c.config || null,
        secretKey: c.secretKey || null,
        requiresAuth: c.requiresAuth || false,
        allowedRoles: c.allowedRoles || [],
        inputSchema: null,
        outputSchema: null,
      }));

    const tools = [...builtinTools, ...externalToolConfigs];

    // ★ 2026-05-12: 富化每个 tool 的密钥健康字段（hits / lastUsed / status / lastError）
    //   让 admin /admin/ai/tools 看到工具是否真在跑 + 上次失败原因，无需翻 Railway log。
    //   实现拆到 tool-secret-health.helper.ts（god-class size guard）。
    const enrichedTools = await enrichToolsWithSecretHealth(this.prisma, tools);

    // 统计信息
    const stats = {
      total: tools.length,
      enabled: tools.filter((t) => t.enabled).length,
      implemented: builtinTools.length,
      external: externalToolConfigs.length,
      byCategory: tools.reduce(
        (acc, tool) => {
          acc[tool.category] = (acc[tool.category] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };

    return { tools: enrichedTools, stats };
  }

  /**
   * ★ 诊断工具健康状态
   * 检查工具是否可用，返回诊断结果
   */
  async diagnoseTools(): Promise<{
    tools: Array<{
      toolId: string;
      name: string;
      status: "healthy" | "unhealthy" | "unconfigured";
      message: string;
      hasSecretKey: boolean;
      secretKeyValid: boolean;
    }>;
    summary: {
      total: number;
      healthy: number;
      unhealthy: number;
      unconfigured: number;
    };
  }> {
    const registeredTools = this.toolRegistry.getAll();
    const dbConfigs = await this.prisma.toolConfig.findMany();
    const configMap = new Map(dbConfigs.map((c) => [c.toolId, c]));

    // 预加载 Secret Manager 中所有活跃密钥名，用于 provider 级别的密钥检查
    const allSecrets = await this.prisma.secret.findMany({
      where: { deletedAt: null, isActive: true },
      select: { name: true },
    });
    const secretNames = new Set(allSecrets.map((s) => s.name));

    const diagnostics = await Promise.all(
      registeredTools.map(async (tool) => {
        const dbConfig = configMap.get(tool.id);
        const hasSecretKey = !!dbConfig?.secretKey;
        let secretKeyValid = true;
        let status: "healthy" | "unhealthy" | "unconfigured" = "healthy";
        let message = "工具可用";

        // 检查密钥配置
        if (hasSecretKey && dbConfig?.secretKey) {
          secretKeyValid = await this.secretsService.exists(dbConfig.secretKey);
          if (!secretKeyValid) {
            status = "unhealthy";
            message = `密钥 "${dbConfig.secretKey}" 不存在`;
          }
        }

        // 检查通过外部 provider 配置密钥的内置工具
        const providerCategory = BUILTIN_TOOL_TO_PROVIDER_CATEGORY[tool.id];
        if (providerCategory && !hasSecretKey) {
          // 该工具的密钥由外部 provider 管理，检查对应类别下是否有可用 provider
          const categoryProviders = EXTERNAL_TOOL_DEFINITIONS.filter(
            (ext) => ext.category === providerCategory,
          );
          const hasAvailableProvider = categoryProviders.some(
            (p) =>
              p.noKeyRequired ||
              (p.secretKeyName && secretNames.has(p.secretKeyName)),
          );
          if (!hasAvailableProvider) {
            status = "unconfigured";
            message = `需要配置 ${providerCategory} 类别的 API 密钥`;
          }
        }

        // 检查是否被禁用
        if (dbConfig && !dbConfig.enabled) {
          status = "unhealthy";
          message = "工具已被禁用";
        }

        return {
          toolId: tool.id,
          name: tool.name,
          status,
          message,
          hasSecretKey,
          secretKeyValid,
        };
      }),
    );

    const summary = {
      total: diagnostics.length,
      healthy: diagnostics.filter((d) => d.status === "healthy").length,
      unhealthy: diagnostics.filter((d) => d.status === "unhealthy").length,
      unconfigured: diagnostics.filter((d) => d.status === "unconfigured")
        .length,
    };

    return { tools: diagnostics, summary };
  }

  /**
   * ★ 诊断 MCP 服务器和工具健康状态
   */
  async diagnoseMCPServers(): Promise<{
    servers: Array<{
      serverId: string;
      name: string;
      status: "connected" | "disconnected" | "error";
      message: string;
      toolCount: number;
      tools: Array<{ name: string; description: string }>;
    }>;
    summary: {
      total: number;
      connected: number;
      disconnected: number;
      totalTools: number;
    };
  }> {
    const dbConfigs = await this.prisma.mCPServerConfig.findMany();

    const serverDiagnostics = await Promise.all(
      dbConfigs.map(async (config) => {
        const client = this.mcpManager.getClient(config.serverId);
        const isConnected = client?.connected ?? false;

        let tools: Array<{ name: string; description: string }> = [];
        let status: "connected" | "disconnected" | "error" = "disconnected";
        let message = "服务器未连接";

        if (!config.enabled) {
          status = "disconnected";
          message = "服务器已禁用";
        } else if (isConnected && client) {
          try {
            const mcpTools = await client.listTools();
            tools = mcpTools.map((t: MCPToolInfo) => ({
              name: t.name,
              description: t.description || "",
            }));
            status = "connected";
            message = `已连接，${tools.length} 个工具可用`;
          } catch (error) {
            status = "error";
            message = `获取工具列表失败: ${getErrorMessage(error)}`;
          }
        }

        return {
          serverId: config.serverId,
          name: config.name,
          status,
          message,
          toolCount: tools.length,
          tools,
        };
      }),
    );

    const summary = {
      total: serverDiagnostics.length,
      connected: serverDiagnostics.filter((s) => s.status === "connected")
        .length,
      disconnected: serverDiagnostics.filter((s) => s.status !== "connected")
        .length,
      totalTools: serverDiagnostics.reduce((acc, s) => acc + s.toolCount, 0),
    };

    return { servers: serverDiagnostics, summary };
  }

  /**
   * ★ 诊断 External Tools（外部 API 服务）健康状态
   */
  async diagnoseExternalTools(): Promise<{
    tools: Array<{
      id: string;
      name: string;
      category: string;
      status: "configured" | "unconfigured" | "no_key_required";
      message: string;
      secretKeyName: string | null;
      secretKeyValid: boolean;
      url: string;
      freeQuota?: string;
    }>;
    summary: {
      total: number;
      configured: number;
      unconfigured: number;
      noKeyRequired: number;
    };
  }> {
    const allSecrets = await this.prisma.secret.findMany({
      where: { deletedAt: null, isActive: true },
      select: { name: true },
    });
    const secretNames = new Set(allSecrets.map((s) => s.name));

    const toolDiagnostics = EXTERNAL_TOOL_DEFINITIONS.map((tool) => {
      let status: "configured" | "unconfigured" | "no_key_required" =
        "unconfigured";
      let message = "需要配置 API 密钥";
      let secretKeyValid = false;

      if (tool.noKeyRequired) {
        status = "no_key_required";
        message = "无需 API 密钥";
        secretKeyValid = true;
      } else if (tool.secretKeyName && secretNames.has(tool.secretKeyName)) {
        status = "configured";
        message = "API 密钥已配置";
        secretKeyValid = true;
      }

      return {
        id: tool.id,
        name: tool.name,
        category: tool.category,
        status,
        message,
        secretKeyName: tool.secretKeyName || null,
        secretKeyValid,
        url: tool.url,
        freeQuota: tool.freeQuota,
      };
    });

    const summary = {
      total: toolDiagnostics.length,
      configured: toolDiagnostics.filter((t) => t.status === "configured")
        .length,
      unconfigured: toolDiagnostics.filter((t) => t.status === "unconfigured")
        .length,
      noKeyRequired: toolDiagnostics.filter(
        (t) => t.status === "no_key_required",
      ).length,
    };

    return { tools: toolDiagnostics, summary };
  }

  /**
   * ★ 全面诊断 AI 能力系统
   * 检查所有断点：Secret、Tool、Skill、MCP、Team
   */
  async diagnoseAllCapabilities(): Promise<{
    secrets: {
      items: Array<{
        name: string;
        status: "active" | "inactive" | "expired" | "missing";
        message: string;
        referencedBy: string[];
      }>;
      summary: {
        total: number;
        active: number;
        inactive: number;
        expired: number;
      };
    };
    builtinTools: {
      tools: Array<{
        toolId: string;
        name: string;
        status: "healthy" | "unhealthy" | "unconfigured";
        message: string;
        hasSecretKey: boolean;
        secretKeyValid: boolean;
      }>;
      summary: {
        total: number;
        healthy: number;
        unhealthy: number;
        unconfigured: number;
      };
    };
    mcpServers: {
      servers: Array<{
        serverId: string;
        name: string;
        status: "connected" | "disconnected" | "error";
        message: string;
        toolCount: number;
        tools: Array<{ name: string; description: string }>;
      }>;
      summary: {
        total: number;
        connected: number;
        disconnected: number;
        totalTools: number;
      };
    };
    externalTools: {
      tools: Array<{
        id: string;
        name: string;
        category: string;
        status: "configured" | "unconfigured" | "no_key_required";
        message: string;
        secretKeyName: string | null;
        secretKeyValid: boolean;
        url: string;
        freeQuota?: string;
      }>;
      summary: {
        total: number;
        configured: number;
        unconfigured: number;
        noKeyRequired: number;
      };
    };
    skills: {
      items: Array<{
        skillId: string;
        name: string;
        status: "enabled" | "disabled" | "missing_file";
        message: string;
      }>;
      summary: {
        total: number;
        enabled: number;
        disabled: number;
        missingFile: number;
      };
    };
    teamCapabilities: {
      items: Array<{
        teamId: string;
        name: string;
        memberCount: number;
        capabilityCoverage: string[];
        missingTools: string[];
      }>;
      summary: {
        total: number;
        fullyConfigured: number;
        partiallyConfigured: number;
      };
    };
    breakpoints: Array<{
      code: string;
      severity: "high" | "medium" | "low";
      location: string;
      description: string;
      recommendation: string;
    }>;
  }> {
    const breakpoints: Array<{
      code: string;
      severity: "high" | "medium" | "low";
      location: string;
      description: string;
      recommendation: string;
    }> = [];

    // 1. 诊断 Secrets
    const allSecrets = await this.prisma.secret.findMany({
      where: { deletedAt: null },
    });
    const toolConfigs = await this.prisma.toolConfig.findMany({
      where: { secretKey: { not: null } },
    });

    const secretDiagnostics = allSecrets.map((secret) => {
      let status: "active" | "inactive" | "expired" | "missing" = "active";
      let message = "密钥可用";

      if (!secret.isActive) {
        status = "inactive";
        message = "密钥已禁用";
      } else if (secret.expiresAt && secret.expiresAt < new Date()) {
        status = "expired";
        message = "密钥已过期";
      }

      const referencedBy = toolConfigs
        .filter((tc) => tc.secretKey === secret.name)
        .map((tc) => tc.toolId);

      return {
        name: secret.name,
        status,
        message,
        referencedBy,
      };
    });

    // 检查 S1-S4 断点：工具引用不存在的密钥
    for (const tc of toolConfigs) {
      if (tc.secretKey) {
        const secretExists = allSecrets.find((s) => s.name === tc.secretKey);
        if (!secretExists) {
          breakpoints.push({
            code: "S2",
            severity: "high",
            location: `ToolConfig.${tc.toolId}`,
            description: `工具 ${tc.toolId} 引用的密钥 "${tc.secretKey}" 不存在`,
            recommendation: `在 Secret Manager 中创建名为 "${tc.secretKey}" 的密钥，或更新工具配置`,
          });
        }
      }
    }

    // 2. 诊断内置工具
    const builtinToolsDiag = await this.diagnoseTools();

    // 检查 T1-T4 断点
    for (const tool of builtinToolsDiag.tools) {
      if (tool.status === "unconfigured") {
        breakpoints.push({
          code: "T3",
          severity: "medium",
          location: `Tool.${tool.toolId}`,
          description: tool.message,
          recommendation: `为工具 ${tool.toolId} 配置所需的 API 密钥`,
        });
      }
    }

    // 3. 诊断 MCP 服务器
    const mcpServersDiag = await this.diagnoseMCPServers();

    // 3.5 诊断 External Tools（外部 API 服务）
    const externalToolsDiag = await this.diagnoseExternalTools();

    // 检查 External Tools 断点
    for (const tool of externalToolsDiag.tools) {
      if (tool.status === "unconfigured") {
        breakpoints.push({
          code: "E1",
          severity: "medium",
          location: `ExternalTool.${tool.id}`,
          description: `外部工具 ${tool.name} 未配置 API 密钥`,
          recommendation: `在 Secret Manager 中配置名为 "${tool.secretKeyName}" 的密钥`,
        });
      }
    }

    // 4. 诊断 Skills
    const skillConfigs = await this.prisma.skillConfig.findMany();
    const loadedSkills = this.skillLoaderService.getAllLoadedSkills();
    const loadedSkillIds = new Set(loadedSkills.map((s) => s.metadata.id));

    const skillDiagnostics = skillConfigs.map((config) => {
      const hasFile = loadedSkillIds.has(config.skillId);
      let status: "enabled" | "disabled" | "missing_file" = config.enabled
        ? "enabled"
        : "disabled";
      let message = config.enabled ? "技能已启用" : "技能已禁用";

      if (config.enabled && !hasFile) {
        status = "missing_file";
        message = "SKILL.md 文件不存在";
        breakpoints.push({
          code: "K1",
          severity: "high",
          location: `Skill.${config.skillId}`,
          description: `技能 ${config.skillId} 已启用但 SKILL.md 文件不存在`,
          recommendation: `在 skills/ 目录下创建 ${config.skillId}/SKILL.md 文件`,
        });
      }

      return {
        skillId: config.skillId,
        name: config.displayName || config.skillId,
        status,
        message,
      };
    });

    // 5. 诊断 Team Capabilities
    const teams = await this.prisma.aITeamTemplate.findMany({
      include: {
        members: {
          select: {
            id: true,
            displayName: true,
            capabilities: true,
            mcpTools: true,
          },
        },
      },
    });

    const teamDiagnostics = teams.map((team) => {
      const allCapabilities = new Set<string>();
      const missingTools: string[] = [];

      for (const member of team.members) {
        for (const cap of member.capabilities) {
          allCapabilities.add(cap);
        }

        // A4 断点：成员没有能力配置
        if (member.capabilities.length === 0) {
          breakpoints.push({
            code: "A4",
            severity: "high",
            location: `Team.${team.id}.Member.${member.id}`,
            description: `成员 ${member.displayName} 没有配置任何能力`,
            recommendation: `为成员配置 AICapability，如 WEB_SEARCH、TEXT_GENERATION 等`,
          });
        }
      }

      return {
        teamId: team.id,
        name: team.name,
        memberCount: team.members.length,
        capabilityCoverage: Array.from(allCapabilities),
        missingTools,
      };
    });

    return {
      secrets: {
        items: secretDiagnostics,
        summary: {
          total: secretDiagnostics.length,
          active: secretDiagnostics.filter((s) => s.status === "active").length,
          inactive: secretDiagnostics.filter((s) => s.status === "inactive")
            .length,
          expired: secretDiagnostics.filter((s) => s.status === "expired")
            .length,
        },
      },
      builtinTools: builtinToolsDiag,
      mcpServers: mcpServersDiag,
      externalTools: externalToolsDiag,
      skills: {
        items: skillDiagnostics,
        summary: {
          total: skillDiagnostics.length,
          enabled: skillDiagnostics.filter((s) => s.status === "enabled")
            .length,
          disabled: skillDiagnostics.filter((s) => s.status === "disabled")
            .length,
          missingFile: skillDiagnostics.filter(
            (s) => s.status === "missing_file",
          ).length,
        },
      },
      teamCapabilities: {
        items: teamDiagnostics,
        summary: {
          total: teamDiagnostics.length,
          fullyConfigured: teamDiagnostics.filter(
            (t) => t.missingTools.length === 0,
          ).length,
          partiallyConfigured: teamDiagnostics.filter(
            (t) => t.missingTools.length > 0,
          ).length,
        },
      },
      breakpoints,
    };
  }

  /**
   * ★ 获取服务的 API Key 健康状态
   * 供管理后台展示密钥轮换状态
   *
   * @param serviceId - 服务 ID (tavily, serper, jina, firecrawl, supadata, elevenlabs 等)
   * @returns 密钥健康状态列表
   */
  async getServiceKeyHealth(serviceId: string): Promise<KeyHealthStatus[]> {
    // 服务到 Secret 名称的映射
    const serviceSecretMap: Record<string, string> = {
      // SEARCH 分类
      tavily: "tavily-search-api-key",
      serper: "serper-api-key",
      // EXTRACTION 分类
      jina: "jina-api-key",
      firecrawl: "firecrawl-api-key",
      "tavily-extract": "tavily-extraction-api-key",
      // YOUTUBE 分类
      supadata: "supadata-api-key",
      // TTS 分类
      elevenlabs: "elevenlabs-api-key",
    };

    const secretName = serviceSecretMap[serviceId];
    if (!secretName) {
      this.logger.warn(`Unknown service ID for key health: ${serviceId}`);
      return [];
    }

    // 获取密钥值（支持逗号分隔的多个 Key）
    const secretValue = await this.secretsService.getValueInternal(secretName);
    if (!secretValue) {
      this.logger.warn(`Secret not found: ${secretName}`);
      return [];
    }

    // 解析多个 Key
    const keys = secretValue
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    if (keys.length === 0) {
      return [];
    }

    // 对于 SEARCH 分类，使用 SearchService 的健康状态（它有实际的轮换机制）
    if (serviceId === "tavily" || serviceId === "serper") {
      return this.searchService.getKeyHealthStatus(
        serviceId as "tavily" | "serper",
      );
    }

    // 对于其他服务，使用 MultiKeyRegistry 获取健康状态
    return MultiKeyRegistry.getHealthStatus(serviceId, keys);
  }

  /**
   * @deprecated 使用 getServiceKeyHealth 代替
   */
  async getToolKeyHealth(toolId: string): Promise<KeyHealthStatus[]> {
    return this.getServiceKeyHealth(toolId);
  }

  /**
   * ★ 获取可装配给 Agent 的工具列表
   * 只返回健康且启用的工具
   */
  async getAvailableToolsForAgent(): Promise<
    Array<{
      toolId: string;
      name: string;
      description: string;
      category: string;
      tags: string[];
    }>
  > {
    const diagnosis = await this.diagnoseTools();
    const healthyToolIds = new Set(
      diagnosis.tools
        .filter((t) => t.status === "healthy")
        .map((t) => t.toolId),
    );

    const registeredTools = this.toolRegistry.getAll();
    const dbConfigs = await this.prisma.toolConfig.findMany({
      where: { enabled: true },
    });
    const enabledToolIds = new Set(dbConfigs.map((c) => c.toolId));

    return registeredTools
      .filter(
        (tool) =>
          healthyToolIds.has(tool.id) &&
          (enabledToolIds.has(tool.id) || enabledToolIds.size === 0),
      )
      .map((tool) => ({
        toolId: tool.id,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        tags: tool.tags || [],
      }));
  }

  /**
   * 更新工具配置
   */
  async updateToolConfig(
    toolId: string,
    update: {
      enabled?: boolean;
      displayName?: string;
      description?: string;
      config?: Record<string, unknown>;
      secretKey?: string | null;
      requiresAuth?: boolean;
      allowedRoles?: string[];
    },
  ) {
    // 验证 secretKey 是否存在
    if (update.secretKey !== undefined && update.secretKey !== null) {
      const secretExists = await this.secretsService.exists(update.secretKey);
      if (!secretExists) {
        this.logger.warn(
          `Invalid secretKey reference: ${update.secretKey} for tool ${toolId}`,
        );
        throw new Error(`Secret key '${update.secretKey}' does not exist`);
      }
    }

    const result = await this.prisma.toolConfig.upsert({
      where: { toolId },
      create: {
        toolId,
        enabled: update.enabled ?? true,
        displayName: update.displayName,
        description: update.description,
        config: update.config as Prisma.InputJsonValue | undefined,
        secretKey: update.secretKey,
        requiresAuth: update.requiresAuth,
        allowedRoles: update.allowedRoles,
      },
      update: {
        enabled: update.enabled,
        displayName: update.displayName,
        description: update.description,
        config: update.config as Prisma.InputJsonValue | undefined,
        secretKey: update.secretKey,
        requiresAuth: update.requiresAuth,
        allowedRoles: update.allowedRoles,
      },
    });

    this.logger.log(
      `Updated tool config: ${toolId}, enabled=${result.enabled}, secretKey=${result.secretKey ? "set" : "none"}`,
    );

    // ★ 同步 Provider ID → Registry Tool ID 的关键字段
    // 前端用 provider ID（如 openalex）保存，运行时用 registry ID（如 openalex-search）查询
    // 需同步：config（密钥读取）、enabled（能力开关）
    //
    // ★ 2026-05-07: secretKey + config(apiKey) 在 N:1 映射时**绝不**同步。
    // 例：tavily/perplexity/serper 都映到 'web-search'，若同步 secretKey →
    // last-write-wins → 谁后配的覆盖前面，再被前端 bridge 灌回所有 sibling
    // → Perplexity dialog 显示 Tavily 的 key（Screenshot_5 真因）。
    // 1:1 映射（arxiv→arxiv-search 等）继续 sync —— 它们语义上是同一工具。
    const registryToolId = getRegistryToolId(toolId);
    const isMultiProviderParent = isMultiProviderRegistry(registryToolId);
    if (registryToolId !== toolId) {
      const syncData: Record<string, unknown> = {};
      if (update.secretKey !== undefined && !isMultiProviderParent)
        syncData.secretKey = update.secretKey;
      if (update.config !== undefined && !isMultiProviderParent)
        syncData.config = update.config as Prisma.InputJsonValue;
      if (update.enabled !== undefined) syncData.enabled = update.enabled;
      if (update.displayName !== undefined)
        syncData.displayName = update.displayName;
      if (update.description !== undefined)
        syncData.description = update.description;
      if (update.requiresAuth !== undefined)
        syncData.requiresAuth = update.requiresAuth;
      if (update.allowedRoles !== undefined)
        syncData.allowedRoles = update.allowedRoles;

      if (Object.keys(syncData).length > 0) {
        await this.prisma.toolConfig.upsert({
          where: { toolId: registryToolId },
          create: {
            toolId: registryToolId,
            enabled: update.enabled ?? true,
            ...(syncData as {
              secretKey?: string | null;
              config?: Prisma.InputJsonValue;
              displayName?: string;
              description?: string;
              requiresAuth?: boolean;
              allowedRoles?: string[];
            }),
          },
          update: syncData as {
            secretKey?: string | null;
            config?: Prisma.InputJsonValue;
            enabled?: boolean;
            displayName?: string;
            description?: string;
            requiresAuth?: boolean;
            allowedRoles?: string[];
          },
        });
        this.logger.log(
          `Synced provider config ${toolId} → registry tool ${registryToolId}`,
        );
      }
    }

    return { success: true, ...result };
  }

  /**
   * 每个工具的默认测试输入参数
   */
  private static readonly DEFAULT_TEST_INPUTS: Record<
    string,
    Record<string, unknown>
  > = {
    "web-search": { query: "AI technology news", maxResults: 1 },
    "web-scraper": { url: "https://example.com" },
    "arxiv-search": { query: "transformer architecture", maxResults: 1 },
    "hackernews-search": { query: "AI", maxResults: 1 },
    "semantic-scholar": { query: "deep learning", maxResults: 1 },
    pubmed: { query: "CRISPR gene editing", maxResults: 1 },
    "openalex-search": { query: "large language models", maxResults: 1 },
    "finance-api": { queryType: "stock_quote", symbol: "AAPL" },
    "weather-api": { queryType: "current", city: "London" },
    "github-search": { query: "machine learning", maxResults: 1 },
    "federal-register": { query: "artificial intelligence", maxResults: 1 },
    "congress-gov": { query: "technology", maxResults: 1 },
    "whitehouse-news": { query: "technology", maxResults: 1 },
    "audio-generation": { text: "Hello, this is a test.", voice: "Host1" },
  };

  /**
   * 测试工具
   *
   * 返回字段：
   * - success: 工具是否真实可用（执行成功 + 真返结果 + 内部 success!=false）
   * - error?: 失败时的错误描述（含 HTTP body / api error.message）
   * - message?: 成功时的描述
   * - result?: 工具结构化输出（含 resultCount）
   * - duration: 执行耗时 ms
   * - degraded?: 半失败状态（如配额限流但请求通了 → 0 结果）；前端应红黄区分
   */
  async testTool(
    toolId: string,
    input?: Record<string, unknown>,
  ): Promise<{
    success: boolean;
    message?: string;
    error?: string;
    result?: Record<string, unknown> | number | string | boolean | null;
    duration: number;
    degraded?: boolean;
  }> {
    // 将前端 provider ID 映射到后端 tool registry ID
    const registryToolId = getRegistryToolId(toolId);

    const tool = this.toolRegistry.tryGet(registryToolId);

    if (!tool) {
      return {
        success: false,
        error: `Tool ${toolId} (registry: ${registryToolId}) is not implemented or registered`,
        duration: 0,
      };
    }

    // 获取工具配置，解析 API Key（先尝试 provider ID，再尝试 registry tool ID）
    let toolConfig = await this.prisma.toolConfig.findUnique({
      where: { toolId },
    });
    if (!toolConfig && registryToolId !== toolId) {
      toolConfig = await this.prisma.toolConfig.findUnique({
        where: { toolId: registryToolId },
      });
    }

    let apiKey: string | undefined;
    if (toolConfig?.secretKey) {
      // 从 Secret Manager 获取 API Key
      const secretValue = await this.secretsService.getValue(
        toolConfig.secretKey,
      );
      if (secretValue) {
        apiKey = secretValue;
      }
    } else if (
      toolConfig?.config &&
      typeof toolConfig.config === "object" &&
      (toolConfig.config as Record<string, unknown>).apiKey
    ) {
      // 从 tool config 中读取直接保存的 API Key（无 legacy 端点的工具类别）
      apiKey = String((toolConfig.config as Record<string, unknown>).apiKey);
    }

    // 如果没有提供输入，使用默认测试输入
    const defaultInput =
      AIAdminService.DEFAULT_TEST_INPUTS[registryToolId] || {};
    const executeInput = { ...defaultInput, ...input };

    const startTime = Date.now();
    try {
      // 尝试执行工具（如果有 execute 方法）
      if (isExecutableTool(tool)) {
        // 将 API Key 传递给工具
        if (apiKey) {
          executeInput.apiKey = apiKey;
        }
        // 构建工具执行上下文（BaseTool.execute 需要两个参数：input + context）
        const toolContext = {
          executionId: `admin-test-${Date.now()}`,
          toolId: registryToolId,
          callerType: "admin" as const,
          createdAt: new Date(),
        };
        const result = await tool.execute(executeInput, toolContext);
        const duration = Date.now() - startTime;

        // 2026-05-13 P0-#29: 软失败深挖（Serper credits 耗尽返 {success:false}
        // 不 throw）见 tool-test-result.helper.ts。
        const { explicitFail, errorFromResult, emptyResultsHint, resultCount } =
          analyzeToolResult(result);

        if (explicitFail || errorFromResult) {
          await this.recordUsage("tool", toolId, false, duration);
          return {
            success: false,
            error:
              errorFromResult ||
              `Tool returned success=false (likely key invalid / quota exhausted / provider down)`,
            result: {
              raw: typeof result === "object" ? result : { value: result },
            },
            duration,
          };
        }
        if (emptyResultsHint) {
          await this.recordUsage("tool", toolId, true, duration);
          return {
            success: true,
            message: `Tool ${toolId} reachable but returned no results (${emptyResultsHint}) — likely partial quota / rate limit. Re-test in a few seconds, or check provider dashboard.`,
            result: { resultCount: 0, hint: emptyResultsHint },
            duration,
            degraded: true,
          };
        }

        await this.recordUsage("tool", toolId, true, duration);

        const resultField: Record<string, unknown> | number | string | boolean =
          typeof result === "object"
            ? { resultCount }
            : (result as number | string | boolean);
        return {
          success: true,
          message: `Tool ${toolId} test passed (${resultCount} result${resultCount === 1 ? "" : "s"})`,
          result: resultField,
          duration,
        };
      }

      return {
        success: true,
        message:
          "Tool is registered but execute method not available for testing",
        duration: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const errorCode =
        error instanceof Error
          ? (error as Error & { code?: string }).code
          : undefined;

      // 记录失败统计
      await this.recordUsage("tool", toolId, false, duration, errorCode);

      return {
        success: false,
        error: getErrorMessage(error),
        duration,
      };
    }
  }

  // ==================== Skills ====================

  /**
   * 获取所有技能配置
   */
  async getSkillConfigs() {
    const skillDefinitions = this.getSkillDefinitions();
    const skillDefinitionIds = new Set(skillDefinitions.map((s) => s.id));

    // 获取数据库中的配置
    const dbConfigs = await this.prisma.skillConfig.findMany();
    const configMap = new Map(dbConfigs.map((c) => [c.skillId, c]));

    // 获取已加载的 SKILL.md 技能 ID 集合
    const loadedSkills = this.skillLoaderService.getAllLoadedSkills();
    const loadedSkillIds = new Set(loadedSkills.map((s) => s.metadata.id));

    // 1. Map skills from definitions (local/builtin skills)
    const skills: Array<{
      id: string;
      skillId: string;
      name: string;
      displayName: string;
      description: string;
      layer: string;
      domain: string;
      enabled: boolean;
      tags: string[];
      requiredTools: string[];
      requiredSkills: string[];
      implemented: boolean;
      config: unknown;
      source: string;
      version: string | null;
      promptContent: string | null;
      lastUsedAt: Date | null;
      usageCount: number;
      contentHash: string | null;
    }> = skillDefinitions.map((skill) => {
      const dbConfig = configMap.get(skill.id);
      const registeredSkill = this.skillRegistry.tryGet(skill.id);
      // 检查是否在 SkillRegistry 或 SkillLoaderService 中
      const isImplemented = !!registeredSkill || loadedSkillIds.has(skill.id);

      return {
        id: dbConfig?.id || skill.id,
        skillId: skill.id,
        name: skill.name,
        displayName: dbConfig?.displayName || skill.name,
        description: dbConfig?.description || skill.description,
        layer: dbConfig?.layer || skill.layer,
        domain: dbConfig?.domain || skill.domain,
        enabled: dbConfig?.enabled ?? true,
        tags: dbConfig?.tags || skill.tags || [],
        requiredTools: skill.requiredTools || [],
        requiredSkills: skill.requiredSkills || [],
        implemented: isImplemented,
        config: dbConfig?.config || null,
        source: dbConfig?.source || "local",
        version: dbConfig?.version || null,
        promptContent: dbConfig?.promptContent || null,
        lastUsedAt: dbConfig?.lastUsedAt || null,
        usageCount: dbConfig?.usageCount || 0,
        contentHash: dbConfig?.contentHash || null,
      };
    });

    // 2. Add marketplace-installed or DB-only skills (only in database, not in definitions)
    for (const dbConfig of dbConfigs) {
      if (!skillDefinitionIds.has(dbConfig.skillId)) {
        skills.push({
          id: dbConfig.id,
          skillId: dbConfig.skillId,
          name: dbConfig.skillId,
          displayName: dbConfig.displayName || dbConfig.skillId,
          description: dbConfig.description || "",
          layer: dbConfig.layer || "application",
          domain: dbConfig.domain || "common",
          enabled: dbConfig.enabled,
          tags: dbConfig.tags || [],
          requiredTools: [],
          requiredSkills: [],
          implemented: false,
          config: dbConfig.config || null,
          source: dbConfig.source || "marketplace",
          version: dbConfig.version || null,
          promptContent: dbConfig.promptContent || null,
          lastUsedAt: dbConfig.lastUsedAt || null,
          usageCount: dbConfig.usageCount || 0,
          contentHash: dbConfig.contentHash || null,
        });
      }
    }

    // 统计信息
    const stats = {
      total: skills.length,
      enabled: skills.filter((s) => s.enabled).length,
      byLayer: skills.reduce(
        (acc, skill) => {
          acc[skill.layer] = (acc[skill.layer] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
      byDomain: skills.reduce(
        (acc, skill) => {
          acc[skill.domain] = (acc[skill.domain] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };

    return { skills, stats };
  }

  /**
   * 更新技能配置
   */
  async updateSkillConfig(
    skillId: string,
    update: {
      enabled?: boolean;
      displayName?: string;
      description?: string;
      config?: Record<string, unknown>;
      allowedDomains?: string[];
    },
  ) {
    const result = await this.prisma.skillConfig.upsert({
      where: { skillId },
      create: {
        skillId,
        enabled: update.enabled ?? true,
        displayName: update.displayName,
        description: update.description,
        config: update.config as Prisma.InputJsonValue | undefined,
        allowedDomains: update.allowedDomains,
      },
      update: {
        enabled: update.enabled,
        displayName: update.displayName,
        description: update.description,
        config: update.config as Prisma.InputJsonValue | undefined,
        allowedDomains: update.allowedDomains,
      },
    });

    // 清除技能定义缓存，确保下次获取时重新计算
    this.invalidateSkillDefinitionsCache();

    this.logger.log(
      `Updated skill config: ${skillId}, enabled=${result.enabled}`,
    );

    return { success: true, ...result };
  }

  /**
   * 清除技能定义缓存
   */
  private invalidateSkillDefinitionsCache(): void {
    this.skillDefinitionsCache = null;
    this.skillDefinitionsCacheTime = 0;
  }

  /**
   * 上传技能配置
   */
  async uploadSkill(skillData: Record<string, unknown>) {
    const skillId =
      (skillData.skillId as string) ||
      (skillData.name as string) ||
      (skillData.id as string);

    if (!skillId) {
      throw new Error("Skill must have an id, skillId, or name field");
    }

    // Create or update skill config in database
    const result = await this.prisma.skillConfig.upsert({
      where: { skillId },
      create: {
        skillId,
        displayName: (skillData.displayName as string) || skillId,
        description: (skillData.description as string) || "",
        layer: (skillData.layer as string) || "application",
        domain: (skillData.domain as string) || "common",
        enabled: skillData.enabled !== false,
        tags: (skillData.tags as string[]) || [],
        config: skillData.config as Prisma.InputJsonValue | undefined,
      },
      update: {
        displayName: (skillData.displayName as string) || undefined,
        description: (skillData.description as string) || undefined,
        layer: (skillData.layer as string) || undefined,
        domain: (skillData.domain as string) || undefined,
        enabled: skillData.enabled !== false,
        tags: (skillData.tags as string[]) || undefined,
        config: skillData.config as Prisma.InputJsonValue | undefined,
      },
    });

    // Clear cache
    this.invalidateSkillDefinitionsCache();

    this.logger.log(`Uploaded skill: ${skillId}`);

    return result;
  }

  // ==================== Skill Content & Versions ====================

  /**
   * 获取 Skill 完整 prompt 内容 + 版本历史
   *
   * 三级内容源（按优先级）：
   * 1. DB promptContent（最高优先，支持 UI 编辑）
   * 2. SkillLoaderService 内存缓存（从 SKILL.md 文件加载）
   * 3. SkillRegistry 中的 PromptSkillAdapter（运行时注册的 prompt 技能）
   *
   * 如果从 fallback 源获取到内容，会 fire-and-forget 回写 DB 以便下次直接命中。
   */
  async getSkillPromptContent(skillId: string) {
    const definition =
      await this.skillContentService.getFullSkillDefinition(skillId);
    if (!definition) {
      throw new NotFoundException(`Skill not found: ${skillId}`);
    }

    // Fallback 1: SkillLoaderService (in-memory loaded from SKILL.md files)
    if (!definition.promptContent) {
      const allLoaded = this.skillLoaderService.getAllLoadedSkills();
      this.logger.debug(
        `[getSkillPromptContent] DB content null for "${skillId}", loader has ${allLoaded.length} skills`,
      );
      // Try exact match, then suffix match (handles prefixed IDs like "slides-transition-checker")
      const loaded =
        allLoaded.find((s) => s.metadata.id === skillId) ??
        allLoaded.find((s) => skillId.endsWith(s.metadata.id));
      if (loaded) {
        definition.promptContent = loaded.content;
        definition.frontmatter = loaded.metadata as unknown as Record<
          string,
          unknown
        >;
        this.logger.log(
          `[getSkillPromptContent] Loaded "${skillId}" from SkillLoaderService (matched: ${loaded.metadata.id})`,
        );
      }
    }

    // Fallback 2: SkillRegistry (PromptSkillAdapter has the definition content)
    if (!definition.promptContent) {
      const registeredSkill = this.skillRegistry.tryGet(skillId);
      if (
        registeredSkill &&
        (registeredSkill as { isPromptSkillAdapter?: boolean })
          .isPromptSkillAdapter
      ) {
        const adapter = registeredSkill as unknown as {
          getPromptContent: () => string;
          getDefinitionMetadata: () => Record<string, unknown>;
        };
        const content = adapter.getPromptContent();
        if (content) {
          definition.promptContent = content;
          definition.frontmatter =
            adapter.getDefinitionMetadata() as unknown as Record<
              string,
              unknown
            >;
          this.logger.log(
            `[getSkillPromptContent] Loaded "${skillId}" from SkillRegistry (PromptSkillAdapter)`,
          );
        }
      }
    }

    // On-demand DB sync: persist fallback content so future fetches hit DB directly
    if (definition.promptContent && definition.source !== "db") {
      void this.skillContentService
        .savePromptContent(
          skillId,
          definition.promptContent,
          definition.frontmatter,
          "Auto-synced from filesystem on first access",
        )
        .catch((err: Error) => {
          this.logger.debug(
            `[getSkillPromptContent] On-demand sync failed for "${skillId}": ${err.message}`,
          );
        });
    }

    const versions = await this.skillContentService.getVersionHistory(
      skillId,
      20,
    );

    return {
      ...definition,
      versions,
    };
  }

  /**
   * 更新 Skill prompt 内容（自动版本快照）
   */
  async updateSkillPromptContent(
    skillId: string,
    content: string,
    frontmatter: Record<string, unknown> | null,
    changeNote?: string,
  ) {
    const result = await this.skillContentService.savePromptContent(
      skillId,
      content,
      frontmatter,
      changeNote,
    );

    this.invalidateSkillDefinitionsCache();

    this.logger.log(
      `Updated skill prompt: ${skillId}, new version: ${result.version}`,
    );

    return result;
  }

  /**
   * 获取 Skill 版本历史
   */
  async getSkillVersionHistory(skillId: string, limit = 20) {
    return this.skillContentService.getVersionHistory(skillId, limit);
  }

  /**
   * 恢复到指定版本
   */
  async restoreSkillVersion(skillId: string, versionId: string) {
    const result = await this.skillContentService.restoreVersion(
      skillId,
      versionId,
    );

    this.invalidateSkillDefinitionsCache();

    this.logger.log(`Restored skill ${skillId} to version ${result.version}`);

    return result;
  }

  /**
   * 从 UI 创建新 Skill（纯 DB 创建）
   */
  async createSkillFromUI(data: {
    skillId: string;
    displayName: string;
    description: string;
    promptContent: string;
    frontmatter?: Record<string, unknown>;
    layer?: string;
    domain?: string;
    tags?: string[];
    taskProfileJson?: Record<string, unknown>;
    inputSchemaJson?: Record<string, unknown>;
    outputSchemaJson?: Record<string, unknown>;
  }) {
    const result = await this.skillContentService.createSkillFromUI(data);

    this.invalidateSkillDefinitionsCache();

    this.logger.log(`Created skill from UI: ${data.skillId}`);

    return result;
  }

  // ==================== MCP Servers ====================

  /**
   * 获取所有 MCP 服务器配置
   */
  async getMCPServerConfigs() {
    const dbConfigs = await this.prisma.mCPServerConfig.findMany();

    const servers = await Promise.all(
      dbConfigs.map(async (config) => {
        const client = this.mcpManager.getClient(config.serverId);
        const isConnected = client?.connected ?? false;

        let tools: Array<{ name: string; description: string }> = [];
        if (isConnected && client) {
          try {
            const mcpTools = await client.listTools();
            tools = mcpTools.map((t: MCPToolInfo) => ({
              name: t.name,
              description: t.description || "",
            }));
          } catch (e) {
            // 忽略获取工具列表失败
          }
        }

        // Extract env from metadata
        const metadata = (config.metadata as Record<string, unknown>) || {};
        const env = (metadata.env as Record<string, string>) || {};

        return {
          id: config.id,
          serverId: config.serverId,
          name: config.name,
          description: config.description || "",
          transport: config.transport,
          command: config.command,
          args: config.args,
          url: config.url,
          enabled: config.enabled,
          autoConnect: config.autoConnect,
          connected: isConnected,
          tools,
          env,
        };
      }),
    );

    return { servers };
  }

  /**
   * 添加 MCP 服务器
   */
  async addMCPServer(config: {
    serverId: string;
    name: string;
    description?: string;
    transport: "stdio" | "sse";
    command?: string;
    args?: string[];
    url?: string;
    enabled?: boolean;
    autoConnect?: boolean;
    apiKey?: string; // 旧方式（已弃用）
    secretKey?: string; // M2 Fix: 新方式 - 引用 Secret Manager 中的密钥
  }) {
    // 保存到数据库
    const dbConfig = await this.prisma.mCPServerConfig.create({
      data: {
        serverId: config.serverId,
        name: config.name,
        description: config.description,
        transport: config.transport,
        command: config.command,
        args: config.args || [],
        url: config.url,
        enabled: config.enabled ?? true,
        autoConnect: config.autoConnect ?? true,
        apiKey: config.apiKey,
        secretKey: config.secretKey, // M2 Fix: 保存 secretKey 引用
      },
    });

    // M2 Fix: 从 SecretsService 解析 API 密钥
    const env = await this.resolveMCPServerEnv({
      serverId: config.serverId,
      secretKey: config.secretKey,
      apiKey: config.apiKey,
    });

    // 注册到 MCPManager
    if (config.transport === "stdio" && config.command) {
      this.mcpManager.registerServer({
        id: config.serverId,
        name: config.name,
        transport: "stdio",
        command: config.command,
        args: config.args || [],
        env,
      });
    } else if (config.transport === "sse" && config.url) {
      this.mcpManager.registerServer({
        id: config.serverId,
        name: config.name,
        transport: "http",
        url: config.url,
        env,
      });
    }

    // 如果启用自动连接
    if (config.autoConnect && config.enabled !== false) {
      try {
        await this.mcpManager.connect(config.serverId);
        this.logger.log(`Auto-connected MCP server: ${config.serverId}`);
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to auto-connect MCP server ${config.serverId}: ${getErrorMessage(error)}`,
        );
      }
    }

    this.logger.log(`Added MCP server: ${config.serverId}`);

    return { success: true, serverId: config.serverId, id: dbConfig.id };
  }

  /**
   * 更新 MCP 服务器配置
   */
  async updateMCPServer(
    serverId: string,
    update: {
      name?: string;
      description?: string;
      enabled?: boolean;
      autoConnect?: boolean;
      command?: string;
      args?: string[];
      url?: string;
      apiKey?: string;
    },
  ) {
    const existing = await this.prisma.mCPServerConfig.findUnique({
      where: { serverId },
    });

    if (!existing) {
      return { success: false, error: "Server not found" };
    }

    const result = await this.prisma.mCPServerConfig.update({
      where: { serverId },
      data: {
        name: update.name,
        description: update.description,
        enabled: update.enabled,
        autoConnect: update.autoConnect,
        command: update.command,
        args: update.args,
        url: update.url,
        apiKey: update.apiKey,
      },
    });

    this.logger.log(`Updated MCP server: ${serverId}`);

    return { success: true, ...result };
  }

  /**
   * 连接 MCP 服务器
   * 连接前会从数据库读取最新配置（包括 metadata.env 中的环境变量）
   */
  async connectMCPServer(serverId: string) {
    try {
      // 从数据库获取最新的服务器配置
      const dbServer = await this.prisma.mCPServerConfig.findUnique({
        where: { serverId },
      });

      if (!dbServer) {
        return { success: false, error: `Server ${serverId} not found` };
      }

      // 解析环境变量（包括 metadata.env）
      const env = await this.resolveMCPServerEnv({
        serverId: dbServer.serverId,
        secretKey: dbServer.secretKey,
        apiKey: dbServer.apiKey,
        metadata: dbServer.metadata,
      });

      // 更新或注册服务器配置（确保使用最新的 env）
      if (dbServer.transport === "stdio" && dbServer.command) {
        await this.mcpManager.registerOrUpdateServer({
          id: dbServer.serverId,
          name: dbServer.name,
          transport: "stdio",
          command: dbServer.command,
          args: dbServer.args || [],
          env,
        });
      } else if (dbServer.transport === "sse" && dbServer.url) {
        await this.mcpManager.registerOrUpdateServer({
          id: dbServer.serverId,
          name: dbServer.name,
          transport: "http",
          url: dbServer.url,
          env,
        });
      }

      // 连接
      await this.mcpManager.connect(serverId);
      this.logger.log(`Connected MCP server: ${serverId}`);

      // 记录成功状态到 metadata
      await this.updateMCPServerConnectionStatus(serverId, {
        connected: true,
        lastConnectedAt: new Date().toISOString(),
        lastError: null,
      });

      return { success: true, serverId };
    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      this.logger.error(
        `Failed to connect MCP server ${serverId}: ${errorMsg}`,
      );

      // 记录失败状态到 metadata
      await this.updateMCPServerConnectionStatus(serverId, {
        connected: false,
        lastError: errorMsg,
        lastErrorAt: new Date().toISOString(),
      });

      return { success: false, error: errorMsg };
    }
  }

  /**
   * 断开 MCP 服务器
   */
  async disconnectMCPServer(serverId: string) {
    try {
      await this.mcpManager.disconnect(serverId);
      this.logger.log(`Disconnected MCP server: ${serverId}`);

      // 记录断开状态到 metadata
      await this.updateMCPServerConnectionStatus(serverId, {
        connected: false,
        lastDisconnectedAt: new Date().toISOString(),
      });

      return { success: true, serverId };
    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      this.logger.error(
        `Failed to disconnect MCP server ${serverId}: ${errorMsg}`,
      );

      // 记录失败状态到 metadata
      await this.updateMCPServerConnectionStatus(serverId, {
        lastError: errorMsg,
        lastErrorAt: new Date().toISOString(),
      });

      return { success: false, error: errorMsg };
    }
  }

  /**
   * 删除 MCP 服务器
   */
  async deleteMCPServer(serverId: string) {
    // 先断开连接
    try {
      await this.mcpManager.disconnect(serverId);
    } catch (e) {
      // 忽略断开连接失败
    }

    // 从数据库删除
    await this.prisma.mCPServerConfig.delete({
      where: { serverId },
    });

    this.logger.log(`Deleted MCP server: ${serverId}`);

    return { success: true, serverId };
  }

  /**
   * 更新 MCP 服务器环境变量配置
   */
  async updateMCPServerEnv(serverId: string, env: Record<string, string>) {
    const existing = await this.prisma.mCPServerConfig.findUnique({
      where: { serverId },
      select: { metadata: true },
    });

    if (!existing) {
      return { success: false, error: "Server not found" };
    }

    const currentMetadata =
      (existing.metadata as Record<string, unknown>) || {};
    const updatedMetadata = { ...currentMetadata, env };

    await this.prisma.mCPServerConfig.update({
      where: { serverId },
      data: { metadata: updatedMetadata },
    });

    this.logger.log(`Updated env for MCP server: ${serverId}`);

    return { success: true, serverId };
  }

  /**
   * 更新 MCP 服务器连接状态到 metadata
   * 用于持久化连接成功/失败的记录
   */
  private async updateMCPServerConnectionStatus(
    serverId: string,
    status: {
      connected?: boolean;
      lastConnectedAt?: string;
      lastDisconnectedAt?: string;
      lastError?: string | null;
      lastErrorAt?: string;
    },
  ): Promise<void> {
    try {
      const existing = await this.prisma.mCPServerConfig.findUnique({
        where: { serverId },
        select: { metadata: true },
      });

      const currentMetadata =
        (existing?.metadata as Record<string, unknown>) || {};
      const updatedMetadata = { ...currentMetadata, ...status };

      await this.prisma.mCPServerConfig.update({
        where: { serverId },
        data: { metadata: updatedMetadata },
      });
    } catch (error) {
      // 仅记录日志，不影响主流程
      this.logger.warn(
        `Failed to update MCP server connection status for ${serverId}: ${getErrorMessage(error)}`,
      );
    }
  }

  // ==================== Usage Statistics ====================

  /**
   * 记录能力使用统计
   */
  private async recordUsage(
    capabilityType: string,
    capabilityId: string,
    success: boolean,
    duration?: number,
    errorCode?: string,
    context?: { userId?: string; teamId?: string; agentId?: string },
  ) {
    try {
      await this.prisma.aIUsageLog.create({
        data: {
          capabilityType,
          capabilityId,
          success,
          duration,
          errorCode,
          userId: context?.userId,
          teamId: context?.teamId,
          agentId: context?.agentId,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(`Failed to record usage: ${getErrorMessage(error)}`);
    }
  }

  /**
   * 获取能力使用统计
   */
  async getUsageStats(options?: {
    capabilityType?: string;
    capabilityId?: string;
    startDate?: Date;
    endDate?: Date;
  }) {
    const where: Prisma.AIUsageLogWhereInput = {};

    if (options?.capabilityType) {
      where.capabilityType = options.capabilityType;
    }
    if (options?.capabilityId) {
      where.capabilityId = options.capabilityId;
    }
    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options?.startDate) {
        where.createdAt.gte = options.startDate;
      }
      if (options?.endDate) {
        where.createdAt.lte = options.endDate;
      }
    }

    const [total, successful, usages] = await Promise.all([
      this.prisma.aIUsageLog.count({ where }),
      this.prisma.aIUsageLog.count({ where: { ...where, success: true } }),
      this.prisma.aIUsageLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: DEFAULT_PAGE_SIZE * 2, // Return more recent usages for analytics
      }),
    ]);

    return {
      total,
      successful,
      failureRate: total > 0 ? ((total - successful) / total) * 100 : 0,
      recentUsages: usages,
    };
  }

  // ==================== Batch Operations ====================

  /**
   * 批量更新工具状态
   * 使用事务确保原子性
   */
  async batchUpdateTools(
    updates: Array<{ toolId: string; enabled: boolean }>,
  ): Promise<{ success: boolean; updated: number; errors: string[] }> {
    try {
      // 使用事务批量更新，确保原子性
      const results = await this.prisma.$transaction(
        updates.map((update) =>
          this.prisma.toolConfig.upsert({
            where: { toolId: update.toolId },
            create: { toolId: update.toolId, enabled: update.enabled },
            update: { enabled: update.enabled },
          }),
        ),
      );

      this.logger.log(`Batch updated ${results.length} tools successfully`);
      return { success: true, updated: results.length, errors: [] };
    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      this.logger.error(`Batch update tools failed: ${errorMsg}`);
      return {
        success: false,
        updated: 0,
        errors: [`Transaction failed: ${errorMsg}`],
      };
    }
  }

  /**
   * 批量更新技能状态
   * 使用事务确保原子性
   */
  async batchUpdateSkills(
    updates: Array<{ skillId: string; enabled: boolean }>,
  ): Promise<{ success: boolean; updated: number; errors: string[] }> {
    try {
      // 使用事务批量更新，确保原子性
      const results = await this.prisma.$transaction(
        updates.map((update) =>
          this.prisma.skillConfig.upsert({
            where: { skillId: update.skillId },
            create: { skillId: update.skillId, enabled: update.enabled },
            update: { enabled: update.enabled },
          }),
        ),
      );

      // 清除技能定义缓存
      this.invalidateSkillDefinitionsCache();

      this.logger.log(`Batch updated ${results.length} skills successfully`);

      return { success: true, updated: results.length, errors: [] };
    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      this.logger.error(`Batch update skills failed: ${errorMsg}`);

      return {
        success: false,
        updated: 0,
        errors: [`Transaction failed: ${errorMsg}`],
      };
    }
  }

  // ==================== Aggregated API ====================

  /**
   * 获取所有配置（聚合 API）
   * 一次请求返回 tools、skills 和 MCP servers 配置
   * 减少前端 API 调用次数，提升加载性能
   */
  async getAllConfigs() {
    const [toolsResult, skillsResult, mcpResult] = await Promise.all([
      this.getToolConfigs(),
      this.getSkillConfigs(),
      this.getMCPServerConfigs(),
    ]);

    return {
      tools: toolsResult,
      skills: skillsResult,
      mcpServers: mcpResult,
      timestamp: new Date().toISOString(),
    };
  }

  // ==================== Helper Methods ====================

  /**
   * 获取技能定义列表
   * 合并来源：SkillRegistry（代码实现）+ SkillLoaderService（SKILL.md 文件）
   * 使用缓存提升性能
   */
  private getSkillDefinitions(): SkillDefinition[] {
    // 检查缓存是否有效
    const now = Date.now();
    if (
      this.skillDefinitionsCache &&
      now - this.skillDefinitionsCacheTime < this.CACHE_TTL_MS
    ) {
      return this.skillDefinitionsCache;
    }

    // 重新计算技能定义
    const skillDefinitions: SkillDefinition[] = [];
    const addedIds = new Set<string>();

    // 1. 从 SkillRegistry 获取已注册的代码技能
    const registeredSkills = this.skillRegistry.getAll();
    for (const skill of registeredSkills) {
      if (!addedIds.has(skill.id)) {
        const skillWithDisplayName = skill as { displayName?: string };
        skillDefinitions.push({
          id: skill.id,
          name: skill.name,
          displayName: skillWithDisplayName.displayName || skill.name,
          description: skill.description,
          layer: skill.layer || "content",
          domain: skill.domain || "common",
          tags: skill.tags || [],
          requiredTools: skill.requiredTools || [],
          requiredSkills: skill.requiredSkills || [],
        });
        addedIds.add(skill.id);
      }
    }

    // 2. 从 SkillLoaderService 获取 SKILL.md 文件技能
    const loadedSkills = this.skillLoaderService.getAllLoadedSkills();
    for (const skill of loadedSkills) {
      if (!addedIds.has(skill.metadata.id)) {
        skillDefinitions.push({
          id: skill.metadata.id,
          name: skill.metadata.name,
          displayName: skill.metadata.name,
          description: skill.metadata.description || "",
          layer: "content", // SKILL.md 使用 domain 而非 layer
          domain: skill.metadata.domain || "common",
          tags: skill.metadata.tags || [],
          requiredTools: skill.metadata.allowedTools || [], // 使用 allowedTools
          requiredSkills: skill.metadata.dependencies || [], // 使用 dependencies
        });
        addedIds.add(skill.metadata.id);
      }
    }

    // 如果没有任何技能，添加默认示例
    if (skillDefinitions.length === 0) {
      skillDefinitions.push(
        // Understanding Layer
        {
          id: "intent-analysis",
          name: "intent-analysis",
          displayName: "意图分析",
          description: "分析用户意图和需求",
          layer: "understanding",
          domain: "common",
          tags: ["intent", "analysis"],
          requiredTools: [],
          requiredSkills: [],
        },
        {
          id: "content-understanding",
          name: "content-understanding",
          displayName: "内容理解",
          description: "理解和分析内容结构",
          layer: "understanding",
          domain: "common",
          tags: ["content", "analysis"],
          requiredTools: [],
          requiredSkills: [],
        },
        // Planning Layer
        {
          id: "outline-planning",
          name: "outline-planning",
          displayName: "大纲规划",
          description: "规划内容大纲结构",
          layer: "planning",
          domain: "common",
          tags: ["outline", "planning"],
          requiredTools: [],
          requiredSkills: ["intent-analysis"],
        },
        {
          id: "narrative-planning",
          name: "narrative-planning",
          displayName: "叙事规划",
          description: "规划内容叙事流程",
          layer: "planning",
          domain: "common",
          tags: ["narrative", "planning"],
          requiredTools: [],
          requiredSkills: ["intent-analysis"],
        },
        // Content Layer
        {
          id: "content-generation",
          name: "content-generation",
          displayName: "内容生成",
          description: "生成高质量内容",
          layer: "content",
          domain: "common",
          tags: ["content", "generation"],
          requiredTools: ["text-generation"],
          requiredSkills: ["outline-planning"],
        },
        {
          id: "content-compression",
          name: "content-compression",
          displayName: "内容压缩",
          description: "压缩和精简内容",
          layer: "content",
          domain: "common",
          tags: ["content", "compression"],
          requiredTools: [],
          requiredSkills: [],
        },
        // Quality Layer
        {
          id: "quality-review",
          name: "quality-review",
          displayName: "质量审核",
          description: "审核内容质量",
          layer: "quality",
          domain: "common",
          tags: ["quality", "review"],
          requiredTools: [],
          requiredSkills: [],
        },
        {
          id: "fact-checking",
          name: "fact-checking",
          displayName: "事实核查",
          description: "验证内容的事实准确性",
          layer: "quality",
          domain: "common",
          tags: ["fact", "verification"],
          requiredTools: ["web-search"],
          requiredSkills: [],
        },
      );
    }

    // 更新缓存
    this.skillDefinitionsCache = skillDefinitions;
    this.skillDefinitionsCacheTime = now;

    return skillDefinitions;
  }
}
