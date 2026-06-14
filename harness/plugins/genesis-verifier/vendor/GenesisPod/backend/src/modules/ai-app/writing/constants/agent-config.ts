/**
 * AI Writing Agent Configuration - Agent 统一配置
 *
 * 这是 AI Writing 模块 Agent 的统一配置文件，作为 Single Source of Truth。
 * 前端通过 API 获取此配置，确保前后端一致性。
 */

// ==================== Agent 角色类型 ====================

export type AgentRole =
  | "leader" // 领导者/协调者
  | "keeper" // 守护者/数据管理
  | "executor" // 执行者/内容生成
  | "validator" // 验证者/质量检查
  | "finisher"; // 完成者/润色优化

// ==================== Agent 配置接口 ====================

export interface WritingAgentConfig {
  /** Agent 唯一标识（后端使用） */
  id: string;
  /** 中文名称 */
  nameCn: string;
  /** 英文名称 */
  nameEn: string;
  /** 简短描述（中文） */
  descCn: string;
  /** 简短描述（英文） */
  descEn: string;
  /** 角色类型 */
  role: AgentRole;
  /** 显示图标 */
  icon: string;
  /** 主题色（Tailwind CSS 类名） */
  color: string;
  /** 渐变色（Tailwind CSS 类名） */
  gradient: string;
  /** 是否支持多实例（如 Writer 可以有多个实例） */
  supportsMultiInstance: boolean;
  /** 最大实例数（仅当 supportsMultiInstance 为 true 时有效） */
  maxInstances?: number;
  /** Agent 能力列表 */
  capabilities: string[];
  /** Agent 使用的工具列表 */
  tools: string[];
  /** 详细描述 */
  detailedDescription: string;
}

// ==================== Agent 注册表 ====================

/**
 * Writing Agent 注册表
 *
 * 所有 AI Writing 模块使用的 Agent 都在这里定义。
 */
export const WRITING_AGENT_REGISTRY: Record<string, WritingAgentConfig> = {
  // ===== 故事架构师（Leader） =====
  "story-architect": {
    id: "story-architect",
    nameCn: "故事架构师",
    nameEn: "Story Architect",
    descCn: "统筹规划",
    descEn: "Planning & Coordination",
    role: "leader",
    icon: "👑",
    color: "bg-purple-500",
    gradient: "from-purple-400 to-purple-600",
    supportsMultiInstance: false,
    capabilities: [
      "story_planning",
      "chapter_decomposition",
      "task_assignment",
      "progress_tracking",
      "conflict_resolution",
    ],
    tools: ["outline_generator", "storyline_tracker", "conflict_designer"],
    detailedDescription:
      "负责统筹整体故事结构，规划章节大纲，确保叙事逻辑连贯。擅长把握故事节奏和情节转折，协调团队成员工作。",
  },

  // ===== 设定守护者（Keeper） =====
  "bible-keeper": {
    id: "bible-keeper",
    nameCn: "设定守护者",
    nameEn: "Bible Keeper",
    descCn: "世界观管理",
    descEn: "World Building",
    role: "keeper",
    icon: "📚",
    color: "bg-emerald-500",
    gradient: "from-emerald-400 to-emerald-600",
    supportsMultiInstance: false,
    capabilities: [
      "world_building",
      "character_management",
      "timeline_maintenance",
      "consistency_validation",
      "terminology_control",
    ],
    tools: ["character_database", "world_graph", "timeline_editor"],
    detailedDescription:
      "维护故事世界观的一致性，管理角色设定、地点背景和时间线，确保细节不出错。是 Story Bible 的守护者。",
  },

  // ===== 作家（Executor，支持多实例） =====
  writer: {
    id: "writer",
    nameCn: "作家",
    nameEn: "Writer",
    descCn: "内容创作",
    descEn: "Content Creation",
    role: "executor",
    icon: "✍️",
    color: "bg-orange-500",
    gradient: "from-orange-400 to-orange-600",
    supportsMultiInstance: true,
    maxInstances: 5,
    capabilities: [
      "content_generation",
      "dialogue_writing",
      "scene_rendering",
      "emotion_expression",
      "style_adaptation",
    ],
    tools: ["text_generator", "style_template", "vocabulary_library"],
    detailedDescription:
      "专注于创作生动的故事内容，擅长细腻的情感描写、人物对话、动作场面和环境氛围营造。",
  },

  // ===== 一致性检查员（Validator） =====
  "consistency-checker": {
    id: "consistency-checker",
    nameCn: "一致性检查员",
    nameEn: "Consistency Checker",
    descCn: "逻辑校验",
    descEn: "Logic Validation",
    role: "validator",
    icon: "🔍",
    color: "bg-teal-500",
    gradient: "from-teal-400 to-teal-600",
    supportsMultiInstance: false,
    capabilities: [
      "logic_validation",
      "setting_comparison",
      "timeline_check",
      "character_behavior_analysis",
      "fact_extraction",
    ],
    tools: ["consistency_checker", "setting_comparator", "issue_marker"],
    detailedDescription:
      "负责检查内容的逻辑一致性和设定准确性，发现并标记问题。确保角色行为符合设定，时间线无矛盾。",
  },

  // ===== 编辑（Finisher） =====
  editor: {
    id: "editor",
    nameCn: "润色编辑",
    nameEn: "Editor",
    descCn: "文字打磨",
    descEn: "Text Polishing",
    role: "finisher",
    icon: "🎨",
    color: "bg-pink-500",
    gradient: "from-pink-400 to-pink-600",
    supportsMultiInstance: false,
    capabilities: [
      "text_polishing",
      "expression_optimization",
      "style_unification",
      "detail_refinement",
      "quality_assurance",
    ],
    tools: ["polishing_tool", "synonym_library", "style_guide"],
    detailedDescription:
      "对内容进行最终润色，优化文字表达，提升整体阅读体验。确保风格统一，文笔流畅。",
  },
};

// ==================== 辅助函数 ====================

/**
 * 获取 Agent 配置
 */
export function getAgentConfig(
  agentId: string,
): WritingAgentConfig | undefined {
  const baseId = agentId.replace(/-\d+$/, "");
  return WRITING_AGENT_REGISTRY[baseId];
}

/**
 * 获取所有 Agent 列表
 */
export function getAllAgents(): WritingAgentConfig[] {
  return Object.values(WRITING_AGENT_REGISTRY);
}

/**
 * 获取指定角色类型的 Agent 列表
 */
export function getAgentsByRole(role: AgentRole): WritingAgentConfig[] {
  return Object.values(WRITING_AGENT_REGISTRY).filter(
    (agent) => agent.role === role,
  );
}

/**
 * 生成 Agent 实例 ID
 */
export function generateInstanceId(
  agentId: string,
  instanceNumber: number,
): string {
  const config = WRITING_AGENT_REGISTRY[agentId];
  if (!config?.supportsMultiInstance) {
    return agentId;
  }
  return `${agentId}-${instanceNumber}`;
}

/**
 * 数字转中文圈数字
 */
function toChineseNumber(num: number): string {
  const chineseNumbers = [
    "零",
    "①",
    "②",
    "③",
    "④",
    "⑤",
    "⑥",
    "⑦",
    "⑧",
    "⑨",
    "⑩",
  ];
  return chineseNumbers[num] || `${num}`;
}

/**
 * 生成前端显示用的 Agent 列表（包含多实例展开）
 */
export function generateDisplayAgentList(writerCount: number = 3): Array<
  WritingAgentConfig & {
    instanceId: string;
    instanceNumber?: number;
  }
> {
  const result: Array<
    WritingAgentConfig & { instanceId: string; instanceNumber?: number }
  > = [];

  // 添加 Story Architect
  result.push({
    ...WRITING_AGENT_REGISTRY["story-architect"],
    instanceId: "story-architect",
  });

  // 添加 Bible Keeper
  result.push({
    ...WRITING_AGENT_REGISTRY["bible-keeper"],
    instanceId: "bible-keeper",
  });

  // 添加 Writer 实例
  const writerConfig = WRITING_AGENT_REGISTRY["writer"];
  const actualWriterCount = Math.min(
    writerCount,
    writerConfig.maxInstances || 5,
  );

  const writerColors = [
    { color: "bg-orange-500", gradient: "from-orange-400 to-orange-600" },
    { color: "bg-amber-500", gradient: "from-amber-400 to-amber-600" },
    { color: "bg-yellow-500", gradient: "from-yellow-400 to-yellow-600" },
    { color: "bg-lime-500", gradient: "from-lime-400 to-lime-600" },
    { color: "bg-green-500", gradient: "from-green-400 to-green-600" },
  ];

  for (let i = 1; i <= actualWriterCount; i++) {
    const colorConfig = writerColors[(i - 1) % writerColors.length];
    result.push({
      ...writerConfig,
      ...colorConfig,
      nameCn: `作家${toChineseNumber(i)}`,
      nameEn: `Writer ${i}`,
      instanceId: `writer-${i}`,
      instanceNumber: i,
    });
  }

  // 添加 Consistency Checker
  result.push({
    ...WRITING_AGENT_REGISTRY["consistency-checker"],
    instanceId: "consistency-checker",
  });

  // 添加 Editor
  result.push({
    ...WRITING_AGENT_REGISTRY["editor"],
    instanceId: "editor",
  });

  return result;
}

/**
 * 根据后端返回的 agentName 匹配到配置
 */
export function matchAgentByName(agentName: string): WritingAgentConfig {
  const cleanName = agentName.replace(/^[^\u4e00-\u9fa5a-zA-Z]+/, "").trim();

  // 精确匹配
  for (const config of Object.values(WRITING_AGENT_REGISTRY)) {
    if (config.nameCn === cleanName || config.nameEn === cleanName) {
      return config;
    }
  }

  // 模糊匹配
  const keywordMap: Record<string, string> = {
    架构: "story-architect",
    architect: "story-architect",
    leader: "story-architect",
    守护: "bible-keeper",
    keeper: "bible-keeper",
    设定: "bible-keeper",
    作家: "writer",
    writer: "writer",
    检查: "consistency-checker",
    checker: "consistency-checker",
    一致性: "consistency-checker",
    编辑: "editor",
    editor: "editor",
    润色: "editor",
  };

  for (const [keyword, agentId] of Object.entries(keywordMap)) {
    if (cleanName.toLowerCase().includes(keyword.toLowerCase())) {
      return WRITING_AGENT_REGISTRY[agentId];
    }
  }

  // 默认配置
  return {
    id: "unknown",
    nameCn: agentName || "AI 助手",
    nameEn: agentName || "AI Assistant",
    descCn: "AI 助手",
    descEn: "AI Assistant",
    role: "executor",
    icon: "🤖",
    color: "bg-gray-500",
    gradient: "from-gray-400 to-gray-600",
    supportsMultiInstance: false,
    capabilities: [],
    tools: [],
    detailedDescription: "",
  };
}
