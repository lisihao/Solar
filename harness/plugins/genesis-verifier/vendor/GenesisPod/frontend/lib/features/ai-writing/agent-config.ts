/**
 * AI Writing Agent Configuration - 前端配置
 *
 * 注意：此配置与后端 backend/src/modules/ai-app/writing/constants/agent-config.ts 同步
 * 修改时请同时更新两处，保持一致性。
 *
 * TODO: 未来可考虑通过 API 获取配置，实现真正的单一数据源
 */

// ==================== Agent 角色类型 ====================

export type AgentRole =
  | 'leader'
  | 'keeper'
  | 'executor'
  | 'validator'
  | 'finisher';

// ==================== Agent 配置接口 ====================

export interface WritingAgentConfig {
  id: string;
  nameCn: string;
  nameEn: string;
  descCn: string;
  descEn: string;
  role: AgentRole;
  icon: string;
  color: string;
  gradient: string;
  supportsMultiInstance: boolean;
  maxInstances?: number;
  capabilities: string[];
  tools: string[];
  detailedDescription: string;
}

// ==================== Agent 注册表 ====================

export const WRITING_AGENT_REGISTRY: Record<string, WritingAgentConfig> = {
  'story-architect': {
    id: 'story-architect',
    nameCn: '故事架构师',
    nameEn: 'Story Architect',
    descCn: '统筹规划',
    descEn: 'Planning & Coordination',
    role: 'leader',
    icon: '👑',
    color: 'bg-purple-500',
    gradient: 'from-purple-400 to-purple-600',
    supportsMultiInstance: false,
    capabilities: [
      'story_planning',
      'chapter_decomposition',
      'task_assignment',
      'progress_tracking',
      'conflict_resolution',
    ],
    tools: ['outline_generator', 'storyline_tracker', 'conflict_designer'],
    detailedDescription:
      '负责统筹整体故事结构，规划章节大纲，确保叙事逻辑连贯。擅长把握故事节奏和情节转折，协调团队成员工作。',
  },

  'bible-keeper': {
    id: 'bible-keeper',
    nameCn: '设定守护者',
    nameEn: 'Bible Keeper',
    descCn: '世界观管理',
    descEn: 'World Building',
    role: 'keeper',
    icon: '📚',
    color: 'bg-emerald-500',
    gradient: 'from-emerald-400 to-emerald-600',
    supportsMultiInstance: false,
    capabilities: [
      'world_building',
      'character_management',
      'timeline_maintenance',
      'consistency_validation',
      'terminology_control',
    ],
    tools: ['character_database', 'world_graph', 'timeline_editor'],
    detailedDescription:
      '维护故事世界观的一致性，管理角色设定、地点背景和时间线，确保细节不出错。是 Story Bible 的守护者。',
  },

  writer: {
    id: 'writer',
    nameCn: '作家',
    nameEn: 'Writer',
    descCn: '内容创作',
    descEn: 'Content Creation',
    role: 'executor',
    icon: '✍️',
    color: 'bg-orange-500',
    gradient: 'from-orange-400 to-orange-600',
    supportsMultiInstance: true,
    maxInstances: 5,
    capabilities: [
      'content_generation',
      'dialogue_writing',
      'scene_rendering',
      'emotion_expression',
      'style_adaptation',
    ],
    tools: ['text_generator', 'style_template', 'vocabulary_library'],
    detailedDescription:
      '专注于创作生动的故事内容，擅长细腻的情感描写、人物对话、动作场面和环境氛围营造。',
  },

  'consistency-checker': {
    id: 'consistency-checker',
    nameCn: '一致性检查员',
    nameEn: 'Consistency Checker',
    descCn: '逻辑校验',
    descEn: 'Logic Validation',
    role: 'validator',
    icon: '🔍',
    color: 'bg-teal-500',
    gradient: 'from-teal-400 to-teal-600',
    supportsMultiInstance: false,
    capabilities: [
      'logic_validation',
      'setting_comparison',
      'timeline_check',
      'character_behavior_analysis',
      'fact_extraction',
    ],
    tools: ['consistency_checker', 'setting_comparator', 'issue_marker'],
    detailedDescription:
      '负责检查内容的逻辑一致性和设定准确性，发现并标记问题。确保角色行为符合设定，时间线无矛盾。',
  },

  editor: {
    id: 'editor',
    nameCn: '润色编辑',
    nameEn: 'Editor',
    descCn: '文字打磨',
    descEn: 'Text Polishing',
    role: 'finisher',
    icon: '🎨',
    color: 'bg-pink-500',
    gradient: 'from-pink-400 to-pink-600',
    supportsMultiInstance: false,
    capabilities: [
      'text_polishing',
      'expression_optimization',
      'style_unification',
      'detail_refinement',
      'quality_assurance',
    ],
    tools: ['polishing_tool', 'synonym_library', 'style_guide'],
    detailedDescription:
      '对内容进行最终润色，优化文字表达，提升整体阅读体验。确保风格统一，文笔流畅。',
  },
};

// ==================== 辅助函数 ====================

function toChineseNumber(num: number): string {
  const chineseNumbers = [
    '零',
    '①',
    '②',
    '③',
    '④',
    '⑤',
    '⑥',
    '⑦',
    '⑧',
    '⑨',
    '⑩',
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
    ...WRITING_AGENT_REGISTRY['story-architect'],
    instanceId: 'story-architect',
  });

  // 添加 Bible Keeper
  result.push({
    ...WRITING_AGENT_REGISTRY['bible-keeper'],
    instanceId: 'bible-keeper',
  });

  // 添加 Writer 实例
  const writerConfig = WRITING_AGENT_REGISTRY['writer'];
  const actualWriterCount = Math.min(
    writerCount,
    writerConfig.maxInstances || 5
  );

  const writerColors = [
    { color: 'bg-orange-500', gradient: 'from-orange-400 to-orange-600' },
    { color: 'bg-amber-500', gradient: 'from-amber-400 to-amber-600' },
    { color: 'bg-yellow-500', gradient: 'from-yellow-400 to-yellow-600' },
    { color: 'bg-lime-500', gradient: 'from-lime-400 to-lime-600' },
    { color: 'bg-green-500', gradient: 'from-green-400 to-green-600' },
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
    ...WRITING_AGENT_REGISTRY['consistency-checker'],
    instanceId: 'consistency-checker',
  });

  // 添加 Editor
  result.push({
    ...WRITING_AGENT_REGISTRY['editor'],
    instanceId: 'editor',
  });

  return result;
}

/**
 * 根据后端返回的 agentName 匹配到配置
 */
export function matchAgentByName(
  agentName: string | undefined
): WritingAgentConfig & { instanceId?: string } {
  if (!agentName) {
    return {
      id: 'unknown',
      nameCn: 'AI 团队',
      nameEn: 'AI Team',
      descCn: 'AI 助手',
      descEn: 'AI Assistant',
      role: 'executor',
      icon: '🤖',
      color: 'bg-gray-500',
      gradient: 'from-gray-400 to-gray-600',
      supportsMultiInstance: false,
      capabilities: [],
      tools: [],
      detailedDescription: '',
    };
  }

  const cleanName = agentName.replace(/^[^\u4e00-\u9fa5a-zA-Z]+/, '').trim();

  // 精确匹配
  for (const config of Object.values(WRITING_AGENT_REGISTRY)) {
    if (config.nameCn === cleanName || config.nameEn === cleanName) {
      return config;
    }
  }

  // 模糊匹配
  const keywordMap: Record<string, string> = {
    架构: 'story-architect',
    architect: 'story-architect',
    leader: 'story-architect',
    守护: 'bible-keeper',
    keeper: 'bible-keeper',
    设定: 'bible-keeper',
    作家: 'writer',
    writer: 'writer',
    检查: 'consistency-checker',
    checker: 'consistency-checker',
    一致性: 'consistency-checker',
    编辑: 'editor',
    editor: 'editor',
    润色: 'editor',
  };

  for (const [keyword, agentId] of Object.entries(keywordMap)) {
    if (cleanName.toLowerCase().includes(keyword.toLowerCase())) {
      return WRITING_AGENT_REGISTRY[agentId];
    }
  }

  return {
    id: 'unknown',
    nameCn: agentName,
    nameEn: agentName,
    descCn: 'AI 助手',
    descEn: 'AI Assistant',
    role: 'executor',
    icon: '🤖',
    color: 'bg-violet-500',
    gradient: 'from-violet-400 to-violet-600',
    supportsMultiInstance: false,
    capabilities: [],
    tools: [],
    detailedDescription: '',
  };
}

/**
 * 获取 Agent 详情（用于 Agent 详情面板）
 */
export function getAgentDetails(agentId: string): {
  name: string;
  role: string;
  description: string;
  skills: string[];
  tools: string[];
} {
  const baseId = agentId.replace(/-\d+$/, '');
  // Alias mapping for IDs that don't match registry keys directly
  const ALIAS: Record<string, string> = {
    checker: 'consistency-checker',
    architect: 'story-architect',
    keeper: 'bible-keeper',
  };
  const config = WRITING_AGENT_REGISTRY[ALIAS[baseId] || baseId];

  if (!config) {
    return {
      name: 'AI 助手',
      role: '助手',
      description: 'AI 助手',
      skills: [],
      tools: [],
    };
  }

  const roleMap: Record<AgentRole, string> = {
    leader: '团队领导',
    keeper: '世界观管理',
    executor: '内容创作',
    validator: '一致性审核',
    finisher: '润色优化',
  };

  return {
    name: config.nameCn,
    role: roleMap[config.role],
    description: config.detailedDescription,
    skills: config.capabilities.map((c) => {
      const skillNames: Record<string, string> = {
        story_planning: '故事结构设计',
        chapter_decomposition: '章节规划',
        task_assignment: '任务分配',
        progress_tracking: '进度跟踪',
        conflict_resolution: '冲突解决',
        world_building: '世界观构建',
        character_management: '角色档案管理',
        timeline_maintenance: '时间线维护',
        consistency_validation: '设定校验',
        terminology_control: '术语控制',
        content_generation: '内容生成',
        dialogue_writing: '对话创作',
        scene_rendering: '场景渲染',
        emotion_expression: '情感表达',
        style_adaptation: '风格适配',
        logic_validation: '逻辑校验',
        setting_comparison: '设定比对',
        timeline_check: '时间线检查',
        character_behavior_analysis: '角色行为分析',
        fact_extraction: '事实提取',
        text_polishing: '文字润色',
        expression_optimization: '表达优化',
        style_unification: '风格统一',
        detail_refinement: '细节打磨',
        quality_assurance: '质量保证',
      };
      return skillNames[c] || c;
    }),
    tools: config.tools.map((t) => {
      const toolNames: Record<string, string> = {
        outline_generator: '大纲生成器',
        storyline_tracker: '故事线追踪',
        conflict_designer: '冲突设计器',
        character_database: '角色数据库',
        world_graph: '世界观图谱',
        timeline_editor: '时间线编辑器',
        text_generator: '文本生成器',
        style_template: '风格模板',
        vocabulary_library: '词汇库',
        consistency_checker: '一致性检查器',
        setting_comparator: '设定比对器',
        issue_marker: '问题标记器',
        polishing_tool: '润色工具',
        synonym_library: '同义词库',
        style_guide: '风格指南',
      };
      return toolNames[t] || t;
    }),
  };
}
