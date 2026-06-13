/**
 * AI Writing Context Package - Story Bible 扩展的 MissionContextPackage
 *
 * 继承 AI Engine 的 MissionContextPackage，添加小说创作特有的字段。
 * 通过 extensions 字段扩展，确保与通用协议兼容。
 *
 * 架构层级：
 * - AI Engine: 提供领域无关的 MissionContextPackage
 * - AI Writing: 扩展 Story Bible 特有的上下文
 */

import type {
  MissionContextPackage,
  CoreEntity,
  HardConstraint,
  EstablishedFact,
} from "@/modules/ai-harness/facade";

// ==================== Story Bible 扩展类型 ====================

/**
 * 角色状态快照 - 用于追踪角色在特定时间点的状态
 */
export interface CharacterStateSnapshot {
  /** 快照时间（故事内时间） */
  storyTime: string;
  /** 来源章节ID */
  sourceChapterId?: string;
  /** 状态描述 */
  state: {
    location?: string;
    condition?: string; // 健康状态
    mood?: string;
    relationships?: Record<string, string>; // 与其他角色的关系状态
    inventory?: string[]; // 携带物品
    secrets?: string[]; // 已知秘密
    goals?: string[]; // 当前目标
  };
}

/**
 * 物理识别特征 - 用于一致性校验的关键识别点
 */
export interface PhysicalIdentifier {
  /** 特征位置 */
  location: string;
  /** 特征描述 */
  description: string;
  /** 特征类型 */
  type: "birthmark" | "scar" | "tattoo" | "mole" | "other";
  /** 特征颜色（如适用） */
  color?: string;
  /** 特征大小（如适用） */
  size?: string;
  /** 特征来源/原因（如伤疤的来源） */
  origin?: string;
}

/**
 * 角色状态转变记录 - 追踪身份/立场的重大变化
 */
export interface CharacterStateTransition {
  /** 转变前状态 */
  fromState: string;
  /** 转变后状态 */
  toState: string;
  /** 转变类型 */
  transitionType:
    | "identity_change"
    | "alliance_shift"
    | "status_change"
    | "revelation"
    | "death"
    | "resurrection";
  /** 发生章节ID */
  chapterId: string;
  /** 故事内时间 */
  storyTime: string;
  /** 转变理由/原因 */
  justification: string;
  /** 是否在正文中显式交代 */
  isExplicitInText: boolean;
}

/**
 * 角色档案 - 继承 CoreEntity 并扩展
 */
export interface WritingCharacterEntity extends CoreEntity {
  /** 类型固定为 "character" */
  type: "character";
  /** 角色定位 */
  role: "protagonist" | "antagonist" | "supporting" | "minor";
  /** 别名列表 */
  aliases?: string[];
  /** 外貌描述（结构化） */
  appearance?: {
    gender?: string;
    age?: string;
    height?: string;
    build?: string;
    hair?: string;
    eyes?: string;
    distinguishingFeatures?: string[];
    clothing?: string;
    /** 物理识别特征（胎记、伤疤、痣等） - 用于一致性校验 */
    physicalIdentifiers?: PhysicalIdentifier[];
  };
  /** 性格特征（结构化） */
  personality?: {
    traits?: string[];
    strengths?: string[];
    weaknesses?: string[];
    fears?: string[];
    desires?: string[];
    speechPattern?: string;
    /** 核心动机层级（按优先级排序） */
    motivationHierarchy?: string[];
    /** 内心冲突 */
    internalConflicts?: string[];
  };
  /** 背景故事 */
  background?: string;
  /** 能力/技能 */
  abilities?: string[];
  /** 当前状态 */
  currentState?: CharacterStateSnapshot;
  /** 状态时间线 */
  stateTimeline?: CharacterStateSnapshot[];
  /** 状态转变记录 - 追踪身份/立场的重大变化 */
  stateTransitions?: CharacterStateTransition[];
  /** 已知秘密（角色知道的秘密） */
  knownSecrets?: string[];
  /** 隐藏秘密（只有作者知道，角色不知道） */
  hiddenSecrets?: string[];
}

/**
 * 世界设定
 */
export interface WorldSettingEntity {
  /** 分类：地理、历史、魔法体系、科技、政治等 */
  category: string;
  /** 名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 规则/限制 */
  rules?: string[];
  /** 相关引用 */
  references?: {
    relatedSettings?: string[];
    relatedCharacters?: string[];
  };
}

/**
 * 术语定义
 */
export interface TerminologyEntity {
  /** 术语 */
  term: string;
  /** 定义 */
  definition: string;
  /** 分类：功法、地名、物品、称谓等 */
  category: string;
  /** 同义词/变体（用于一致性检查） */
  variants?: string[];
  /** 使用说明 */
  usage?: string;
}

/**
 * 时间线事件
 */
export interface TimelineEventEntity {
  /** 事件名称 */
  eventName: string;
  /** 描述 */
  description: string;
  /** 故事内时间 */
  storyTime: string;
  /** 重要程度 1-5 */
  importance: number;
  /** 涉及角色ID */
  involvedCharacterIds?: string[];
  /** 相关章节ID */
  relatedChapterId?: string;
  /** 由哪个事件引起（因果链上游） */
  causedByEventId?: string;
  /** 导致了哪些事件（因果链下游） */
  causesEventIds?: string[];
  /** 事件类型：plot_point（剧情点）、character_change（角色变化）、world_event（世界事件）、conflict（冲突）、resolution（解决） */
  eventType?:
    | "plot_point"
    | "character_change"
    | "world_event"
    | "conflict"
    | "resolution";
  /** 是否关键剧情点 */
  isKeyEvent?: boolean;
}

/**
 * 势力/组织
 */
export interface FactionEntity {
  /** 名称 */
  name: string;
  /** 类型：国家、门派、公司、家族等 */
  type: string;
  /** 描述 */
  description?: string;
  /** 层级结构 */
  hierarchy?: {
    levels: Array<{
      name: string;
      description?: string;
    }>;
  };
  /** 势力范围 */
  territory?: string;
  /** 成员角色ID */
  memberIds?: string[];
}

// ==================== Story Bible 扩展包 ====================

/**
 * Story Bible 扩展 - 作为 MissionContextPackage.extensions 的一部分
 */
export interface StoryBibleExtensions {
  /** 项目ID（用于质量评分、表达记忆等服务） */
  projectId: string;
  /** Story Bible ID */
  bibleId: string;
  /** Story Bible 版本 */
  bibleVersion: number;
  /** 快照时间 */
  snapshotAt: string;

  /** 故事前提 */
  premise?: string;
  /** 主题 */
  theme?: string;
  /** 基调 */
  tone?: string;
  /** 世界类型 */
  worldType?: string;

  /** 角色档案（结构化） */
  characters: WritingCharacterEntity[];

  /** 世界设定 */
  worldSettings: WorldSettingEntity[];

  /** 术语表（扩展 glossary） */
  terminologies: TerminologyEntity[];

  /** 时间线事件 */
  timelineEvents: TimelineEventEntity[];

  /** 势力/组织 */
  factions: FactionEntity[];

  /** 写作风格指南 */
  writingStyle?: {
    pov?: string; // 视角：第一人称、第三人称限定、全知等
    tense?: string; // 时态：过去式、现在式
    vocabulary?: "simple" | "intermediate" | "advanced";
    sentenceLength?: "short" | "medium" | "long";
    dialogueStyle?: string;
    descriptionStyle?: string;
  };

  /** 风格预设 ID（对应 writing-style-presets.ts 中的预设） */
  stylePresetId?: string;

  /** 目标受众 */
  targetAudience?: string;
}

/**
 * 章节写作上下文 - 传递给 Writer Agent 的完整上下文
 */
export interface ChapterWritingContext {
  /** 章节信息 */
  chapter: {
    id: string;
    chapterNumber: number;
    title: string;
    outline?: string;
    volumeId: string;
    volumeTitle?: string;
  };

  /** 前文摘要（最近N章） */
  previousContext: Array<{
    chapterNumber: number;
    title: string;
    summary: string;
  }>;

  /** 本章涉及的角色（从大纲提取） */
  involvedCharacters: WritingCharacterEntity[];

  /** 本章涉及的场景设定 */
  relevantWorldSettings: WorldSettingEntity[];

  /** 相关术语 */
  relevantTerminology: TerminologyEntity[];

  /** 时间线上下文 */
  timelineContext: TimelineEventEntity[];

  /** 写作指令 */
  writingInstructions?: {
    targetWordCount?: number;
    additionalInstructions?: string;
    focusPoints?: string[];
    avoidPoints?: string[];
  };
}

// ==================== Writing Context Package ====================

/**
 * AI Writing Context Package
 *
 * 完全兼容 MissionContextPackage，通过 extensions 注入 Story Bible 数据
 */
export interface WritingContextPackage extends MissionContextPackage {
  /** 扩展字段：Story Bible */
  extensions: {
    storyBible: StoryBibleExtensions;
    /** 当前章节上下文 */
    chapterContext?: ChapterWritingContext;
  };
}

// ==================== 工厂函数 ====================

/**
 * 从 Story Bible 数据创建 WritingContextPackage
 */
export function createWritingContextPackage(
  leaderId: string,
  projectName: string,
  storyBible: StoryBibleExtensions,
  chapterContext?: ChapterWritingContext,
): WritingContextPackage {
  // 将角色转换为 CoreEntity
  const entities: CoreEntity[] = storyBible.characters.map((char) => ({
    name: char.name,
    type: "character",
    definition: char.definition,
    attributes: {
      role: char.role,
      aliases: char.aliases?.join(", ") || "",
      abilities: char.abilities?.join(", ") || "",
    },
    relations: undefined, // Relations are managed separately in Story Bible
  }));

  // 添加势力作为实体
  storyBible.factions.forEach((faction) => {
    entities.push({
      name: faction.name,
      type: "faction",
      definition: faction.description || `${faction.type}: ${faction.name}`,
      attributes: {
        factionType: faction.type,
        territory: faction.territory || "",
      },
    });
  });

  // 构建硬性约束
  const hardConstraints: HardConstraint[] = [
    {
      id: "char-appearance",
      rule: "角色外貌描述必须与 Story Bible 中的定义一致",
      severity: "MUST",
    },
    {
      id: "char-personality",
      rule: "角色性格和行为必须符合 Story Bible 中的设定",
      severity: "MUST",
    },
    {
      id: "timeline-consistency",
      rule: "事件时间线必须保持一致，不得出现时间矛盾",
      severity: "MUST",
    },
    {
      id: "world-rules",
      rule: "世界观规则不可违反",
      severity: "MUST",
    },
    {
      id: "terminology-consistency",
      rule: "专有名词使用必须一致，优先使用术语表中的标准名称",
      severity: "SHOULD",
    },
  ];

  // 构建术语表
  const glossary: Record<string, string> = {};
  storyBible.terminologies.forEach((t) => {
    glossary[t.term] = t.definition;
    t.variants?.forEach((v) => {
      glossary[v] = `→ ${t.term}: ${t.definition}`;
    });
  });

  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    generatedBy: leaderId,
    understanding: {
      summary: `长篇小说《${projectName}》的创作任务`,
      scope: "基于 Story Bible 设定进行章节创作",
      expectedOutput: "符合设定的章节内容",
    },
    hardConstraints,
    entities,
    prohibitions: [
      {
        description: "禁止违反已确立的角色设定",
        reason: "确保角色一致性",
      },
      {
        description: "禁止引入与世界观冲突的元素",
        reason: "确保世界观一致性",
      },
    ],
    qualityStandards: [
      {
        dimension: "一致性",
        requirement: "所有描述必须与 Story Bible 保持一致",
      },
      {
        dimension: "连贯性",
        requirement: "与前文剧情保持连贯",
      },
      {
        dimension: "风格",
        requirement: "保持统一的写作风格",
      },
    ],
    glossary,
    extensions: {
      storyBible,
      chapterContext,
    },
    establishedFacts: [],
  };
}

/**
 * 从章节内容提取 EstablishedFact
 */
export function extractEstablishedFacts(
  taskId: string,
  taskTitle: string,
  _chapterContent: string,
  involvedCharacters: string[],
): EstablishedFact[] {
  // 这是一个简化实现 - 实际应该使用 LLM 提取
  const facts: EstablishedFact[] = [];

  // 标记章节完成作为序列点
  facts.push({
    id: `ef_${Date.now()}_seq`,
    sourceTaskId: taskId,
    sourceTaskTitle: taskTitle,
    establishedAt: new Date().toISOString(),
    statement: `章节《${taskTitle}》已完成`,
    category: "sequence_point",
    relatedEntities: involvedCharacters,
    importance: "medium",
  });

  return facts;
}
