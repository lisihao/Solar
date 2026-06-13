/**
 * 中国历史知识库 - 类型定义
 *
 * 覆盖中国3000年历史，包括：
 * - 12个主要朝代的详细知识
 * - 约600个年号
 * - 约2000个重大事件
 * - 约3000个历史人物
 */

// ==================== 朝代知识 ====================

/**
 * 历史时期
 */
export interface HistoricalPeriod {
  name: string; // 时期名称，如"西汉"、"东汉"
  startYear: number; // 起始年份（公元前为负数）
  endYear: number; // 结束年份
  capital?: string; // 都城
  founder?: string; // 开国者
  description?: string; // 时期特征描述
}

/**
 * 知识条目
 */
export interface KnowledgeEntry {
  term: string; // 术语
  definition: string; // 定义
  correctUsage?: string; // 正确用法
  wrongUsage?: string; // 错误用法/禁忌
  examples: string[]; // 使用示例
  relatedTerms?: string[]; // 相关术语
  notes?: string; // 备注
}

/**
 * 朝代知识
 */
export interface DynastyKnowledge {
  dynasty: string; // 朝代名称
  aliases: string[]; // 别名，用于匹配
  periods: HistoricalPeriod[]; // 历史时期
  characteristics: string[]; // 时代特征
  categories: {
    称谓: KnowledgeEntry[];
    官制: KnowledgeEntry[];
    服饰: KnowledgeEntry[];
    礼仪: KnowledgeEntry[];
    货币: KnowledgeEntry[];
    建筑: KnowledgeEntry[];
    军事: KnowledgeEntry[];
    饮食: KnowledgeEntry[];
    交通: KnowledgeEntry[];
    文化: KnowledgeEntry[];
    科技: KnowledgeEntry[];
    宗教: KnowledgeEntry[];
    婚丧: KnowledgeEntry[];
    刑罚: KnowledgeEntry[];
    地理: KnowledgeEntry[];
  };
}

// ==================== 年号 ====================

/**
 * 年号条目
 */
export interface EraName {
  name: string; // 年号名称
  emperor: string; // 皇帝名/谥号
  dynasty: string; // 朝代
  startYear: number; // 起始年份
  endYear: number; // 结束年份
  duration: number; // 使用年数
  significance?: string; // 重要意义
}

// ==================== 重大事件 ====================

/**
 * 历史事件
 */
export interface HistoricalEvent {
  name: string; // 事件名称
  year: number; // 发生年份
  endYear?: number; // 结束年份（跨年事件）
  dynasty: string; // 朝代
  category:
    | "政治"
    | "军事"
    | "经济"
    | "文化"
    | "外交"
    | "自然灾害"
    | "科技"
    | "宗教";
  description: string; // 事件描述
  participants?: string[]; // 主要参与者
  location?: string; // 发生地点
  significance: string; // 历史意义
  consequences?: string[]; // 后果影响
}

// ==================== 历史人物 ====================

/**
 * 历史人物
 */
export interface HistoricalFigure {
  name: string; // 姓名
  aliases?: string[]; // 别名/字/号
  dynasty: string; // 所属朝代
  birthYear?: number; // 出生年份
  deathYear?: number; // 死亡年份
  category:
    | "帝王"
    | "后妃"
    | "宗室"
    | "文臣"
    | "武将"
    | "文人"
    | "科学家"
    | "商人"
    | "宗教人物"
    | "其他";
  title?: string; // 官职/爵位
  description: string; // 人物简介
  achievements?: string[]; // 主要成就
  relatedEvents?: string[]; // 相关事件
  relatedFigures?: string[]; // 相关人物
}

// ==================== 跨朝代禁忌 ====================

/**
 * 跨朝代禁忌（时代错误）
 */
export interface Anachronism {
  term: string; // 错误使用的术语
  correctDynasty: string; // 正确的朝代
  wrongDynasties: string[]; // 错误使用的朝代
  suggestion: string; // 修改建议
  explanation?: string; // 详细解释
}

// ==================== 知识库索引 ====================

/**
 * 知识库索引
 */
export interface KnowledgeIndex {
  version: string;
  lastUpdated: string;
  statistics: {
    totalDynasties: number;
    totalEntries: number;
    totalEraNames: number;
    totalEvents: number;
    totalFigures: number;
    totalAnachronisms: number;
  };
  dynasties: string[];
}
