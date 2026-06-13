import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { AIAdminService } from "./ai-admin.service";
import {
  GuardrailsPipelineService,
  SkillSandboxService,
} from "../../../ai-engine/facade";

/**
 * AI 能力管理控制器
 * 管理 Tools、Skills 和 MCP 服务器
 * 统一路由前缀: /admin/ai
 */
@ApiTags("AI Admin")
@Controller("admin/ai")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AIController {
  private readonly logger = new Logger(AIController.name);

  constructor(
    private readonly aiAdminService: AIAdminService,
    private readonly guardrailsPipeline: GuardrailsPipelineService,
    private readonly skillSandboxService: SkillSandboxService,
  ) {}

  // ==================== Batch Operations ====================

  @Post("tools/batch")
  @ApiOperation({ summary: "批量更新工具状态" })
  @ApiBody({
    description: "工具更新列表",
    schema: {
      type: "object",
      required: ["updates"],
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            required: ["toolId", "enabled"],
            properties: {
              toolId: { type: "string", description: "工具 ID" },
              enabled: { type: "boolean", description: "是否启用" },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "返回批量更新结果" })
  async batchUpdateTools(
    @Body() body: { updates: Array<{ toolId: string; enabled: boolean }> },
  ) {
    this.logger.log(`Admin: Batch updating ${body.updates.length} tools`);
    return this.aiAdminService.batchUpdateTools(body.updates);
  }

  @Post("skills/batch")
  @ApiOperation({ summary: "批量更新技能状态" })
  @ApiBody({
    description: "技能更新列表",
    schema: {
      type: "object",
      required: ["updates"],
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            required: ["skillId", "enabled"],
            properties: {
              skillId: { type: "string", description: "技能 ID" },
              enabled: { type: "boolean", description: "是否启用" },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "返回批量更新结果" })
  async batchUpdateSkills(
    @Body() body: { updates: Array<{ skillId: string; enabled: boolean }> },
  ) {
    this.logger.log(`Admin: Batch updating ${body.updates.length} skills`);
    return this.aiAdminService.batchUpdateSkills(body.updates);
  }

  // ==================== Skill Upload ====================

  @Post("skills/upload")
  @ApiOperation({ summary: "上传技能配置文件" })
  @ApiResponse({ status: 200, description: "技能上传成功" })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 1024 * 1024 }, // 1MB max
      fileFilter: (_req, file, callback) => {
        const allowedTypes = [
          "application/json",
          "application/x-yaml",
          "text/yaml",
          "text/x-yaml",
        ];
        const allowedExtensions = [".json", ".yaml", ".yml"];
        const ext = file.originalname
          .toLowerCase()
          .slice(file.originalname.lastIndexOf("."));

        if (
          allowedTypes.includes(file.mimetype) ||
          allowedExtensions.includes(ext)
        ) {
          callback(null, true);
        } else {
          callback(
            new BadRequestException(
              "Only JSON and YAML files are allowed (.json, .yaml, .yml)",
            ),
            false,
          );
        }
      },
    }),
  )
  async uploadSkill(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }

    this.logger.log(`Admin: Uploading skill from file: ${file.originalname}`);

    try {
      const content = file.buffer.toString("utf-8");
      let skillData: Record<string, unknown>;

      // Parse file content based on extension
      const ext = file.originalname
        .toLowerCase()
        .slice(file.originalname.lastIndexOf("."));
      if (ext === ".json") {
        skillData = JSON.parse(content) as Record<string, unknown>;
      } else {
        // YAML parsing - use simple JSON-like structure for now
        // For full YAML support, you'd need to add a YAML parser dependency
        try {
          skillData = JSON.parse(content) as Record<string, unknown>;
        } catch {
          throw new BadRequestException(
            "YAML parsing not yet supported. Please use JSON format.",
          );
        }
      }

      // Validate required fields
      if (!skillData.name && !skillData.skillId) {
        throw new BadRequestException(
          "Skill file must contain 'name' or 'skillId' field",
        );
      }

      // Create skill config in database
      const result = await this.aiAdminService.uploadSkill(skillData);

      return {
        message: `Successfully uploaded skill: ${result.displayName ?? result.skillId}`,
        skill: result,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to parse skill file";
      this.logger.error(`Failed to upload skill: ${errorMessage}`);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(errorMessage);
    }
  }

  // ==================== Aggregated API ====================

  @Get("all-configs")
  @ApiOperation({
    summary: "获取所有配置",
    description: "聚合 API - 一次请求返回 tools、skills 和 MCP servers 配置",
  })
  @ApiResponse({ status: 200, description: "成功返回所有配置" })
  async getAllConfigs() {
    this.logger.log("Admin: Fetching all AI configurations");
    return this.aiAdminService.getAllConfigs();
  }

  // ==================== Tools ====================

  @Get("tools")
  @ApiOperation({ summary: "获取所有工具配置" })
  @ApiResponse({ status: 200, description: "成功返回工具配置列表" })
  async getTools() {
    this.logger.log("Admin: Fetching tool configurations");
    return this.aiAdminService.getToolConfigs();
  }

  /**
   * ★ 2026-05-07 (PR-S0a): 工具 ID 别名映射统一对外 endpoint。
   * 前端用 provider id（如 'perplexity'），ToolRegistry 用 registry id
   * （如 'web-search'）；过去前后端各持一份硬编码映射表，**已发生漂移事故**
   * （前端 28 项 ≠ 后端 21 项，详见 secret-reference-overhaul-design-v1.4.md
   * §1.2 / §2.4）。本 endpoint 把 backend `tool-id-aliases.ts` 作为唯一真理源
   * 输出给前端 `useToolAliases()` hook，从根上消除双源。
   */
  @Get("tool-aliases")
  @ApiOperation({
    summary: "获取工具 ID 别名映射（provider id → registry id 单源）",
  })
  @ApiResponse({
    status: 200,
    description:
      "返回 { aliasToRegistry: Record<string,string>, multiProviderRegistryIds: string[] }",
  })
  async getToolAliases() {
    return this.aiAdminService.getToolAliases();
  }

  @Patch("tools/:toolId")
  @ApiOperation({ summary: "更新工具配置" })
  @ApiParam({ name: "toolId", description: "工具 ID" })
  @ApiResponse({ status: 200, description: "成功更新工具配置" })
  async updateTool(
    @Param("toolId") toolId: string,
    @Body()
    body: {
      enabled?: boolean;
      displayName?: string;
      description?: string;
      config?: Record<string, unknown>;
      secretKey?: string | null;
    },
  ) {
    this.logger.log(`Admin: Updating tool ${toolId}`);
    return this.aiAdminService.updateToolConfig(toolId, body);
  }

  @Post("tools/:toolId/test")
  @ApiOperation({ summary: "测试工具" })
  @ApiParam({ name: "toolId", description: "工具 ID" })
  @ApiResponse({ status: 200, description: "返回工具测试结果" })
  async testTool(
    @Param("toolId") toolId: string,
    @Body() body: { input?: Record<string, unknown> },
  ) {
    this.logger.log(`Admin: Testing tool ${toolId}`);
    return this.aiAdminService.testTool(toolId, body.input);
  }

  @Get("tools/diagnose")
  @ApiOperation({
    summary: "诊断所有工具健康状态",
    description: "检查所有工具的可用性、密钥配置等，返回诊断结果",
  })
  @ApiResponse({
    status: 200,
    description: "返回工具健康诊断结果",
    schema: {
      type: "object",
      properties: {
        tools: {
          type: "array",
          items: {
            type: "object",
            properties: {
              toolId: { type: "string" },
              name: { type: "string" },
              status: {
                type: "string",
                enum: ["healthy", "unhealthy", "unconfigured"],
              },
              message: { type: "string" },
              hasSecretKey: { type: "boolean" },
              secretKeyValid: { type: "boolean" },
            },
          },
        },
        summary: {
          type: "object",
          properties: {
            total: { type: "number" },
            healthy: { type: "number" },
            unhealthy: { type: "number" },
            unconfigured: { type: "number" },
          },
        },
      },
    },
  })
  async diagnoseTools() {
    this.logger.log("Admin: Diagnosing all tools");
    return this.aiAdminService.diagnoseTools();
  }

  @Get("external-tools/diagnose")
  @ApiOperation({
    summary: "诊断外部工具健康状态",
    description: "检查外部 API 服务（如 Perplexity, Tavily, Serper）的配置状态",
  })
  @ApiResponse({ status: 200, description: "返回外部工具诊断结果" })
  async diagnoseExternalTools() {
    this.logger.log("Admin: Diagnosing external tools");
    return this.aiAdminService.diagnoseExternalTools();
  }

  @Get("mcp-servers/diagnose")
  @ApiOperation({
    summary: "诊断 MCP 服务器健康状态",
    description: "检查所有 MCP 服务器的连接状态和可用工具",
  })
  @ApiResponse({ status: 200, description: "返回 MCP 服务器诊断结果" })
  async diagnoseMCPServers() {
    this.logger.log("Admin: Diagnosing MCP servers");
    return this.aiAdminService.diagnoseMCPServers();
  }

  @Get("diagnose")
  @ApiOperation({
    summary: "全面诊断 AI 能力系统",
    description:
      "检查所有断点：Secrets、内置工具、外部工具、MCP 服务器、技能、团队能力",
  })
  @ApiResponse({
    status: 200,
    description: "返回完整的系统诊断结果，包括发现的断点和修复建议",
  })
  async diagnoseAllCapabilities() {
    this.logger.log("Admin: Running full AI capability system diagnosis");
    return this.aiAdminService.diagnoseAllCapabilities();
  }

  @Get("services/:serviceId/key-health")
  @ApiOperation({
    summary: "获取服务的 API Key 健康状态",
    description:
      "返回服务配置的所有 API Key 的健康状态，用于多密钥轮换监控。支持 SEARCH/EXTRACTION/YOUTUBE/TTS 分类的服务。",
  })
  @ApiParam({
    name: "serviceId",
    description:
      "服务 ID (tavily, serper, jina, firecrawl, tavily-extract, supadata, elevenlabs)",
  })
  @ApiResponse({
    status: 200,
    description: "返回密钥健康状态列表",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "number", description: "密钥序号" },
          maskedKey: { type: "string", description: "脱敏显示的密钥" },
          isHealthy: { type: "boolean", description: "是否健康可用" },
          lastError: { type: "string", description: "最近错误码" },
          cooldownUntil: { type: "string", description: "冷却结束时间 (ISO)" },
        },
      },
    },
  })
  async getServiceKeyHealth(@Param("serviceId") serviceId: string) {
    this.logger.log(`Admin: Getting key health for service ${serviceId}`);
    return this.aiAdminService.getServiceKeyHealth(serviceId);
  }

  /**
   * @deprecated 使用 GET /services/:serviceId/key-health 代替
   */
  @Get("tools/:toolId/key-health")
  @ApiOperation({
    summary: "[已弃用] 获取工具的 API Key 健康状态",
    description: "请使用 GET /admin/ai/services/:serviceId/key-health 代替",
    deprecated: true,
  })
  async getToolKeyHealth(@Param("toolId") toolId: string) {
    this.logger.log(
      `Admin: Getting key health for tool ${toolId} (deprecated)`,
    );
    return this.aiAdminService.getServiceKeyHealth(toolId);
  }

  @Get("tools/available-for-agent")
  @ApiOperation({
    summary: "获取可装配给 Agent 的工具列表",
    description: "只返回健康且启用的工具，用于 Team Leader 装配成员",
  })
  @ApiResponse({
    status: 200,
    description: "返回可用工具列表",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          toolId: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          category: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
  })
  async getAvailableToolsForAgent() {
    this.logger.log("Admin: Getting available tools for agent");
    return this.aiAdminService.getAvailableToolsForAgent();
  }

  // ==================== Skills ====================

  @Get("skills")
  @ApiOperation({ summary: "获取所有技能配置" })
  @ApiResponse({ status: 200, description: "成功返回技能配置列表" })
  async getSkills() {
    this.logger.log("Admin: Fetching skill configurations");
    return this.aiAdminService.getSkillConfigs();
  }

  @Patch("skills/:skillId")
  @ApiOperation({ summary: "更新技能配置" })
  @ApiParam({ name: "skillId", description: "技能 ID" })
  @ApiResponse({ status: 200, description: "成功更新技能配置" })
  async updateSkill(
    @Param("skillId") skillId: string,
    @Body()
    body: {
      enabled?: boolean;
      displayName?: string;
      description?: string;
      config?: Record<string, unknown>;
    },
  ) {
    this.logger.log(`Admin: Updating skill ${skillId}`);
    return this.aiAdminService.updateSkillConfig(skillId, body);
  }

  // ==================== Skill Content & Versions ====================

  @Get("skills/:skillId/content")
  @ApiOperation({ summary: "获取 Skill 完整 prompt 内容" })
  @ApiParam({ name: "skillId", description: "技能 ID" })
  @ApiResponse({ status: 200, description: "返回 prompt 内容 + 版本历史" })
  async getSkillContent(@Param("skillId") skillId: string) {
    this.logger.log(`Admin: Fetching skill content for ${skillId}`);
    return this.aiAdminService.getSkillPromptContent(skillId);
  }

  @Put("skills/:skillId/content")
  @ApiOperation({ summary: "更新 Skill prompt 内容（自动版本快照）" })
  @ApiParam({ name: "skillId", description: "技能 ID" })
  @ApiResponse({ status: 200, description: "返回新版本号" })
  async updateSkillContent(
    @Param("skillId") skillId: string,
    @Body()
    body: {
      content: string;
      frontmatter?: Record<string, unknown>;
      changeNote?: string;
    },
  ) {
    this.logger.log(`Admin: Updating skill content for ${skillId}`);
    return this.aiAdminService.updateSkillPromptContent(
      skillId,
      body.content,
      body.frontmatter ?? null,
      body.changeNote,
    );
  }

  @Get("skills/:skillId/versions")
  @ApiOperation({ summary: "获取 Skill 版本历史" })
  @ApiParam({ name: "skillId", description: "技能 ID" })
  @ApiResponse({ status: 200, description: "返回版本历史列表" })
  async getSkillVersions(
    @Param("skillId") skillId: string,
    @Query("limit") limit?: string,
  ) {
    this.logger.log(`Admin: Fetching skill versions for ${skillId}`);
    return this.aiAdminService.getSkillVersionHistory(
      skillId,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post("skills/:skillId/versions/:versionId/restore")
  @ApiOperation({ summary: "恢复到指定版本" })
  @ApiParam({ name: "skillId", description: "技能 ID" })
  @ApiParam({ name: "versionId", description: "版本 ID" })
  @ApiResponse({ status: 200, description: "返回恢复后的新版本号" })
  async restoreSkillVersion(
    @Param("skillId") skillId: string,
    @Param("versionId") versionId: string,
  ) {
    this.logger.log(
      `Admin: Restoring skill ${skillId} to version ${versionId}`,
    );
    return this.aiAdminService.restoreSkillVersion(skillId, versionId);
  }

  @Post("skills")
  @ApiOperation({ summary: "从 UI 创建新 Skill" })
  @ApiResponse({ status: 201, description: "创建成功" })
  async createSkill(
    @Body()
    body: {
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
    },
  ) {
    this.logger.log(`Admin: Creating skill from UI: ${body.skillId}`);
    return this.aiAdminService.createSkillFromUI(body);
  }

  // ==================== Skill Sandbox ====================

  @Post("skills/:skillId/test")
  @ApiOperation({ summary: "在沙箱中测试 Skill" })
  @ApiParam({ name: "skillId", description: "技能 ID" })
  @ApiResponse({ status: 200, description: "返回测试执行结果" })
  async testSkill(
    @Param("skillId") skillId: string,
    @Body()
    body: {
      input: unknown;
      model?: string;
      taskProfile?: { creativity?: string; outputLength?: string };
    },
  ) {
    this.logger.log(`Admin: Testing skill in sandbox: ${skillId}`);
    return this.skillSandboxService.testExecution(skillId, body.input, {
      model: body.model,
      taskProfile: body.taskProfile as {
        creativity?: "deterministic" | "low" | "medium" | "high";
        outputLength?:
          | "minimal"
          | "short"
          | "medium"
          | "standard"
          | "long"
          | "extended";
      },
    });
  }

  @Post("skills/validate")
  @ApiOperation({ summary: "校验 Skill 内容" })
  @ApiResponse({ status: 200, description: "返回校验结果" })
  validateSkill(
    @Body()
    body: {
      content: string;
      frontmatter?: Record<string, unknown>;
    },
  ) {
    this.logger.log("Admin: Validating skill content");
    return this.skillSandboxService.validateSkillContent(
      body.content,
      body.frontmatter,
    );
  }

  @Post("skills/:skillId/dry-run")
  @ApiOperation({ summary: "Dry run: 构建 prompt 预览，不调 LLM" })
  @ApiParam({ name: "skillId", description: "技能 ID" })
  @ApiResponse({ status: 200, description: "返回 prompt 预览" })
  async dryRunSkill(
    @Param("skillId") skillId: string,
    @Body() body: { input: unknown },
  ) {
    this.logger.log(`Admin: Dry run for skill: ${skillId}`);
    return this.skillSandboxService.dryRun(skillId, body.input);
  }

  // ==================== Usage Statistics ====================

  @Get("usage-stats")
  @ApiOperation({
    summary: "获取能力使用统计",
    description: "获取工具、技能、MCP 服务器的使用次数统计",
  })
  @ApiResponse({
    status: 200,
    description: "成功返回使用统计",
    schema: {
      type: "object",
      properties: {
        tools: {
          type: "object",
          additionalProperties: { type: "number" },
          description: "工具使用次数，键为工具ID",
        },
        skills: {
          type: "object",
          additionalProperties: { type: "number" },
          description: "技能使用次数，键为技能ID",
        },
        mcp: {
          type: "object",
          additionalProperties: { type: "number" },
          description: "MCP 工具使用次数，键为工具ID",
        },
      },
    },
  })
  async getUsageStatistics() {
    this.logger.log("Admin: Fetching usage statistics");
    const [tools, skills, mcp] = await Promise.all([
      this.aiAdminService.getUsageCountsByType("tool"),
      this.aiAdminService.getUsageCountsByType("skill"),
      this.aiAdminService.getUsageCountsByType("mcp"),
    ]);
    return { tools, skills, mcp };
  }

  // ==================== MCP Servers ====================

  @Get("mcp-servers")
  @ApiOperation({ summary: "获取所有 MCP 服务器配置" })
  @ApiResponse({ status: 200, description: "成功返回 MCP 服务器列表" })
  async getMCPServers() {
    this.logger.log("Admin: Fetching MCP server configurations");
    return this.aiAdminService.getMCPServerConfigs();
  }

  @Post("mcp-servers")
  @ApiOperation({ summary: "添加 MCP 服务器" })
  @ApiBody({
    description: "MCP 服务器配置",
    schema: {
      type: "object",
      required: ["serverId", "name", "transport"],
      properties: {
        serverId: { type: "string", description: "服务器唯一标识" },
        name: { type: "string", description: "服务器名称" },
        description: { type: "string", description: "服务器描述" },
        transport: {
          type: "string",
          enum: ["stdio", "sse"],
          description: "传输类型",
        },
        command: { type: "string", description: "命令 (stdio)" },
        args: {
          type: "array",
          items: { type: "string" },
          description: "命令参数",
        },
        url: { type: "string", description: "URL (sse)" },
        enabled: { type: "boolean", description: "是否启用" },
        autoConnect: { type: "boolean", description: "自动连接" },
      },
    },
  })
  @ApiResponse({ status: 201, description: "成功添加 MCP 服务器" })
  async addMCPServer(
    @Body()
    body: {
      serverId: string;
      name: string;
      description?: string;
      transport: "stdio" | "sse";
      command?: string;
      args?: string[];
      url?: string;
      enabled?: boolean;
      autoConnect?: boolean;
      apiKey?: string;
    },
  ) {
    this.logger.log(`Admin: Adding MCP server ${body.serverId}`);
    return this.aiAdminService.addMCPServer(body);
  }

  @Patch("mcp-servers/:serverId")
  @ApiOperation({ summary: "更新 MCP 服务器配置" })
  @ApiParam({ name: "serverId", description: "服务器 ID" })
  @ApiResponse({ status: 200, description: "成功更新 MCP 服务器配置" })
  async updateMCPServer(
    @Param("serverId") serverId: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      enabled?: boolean;
      autoConnect?: boolean;
      command?: string;
      args?: string[];
      url?: string;
      apiKey?: string;
      env?: Record<string, string>;
    },
  ) {
    this.logger.log(`Admin: Updating MCP server ${serverId}`);
    return this.aiAdminService.updateMCPServer(serverId, body);
  }

  @Put("mcp-servers/:serverId/env")
  @ApiOperation({ summary: "配置 MCP 服务器环境变量" })
  @ApiParam({ name: "serverId", description: "服务器 ID" })
  @ApiResponse({ status: 200, description: "成功配置环境变量" })
  async configureMCPServerEnv(
    @Param("serverId") serverId: string,
    @Body() body: { env: Record<string, string> },
  ) {
    this.logger.log(`Admin: Configuring env for MCP server ${serverId}`);
    return this.aiAdminService.updateMCPServerEnv(serverId, body.env);
  }

  @Post("mcp-servers/:serverId/connect")
  @ApiOperation({ summary: "连接 MCP 服务器" })
  @ApiParam({ name: "serverId", description: "服务器 ID" })
  @ApiResponse({ status: 200, description: "成功连接 MCP 服务器" })
  async connectMCPServer(@Param("serverId") serverId: string) {
    this.logger.log(`Admin: Connecting MCP server ${serverId}`);
    return this.aiAdminService.connectMCPServer(serverId);
  }

  @Post("mcp-servers/:serverId/disconnect")
  @ApiOperation({ summary: "断开 MCP 服务器" })
  @ApiParam({ name: "serverId", description: "服务器 ID" })
  @ApiResponse({ status: 200, description: "成功断开 MCP 服务器" })
  async disconnectMCPServer(@Param("serverId") serverId: string) {
    this.logger.log(`Admin: Disconnecting MCP server ${serverId}`);
    return this.aiAdminService.disconnectMCPServer(serverId);
  }

  @Delete("mcp-servers/:serverId")
  @ApiOperation({ summary: "删除 MCP 服务器" })
  @ApiParam({ name: "serverId", description: "服务器 ID" })
  @ApiResponse({ status: 200, description: "成功删除 MCP 服务器" })
  async deleteMCPServer(@Param("serverId") serverId: string) {
    this.logger.log(`Admin: Deleting MCP server ${serverId}`);
    return this.aiAdminService.deleteMCPServer(serverId);
  }

  // ─── Guardrails ───

  @Get("guardrails")
  @ApiOperation({ summary: "Get registered guardrails" })
  @ApiResponse({ status: 200, description: "List of registered guardrails" })
  getGuardrails() {
    return this.guardrailsPipeline.getRegisteredGuardrails();
  }
}
