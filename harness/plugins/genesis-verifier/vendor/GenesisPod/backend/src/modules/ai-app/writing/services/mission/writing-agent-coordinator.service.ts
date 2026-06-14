/**
 * Writing Agent Coordinator Service
 *
 * 负责 Writing Team 的 Agent 调度、模型分配和角色注册。
 * 从 WritingMissionService 拆分出来，专注于团队协调逻辑。
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade, TeamFacade, TeamRegistry, RoleRegistry } from "@/modules/ai-harness/facade";
import type { ITeam } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

// Writing Agents
import {
  StoryArchitectAgent,
  BibleKeeperAgent,
  WriterAgent,
  ConsistencyCheckerAgent,
  EditorAgent,
} from "../../agents";

/**
 * AI 模型配置信息
 */
interface ModelConfig {
  modelId: string;
  displayName: string;
  provider: string;
  apiKey?: string;
  apiEndpoint?: string;
  isReasoning: boolean; // 是否具备推理能力 (o1, o3, gpt-5, etc.)
}

/**
 * 角色模型分配结果
 */
export interface RoleModelAssignment {
  roleId: string;
  modelId: string;
  isActive: boolean;
}

@Injectable()
export class WritingAgentCoordinator {
  private readonly logger = new Logger(WritingAgentCoordinator.name);

  // Writing Team 配置
  private writingTeam: ITeam | null = null;
  private readonly WRITING_TEAM_ID = "ai-writing-team";

  // 模型配置缓存
  private cachedModels: ModelConfig[] | null = null;
  private modelCacheTime: number = 0;
  private readonly MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

  constructor(
    private readonly teamRegistry: TeamRegistry,
    private readonly roleRegistry: RoleRegistry,
    private readonly chatFacade: ChatFacade,
    private readonly teamFacade: TeamFacade,
    // Writing Agents
    private readonly storyArchitect: StoryArchitectAgent,
    private readonly bibleKeeper: BibleKeeperAgent,
    private readonly writer: WriterAgent,
    private readonly consistencyChecker: ConsistencyCheckerAgent,
    private readonly editor: EditorAgent,
  ) {
    // 注册角色和团队配置（不需要 LLM）
    this.registerWritingRoles();
    this.registerWritingTeamConfig();
  }

  /**
   * 获取可用的 AI 模型列表
   * 从数据库查询已启用的模型
   */
  async getAvailableModels(): Promise<ModelConfig[]> {
    const now = Date.now();

    // 检查缓存
    if (this.cachedModels && now - this.modelCacheTime < this.MODEL_CACHE_TTL) {
      return this.cachedModels;
    }

    try {
      // ★ 使用 AIFacade 获取模型列表
      const models = await this.chatFacade.getAvailableModelsExtended(
        AIModelType.CHAT,
      );

      // 转换为 ModelConfig 并排除 xAI 模型
      this.cachedModels = models
        .filter((m) => m.provider !== "xAI") // 排除 xAI 模型（grok）
        .map((m) => ({
          modelId: m.id,
          displayName: m.name,
          provider: m.provider,
          isReasoning: m.isReasoning || false,
        }));

      this.modelCacheTime = now;

      this.logger.log(
        `Loaded ${this.cachedModels.length} AI models, ` +
          `${this.cachedModels.filter((m) => m.isReasoning).length} with reasoning capability`,
      );

      return this.cachedModels;
    } catch (error) {
      this.logger.error(
        `Failed to load AI models: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * 为各角色分配 AI 模型
   * 策略：模型多元化，减少盲区
   * - Leader (story-architect): 优先使用推理模型
   * - Keeper (bible-keeper): 使用擅长知识管理的模型
   * - Writer: 使用擅长创意的模型
   * - Checker: 使用擅长分析的模型
   * - Editor: 使用擅长润色的模型
   *
   * 当模型数量有限时，尽量轮换使用不同模型
   */
  async assignModelsToRoles(): Promise<RoleModelAssignment[]> {
    const models = await this.getAvailableModels();

    if (models.length === 0) {
      this.logger.warn("No AI models available, all roles will be inactive");
      return [
        { roleId: "story-architect", modelId: "", isActive: false },
        { roleId: "bible-keeper", modelId: "", isActive: false },
        { roleId: "writer", modelId: "", isActive: false },
        { roleId: "consistency-checker", modelId: "", isActive: false },
        { roleId: "editor", modelId: "", isActive: false },
      ];
    }

    // 分离推理模型和聊天模型
    const reasoningModels = models.filter((m) => m.isReasoning);
    // chatModels 用于日志记录
    const chatModelCount = models.filter((m) => !m.isReasoning).length;
    this.logger.debug(
      `Available models: ${reasoningModels.length} reasoning, ${chatModelCount} chat`,
    );

    // 模型多元化分配
    // 5 个角色，尽量使用不同的模型
    const roleModelMap: Record<string, ModelConfig> = {};

    // 1. Leader (story-architect): 必须用推理模型（如果有）
    roleModelMap["story-architect"] =
      reasoningModels.length > 0 ? reasoningModels[0] : models[0];

    // 2. 其他角色：从剩余模型中轮换选择，尽量多元化
    const memberRoles = [
      "bible-keeper",
      "writer",
      "consistency-checker",
      "editor",
    ];
    const availableForMembers = models.filter(
      (m) => m.modelId !== roleModelMap["story-architect"].modelId,
    );

    // 如果过滤后没有剩余模型，就用全部模型
    const poolForMembers =
      availableForMembers.length > 0 ? availableForMembers : models;

    // 按照提供商分组，优先跨提供商分配（更多元化）
    const byProvider = new Map<string, ModelConfig[]>();
    for (const m of poolForMembers) {
      if (!byProvider.has(m.provider)) {
        byProvider.set(m.provider, []);
      }
      byProvider.get(m.provider)!.push(m);
    }

    // 轮换分配模型给成员角色
    const providers = Array.from(byProvider.keys());
    let providerIndex = 0;
    let modelIndexInProvider = 0;

    for (const roleId of memberRoles) {
      if (providers.length === 0) {
        // 没有模型可用
        roleModelMap[roleId] = poolForMembers[0] || models[0];
      } else if (providers.length === 1) {
        // 只有一个提供商，轮换该提供商的模型
        const providerModels = byProvider.get(providers[0])!;
        roleModelMap[roleId] =
          providerModels[modelIndexInProvider % providerModels.length];
        modelIndexInProvider++;
      } else {
        // 多个提供商，跨提供商轮换
        const currentProvider = providers[providerIndex % providers.length];
        const providerModels = byProvider.get(currentProvider)!;
        roleModelMap[roleId] = providerModels[0]; // 每个提供商取第一个模型
        providerIndex++;
      }
    }

    // 记录分配结果
    this.logger.log("Model assignment (diversified):");
    for (const [roleId, model] of Object.entries(roleModelMap)) {
      this.logger.log(
        `  - ${roleId}: ${model.displayName} (${model.provider}, reasoning=${model.isReasoning})`,
      );
    }

    // 统计使用的不同模型数量
    const uniqueModels = new Set(
      Object.values(roleModelMap).map((m) => m.modelId),
    );
    this.logger.log(
      `Using ${uniqueModels.size} different models for ${Object.keys(roleModelMap).length} roles`,
    );

    return Object.entries(roleModelMap).map(([roleId, model]) => ({
      roleId,
      modelId: model.modelId,
      isActive: true,
    }));
  }

  /**
   * 获取活跃的角色列表
   * 只返回有可用模型的角色
   */
  async getActiveRoles(): Promise<string[]> {
    const assignments = await this.assignModelsToRoles();
    return assignments.filter((a) => a.isActive).map((a) => a.roleId);
  }

  /**
   * 获取角色对应的模型 ID
   */
  async getModelForRole(roleId: string): Promise<string | null> {
    const assignments = await this.assignModelsToRoles();
    const assignment = assignments.find((a) => a.roleId === roleId);
    return assignment?.isActive ? assignment.modelId : null;
  }

  /**
   * 获取或创建 Writing Team（延迟初始化）
   */
  getWritingTeam(): ITeam {
    if (!this.writingTeam) {
      this.writingTeam = this.teamFacade.teamFactory!.createFromId(
        this.WRITING_TEAM_ID,
      );
      this.logger.log("Writing Team initialized on first use");
    }
    return this.writingTeam;
  }

  /**
   * 注册 Writing 角色
   */
  private registerWritingRoles(): void {
    // Story Architect (Leader) - use registerFromConfig to create proper IRole with generateSystemPrompt
    this.roleRegistry.registerFromConfig({
      id: "story-architect",
      name: "Story Architect",
      description: "故事架构师，负责整体规划和协调",
      type: "leader",
      coreSkills: ["story-planning", "outline-generation"],
      optionalSkills: [],
      coreTools: ["text-generation"],
      optionalTools: ["task-delegation"],
      responsibilities: ["整体规划", "任务分配", "质量审核"],
      limitations: [],
      defaultWorkStyle: {
        thinkingDepth: "deep",
        outputStyle: "detailed",
        collaborationStyle: "directive",
        riskTolerance: "conservative",
      },
      systemPromptTemplate: this.storyArchitect.description,
    });

    // Bible Keeper
    this.roleRegistry.registerFromConfig({
      id: "bible-keeper",
      name: "Bible Keeper",
      description: "Story Bible 守护者，维护设定一致性",
      type: "member",
      coreSkills: ["setting-validation", "fact-extraction"],
      optionalSkills: [],
      coreTools: ["rag-search"],
      optionalTools: ["knowledge-graph"],
      responsibilities: ["设定查询", "一致性验证", "事实提取"],
      limitations: [],
      defaultWorkStyle: {
        thinkingDepth: "standard",
        outputStyle: "balanced",
        collaborationStyle: "cooperative",
        riskTolerance: "moderate",
      },
      systemPromptTemplate: this.bibleKeeper.description,
    });

    // Writer
    this.roleRegistry.registerFromConfig({
      id: "writer",
      name: "Writer",
      description: "专业写作 Agent，执行章节创作",
      type: "member",
      coreSkills: ["creative-writing", "dialogue-writing"],
      optionalSkills: [],
      coreTools: ["text-generation"],
      optionalTools: [],
      responsibilities: ["章节写作", "对话创作", "场景描写"],
      limitations: [],
      defaultWorkStyle: {
        thinkingDepth: "standard",
        outputStyle: "detailed",
        collaborationStyle: "cooperative",
        riskTolerance: "moderate",
      },
      systemPromptTemplate: this.writer.description,
    });

    // Consistency Checker
    this.roleRegistry.registerFromConfig({
      id: "consistency-checker",
      name: "Consistency Checker",
      description: "一致性检查专家，确保内容与 Story Bible 一致",
      type: "member",
      coreSkills: ["consistency-check", "fact-verification"],
      optionalSkills: [],
      coreTools: ["data-analysis"],
      optionalTools: [],
      responsibilities: ["一致性检查", "事实验证", "问题报告"],
      limitations: [],
      defaultWorkStyle: {
        thinkingDepth: "deep",
        outputStyle: "balanced",
        collaborationStyle: "cooperative",
        riskTolerance: "conservative",
      },
      systemPromptTemplate: this.consistencyChecker.description,
    });

    // Editor
    this.roleRegistry.registerFromConfig({
      id: "editor",
      name: "Editor",
      description: "专业编辑，负责修订和润色",
      type: "member",
      coreSkills: ["editing", "polishing"],
      optionalSkills: ["style-unification"],
      coreTools: ["text-generation"],
      optionalTools: [],
      responsibilities: ["文字润色", "问题修复", "风格统一"],
      limitations: [],
      defaultWorkStyle: {
        thinkingDepth: "standard",
        outputStyle: "detailed",
        collaborationStyle: "cooperative",
        riskTolerance: "moderate",
      },
      systemPromptTemplate: this.editor.description,
    });

    this.logger.log("Registered 5 Writing roles");
  }

  /**
   * 注册 Writing Team 配置
   */
  private registerWritingTeamConfig(): void {
    this.teamRegistry.registerConfig({
      id: this.WRITING_TEAM_ID,
      name: "AI Writing Team",
      description: "专业的 AI 写作团队，由 5 个专职 Agent 组成",
      type: "predefined",
      leaderRoleId: "story-architect",
      memberRoles: [
        { roleId: "bible-keeper", minCount: 1, maxCount: 1, required: true },
        { roleId: "writer", minCount: 1, maxCount: 3, required: true }, // 支持并行
        {
          roleId: "consistency-checker",
          minCount: 1,
          maxCount: 2,
          required: true,
        },
        { roleId: "editor", minCount: 1, maxCount: 1, required: true },
      ],
      workflow: {
        id: "writing-workflow",
        name: "写作工作流",
        type: "sequential",
        steps: [
          {
            id: "plan",
            name: "规划",
            description: "分析任务，生成执行计划",
            type: "task",
            executorRoles: ["story-architect"],
            dependsOn: [],
          },
          {
            id: "context-injection",
            name: "上下文注入",
            description: "从 Story Bible 获取相关设定",
            type: "task",
            executorRoles: ["bible-keeper"],
            dependsOn: ["plan"],
          },
          {
            id: "write",
            name: "写作",
            description: "执行章节写作",
            type: "task",
            executorRoles: ["writer"],
            dependsOn: ["context-injection"],
          },
          {
            id: "check",
            name: "一致性检查",
            description: "检查内容与 Story Bible 的一致性",
            type: "task",
            executorRoles: ["consistency-checker"],
            dependsOn: ["write"],
          },
          {
            id: "edit",
            name: "编辑",
            description: "修复问题并润色",
            type: "task",
            executorRoles: ["editor"],
            dependsOn: ["check"],
          },
          {
            id: "review",
            name: "最终审核",
            description: "Leader 审核最终输出",
            type: "review",
            executorRoles: ["story-architect"],
            dependsOn: ["edit"],
          },
        ],
      },
      availableSkills: ["creative-writing", "consistency-check"],
      availableTools: ["text-generation", "rag-search"],
      constraintProfile: {
        cost: {
          budget: 1000,
          modelPreference: "balanced",
          allowOverBudget: false,
          warningThreshold: 0.8,
        },
        quality: {
          depth: "comprehensive",
          accuracy: "prefer_evidence",
          reviewRequired: true,
          minReviewScore: 7,
          maxReworks: 2,
        },
        efficiency: {
          maxDuration: 3600000, // 1 hour
          priority: "normal",
          allowParallel: true,
          maxParallelism: 3,
        },
      },
      deliverableTypes: ["markdown", "chapter-content"],
      metadata: {
        tags: ["writing", "creative", "fiction"],
        category: "content-creation",
      },
    });

    this.logger.log("Registered Writing Team configuration");
  }
}
