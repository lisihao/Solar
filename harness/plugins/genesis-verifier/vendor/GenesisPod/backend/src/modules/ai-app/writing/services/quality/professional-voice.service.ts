/**
 * ProfessionalVoiceService - 专业角色思维模式服务
 *
 * 核心职责：
 * - 根据角色的专业背景生成职业思维模式
 * - 将"角色标签"转化为"思维习惯"
 * - 提供专业知识的自然展示机会
 *
 * 设计理念：
 * - 角色的专业身份不应只是设定，而是渗透到每一个思考和行动中
 * - "Show Don't Tell"的核心是让角色用专业方式"推理"而非"告知"
 *
 * 示例：
 * 输入：化妆品配方工程师
 * 输出：
 *   - 分析问题方式：观察→假设→验证（科学家思维）
 *   - 专业反射：看到症状自动识别成分问题
 *   - 职业口癖："这种症状是典型的..."、"从成分角度分析..."
 *   - 知识展示机会：铅中毒、酸碱萃取、乳化原理
 */

import { Injectable, Logger } from "@nestjs/common";

// ==================== 类型定义 ====================

export interface ProfessionProfile {
  /** 职业名称 */
  profession: string;
  /** 职业类别 */
  category:
    | "scientist"
    | "artist"
    | "warrior"
    | "politician"
    | "merchant"
    | "healer"
    | "scholar"
    | "craftsman";
  /** 核心思维模式 */
  thinkingPattern: string;
  /** 分析问题的步骤 */
  analyticalSteps: string[];
  /** 专业反射（自动触发的专业反应） */
  professionalReflexes: string[];
  /** 职业口癖/常用表达 */
  speechPatterns: string[];
  /** 专业术语库 */
  terminology: string[];
  /** 知识展示机会点 */
  knowledgeShowcaseOpportunities: string[];
  /** 职业习惯性动作 */
  habitualActions: string[];
}

export interface ProfessionalVoicePrompt {
  /** 角色名 */
  characterName: string;
  /** 职业背景 */
  profession: string;
  /** 生成的思维模式提示词 */
  thinkingModePrompt: string;
  /** 专业知识展示规则 */
  knowledgeDisplayRules: string;
  /** 禁止的表达方式 */
  forbiddenExpressions: string[];
}

// ==================== 职业模板库 ====================

const PROFESSION_TEMPLATES: Record<string, Partial<ProfessionProfile>> = {
  // 科学家类
  化妆品配方工程师: {
    category: "scientist",
    thinkingPattern:
      "在化学实验中，恐慌是最无用的情绪。面对未知反应，第一步是：观察。第二步是：控制变量。",
    analyticalSteps: [
      "观察症状/现象",
      "识别关键特征",
      "调取专业知识库",
      "形成假设",
      "设计验证方案",
      "得出结论",
    ],
    professionalReflexes: [
      "看到皮肤问题自动分析成分原因",
      "闻到气味自动识别化学物质",
      "触摸质地自动判断配方成分",
      "观察颜色变化自动推断化学反应",
    ],
    speechPatterns: [
      "从配方角度分析...",
      "这种症状是典型的...",
      "如果我的判断没错...",
      "控制变量来看...",
      "这个反应说明...",
    ],
    terminology: [
      "碱式碳酸铅",
      "酸碱萃取",
      "乳化",
      "皂化反应",
      "PH值",
      "氧化还原",
      "表面活性剂",
      "渗透压",
      "分子结构",
      "离子键",
    ],
    knowledgeShowcaseOpportunities: [
      "分析铅中毒症状（铅线、面色青灰）",
      "解释化妆品制作原理（皂化、乳化）",
      "识别原料特性（猪胰脏含酶、草木灰含碱）",
      "设计替代配方（无铅替代品）",
      "预测化学反应结果",
    ],
    habitualActions: [
      "下意识地观察他人皮肤状态",
      "闻到气味会分析成分",
      "触摸物品会判断质地成分",
      "遇到问题先冷静分析再行动",
    ],
  },

  医者: {
    category: "healer",
    thinkingPattern: "望闻问切，四诊合参。急则治标，缓则治本。",
    analyticalSteps: [
      "望：观察面色、形态",
      "闻：听声音、闻气味",
      "问：询问症状、病史",
      "切：把脉、触诊",
      "辨证：分析病因病机",
      "施治：制定治疗方案",
    ],
    professionalReflexes: [
      "看到他人面色自动判断健康状态",
      "听到咳嗽自动分析病因",
      "闻到体味自动联想病症",
    ],
    speechPatterns: [
      "依我所见...",
      "此症当是...",
      "脉象显示...",
      "须得调养...",
    ],
    terminology: [
      "气血两虚",
      "阴阳失调",
      "寒热虚实",
      "经络",
      "穴位",
      "药性",
      "配伍禁忌",
    ],
    knowledgeShowcaseOpportunities: [
      "诊断疑难杂症",
      "开具独特药方",
      "解释病理机制",
      "预测病情发展",
    ],
    habitualActions: [
      "下意识观察他人气色",
      "遇人先看面相判断健康",
      "习惯性把脉",
    ],
  },

  将军: {
    category: "warrior",
    thinkingPattern: "知己知彼，百战不殆。兵者，诡道也。",
    analyticalSteps: [
      "侦察敌情",
      "分析地形",
      "评估兵力",
      "制定战术",
      "预设后手",
      "果断执行",
    ],
    professionalReflexes: [
      "进入任何场所自动观察地形",
      "见人先评估战斗力",
      "时刻保持警觉",
    ],
    speechPatterns: [
      "依本将看来...",
      "若敌军...",
      "此计可行...",
      "不可轻敌...",
    ],
    terminology: ["兵法", "阵型", "粮草", "斥候", "先锋", "伏兵", "围点打援"],
    knowledgeShowcaseOpportunities: [
      "分析战局形势",
      "布置战术阵型",
      "预判敌方行动",
      "评估作战资源",
    ],
    habitualActions: ["背靠墙坐", "目光扫视全场", "手不离兵器"],
  },

  谋士: {
    category: "politician",
    thinkingPattern: "人心似水，因势利导。不谋全局者，不足以谋一域。",
    analyticalSteps: [
      "分析各方势力",
      "揣摩各人心思",
      "寻找利益交汇点",
      "设计局中局",
      "准备多套方案",
      "静待时机",
    ],
    professionalReflexes: [
      "听话听音，分析弦外之意",
      "观察微表情判断真实想法",
      "任何事件先分析谁获利",
    ],
    speechPatterns: [
      "依在下愚见...",
      "此人所图...",
      "若我所料不差...",
      "不妨一试...",
    ],
    terminology: ["合纵连横", "借刀杀人", "隔岸观火", "明修栈道", "暗度陈仓"],
    knowledgeShowcaseOpportunities: [
      "分析政治局势",
      "揣摩人心动机",
      "设计连环计策",
      "预判对手行动",
    ],
    habitualActions: ["说话留三分", "目光深邃", "表情不外露"],
  },

  商人: {
    category: "merchant",
    thinkingPattern: "逐利而动，风险与收益并存。信誉是最大的本钱。",
    analyticalSteps: [
      "评估市场需求",
      "计算成本收益",
      "分析风险因素",
      "寻找信息差",
      "谈判博弈",
      "建立长期关系",
    ],
    professionalReflexes: [
      "见物先估价",
      "听消息先判断商业价值",
      "任何交往先衡量利益",
    ],
    speechPatterns: [
      "依小人所见...",
      "此物价值...",
      "若能互利...",
      "这笔买卖...",
    ],
    terminology: ["行情", "本钱", "利润", "货源", "渠道", "信用", "欠条"],
    knowledgeShowcaseOpportunities: [
      "估算物品价值",
      "分析市场行情",
      "谈判交易条件",
      "建立商业网络",
    ],
    habitualActions: ["习惯性讨价还价", "记账精确", "善于察言观色"],
  },

  工匠: {
    category: "craftsman",
    thinkingPattern: "精益求精，差之毫厘谬以千里。技艺需要千锤百炼。",
    analyticalSteps: [
      "检查原料品质",
      "规划制作流程",
      "把控关键工序",
      "注重细节处理",
      "反复测试改进",
      "追求极致完美",
    ],
    professionalReflexes: [
      "见到成品先看工艺细节",
      "触摸材料自动判断品质",
      "任何工具先检查状态",
    ],
    speechPatterns: [
      "依老朽经验...",
      "此物做工...",
      "关键在于...",
      "这道工序...",
    ],
    terminology: ["火候", "淬炼", "打磨", "纹理", "胎质", "釉面", "烧制温度"],
    knowledgeShowcaseOpportunities: [
      "鉴定工艺品质",
      "解释制作流程",
      "改进工艺细节",
      "传授独门技法",
    ],
    habitualActions: ["双手粗糙有力", "对工具爱惜", "做事一丝不苟"],
  },

  // ==================== 宫廷人物模板 ====================
  女官: {
    category: "politician",
    thinkingPattern: "宫中行走，步步谨慎。察言观色是生存之本。",
    analyticalSteps: [
      "观察主子脸色",
      "揣摩话中深意",
      "衡量各方势力",
      "选择最安全的应对",
      "留有余地",
    ],
    professionalReflexes: [
      "听到脚步声自动判断来人身份",
      "进门先看座次排位",
      "说话前先扫视四周有无闲人",
    ],
    speechPatterns: [
      "奴婢斗胆...",
      "恕奴婢直言...",
      "这其中怕是...",
      "依奴婢愚见...",
    ],
    terminology: ["请安", "膳食", "份例", "赏赐", "冷落", "召见", "伺候"],
    knowledgeShowcaseOpportunities: [
      "分析后宫局势",
      "揣摩主子心意",
      "应对突发状况",
      "传递关键信息",
    ],
    habitualActions: [
      "低眉顺眼",
      "说话轻声",
      "时刻保持警觉",
      "记住每个人的喜好",
    ],
  },

  宫女: {
    category: "craftsman",
    thinkingPattern: "做好本分，不多嘴不多问。活着才是最重要的。",
    analyticalSteps: [
      "判断差事紧急程度",
      "回想相关规矩",
      "选择最稳妥做法",
      "执行时不出差错",
    ],
    professionalReflexes: [
      "听到铃声知道该做什么",
      "看到器物自动检查是否摆正",
      "对时辰极度敏感",
    ],
    speechPatterns: ["奴婢遵命", "奴婢不敢", "奴婢这就去办"],
    terminology: ["当值", "换班", "传话", "请安", "伺候", "膳房", "针线"],
    knowledgeShowcaseOpportunities: [
      "精通宫中规矩",
      "熟悉各宫位置",
      "了解各主子习惯",
    ],
    habitualActions: ["走路无声", "动作利索", "眼观六路"],
  },

  太监: {
    category: "politician",
    thinkingPattern: "身残志坚，以忍为先。主子的心意是一切。",
    analyticalSteps: [
      "揣摩主子意图",
      "评估传话风险",
      "选择措辞方式",
      "留有回旋余地",
    ],
    professionalReflexes: [
      "自动记住所有人的品级",
      "听声识人",
      "看赏赐判断得失宠情况",
    ],
    speechPatterns: ["奴才遵旨", "奴才不敢妄言", "陛下圣明", "这事儿嘛..."],
    terminology: ["传旨", "请安", "圣意", "龙颜", "天恩", "伺候"],
    knowledgeShowcaseOpportunities: [
      "传递圣意",
      "分析局势",
      "揣摩圣心",
      "协调关系",
    ],
    habitualActions: ["躬身说话", "察言观色", "记性极好"],
  },

  皇帝: {
    category: "politician",
    thinkingPattern: "帝王心术，平衡各方。朕即天下，天下即朕。",
    analyticalSteps: [
      "评估各方势力",
      "权衡利弊得失",
      "制衡而非偏废",
      "维护皇权至上",
      "恩威并施",
    ],
    professionalReflexes: [
      "任何事先想是否有人在试探",
      "任何话先想有几层意思",
      "任何人先想能否为朕所用",
    ],
    speechPatterns: ["朕以为...", "爱卿所言...", "退下吧", "准奏"],
    terminology: ["社稷", "朝纲", "龙体", "恩典", "圣旨", "御览"],
    knowledgeShowcaseOpportunities: [
      "决断朝政",
      "制衡大臣",
      "施恩后宫",
      "布局天下",
    ],
    habitualActions: ["端坐如山", "喜怒不形于色", "说话字斟句酌"],
  },

  皇后: {
    category: "politician",
    thinkingPattern: "母仪天下，稳如磐石。后宫安宁是本分。",
    analyticalSteps: [
      "维护中宫体面",
      "平衡各宫关系",
      "处理后宫事务",
      "保护皇嗣安全",
    ],
    professionalReflexes: [
      "自动衡量每个妃嫔的威胁程度",
      "听到消息先想对皇嗣的影响",
      "任何事先考虑是否有损凤仪",
    ],
    speechPatterns: ["本宫知道了", "依本宫之见...", "这是规矩", "退下吧"],
    terminology: ["凤仪", "中宫", "六宫", "嫡子", "母仪", "懿旨"],
    knowledgeShowcaseOpportunities: [
      "主持后宫大局",
      "处理妃嫔纷争",
      "教导皇子公主",
      "应对太后皇帝",
    ],
    habitualActions: ["端庄得体", "喜怒不显", "处事公允"],
  },

  妃嫔: {
    category: "politician",
    thinkingPattern: "争宠求存，步步为营。恩宠即是一切。",
    analyticalSteps: [
      "分析当前局势",
      "寻找邀宠机会",
      "规避潜在威胁",
      "巩固自身地位",
    ],
    professionalReflexes: [
      "自动计算自己在后宫的位置",
      "听到圣驾先想能否见到",
      "任何事先想对自己有何影响",
    ],
    speechPatterns: ["臣妾遵命", "臣妾不敢", "皇上恩典", "姐姐说的是"],
    terminology: ["恩宠", "侍寝", "晋封", "禁足", "降位", "赐死"],
    knowledgeShowcaseOpportunities: [
      "争取圣宠",
      "应对后宫纷争",
      "培养心腹",
      "保护自己",
    ],
    habitualActions: ["仪态万千", "善于察言观色", "心思细腻"],
  },

  // ==================== 江湖人物模板 ====================
  侠客: {
    category: "warrior",
    thinkingPattern: "侠之大者，为国为民。拔剑四顾心茫然。",
    analyticalSteps: [
      "判断是非曲直",
      "评估敌我实力",
      "选择行侠方式",
      "果断出手",
    ],
    professionalReflexes: [
      "见不平自动想出手",
      "遇高手自动想比试",
      "听到江湖消息自动关心",
    ],
    speechPatterns: ["在下...", "阁下好本事", "请！", "得罪了"],
    terminology: ["江湖", "武林", "门派", "内力", "招式", "切磋", "仇敌"],
    knowledgeShowcaseOpportunities: [
      "行侠仗义",
      "比武较量",
      "分析武学",
      "评判门派",
    ],
    habitualActions: ["背负长剑", "目光锐利", "步伐轻灵"],
  },

  书生: {
    category: "scholar",
    thinkingPattern: "书中自有黄金屋，书中自有颜如玉。以理服人，以德化人。",
    analyticalSteps: [
      "引经据典分析",
      "权衡义理得失",
      "考虑前例先例",
      "得出合理结论",
    ],
    professionalReflexes: [
      "遇事先想古人如何处理",
      "听言自动分析逻辑谬误",
      "见字先品评书法",
    ],
    speechPatterns: ["子曰...", "据史书记载...", "古人云...", "依在下愚见..."],
    terminology: ["圣贤", "经义", "科举", "功名", "典故", "笔墨"],
    knowledgeShowcaseOpportunities: [
      "引经据典",
      "诗词唱和",
      "分析局势",
      "教书育人",
    ],
    habitualActions: ["手不释卷", "出口成章", "仪态儒雅"],
  },
};

// ==================== 服务实现 ====================

@Injectable()
export class ProfessionalVoiceService {
  private readonly logger = new Logger(ProfessionalVoiceService.name);

  /**
   * 根据角色职业生成专业思维模式提示词
   */
  generateProfessionalVoicePrompt(
    characterName: string,
    profession: string,
    customBackground?: string,
  ): ProfessionalVoicePrompt {
    // 1. 匹配职业模板
    const profile = this.matchProfessionProfile(profession);

    // 2. 生成思维模式提示词
    const thinkingModePrompt = this.buildThinkingModePrompt(
      characterName,
      profile,
      customBackground,
    );

    // 3. 生成知识展示规则
    const knowledgeDisplayRules = this.buildKnowledgeDisplayRules(
      characterName,
      profile,
    );

    // 4. 生成禁止表达列表
    const forbiddenExpressions = this.buildForbiddenExpressions(profile);

    this.logger.log(
      `[ProfessionalVoice] Generated voice prompt for ${characterName} (${profession})`,
    );

    return {
      characterName,
      profession,
      thinkingModePrompt,
      knowledgeDisplayRules,
      forbiddenExpressions,
    };
  }

  /**
   * 匹配职业模板
   */
  private matchProfessionProfile(profession: string): ProfessionProfile {
    // 尝试精确匹配
    if (PROFESSION_TEMPLATES[profession]) {
      return {
        profession,
        ...PROFESSION_TEMPLATES[profession],
      } as ProfessionProfile;
    }

    // 尝试模糊匹配
    for (const [key, template] of Object.entries(PROFESSION_TEMPLATES)) {
      if (profession.includes(key) || key.includes(profession)) {
        return {
          profession,
          ...template,
        } as ProfessionProfile;
      }
    }

    // 关键词匹配（按优先级排序，更具体的关键词优先）
    const keywordMap: Record<string, string> = {
      // 化妆品/科研相关
      配方: "化妆品配方工程师",
      化学: "化妆品配方工程师",
      研发: "化妆品配方工程师",
      科研: "化妆品配方工程师",
      化妆: "化妆品配方工程师",
      // 医疗相关
      医: "医者",
      药: "医者",
      治病: "医者",
      太医: "医者",
      御医: "医者",
      // 军事相关
      将: "将军",
      兵: "将军",
      军: "将军",
      // 谋略相关
      谋: "谋士",
      策: "谋士",
      幕僚: "谋士",
      // 商业相关
      商: "商人",
      贾: "商人",
      // 工艺相关
      匠: "工匠",
      艺: "工匠",
      // 宫廷人物
      女官: "女官",
      掌事: "女官",
      尚宫: "女官",
      宫女: "宫女",
      侍女: "宫女",
      丫鬟: "宫女",
      太监: "太监",
      公公: "太监",
      内侍: "太监",
      皇上: "皇帝",
      陛下: "皇帝",
      天子: "皇帝",
      皇后: "皇后",
      中宫: "皇后",
      国母: "皇后",
      妃: "妃嫔",
      嫔: "妃嫔",
      贵人: "妃嫔",
      昭仪: "妃嫔",
      婕妤: "妃嫔",
      美人: "妃嫔",
      // 江湖人物
      侠: "侠客",
      剑客: "侠客",
      武者: "侠客",
      书生: "书生",
      秀才: "书生",
      举人: "书生",
      读书人: "书生",
    };

    for (const [keyword, templateKey] of Object.entries(keywordMap)) {
      if (profession.includes(keyword)) {
        return {
          profession,
          ...PROFESSION_TEMPLATES[templateKey],
        } as ProfessionProfile;
      }
    }

    // 默认返回通用科学家模板（适用于专业技术人员）
    return {
      profession,
      category: "scientist",
      thinkingPattern: "理性分析，冷静应对。先观察，再判断，最后行动。",
      analyticalSteps: ["观察现象", "分析原因", "寻找解决方案", "验证效果"],
      professionalReflexes: ["遇到问题先冷静分析"],
      speechPatterns: ["依我所见...", "从专业角度...", "这说明..."],
      terminology: [],
      knowledgeShowcaseOpportunities: ["分析专业问题", "提供专业建议"],
      habitualActions: ["冷静观察", "理性分析"],
    };
  }

  /**
   * 从角色背景描述中提取职业
   * 用于处理 background 字段包含完整背景描述的情况
   */
  extractProfessionFromBackground(background: string): string | null {
    if (!background) return null;

    // 常见职业关键词列表（按优先级排序）
    const professionPatterns = [
      // 精确匹配
      { pattern: /化妆品配方工程师/, result: "化妆品配方工程师" },
      { pattern: /配方师/, result: "化妆品配方工程师" },
      { pattern: /研究员/, result: "化妆品配方工程师" },
      // 医疗
      { pattern: /太医/, result: "医者" },
      { pattern: /御医/, result: "医者" },
      { pattern: /大夫/, result: "医者" },
      { pattern: /郎中/, result: "医者" },
      // 宫廷
      { pattern: /女官/, result: "女官" },
      { pattern: /尚宫/, result: "女官" },
      { pattern: /掌事/, result: "女官" },
      { pattern: /嬷嬷/, result: "女官" },
      { pattern: /宫女/, result: "宫女" },
      { pattern: /侍女/, result: "宫女" },
      { pattern: /丫鬟/, result: "宫女" },
      { pattern: /太监/, result: "太监" },
      { pattern: /公公/, result: "太监" },
      { pattern: /内侍/, result: "太监" },
      { pattern: /皇后/, result: "皇后" },
      { pattern: /皇上/, result: "皇帝" },
      { pattern: /陛下/, result: "皇帝" },
      { pattern: /贵妃/, result: "妃嫔" },
      { pattern: /妃子/, result: "妃嫔" },
      { pattern: /嫔妃/, result: "妃嫔" },
      // 军事
      { pattern: /将军/, result: "将军" },
      { pattern: /统帅/, result: "将军" },
      { pattern: /元帅/, result: "将军" },
      // 谋略
      { pattern: /谋士/, result: "谋士" },
      { pattern: /军师/, result: "谋士" },
      { pattern: /幕僚/, result: "谋士" },
      // 商业
      { pattern: /商人/, result: "商人" },
      { pattern: /掌柜/, result: "商人" },
      { pattern: /东家/, result: "商人" },
      // 工艺
      { pattern: /工匠/, result: "工匠" },
      { pattern: /匠人/, result: "工匠" },
      { pattern: /铁匠/, result: "工匠" },
      // 江湖
      { pattern: /侠客/, result: "侠客" },
      { pattern: /剑客/, result: "侠客" },
      { pattern: /武者/, result: "侠客" },
      // 书生
      { pattern: /书生/, result: "书生" },
      { pattern: /秀才/, result: "书生" },
      { pattern: /举人/, result: "书生" },
      { pattern: /进士/, result: "书生" },
    ];

    for (const { pattern, result } of professionPatterns) {
      if (pattern.test(background)) {
        this.logger.debug(
          `[ProfessionalVoice] Extracted profession "${result}" from background`,
        );
        return result;
      }
    }

    return null;
  }

  /**
   * 构建思维模式提示词
   */
  private buildThinkingModePrompt(
    characterName: string,
    profile: ProfessionProfile,
    customBackground?: string,
  ): string {
    const parts: string[] = [];

    parts.push(`## ${characterName}的专业思维模式\n`);
    parts.push(`**职业背景**：${profile.profession}`);
    if (customBackground) {
      parts.push(`**详细背景**：${customBackground}`);
    }

    parts.push(`\n**核心思维方式**：`);
    parts.push(`「${profile.thinkingPattern}」\n`);

    parts.push(`**分析问题的方式**：`);
    parts.push(`${characterName}面对问题时，会按以下步骤思考：`);
    profile.analyticalSteps.forEach((step, i) => {
      parts.push(`${i + 1}. ${step}`);
    });

    parts.push(`\n**专业反射**（自动触发的专业反应）：`);
    profile.professionalReflexes.forEach((reflex) => {
      parts.push(`- ${reflex}`);
    });

    parts.push(`\n**职业习惯动作**：`);
    profile.habitualActions.forEach((action) => {
      parts.push(`- ${action}`);
    });

    if (profile.speechPatterns.length > 0) {
      parts.push(`\n**内心独白常用句式**：`);
      profile.speechPatterns.forEach((pattern) => {
        parts.push(`- "${pattern}"`);
      });
    }

    return parts.join("\n");
  }

  /**
   * 构建知识展示规则
   */
  private buildKnowledgeDisplayRules(
    characterName: string,
    profile: ProfessionProfile,
  ): string {
    const parts: string[] = [];

    parts.push(`## ${characterName}的专业知识展示规则\n`);

    parts.push(`**黄金法则：Show Don't Tell**`);
    parts.push(
      `绝对禁止直接告诉读者"${characterName}很专业"或"她对XX很了解"。`,
    );
    parts.push(`必须通过以下方式展示专业性：\n`);

    parts.push(`### 1. 通过推理过程展示`);
    parts.push(`❌ 错误：她对铅的危害知之甚深`);
    parts.push(
      `✅ 正确：她看到那层死灰色的面容，瞳孔骤然收缩——牙龈边缘的蓝线、眼眶周围的青紫，这是典型的慢性铅中毒。`,
    );

    parts.push(`\n### 2. 通过专业术语自然使用`);
    parts.push(`可用术语：${profile.terminology.slice(0, 10).join("、")}`);
    parts.push(`这些术语应在角色思考或行动中自然出现，而非刻意科普。`);

    parts.push(`\n### 3. 通过专业反射行动`);
    parts.push(`当${characterName}遇到以下情况时，应触发专业反应：`);
    profile.knowledgeShowcaseOpportunities.forEach((opp) => {
      parts.push(`- ${opp}`);
    });

    parts.push(`\n### 4. 内心独白的专业化`);
    parts.push(`${characterName}的内心独白应体现专业思维，例如：`);
    parts.push(`「${profile.thinkingPattern}」`);

    return parts.join("\n");
  }

  /**
   * 构建禁止表达列表
   */
  private buildForbiddenExpressions(profile: ProfessionProfile): string[] {
    const forbidden = [
      "她对此很了解",
      "她是这方面的专家",
      "凭借她的专业知识",
      "作为一名专业的...",
      "她的专业背景让她...",
      "她心中暗想，幸好自己懂得...",
      "她知道这是因为...",
      "她立刻认出了...",
    ];

    // 根据职业类别添加特定禁止表达
    if (profile.category === "scientist") {
      forbidden.push("她对化学很精通", "她的科研经验告诉她", "作为科学家的她");
    }

    if (profile.category === "healer") {
      forbidden.push("她对医术很精通", "她的医学知识告诉她", "作为医者的她");
    }

    return forbidden;
  }

  /**
   * 为章节上下文生成完整的专业声音约束
   */
  generateChapterVoiceConstraints(
    characters: Array<{
      name: string;
      profession?: string;
      background?: string;
    }>,
  ): string {
    const parts: string[] = [];

    parts.push(`## 角色专业声音约束\n`);
    parts.push(`以下是本章涉及角色的专业思维模式，写作时必须体现：\n`);

    for (const char of characters) {
      if (char.profession) {
        const voicePrompt = this.generateProfessionalVoicePrompt(
          char.name,
          char.profession,
          char.background,
        );

        parts.push(`---`);
        parts.push(voicePrompt.thinkingModePrompt);
        parts.push(voicePrompt.knowledgeDisplayRules);
        parts.push(`\n**禁止表达**：`);
        voicePrompt.forbiddenExpressions.forEach((expr) => {
          parts.push(`- "${expr}"`);
        });
        parts.push(``);
      }
    }

    return parts.join("\n");
  }
}
