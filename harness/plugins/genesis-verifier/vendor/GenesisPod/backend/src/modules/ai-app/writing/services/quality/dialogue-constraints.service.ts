/**
 * DialogueConstraintsService - 对话约束服务
 *
 * 核心职责：
 * - 生成时代对话风格约束（基于朝代）
 * - 生成角色个性化对话约束（基于人格档案）
 * - 检测对话真实性（身份等级、情绪状态）
 * - 优化对话节奏（动作/神态描写建议）
 *
 * 集成点：
 * - HistoricalKnowledgeService: 历史知识查询
 * - CharacterPersonalityService: 角色人格查询
 * - Writer Agent: 在构建 prompt 时调用
 */

import { Injectable, Logger } from "@nestjs/common";
import { CharacterPersonalityService } from "./character-personality.service";

// ==================== 类型定义 ====================

/**
 * 时代对话风格约束
 */
export interface DialectConstraints {
  dynasty: string;
  formalAddresses: string[]; // 正式称呼：陛下、殿下、大人
  informalAddresses: string[]; // 非正式称呼：阿兄、阿姐、郎君
  forbiddenModern: string[]; // 禁用的现代词汇
  recommendedExpressions: string[]; // 推荐的古风表达
  speechPatternsByClass: {
    nobility: string[]; // 贵族说话特点
    commoner: string[]; // 平民说话特点
    servant: string[]; // 仆人说话特点
    eunuch?: string[]; // 太监特殊用语（如"奴才"）
    scholar?: string[]; // 文人特殊用语
  };
}

/**
 * 角色对话约束
 */
export interface CharacterDialogueConstraints {
  characterName: string;
  socialClass: string; // nobility, commoner, servant, etc.
  personality: string[];
  background: string;
  speechPatterns: string[];
  forbiddenPhrases: string[];
  emotionalTendency: string[];
  dialogueExamples?: string[];
}

/**
 * 对话真实性检测结果
 */
export interface DialogueRealismCheck {
  isRealistic: boolean;
  issues: Array<{
    type: "rank_mismatch" | "emotion_mismatch" | "modern_expression";
    dialogue: string;
    description: string;
    suggestion: string;
  }>;
}

/**
 * 对话节奏分析结果
 */
export interface DialoguePacingAnalysis {
  consecutiveDialogues: number; // 连续对话句数
  needsActionDescription: boolean; // 是否需要插入动作描写
  suggestedActions: string[]; // 建议的动作描写
}

// ==================== 预设时代对话约束 ====================

/**
 * 各朝代对话约束数据
 */
const DYNASTY_DIALECT_CONSTRAINTS: Record<string, DialectConstraints> = {
  汉朝: {
    dynasty: "汉朝",
    formalAddresses: ["陛下", "殿下", "大人", "将军", "太守", "县令"],
    informalAddresses: ["兄长", "阿兄", "阿姐", "郎君", "娘子"],
    forbiddenModern: [
      "OK",
      "没问题",
      "搞定",
      "给力",
      "靠谱",
      "尴尬",
      "怎么了",
      "是吗",
      "谢谢",
    ],
    recommendedExpressions: [
      "何事",
      "果真",
      "当真",
      "多谢",
      "谢过",
      "诺",
      "是",
      "遵命",
    ],
    speechPatternsByClass: {
      nobility: [
        "语气端庄，多用完整句式",
        "称呼他人用敬称",
        "自称'本侯'、'某'",
      ],
      commoner: [
        "语气朴实，多用短句",
        "称呼用'你'、'您'",
        "自称'小人'、'在下'",
      ],
      servant: [
        "语气恭敬，带'奴婢'、'小的'",
        "称呼主人用'老爷'、'夫人'",
        "多用'是'、'遵命'",
      ],
    },
  },
  唐朝: {
    dynasty: "唐朝",
    formalAddresses: ["圣上", "陛下", "殿下", "大人", "将军", "相公"],
    informalAddresses: ["郎君", "娘子", "阿翁", "阿姊", "兄台"],
    forbiddenModern: [
      "OK",
      "没问题",
      "搞定",
      "给力",
      "靠谱",
      "尴尬",
      "怎么了",
      "是吗",
      "谢谢",
    ],
    recommendedExpressions: [
      "何事",
      "果真",
      "当真",
      "多谢",
      "谢过",
      "诺",
      "是",
      "遵命",
      "善",
    ],
    speechPatternsByClass: {
      nobility: [
        "语气从容，多用雅言",
        "称呼他人用官职或尊称",
        "自称'本王'、'某'、'吾'",
      ],
      commoner: [
        "语气直率，多用俗语",
        "称呼用'你'、'您'",
        "自称'小人'、'在下'",
      ],
      servant: [
        "语气恭敬，多用'奴婢'、'小的'",
        "称呼主人用'郎君'、'娘子'",
        "多用'是'、'遵命'",
      ],
      scholar: [
        "语气文雅，喜用典故",
        "称呼用'先生'、'兄台'",
        "自称'某'、'鄙人'、'愚兄'",
      ],
    },
  },
  宋朝: {
    dynasty: "宋朝",
    formalAddresses: ["官家", "陛下", "殿下", "大人", "相公", "知府"],
    informalAddresses: ["相公", "娘子", "小娘子", "官人", "兄台"],
    forbiddenModern: [
      "OK",
      "没问题",
      "搞定",
      "给力",
      "靠谱",
      "尴尬",
      "怎么了",
      "是吗",
      "谢谢",
    ],
    recommendedExpressions: [
      "何事",
      "果真",
      "当真",
      "多谢",
      "谢过",
      "诺",
      "是",
      "遵命",
      "善哉",
    ],
    speechPatternsByClass: {
      nobility: ["语气温和文雅", "称呼他人用官职或尊称", "自称'本官'、'某'"],
      commoner: [
        "语气市井气息浓",
        "称呼用'你'、'您'、'这位'",
        "自称'小人'、'在下'、'洒家'（武人）",
      ],
      servant: [
        "语气恭敬，多用'奴婢'、'小的'",
        "称呼主人用'老爷'、'相公'、'娘子'",
        "多用'是'、'晓得了'",
      ],
      scholar: [
        "语气斯文，喜用典故和诗词",
        "称呼用'先生'、'兄台'、'足下'",
        "自称'某'、'鄙人'、'愚兄'、'小生'",
      ],
    },
  },
  明朝: {
    dynasty: "明朝",
    formalAddresses: ["皇上", "万岁爷", "娘娘", "殿下", "大人", "老爷", "将军"],
    informalAddresses: ["相公", "娘子", "姑娘", "小姐", "公子", "少爷"],
    forbiddenModern: [
      "OK",
      "没问题",
      "搞定",
      "给力",
      "靠谱",
      "尴尬",
      "怎么了",
      "是吗",
      "谢谢",
    ],
    recommendedExpressions: [
      "何事",
      "果真",
      "当真",
      "多谢",
      "谢过",
      "是",
      "遵命",
      "晓得了",
    ],
    speechPatternsByClass: {
      nobility: [
        "语气威严或温和",
        "称呼他人用官职或尊称",
        "自称'本官'、'本王'",
      ],
      commoner: [
        "语气朴实直接",
        "称呼用'你'、'您'、'这位爷'",
        "自称'小人'、'在下'、'草民'",
      ],
      servant: [
        "语气恭敬，多用'奴婢'、'小的'、'奴才'（太监）",
        "称呼主人用'老爷'、'太太'、'小姐'、'少爷'",
        "多用'是'、'晓得了'、'回老爷'",
      ],
      eunuch: [
        "自称'奴才'、'咱家'",
        "称呼皇帝'万岁爷'、'皇上'",
        "语气柔和但有威严（高位太监）",
      ],
    },
  },
  清朝: {
    dynasty: "清朝",
    formalAddresses: [
      "皇上",
      "万岁爷",
      "娘娘",
      "殿下",
      "大人",
      "主子",
      "格格",
      "阿哥",
      "贝勒",
    ],
    informalAddresses: ["爷", "姑娘", "小姐", "少爷", "哥哥", "姐姐"],
    forbiddenModern: [
      "OK",
      "没问题",
      "搞定",
      "给力",
      "靠谱",
      "尴尬",
      "怎么了",
      "是吗",
      "谢谢",
    ],
    recommendedExpressions: [
      "何事",
      "果真",
      "当真",
      "多谢",
      "谢过",
      "是",
      "遵旨",
      "晓得了",
      "扎",
    ],
    speechPatternsByClass: {
      nobility: [
        "语气威严（满人）或温和（汉人）",
        "满人自称'本贝勒'、'本格格'",
        "汉人自称'本官'、'下官'",
      ],
      commoner: [
        "语气朴实",
        "称呼用'您'、'您老'、'这位爷'",
        "自称'小人'、'在下'、'草民'",
      ],
      servant: [
        "语气恭敬，满人家奴称'奴才'",
        "汉人仆人称'小的'、'奴婢'（女）",
        "称呼主人用'主子'、'老爷'、'太太'、'格格'",
      ],
      eunuch: [
        "自称'奴才'、'咱家'（高位）",
        "称呼皇帝'万岁爷'、'皇上'、'主子'",
        "语气柔和但有威严（高位太监）",
      ],
    },
  },
};

// ==================== 现代词汇黑名单 ====================

/**
 * 通用现代词汇黑名单（适用于所有古代背景）
 */
const MODERN_VOCABULARY_BLACKLIST: Array<{
  term: string;
  category: string;
  ancientAlternative: string;
}> = [
  // 日常用语
  { term: "OK", category: "口语", ancientAlternative: "好、可以、行" },
  { term: "没问题", category: "口语", ancientAlternative: "无妨、可以" },
  { term: "搞定", category: "口语", ancientAlternative: "办妥、完成" },
  { term: "给力", category: "口语", ancientAlternative: "有力、得力" },
  { term: "靠谱", category: "口语", ancientAlternative: "可靠、稳妥" },
  { term: "尴尬", category: "口语", ancientAlternative: "窘迫、不自在" },
  { term: "怎么了", category: "口语", ancientAlternative: "何事、出了何事" },
  { term: "是吗", category: "口语", ancientAlternative: "当真、果真" },
  { term: "谢谢", category: "口语", ancientAlternative: "多谢、谢过" },
  { term: "老板", category: "称呼", ancientAlternative: "东家、掌柜" },
  { term: "帅哥", category: "称呼", ancientAlternative: "公子、郎君" },
  { term: "美女", category: "称呼", ancientAlternative: "娘子、姑娘" },

  // 现代科技
  { term: "电话", category: "科技", ancientAlternative: "（古代无此物）" },
  { term: "手机", category: "科技", ancientAlternative: "（古代无此物）" },
  { term: "电脑", category: "科技", ancientAlternative: "（古代无此物）" },
  { term: "网络", category: "科技", ancientAlternative: "（古代无此物）" },

  // 现代概念
  { term: "民主", category: "政治", ancientAlternative: "（古代无此概念）" },
  { term: "自由", category: "政治", ancientAlternative: "自在、无拘无束" },
  { term: "平等", category: "政治", ancientAlternative: "（古代无此概念）" },
  { term: "人权", category: "政治", ancientAlternative: "（古代无此概念）" },

  // 网络用语
  { term: "666", category: "网络", ancientAlternative: "（现代网络用语）" },
  { term: "233", category: "网络", ancientAlternative: "（现代网络用语）" },
  { term: "awsl", category: "网络", ancientAlternative: "（现代网络用语）" },
  { term: "yyds", category: "网络", ancientAlternative: "（现代网络用语）" },

  // 粗俗用语
  { term: "卧槽", category: "粗俗", ancientAlternative: "（避免使用）" },
  { term: "我去", category: "粗俗", ancientAlternative: "（避免使用）" },
  { term: "靠", category: "粗俗", ancientAlternative: "（避免使用）" },
];

// ==================== 服务实现 ====================

@Injectable()
export class DialogueConstraintsService {
  private readonly logger = new Logger(DialogueConstraintsService.name);

  constructor(
    private readonly characterPersonality: CharacterPersonalityService,
  ) {}

  // ==================== 时代对话约束 ====================

  /**
   * 获取指定朝代的对话约束
   */
  getDialectConstraints(dynasty: string): DialectConstraints | null {
    const constraints = DYNASTY_DIALECT_CONSTRAINTS[dynasty];
    if (!constraints) {
      this.logger.warn(
        `[DialogueConstraints] Dynasty "${dynasty}" not found in dialect constraints`,
      );
      return null;
    }
    return constraints;
  }

  /**
   * 生成时代对话约束提示词（供 Writer Agent 使用）
   */
  async generateDialectConstraintPrompt(dynasty: string): Promise<string> {
    const constraints = this.getDialectConstraints(dynasty);
    if (!constraints) {
      return "";
    }

    const parts: string[] = [`## 对话风格约束（${dynasty}宫廷）\n`];

    // 称呼规范
    parts.push("### 称呼规范");
    if (constraints.formalAddresses.length > 0) {
      parts.push(`**正式场合**: ${constraints.formalAddresses.join("、")}`);
    }
    if (constraints.informalAddresses.length > 0) {
      parts.push(`**私下场合**: ${constraints.informalAddresses.join("、")}`);
    }
    parts.push("");

    // 禁用词汇
    parts.push("### 禁用词汇（现代表达）");
    const modernTerms = constraints.forbiddenModern.slice(0, 10);
    for (const term of modernTerms) {
      const alternative = MODERN_VOCABULARY_BLACKLIST.find(
        (v) => v.term === term,
      );
      if (alternative) {
        parts.push(`- ❌ "${term}" → ✅ ${alternative.ancientAlternative}`);
      } else {
        parts.push(`- ❌ "${term}"`);
      }
    }
    parts.push("");

    // 推荐表达
    parts.push("### 推荐古风表达");
    parts.push(constraints.recommendedExpressions.join("、"));
    parts.push("");

    // 阶级语言特征
    parts.push("### 不同阶级对话特征");
    for (const [className, patterns] of Object.entries(
      constraints.speechPatternsByClass,
    )) {
      const classNameCN = this.translateClassName(className);
      parts.push(`**${classNameCN}**:`);
      for (const pattern of patterns) {
        parts.push(`  - ${pattern}`);
      }
      parts.push("");
    }

    // 对话真实性要求
    parts.push("### 对话真实性要求");
    parts.push('- 上下级对话：下位者应有恭敬语气词（"是"/"诺"/"遵命"）');
    parts.push("- 同级对话：可直接称呼姓名或昵称");
    parts.push("- 对话不能是纯信息交换，要有情绪和潜台词");
    parts.push("- 连续5句以上对话需插入动作、神态描写");

    return parts.join("\n");
  }

  /**
   * 翻译类别名称
   */
  private translateClassName(className: string): string {
    const map: Record<string, string> = {
      nobility: "贵族",
      commoner: "平民",
      servant: "仆人",
      eunuch: "太监",
      scholar: "文人",
    };
    return map[className] || className;
  }

  // ==================== 角色个性化对话约束 ====================

  /**
   * 生成角色对话约束
   */
  async generateCharacterDialogueConstraints(input: {
    projectId: string;
    characterName: string;
    socialClass?: string;
  }): Promise<CharacterDialogueConstraints | null> {
    // 获取角色信息
    const character = await this.characterPersonality.getCharacterByName(
      input.projectId,
      input.characterName,
    );

    if (!character) {
      this.logger.warn(
        `[DialogueConstraints] Character "${input.characterName}" not found`,
      );
      return null;
    }

    // 获取人格约束
    const constraints =
      await this.characterPersonality.getPersonalityConstraints(
        input.projectId,
        [input.characterName],
      );

    if (constraints.length === 0) {
      this.logger.warn(
        `[DialogueConstraints] No personality constraints found for "${input.characterName}"`,
      );
      return null;
    }

    const constraint = constraints[0];

    // 解析角色属性
    const personality =
      typeof character.personality === "object" &&
      character.personality !== null &&
      "traits" in character.personality &&
      Array.isArray(character.personality.traits)
        ? (character.personality.traits as string[])
        : [];

    return {
      characterName: character.name,
      socialClass: input.socialClass || "commoner",
      personality,
      background: character.background || "",
      speechPatterns: constraint.speechPatterns,
      forbiddenPhrases: constraint.tabooWords,
      emotionalTendency: constraint.emotionalTendency,
      dialogueExamples: constraint.dialogueExamples.map((ex) => ex.dialogue),
    };
  }

  /**
   * 生成角色对话约束提示词
   */
  async generateCharacterDialoguePrompt(
    projectId: string,
    characterName: string,
    socialClass?: string,
  ): Promise<string> {
    const constraints = await this.generateCharacterDialogueConstraints({
      projectId,
      characterName,
      socialClass,
    });

    if (!constraints) {
      return "";
    }

    const parts: string[] = [`## 角色对话约束：${characterName}\n`];

    // 身份信息
    const classNameCN = this.translateClassName(constraints.socialClass);
    parts.push(`**身份**: ${classNameCN}`);

    // 性格特点
    if (constraints.personality.length > 0) {
      parts.push(`**性格**: ${constraints.personality.join("、")}`);
    }

    // 说话特点
    parts.push("\n### 说话特点");
    const speechDesc = this.generateSpeechDescription(
      constraints.socialClass,
      constraints.personality,
    );
    for (const desc of speechDesc) {
      parts.push(`- ${desc}`);
    }

    // 常用表达
    if (constraints.speechPatterns.length > 0) {
      parts.push("\n### 常用表达");
      parts.push(constraints.speechPatterns.slice(0, 10).join("、"));
    }

    // 禁用词汇
    if (constraints.forbiddenPhrases.length > 0) {
      parts.push("\n### 禁止使用");
      for (const phrase of constraints.forbiddenPhrases.slice(0, 10)) {
        parts.push(`- ❌ ${phrase}`);
      }
    }

    // 情绪倾向
    if (constraints.emotionalTendency.length > 0) {
      parts.push("\n### 情绪表达方式");
      parts.push(constraints.emotionalTendency.join("；"));
    }

    // 对话示例
    if (
      constraints.dialogueExamples &&
      constraints.dialogueExamples.length > 0
    ) {
      parts.push("\n### 对话参考");
      for (const example of constraints.dialogueExamples.slice(0, 3)) {
        parts.push(`- "${example}"`);
      }
    }

    return parts.join("\n");
  }

  /**
   * 根据阶级和性格生成说话描述
   */
  private generateSpeechDescription(
    socialClass: string,
    personality: string[],
  ): string[] {
    const descriptions: string[] = [];

    // 基于阶级的基础描述
    const classDescriptions: Record<string, string[]> = {
      nobility: ["语气端庄", "措辞讲究", "多用完整句式"],
      commoner: ["语气朴实", "用词直白", "多用短句"],
      servant: ["语气恭敬", "称呼谨慎", "多用'是'、'遵命'等"],
      eunuch: ["语气柔和", "自称'奴才'", "对上位者极度恭敬"],
      scholar: ["语气文雅", "喜用典故", "句式工整"],
    };

    if (classDescriptions[socialClass]) {
      descriptions.push(...classDescriptions[socialClass]);
    }

    // 基于性格的补充描述
    const personalityMap: Record<string, string> = {
      聪慧: "言简意赅，一语中的",
      隐忍: "话语含蓄，留有余地",
      有城府: "说话滴水不漏，暗藏机锋",
      活泼: "语速较快，多用语气词",
      温和: "语气柔和，少用强硬表达",
      刚强: "语气坚定，多用肯定句",
      谨慎: "说话三思而行，多用委婉语",
    };

    for (const trait of personality) {
      if (personalityMap[trait]) {
        descriptions.push(personalityMap[trait]);
      }
    }

    return descriptions;
  }

  // ==================== 对话真实性检测 ====================

  /**
   * 检测对话是否符合角色设定和时代背景
   */
  async checkDialogueRealism(input: {
    projectId: string;
    dynasty: string;
    dialogues: Array<{
      characterName: string;
      dialogue: string;
      emotion?: string; // 当前情绪状态
      targetRank?: string; // 说话对象的身份等级
    }>;
  }): Promise<DialogueRealismCheck> {
    const issues: DialogueRealismCheck["issues"] = [];

    const dialectConstraints = this.getDialectConstraints(input.dynasty);

    for (const dialogueItem of input.dialogues) {
      const { characterName, dialogue, emotion, targetRank } = dialogueItem;

      // 1. 检测现代词汇
      for (const blacklisted of MODERN_VOCABULARY_BLACKLIST) {
        if (dialogue.includes(blacklisted.term)) {
          issues.push({
            type: "modern_expression",
            dialogue: dialogue.substring(0, 50) + "...",
            description: `对话中使用了现代词汇 "${blacklisted.term}"`,
            suggestion: `请替换为古代表达：${blacklisted.ancientAlternative}`,
          });
        }
      }

      // 2. 检测身份等级用语
      if (targetRank && dialectConstraints) {
        const rankIssue = this.checkRankMismatch(
          dialogue,
          targetRank,
          dialectConstraints,
        );
        if (rankIssue) {
          issues.push({
            type: "rank_mismatch",
            dialogue: dialogue.substring(0, 50) + "...",
            description: rankIssue.description,
            suggestion: rankIssue.suggestion,
          });
        }
      }

      // 3. 检测情绪与语气匹配
      if (emotion) {
        const emotionIssue = this.checkEmotionMismatch(dialogue, emotion);
        if (emotionIssue) {
          issues.push({
            type: "emotion_mismatch",
            dialogue: dialogue.substring(0, 50) + "...",
            description: emotionIssue.description,
            suggestion: emotionIssue.suggestion,
          });
        }
      }

      // 4. 检测角色禁用词汇
      const characterConstraints =
        await this.generateCharacterDialogueConstraints({
          projectId: input.projectId,
          characterName,
        });

      if (characterConstraints) {
        for (const forbidden of characterConstraints.forbiddenPhrases) {
          if (dialogue.includes(forbidden)) {
            issues.push({
              type: "modern_expression",
              dialogue: dialogue.substring(0, 50) + "...",
              description: `${characterName} 使用了不符合人格的词汇 "${forbidden}"`,
              suggestion: `${characterName} 不会说 "${forbidden}"，请使用更符合其性格的表达`,
            });
          }
        }
      }
    }

    return {
      isRealistic: issues.length === 0,
      issues,
    };
  }

  /**
   * 检查身份等级用语是否正确
   */
  private checkRankMismatch(
    dialogue: string,
    targetRank: string,
    constraints: DialectConstraints,
  ): { description: string; suggestion: string } | null {
    // 检查是否使用了正确的称呼
    const requiresFormal = ["emperor", "nobility", "superior"].includes(
      targetRank,
    );

    if (requiresFormal) {
      const hasFormalAddress = constraints.formalAddresses.some((addr) =>
        dialogue.includes(addr),
      );

      if (!hasFormalAddress && dialogue.length > 10) {
        return {
          description: "对上位者说话应使用正式称呼",
          suggestion: `应使用：${constraints.formalAddresses.slice(0, 3).join("、")}`,
        };
      }
    }

    return null;
  }

  /**
   * 检查情绪与语气是否匹配
   */
  private checkEmotionMismatch(
    dialogue: string,
    emotion: string,
  ): { description: string; suggestion: string } | null {
    const emotionMarkers: Record<
      string,
      { markers: string[]; suggestion: string }
    > = {
      愤怒: {
        markers: ["！", "岂", "竟敢", "放肆"],
        suggestion: "愤怒时应使用感叹句、质问句，可带强烈语气词",
      },
      悲伤: {
        markers: ["……", "唉", "罢了", "何必"],
        suggestion: "悲伤时语气低沉，多用省略号、叹词",
      },
      惊讶: {
        markers: ["！", "？", "竟", "居然", "当真"],
        suggestion: "惊讶时应使用疑问句、感叹句",
      },
      冷静: {
        markers: ["。", "是", "好", "知道了"],
        suggestion: "冷静时用词克制，多用陈述句",
      },
    };

    const emotionData = emotionMarkers[emotion];
    if (!emotionData) {
      return null;
    }

    const hasMarker = emotionData.markers.some((marker) =>
      dialogue.includes(marker),
    );

    if (!hasMarker && dialogue.length > 15) {
      return {
        description: `对话情绪为"${emotion}"，但语气不符`,
        suggestion: emotionData.suggestion,
      };
    }

    return null;
  }

  // ==================== 对话节奏优化 ====================

  /**
   * 分析对话节奏，建议插入动作/神态描写
   */
  analyzeDialoguePacing(content: string): DialoguePacingAnalysis {
    // 提取连续对话
    const dialogueMatches = content.match(/"[^"]+"/g) || [];

    let maxConsecutive = 0;
    let currentConsecutive = 0;
    let lastIndex = -1;

    for (let i = 0; i < dialogueMatches.length; i++) {
      const currentIndex = content.indexOf(dialogueMatches[i], lastIndex + 1);

      // 检查两段对话之间是否有足够的叙述文字
      if (lastIndex !== -1) {
        const betweenText = content.substring(lastIndex, currentIndex);
        const hasAction = /[，。]/.test(betweenText) && betweenText.length > 10;

        if (hasAction) {
          currentConsecutive = 1;
        } else {
          currentConsecutive++;
        }
      } else {
        currentConsecutive = 1;
      }

      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
      lastIndex = currentIndex + dialogueMatches[i].length;
    }

    // 根据连续对话数量生成建议
    const needsAction = maxConsecutive >= 5;
    const suggestedActions = needsAction
      ? this.generateActionSuggestions(maxConsecutive)
      : [];

    return {
      consecutiveDialogues: maxConsecutive,
      needsActionDescription: needsAction,
      suggestedActions,
    };
  }

  /**
   * 生成动作描写建议
   */
  private generateActionSuggestions(consecutiveCount: number): string[] {
    const suggestions: string[] = [];

    if (consecutiveCount >= 5) {
      suggestions.push("描写说话者的面部表情（皱眉、微笑、冷哼等）");
      suggestions.push("描写说话者的肢体动作（挥手、转身、起身等）");
    }

    if (consecutiveCount >= 7) {
      suggestions.push("描写场景细节（环境声音、光线变化等）");
      suggestions.push("描写听话者的反应（点头、摇头、沉默等）");
    }

    if (consecutiveCount >= 10) {
      suggestions.push("插入心理活动描写");
      suggestions.push("描写周围人物的反应");
    }

    return suggestions;
  }

  // ==================== 综合约束生成 ====================

  /**
   * 生成完整的对话约束提示词（时代 + 角色）
   */
  async generateCompleteDialogueConstraints(input: {
    projectId: string;
    dynasty: string;
    characterNames: string[];
  }): Promise<string> {
    const parts: string[] = [];

    // 1. 时代约束
    const dialectPrompt = await this.generateDialectConstraintPrompt(
      input.dynasty,
    );
    if (dialectPrompt) {
      parts.push(dialectPrompt);
      parts.push("\n---\n");
    }

    // 2. 角色约束
    for (const characterName of input.characterNames) {
      const characterPrompt = await this.generateCharacterDialoguePrompt(
        input.projectId,
        characterName,
      );
      if (characterPrompt) {
        parts.push(characterPrompt);
        parts.push("\n");
      }
    }

    return parts.join("\n");
  }
}
