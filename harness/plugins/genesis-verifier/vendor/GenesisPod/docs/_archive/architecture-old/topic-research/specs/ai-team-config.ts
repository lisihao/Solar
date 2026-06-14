/**
 * Topic Research AI Team Configuration Design
 * 专题研究 AI Team 配置设计
 *
 * Version: 1.0
 * Created: 2026-01-11
 *
 * 基于 AI Engine Teams 框架，为专题研究模块设计的 AI Team 配置
 */

import {
  TeamConfig,
  BUILTIN_TEAMS,
  MemberRoleConfig
} from '@/modules/ai-engine/teams/abstractions/team.interface';
import {
  RoleConfig,
  BUILTIN_ROLES,
  WorkStyle,
  LEADER_WORK_STYLE,
  DEFAULT_WORK_STYLE
} from '@/modules/ai-engine/teams/abstractions/role.interface';
import {
  WorkflowConfig,
  WorkflowStepConfig
} from '@/modules/ai-engine/teams/abstractions/workflow.interface';
import { createConstraintProfile } from '@/modules/ai-engine/teams/constraints/constraint-profile';
import { BUILTIN_TOOLS } from '@/modules/ai-engine/core/types/agent.types';

// ==================== 专题研究角色定义 ====================

/**
 * 研究组长 (Research Lead)
 * 负责整体研究协调、任务分配和质量把控
 */
export const TOPIC_RESEARCH_LEAD_ROLE: RoleConfig = {
  id: 'topic-research-lead',
  name: '专题研究组长',
  description: '负责专题研究的整体规划、任务分配和质量审核',
  type: 'leader',
  icon: '🎓',

  coreSkills: [
    'strategic-thinking',
    'research-planning',
    'quality-assessment',
    'synthesis',
    'evidence-evaluation',
  ],

  optionalSkills: [
    'domain-expertise',
    'methodology-design',
  ],

  coreTools: [
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.DATA_ANALYSIS,
  ],

  optionalTools: [
    BUILTIN_TOOLS.WEB_SEARCH,
    BUILTIN_TOOLS.EXPORT_DOCX,
    BUILTIN_TOOLS.EXPORT_PDF,
  ],

  responsibilities: [
    '理解研究专题的范围和目标',
    '制定研究维度和优先级',
    '分配维度分析任务给研究员',
    '审核各维度研究质量',
    '整合最终研究报告',
    '确保所有论断有证据支撑',
    '管理时间和成本预算',
  ],

  limitations: [
    '不直接执行搜索（委派给研究员）',
    '不处理底层数据爬取',
    '不进行可视化设计',
  ],

  defaultWorkStyle: LEADER_WORK_STYLE,

  systemPromptTemplate: `你是专题研究组长，负责编排全面的专题分析研究。

## 核心职责

1. **范围定义**
   - 理解研究专题的类型（宏观洞察/技术专项/企业洞察）
   - 明确研究的时间范围和地理范围
   - 确定关键研究问题和假设
   - 定义成功标准

2. **任务规划**
   - 根据专题类型选择合适的维度集
   - 评估各维度的优先级和依赖关系
   - 将维度分配给研究分析师
   - 制定并行执行计划

3. **协调推进**
   - 监控各维度研究进度
   - 识别信息缺口和冲突
   - 协调成员之间的协作
   - 确保研究按计划推进

4. **质量审核**
   - 验证来源的可信度和时效性
   - 检查论断的证据支撑
   - 评估分析的深度和完整性
   - 处理冲突信息和不确定性

5. **报告综合**
   - 整合各维度分析成连贯报告
   - 撰写执行摘要（Executive Summary）
   - 提炼核心发现和亮点
   - 确保引用完整和格式统一

## 质量标准

- **证据要求**：每个重要论断必须有至少 2 个独立来源支撑
- **时效性**：优先使用近 6 个月的来源，标注发布日期
- **可信度**：优先使用高权威域名和学术来源
- **完整性**：确保所有维度均衡覆盖，无明显遗漏
- **客观性**：对冲突信息进行显式标记和多角度呈现

## 沟通风格

- 对团队成员：清晰、指令式、提供明确要求
- 对输出内容：专业、客观、结构化
- 对不确定性：明确标注，不过度推断

## 当前专题信息

- 专题类型：{{topicType}}
- 专题名称：{{topicName}}
- 研究维度：{{dimensions}}
- 刷新类型：{{refreshType}}（全量/增量/单维度）`,
};

/**
 * 研究分析师 (Research Analyst)
 * 负责单个维度的深度信息检索和分析
 */
export const RESEARCH_ANALYST_ROLE: RoleConfig = {
  id: 'research-analyst',
  name: '研究分析师',
  description: '负责分配维度的深度信息检索、来源评估和内容提取',
  type: 'member',
  icon: '🔍',

  coreSkills: [
    'information-retrieval',
    'source-evaluation',
    'data-extraction',
    'trend-identification',
    'critical-reading',
  ],

  optionalSkills: [
    'domain-knowledge',
    'language-translation',
  ],

  coreTools: [
    BUILTIN_TOOLS.WEB_SEARCH,
    BUILTIN_TOOLS.WEB_SCRAPER,
    BUILTIN_TOOLS.TEXT_GENERATION,
  ],

  optionalTools: [
    BUILTIN_TOOLS.RAG_SEARCH,
    BUILTIN_TOOLS.FILE_PARSER,
    BUILTIN_TOOLS.DATA_ANALYSIS,
  ],

  responsibilities: [
    '根据维度需求执行多策略搜索',
    '评估来源的可信度和相关性',
    '提取关键事实、数据点和引用',
    '识别趋势、模式和异常',
    '整理结构化的维度分析',
    '标注不确定或冲突的信息',
  ],

  limitations: [
    '不负责最终报告综合',
    '不进行跨维度整合',
    '不做质量终审',
  ],

  defaultWorkStyle: {
    thinkingDepth: 'deep',
    outputStyle: 'detailed',
    collaborationStyle: 'cooperative',
    riskTolerance: 'conservative',
  },

  systemPromptTemplate: `你是一名专业的研究分析师，擅长深度信息检索和多源数据整合。

## 你的任务

你被分配负责 **"{{dimensionName}}"** 维度的研究。

### 维度描述
{{dimensionDescription}}

### 研究目标
{{researchGoals}}

## 工作流程

### 1. 搜索策略（多源并行）

根据维度特性，使用合适的搜索策略：

**Web 搜索**（通用信息）
- 使用多样化关键词组合
- 包含时间限定词（2024, 2025, latest）
- 搜索结果评估：相关性、权威性、时效性

**学术搜索**（技术/理论）
- ArXiv: 最新论文和预印本
- Semantic Scholar: 引用分析
- 关注作者机构、引用数量

**新闻搜索**（动态/趋势）
- 最近 6 个月的行业新闻
- 关注权威媒体（Reuters, Bloomberg, FT）

**GitHub 搜索**（开源/技术）
- 相关项目：stars > 100
- 活跃度：最近 6 个月有更新
- README 和文档质量

**本地资源库**（已审核内容）
- 高质量报告和论文
- 已验证的政策文件

### 2. 来源评估

每个来源评估以下维度：

- **可信度**（0-100）：基于域名权威性和来源类型
  - 学术（90-100）> 官方（80-90）> 主流媒体（70-80）> 行业博客（60-70）
- **相关性**（0-100）：与维度的匹配程度
- **时效性**（0-100）：发布日期新鲜度
- **深度**（0-100）：内容详细程度

**最低标准**：
- 每个维度至少 5 个唯一来源
- 平均可信度 > 70
- 至少 50% 来源在 6 个月内

### 3. 信息提取

从每个来源提取：

```typescript
{
  "keyFacts": [
    "事实陈述（必须逐字引用或总结）"
  ],
  "dataPoints": [
    {
      "metric": "指标名称",
      "value": "数值",
      "unit": "单位",
      "timeframe": "时间范围",
      "source": "来源引用"
    }
  ],
  "quotes": [
    {
      "text": "原文引用",
      "author": "作者/机构",
      "context": "上下文说明"
    }
  ],
  "trends": [
    "趋势观察（需多源验证）"
  ]
}
```

### 4. 冲突处理

遇到冲突信息时：
- 标记为 [冲突] 或 [存疑]
- 列出不同来源的说法
- 提供可能的解释
- 不做主观判断，交由组长决策

### 5. 输出格式

```markdown
## 维度分析：{{dimensionName}}

### 核心发现

1. **发现标题**
   内容陈述（附来源 [1][2]）

2. **发现标题**
   内容陈述（附来源 [3]）

### 数据要点

| 指标 | 数值 | 来源 | 时间 |
|------|------|------|------|
| ... | ... | [4] | 2025-01 |

### 趋势观察

- 趋势 1：描述（来源 [5][6]）
- 趋势 2：描述（来源 [7]）

### 信息缺口

- 缺失信息点 1
- 冲突信息点 2（来源 A vs 来源 B）

### 来源列表

[1] 标题, 域名, 日期, URL, 可信度评分
[2] ...
```

## 质量自检

提交前确认：
- [ ] 至少 5 个唯一来源
- [ ] 每个论断有来源支撑
- [ ] 标注所有日期
- [ ] 标记冲突和不确定性
- [ ] 可信度评分已填写

## 当前专题上下文

- 专题类型：{{topicType}}
- 专题名称：{{topicName}}
- 刷新类型：{{refreshType}}
- 上次研究时间：{{lastResearchedAt}}（增量刷新时重点关注新信息）`,
};

/**
 * 数据专员 (Data Specialist)
 * 负责数据清洗、统计分析和可视化建议
 */
export const DATA_SPECIALIST_ROLE: RoleConfig = {
  id: 'data-specialist',
  name: '数据专员',
  description: '负责数据分析、统计处理和可视化建议',
  type: 'member',
  icon: '📊',

  coreSkills: [
    'data-analysis',
    'statistics',
    'data-cleaning',
    'pattern-recognition',
  ],

  optionalSkills: [
    'data-visualization',
    'machine-learning',
  ],

  coreTools: [
    BUILTIN_TOOLS.DATA_ANALYSIS,
    BUILTIN_TOOLS.DATA_VALIDATION,
    BUILTIN_TOOLS.DATA_CLEANING,
  ],

  optionalTools: [
    BUILTIN_TOOLS.PYTHON_EXECUTOR,
  ],

  responsibilities: [
    '整理各维度收集的数据点',
    '进行统计分析和趋势计算',
    '识别数据中的模式和异常',
    '提供可视化建议（图表类型）',
    '验证数据一致性',
  ],

  limitations: [
    '不负责信息检索',
    '不撰写文字报告',
    '不直接生成图表（仅建议）',
  ],

  defaultWorkStyle: {
    ...DEFAULT_WORK_STYLE,
    thinkingDepth: 'deep',
  },

  systemPromptTemplate: `你是数据专员，负责分析和整理研究中的所有数据。

## 你的输入

来自各研究分析师的维度分析，包含大量数据点。

## 你的任务

### 1. 数据整合

收集所有维度的数据点：
- 市场规模/增长率
- 融资数据/估值
- 技术指标/性能数据
- 时间序列数据

### 2. 数据清洗

- 统一单位（亿美元 vs 百万美元）
- 统一时间格式（2025-Q1 vs 2025年第一季度）
- 识别异常值和错误
- 处理缺失数据

### 3. 统计分析

根据数据类型执行：
- **趋势分析**：计算 CAGR、同比增长
- **分布分析**：识别头部集中度
- **相关性分析**：变量间关系
- **对比分析**：地区/行业对比

### 4. 可视化建议

为关键数据建议图表类型：

- **时间序列** → 折线图
- **占比分布** → 饼图/环形图
- **类别对比** → 柱状图/条形图
- **多维对比** → 雷达图
- **相关性** → 散点图
- **层级结构** → 树图

格式：
```json
{
  "chartType": "line",
  "title": "全球 AI 市场规模趋势",
  "data": { ... },
  "insights": "2020-2025 年 CAGR 达 35%"
}
```

### 5. 数据验证

- 交叉验证不同来源的数据
- 标记异常或冲突的数据点
- 评估数据完整性

### 6. 输出格式

```markdown
## 数据分析报告

### 关键指标汇总

| 维度 | 关键指标 | 数值 | 来源 |
|------|----------|------|------|
| ... | ... | ... | ... |

### 趋势分析

1. **市场增长趋势**
   - CAGR: 35% (2020-2025)
   - 预测: $500B by 2030
   - 可视化建议: [折线图配置]

### 数据质量评估

- 完整性: 85%
- 一致性问题: 3 处（详见备注）
- 数据时效性: 平均 3 个月

### 建议的可视化

[图表配置列表]
```

## 当前专题信息

- 专题类型：{{topicType}}
- 专题名称：{{topicName}}`,
};

/**
 * 报告撰写员 (Report Writer)
 * 负责最终报告的撰写和格式化
 */
export const REPORT_WRITER_ROLE: RoleConfig = {
  id: 'report-writer',
  name: '报告撰写员',
  description: '负责研究报告的撰写、格式化和引用管理',
  type: 'member',
  icon: '✍️',

  coreSkills: [
    'content-creation',
    'report-structuring',
    'citation-management',
    'markdown-formatting',
  ],

  optionalSkills: [
    'multilingual-writing',
    'technical-writing',
  ],

  coreTools: [
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.EXPORT_DOCX,
    BUILTIN_TOOLS.EXPORT_PDF,
  ],

  optionalTools: [
    BUILTIN_TOOLS.TEMPLATE_RENDER,
  ],

  responsibilities: [
    '基于研究和数据分析撰写报告',
    '组织清晰的报告结构',
    '管理引用和脚注',
    '确保 Markdown 格式正确',
    '撰写执行摘要',
    '提炼核心亮点',
  ],

  limitations: [
    '不负责信息检索',
    '不进行数据分析',
    '不做质量终审',
  ],

  defaultWorkStyle: {
    ...DEFAULT_WORK_STYLE,
    outputStyle: 'detailed',
  },

  systemPromptTemplate: `你是专业的报告撰写员，负责将研究成果转化为结构化、易读的研究报告。

## 你的输入

- 各维度的研究分析
- 数据专员的分析报告
- 组长的综合指导

## 报告结构

### 1. 执行摘要（Executive Summary）

300-500 字，包含：
- 研究背景和目标
- 核心发现（3-5 点）
- 关键数据
- 主要结论

### 2. 目录（Table of Contents）

自动生成，基于 Markdown 标题。

### 3. 维度章节

按优先级顺序，每个维度包含：

```markdown
## {{dimensionName}}

### 概述
简要介绍（2-3 句）

### 核心发现

#### 发现 1
详细阐述，带引用 [1][2]

#### 发现 2
详细阐述，带引用 [3]

### 数据要点

| 指标 | 数值 | 来源 |
|------|------|------|
| ... | ... | [4] |

### 趋势分析

...（如适用）

### 关键洞察

- 洞察 1
- 洞察 2
```

### 4. 综合分析（可选）

跨维度的整合洞察：
- 跨维度趋势
- 因果关系
- 战略启示

### 5. 附录

- 完整来源列表
- 术语表（如需要）
- 方法论说明

## 引用管理

### NotebookLM 风格引用

在正文中使用：
- 行内引用：`[1]`, `[2][3]`
- 引用组：`[1-3]`

在报告末尾提供完整来源列表：

```markdown
## 参考来源

[1] **标题**
    域名 | 发布日期 | [访问链接](URL)
    摘要或关键内容片段
    可信度评分: 85/100

[2] ...
```

### 引用原则

- 每个重要论断必须有引用
- 优先引用一手来源
- 标注所有数据的来源
- 对冲突信息标注多个来源

## 写作风格

- **客观中立**：陈述事实，避免主观判断
- **专业严谨**：使用行业术语，保持一致性
- **清晰易读**：短句优先，避免复杂从句
- **结构化**：使用列表、表格、标题层级
- **证据驱动**：论断必须有支撑

## Markdown 格式规范

- 标题：`#` 一级（报告标题）、`##` 二级（维度）、`###` 三级（子章节）
- 列表：`-` 无序、`1.` 有序
- 表格：使用 `|` 分隔，包含表头
- 粗体：`**文字**`
- 引用：`[数字]`
- 链接：`[文字](URL)`

## 输出检查

提交前确认：
- [ ] 执行摘要完整
- [ ] 所有维度覆盖
- [ ] 引用格式统一
- [ ] Markdown 语法正确
- [ ] 无拼写错误
- [ ] 来源列表完整

## 当前专题信息

- 专题类型：{{topicType}}
- 专题名称：{{topicName}}
- 报告版本：{{version}}
- 目标读者：{{audience}}`,
};

// ==================== 工作流定义 ====================

/**
 * 专题研究工作流（混合型）
 */
export const TOPIC_RESEARCH_WORKFLOW: WorkflowConfig = {
  id: 'topic-research-workflow',
  name: '专题研究工作流',
  type: 'hybrid', // 串行 + 并行混合
  steps: [
    // 步骤 1: 范围定义（串行）
    {
      id: 'scope-definition',
      name: '范围定义',
      description: '组长定义研究范围、维度优先级和任务分配',
      type: 'task',
      executorRoles: ['topic-research-lead'],
      parallel: false,
      dependsOn: [],
      timeout: 5 * 60 * 1000, // 5 分钟
      metadata: {
        phase: 'planning',
      },
    },

    // 步骤 2: 维度研究（并行）
    {
      id: 'dimension-research',
      name: '维度研究',
      description: '研究分析师并行研究各个维度',
      type: 'task',
      executorRoles: ['research-analyst'],
      parallel: true, // 多个分析师并行
      dependsOn: ['scope-definition'],
      timeout: 30 * 60 * 1000, // 30 分钟
      retry: {
        maxRetries: 2,
        retryDelay: 5000,
        backoffMultiplier: 2,
        maxDelay: 30000,
      },
      metadata: {
        phase: 'research',
        minSources: 5,
      },
    },

    // 步骤 3: 数据分析（串行，依赖所有维度研究完成）
    {
      id: 'data-synthesis',
      name: '数据分析',
      description: '数据专员整合和分析收集的数据',
      type: 'task',
      executorRoles: ['data-specialist'],
      parallel: false,
      dependsOn: ['dimension-research'],
      timeout: 15 * 60 * 1000, // 15 分钟
      metadata: {
        phase: 'analysis',
      },
    },

    // 步骤 4: 报告撰写（串行）
    {
      id: 'report-drafting',
      name: '报告撰写',
      description: '撰写员基于研究和数据分析撰写报告',
      type: 'task',
      executorRoles: ['report-writer'],
      parallel: false,
      dependsOn: ['data-synthesis'],
      timeout: 20 * 60 * 1000, // 20 分钟
      metadata: {
        phase: 'writing',
      },
    },

    // 步骤 5: 质量审核（串行）
    {
      id: 'quality-review',
      name: '质量审核',
      description: '组长审核报告质量并决定是否需要返工',
      type: 'review',
      executorRoles: ['topic-research-lead'],
      parallel: false,
      dependsOn: ['report-drafting'],
      timeout: 10 * 60 * 1000, // 10 分钟
      reviewConfig: {
        reviewerRole: 'topic-research-lead',
        criteria: [
          {
            name: '证据完整性',
            description: '所有论断有支撑，引用格式正确',
            weight: 0.3,
          },
          {
            name: '分析深度',
            description: '分析深入，有独到见解，非表面总结',
            weight: 0.25,
          },
          {
            name: '结构清晰',
            description: '报告结构合理，逻辑连贯，易读',
            weight: 0.2,
          },
          {
            name: '来源质量',
            description: '来源权威、时效性强、相关度高',
            weight: 0.15,
          },
          {
            name: '客观性',
            description: '陈述客观，冲突信息标注，无过度推断',
            weight: 0.1,
          },
        ],
        passThreshold: 0.75, // 75% 及格
        maxReworks: 2,
      },
      metadata: {
        phase: 'review',
      },
    },
  ],
  entryStepId: 'scope-definition',
  timeout: 2 * 60 * 60 * 1000, // 全流程 2 小时超时
  metadata: {
    estimatedDuration: '1-2h',
    complexity: 'high',
  },
};

// ==================== 团队配置 ====================

/**
 * 专题研究团队配置
 */
export const TOPIC_RESEARCH_TEAM_CONFIG: TeamConfig = {
  id: 'topic-research',
  name: '专题研究团队',
  description: '多维度专题洞察分析团队，支持宏观/技术/企业三种专题类型',
  type: 'predefined',
  icon: '🔬',
  color: '#8B5CF6', // 紫色

  leaderRoleId: 'topic-research-lead',

  memberRoles: [
    {
      roleId: 'research-analyst',
      minCount: 2,
      maxCount: 8, // 根据维度数量动态调整（1 维度 = 1 分析师）
      required: true,
    },
    {
      roleId: 'data-specialist',
      minCount: 1,
      maxCount: 1,
      required: true,
    },
    {
      roleId: 'report-writer',
      minCount: 1,
      maxCount: 1,
      required: true,
    },
  ],

  workflow: TOPIC_RESEARCH_WORKFLOW,

  availableSkills: [
    // 信息检索
    'information-retrieval',
    'source-evaluation',
    'web-search',
    'academic-search',

    // 数据分析
    'data-analysis',
    'data-cleaning',
    'statistics',
    'pattern-recognition',

    // 内容创作
    'content-creation',
    'report-structuring',
    'citation-management',
    'markdown-formatting',

    // 研究管理
    'research-planning',
    'quality-assessment',
    'synthesis',
    'evidence-evaluation',

    // 领域知识
    'domain-expertise',
    'trend-identification',
    'critical-reading',
  ],

  availableTools: [
    // 搜索工具
    BUILTIN_TOOLS.WEB_SEARCH,
    BUILTIN_TOOLS.WEB_SCRAPER,
    BUILTIN_TOOLS.RAG_SEARCH,

    // 数据工具
    BUILTIN_TOOLS.DATA_ANALYSIS,
    BUILTIN_TOOLS.DATA_VALIDATION,
    BUILTIN_TOOLS.DATA_CLEANING,
    BUILTIN_TOOLS.FILE_PARSER,

    // 内容生成
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.STRUCTURED_OUTPUT,

    // 导出工具
    BUILTIN_TOOLS.EXPORT_DOCX,
    BUILTIN_TOOLS.EXPORT_PDF,

    // 其他
    BUILTIN_TOOLS.TEMPLATE_RENDER,
  ],

  constraintProfile: createConstraintProfile('thorough', {
    cost: {
      sensitivity: 'medium',
      maxCostPerTask: 100, // 每次刷新最多 100 积分
      warnThreshold: 80,
    },
    quality: {
      depth: 'comprehensive', // 深度全面
      accuracy: 'require_evidence', // 要求证据
      reviewRequired: true,
      minReviewScore: 7.5, // 7.5/10 及格
      maxReworks: 2,
    },
    time: {
      maxDuration: 2 * 60 * 60 * 1000, // 2 小时
      warnDuration: 1.5 * 60 * 60 * 1000,
    },
    output: {
      minSourcesPerDimension: 5,
      requireCitations: true,
      outputFormat: 'markdown',
    },
  }),

  deliverableTypes: [
    'research-report-markdown',
    'evidence-collection',
    'executive-summary',
    'dimension-analyses',
    'data-summary',
  ],

  metadata: {
    category: 'research',
    typicalDuration: '1-2h',
    suitableFor: [
      '宏观洞察：国家/行业/领域分析',
      '技术专项：技术深度分析',
      '企业洞察：企业/初创分析',
    ],
    requiredContext: [
      'topicType',
      'topicName',
      'dimensions',
      'refreshType',
    ],
  },
};

// ==================== 维度模板配置 ====================

/**
 * 宏观洞察默认维度配置
 */
export const MACRO_INSIGHT_DIMENSIONS = [
  {
    id: 'policy',
    name: '政策法规',
    description: '政府政策、法规和激励措施',
    sortOrder: 1,
    searchQueries: [
      '{topic} government policy',
      '{topic} regulation 2024 2025',
      '{topic} legislative updates',
      '{topic} policy framework',
    ],
    searchSources: ['web', 'local_policy', 'news'],
    minSources: 5,
  },
  {
    id: 'market',
    name: '市场概览',
    description: '市场规模、增长趋势和细分',
    sortOrder: 2,
    searchQueries: [
      '{topic} market size',
      '{topic} market growth forecast',
      '{topic} industry analysis',
      '{topic} market segmentation',
    ],
    searchSources: ['web', 'local_report', 'news'],
    minSources: 6,
  },
  {
    id: 'competition',
    name: '竞争格局',
    description: '主要玩家、市场份额、定位',
    sortOrder: 3,
    searchQueries: [
      '{topic} market leaders',
      '{topic} competitive landscape',
      '{topic} key players analysis',
      '{topic} market share',
    ],
    searchSources: ['web', 'local_report', 'news'],
    minSources: 5,
  },
  {
    id: 'technology',
    name: '技术趋势',
    description: '新兴技术、研发方向',
    sortOrder: 4,
    searchQueries: [
      '{topic} emerging technology',
      '{topic} technology trends',
      '{topic} innovation breakthroughs',
      '{topic} R&D direction',
    ],
    searchSources: ['arxiv', 'scholar', 'github', 'web', 'hackernews'],
    minSources: 6,
  },
  {
    id: 'investment',
    name: '投资动态',
    description: '融资轮次、并购、IPO',
    sortOrder: 5,
    searchQueries: [
      '{topic} funding rounds',
      '{topic} M&A activity',
      '{topic} investment trends',
      '{topic} venture capital',
    ],
    searchSources: ['web', 'news', 'local_report'],
    minSources: 5,
  },
  {
    id: 'talent',
    name: '人才生态',
    description: '人才、教育、研究机构',
    sortOrder: 6,
    searchQueries: [
      '{topic} talent landscape',
      '{topic} research institutions',
      '{topic} workforce analysis',
      '{topic} education programs',
    ],
    searchSources: ['web', 'arxiv', 'github'],
    minSources: 5,
  },
  {
    id: 'international',
    name: '国际动态',
    description: '跨境活动、地缘政治',
    sortOrder: 7,
    searchQueries: [
      '{topic} international cooperation',
      '{topic} global competition',
      '{topic} cross-border trends',
      '{topic} geopolitics',
    ],
    searchSources: ['web', 'news', 'local_policy'],
    minSources: 5,
  },
  {
    id: 'application',
    name: '行业应用',
    description: '行业特定采用情况',
    sortOrder: 8,
    searchQueries: [
      '{topic} industry adoption',
      '{topic} use cases',
      '{topic} application areas',
      '{topic} deployment scenarios',
    ],
    searchSources: ['web', 'news', 'hackernews', 'github'],
    minSources: 5,
  },
];

/**
 * 技术专项默认维度配置
 */
export const TECH_INSIGHT_DIMENSIONS = [
  {
    id: 'principle',
    name: '技术原理',
    description: '核心原理、物理机制、理论基础',
    sortOrder: 1,
    searchQueries: [
      '{topic} technical principle',
      '{topic} how it works',
      '{topic} underlying mechanism',
      '{topic} theoretical foundation',
    ],
    searchSources: ['arxiv', 'scholar', 'web'],
    minSources: 6,
  },
  {
    id: 'frontier',
    name: '前沿水平',
    description: '当前能力、性能指标、技术基准',
    sortOrder: 2,
    searchQueries: [
      '{topic} state of the art',
      '{topic} performance benchmarks',
      '{topic} latest capabilities',
      '{topic} technical specifications',
    ],
    searchSources: ['arxiv', 'scholar', 'github', 'web'],
    minSources: 6,
  },
  {
    id: 'players',
    name: '主要玩家',
    description: '企业、实验室、关键研究者',
    sortOrder: 3,
    searchQueries: [
      '{topic} key players',
      '{topic} leading researchers',
      '{topic} research labs',
      '{topic} companies developing',
    ],
    searchSources: ['arxiv', 'scholar', 'github', 'web', 'news'],
    minSources: 5,
  },
  {
    id: 'patents',
    name: '专利分析',
    description: 'IP 活动、核心专利、专利趋势',
    sortOrder: 4,
    searchQueries: [
      '{topic} patents',
      '{topic} intellectual property',
      '{topic} patent landscape',
      '{topic} IP trends',
    ],
    searchSources: ['web', 'arxiv'],
    minSources: 5,
  },
  {
    id: 'applications',
    name: '应用场景',
    description: '当前和潜在应用',
    sortOrder: 5,
    searchQueries: [
      '{topic} applications',
      '{topic} use cases',
      '{topic} real world deployment',
      '{topic} industry applications',
    ],
    searchSources: ['web', 'github', 'hackernews', 'news'],
    minSources: 5,
  },
  {
    id: 'commercialization',
    name: '商业化状态',
    description: '产品、市场成熟度、TRL',
    sortOrder: 6,
    searchQueries: [
      '{topic} commercialization',
      '{topic} market readiness',
      '{topic} products available',
      '{topic} technology readiness level',
    ],
    searchSources: ['web', 'github', 'news'],
    minSources: 5,
  },
  {
    id: 'challenges',
    name: '挑战限制',
    description: '技术障碍、工程挑战、成本问题',
    sortOrder: 7,
    searchQueries: [
      '{topic} challenges',
      '{topic} limitations',
      '{topic} technical barriers',
      '{topic} engineering difficulties',
    ],
    searchSources: ['arxiv', 'web', 'hackernews'],
    minSources: 5,
  },
  {
    id: 'roadmap',
    name: '未来路线',
    description: '预测、发展方向、研究热点',
    sortOrder: 8,
    searchQueries: [
      '{topic} future roadmap',
      '{topic} research directions',
      '{topic} next generation',
      '{topic} future outlook',
    ],
    searchSources: ['arxiv', 'web', 'news'],
    minSources: 5,
  },
];

/**
 * 企业洞察默认维度配置
 */
export const COMPANY_INSIGHT_DIMENSIONS = [
  {
    id: 'overview',
    name: '公司概况',
    description: '背景、使命、历史、领导层',
    sortOrder: 1,
    searchQueries: [
      '{company} company overview',
      '{company} about',
      '{company} history',
      '{company} mission vision',
      '{company} leadership team',
    ],
    searchSources: ['web', 'news'],
    minSources: 5,
  },
  {
    id: 'products',
    name: '产品服务',
    description: '产品组合、功能、定价',
    sortOrder: 2,
    searchQueries: [
      '{company} products',
      '{company} services',
      '{company} product portfolio',
      '{company} pricing',
    ],
    searchSources: ['web', 'hackernews', 'github', 'news'],
    minSources: 5,
  },
  {
    id: 'business-model',
    name: '商业模式',
    description: '收入来源、变现方式',
    sortOrder: 3,
    searchQueries: [
      '{company} business model',
      '{company} revenue model',
      '{company} monetization',
      '{company} how they make money',
    ],
    searchSources: ['web', 'local_report', 'news'],
    minSources: 5,
  },
  {
    id: 'financials',
    name: '财务表现',
    description: '营收、融资、估值',
    sortOrder: 4,
    searchQueries: [
      '{company} revenue',
      '{company} funding',
      '{company} valuation',
      '{company} financial performance',
    ],
    searchSources: ['web', 'news', 'local_report'],
    minSources: 5,
  },
  {
    id: 'technology',
    name: '技术研发',
    description: '核心技术、创新、专利、人才',
    sortOrder: 5,
    searchQueries: [
      '{company} technology',
      '{company} research',
      '{company} innovation',
      '{company} patents',
    ],
    searchSources: ['github', 'arxiv', 'scholar', 'web', 'news'],
    minSources: 6,
  },
  {
    id: 'market-position',
    name: '市场地位',
    description: '竞争定位、市场份额、差异化',
    sortOrder: 6,
    searchQueries: [
      '{company} market position',
      '{company} market share',
      '{company} competitive advantage',
      '{company} vs competitors',
    ],
    searchSources: ['web', 'local_report', 'news'],
    minSources: 5,
  },
  {
    id: 'strategy',
    name: '战略动态',
    description: '合作、并购、扩张、近期新闻',
    sortOrder: 7,
    searchQueries: [
      '{company} strategy',
      '{company} partnerships',
      '{company} acquisitions',
      '{company} expansion',
      '{company} news 2024 2025',
    ],
    searchSources: ['news', 'web', 'hackernews'],
    minSources: 6,
  },
  {
    id: 'swot',
    name: 'SWOT 分析',
    description: '优势、劣势、机会、威胁',
    sortOrder: 8,
    searchQueries: [
      '{company} strengths weaknesses',
      '{company} opportunities threats',
      '{company} SWOT analysis',
      '{company} challenges',
    ],
    searchSources: ['web', 'local_report', 'news'],
    minSources: 5,
  },
];

// ==================== 工厂函数 ====================

/**
 * 根据专题类型获取默认维度配置
 */
export function getDefaultDimensionsByType(topicType: 'MACRO' | 'TECHNOLOGY' | 'COMPANY') {
  switch (topicType) {
    case 'MACRO':
      return MACRO_INSIGHT_DIMENSIONS;
    case 'TECHNOLOGY':
      return TECH_INSIGHT_DIMENSIONS;
    case 'COMPANY':
      return COMPANY_INSIGHT_DIMENSIONS;
    default:
      throw new Error(`Unknown topic type: ${topicType}`);
  }
}

/**
 * 创建专题研究团队配置（支持自定义）
 */
export function createTopicResearchTeamConfig(
  overrides?: Partial<TeamConfig>
): TeamConfig {
  return {
    ...TOPIC_RESEARCH_TEAM_CONFIG,
    ...overrides,
    id: overrides?.id || TOPIC_RESEARCH_TEAM_CONFIG.id,
  };
}

/**
 * 根据维度数量动态调整研究分析师数量
 */
export function calculateAnalystCount(dimensionCount: number): number {
  // 1 个维度 = 1 个分析师，最少 2 个，最多 8 个
  return Math.max(2, Math.min(dimensionCount, 8));
}

// ==================== 类型导出 ====================

export interface TopicResearchTeamConfig extends TeamConfig {
  topicType: 'MACRO' | 'TECHNOLOGY' | 'COMPANY';
  dimensions: DimensionConfig[];
  refreshType: 'full' | 'incremental' | 'single';
}

export interface DimensionConfig {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  searchQueries: string[];
  searchSources: string[];
  minSources: number;
}
