import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { ChatFacade } from "../../ai-harness/facade";
import { TaskProfile } from "../../ai-harness/facade";
import {
  CreateTeamDto,
  UpdateTeamDto,
  CreateTeamMemberDto,
  UpdateTeamMemberDto,
  QueryTeamsDto,
} from "./dto/ai-team.dto";
import { AITeamTemplateStatus, Prisma } from "@prisma/client";

@Injectable()
export class AITeamsAdminService {
  private readonly logger = new Logger(AITeamsAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiFacade: ChatFacade,
  ) {}

  // ==================== Team CRUD ====================

  async createTeam(dto: CreateTeamDto) {
    this.logger.log(`Creating AI team template: ${dto.name}`);

    const {
      members,
      workflowConfig,
      constraintProfile,
      metadata,
      ...teamData
    } = dto;

    const team = await this.prisma.aITeamTemplate.create({
      data: {
        ...teamData,
        workflowConfig: workflowConfig as Prisma.InputJsonValue,
        constraintProfile: constraintProfile as Prisma.InputJsonValue,
        metadata: metadata as Prisma.InputJsonValue,
        members: members
          ? {
              create: members.map((m, index) => ({
                ...m,
                mcpTools: m.mcpTools as unknown as Prisma.InputJsonValue,
                sortOrder: m.sortOrder ?? index,
              })),
            }
          : undefined,
      },
      include: {
        members: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return team;
  }

  async getAllTeams(query: QueryTeamsDto = {}) {
    const { status, category, includeMembers = true } = query;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (category) where.category = category;

    const teams = await this.prisma.aITeamTemplate.findMany({
      where,
      include: includeMembers
        ? {
            members: {
              orderBy: { sortOrder: "asc" },
            },
          }
        : undefined,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    return {
      items: teams,
      total: teams.length,
    };
  }

  async getTeamById(id: string) {
    const team = await this.prisma.aITeamTemplate.findUnique({
      where: { id },
      include: {
        members: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!team) {
      throw new NotFoundException(`Team template not found: ${id}`);
    }

    return team;
  }

  async updateTeam(id: string, dto: UpdateTeamDto) {
    this.logger.log(`Updating AI team template: ${id}`);

    // Check if team exists
    const existing = await this.prisma.aITeamTemplate.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Team template not found: ${id}`);
    }

    // Prevent updating system teams' critical fields
    if (existing.isSystem && dto.isSystem === false) {
      throw new BadRequestException("Cannot change system flag of system team");
    }

    const { workflowConfig, constraintProfile, metadata, ...restDto } = dto;

    const team = await this.prisma.aITeamTemplate.update({
      where: { id },
      data: {
        ...restDto,
        ...(workflowConfig !== undefined && {
          workflowConfig: workflowConfig as Prisma.InputJsonValue,
        }),
        ...(constraintProfile !== undefined && {
          constraintProfile: constraintProfile as Prisma.InputJsonValue,
        }),
        ...(metadata !== undefined && {
          metadata: metadata as Prisma.InputJsonValue,
        }),
      },
      include: {
        members: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return team;
  }

  async deleteTeam(id: string) {
    this.logger.log(`Deleting AI team template: ${id}`);

    const existing = await this.prisma.aITeamTemplate.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Team template not found: ${id}`);
    }

    if (existing.isSystem) {
      throw new BadRequestException("Cannot delete system team template");
    }

    await this.prisma.aITeamTemplate.delete({
      where: { id },
    });

    return { success: true, message: "Team template deleted" };
  }

  // ==================== Member CRUD ====================

  async addMember(teamId: string, dto: CreateTeamMemberDto) {
    this.logger.log(`Adding member to team: ${teamId}`);

    // Check if team exists
    const team = await this.prisma.aITeamTemplate.findUnique({
      where: { id: teamId },
      include: { members: true },
    });

    if (!team) {
      throw new NotFoundException(`Team template not found: ${teamId}`);
    }

    // Auto-assign sortOrder if not provided
    const maxSortOrder = Math.max(0, ...team.members.map((m) => m.sortOrder));

    const member = await this.prisma.aITeamMemberTemplate.create({
      data: {
        teamId,
        ...dto,
        mcpTools: dto.mcpTools as unknown as Prisma.InputJsonValue,
        sortOrder: dto.sortOrder ?? maxSortOrder + 1,
      },
    });

    return member;
  }

  async updateMember(memberId: string, dto: UpdateTeamMemberDto) {
    this.logger.log(`Updating team member: ${memberId}`);

    const existing = await this.prisma.aITeamMemberTemplate.findUnique({
      where: { id: memberId },
    });

    if (!existing) {
      throw new NotFoundException(`Team member not found: ${memberId}`);
    }

    const member = await this.prisma.aITeamMemberTemplate.update({
      where: { id: memberId },
      data: {
        ...dto,
        mcpTools: dto.mcpTools as unknown as Prisma.InputJsonValue,
      },
    });

    return member;
  }

  async deleteMember(memberId: string) {
    this.logger.log(`Deleting team member: ${memberId}`);

    const existing = await this.prisma.aITeamMemberTemplate.findUnique({
      where: { id: memberId },
    });

    if (!existing) {
      throw new NotFoundException(`Team member not found: ${memberId}`);
    }

    await this.prisma.aITeamMemberTemplate.delete({
      where: { id: memberId },
    });

    return { success: true, message: "Team member deleted" };
  }

  async reorderMembers(teamId: string, memberIds: string[]) {
    this.logger.log(`Reordering members for team: ${teamId}`);

    // Verify team exists
    const team = await this.prisma.aITeamTemplate.findUnique({
      where: { id: teamId },
    });

    if (!team) {
      throw new NotFoundException(`Team template not found: ${teamId}`);
    }

    // Update sort orders
    await this.prisma.$transaction(
      memberIds.map((memberId, index) =>
        this.prisma.aITeamMemberTemplate.update({
          where: { id: memberId },
          data: { sortOrder: index },
        }),
      ),
    );

    // Return updated team
    return this.getTeamById(teamId);
  }

  // ==================== Public API (for other apps) ====================

  async getActiveTeamTemplates(category?: string) {
    const where: Record<string, unknown> = {
      status: AITeamTemplateStatus.ACTIVE,
    };
    if (category) where.category = category;

    const teams = await this.prisma.aITeamTemplate.findMany({
      where,
      include: {
        members: {
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }],
    });

    return teams;
  }

  async getTeamTemplateById(id: string) {
    const team = await this.prisma.aITeamTemplate.findFirst({
      where: {
        id,
        status: AITeamTemplateStatus.ACTIVE,
      },
      include: {
        members: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!team) {
      throw new NotFoundException(`Active team template not found: ${id}`);
    }

    return team;
  }

  // ==================== Utility ====================

  async getAvailableTools() {
    // Return list of available built-in tools (AICapability enum)
    return {
      builtIn: [
        {
          id: "TEXT_GENERATION",
          name: "文本生成",
          description: "生成文本内容",
        },
        { id: "CODE_GENERATION", name: "代码生成", description: "生成代码" },
        { id: "CODE_REVIEW", name: "代码审查", description: "审查代码质量" },
        { id: "IMAGE_GENERATION", name: "图片生成", description: "生成图片" },
        { id: "IMAGE_ANALYSIS", name: "图片分析", description: "分析图片内容" },
        { id: "WEB_SEARCH", name: "网络搜索", description: "搜索网络信息" },
        { id: "URL_FETCH", name: "URL抓取", description: "抓取网页内容" },
        {
          id: "DOCUMENT_ANALYSIS",
          name: "文档分析",
          description: "分析文档内容",
        },
        { id: "REASONING", name: "深度推理", description: "复杂推理分析" },
        { id: "MATH", name: "数学计算", description: "数学运算" },
        { id: "TRANSLATION", name: "翻译", description: "多语言翻译" },
        { id: "SUMMARIZATION", name: "摘要生成", description: "生成内容摘要" },
      ],
    };
  }

  async getAvailableSkills() {
    // Return predefined skills
    return {
      research: [
        { id: "research-planning", name: "研究规划" },
        { id: "information-retrieval", name: "信息检索" },
        { id: "source-validation", name: "来源验证" },
        { id: "data-collection", name: "数据收集" },
      ],
      analysis: [
        { id: "data-analysis", name: "数据分析" },
        { id: "trend-insight", name: "趋势洞察" },
        { id: "logical-reasoning", name: "逻辑推理" },
        { id: "risk-identification", name: "风险识别" },
      ],
      content: [
        { id: "content-creation", name: "内容创作" },
        { id: "structure-organization", name: "结构组织" },
        { id: "language-polish", name: "语言润色" },
        { id: "style-control", name: "风格控制" },
      ],
      technical: [
        { id: "code-generation", name: "代码生成" },
        { id: "architecture-design", name: "架构设计" },
        { id: "debugging", name: "调试排错" },
        { id: "code-review", name: "代码审查" },
      ],
      collaboration: [
        { id: "quality-review", name: "质量审查" },
        { id: "content-integration", name: "内容整合" },
        { id: "consensus-building", name: "共识构建" },
        { id: "task-delegation", name: "任务分配" },
      ],
    };
  }

  async getBuiltInRoles() {
    return {
      leaders: [
        { id: "research-lead", name: "研究主管", description: "领导研究团队" },
        { id: "content-lead", name: "内容主管", description: "领导内容创作" },
        { id: "tech-lead", name: "技术主管", description: "领导技术开发" },
        { id: "moderator", name: "协调员", description: "协调团队工作" },
      ],
      members: [
        { id: "researcher", name: "研究员", description: "执行研究任务" },
        { id: "analyst", name: "分析师", description: "数据分析" },
        { id: "writer", name: "作家", description: "内容创作" },
        { id: "developer", name: "开发者", description: "代码开发" },
        { id: "designer", name: "设计师", description: "设计工作" },
        { id: "reviewer", name: "审查员", description: "质量审查" },
        { id: "advocate", name: "倡导者", description: "观点倡导" },
      ],
    };
  }

  async getWorkStyles() {
    return [
      {
        id: "AUTONOMOUS",
        name: "自主型",
        description: "独立完成任务，主动汇报",
      },
      {
        id: "COLLABORATIVE",
        name: "协作型",
        description: "频繁与其他Agent交流",
      },
      { id: "SUPPORTIVE", name: "支持型", description: "主要协助其他Agent" },
      { id: "ANALYTICAL", name: "分析型", description: "深度分析，谨慎输出" },
      { id: "CREATIVE", name: "创意型", description: "发散思维，提供创新方案" },
    ];
  }

  // ==================== AI 智能配置 ====================

  /**
   * 使用 AI 生成团队成员配置建议
   * @param teamName 团队名称
   * @param teamDescription 团队描述
   * @param category 团队分类
   */
  async generateTeamConfig(params: {
    teamName: string;
    teamDescription?: string;
    category?: string;
  }) {
    this.logger.log(`Generating AI team config for: ${params.teamName}`);

    const systemPrompt = `你是一个 AI 团队配置专家。根据用户提供的团队名称、描述和分类，生成合适的团队成员配置。

可用的角色类型：
- Leader 角色：research-lead(研究主管), content-lead(内容主管), tech-lead(技术主管), moderator(协调员)
- 成员角色：researcher(研究员), analyst(分析师), writer(作家), developer(开发者), designer(设计师), reviewer(审查员), advocate(倡导者)

可用的工作风格：
- AUTONOMOUS(自主型): 独立完成任务，主动汇报
- COLLABORATIVE(协作型): 频繁与其他Agent交流
- SUPPORTIVE(支持型): 主要协助其他Agent
- ANALYTICAL(分析型): 深度分析，谨慎输出
- CREATIVE(创意型): 发散思维，提供创新方案

可用的能力/工具：
- TEXT_GENERATION(文本生成), CODE_GENERATION(代码生成), CODE_REVIEW(代码审查)
- IMAGE_GENERATION(图片生成), IMAGE_ANALYSIS(图片分析)
- WEB_SEARCH(网络搜索), URL_FETCH(URL抓取), DOCUMENT_ANALYSIS(文档分析)
- REASONING(深度推理), MATH(数学计算), TRANSLATION(翻译), SUMMARIZATION(摘要生成)

可用的技能分类：
- 研究类：research-planning, information-retrieval, source-validation, data-collection
- 分析类：data-analysis, trend-insight, logical-reasoning, risk-identification
- 内容类：content-creation, structure-organization, language-polish, style-control
- 技术类：code-generation, architecture-design, debugging, code-review
- 协作类：quality-review, content-integration, consensus-building, task-delegation

请根据团队目标生成 3-5 个合适的团队成员配置，必须包含至少一个 Leader。

返回 JSON 格式：
{
  "members": [
    {
      "name": "英文标识(如 architect)",
      "displayName": "中文显示名称(如 架构师)",
      "avatar": "适合的emoji",
      "roleId": "角色ID",
      "isLeader": true/false,
      "roleDescription": "角色职责描述",
      "personality": "性格特点",
      "workStyle": "工作风格ID",
      "capabilities": ["能力ID数组"],
      "expertiseAreas": ["技能ID数组"],
      "systemPrompt": "该角色的系统提示词"
    }
  ]
}`;

    const userPrompt = `请为以下团队生成成员配置：

团队名称：${params.teamName}
${params.teamDescription ? `团队描述：${params.teamDescription}` : ""}
${params.category ? `团队分类：${params.category}` : ""}

请返回纯 JSON 格式，不要包含 markdown 代码块。`;

    try {
      // ★ 使用 AIFacade 获取默认 CHAT 模型，不直接访问数据库
      const modelConfig = await this.aiFacade.getDefaultTextModel();

      if (!modelConfig) {
        throw new Error("没有可用的 AI 模型，请在管理后台配置");
      }

      this.logger.log(
        `Using model for team config generation: ${modelConfig.displayName} (${modelConfig.modelId})`,
      );

      // 定义任务配置：团队配置生成任务，需要中等创意度和短输出
      const taskProfile: TaskProfile = {
        creativity: "medium", // temperature: 0.7 - 需要一定创意性
        outputLength: "short", // maxTokens: 1500 (原 2000，调整为 short)
      };

      const result = await this.aiFacade.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        model: modelConfig.modelId,
        taskProfile, // 使用任务配置
      });

      this.logger.debug(
        `AI raw response: ${result.content?.substring(0, 500)}`,
      );

      // 解析 AI 返回的 JSON
      let config;
      let content = result.content || "";

      // 清理 markdown 代码块
      content = content
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      try {
        // 尝试直接解析
        config = JSON.parse(content);
      } catch {
        // 如果失败，尝试提取 JSON 部分（查找最外层的 {} ）
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            config = JSON.parse(jsonMatch[0]);
          } catch (innerError) {
            this.logger.error(
              `JSON parse failed. Extracted: ${jsonMatch[0].substring(0, 200)}`,
            );
            throw new Error("无法解析 AI 返回的配置格式");
          }
        } else {
          this.logger.error(
            `No JSON found in response: ${content.substring(0, 200)}`,
          );
          throw new Error("AI 返回的内容中未找到有效的 JSON");
        }
      }

      // 验证配置结构
      if (!config.members || !Array.isArray(config.members)) {
        this.logger.error(
          `Invalid config structure: ${JSON.stringify(config).substring(0, 200)}`,
        );
        throw new Error("AI 返回的配置缺少 members 数组");
      }

      this.logger.log(`Generated ${config.members.length} team members`);
      return config;
    } catch (error) {
      this.logger.error(`Failed to generate team config: ${error}`);
      throw new BadRequestException(
        `AI 配置生成失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
