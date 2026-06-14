/**
 * Dimension Templates Configuration
 *
 * 默认维度模板配置，按专题类型分类
 * 从 topic-research.service.ts 中提取，便于独立管理和扩展
 */

export interface DimensionTemplate {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  searchQueries: string[];
  searchSources: string[];
  minSources: number;
}

/**
 * 宏观洞察维度模板
 */
export const MACRO_INSIGHT_DIMENSIONS: DimensionTemplate[] = [
  {
    id: "policy",
    name: "政策法规",
    description: "政府政策、法规和激励措施",
    sortOrder: 1,
    searchQueries: [
      "{topic} government policy",
      "{topic} regulation 2024 2025",
      "{topic} legislative updates",
      "{topic} policy framework",
    ],
    searchSources: [
      "web",
      "federal-register",
      "congress-gov",
      "whitehouse-news",
    ],
    minSources: 5,
  },
  {
    id: "market",
    name: "市场概览",
    description: "市场规模、增长趋势和细分",
    sortOrder: 2,
    searchQueries: [
      "{topic} market size",
      "{topic} market growth forecast",
      "{topic} industry analysis",
      "{topic} market segmentation",
    ],
    searchSources: ["web", "industry-report", "local"],
    minSources: 6,
  },
  {
    id: "competition",
    name: "竞争格局",
    description: "主要玩家、市场份额、定位",
    sortOrder: 3,
    searchQueries: [
      "{topic} market leaders",
      "{topic} competitive landscape",
      "{topic} key players analysis",
      "{topic} market share",
    ],
    searchSources: ["web", "industry-report", "local"],
    minSources: 5,
  },
  {
    id: "technology",
    name: "技术趋势",
    description: "新兴技术、研发方向",
    sortOrder: 4,
    searchQueries: [
      "{topic} emerging technology",
      "{topic} technology trends",
      "{topic} innovation breakthroughs",
      "{topic} R&D direction",
    ],
    searchSources: [
      "academic",
      "github",
      "web",
      "hackernews",
      "industry-report",
    ],
    minSources: 6,
  },
  {
    id: "investment",
    name: "投资动态",
    description: "融资轮次、并购、IPO",
    sortOrder: 5,
    searchQueries: [
      "{topic} funding rounds",
      "{topic} M&A activity",
      "{topic} investment trends",
      "{topic} venture capital",
    ],
    searchSources: ["web", "industry-report", "local"],
    minSources: 5,
  },
  {
    id: "talent",
    name: "人才生态",
    description: "人才、教育、研究机构",
    sortOrder: 6,
    searchQueries: [
      "{topic} talent landscape",
      "{topic} research institutions",
      "{topic} workforce analysis",
      "{topic} education programs",
    ],
    searchSources: ["web", "academic", "github"],
    minSources: 5,
  },
  {
    id: "international",
    name: "国际动态",
    description: "跨境活动、地缘政治",
    sortOrder: 7,
    searchQueries: [
      "{topic} international cooperation",
      "{topic} global competition",
      "{topic} cross-border trends",
      "{topic} geopolitics",
    ],
    searchSources: [
      "web",
      "federal-register",
      "congress-gov",
      "whitehouse-news",
    ],
    minSources: 5,
  },
  {
    id: "application",
    name: "行业应用",
    description: "行业特定采用情况",
    sortOrder: 8,
    searchQueries: [
      "{topic} industry adoption",
      "{topic} use cases",
      "{topic} application areas",
      "{topic} deployment scenarios",
    ],
    searchSources: ["web", "hackernews", "github"],
    minSources: 5,
  },
];

/**
 * 技术洞察维度模板
 */
export const TECH_INSIGHT_DIMENSIONS: DimensionTemplate[] = [
  {
    id: "principle",
    name: "技术原理",
    description: "核心原理、物理机制、理论基础",
    sortOrder: 1,
    searchQueries: [
      "{topic} technical principle",
      "{topic} how it works",
      "{topic} underlying mechanism",
      "{topic} theoretical foundation",
    ],
    searchSources: ["academic", "web"],
    minSources: 6,
  },
  {
    id: "frontier",
    name: "前沿水平",
    description: "当前能力、性能指标、技术基准",
    sortOrder: 2,
    searchQueries: [
      "{topic} state of the art",
      "{topic} performance benchmarks",
      "{topic} latest capabilities",
      "{topic} technical specifications",
    ],
    searchSources: ["academic", "github", "web", "industry-report"],
    minSources: 6,
  },
  {
    id: "players",
    name: "主要玩家",
    description: "企业、实验室、关键研究者",
    sortOrder: 3,
    searchQueries: [
      "{topic} key players",
      "{topic} leading researchers",
      "{topic} research labs",
      "{topic} companies developing",
    ],
    searchSources: ["academic", "github", "web", "industry-report"],
    minSources: 5,
  },
  {
    id: "patents",
    name: "专利分析",
    description: "IP 活动、核心专利、专利趋势",
    sortOrder: 4,
    searchQueries: [
      "{topic} patents",
      "{topic} intellectual property",
      "{topic} patent landscape",
      "{topic} IP trends",
    ],
    searchSources: ["web", "academic"],
    minSources: 5,
  },
  {
    id: "applications",
    name: "应用场景",
    description: "当前和潜在应用",
    sortOrder: 5,
    searchQueries: [
      "{topic} applications",
      "{topic} use cases",
      "{topic} real world deployment",
      "{topic} industry applications",
    ],
    searchSources: ["web", "github", "hackernews", "industry-report"],
    minSources: 5,
  },
  {
    id: "commercialization",
    name: "商业化状态",
    description: "产品、市场成熟度、TRL",
    sortOrder: 6,
    searchQueries: [
      "{topic} commercialization",
      "{topic} market readiness",
      "{topic} products available",
      "{topic} technology readiness level",
    ],
    searchSources: ["web", "github", "industry-report"],
    minSources: 5,
  },
  {
    id: "challenges",
    name: "挑战限制",
    description: "技术障碍、工程挑战、成本问题",
    sortOrder: 7,
    searchQueries: [
      "{topic} challenges",
      "{topic} limitations",
      "{topic} technical barriers",
      "{topic} engineering difficulties",
    ],
    searchSources: ["academic", "web", "hackernews"],
    minSources: 5,
  },
  {
    id: "roadmap",
    name: "未来路线",
    description: "预测、发展方向、研究热点",
    sortOrder: 8,
    searchQueries: [
      "{topic} future roadmap",
      "{topic} research directions",
      "{topic} next generation",
      "{topic} future outlook",
    ],
    searchSources: ["academic", "web", "industry-report"],
    minSources: 5,
  },
];

/**
 * 企业研究维度模板
 */
export const COMPANY_INSIGHT_DIMENSIONS: DimensionTemplate[] = [
  {
    id: "overview",
    name: "公司概况",
    description: "背景、使命、历史、领导层",
    sortOrder: 1,
    searchQueries: [
      "{company} company overview",
      "{company} about",
      "{company} history",
      "{company} mission vision",
      "{company} leadership team",
    ],
    searchSources: ["web"],
    minSources: 5,
  },
  {
    id: "products",
    name: "产品服务",
    description: "产品组合、功能、定价",
    sortOrder: 2,
    searchQueries: [
      "{company} products",
      "{company} services",
      "{company} product portfolio",
      "{company} pricing",
    ],
    searchSources: ["web", "hackernews", "github"],
    minSources: 5,
  },
  {
    id: "business-model",
    name: "商业模式",
    description: "收入来源、变现方式",
    sortOrder: 3,
    searchQueries: [
      "{company} business model",
      "{company} revenue model",
      "{company} monetization",
      "{company} how they make money",
    ],
    searchSources: ["web", "local"],
    minSources: 5,
  },
  {
    id: "financials",
    name: "财务表现",
    description: "营收、融资、估值",
    sortOrder: 4,
    searchQueries: [
      "{company} revenue",
      "{company} funding",
      "{company} valuation",
      "{company} financial performance",
    ],
    searchSources: ["web", "industry-report", "local"],
    minSources: 5,
  },
  {
    id: "technology",
    name: "技术研发",
    description: "核心技术、创新、专利、人才",
    sortOrder: 5,
    searchQueries: [
      "{company} technology",
      "{company} research",
      "{company} innovation",
      "{company} patents",
    ],
    searchSources: ["github", "academic", "web"],
    minSources: 6,
  },
  {
    id: "market-position",
    name: "市场地位",
    description: "竞争定位、市场份额、差异化",
    sortOrder: 6,
    searchQueries: [
      "{company} market position",
      "{company} market share",
      "{company} competitive advantage",
      "{company} vs competitors",
    ],
    searchSources: ["web", "local"],
    minSources: 5,
  },
  {
    id: "strategy",
    name: "战略动态",
    description: "合作、并购、扩张、近期新闻",
    sortOrder: 7,
    searchQueries: [
      "{company} strategy",
      "{company} partnerships",
      "{company} acquisitions",
      "{company} expansion",
      "{company} news 2024 2025",
    ],
    searchSources: ["web", "hackernews"],
    minSources: 6,
  },
  {
    id: "swot",
    name: "SWOT 分析",
    description: "优势、劣势、机会、威胁",
    sortOrder: 8,
    searchQueries: [
      "{company} strengths weaknesses",
      "{company} opportunities threats",
      "{company} SWOT analysis",
      "{company} challenges",
    ],
    searchSources: ["web", "local"],
    minSources: 5,
  },
];

/**
 * 事件洞察维度参考框架（分析驱动型）
 *
 * 不作为固定模板使用，仅作为 Leader AI 的规划参考。
 * EVENT 类型的维度完全由 Leader 从文章内容和因果假设推导。
 */
export const EVENT_INSIGHT_REFERENCE_DIMENSIONS: DimensionTemplate[] = [
  {
    id: "event_core",
    name: "事件核心：发生了什么",
    description:
      "事件全貌还原：5W1H（谁、什么、何时、何地、为何、如何），关键时间线",
    sortOrder: 1,
    searchQueries: [
      "{topic} 事件全貌 时间线",
      "{topic} event timeline what happened",
      "{topic} key facts overview",
    ],
    searchSources: ["web", "news"],
    minSources: 5,
  },
  {
    id: "structural_context",
    name: "结构性背景：为什么会发生",
    description:
      "事件发生的深层结构性原因：行业周期、技术成熟度、政策窗口、竞争格局演变",
    sortOrder: 2,
    searchQueries: [
      "{topic} 深层原因 结构性背景",
      "{topic} root cause structural factors",
      "{topic} industry context background",
    ],
    searchSources: ["web", "academic"],
    minSources: 5,
  },
  {
    id: "trigger_and_timing",
    name: "触发与时机：为什么是现在",
    description: "直接触发因素、时间窗口分析、催化事件、竞争压力",
    sortOrder: 3,
    searchQueries: [
      "{topic} 触发因素 时机分析",
      "{topic} trigger timing catalyst",
      "{topic} why now precipitating factors",
    ],
    searchSources: ["web", "news"],
    minSources: 5,
  },
  {
    id: "stakeholder_map",
    name: "利益格局：谁受益谁受损",
    description: "关键利益相关方的立场、动机、博弈关系、权力不对称分析",
    sortOrder: 4,
    searchQueries: [
      "{topic} 利益相关方 受益 受损",
      "{topic} stakeholders winners losers",
      "{topic} impact analysis who benefits",
    ],
    searchSources: ["web", "news"],
    minSources: 5,
  },
  {
    id: "ripple_effects",
    name: "连锁反应：影响如何传导",
    description:
      "一阶影响（直接）→ 二阶影响（间接）→ 三阶影响（系统性），跨行业传导路径",
    sortOrder: 5,
    searchQueries: [
      "{topic} 影响 连锁反应 行业影响",
      "{topic} ripple effects industry impact",
      "{topic} second order effects implications",
    ],
    searchSources: ["web", "news"],
    minSources: 5,
  },
  {
    id: "historical_parallel",
    name: "历史对标：有无先例可循",
    description: "历史上类似事件的对比分析、结局复盘、经验教训、关键差异",
    sortOrder: 6,
    searchQueries: [
      "{topic} 历史先例 类似事件",
      "{topic} historical precedent similar events",
      "{topic} comparison past cases lessons",
    ],
    searchSources: ["web", "academic"],
    minSources: 5,
  },
  {
    id: "future_scenarios",
    name: "情景推演：接下来会怎样",
    description: "基准/乐观/悲观三种情景分析，关键变量识别，WWNBT 可证伪预测",
    sortOrder: 7,
    searchQueries: [
      "{topic} 未来展望 情景分析",
      "{topic} future scenarios outlook prediction",
      "{topic} what happens next forecast",
    ],
    searchSources: ["web", "news"],
    minSources: 5,
  },
];
