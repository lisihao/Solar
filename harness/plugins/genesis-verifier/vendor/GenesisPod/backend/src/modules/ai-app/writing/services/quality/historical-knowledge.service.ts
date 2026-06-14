/**
 * HistoricalKnowledgeService - 历史知识库服务
 *
 * 核心职责：
 * - 管理历史朝代知识（称谓、服饰、礼仪、官制等）
 * - 检测内容中的历史错误
 * - 提供正确用法建议
 * - 初始化常见朝代知识
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

// ==================== 类型定义 ====================

/**
 * 历史知识条目
 */
export interface HistoricalKnowledgeEntry {
  dynasty: string;
  category: string;
  term: string;
  definition: string;
  correctUsage?: string;
  wrongUsage?: string;
  examples: string[];
}

/**
 * 历史错误检测结果
 */
export interface HistoricalErrorResult {
  hasErrors: boolean;
  errors: Array<{
    term: string;
    type: "anachronism" | "wrong_usage" | "mixed_dynasty";
    description: string;
    correctTerm?: string;
    suggestion: string;
  }>;
}

// ==================== 预设知识数据 ====================

/**
 * 秦朝历史知识 (221-207 BC)
 */
const QIN_DYNASTY_KNOWLEDGE: HistoricalKnowledgeEntry[] = [
  // 称谓
  {
    dynasty: "秦朝",
    category: "称谓",
    term: "皇帝",
    definition: "秦始皇创立的最高统治者称号",
    correctUsage: "统治者称号",
    examples: ["始皇帝", "皇帝陛下"],
  },
  {
    dynasty: "秦朝",
    category: "称谓",
    term: "朕",
    definition: "皇帝专用第一人称代词",
    correctUsage: "皇帝自称",
    wrongUsage: "臣民不可自称朕",
    examples: ["朕统六国", "朕心甚慰"],
  },
  {
    dynasty: "秦朝",
    category: "称谓",
    term: "臣",
    definition: "臣民对皇帝的自称",
    correctUsage: "对皇帝说话时自称",
    examples: ["臣叩见陛下", "臣遵命"],
  },
  {
    dynasty: "秦朝",
    category: "称谓",
    term: "陛下",
    definition: "对皇帝的尊称",
    correctUsage: "臣民对皇帝的称呼",
    examples: ["启禀陛下", "陛下圣明"],
  },
  {
    dynasty: "秦朝",
    category: "称谓",
    term: "黔首",
    definition: "对平民百姓的称呼",
    correctUsage: "官方对百姓的称呼",
    examples: ["黔首百姓", "天下黔首"],
  },

  // 官制
  {
    dynasty: "秦朝",
    category: "官制",
    term: "三公",
    definition: "丞相、太尉、御史大夫",
    correctUsage: "中央最高官职",
    examples: ["位列三公", "三公九卿"],
  },
  {
    dynasty: "秦朝",
    category: "官制",
    term: "丞相",
    definition: "辅佐皇帝总揽政务的最高行政长官",
    correctUsage: "行政首脑",
    examples: ["左丞相", "右丞相"],
  },
  {
    dynasty: "秦朝",
    category: "官制",
    term: "太尉",
    definition: "负责军事的最高武官",
    correctUsage: "军事首脑",
    examples: ["太尉统兵", "拜为太尉"],
  },
  {
    dynasty: "秦朝",
    category: "官制",
    term: "郡县制",
    definition: "秦朝推行的地方行政制度",
    correctUsage: "地方行政",
    examples: ["废分封立郡县", "郡守县令"],
  },
  {
    dynasty: "秦朝",
    category: "官制",
    term: "郡守",
    definition: "郡一级的行政长官",
    correctUsage: "地方官职",
    examples: ["郡守大人", "出任郡守"],
  },

  // 服饰
  {
    dynasty: "秦朝",
    category: "服饰",
    term: "玄衣纁裳",
    definition: "黑色上衣，浅红色下裳，秦朝礼服",
    correctUsage: "正式礼服",
    examples: ["身着玄衣纁裳", "玄衣纁裳朝见"],
  },
  {
    dynasty: "秦朝",
    category: "服饰",
    term: "通天冠",
    definition: "皇帝的礼冠",
    correctUsage: "皇帝服饰",
    examples: ["头戴通天冠", "通天冠冕"],
  },
  {
    dynasty: "秦朝",
    category: "服饰",
    term: "深衣",
    definition: "士人常服，上下连裁",
    correctUsage: "日常服饰",
    examples: ["一袭深衣", "深衣博带"],
  },

  // 礼仪
  {
    dynasty: "秦朝",
    category: "礼仪",
    term: "跪拜",
    definition: "见皇帝或长辈的行礼方式",
    correctUsage: "重大场合行礼",
    examples: ["叩首跪拜", "三跪九叩"],
  },
  {
    dynasty: "秦朝",
    category: "礼仪",
    term: "稽首",
    definition: "最高等级的跪拜礼",
    correctUsage: "对皇帝行礼",
    examples: ["稽首拜谢", "顿首稽首"],
  },

  // 货币
  {
    dynasty: "秦朝",
    category: "货币",
    term: "半两钱",
    definition: "秦朝统一货币",
    correctUsage: "交易场景",
    examples: ["秦半两", "铜钱半两"],
  },

  // 建筑
  {
    dynasty: "秦朝",
    category: "建筑",
    term: "阿房宫",
    definition: "秦朝著名宫殿",
    correctUsage: "宫殿名称",
    examples: ["修建阿房宫", "阿房宫殿"],
  },
  {
    dynasty: "秦朝",
    category: "建筑",
    term: "骊山陵",
    definition: "秦始皇陵墓",
    correctUsage: "陵墓名称",
    examples: ["修筑骊山陵", "骊山地宫"],
  },

  // 军事
  {
    dynasty: "秦朝",
    category: "军事",
    term: "虎符",
    definition: "调兵遣将的兵符",
    correctUsage: "军事场景",
    examples: ["持虎符调兵", "兵符验证"],
  },
  {
    dynasty: "秦朝",
    category: "军事",
    term: "长城",
    definition: "秦朝修建的防御工程",
    correctUsage: "军事防御",
    examples: ["修筑长城", "戍守长城"],
  },
];

/**
 * 汉朝历史知识 (202 BC-220 AD)
 */
const HAN_DYNASTY_KNOWLEDGE: HistoricalKnowledgeEntry[] = [
  // 称谓
  {
    dynasty: "汉朝",
    category: "称谓",
    term: "陛下",
    definition: "对皇帝的尊称",
    correctUsage: "臣民对皇帝的称呼",
    examples: ["启奏陛下", "陛下万岁"],
  },
  {
    dynasty: "汉朝",
    category: "称谓",
    term: "长公主",
    definition: "皇帝的姐妹或姑母",
    correctUsage: "皇族女性称号",
    examples: ["馆陶长公主", "长公主殿下"],
  },
  {
    dynasty: "汉朝",
    category: "称谓",
    term: "列侯",
    definition: "汉朝爵位，分为关内侯、列侯等",
    correctUsage: "爵位称呼",
    examples: ["封为列侯", "列侯之尊"],
  },
  {
    dynasty: "汉朝",
    category: "称谓",
    term: "郎官",
    definition: "皇帝侍从官",
    correctUsage: "宫廷官职",
    examples: ["侍郎", "郎中"],
  },

  // 官制
  {
    dynasty: "汉朝",
    category: "官制",
    term: "三公九卿",
    definition: "汉朝中央官制体系",
    correctUsage: "中央官职",
    examples: ["三公掌政，九卿分职", "位列九卿"],
  },
  {
    dynasty: "汉朝",
    category: "官制",
    term: "丞相",
    definition: "百官之首",
    correctUsage: "行政首脑",
    examples: ["丞相大人", "拜相封侯"],
  },
  {
    dynasty: "汉朝",
    category: "官制",
    term: "太尉",
    definition: "最高军事长官",
    correctUsage: "军事首脑",
    examples: ["大将军加太尉", "太尉府"],
  },
  {
    dynasty: "汉朝",
    category: "官制",
    term: "刺史",
    definition: "监察地方的官员",
    correctUsage: "监察官职",
    examples: ["州刺史", "刺史巡察"],
  },
  {
    dynasty: "汉朝",
    category: "官制",
    term: "太守",
    definition: "郡一级行政长官",
    correctUsage: "地方官职",
    examples: ["郡太守", "太守大人"],
  },
  {
    dynasty: "汉朝",
    category: "官制",
    term: "县令",
    definition: "县一级行政长官",
    correctUsage: "地方官职",
    examples: ["县令治县", "县令大人"],
  },

  // 服饰
  {
    dynasty: "汉朝",
    category: "服饰",
    term: "袍服",
    definition: "汉代流行的长袍",
    correctUsage: "日常服饰",
    examples: ["一袭长袍", "袍服博带"],
  },
  {
    dynasty: "汉朝",
    category: "服饰",
    term: "曲裾",
    definition: "汉代女子服饰，下摆呈曲线",
    correctUsage: "女性服饰",
    examples: ["曲裾深衣", "身着曲裾"],
  },
  {
    dynasty: "汉朝",
    category: "服饰",
    term: "襦裙",
    definition: "上襦下裙的女子服饰",
    correctUsage: "女性服饰",
    examples: ["红襦绿裙", "襦裙装扮"],
  },

  // 礼仪
  {
    dynasty: "汉朝",
    category: "礼仪",
    term: "拱手",
    definition: "见面行礼，双手抱拳",
    correctUsage: "日常行礼",
    examples: ["拱手作揖", "拱手行礼"],
  },
  {
    dynasty: "汉朝",
    category: "礼仪",
    term: "跪拜",
    definition: "正式场合行礼",
    correctUsage: "重大场合",
    examples: ["跪拜谢恩", "五体投地"],
  },

  // 货币
  {
    dynasty: "汉朝",
    category: "货币",
    term: "五铢钱",
    definition: "汉武帝时统一的货币",
    correctUsage: "交易场景",
    examples: ["一枚五铢", "铜钱五铢"],
  },

  // 建筑
  {
    dynasty: "汉朝",
    category: "建筑",
    term: "未央宫",
    definition: "西汉皇宫",
    correctUsage: "宫殿名称",
    examples: ["未央宫殿", "朝会未央宫"],
  },
  {
    dynasty: "汉朝",
    category: "建筑",
    term: "长乐宫",
    definition: "西汉太后居所",
    correctUsage: "宫殿名称",
    examples: ["长乐宫太后", "居于长乐宫"],
  },

  // 军事
  {
    dynasty: "汉朝",
    category: "军事",
    term: "羽林军",
    definition: "皇帝亲军",
    correctUsage: "禁军名称",
    examples: ["羽林郎", "羽林骑"],
  },
  {
    dynasty: "汉朝",
    category: "军事",
    term: "虎贲军",
    definition: "皇帝护卫军",
    correctUsage: "禁军名称",
    examples: ["虎贲勇士", "虎贲中郎将"],
  },
];

/**
 * 三国历史知识 (220-280)
 */
const THREE_KINGDOMS_KNOWLEDGE: HistoricalKnowledgeEntry[] = [
  // 称谓
  {
    dynasty: "三国",
    category: "称谓",
    term: "主公",
    definition: "部下对君主的称呼",
    correctUsage: "臣属对君主",
    examples: ["主公在上", "禀报主公"],
  },
  {
    dynasty: "三国",
    category: "称谓",
    term: "军师",
    definition: "主帅的谋士顾问",
    correctUsage: "谋士职称",
    examples: ["军师诸葛", "军师有何妙计"],
  },
  {
    dynasty: "三国",
    category: "称谓",
    term: "都督",
    definition: "军事统帅",
    correctUsage: "军事职称",
    examples: ["大都督", "都督水师"],
  },

  // 官制
  {
    dynasty: "三国",
    category: "官制",
    term: "丞相",
    definition: "最高行政长官",
    correctUsage: "行政首脑",
    examples: ["丞相诸葛亮", "拜为丞相"],
  },
  {
    dynasty: "三国",
    category: "官制",
    term: "大将军",
    definition: "最高军事长官",
    correctUsage: "军事首脑",
    examples: ["大将军曹操", "封大将军"],
  },
  {
    dynasty: "三国",
    category: "官制",
    term: "录尚书事",
    definition: "掌管尚书台政务",
    correctUsage: "重要官职",
    examples: ["录尚书事司马懿", "加录尚书事"],
  },
  {
    dynasty: "三国",
    category: "官制",
    term: "州牧",
    definition: "州一级最高长官",
    correctUsage: "地方军政首脑",
    examples: ["益州牧刘璋", "荆州牧刘表"],
  },

  // 服饰
  {
    dynasty: "三国",
    category: "服饰",
    term: "战袍",
    definition: "武将的战斗服装",
    correctUsage: "军事服饰",
    examples: ["银甲战袍", "身披战袍"],
  },
  {
    dynasty: "三国",
    category: "服饰",
    term: "葛巾",
    definition: "葛布制成的头巾",
    correctUsage: "文士装扮",
    examples: ["纶巾葛巾", "头戴葛巾"],
  },

  // 礼仪
  {
    dynasty: "三国",
    category: "礼仪",
    term: "作揖",
    definition: "抱拳行礼",
    correctUsage: "日常行礼",
    examples: ["拱手作揖", "揖礼相见"],
  },
  {
    dynasty: "三国",
    category: "礼仪",
    term: "下拜",
    definition: "跪拜行礼",
    correctUsage: "正式场合",
    examples: ["拜倒在地", "拜谢恩德"],
  },

  // 货币
  {
    dynasty: "三国",
    category: "货币",
    term: "五铢钱",
    definition: "继承汉朝的货币",
    correctUsage: "交易场景",
    examples: ["五铢铜钱", "数枚五铢"],
  },

  // 建筑
  {
    dynasty: "三国",
    category: "建筑",
    term: "都督府",
    definition: "军事统帅的府邸",
    correctUsage: "军事机构",
    examples: ["大都督府", "都督府议事"],
  },

  // 军事
  {
    dynasty: "三国",
    category: "军事",
    term: "虎豹骑",
    definition: "曹操的精锐骑兵",
    correctUsage: "特种部队",
    examples: ["虎豹骑冲阵", "虎豹骑将"],
  },
  {
    dynasty: "三国",
    category: "军事",
    term: "白毦兵",
    definition: "蜀汉的精锐步兵",
    correctUsage: "特种部队",
    examples: ["白毦兵护卫", "白毦勇士"],
  },
  {
    dynasty: "三国",
    category: "军事",
    term: "弩兵",
    definition: "使用弩箭的兵种",
    correctUsage: "兵种名称",
    examples: ["弩兵射击", "列阵弩兵"],
  },
];

/**
 * 晋朝历史知识 (265-420)
 */
const JIN_DYNASTY_KNOWLEDGE: HistoricalKnowledgeEntry[] = [
  // 称谓
  {
    dynasty: "晋朝",
    category: "称谓",
    term: "陛下",
    definition: "对皇帝的尊称",
    correctUsage: "臣民对皇帝",
    examples: ["奏请陛下", "陛下圣明"],
  },
  {
    dynasty: "晋朝",
    category: "称谓",
    term: "郎君",
    definition: "对年轻男子的尊称",
    correctUsage: "对少年男子",
    examples: ["少年郎君", "王家郎君"],
  },
  {
    dynasty: "晋朝",
    category: "称谓",
    term: "娘子",
    definition: "对已婚女子的称呼",
    correctUsage: "对女性称呼",
    examples: ["娘子有礼", "这位娘子"],
  },

  // 官制
  {
    dynasty: "晋朝",
    category: "官制",
    term: "门阀士族",
    definition: "晋朝特有的世家大族政治力量",
    correctUsage: "社会阶层",
    examples: ["门阀望族", "士族子弟"],
  },
  {
    dynasty: "晋朝",
    category: "官制",
    term: "太傅",
    definition: "辅佐皇帝的高级官职",
    correctUsage: "三公之一",
    examples: ["太傅司马懿", "拜为太傅"],
  },
  {
    dynasty: "晋朝",
    category: "官制",
    term: "太保",
    definition: "辅佐皇帝的高级官职",
    correctUsage: "三公之一",
    examples: ["太保大人", "太保辅政"],
  },
  {
    dynasty: "晋朝",
    category: "官制",
    term: "中书省",
    definition: "掌管机要文书的机构",
    correctUsage: "中央机构",
    examples: ["中书监", "中书令"],
  },

  // 服饰
  {
    dynasty: "晋朝",
    category: "服饰",
    term: "襦裙",
    definition: "女子常服",
    correctUsage: "女性服饰",
    examples: ["对襟襦裙", "襦裙装束"],
  },
  {
    dynasty: "晋朝",
    category: "服饰",
    term: "幞头",
    definition: "男子头巾",
    correctUsage: "男性头饰",
    examples: ["头戴幞头", "幞头纶巾"],
  },

  // 礼仪
  {
    dynasty: "晋朝",
    category: "礼仪",
    term: "长揖",
    definition: "拱手行礼，身体前倾",
    correctUsage: "士人行礼",
    examples: ["长揖不拜", "长揖而去"],
  },

  // 货币
  {
    dynasty: "晋朝",
    category: "货币",
    term: "五铢钱",
    definition: "沿用汉制的货币",
    correctUsage: "交易场景",
    examples: ["五铢铜钱", "数贯铜钱"],
  },

  // 建筑
  {
    dynasty: "晋朝",
    category: "建筑",
    term: "太极殿",
    definition: "晋朝宫殿",
    correctUsage: "宫殿名称",
    examples: ["太极殿朝会", "太极殿上"],
  },

  // 军事
  {
    dynasty: "晋朝",
    category: "军事",
    term: "北府军",
    definition: "东晋著名军队",
    correctUsage: "军队名称",
    examples: ["北府健儿", "北府兵马"],
  },
];

/**
 * 南北朝历史知识 (420-589)
 */
const NORTHERN_SOUTHERN_DYNASTIES_KNOWLEDGE: HistoricalKnowledgeEntry[] = [
  // 称谓
  {
    dynasty: "南北朝",
    category: "称谓",
    term: "陛下",
    definition: "对皇帝的尊称",
    correctUsage: "臣民对皇帝",
    examples: ["启奏陛下", "陛下明鉴"],
  },
  {
    dynasty: "南北朝",
    category: "称谓",
    term: "娘子",
    definition: "对女子的通用称呼",
    correctUsage: "对女性称呼",
    examples: ["娘子请", "这位娘子"],
  },

  // 官制
  {
    dynasty: "南北朝",
    category: "官制",
    term: "尚书省",
    definition: "中央行政机构",
    correctUsage: "中央官署",
    examples: ["尚书令", "尚书台"],
  },
  {
    dynasty: "南北朝",
    category: "官制",
    term: "节度使",
    definition: "地方军政长官（北朝）",
    correctUsage: "地方军政首脑",
    examples: ["节度使大人", "都督节度"],
  },

  // 服饰
  {
    dynasty: "南北朝",
    category: "服饰",
    term: "襦裙",
    definition: "女子服饰",
    correctUsage: "女性服饰",
    examples: ["间色襦裙", "襦裙装束"],
  },
  {
    dynasty: "南北朝",
    category: "服饰",
    term: "胡服",
    definition: "受北方少数民族影响的服饰",
    correctUsage: "服饰类型",
    examples: ["身着胡服", "胡服骑射"],
  },

  // 礼仪
  {
    dynasty: "南北朝",
    category: "礼仪",
    term: "稽首",
    definition: "正式跪拜礼",
    correctUsage: "重大场合",
    examples: ["稽首拜谢", "顿首稽首"],
  },

  // 货币
  {
    dynasty: "南北朝",
    category: "货币",
    term: "五铢钱",
    definition: "通用货币",
    correctUsage: "交易场景",
    examples: ["五铢铜钱", "铜钱交易"],
  },

  // 军事
  {
    dynasty: "南北朝",
    category: "军事",
    term: "府兵制",
    definition: "西魏北周的兵制",
    correctUsage: "军事制度",
    examples: ["府兵出征", "府兵之制"],
  },
];

/**
 * 隋朝历史知识 (581-618)
 */
const SUI_DYNASTY_KNOWLEDGE: HistoricalKnowledgeEntry[] = [
  // 称谓
  {
    dynasty: "隋朝",
    category: "称谓",
    term: "圣上",
    definition: "对皇帝的尊称",
    correctUsage: "臣民对皇帝",
    examples: ["启奏圣上", "圣上在上"],
  },
  {
    dynasty: "隋朝",
    category: "称谓",
    term: "娘子",
    definition: "对女子的称呼",
    correctUsage: "对女性称呼",
    examples: ["娘子有礼", "这位娘子"],
  },

  // 官制
  {
    dynasty: "隋朝",
    category: "官制",
    term: "三省六部",
    definition: "隋朝确立的中央官制",
    correctUsage: "中央行政",
    examples: ["三省分权", "六部分职"],
  },
  {
    dynasty: "隋朝",
    category: "官制",
    term: "尚书省",
    definition: "执行政令的机构",
    correctUsage: "中央机构",
    examples: ["尚书省令", "尚书左仆射"],
  },
  {
    dynasty: "隋朝",
    category: "官制",
    term: "中书省",
    definition: "起草诏令的机构",
    correctUsage: "中央机构",
    examples: ["中书令", "中书舍人"],
  },
  {
    dynasty: "隋朝",
    category: "官制",
    term: "门下省",
    definition: "审核政令的机构",
    correctUsage: "中央机构",
    examples: ["门下侍中", "门下省驳回"],
  },
  {
    dynasty: "隋朝",
    category: "官制",
    term: "科举制",
    definition: "隋朝创立的选官制度",
    correctUsage: "选官制度",
    examples: ["科举取士", "开科取士"],
  },

  // 服饰
  {
    dynasty: "隋朝",
    category: "服饰",
    term: "襦裙",
    definition: "女子常服",
    correctUsage: "女性服饰",
    examples: ["襦裙装扮", "短襦长裙"],
  },
  {
    dynasty: "隋朝",
    category: "服饰",
    term: "圆领袍",
    definition: "男子常服",
    correctUsage: "男性服饰",
    examples: ["圆领袍服", "身着圆领袍"],
  },

  // 礼仪
  {
    dynasty: "隋朝",
    category: "礼仪",
    term: "叩首",
    definition: "正式跪拜礼",
    correctUsage: "重大场合",
    examples: ["叩首谢恩", "三叩九拜"],
  },

  // 货币
  {
    dynasty: "隋朝",
    category: "货币",
    term: "五铢钱",
    definition: "沿用前朝货币",
    correctUsage: "交易场景",
    examples: ["五铢铜钱", "铜钱交易"],
  },

  // 建筑
  {
    dynasty: "隋朝",
    category: "建筑",
    term: "大运河",
    definition: "隋朝修建的南北大运河",
    correctUsage: "水利工程",
    examples: ["开凿运河", "运河漕运"],
  },
  {
    dynasty: "隋朝",
    category: "建筑",
    term: "大兴城",
    definition: "隋朝都城（长安）",
    correctUsage: "都城名称",
    examples: ["大兴城内", "入京大兴"],
  },

  // 军事
  {
    dynasty: "隋朝",
    category: "军事",
    term: "府兵制",
    definition: "隋朝军事制度",
    correctUsage: "军事制度",
    examples: ["府兵征战", "府兵之制"],
  },
];

/**
 * 唐朝历史知识 (618-907)
 */
const TANG_DYNASTY_KNOWLEDGE: HistoricalKnowledgeEntry[] = [
  // 称谓
  {
    dynasty: "唐朝",
    category: "称谓",
    term: "圣上",
    definition: "对皇帝的尊称",
    correctUsage: "臣民对皇帝",
    examples: ["启奏圣上", "圣上明鉴"],
  },
  {
    dynasty: "唐朝",
    category: "称谓",
    term: "娘子",
    definition: "对女子的通用称呼",
    correctUsage: "对女性称呼",
    examples: ["娘子请", "这位娘子"],
  },
  {
    dynasty: "唐朝",
    category: "称谓",
    term: "郎君",
    definition: "对年轻男子的称呼",
    correctUsage: "对男子称呼",
    examples: ["郎君留步", "这位郎君"],
  },
  {
    dynasty: "唐朝",
    category: "称谓",
    term: "公主",
    definition: "皇帝之女的称号",
    correctUsage: "皇族女性称号",
    examples: ["太平公主", "公主殿下"],
  },
  {
    dynasty: "唐朝",
    category: "称谓",
    term: "驸马",
    definition: "公主的丈夫",
    correctUsage: "皇族姻亲",
    examples: ["驸马都尉", "驸马爷"],
  },

  // 官制
  {
    dynasty: "唐朝",
    category: "官制",
    term: "三省六部",
    definition: "唐朝中央官制",
    correctUsage: "中央行政",
    examples: ["三省长官", "六部尚书"],
  },
  {
    dynasty: "唐朝",
    category: "官制",
    term: "节度使",
    definition: "地方军政长官",
    correctUsage: "地方军政首脑",
    examples: ["河东节度使", "节度使大人"],
  },
  {
    dynasty: "唐朝",
    category: "官制",
    term: "宰相",
    definition: "政府首脑（多人合称）",
    correctUsage: "行政首脑",
    examples: ["入阁拜相", "宰相大人"],
  },
  {
    dynasty: "唐朝",
    category: "官制",
    term: "御史台",
    definition: "监察机构",
    correctUsage: "监察机构",
    examples: ["御史弹劾", "御史大夫"],
  },

  // 服饰
  {
    dynasty: "唐朝",
    category: "服饰",
    term: "襦裙",
    definition: "女子常服",
    correctUsage: "女性服饰",
    examples: ["齐胸襦裙", "襦裙飘逸"],
  },
  {
    dynasty: "唐朝",
    category: "服饰",
    term: "圆领袍",
    definition: "男子常服",
    correctUsage: "男性服饰",
    examples: ["圆领袍服", "身着袍服"],
  },
  {
    dynasty: "唐朝",
    category: "服饰",
    term: "幞头",
    definition: "男子头饰",
    correctUsage: "男性头饰",
    examples: ["头戴幞头", "幞头圆领"],
  },
  {
    dynasty: "唐朝",
    category: "服饰",
    term: "披帛",
    definition: "女子肩部装饰",
    correctUsage: "女性配饰",
    examples: ["披帛飘飘", "肩披长帛"],
  },

  // 礼仪
  {
    dynasty: "唐朝",
    category: "礼仪",
    term: "叩首",
    definition: "正式跪拜礼",
    correctUsage: "重大场合",
    examples: ["叩首谢恩", "三叩九拜"],
  },
  {
    dynasty: "唐朝",
    category: "礼仪",
    term: "万福",
    definition: "女子行礼",
    correctUsage: "女子行礼",
    examples: ["敛衽万福", "福身行礼"],
  },

  // 货币
  {
    dynasty: "唐朝",
    category: "货币",
    term: "开元通宝",
    definition: "唐朝货币",
    correctUsage: "交易场景",
    examples: ["开元铜钱", "通宝一贯"],
  },

  // 建筑
  {
    dynasty: "唐朝",
    category: "建筑",
    term: "大明宫",
    definition: "唐朝主要宫殿",
    correctUsage: "宫殿名称",
    examples: ["大明宫朝会", "大明宫内"],
  },
  {
    dynasty: "唐朝",
    category: "建筑",
    term: "太极宫",
    definition: "唐朝宫殿",
    correctUsage: "宫殿名称",
    examples: ["太极宫殿", "太极殿上"],
  },

  // 军事
  {
    dynasty: "唐朝",
    category: "军事",
    term: "十六卫",
    definition: "唐朝禁军体系",
    correctUsage: "禁军名称",
    examples: ["左右十六卫", "禁卫军"],
  },
  {
    dynasty: "唐朝",
    category: "军事",
    term: "神策军",
    definition: "唐朝后期主要禁军",
    correctUsage: "禁军名称",
    examples: ["神策军将领", "神策兵马"],
  },
];

/**
 * 五代十国历史知识 (907-979)
 */
const FIVE_DYNASTIES_KNOWLEDGE: HistoricalKnowledgeEntry[] = [
  // 称谓
  {
    dynasty: "五代十国",
    category: "称谓",
    term: "陛下",
    definition: "对皇帝的尊称",
    correctUsage: "臣民对皇帝",
    examples: ["启奏陛下", "陛下圣明"],
  },
  {
    dynasty: "五代十国",
    category: "称谓",
    term: "郎君",
    definition: "对男子的称呼",
    correctUsage: "对男子称呼",
    examples: ["郎君留步", "这位郎君"],
  },

  // 官制
  {
    dynasty: "五代十国",
    category: "官制",
    term: "枢密院",
    definition: "掌管军事的机构",
    correctUsage: "军事机构",
    examples: ["枢密使", "枢密院议事"],
  },
  {
    dynasty: "五代十国",
    category: "官制",
    term: "节度使",
    definition: "地方军政长官",
    correctUsage: "地方军政首脑",
    examples: ["节度使割据", "节度使大人"],
  },

  // 服饰
  {
    dynasty: "五代十国",
    category: "服饰",
    term: "襦裙",
    definition: "女子服饰",
    correctUsage: "女性服饰",
    examples: ["襦裙装扮", "身着襦裙"],
  },

  // 礼仪
  {
    dynasty: "五代十国",
    category: "礼仪",
    term: "叩首",
    definition: "正式跪拜礼",
    correctUsage: "重大场合",
    examples: ["叩首谢恩", "拜倒在地"],
  },

  // 货币
  {
    dynasty: "五代十国",
    category: "货币",
    term: "铜钱",
    definition: "通用货币",
    correctUsage: "交易场景",
    examples: ["铜钱交易", "铜板若干"],
  },

  // 军事
  {
    dynasty: "五代十国",
    category: "军事",
    term: "禁军",
    definition: "朝廷直属军队",
    correctUsage: "军队名称",
    examples: ["禁军统领", "禁军将领"],
  },
];

/**
 * 宋朝历史知识 (960-1279)
 */
const SONG_DYNASTY_KNOWLEDGE: HistoricalKnowledgeEntry[] = [
  // 称谓
  {
    dynasty: "宋朝",
    category: "称谓",
    term: "官家",
    definition: "对皇帝的尊称（宋朝特有）",
    correctUsage: "臣民对皇帝",
    examples: ["启奏官家", "官家圣明"],
  },
  {
    dynasty: "宋朝",
    category: "称谓",
    term: "娘子",
    definition: "对女子的称呼",
    correctUsage: "对女性称呼",
    examples: ["娘子请", "这位娘子"],
  },
  {
    dynasty: "宋朝",
    category: "称谓",
    term: "相公",
    definition: "对官员或丈夫的尊称",
    correctUsage: "对男子尊称",
    examples: ["相公请", "王相公"],
  },
  {
    dynasty: "宋朝",
    category: "称谓",
    term: "小娘子",
    definition: "对年轻女子的称呼",
    correctUsage: "对年轻女性",
    examples: ["小娘子留步", "这位小娘子"],
  },

  // 官制
  {
    dynasty: "宋朝",
    category: "官制",
    term: "枢密院",
    definition: "掌管军事的最高机构",
    correctUsage: "军事机构",
    examples: ["枢密使", "枢密院议事"],
  },
  {
    dynasty: "宋朝",
    category: "官制",
    term: "中书门下",
    definition: "最高行政机构",
    correctUsage: "行政机构",
    examples: ["中书门下平章事", "宰执大臣"],
  },
  {
    dynasty: "宋朝",
    category: "官制",
    term: "三司",
    definition: "掌管财政的机构",
    correctUsage: "财政机构",
    examples: ["三司使", "三司理财"],
  },
  {
    dynasty: "宋朝",
    category: "官制",
    term: "转运使",
    definition: "地方财政监察官",
    correctUsage: "地方官职",
    examples: ["转运使大人", "转运司"],
  },
  {
    dynasty: "宋朝",
    category: "官制",
    term: "知府",
    definition: "府一级行政长官",
    correctUsage: "地方官职",
    examples: ["知府大人", "开封知府"],
  },
  {
    dynasty: "宋朝",
    category: "官制",
    term: "知州",
    definition: "州一级行政长官",
    correctUsage: "地方官职",
    examples: ["知州大人", "州府知州"],
  },

  // 服饰
  {
    dynasty: "宋朝",
    category: "服饰",
    term: "背子",
    definition: "宋代女子外衣",
    correctUsage: "女性服饰",
    examples: ["身着背子", "背子长裙"],
  },
  {
    dynasty: "宋朝",
    category: "服饰",
    term: "襦裙",
    definition: "女子常服",
    correctUsage: "女性服饰",
    examples: ["襦裙装扮", "短襦长裙"],
  },
  {
    dynasty: "宋朝",
    category: "服饰",
    term: "直裰",
    definition: "士人服饰",
    correctUsage: "文士服饰",
    examples: ["身着直裰", "直裰儒衫"],
  },
  {
    dynasty: "宋朝",
    category: "服饰",
    term: "幞头",
    definition: "官员头饰",
    correctUsage: "官员头饰",
    examples: ["展脚幞头", "头戴幞头"],
  },

  // 礼仪
  {
    dynasty: "宋朝",
    category: "礼仪",
    term: "叩首",
    definition: "正式跪拜礼",
    correctUsage: "重大场合",
    examples: ["叩首谢恩", "三叩九拜"],
  },
  {
    dynasty: "宋朝",
    category: "礼仪",
    term: "拱手",
    definition: "日常行礼",
    correctUsage: "日常行礼",
    examples: ["拱手作揖", "拱手行礼"],
  },
  {
    dynasty: "宋朝",
    category: "礼仪",
    term: "万福",
    definition: "女子行礼",
    correctUsage: "女子行礼",
    examples: ["福身万福", "敛衽行礼"],
  },

  // 货币
  {
    dynasty: "宋朝",
    category: "货币",
    term: "交子",
    definition: "世界最早的纸币",
    correctUsage: "纸币交易",
    examples: ["一贯交子", "交子支付"],
  },
  {
    dynasty: "宋朝",
    category: "货币",
    term: "铜钱",
    definition: "铜质货币",
    correctUsage: "交易场景",
    examples: ["铜钱若干", "铜板交易"],
  },
  {
    dynasty: "宋朝",
    category: "货币",
    term: "贯",
    definition: "一千文铜钱为一贯",
    correctUsage: "货币单位",
    examples: ["十贯钱", "一贯铜钱"],
  },

  // 建筑
  {
    dynasty: "宋朝",
    category: "建筑",
    term: "大相国寺",
    definition: "开封著名寺庙",
    correctUsage: "寺庙名称",
    examples: ["大相国寺庙会", "相国寺内"],
  },

  // 军事
  {
    dynasty: "宋朝",
    category: "军事",
    term: "禁军",
    definition: "中央直属军队",
    correctUsage: "军队名称",
    examples: ["禁军统领", "殿前禁军"],
  },
  {
    dynasty: "宋朝",
    category: "军事",
    term: "厢军",
    definition: "地方驻军",
    correctUsage: "军队名称",
    examples: ["厢军守城", "地方厢军"],
  },
];

/**
 * 元朝历史知识 (1271-1368)
 */
const YUAN_DYNASTY_KNOWLEDGE: HistoricalKnowledgeEntry[] = [
  // 称谓
  {
    dynasty: "元朝",
    category: "称谓",
    term: "陛下",
    definition: "对皇帝的尊称",
    correctUsage: "臣民对皇帝",
    examples: ["启奏陛下", "陛下万岁"],
  },
  {
    dynasty: "元朝",
    category: "称谓",
    term: "大汗",
    definition: "蒙古语对皇帝的称呼",
    correctUsage: "蒙古族称呼",
    examples: ["大汗威武", "可汗大人"],
  },
  {
    dynasty: "元朝",
    category: "称谓",
    term: "娘子",
    definition: "对女子的称呼",
    correctUsage: "对女性称呼",
    examples: ["娘子请", "这位娘子"],
  },

  // 官制
  {
    dynasty: "元朝",
    category: "官制",
    term: "中书省",
    definition: "最高行政机构",
    correctUsage: "中央机构",
    examples: ["中书省丞相", "中书右丞"],
  },
  {
    dynasty: "元朝",
    category: "官制",
    term: "枢密院",
    definition: "最高军事机构",
    correctUsage: "军事机构",
    examples: ["枢密院副使", "枢密使大人"],
  },
  {
    dynasty: "元朝",
    category: "官制",
    term: "御史台",
    definition: "监察机构",
    correctUsage: "监察机构",
    examples: ["御史台弹劾", "御史中丞"],
  },
  {
    dynasty: "元朝",
    category: "官制",
    term: "行省",
    definition: "地方最高行政单位",
    correctUsage: "地方行政",
    examples: ["江浙行省", "行省平章"],
  },
  {
    dynasty: "元朝",
    category: "官制",
    term: "达鲁花赤",
    definition: "蒙古族地方长官",
    correctUsage: "地方官职",
    examples: ["达鲁花赤大人", "州县达鲁花赤"],
  },

  // 服饰
  {
    dynasty: "元朝",
    category: "服饰",
    term: "质孙服",
    definition: "蒙古族传统服饰",
    correctUsage: "蒙古族服饰",
    examples: ["身着质孙服", "质孙袍服"],
  },
  {
    dynasty: "元朝",
    category: "服饰",
    term: "襦裙",
    definition: "汉族女子服饰",
    correctUsage: "汉族女性服饰",
    examples: ["襦裙装扮", "汉家襦裙"],
  },

  // 礼仪
  {
    dynasty: "元朝",
    category: "礼仪",
    term: "叩首",
    definition: "正式跪拜礼",
    correctUsage: "重大场合",
    examples: ["叩首谢恩", "三叩九拜"],
  },

  // 货币
  {
    dynasty: "元朝",
    category: "货币",
    term: "中统钞",
    definition: "元朝纸币",
    correctUsage: "纸币交易",
    examples: ["中统宝钞", "钞票若干"],
  },
  {
    dynasty: "元朝",
    category: "货币",
    term: "至元钞",
    definition: "元朝后期纸币",
    correctUsage: "纸币交易",
    examples: ["至元宝钞", "宝钞支付"],
  },

  // 建筑
  {
    dynasty: "元朝",
    category: "建筑",
    term: "大都",
    definition: "元朝都城（今北京）",
    correctUsage: "都城名称",
    examples: ["大都城内", "进京大都"],
  },

  // 军事
  {
    dynasty: "元朝",
    category: "军事",
    term: "蒙古军",
    definition: "蒙古族军队",
    correctUsage: "军队名称",
    examples: ["蒙古铁骑", "蒙古军马"],
  },
  {
    dynasty: "元朝",
    category: "军事",
    term: "怯薛军",
    definition: "元朝禁卫军",
    correctUsage: "禁军名称",
    examples: ["怯薛卫士", "怯薛护卫"],
  },
];

/**
 * 明朝历史知识
 */
const MING_DYNASTY_KNOWLEDGE: HistoricalKnowledgeEntry[] = [
  // 称谓
  {
    dynasty: "明朝",
    category: "称谓",
    term: "皇上",
    definition: "对皇帝的尊称",
    correctUsage: "臣民对皇帝的称呼",
    wrongUsage: '皇帝自称（应用"朕"）',
    examples: ["微臣叩见皇上", "皇上龙体康健"],
  },
  {
    dynasty: "明朝",
    category: "称谓",
    term: "万岁爷",
    definition: "对皇帝的俗称，多用于宫中太监",
    correctUsage: "太监宫女称呼皇帝",
    examples: ["万岁爷驾到", "万岁爷用膳了"],
  },
  {
    dynasty: "明朝",
    category: "称谓",
    term: "娘娘",
    definition: "对皇后、妃嫔的尊称",
    correctUsage: "宫人对后妃的称呼",
    examples: ["皇后娘娘", "贵妃娘娘"],
  },
  {
    dynasty: "明朝",
    category: "称谓",
    term: "老爷",
    definition: "对官员、富商的尊称",
    correctUsage: "仆人对主人的称呼",
    examples: ["老爷请用茶", "回禀老爷"],
  },
  {
    dynasty: "明朝",
    category: "称谓",
    term: "姑娘",
    definition: "对未婚女子的称呼",
    correctUsage: "一般称呼",
    examples: ["这位姑娘", "小姑娘"],
  },
  {
    dynasty: "明朝",
    category: "称谓",
    term: "小姐",
    definition: "对官宦人家女儿的尊称",
    correctUsage: "仆人对小姐的称呼",
    wrongUsage: '明朝"小姐"是正经称呼，不同于现代含义',
    examples: ["大小姐", "二小姐"],
  },

  // 官制
  {
    dynasty: "明朝",
    category: "官制",
    term: "内阁",
    definition: "明朝中枢机构，协助皇帝处理政务",
    correctUsage: "政务讨论场景",
    examples: ["内阁议事", "入阁拜相"],
  },
  {
    dynasty: "明朝",
    category: "官制",
    term: "六部",
    definition: "吏、户、礼、兵、刑、工六部",
    correctUsage: "行政机构",
    examples: ["六部尚书", "吏部考核"],
  },
  {
    dynasty: "明朝",
    category: "官制",
    term: "锦衣卫",
    definition: "皇帝直属的侍卫和情报机构",
    correctUsage: "特务、护卫场景",
    examples: ["锦衣卫指挥使", "锦衣卫缇骑"],
  },
  {
    dynasty: "明朝",
    category: "官制",
    term: "东厂",
    definition: "由太监掌管的特务机构",
    correctUsage: "特务场景",
    examples: ["东厂番子", "东厂提督"],
  },

  // 服饰
  {
    dynasty: "明朝",
    category: "服饰",
    term: "凤冠霞帔",
    definition: "命妇正式礼服",
    correctUsage: "正式场合女性服饰",
    examples: ["凤冠霞帔盛装出席", "身着凤冠霞帔"],
  },
  {
    dynasty: "明朝",
    category: "服饰",
    term: "飞鱼服",
    definition: "锦衣卫专用服饰",
    correctUsage: "锦衣卫装扮",
    examples: ["身着飞鱼服", "飞鱼服配绣春刀"],
  },
  {
    dynasty: "明朝",
    category: "服饰",
    term: "袄裙",
    definition: "明朝女子常服，上袄下裙",
    correctUsage: "日常女性服饰",
    examples: ["一袭淡青袄裙", "换上袄裙"],
  },

  // 礼仪
  {
    dynasty: "明朝",
    category: "礼仪",
    term: "叩首",
    definition: "跪拜礼，头触地",
    correctUsage: "重大场合行礼",
    examples: ["三跪九叩", "叩首谢恩"],
  },
  {
    dynasty: "明朝",
    category: "礼仪",
    term: "万福",
    definition: "女子行礼时的祝词",
    correctUsage: "女子见礼",
    examples: ["福身道万福", "盈盈下拜"],
  },

  // 货币
  {
    dynasty: "明朝",
    category: "货币",
    term: "银两",
    definition: "明朝主要货币单位",
    correctUsage: "交易场景",
    wrongUsage: '避免使用"元"、"块"',
    examples: ["银子", "纹银", "碎银"],
  },
  {
    dynasty: "明朝",
    category: "货币",
    term: "铜钱",
    definition: "小额货币",
    correctUsage: "日常交易",
    examples: ["铜板", "文钱"],
  },
];

/**
 * 清朝历史知识
 */
const QING_DYNASTY_KNOWLEDGE: HistoricalKnowledgeEntry[] = [
  // 称谓
  {
    dynasty: "清朝",
    category: "称谓",
    term: "奴才",
    definition: "满人官员、太监对皇帝的自称",
    correctUsage: "满人对皇帝自称",
    wrongUsage: '汉人官员应自称"臣"',
    examples: ["奴才叩见皇上", "奴才遵旨"],
  },
  {
    dynasty: "清朝",
    category: "称谓",
    term: "主子",
    definition: "奴仆对主人的称呼",
    correctUsage: "满人家奴称呼",
    examples: ["主子吩咐", "给主子请安"],
  },
  {
    dynasty: "清朝",
    category: "称谓",
    term: "格格",
    definition: "清朝亲王、郡王之女的称号",
    correctUsage: "皇族女性称号",
    wrongUsage: "不是所有满族女子都称格格",
    examples: ["和硕格格", "多罗格格"],
  },
  {
    dynasty: "清朝",
    category: "称谓",
    term: "阿哥",
    definition: "皇子的称号",
    correctUsage: "对皇子的称呼",
    examples: ["大阿哥", "四阿哥"],
  },
  {
    dynasty: "清朝",
    category: "称谓",
    term: "贝勒",
    definition: "清朝爵位，位于亲王、郡王之下",
    correctUsage: "爵位称呼",
    examples: ["贝勒爷", "多罗贝勒"],
  },

  // 官制
  {
    dynasty: "清朝",
    category: "官制",
    term: "军机处",
    definition: "清朝最高决策机构",
    correctUsage: "政务场景",
    examples: ["军机大臣", "入值军机"],
  },
  {
    dynasty: "清朝",
    category: "官制",
    term: "八旗",
    definition: "清朝军事组织",
    correctUsage: "军事场景",
    examples: ["八旗子弟", "正黄旗"],
  },

  // 服饰
  {
    dynasty: "清朝",
    category: "服饰",
    term: "旗装",
    definition: "满族女子服饰",
    correctUsage: "满族女性装扮",
    examples: ["一袭旗装", "旗装打扮"],
  },
  {
    dynasty: "清朝",
    category: "服饰",
    term: "顶戴花翎",
    definition: "清朝官员帽饰",
    correctUsage: "官员装扮",
    examples: ["二品顶戴", "赏戴花翎"],
  },
  {
    dynasty: "清朝",
    category: "服饰",
    term: "辫子",
    definition: "清朝男子发式",
    correctUsage: "男子外貌描写",
    examples: ["一条大辫子", "金钱鼠尾"],
  },

  // 礼仪
  {
    dynasty: "清朝",
    category: "礼仪",
    term: "打千",
    definition: "满人特有的问安礼",
    correctUsage: "满人行礼",
    examples: ["打千问安", "屈膝打千"],
  },
  {
    dynasty: "清朝",
    category: "礼仪",
    term: "请安",
    definition: "清朝问候礼节",
    correctUsage: "日常问候",
    examples: ["给主子请安", "请安折"],
  },
];

/**
 * 常见历史错误（跨朝代混用）
 */
const COMMON_ANACHRONISMS: Array<{
  wrongTerm: string;
  correctDynasty: string;
  wrongDynasty: string;
  suggestion: string;
}> = [
  // 清朝 vs 明朝
  {
    wrongTerm: "军机处",
    correctDynasty: "清朝",
    wrongDynasty: "明朝",
    suggestion: '明朝应使用"内阁"',
  },
  {
    wrongTerm: "奴才",
    correctDynasty: "清朝",
    wrongDynasty: "明朝",
    suggestion: '明朝应使用"臣"或"微臣"',
  },
  {
    wrongTerm: "格格",
    correctDynasty: "清朝",
    wrongDynasty: "明朝",
    suggestion: '明朝应使用"郡主"、"县主"等',
  },
  {
    wrongTerm: "阿哥",
    correctDynasty: "清朝",
    wrongDynasty: "明朝",
    suggestion: '明朝应使用"殿下"、"皇子"',
  },
  {
    wrongTerm: "八旗",
    correctDynasty: "清朝",
    wrongDynasty: "明朝",
    suggestion: "明朝无八旗制度",
  },
  {
    wrongTerm: "辫子",
    correctDynasty: "清朝",
    wrongDynasty: "明朝",
    suggestion: "明朝男子蓄发，不剃头",
  },
  {
    wrongTerm: "打千",
    correctDynasty: "清朝",
    wrongDynasty: "明朝",
    suggestion: '明朝应使用"叩首"、"跪拜"',
  },
  {
    wrongTerm: "旗装",
    correctDynasty: "清朝",
    wrongDynasty: "明朝",
    suggestion: '明朝女子应穿"袄裙"',
  },
  // 明朝 vs 清朝
  {
    wrongTerm: "锦衣卫",
    correctDynasty: "明朝",
    wrongDynasty: "清朝",
    suggestion: '清朝应使用"粘杆处"或无对应机构',
  },
  {
    wrongTerm: "东厂",
    correctDynasty: "明朝",
    wrongDynasty: "清朝",
    suggestion: "清朝无东厂",
  },
  {
    wrongTerm: "内阁",
    correctDynasty: "明朝",
    wrongDynasty: "清朝",
    suggestion: '清朝应使用"军机处"',
  },
  // 宋朝特有
  {
    wrongTerm: "官家",
    correctDynasty: "宋朝",
    wrongDynasty: "明朝",
    suggestion: '明朝应使用"皇上"、"陛下"',
  },
  {
    wrongTerm: "官家",
    correctDynasty: "宋朝",
    wrongDynasty: "清朝",
    suggestion: '清朝应使用"皇上"、"圣上"',
  },
  {
    wrongTerm: "官家",
    correctDynasty: "宋朝",
    wrongDynasty: "唐朝",
    suggestion: '唐朝应使用"圣上"、"陛下"',
  },
  {
    wrongTerm: "交子",
    correctDynasty: "宋朝",
    wrongDynasty: "唐朝",
    suggestion: '唐朝应使用"开元通宝"等铜钱',
  },
  // 唐朝特有
  {
    wrongTerm: "节度使",
    correctDynasty: "唐朝",
    wrongDynasty: "汉朝",
    suggestion: '汉朝应使用"刺史"、"太守"',
  },
  {
    wrongTerm: "节度使",
    correctDynasty: "唐朝",
    wrongDynasty: "秦朝",
    suggestion: '秦朝应使用"郡守"',
  },
  {
    wrongTerm: "科举制",
    correctDynasty: "隋朝",
    wrongDynasty: "汉朝",
    suggestion: '汉朝应使用"察举制"',
  },
  {
    wrongTerm: "科举制",
    correctDynasty: "隋朝",
    wrongDynasty: "秦朝",
    suggestion: "秦朝无科举制度",
  },
  // 元朝特有
  {
    wrongTerm: "行省",
    correctDynasty: "元朝",
    wrongDynasty: "宋朝",
    suggestion: '宋朝应使用"路"、"州"、"府"',
  },
  {
    wrongTerm: "行省",
    correctDynasty: "元朝",
    wrongDynasty: "唐朝",
    suggestion: '唐朝应使用"道"、"州"',
  },
  {
    wrongTerm: "大汗",
    correctDynasty: "元朝",
    wrongDynasty: "明朝",
    suggestion: '明朝应使用"皇上"、"陛下"',
  },
  {
    wrongTerm: "达鲁花赤",
    correctDynasty: "元朝",
    wrongDynasty: "明朝",
    suggestion: "明朝无此官职",
  },
  // 三国特有
  {
    wrongTerm: "主公",
    correctDynasty: "三国",
    wrongDynasty: "唐朝",
    suggestion: '唐朝应使用"陛下"或其他称呼',
  },
  {
    wrongTerm: "主公",
    correctDynasty: "三国",
    wrongDynasty: "明朝",
    suggestion: '明朝应使用"皇上"、"陛下"',
  },
  {
    wrongTerm: "军师",
    correctDynasty: "三国",
    wrongDynasty: "明朝",
    suggestion: '明朝应使用"内阁首辅"、"谋士"',
  },
  // 秦朝特有
  {
    wrongTerm: "黔首",
    correctDynasty: "秦朝",
    wrongDynasty: "汉朝",
    suggestion: '汉朝应使用"百姓"、"庶民"',
  },
  {
    wrongTerm: "半两钱",
    correctDynasty: "秦朝",
    wrongDynasty: "汉朝",
    suggestion: '汉朝应使用"五铢钱"',
  },
  // 汉朝特有
  {
    wrongTerm: "五铢钱",
    correctDynasty: "汉朝",
    wrongDynasty: "秦朝",
    suggestion: '秦朝应使用"半两钱"',
  },
  {
    wrongTerm: "五铢钱",
    correctDynasty: "汉朝",
    wrongDynasty: "唐朝",
    suggestion: '唐朝应使用"开元通宝"',
  },
  {
    wrongTerm: "刺史",
    correctDynasty: "汉朝",
    wrongDynasty: "秦朝",
    suggestion: '秦朝应使用"郡守"',
  },
  // 货币跨朝代混用
  {
    wrongTerm: "银两",
    correctDynasty: "明朝",
    wrongDynasty: "秦朝",
    suggestion: '秦朝应使用"半两钱"',
  },
  {
    wrongTerm: "银两",
    correctDynasty: "明朝",
    wrongDynasty: "汉朝",
    suggestion: '汉朝应使用"五铢钱"',
  },
  {
    wrongTerm: "银两",
    correctDynasty: "明朝",
    wrongDynasty: "唐朝",
    suggestion: '唐朝应使用"开元通宝"',
  },
];

// ==================== 服务实现 ====================

@Injectable()
export class HistoricalKnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(HistoricalKnowledgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // 检查是否需要初始化知识库
    const count = await this.prisma.writingHistoricalKnowledge.count();
    if (count === 0) {
      this.logger.log("[HistoricalKnowledge] Initializing knowledge base...");
      await this.initializeKnowledgeBase();
    }
  }

  // ==================== 知识库初始化 ====================

  /**
   * 初始化知识库
   */
  async initializeKnowledgeBase(): Promise<void> {
    const allKnowledge = [
      ...QIN_DYNASTY_KNOWLEDGE,
      ...HAN_DYNASTY_KNOWLEDGE,
      ...THREE_KINGDOMS_KNOWLEDGE,
      ...JIN_DYNASTY_KNOWLEDGE,
      ...NORTHERN_SOUTHERN_DYNASTIES_KNOWLEDGE,
      ...SUI_DYNASTY_KNOWLEDGE,
      ...TANG_DYNASTY_KNOWLEDGE,
      ...FIVE_DYNASTIES_KNOWLEDGE,
      ...SONG_DYNASTY_KNOWLEDGE,
      ...YUAN_DYNASTY_KNOWLEDGE,
      ...MING_DYNASTY_KNOWLEDGE,
      ...QING_DYNASTY_KNOWLEDGE,
    ];

    for (const entry of allKnowledge) {
      try {
        await this.prisma.writingHistoricalKnowledge.upsert({
          where: {
            dynasty_category_term: {
              dynasty: entry.dynasty,
              category: entry.category,
              term: entry.term,
            },
          },
          create: {
            dynasty: entry.dynasty,
            category: entry.category,
            term: entry.term,
            definition: entry.definition,
            correctUsage: entry.correctUsage,
            wrongUsage: entry.wrongUsage,
            examples: entry.examples,
          },
          update: {
            definition: entry.definition,
            correctUsage: entry.correctUsage,
            wrongUsage: entry.wrongUsage,
            examples: entry.examples,
          },
        });
      } catch (error) {
        this.logger.error(
          `[HistoricalKnowledge] Failed to insert ${entry.term}: ${error}`,
        );
      }
    }

    this.logger.log(
      `[HistoricalKnowledge] Initialized ${allKnowledge.length} entries`,
    );
  }

  // ==================== 知识查询 ====================

  /**
   * 获取指定朝代的所有知识
   */
  async getKnowledgeByDynasty(
    dynasty: string,
  ): Promise<HistoricalKnowledgeEntry[]> {
    const entries = await this.prisma.writingHistoricalKnowledge.findMany({
      where: { dynasty },
    });

    return entries.map((e) => ({
      dynasty: e.dynasty,
      category: e.category,
      term: e.term,
      definition: e.definition,
      correctUsage: e.correctUsage || undefined,
      wrongUsage: e.wrongUsage || undefined,
      examples: e.examples,
    }));
  }

  /**
   * 获取指定分类的知识
   */
  async getKnowledgeByCategory(
    dynasty: string,
    category: string,
  ): Promise<HistoricalKnowledgeEntry[]> {
    const entries = await this.prisma.writingHistoricalKnowledge.findMany({
      where: { dynasty, category },
    });

    return entries.map((e) => ({
      dynasty: e.dynasty,
      category: e.category,
      term: e.term,
      definition: e.definition,
      correctUsage: e.correctUsage || undefined,
      wrongUsage: e.wrongUsage || undefined,
      examples: e.examples,
    }));
  }

  /**
   * 搜索术语
   */
  async searchTerm(term: string): Promise<HistoricalKnowledgeEntry | null> {
    const entry = await this.prisma.writingHistoricalKnowledge.findFirst({
      where: { term },
    });

    if (!entry) return null;

    return {
      dynasty: entry.dynasty,
      category: entry.category,
      term: entry.term,
      definition: entry.definition,
      correctUsage: entry.correctUsage || undefined,
      wrongUsage: entry.wrongUsage || undefined,
      examples: entry.examples,
    };
  }

  // ==================== 历史错误检测 ====================

  /**
   * 检测内容中的历史错误
   */
  async detectHistoricalErrors(
    content: string,
    targetDynasty: string,
  ): Promise<HistoricalErrorResult> {
    const errors: HistoricalErrorResult["errors"] = [];

    // 1. 检测跨朝代术语混用
    for (const anachronism of COMMON_ANACHRONISMS) {
      if (
        content.includes(anachronism.wrongTerm) &&
        targetDynasty === anachronism.wrongDynasty
      ) {
        errors.push({
          term: anachronism.wrongTerm,
          type: "anachronism",
          description: `"${anachronism.wrongTerm}" 是${anachronism.correctDynasty}术语，不适用于${anachronism.wrongDynasty}`,
          suggestion: anachronism.suggestion,
        });
      }
    }

    // 2. 检测目标朝代的错误用法
    const targetKnowledge = await this.getKnowledgeByDynasty(targetDynasty);

    for (const entry of targetKnowledge) {
      if (content.includes(entry.term) && entry.wrongUsage) {
        // 检查是否存在错误用法
        const wrongUsagePatterns = entry.wrongUsage.split("、");
        for (const pattern of wrongUsagePatterns) {
          if (content.includes(pattern)) {
            errors.push({
              term: entry.term,
              type: "wrong_usage",
              description: `"${entry.term}" 的用法可能有误：${entry.wrongUsage}`,
              suggestion: entry.correctUsage || "请查阅正确用法",
            });
            break;
          }
        }
      }
    }

    // 3. 检测现代词汇
    const modernTerms = [
      { term: "OK", suggestion: "好、可以、行" },
      { term: "搞定", suggestion: "办妥、完成" },
      { term: "尴尬", suggestion: "窘迫、不自在" },
      { term: "牛逼", suggestion: "厉害、了得" },
      { term: "给力", suggestion: "有力、得力" },
      { term: "靠谱", suggestion: "可靠、稳妥" },
      { term: "没问题", suggestion: "无妨、可以" },
      { term: "老板", suggestion: "东家、掌柜" },
      { term: "电话", suggestion: "（古代无此物）" },
      { term: "手机", suggestion: "（古代无此物）" },
    ];

    for (const modern of modernTerms) {
      if (content.includes(modern.term)) {
        errors.push({
          term: modern.term,
          type: "anachronism",
          description: `"${modern.term}" 是现代词汇，古代不存在`,
          correctTerm: modern.suggestion,
          suggestion: `请使用古代词汇：${modern.suggestion}`,
        });
      }
    }

    return {
      hasErrors: errors.length > 0,
      errors,
    };
  }

  // ==================== 提示词生成 ====================

  /**
   * 生成历史知识约束提示词
   */
  async generateHistoricalConstraintPrompt(dynasty: string): Promise<string> {
    const knowledge = await this.getKnowledgeByDynasty(dynasty);

    if (knowledge.length === 0) {
      return "";
    }

    const parts: string[] = [`## ${dynasty}历史知识约束\n`];

    // 按分类分组
    const byCategory = new Map<string, HistoricalKnowledgeEntry[]>();
    for (const entry of knowledge) {
      if (!byCategory.has(entry.category)) {
        byCategory.set(entry.category, []);
      }
      byCategory.get(entry.category)!.push(entry);
    }

    for (const [category, entries] of byCategory) {
      parts.push(`### ${category}`);
      for (const entry of entries.slice(0, 10)) {
        let line = `- **${entry.term}**: ${entry.definition}`;
        if (entry.correctUsage) {
          line += ` (${entry.correctUsage})`;
        }
        parts.push(line);
      }
      parts.push("");
    }

    // 添加跨朝代禁忌
    const wrongTerms = COMMON_ANACHRONISMS.filter(
      (a) => a.wrongDynasty === dynasty,
    );

    if (wrongTerms.length > 0) {
      parts.push("### 禁用术语（属于其他朝代）");
      for (const wrong of wrongTerms) {
        parts.push(`- ❌ ${wrong.wrongTerm} → ${wrong.suggestion}`);
      }
    }

    return parts.join("\n");
  }

  // ==================== 知识管理 ====================

  /**
   * 添加新知识条目
   */
  async addKnowledgeEntry(entry: HistoricalKnowledgeEntry): Promise<void> {
    await this.prisma.writingHistoricalKnowledge.create({
      data: {
        dynasty: entry.dynasty,
        category: entry.category,
        term: entry.term,
        definition: entry.definition,
        correctUsage: entry.correctUsage,
        wrongUsage: entry.wrongUsage,
        examples: entry.examples,
      },
    });

    this.logger.log(
      `[HistoricalKnowledge] Added entry: ${entry.dynasty} - ${entry.term}`,
    );
  }

  /**
   * 获取知识库统计
   */
  async getKnowledgeStats(): Promise<{
    totalEntries: number;
    byDynasty: Record<string, number>;
    byCategory: Record<string, number>;
  }> {
    const [total, byDynasty, byCategory] = await Promise.all([
      this.prisma.writingHistoricalKnowledge.count(),
      this.prisma.writingHistoricalKnowledge.groupBy({
        by: ["dynasty"],
        _count: true,
      }),
      this.prisma.writingHistoricalKnowledge.groupBy({
        by: ["category"],
        _count: true,
      }),
    ]);

    const dynastyStats: Record<string, number> = {};
    for (const item of byDynasty) {
      dynastyStats[item.dynasty] = item._count;
    }

    const categoryStats: Record<string, number> = {};
    for (const item of byCategory) {
      categoryStats[item.category] = item._count;
    }

    return {
      totalEntries: total,
      byDynasty: dynastyStats,
      byCategory: categoryStats,
    };
  }

  // ==================== 朝代识别 ====================

  /**
   * 支持的朝代列表及其关键词映射
   * 键：知识库中存储的朝代名称
   * 值：用于匹配的关键词列表
   */
  private static readonly DYNASTY_KEYWORDS: Record<string, string[]> = {
    秦朝: ["秦", "秦朝", "秦代", "大秦", "秦始皇", "嬴政"],
    汉朝: [
      "汉",
      "汉朝",
      "汉代",
      "西汉",
      "东汉",
      "两汉",
      "大汉",
      "汉武帝",
      "汉高祖",
      "刘邦",
      "刘彻",
    ],
    三国: ["三国", "曹魏", "蜀汉", "东吴", "魏蜀吴", "曹操", "刘备", "孙权"],
    晋朝: ["晋", "晋朝", "晋代", "西晋", "东晋", "两晋", "司马"],
    南北朝: [
      "南北朝",
      "南朝",
      "北朝",
      "刘宋",
      "南齐",
      "南梁",
      "南陈",
      "北魏",
      "北周",
      "北齐",
    ],
    隋朝: ["隋", "隋朝", "隋代", "大隋", "杨坚", "杨广", "隋炀帝"],
    唐朝: [
      "唐",
      "唐朝",
      "唐代",
      "大唐",
      "盛唐",
      "晚唐",
      "李世民",
      "武则天",
      "唐太宗",
    ],
    五代十国: [
      "五代",
      "十国",
      "五代十国",
      "后梁",
      "后唐",
      "后晋",
      "后汉",
      "后周",
    ],
    宋朝: ["宋", "宋朝", "宋代", "北宋", "南宋", "两宋", "大宋", "赵匡胤"],
    元朝: ["元", "元朝", "元代", "大元", "蒙元", "忽必烈", "成吉思汗"],
    明朝: [
      "明",
      "明朝",
      "明代",
      "大明",
      "朱元璋",
      "永乐",
      "嘉靖",
      "万历",
      "崇祯",
    ],
    清朝: [
      "清",
      "清朝",
      "清代",
      "大清",
      "满清",
      "康熙",
      "雍正",
      "乾隆",
      "慈禧",
    ],
  };

  /**
   * 从世界类型描述中智能识别朝代
   * @param worldType 项目的世界类型描述，如 "半架空历史（基于西汉实录）"
   * @returns 知识库中对应的朝代名称，如 "汉朝"；未匹配则返回 null
   */
  detectDynastyFromWorldType(
    worldType: string | undefined | null,
  ): string | null {
    if (!worldType) {
      return null;
    }

    // 遍历所有朝代关键词，找到匹配的朝代
    for (const [dynasty, keywords] of Object.entries(
      HistoricalKnowledgeService.DYNASTY_KEYWORDS,
    )) {
      for (const keyword of keywords) {
        if (worldType.includes(keyword)) {
          this.logger.debug(
            `[HistoricalKnowledge] Detected dynasty "${dynasty}" from worldType "${worldType}" (matched: "${keyword}")`,
          );
          return dynasty;
        }
      }
    }

    this.logger.warn(
      `[HistoricalKnowledge] Could not detect dynasty from worldType: "${worldType}"`,
    );
    return null;
  }

  /**
   * 获取所有支持的朝代列表
   */
  getSupportedDynasties(): string[] {
    return Object.keys(HistoricalKnowledgeService.DYNASTY_KEYWORDS);
  }
}
