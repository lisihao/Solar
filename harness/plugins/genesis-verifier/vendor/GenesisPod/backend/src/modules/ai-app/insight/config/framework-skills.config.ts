/**
 * Framework Skills Configuration
 *
 * Layer 3 类型专属分析框架的唯一注册表。
 * 管理 topicType → 框架技能映射、研究深度推荐、对抗验证技能分配。
 *
 * 扩展模式：
 * - 新增主类型：FRAMEWORK_SKILLS_BY_TOPIC_TYPE + VALID_SKILLS + skill.md
 * - 新增 EVENT 子类型：EVENT_SUBTYPE_SKILLS + VALID_SKILLS + skill.md
 */

/**
 * 主类型 -> 框架技能映射
 * 使用字符串字面量而非 ResearchTopicType 枚举，避免测试环境下 Prisma client 未生成导致运行时错误
 */
export const FRAMEWORK_SKILLS_BY_TOPIC_TYPE: Record<string, string[]> = {
  MACRO: ["macro-analysis"],
  TECHNOLOGY: ["technology-analysis"],
  COMPANY: ["company-analysis"],
  EVENT: ["event-analysis"],
};

/**
 * EVENT 子类型 -> 附加技能映射（预留，EVENT 上线时启用）
 */
export const EVENT_SUBTYPE_SKILLS: Record<string, string[]> = {
  acquisition: ["event-ma"],
  policy: ["event-policy"],
  product: ["event-product-launch"],
  incident: ["event-crisis"],
  funding: ["event-funding"],
  geopolitical: ["event-geopolitical"],
  leadership: ["event-leadership"],
  tech_breakthrough: ["event-tech-breakthrough"],
};

/**
 * 根据主类型 + 子类型解析应注入的框架技能列表
 * @returns kebab-case skill IDs，可直接传给 chatWithSkills additionalSkills
 */
export function resolveFrameworkSkills(
  topicType: string,
  eventSubType?: string,
): string[] {
  const base = FRAMEWORK_SKILLS_BY_TOPIC_TYPE[topicType] || [];
  if (topicType === "EVENT" && eventSubType) {
    const sub = EVENT_SUBTYPE_SKILLS[eventSubType] || [];
    return [...base, ...sub];
  }
  return base;
}

/**
 * 类型 -> 推荐研究深度映射
 * Leader 会根据此推荐选择深度，thorough 深度自动包含 DEVIL_ADVOCATE 角色
 * 参考: ROLE_RECOMMENDATIONS_BY_DEPTH (agent-roles.config.ts:580-598)
 */
export const RECOMMENDED_DEPTH_BY_TOPIC_TYPE: Record<
  string,
  "quick" | "standard" | "thorough"
> = {
  MACRO: "thorough",
  TECHNOLOGY: "standard",
  COMPANY: "thorough",
  EVENT: "thorough",
};

/**
 * 类型 -> 推荐附加 debate skills
 * 当 Leader 分配 DEVIL_ADVOCATE 时，这些 skills 会自动注入
 */
export const DEBATE_SKILLS_BY_TOPIC_TYPE: Record<string, string[]> = {
  MACRO: ["critical-thinking", "debate-argument-generator"],
  TECHNOLOGY: ["critical-thinking", "debate-argument-generator"],
  COMPANY: [
    "critical-thinking",
    "competitive-analysis",
    "debate-argument-generator",
  ],
  EVENT: ["critical-thinking", "debate-argument-generator"],
};

/**
 * 基于话题文本自动检测 EVENT 子类型（预留，EVENT 上线时启用）
 */
export function detectEventSubType(
  topicName: string,
  topicDescription?: string | null,
): string | undefined {
  const text = `${topicName} ${topicDescription || ""}`.toLowerCase();
  const patterns: Array<{ keywords: string[]; subType: string }> = [
    {
      keywords: ["收购", "并购", "合并", "acquisition", "merger", "m&a"],
      subType: "acquisition",
    },
    {
      keywords: [
        "政策",
        "法规",
        "法案",
        "监管",
        "regulation",
        "policy",
        "act",
        "compliance",
      ],
      subType: "policy",
    },
    {
      keywords: ["发布", "发售", "launch", "release", "unveil"],
      subType: "product",
    },
    {
      keywords: ["危机", "事故", "泄露", "breach", "crisis", "incident"],
      subType: "incident",
    },
    {
      keywords: ["融资", "ipo", "估值", "funding", "fundraise"],
      subType: "funding",
    },
    {
      keywords: [
        "地缘",
        "关税",
        "制裁",
        "贸易",
        "geopolitical",
        "tariff",
        "sanction",
      ],
      subType: "geopolitical",
    },
    {
      keywords: ["ceo", "cto", "离职", "任命", "resignation", "appoint"],
      subType: "leadership",
    },
    {
      keywords: ["突破", "里程碑", "breakthrough", "milestone"],
      subType: "tech_breakthrough",
    },
  ];
  for (const { keywords, subType } of patterns) {
    if (keywords.some((kw) => text.includes(kw))) return subType;
  }
  return undefined;
}
