/**
 * Tool Categories —— 工具目录 UI 的分类【单一真源】
 *
 * ★ 原则（前后台统一，脚本焊死）：
 *   1. 单一真源：后端 ToolRegistry 注册的每个工具，必须在本文件的 toolId→细类
 *      映射中【有且仅有一个】归属；不允许"未分类"掉进'其他'。
 *   2. 职责分离（三套 category 各司其职，不混用）：
 *      - 本文件 = 工具目录 UI 的【展示细类】（20 类中文 + 主题色 + tab）
 *      - 后端 ToolCategory 粗枚举 = 【功能分类】，registry 索引/过滤/预算在用，不动
 *      - EXTERNAL_TOOL_DEFINITIONS.category = 【密钥管理 UI】分组，独立功能，不动
 *   3. 脚本看护：`npm run audit:tool-categories` 双向对账——后端真实 toolId 全部
 *      被本映射或 EXCLUDED 覆盖，否则 exit 1（pre-push + CI 焊死，杜绝再漂移）。
 *   新增后端工具后，必须在此登记归属，否则推送被拒。
 *
 * tab 分界原则 B = 是否调外部 HTTP 服务（不是 backend implemented 字段）。
 *   federal-register / arxiv-search / sec-edgar-search 等虽有 BaseTool 实现，
 *   本质调 .gov / arxiv.org / SEC 等外部 endpoint → API 服务工具 tab。
 *   平台自身能力（export-pdf 本地渲染 / agent-handoff 内部编排 / rag-search 查
 *   本地向量库 / text-generation 走 ai-engine LLM）才归内置工具 tab。
 *
 * 分类规则（MECE，4 字标签统一）：
 *   - API 服务工具 tab：13 类（网页/学术/抓取/语音/图像/金融/天气/政策/代码/招聘/通知/云端/社交发布）
 *   - 内置工具 tab：7 类（导出/文档/数据/执行/协作/生成/知识记忆）
 *   - 第三方信源 tab：industry-report* 专属（EXCLUDED_FROM_GENERAL_TABS）
 *
 * 注意：audio-generation 是平台 capability（router 决定走 elevenlabs/googleTts），
 *   归"内容生成"内置工具；elevenlabs / googleTts 是 provider 行，归"语音合成"
 *   API 服务工具——capability 和 provider 在两 tab 各出现一次，正常。
 */

export interface ToolCategoryTheme {
  border: string;
  headerBg: string;
  headerText: string;
  badge: string;
}

export type TabKind = 'api-services' | 'builtin';

export interface ToolCategoryDef {
  id: string;
  label: string; // 4 字中文 label
  order: number;
  tabKind: TabKind;
  toolIds: string[]; // 归属此 category 的所有 toolId 变体
  theme: ToolCategoryTheme;
}

/**
 * 20 个工具分类 = 13 API 服务工具 + 7 内置工具。
 *
 * order 在各自 tab 内独立递增（api-services 1-13；builtin 13-19，按数组顺序），
 * 两 tab 排序时用 CATEGORY_ORDER_KEYS 派生的 index（跨 tab order 值可重叠，无碍）。
 */
export const TOOL_CATEGORIES: ToolCategoryDef[] = [
  // ============ API 服务工具 tab（调外部 HTTP）============
  {
    id: 'web-search',
    label: '网页检索',
    order: 1,
    tabKind: 'api-services',
    toolIds: [
      'web-search',
      'tavily',
      'perplexity',
      'serper',
      'duckduckgo',
      'brave-search',
      'hackernews',
      'hackernews-search',
      'social-x-search',
      'youtube-search',
    ],
    theme: {
      border: 'border-blue-200',
      headerBg: 'bg-blue-50',
      headerText: 'text-blue-800',
      badge: 'bg-blue-100 text-blue-700',
    },
  },
  {
    id: 'academic-search',
    label: '学术检索',
    order: 2,
    tabKind: 'api-services',
    toolIds: [
      'arxiv',
      'arxiv-search',
      'semantic-scholar',
      'pubmed',
      'openalex',
      'openalex-search',
      'wiki-search',
      'wiki-page-read',
    ],
    theme: {
      border: 'border-purple-200',
      headerBg: 'bg-purple-50',
      headerText: 'text-purple-800',
      badge: 'bg-purple-100 text-purple-700',
    },
  },
  {
    id: 'content-extraction',
    label: '内容抓取',
    order: 3,
    tabKind: 'api-services',
    toolIds: [
      'jina',
      'firecrawl',
      'tavilyExtract',
      'tavily-extract',
      'web-scraper',
      'supadata',
      'youtube-transcript',
    ],
    theme: {
      border: 'border-emerald-200',
      headerBg: 'bg-emerald-50',
      headerText: 'text-emerald-800',
      badge: 'bg-emerald-100 text-emerald-700',
    },
  },
  {
    id: 'tts',
    label: '语音合成',
    order: 4,
    tabKind: 'api-services',
    toolIds: ['elevenlabs', 'googleTts', 'google-tts'],
    theme: {
      border: 'border-indigo-200',
      headerBg: 'bg-indigo-50',
      headerText: 'text-indigo-800',
      badge: 'bg-indigo-100 text-indigo-700',
    },
  },
  {
    id: 'image-search',
    label: '图像检索',
    order: 5,
    tabKind: 'api-services',
    toolIds: [
      'image-search',
      'serpapi',
      'serpapi-image-search',
      'bing-image-search',
      'google-image-search',
    ],
    theme: {
      border: 'border-pink-200',
      headerBg: 'bg-pink-50',
      headerText: 'text-pink-800',
      badge: 'bg-pink-100 text-pink-700',
    },
  },
  {
    id: 'finance',
    label: '金融数据',
    order: 6,
    tabKind: 'api-services',
    toolIds: [
      'alpha-vantage',
      'finance-api',
      'sec-edgar-search',
      'startuphub-startup',
    ],
    theme: {
      border: 'border-amber-200',
      headerBg: 'bg-amber-50',
      headerText: 'text-amber-800',
      badge: 'bg-amber-100 text-amber-700',
    },
  },
  {
    id: 'weather',
    label: '天气数据',
    order: 7,
    tabKind: 'api-services',
    toolIds: ['openweathermap', 'weather-api'],
    theme: {
      border: 'border-sky-200',
      headerBg: 'bg-sky-50',
      headerText: 'text-sky-800',
      badge: 'bg-sky-100 text-sky-700',
    },
  },
  {
    id: 'policy',
    label: '政策研究',
    order: 8,
    tabKind: 'api-services',
    toolIds: ['federal-register', 'congress-gov', 'whitehouse-news'],
    theme: {
      border: 'border-rose-200',
      headerBg: 'bg-rose-50',
      headerText: 'text-rose-800',
      badge: 'bg-rose-100 text-rose-700',
    },
  },
  {
    id: 'code-hosting',
    label: '代码托管',
    order: 9,
    tabKind: 'api-services',
    toolIds: ['github', 'github-search', 'gitlab', 'github-integration'],
    theme: {
      border: 'border-slate-200',
      headerBg: 'bg-slate-50',
      headerText: 'text-slate-800',
      badge: 'bg-slate-100 text-slate-700',
    },
  },
  {
    id: 'jobs',
    label: '招聘检索',
    order: 10,
    tabKind: 'api-services',
    toolIds: ['job-search'],
    theme: {
      border: 'border-cyan-200',
      headerBg: 'bg-cyan-50',
      headerText: 'text-cyan-800',
      badge: 'bg-cyan-100 text-cyan-700',
    },
  },
  {
    id: 'notifications',
    label: '通知推送',
    order: 11,
    tabKind: 'api-services',
    toolIds: ['email-sender', 'message-push', 'webhook-trigger'],
    theme: {
      border: 'border-orange-200',
      headerBg: 'bg-orange-50',
      headerText: 'text-orange-800',
      badge: 'bg-orange-100 text-orange-700',
    },
  },
  {
    id: 'cloud',
    label: '云端集成',
    order: 12,
    tabKind: 'api-services',
    toolIds: ['cloud-storage', 'calendar-integration'],
    theme: {
      border: 'border-teal-200',
      headerBg: 'bg-teal-50',
      headerText: 'text-teal-800',
      badge: 'bg-teal-100 text-teal-700',
    },
  },
  {
    id: 'social-publish',
    label: '社交发布',
    order: 13,
    tabKind: 'api-services',
    toolIds: ['wechat-mp-publish', 'xhs-publish', 'social-publish-status'],
    theme: {
      border: 'border-red-200',
      headerBg: 'bg-red-50',
      headerText: 'text-red-800',
      badge: 'bg-red-100 text-red-700',
    },
  },

  // ============ 内置工具 tab（平台自身能力，不调外部 endpoint）============
  {
    id: 'export',
    label: '文档导出',
    order: 13,
    tabKind: 'builtin',
    toolIds: ['export-docx', 'export-pdf', 'export-image', 'export-pptx'],
    theme: {
      border: 'border-stone-200',
      headerBg: 'bg-stone-50',
      headerText: 'text-stone-800',
      badge: 'bg-stone-100 text-stone-700',
    },
  },
  {
    id: 'document-processing',
    label: '文档处理',
    order: 14,
    tabKind: 'builtin',
    toolIds: [
      'file-parser',
      'document-diff',
      'file-conversion',
      'template-render',
    ],
    theme: {
      border: 'border-emerald-200',
      headerBg: 'bg-emerald-50',
      headerText: 'text-emerald-800',
      badge: 'bg-emerald-100 text-emerald-700',
    },
  },
  {
    id: 'data-processing',
    label: '数据处理',
    order: 15,
    tabKind: 'builtin',
    toolIds: ['data-validation', 'data-cleaning', 'data-analysis'],
    theme: {
      border: 'border-teal-200',
      headerBg: 'bg-teal-50',
      headerText: 'text-teal-800',
      badge: 'bg-teal-100 text-teal-700',
    },
  },
  {
    id: 'execution',
    label: '执行环境',
    order: 16,
    tabKind: 'builtin',
    toolIds: [
      'sql-executor',
      'container-executor',
      'ocr-recognition',
      'browser-context',
    ],
    theme: {
      border: 'border-amber-200',
      headerBg: 'bg-amber-50',
      headerText: 'text-amber-800',
      badge: 'bg-amber-100 text-amber-700',
    },
  },
  {
    id: 'collaboration',
    label: '协作编排',
    order: 17,
    tabKind: 'builtin',
    toolIds: [
      'consensus-mechanism',
      'agent-handoff',
      'agent-communication',
      'task-delegation',
      'workflow-orchestration',
      'human-approval',
    ],
    theme: {
      border: 'border-violet-200',
      headerBg: 'bg-violet-50',
      headerText: 'text-violet-800',
      badge: 'bg-violet-100 text-violet-700',
    },
  },
  {
    id: 'generation',
    label: '内容生成',
    order: 18,
    tabKind: 'builtin',
    toolIds: [
      'text-generation',
      'code-generation',
      'image-generation',
      'video-generation',
      'audio-generation',
      'structured-output',
    ],
    theme: {
      border: 'border-fuchsia-200',
      headerBg: 'bg-fuchsia-50',
      headerText: 'text-fuchsia-800',
      badge: 'bg-fuchsia-100 text-fuchsia-700',
    },
  },
  {
    id: 'knowledge-memory',
    label: '知识记忆',
    order: 19,
    tabKind: 'builtin',
    toolIds: [
      'rag-search',
      'knowledge-base',
      'knowledge-graph',
      'entity-memory',
      'user-preferences',
      'database-query',
      'data-fetch',
    ],
    theme: {
      border: 'border-lime-200',
      headerBg: 'bg-lime-50',
      headerText: 'text-lime-800',
      badge: 'bg-lime-100 text-lime-700',
    },
  },
];

/**
 * "其他"桶——未命中以上 18 类的 fallback。
 *
 * 同时为两 tab 服务（依然按 tabKind 路由："其他"在两 tab 里都可能出现，
 * 只有在该 tab 实际有未分类工具时才显示）。
 */
export const OTHER_CATEGORY: ToolCategoryDef = {
  id: 'other',
  label: '其他',
  order: 999,
  tabKind: 'builtin', // 仅类型占位，实际两 tab 都用
  toolIds: [],
  theme: {
    border: 'border-gray-200',
    headerBg: 'bg-gray-50',
    headerText: 'text-gray-700',
    badge: 'bg-gray-100 text-gray-600',
  },
};

/**
 * 第三方信源 tab 专属——不应在内置/API 服务工具 tab 出现的 toolId。
 *
 * industry-report 是抓取源能力，UI 在 admin/tools 第三方信源 tab 直接管理
 * config.sources，不需要在另两个 tab 重复露出。
 */
export const EXCLUDED_FROM_GENERAL_TABS = new Set<string>([
  'industry-report',
  'industry-report-search',
]);

/**
 * toolId → category 反向索引，启动时构建一次。
 */
const TOOL_ID_TO_CATEGORY: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const cat of TOOL_CATEGORIES) {
    for (const id of cat.toolIds) {
      map.set(id.toLowerCase(), cat.id);
    }
  }
  return map;
})();

/**
 * 把 toolId 归到 18 类之一或 'other'。
 *
 * @param toolId tool 唯一 id（不区分大小写）
 * @param fallbackBackendCategory backend `category` 字段兜底关键字匹配；
 *   仍未命中走 'other'。
 */
export function classifyToolId(
  toolId: string,
  fallbackBackendCategory?: string | null
): string {
  const direct = TOOL_ID_TO_CATEGORY.get(toolId.toLowerCase());
  if (direct) return direct;
  if (fallbackBackendCategory) {
    const cat = fallbackBackendCategory.toLowerCase();
    if (TOOL_CATEGORIES.some((c) => c.id === cat)) return cat;
  }
  return 'other';
}

export function getCategoryById(id: string): ToolCategoryDef {
  return TOOL_CATEGORIES.find((c) => c.id === id) ?? OTHER_CATEGORY;
}

/**
 * 返回给定 tab 的 categories（按 order 排序），用于 UI 渲染。
 */
export function categoriesForTab(kind: TabKind): ToolCategoryDef[] {
  return TOOL_CATEGORIES.filter((c) => c.tabKind === kind).sort(
    (a, b) => a.order - b.order
  );
}

/**
 * 判断 toolId 是否归属指定 tab。
 *
 * 策略：先 classify 到 category，再看该 category 的 tabKind。
 * 未命中 18 类（'other'）的 fallback：依据 backend category 字段做关键字
 * 启发——含 'external' / 'information' / 类外部关键字 → api-services；其余 → builtin。
 * 实战中绝大多数 toolId 都精确命中，'other' 路径只为兜底。
 */
export function toolBelongsToTab(
  toolId: string,
  tabKind: TabKind,
  fallbackBackendCategory?: string | null
): boolean {
  const catId = classifyToolId(toolId, fallbackBackendCategory);
  if (catId === 'other') {
    // 兜底启发：未分类工具，按 backend category 猜
    const cat = (fallbackBackendCategory || '').toLowerCase();
    const looksExternal =
      cat.includes('external') ||
      cat.includes('information') ||
      cat.includes('search') ||
      cat.includes('extraction');
    return tabKind === (looksExternal ? 'api-services' : 'builtin');
  }
  const cat = getCategoryById(catId);
  return cat.tabKind === tabKind;
}

/**
 * 给定 tab 的 filter <select> options（含"其他"和"全部"由调用方加）。
 */
export function categoryFilterOptionsForTab(
  kind: TabKind
): Array<{ value: string; label: string }> {
  return [
    ...categoriesForTab(kind).map((c) => ({ value: c.id, label: c.label })),
    { value: 'other', label: OTHER_CATEGORY.label },
  ];
}

/**
 * category 排序 key 列表（含 'other' 在最后），用于 grouped Map 排序。
 */
export const CATEGORY_ORDER_KEYS = [
  ...TOOL_CATEGORIES.map((c) => c.id),
  OTHER_CATEGORY.id,
];

/**
 * 全部 category 的下拉选项（不限 tab），暂保留兼容旧调用，后续清理。
 * @deprecated 用 categoryFilterOptionsForTab(kind) 替代
 */
export const CATEGORY_FILTER_OPTIONS = [
  ...TOOL_CATEGORIES.map((c) => ({ value: c.id, label: c.label })),
  { value: OTHER_CATEGORY.id, label: OTHER_CATEGORY.label },
];
