/**
 * WorldBuildingEnhancerService - 世界观构建增强服务
 *
 * 核心职责：
 * - 检测故事时代背景，注入领域知识
 * - 增强专业角色的职业知识背景
 * - 验证世界观设定的完整性和自洽性
 * - 提供细节丰富的历史/专业参考
 *
 * 设计理念：
 * 1. 领域知识注入：不同时代有不同的社会规则、服饰、称谓、禁忌
 * 2. 专业知识映射：现代专业人士穿越，需要知道古代对应物
 * 3. 世界规则自洽：魔法体系、社会等级、权力结构要有内在逻辑
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  DYNASTIES,
  Dynasty,
  detectDynastyByKeywords,
} from "./knowledge-base/chinese-history.knowledge";

// ==================== 时代知识库 ====================

interface EraKnowledge {
  name: string;
  period: string;
  /** 社会结构 */
  socialStructure: {
    hierarchy: string[];
    keyInstitutions: string[];
    genderRoles: string;
  };
  /** 宫廷/权力中心 */
  powerCenter: {
    name: string;
    structure: string;
    keyRoles: string[];
  };
  /** 日常生活 */
  dailyLife: {
    clothing: string[];
    food: string[];
    transportation: string[];
    housing: string;
  };
  /** 称谓系统 */
  honorifics: {
    royal: Record<string, string>;
    official: Record<string, string>;
    common: Record<string, string>;
  };
  /** 禁忌 */
  taboos: string[];
  /** 重要术语 */
  terminology: Record<string, string>;
  /** 相关专业知识（如古代化妆、医术等） */
  domainKnowledge: Record<string, DomainKnowledge>;
}

interface DomainKnowledge {
  name: string;
  ancientEquivalent: string;
  tools: string[];
  materials: string[];
  techniques: string[];
  socialRole: string;
  conflicts: string[];
}

const ERA_KNOWLEDGE: Record<string, EraKnowledge> = {
  西汉: {
    name: "西汉",
    period: "公元前202年-公元8年",
    socialStructure: {
      hierarchy: [
        "皇帝（天子）",
        "诸侯王",
        "列侯",
        "公卿（三公九卿）",
        "官吏",
        "士人",
        "庶民",
        "奴婢",
      ],
      keyInstitutions: [
        "三公九卿制",
        "郡国并行制",
        "察举制（选官）",
        "盐铁官营",
      ],
      genderRoles:
        "女性地位相对较高（相比后世），太后可临朝称制，但仍受礼教约束。后宫等级：皇后、夫人、美人、良人、八子、七子、长使、少使。",
    },
    powerCenter: {
      name: "未央宫（长安）",
      structure:
        "前殿理政，后宫居住。重要场所：宣室殿（召见大臣）、椒房殿（皇后居所）、长乐宫（太后居所）",
      keyRoles: [
        "丞相（行政首脑）",
        "太尉（军事）",
        "御史大夫（监察）",
        "中常侍（近侍）",
        "尚书令（机要）",
        "少府（皇室财务）",
      ],
    },
    dailyLife: {
      clothing: [
        "深衣（曲裾、直裾）",
        "襦裙",
        "袍服",
        "冠（男）、笄（女）",
        "履或屐",
      ],
      food: [
        "粟米为主",
        "羊肉贵重",
        "酱（调味）",
        "酒（米酒）",
        "豆腐尚未普及",
      ],
      transportation: ["牛车（尊贵）", "马车", "骑马", "步行"],
      housing: "院落式建筑，贵族有多进院落，屋内铺席坐卧（无椅子）",
    },
    honorifics: {
      royal: {
        皇帝: "陛下、圣上",
        太后: "太后、母后",
        皇后: "皇后、中宫",
        皇子: "殿下",
        公主: "殿下、长公主",
      },
      official: {
        上级: "大人、明府",
        同级: "君、足下",
        下级: "尔、汝",
      },
      common: {
        自称: "臣、妾、奴婢、小人",
        尊称: "君、公、先生",
        谦称: "鄙人、愚、仆",
      },
    },
    taboos: [
      "避讳皇帝名字（如汉武帝刘彻，需避'彻'字）",
      "不可僭越服色（黄色为皇家专用）",
      "不可直视天子",
      "女子不可随意抛头露面",
      "谋反、大不敬为重罪",
    ],
    terminology: {
      长安: "西汉都城，位于今陕西西安",
      未央宫: "皇帝主要居住和办公场所",
      长乐宫: "太后居所",
      少府: "掌管皇室财物和手工业的机构",
      织染署: "少府下属，负责宫廷织染",
      尚方: "制作御用器物的机构",
      掖庭: "后宫管理机构",
      暴室: "宫中惩罚宫人的场所",
    },
    domainKnowledge: {
      化妆品: {
        name: "古代妆容",
        ancientEquivalent: "脂粉、胭脂、眉黛",
        tools: ["铜镜", "妆奁", "眉笔（柳枝炭）", "粉扑"],
        materials: [
          "铅粉（有毒，美白）",
          "米粉（安全）",
          "红蓝花（胭脂原料）",
          "朱砂（口红，有毒）",
          "螺子黛（画眉）",
          "动物脂肪（膏基）",
          "香料（麝香、龙涎香）",
        ],
        techniques: [
          "三白妆（额、鼻、下巴涂白）",
          "远山眉（细长弯眉）",
          "花钿（额间装饰）",
          "面靥（脸颊点红）",
        ],
        socialRole:
          "妆容是身份象征，不同等级有不同妆容规定。面见贵人需妆容整齐。",
        conflicts: [
          "铅粉美白但有毒（现代人会意识到铅中毒风险）",
          "朱砂鲜艳但含汞（长期使用会中毒）",
          "天然材料氧化变色（胭脂易发黑）",
          "配方保密（宫中有专门的司妆女官）",
        ],
      },
      医术: {
        name: "古代医术",
        ancientEquivalent: "方技、医术",
        tools: ["针灸针", "砭石", "药碾", "药罐"],
        materials: ["本草（中药材）", "矿物药", "动物药"],
        techniques: ["望闻问切", "针灸", "汤药", "外敷"],
        socialRole: "太医令掌宫廷医疗，地位较高。女医少见但有存在。",
        conflicts: [
          "现代医学 vs 传统医学的理念冲突",
          "无菌概念的缺乏",
          "麻醉技术的原始",
        ],
      },
    },
  },

  唐代: {
    name: "唐代",
    period: "618年-907年",
    socialStructure: {
      hierarchy: [
        "皇帝",
        "亲王/公主",
        "国公",
        "郡公",
        "县公",
        "士族",
        "庶民",
        "奴婢",
      ],
      keyInstitutions: ["三省六部制", "科举制", "府兵制/募兵制", "均田制"],
      genderRoles:
        "唐代女性地位较高，可参与社交、骑马、着男装。武则天时期女性参政达到顶峰。后宫等级：皇后、四妃、九嫔、婕妤等。",
    },
    powerCenter: {
      name: "大明宫/太极宫（长安）",
      structure: "大明宫为主要宫殿群，含元殿朝会，麟德殿宴饮，大内后宫",
      keyRoles: [
        "宰相（同中书门下平章事）",
        "六部尚书",
        "翰林学士",
        "宦官（后期权重）",
      ],
    },
    dailyLife: {
      clothing: [
        "圆领袍（男）",
        "襦裙（女）",
        "半臂",
        "帔帛",
        "幞头（男帽）",
        "高髻（女发式）",
      ],
      food: ["面食流行", "胡饼", "羊肉", "茶饮兴起", "冰饮（夏季）"],
      transportation: ["马车", "牛车", "骑马（女性也可）", "轿子（晚唐）"],
      housing: "坊市制，贵族府邸多进院落，有园林",
    },
    honorifics: {
      royal: {
        皇帝: "陛下、圣人、大家",
        太后: "太后",
        皇后: "皇后、梓童",
        皇子: "殿下",
        公主: "殿下",
      },
      official: {
        上级: "相公、大人",
        同级: "君、足下、郎君",
        下级: "尔",
      },
      common: {
        自称: "臣、妾、奴、小的",
        尊称: "郎君、娘子、阿郎、阿娘",
        谦称: "仆、愚",
      },
    },
    taboos: [
      "避讳皇帝名字",
      "不可僭越服色",
      "科举舞弊重罪",
      "谋反、大不敬为重罪",
    ],
    terminology: {
      长安: "唐都城，百万人口的国际大都市",
      大明宫: "唐代主要皇宫",
      坊市: "城市区划制度，坊为居住区，市为商业区",
      进士: "科举考试最高等级",
      节度使: "地方军政长官",
    },
    domainKnowledge: {
      化妆品: {
        name: "唐代妆容",
        ancientEquivalent: "脂粉妆靥",
        tools: ["铜镜", "妆奁", "眉笔"],
        materials: [
          "铅粉",
          "胭脂（红蓝花、紫矿）",
          "花钿（金箔、翠羽）",
          "乌膏（画眉）",
        ],
        techniques: [
          "酒晕妆（红润）",
          "桃花妆",
          "飞霞妆",
          "蛾眉、柳叶眉",
          "花钿（额间装饰）",
          "斜红（太阳穴红晕）",
          "面靥",
        ],
        socialRole: "妆容华丽开放，反映盛唐气象。",
        conflicts: ["铅粉毒性", "配方复杂", "材料昂贵（如紫矿需进口）"],
      },
    },
  },

  清代: {
    name: "清代",
    period: "1644年-1912年",
    socialStructure: {
      hierarchy: [
        "皇帝",
        "宗室（亲王、郡王、贝勒、贝子）",
        "八旗贵族",
        "汉族官僚",
        "士绅",
        "平民",
        "贱民（奴仆、优伶等）",
      ],
      keyInstitutions: [
        "军机处（最高决策）",
        "内阁/六部",
        "八旗制度",
        "科举制",
        "督抚制（地方）",
      ],
      genderRoles:
        "满汉女性地位有差异。满族女性不缠足，汉族女性多缠足。后宫等级：皇后、皇贵妃、贵妃、妃、嫔、贵人、常在、答应。",
    },
    powerCenter: {
      name: "紫禁城/圆明园/颐和园",
      structure:
        "外朝三大殿理政，内廷后三宫居住。重要场所：乾清宫、养心殿、坤宁宫、储秀宫",
      keyRoles: [
        "军机大臣",
        "内阁大学士",
        "六部尚书",
        "总督、巡抚（地方）",
        "太监（内务府）",
      ],
    },
    dailyLife: {
      clothing: [
        "旗装（满族女性）",
        "马褂、长袍（男）",
        "花盆底鞋",
        "两把头/旗头（发式）",
        "顶戴花翎（官员）",
      ],
      food: ["满汉全席", "火锅", "点心", "茶", "奶制品（满族）"],
      transportation: ["轿子", "马车", "骑马"],
      housing: "四合院（北方），园林建筑",
    },
    honorifics: {
      royal: {
        皇帝: "皇上、万岁爷",
        太后: "老佛爷、太后",
        皇后: "皇后、主子",
        皇子: "阿哥",
        公主: "格格",
        妃嫔: "娘娘、主子",
      },
      official: {
        上级: "大人、老爷",
        同级: "兄台",
        下级: "尔",
      },
      common: {
        自称: "奴才（旗人）、臣（汉人）、奴婢、民女",
        尊称: "爷、老爷、太太、奶奶",
        谦称: "小的、奴婢",
      },
    },
    taboos: [
      "避讳皇帝名字（雍正时期最严）",
      "文字狱（清代特有，言论禁忌）",
      "满汉不通婚（早期）",
      "旗民不交产",
      "剃发易服（强制政策）",
    ],
    terminology: {
      紫禁城: "清代皇宫，今故宫",
      内务府: "管理皇室事务的机构",
      敬事房: "管理皇帝起居的太监机构",
      翻牌子: "皇帝选妃侍寝的方式",
      抬旗: "将汉人抬入八旗的恩典",
    },
    domainKnowledge: {
      化妆品: {
        name: "清代妆容",
        ancientEquivalent: "脂粉妆靥",
        tools: ["铜镜/玻璃镜", "妆奁", "眉笔"],
        materials: ["铅粉/珍珠粉", "胭脂", "口脂", "眉黛", "指甲油（凤仙花）"],
        techniques: [
          "两把头/旗头（发式）",
          "点翠（头饰工艺）",
          "柳叶眉",
          "樱桃小口",
        ],
        socialRole: "妆容有严格等级规定，不同等级妃嫔用不同颜色和装饰。",
        conflicts: ["铅粉毒性", "点翠工艺残忍（需杀翠鸟取羽）", "满汉妆容差异"],
      },
    },
  },
};

// ==================== 专业领域知识 ====================

const PROFESSIONAL_KNOWLEDGE: Record<string, ProfessionalMapping> = {
  化妆品研发: {
    modernTitle: "化妆品研发总监/配方工程师",
    ancientMapping: {
      role: "司妆女官/脂粉匠人",
      institution: "少府/尚方/内务府",
      skills: ["配制脂粉", "调香", "制膏", "研磨"],
    },
    knowledgeTransfer: [
      {
        modern: "化学成分分析",
        ancient: "辨别材料品质（色、味、触感）",
        conflict: "无法用仪器检测，只能靠经验",
      },
      {
        modern: "防腐技术",
        ancient: "天然防腐（盐、酒、蜂蜜）",
        conflict: "保质期短，需频繁制作",
      },
      {
        modern: "安全性测试",
        ancient: "无系统测试，靠口口相传",
        conflict: "铅汞毒性不被认知",
      },
      {
        modern: "配方稳定性",
        ancient: "材料易氧化变质",
        conflict: "需了解古代储存条件",
      },
      {
        modern: "批量生产",
        ancient: "手工作坊式生产",
        conflict: "产量有限，标准化困难",
      },
    ],
    plotHooks: [
      "用现代知识改良古方，减少毒性",
      "发现宫中有人故意用毒妆害人",
      "用配方知识救人/害人/获取权力",
      "创造新的安全配方，获得贵人青睐",
      "识破他人的妆容伎俩（用妆容隐藏伤痕/病态）",
    ],
  },

  医生: {
    modernTitle: "医生/医学研究者",
    ancientMapping: {
      role: "太医/医官/游医",
      institution: "太医院/太医署",
      skills: ["望闻问切", "针灸", "开方", "制药"],
    },
    knowledgeTransfer: [
      {
        modern: "无菌操作",
        ancient: "无此概念",
        conflict: "伤口感染风险高",
      },
      {
        modern: "解剖学知识",
        ancient: "经络学说",
        conflict: "理论体系不同",
      },
      {
        modern: "药理学",
        ancient: "本草学",
        conflict: "需要重新学习古代药物",
      },
    ],
    plotHooks: ["用现代医学知识救人", "发明新的治疗方法", "与传统医者观念冲突"],
  },

  厨师: {
    modernTitle: "厨师/美食家",
    ancientMapping: {
      role: "庖厨/御厨",
      institution: "光禄寺/膳房",
      skills: ["烹饪", "调味", "食材处理"],
    },
    knowledgeTransfer: [
      {
        modern: "现代调味料",
        ancient: "古代调料有限（无辣椒、番茄等）",
        conflict: "很多调料尚未传入中国",
      },
      {
        modern: "食品安全",
        ancient: "储存条件差",
        conflict: "食物易腐败",
      },
    ],
    plotHooks: ["用新烹饪方法获得贵人赏识", "发现食物被下毒", "创造新菜式"],
  },
};

interface ProfessionalMapping {
  modernTitle: string;
  ancientMapping: {
    role: string;
    institution: string;
    skills: string[];
  };
  knowledgeTransfer: Array<{
    modern: string;
    ancient: string;
    conflict: string;
  }>;
  plotHooks: string[];
}

// ==================== 服务实现 ====================

export interface WorldEnhancementResult {
  /** 检测到的时代 */
  detectedEra: string | null;
  /** 时代知识 */
  eraKnowledge: EraKnowledge | null;
  /** 专业知识 */
  professionalKnowledge: ProfessionalMapping | null;
  /** 增强的提示词 */
  enhancedPrompt: string;
  /** 世界观验证建议 */
  validationSuggestions: string[];
}

@Injectable()
export class WorldBuildingEnhancerService {
  private readonly logger = new Logger(WorldBuildingEnhancerService.name);

  /**
   * 从用户输入中检测时代背景（使用综合知识库）
   */
  detectEra(userPrompt: string): string | null {
    // 首先尝试使用综合知识库检测
    const dynasty = detectDynastyByKeywords(userPrompt);
    if (dynasty) {
      this.logger.log(
        `[WorldEnhancer] Detected dynasty from knowledge base: ${dynasty.name}`,
      );
      return dynasty.name;
    }

    // 回退到简单模式匹配（覆盖知识库尚未包含的朝代）
    const eraPatterns: Record<string, RegExp[]> = {
      东汉: [/东汉/, /光武帝/, /刘秀/],
      宋代: [/宋代/, /宋朝/, /赵匡胤/, /开封/, /临安/],
      明代: [/明代/, /明朝/, /朱元璋/, /永乐/, /嘉靖/],
      清代: [/清代/, /清朝/, /紫禁城/, /康熙/, /雍正/, /乾隆/, /慈禧/],
    };

    for (const [era, patterns] of Object.entries(eraPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(userPrompt)) {
          this.logger.log(`[WorldEnhancer] Detected era by pattern: ${era}`);
          return era;
        }
      }
    }

    return null;
  }

  /**
   * 获取综合知识库中的朝代详细信息
   */
  getDynastyDetails(eraName: string): Dynasty | null {
    return DYNASTIES[eraName] || null;
  }

  /**
   * 生成基于综合知识库的详细历史背景提示词
   */
  generateDynastyPrompt(dynasty: Dynasty): string {
    const parts: string[] = [];

    parts.push(
      `\n【${dynasty.name}详细历史背景】（${dynasty.period.description}）\n`,
    );

    // 都城
    parts.push(`■ 都城：`);
    for (const capital of dynasty.capitals) {
      parts.push(
        `  - ${capital.name}（今${capital.modernLocation}）${capital.description ? `：${capital.description}` : ""}`,
      );
    }

    // 政治制度
    parts.push(`\n■ 政治制度：${dynasty.politics.system}`);
    parts.push(`  中央：${dynasty.politics.centralGov.description}`);
    parts.push(`  地方：${dynasty.politics.localGov}`);
    parts.push(`  选官：${dynasty.politics.selection}`);

    // 社会等级
    parts.push(`\n■ 社会等级（从高到低）：`);
    for (const cls of dynasty.society.classes) {
      parts.push(`  ${cls.name}：${cls.description}`);
    }

    // 性别角色
    parts.push(`\n■ 性别与婚姻：${dynasty.society.genderRoles}`);

    // 后宫制度
    if (dynasty.harem) {
      parts.push(`\n■ 后宫等级：`);
      for (const rank of dynasty.harem.ranks.slice(0, 5)) {
        parts.push(
          `  ${rank.rank}. ${rank.title}${rank.count ? `（${rank.count}人）` : ""}`,
        );
      }
    }

    // 日常生活
    parts.push(`\n■ 服饰：`);
    parts.push(`  男：${dynasty.dailyLife.clothing.male.join("、")}`);
    parts.push(`  女：${dynasty.dailyLife.clothing.female.join("、")}`);
    parts.push(
      `  禁忌色：${dynasty.dailyLife.clothing.colors.forbidden.join("、")}`,
    );

    parts.push(`\n■ 饮食注意：`);
    for (const note of dynasty.dailyLife.food.notes) {
      parts.push(`  ⚠️ ${note}`);
    }

    // 称谓
    parts.push(`\n■ 称谓系统：`);
    parts.push(
      `  皇帝：${Object.values(dynasty.honorifics.emperor).join("、")}`,
    );
    parts.push(
      `  自称：${Object.entries(dynasty.honorifics.selfReferences)
        .map(([k, v]) => `${k}→${v}`)
        .join("、")}`,
    );

    // 禁忌
    parts.push(`\n■ 禁忌（触犯可能致死）：`);
    for (const taboo of dynasty.taboos) {
      parts.push(
        `  ⚠️ ${taboo.description}${taboo.examples ? `（如：${taboo.examples[0]}）` : ""}`,
      );
    }

    // 重要术语
    parts.push(`\n■ 重要术语：`);
    const termEntries = Object.entries(dynasty.terminology).slice(0, 8);
    for (const [term, def] of termEntries) {
      parts.push(`  【${term}】${def}`);
    }

    // 写作注意
    parts.push(`\n■ 写作注意事项：`);
    for (const note of dynasty.writingNotes) {
      parts.push(`  ★ ${note}`);
    }

    return parts.join("\n");
  }

  /**
   * 从用户输入中检测专业背景
   */
  detectProfession(userPrompt: string): string | null {
    const professionPatterns: Record<string, RegExp[]> = {
      化妆品研发: [/化妆品/, /配方/, /护肤/, /美妆/, /脂粉/, /胭脂/],
      医生: [/医生/, /医学/, /医术/, /医者/, /太医/, /大夫/],
      厨师: [/厨师/, /厨艺/, /美食/, /烹饪/, /御厨/],
    };

    for (const [profession, patterns] of Object.entries(professionPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(userPrompt)) {
          this.logger.log(`[WorldEnhancer] Detected profession: ${profession}`);
          return profession;
        }
      }
    }

    return null;
  }

  /**
   * 生成增强的世界观构建提示词
   */
  enhanceWorldBuildingPrompt(userPrompt: string): WorldEnhancementResult {
    const detectedEra = this.detectEra(userPrompt);
    const detectedProfession = this.detectProfession(userPrompt);

    const eraKnowledge = detectedEra ? ERA_KNOWLEDGE[detectedEra] : null;
    const professionalKnowledge = detectedProfession
      ? PROFESSIONAL_KNOWLEDGE[detectedProfession]
      : null;

    const enhancedPromptParts: string[] = [];
    const validationSuggestions: string[] = [];

    // 基础提示
    enhancedPromptParts.push(`【原始故事创意】\n${userPrompt}\n`);

    // 注入时代知识
    if (eraKnowledge) {
      enhancedPromptParts.push(this.buildEraKnowledgeSection(eraKnowledge));
      validationSuggestions.push(
        `确保社会等级描写符合${eraKnowledge.name}的等级制度`,
        `确保称谓使用正确（如${Object.entries(eraKnowledge.honorifics.royal)
          .slice(0, 2)
          .map(([k, v]) => `${k}称"${v}"`)
          .join("、")}）`,
        `避免出现${eraKnowledge.name}不存在的物品或概念`,
      );
    }

    // 注入专业知识
    if (professionalKnowledge && eraKnowledge) {
      const domainKey =
        detectedProfession === "化妆品研发"
          ? "化妆品"
          : detectedProfession === "医生"
            ? "医术"
            : null;
      const domainKnowledge = domainKey
        ? eraKnowledge.domainKnowledge[domainKey]
        : null;

      enhancedPromptParts.push(
        this.buildProfessionalSection(professionalKnowledge, domainKnowledge),
      );
      validationSuggestions.push(
        `主角的现代专业知识应与古代知识产生有趣的冲突`,
        `专业知识的应用应该推动情节发展`,
      );
    }

    // 质量要求
    enhancedPromptParts.push(`
【世界观构建质量要求】
1. 社会结构要有层次感，不同阶层有不同的行为规范
2. 权力关系要清晰，谁能决定谁的命运
3. 日常生活细节要丰富，增加真实感
4. 称谓系统要一致，不同身份用不同称呼
5. 禁忌和规矩要明确，为冲突埋下伏笔
6. 专业知识要有古今对照，形成戏剧张力
`);

    return {
      detectedEra,
      eraKnowledge,
      professionalKnowledge,
      enhancedPrompt: enhancedPromptParts.join("\n"),
      validationSuggestions,
    };
  }

  /**
   * 构建时代知识部分
   */
  private buildEraKnowledgeSection(era: EraKnowledge): string {
    return `
【${era.name}时代背景参考】（${era.period}）

■ 社会等级（从高到低）：
${era.socialStructure.hierarchy.map((h, i) => `  ${i + 1}. ${h}`).join("\n")}

■ 重要制度：
${era.socialStructure.keyInstitutions.map((i) => `  - ${i}`).join("\n")}

■ 性别与后宫：
  ${era.socialStructure.genderRoles}

■ 权力中心：${era.powerCenter.name}
  ${era.powerCenter.structure}
  关键角色：${era.powerCenter.keyRoles.join("、")}

■ 日常生活：
  服饰：${era.dailyLife.clothing.join("、")}
  饮食：${era.dailyLife.food.join("、")}
  出行：${era.dailyLife.transportation.join("、")}
  居住：${era.dailyLife.housing}

■ 称谓系统：
  皇室：${Object.entries(era.honorifics.royal)
    .map(([k, v]) => `${k}→${v}`)
    .join("、")}
  官员：${Object.entries(era.honorifics.official)
    .map(([k, v]) => `${k}→${v}`)
    .join("、")}
  常用：${Object.entries(era.honorifics.common)
    .map(([k, v]) => `${k}→${v}`)
    .join("、")}

■ 禁忌（触犯可能致死）：
${era.taboos.map((t) => `  ⚠️ ${t}`).join("\n")}

■ 重要术语：
${Object.entries(era.terminology)
  .map(([term, def]) => `  【${term}】${def}`)
  .join("\n")}
`;
  }

  /**
   * 构建专业知识部分
   */
  private buildProfessionalSection(
    profession: ProfessionalMapping,
    domainKnowledge: DomainKnowledge | null,
  ): string {
    let section = `
【专业知识映射：${profession.modernTitle}】

■ 古代对应角色：${profession.ancientMapping.role}
■ 所属机构：${profession.ancientMapping.institution}
■ 核心技能：${profession.ancientMapping.skills.join("、")}

■ 知识冲突点（可作为情节冲突）：
${profession.knowledgeTransfer.map((kt) => `  - 现代「${kt.modern}」vs 古代「${kt.ancient}」→ ${kt.conflict}`).join("\n")}

■ 推荐情节钩子：
${profession.plotHooks.map((h) => `  ★ ${h}`).join("\n")}
`;

    if (domainKnowledge) {
      section += `
■ 古代${domainKnowledge.name}详情：
  工具：${domainKnowledge.tools.join("、")}
  材料：${domainKnowledge.materials.join("、")}
  技法：${domainKnowledge.techniques.join("、")}
  社会地位：${domainKnowledge.socialRole}

■ 冲突与危机点：
${domainKnowledge.conflicts.map((c) => `  ⚡ ${c}`).join("\n")}
`;
    }

    return section;
  }

  /**
   * 验证生成的世界观设定
   */
  validateWorldSettings(
    worldSettings: Record<string, unknown>,
    detectedEra: string | null,
  ): {
    isValid: boolean;
    issues: string[];
    suggestions: string[];
  } {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // 基础结构验证
    if (!worldSettings.core) {
      issues.push("缺少核心设定(core)");
    }
    if (!worldSettings.characters || !Array.isArray(worldSettings.characters)) {
      issues.push("缺少角色设定(characters)");
    } else if ((worldSettings.characters as unknown[]).length < 2) {
      issues.push("角色数量不足（至少需要2个主要角色）");
    }
    if (!worldSettings.world) {
      issues.push("缺少世界设定(world)");
    }

    // 时代特定验证
    if (detectedEra && ERA_KNOWLEDGE[detectedEra]) {
      const era = ERA_KNOWLEDGE[detectedEra];
      const worldInfo = worldSettings.world as
        | Record<string, unknown>
        | undefined;

      if (!worldInfo?.era) {
        suggestions.push(`建议明确时代背景为"${era.name}（${era.period}）"`);
      }
      if (!worldInfo?.society) {
        suggestions.push(`建议添加${era.name}的社会结构描述`);
      }
    }

    // 角色完整性验证
    const characters = worldSettings.characters as
      | Array<Record<string, unknown>>
      | undefined;
    if (characters) {
      for (const char of characters) {
        if (!char.name) issues.push("有角色缺少名字");
        if (!char.role) issues.push(`角色"${char.name || "未知"}"缺少角色类型`);
        if (!char.motivation) {
          suggestions.push(`建议为角色"${char.name || "未知"}"添加行动动机`);
        }
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      suggestions,
    };
  }

  /**
   * 获取可用的时代列表
   */
  getAvailableEras(): string[] {
    return Object.keys(ERA_KNOWLEDGE);
  }

  /**
   * 获取特定时代的知识
   */
  getEraKnowledge(era: string): EraKnowledge | null {
    return ERA_KNOWLEDGE[era] || null;
  }
}
