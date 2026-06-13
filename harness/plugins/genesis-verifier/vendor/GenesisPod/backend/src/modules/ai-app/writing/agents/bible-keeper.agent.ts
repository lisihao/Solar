/**
 * Bible Keeper Agent - Story Bible 守护者
 *
 * 负责维护 Story Bible 的一致性：
 * - 设定管理：维护角色、世界观、时间线等所有设定
 * - 查询服务：响应其他 Agent 的设定查询请求
 * - 变更控制：审核设定变更，防止冲突
 * - 状态追踪：追踪角色状态随剧情的变化
 */

import { Injectable } from "@nestjs/common";
import { BaseAgent } from "@/modules/ai-harness/facade";
import { type TaskProfile } from "@/modules/ai-harness/facade";
import {
  type ExecutionMode,
  BUILTIN_TOOLS,
  type AgentContext,
  type AgentCapability,
} from "@/modules/ai-harness/facade";
import {
  WritingContextPackage,
  WritingCharacterEntity,
  CharacterStateSnapshot,
  TimelineEventEntity,
} from "../interfaces/writing-context.interface";

// ==================== 输入输出类型 ====================

export interface BibleKeeperInput {
  /** 操作类型 */
  operation:
    | "query_character" // 查询角色设定
    | "query_world" // 查询世界设定
    | "query_timeline" // 查询时间线
    | "query_terminology" // 查询术语
    | "update_character_state" // 更新角色状态
    | "add_timeline_event" // 添加时间线事件
    | "validate_change" // 验证设定变更
    | "get_snapshot"; // 获取完整快照

  /** 项目ID */
  projectId: string;

  /** 当前 Context Package */
  contextPackage: WritingContextPackage;

  /** 操作参数 */
  params: {
    /** 查询：角色名或ID */
    characterName?: string;
    characterId?: string;
    /** 查询：世界设定分类 */
    worldCategory?: string;
    /** 查询：时间范围 */
    timeRange?: { start?: string; end?: string };
    /** 查询：术语 */
    term?: string;
    /** 更新：新的角色状态 */
    newState?: CharacterStateSnapshot;
    /** 更新：来源章节ID */
    sourceChapterId?: string;
    /** 添加：新时间线事件 */
    newEvent?: TimelineEventEntity;
    /** 验证：待验证的变更 */
    proposedChange?: {
      type: "character" | "world" | "timeline" | "terminology";
      data: Record<string, unknown>;
    };
  };
}

export interface BibleKeeperOutput {
  /** 操作类型 */
  operation: string;
  /** 是否成功 */
  success: boolean;
  /** 查询结果 */
  result: {
    /** 角色查询结果 */
    character?: WritingCharacterEntity;
    characters?: WritingCharacterEntity[];
    /** 世界设定查询结果 */
    worldSettings?: Array<{
      category: string;
      name: string;
      description: string;
      rules?: string[];
    }>;
    /** 时间线查询结果 */
    timelineEvents?: TimelineEventEntity[];
    /** 术语查询结果 */
    terminology?: {
      term: string;
      definition: string;
      variants?: string[];
    };
    /** 完整快照 */
    snapshot?: WritingContextPackage["extensions"]["storyBible"];
    /** 验证结果 */
    validation?: {
      valid: boolean;
      conflicts: Array<{
        type: string;
        description: string;
        existingValue: string;
        proposedValue: string;
      }>;
      suggestions: string[];
    };
  };
  /** 警告信息 */
  warnings?: string[];
}

// ==================== Agent 实现 ====================

@Injectable()
export class BibleKeeperAgent extends BaseAgent<
  BibleKeeperInput,
  BibleKeeperOutput
> {
  readonly id = "bible-keeper";
  readonly name = "Bible Keeper";
  readonly description =
    "Story Bible 守护者 - 维护设定一致性，提供查询服务，审核变更";

  readonly supportedModes: ExecutionMode[] = ["reactive", "hybrid"];

  readonly capabilities: AgentCapability[] = [
    {
      id: "setting-management",
      name: "Setting Management",
      description: "维护角色、世界观、时间线等所有设定",
      category: "data-management",
    },
    {
      id: "query-service",
      name: "Query Service",
      description: "响应其他 Agent 的设定查询请求",
      category: "retrieval",
    },
    {
      id: "change-control",
      name: "Change Control",
      description: "审核设定变更，防止冲突",
      category: "validation",
    },
    {
      id: "state-tracking",
      name: "State Tracking",
      description: "追踪角色状态随剧情的变化",
      category: "tracking",
    },
  ];

  readonly requiredTools = [
    BUILTIN_TOOLS.RAG_SEARCH,
    BUILTIN_TOOLS.KNOWLEDGE_GRAPH,
    BUILTIN_TOOLS.SHORT_TERM_MEMORY,
    BUILTIN_TOOLS.LONG_TERM_MEMORY,
  ];

  /**
   * 核心执行逻辑
   */
  protected async doExecute(
    input: BibleKeeperInput,
    _context: AgentContext,
  ): Promise<BibleKeeperOutput> {
    this.logger.log(
      `[BibleKeeper] Executing operation: ${input.operation} for project ${input.projectId}`,
    );

    switch (input.operation) {
      case "query_character":
        return this.queryCharacter(input);
      case "query_world":
        return this.queryWorld(input);
      case "query_timeline":
        return this.queryTimeline(input);
      case "query_terminology":
        return this.queryTerminology(input);
      case "update_character_state":
        return this.updateCharacterState(input);
      case "add_timeline_event":
        return this.addTimelineEvent(input);
      case "validate_change":
        return this.validateChange(input, _context);
      case "get_snapshot":
        return this.getSnapshot(input);
      default:
        throw new Error(`Unknown operation: ${input.operation}`);
    }
  }

  /**
   * 查询角色设定
   */
  private async queryCharacter(
    input: BibleKeeperInput,
  ): Promise<BibleKeeperOutput> {
    const { contextPackage, params } = input;
    const storyBible = contextPackage.extensions.storyBible;

    let characters: WritingCharacterEntity[] = [];

    if (params.characterId) {
      const char = storyBible.characters.find(
        (c) => c.name === params.characterId,
      );
      if (char) characters = [char];
    } else if (params.characterName) {
      // 模糊匹配角色名和别名
      characters = storyBible.characters.filter(
        (c) =>
          c.name.includes(params.characterName!) ||
          c.aliases?.some((a) => a.includes(params.characterName!)),
      );
    } else {
      // 返回所有角色
      characters = storyBible.characters;
    }

    return {
      operation: "query_character",
      success: true,
      result: {
        characters,
        character: characters[0],
      },
    };
  }

  /**
   * 查询世界设定
   */
  private async queryWorld(
    input: BibleKeeperInput,
  ): Promise<BibleKeeperOutput> {
    const { contextPackage, params } = input;
    const storyBible = contextPackage.extensions.storyBible;

    let settings = storyBible.worldSettings;

    if (params.worldCategory) {
      settings = settings.filter((s) =>
        s.category.toLowerCase().includes(params.worldCategory!.toLowerCase()),
      );
    }

    return {
      operation: "query_world",
      success: true,
      result: {
        worldSettings: settings,
      },
    };
  }

  /**
   * 查询时间线
   */
  private async queryTimeline(
    input: BibleKeeperInput,
  ): Promise<BibleKeeperOutput> {
    const { contextPackage, params } = input;
    const storyBible = contextPackage.extensions.storyBible;

    let events = storyBible.timelineEvents;

    if (params.timeRange) {
      events = events.filter((e) => {
        if (params.timeRange!.start && e.storyTime < params.timeRange!.start) {
          return false;
        }
        if (params.timeRange!.end && e.storyTime > params.timeRange!.end) {
          return false;
        }
        return true;
      });
    }

    // 按时间排序
    events.sort((a, b) => a.storyTime.localeCompare(b.storyTime));

    return {
      operation: "query_timeline",
      success: true,
      result: {
        timelineEvents: events,
      },
    };
  }

  /**
   * 查询术语
   */
  private async queryTerminology(
    input: BibleKeeperInput,
  ): Promise<BibleKeeperOutput> {
    const { contextPackage, params } = input;
    const storyBible = contextPackage.extensions.storyBible;

    if (!params.term) {
      return {
        operation: "query_terminology",
        success: false,
        result: {},
        warnings: ["未提供查询术语"],
      };
    }

    const found = storyBible.terminologies.find(
      (t) => t.term === params.term || t.variants?.includes(params.term!),
    );

    if (!found) {
      return {
        operation: "query_terminology",
        success: true,
        result: {},
        warnings: [`未找到术语: ${params.term}`],
      };
    }

    return {
      operation: "query_terminology",
      success: true,
      result: {
        terminology: {
          term: found.term,
          definition: found.definition,
          variants: found.variants,
        },
      },
    };
  }

  /**
   * 更新角色状态
   */
  private async updateCharacterState(
    input: BibleKeeperInput,
  ): Promise<BibleKeeperOutput> {
    const { params } = input;

    if (!params.characterName || !params.newState) {
      return {
        operation: "update_character_state",
        success: false,
        result: {},
        warnings: ["缺少角色名或新状态"],
      };
    }

    // 注意：这里只返回更新建议，实际更新需要通过服务层完成
    return {
      operation: "update_character_state",
      success: true,
      result: {
        validation: {
          valid: true,
          conflicts: [],
          suggestions: [
            `建议更新角色 ${params.characterName} 的状态`,
            `来源章节: ${params.sourceChapterId || "未指定"}`,
          ],
        },
      },
    };
  }

  /**
   * 添加时间线事件
   */
  private async addTimelineEvent(
    input: BibleKeeperInput,
  ): Promise<BibleKeeperOutput> {
    const { params } = input;

    if (!params.newEvent) {
      return {
        operation: "add_timeline_event",
        success: false,
        result: {},
        warnings: ["缺少新事件数据"],
      };
    }

    // 注意：这里只返回添加建议，实际添加需要通过服务层完成
    return {
      operation: "add_timeline_event",
      success: true,
      result: {
        validation: {
          valid: true,
          conflicts: [],
          suggestions: [`建议添加时间线事件: ${params.newEvent.eventName}`],
        },
      },
    };
  }

  /**
   * 验证设定变更
   */
  private async validateChange(
    input: BibleKeeperInput,
    context: AgentContext,
  ): Promise<BibleKeeperOutput> {
    const { contextPackage, params } = input;

    if (!params.proposedChange) {
      return {
        operation: "validate_change",
        success: false,
        result: {},
        warnings: ["缺少待验证的变更"],
      };
    }

    const storyBible = contextPackage.extensions.storyBible;

    // 使用 LLM 进行智能验证
    const _systemPrompt = `你是 Story Bible 守护者，负责验证设定变更的一致性。

## 验证原则
1. 新设定不能与已有设定矛盾
2. 角色属性变更需要有合理的剧情支撑
3. 世界观规则不能随意改变
4. 术语使用需要保持一致

## 现有设定
${JSON.stringify(storyBible, null, 2).slice(0, 5000)}`;

    void _systemPrompt; // Used via buildMessages

    const userPrompt = `请验证以下设定变更是否与现有设定冲突：

变更类型：${params.proposedChange.type}
变更内容：${JSON.stringify(params.proposedChange.data, null, 2)}

请以 JSON 格式输出验证结果：
{
  "valid": true/false,
  "conflicts": [{ "type": "类型", "description": "描述", "existingValue": "现有值", "proposedValue": "新值" }],
  "suggestions": ["建议"]
}`;

    // 使用 TaskProfile 语义化描述任务特征
    const taskProfile: TaskProfile = {
      creativity: "low", // 设定验证需要准确性 (原 temperature: 0.3)
      outputLength: "short", // 验证结果相对简短
    };

    const response = await this.callLLM(
      this.buildMessages(userPrompt, { ...context, memory: undefined }),
      {
        taskProfile,
      },
    );

    const validation = this.parseJsonResponse<
      BibleKeeperOutput["result"]["validation"]
    >(response.content || "", {
      valid: false,
      conflicts: [],
      suggestions: ["无法完成验证"],
    });

    return {
      operation: "validate_change",
      success: true,
      result: { validation },
    };
  }

  /**
   * 获取完整快照
   */
  private async getSnapshot(
    input: BibleKeeperInput,
  ): Promise<BibleKeeperOutput> {
    const { contextPackage } = input;

    return {
      operation: "get_snapshot",
      success: true,
      result: {
        snapshot: contextPackage.extensions.storyBible,
      },
    };
  }
}
