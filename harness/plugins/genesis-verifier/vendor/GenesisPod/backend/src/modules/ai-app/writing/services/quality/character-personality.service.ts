/**
 * CharacterPersonalityService - 角色人格档案服务
 *
 * 核心职责：
 * - 管理角色的深度人格档案（语言风格、行为模式）
 * - 为 Writer Agent 提供角色人格约束
 * - 检测对话是否符合角色人格
 * - 自动从已有内容中学习角色特征
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import type {
  WritingCharacter,
  WritingCharacterPersonality,
} from "@prisma/client";

// ==================== 类型定义 ====================

/**
 * 角色人格约束（用于 Writer Agent）
 */
export interface PersonalityConstraint {
  characterId: string;
  characterName: string;
  speechPatterns: string[];
  vocabularyLevel: "formal" | "casual" | "mixed";
  emotionalTendency: string[];
  tabooWords: string[];
  catchphrases: string[];
  dialogueExamples: DialogueExample[];
}

/**
 * 对话样本
 */
export interface DialogueExample {
  id: string;
  characterId: string;
  dialogue: string;
  context: string;
  chapterId?: string;
}

/**
 * 对话验证结果
 */
export interface DialogueValidationResult {
  isValid: boolean;
  issues: Array<{
    characterName: string;
    dialogue: string;
    issue: string;
    suggestion: string;
  }>;
}

// ==================== 原有类型定义 ====================

/**
 * 角色人格向量 - 完整的角色人格描述
 */
export interface CharacterPersonalityVector {
  characterId: string;
  characterName: string;

  // 语言风格
  speechStyle: string;
  commonPhrases: string[];
  forbiddenPhrases: string[];
  sentencePattern?: string;

  // 行为模式
  thinkingStyle?: string;
  emotionPattern?: string;
  decisionStyle?: string;
  conflictBehavior?: string;

  // 社交特征
  interactionStyle?: string;
  trustLevel: number;
  assertiveness: number;

  // 特殊标记
  uniqueMannerisms: string[];
  voiceTone?: string;
}

/**
 * 人格一致性检测结果
 */
export interface PersonalityConsistencyResult {
  isConsistent: boolean;
  score: number; // 0-1
  violations: Array<{
    type: "forbidden_phrase" | "style_mismatch" | "behavior_inconsistent";
    description: string;
    location: string;
    suggestion: string;
  }>;
}

/**
 * 角色对话检测输入
 */
export interface DialogueCheckInput {
  characterName: string;
  dialogue: string;
  context?: string;
}

// ==================== 预设人格模板 ====================

/**
 * 常见角色类型的预设人格模板
 */
const PERSONALITY_TEMPLATES: Record<
  string,
  Partial<CharacterPersonalityVector>
> = {
  noble_lady: {
    speechStyle: "正式、含蓄、书卷气、措辞讲究",
    commonPhrases: ["姑娘", "确实", "倒也", "不妨", "想来"],
    forbiddenPhrases: ["哎呀", "天哪", "我去", "卧槽", "靠"],
    sentencePattern: "多用完整句式，少用语气词",
    thinkingStyle: "先观察后判断，谨慎周全",
    emotionPattern: "内敛含蓄，少有外露",
    interactionStyle: "礼貌有度，保持距离",
    trustLevel: 4,
    assertiveness: 6,
  },
  maid_servant: {
    speechStyle: "活泼、直接、口语化、带亲昵感",
    commonPhrases: ["小姐", "哎呀", "真的假的", "人家", "嘛"],
    forbiddenPhrases: ["确实", "自然", "想来", "不妨"],
    sentencePattern: "短句为主，多用语气词和叠词",
    thinkingStyle: "冲动直觉，少深思熟虑",
    emotionPattern: "外露夸张，喜怒形于色",
    interactionStyle: "热情亲近，少有距离感",
    trustLevel: 7,
    assertiveness: 4,
  },
  scheming_villain: {
    speechStyle: "圆滑、暗藏机锋、表面客气",
    commonPhrases: ["呵", "有趣", "这倒是", "说的是", "何必"],
    forbiddenPhrases: ["真诚地", "坦白说", "老实讲"],
    sentencePattern: "多用反问和设问，留有余地",
    thinkingStyle: "算计深远，多角度考虑利益",
    emotionPattern: "深藏不露，表情与内心不一",
    decisionStyle: "权衡利弊，趋利避害",
    interactionStyle: "表面亲和，实则防备",
    trustLevel: 2,
    assertiveness: 7,
  },
  righteous_hero: {
    speechStyle: "直率、正气、掷地有声",
    commonPhrases: ["岂能", "定要", "何惧", "正是"],
    forbiddenPhrases: ["也许吧", "随便", "无所谓", "算了"],
    sentencePattern: "多用肯定句和感叹句",
    thinkingStyle: "非黑即白，重义轻利",
    emotionPattern: "爱憎分明，情绪外露",
    decisionStyle: "果断决绝，不计后果",
    conflictBehavior: "正面对抗，绝不退缩",
    trustLevel: 8,
    assertiveness: 9,
  },
  wise_elder: {
    speechStyle: "温和、睿智、娓娓道来",
    commonPhrases: ["孩子", "且慢", "听我说", "当年", "切记"],
    forbiddenPhrases: ["赶紧", "快点", "没时间"],
    sentencePattern: "多用长句和复句，喜欢用典故",
    thinkingStyle: "全局视角，洞察深远",
    emotionPattern: "波澜不惊，宠辱不惊",
    decisionStyle: "深思熟虑，不急不躁",
    interactionStyle: "慈祥包容，循循善诱",
    trustLevel: 6,
    assertiveness: 5,
  },
};

// ==================== 服务实现 ====================

@Injectable()
export class CharacterPersonalityService {
  private readonly logger = new Logger(CharacterPersonalityService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================== 人格档案管理 ====================

  /**
   * 获取角色的人格向量
   */
  async getPersonalityVector(
    characterId: string,
  ): Promise<CharacterPersonalityVector | null> {
    const character = await this.prisma.writingCharacter.findUnique({
      where: { id: characterId },
      include: {
        personalityProfile: true,
      },
    });

    if (!character) {
      return null;
    }

    const profile = character.personalityProfile;

    return {
      characterId: character.id,
      characterName: character.name,
      speechStyle: profile?.speechStyle || "",
      commonPhrases: profile?.commonPhrases || [],
      forbiddenPhrases: profile?.forbiddenPhrases || [],
      sentencePattern: profile?.sentencePattern || undefined,
      thinkingStyle: profile?.thinkingStyle || undefined,
      emotionPattern: profile?.emotionPattern || undefined,
      decisionStyle: profile?.decisionStyle || undefined,
      conflictBehavior: profile?.conflictBehavior || undefined,
      interactionStyle: profile?.interactionStyle || undefined,
      trustLevel: profile?.trustLevel || 5,
      assertiveness: profile?.assertiveness || 5,
      uniqueMannerisms: profile?.uniqueMannerisms || [],
      voiceTone: profile?.voiceTone || undefined,
    };
  }

  /**
   * 获取项目中所有角色的人格向量
   */
  async getProjectPersonalityVectors(
    projectId: string,
  ): Promise<CharacterPersonalityVector[]> {
    const project = await this.prisma.writingProject.findUnique({
      where: { id: projectId },
      include: {
        storyBible: {
          include: {
            characters: {
              include: {
                personalityProfile: true,
              },
            },
          },
        },
      },
    });

    if (!project?.storyBible) {
      return [];
    }

    return project.storyBible.characters.map((char) => ({
      characterId: char.id,
      characterName: char.name,
      speechStyle: char.personalityProfile?.speechStyle || "",
      commonPhrases: char.personalityProfile?.commonPhrases || [],
      forbiddenPhrases: char.personalityProfile?.forbiddenPhrases || [],
      sentencePattern: char.personalityProfile?.sentencePattern || undefined,
      thinkingStyle: char.personalityProfile?.thinkingStyle || undefined,
      emotionPattern: char.personalityProfile?.emotionPattern || undefined,
      decisionStyle: char.personalityProfile?.decisionStyle || undefined,
      conflictBehavior: char.personalityProfile?.conflictBehavior || undefined,
      interactionStyle: char.personalityProfile?.interactionStyle || undefined,
      trustLevel: char.personalityProfile?.trustLevel || 5,
      assertiveness: char.personalityProfile?.assertiveness || 5,
      uniqueMannerisms: char.personalityProfile?.uniqueMannerisms || [],
      voiceTone: char.personalityProfile?.voiceTone || undefined,
    }));
  }

  /**
   * 创建或更新角色人格档案
   */
  async upsertPersonalityProfile(
    characterId: string,
    profile: Partial<CharacterPersonalityVector>,
  ): Promise<void> {
    const existing = await this.prisma.writingCharacterPersonality.findUnique({
      where: { characterId },
    });

    if (existing) {
      await this.prisma.writingCharacterPersonality.update({
        where: { characterId },
        data: {
          speechStyle: profile.speechStyle,
          commonPhrases: profile.commonPhrases,
          forbiddenPhrases: profile.forbiddenPhrases,
          sentencePattern: profile.sentencePattern,
          thinkingStyle: profile.thinkingStyle,
          emotionPattern: profile.emotionPattern,
          decisionStyle: profile.decisionStyle,
          conflictBehavior: profile.conflictBehavior,
          interactionStyle: profile.interactionStyle,
          trustLevel: profile.trustLevel,
          assertiveness: profile.assertiveness,
          uniqueMannerisms: profile.uniqueMannerisms,
          voiceTone: profile.voiceTone,
        },
      });
    } else {
      await this.prisma.writingCharacterPersonality.create({
        data: {
          characterId,
          speechStyle: profile.speechStyle || "",
          commonPhrases: profile.commonPhrases || [],
          forbiddenPhrases: profile.forbiddenPhrases || [],
          sentencePattern: profile.sentencePattern,
          thinkingStyle: profile.thinkingStyle,
          emotionPattern: profile.emotionPattern,
          decisionStyle: profile.decisionStyle,
          conflictBehavior: profile.conflictBehavior,
          interactionStyle: profile.interactionStyle,
          trustLevel: profile.trustLevel || 5,
          assertiveness: profile.assertiveness || 5,
          uniqueMannerisms: profile.uniqueMannerisms || [],
          voiceTone: profile.voiceTone,
        },
      });
    }

    this.logger.log(
      `[CharacterPersonality] Updated personality profile for character ${characterId}`,
    );
  }

  /**
   * 从预设模板初始化角色人格
   */
  async initializeFromTemplate(
    characterId: string,
    templateType: keyof typeof PERSONALITY_TEMPLATES,
  ): Promise<void> {
    const template = PERSONALITY_TEMPLATES[templateType];
    if (!template) {
      this.logger.warn(
        `[CharacterPersonality] Template "${templateType}" not found`,
      );
      return;
    }

    await this.upsertPersonalityProfile(characterId, template);
  }

  // ==================== 人格约束生成 ====================

  /**
   * 生成角色人格约束提示词（供 Writer Agent 使用）
   */
  async generatePersonalityConstraintPrompt(
    characterIds: string[],
  ): Promise<string> {
    if (characterIds.length === 0) {
      return "";
    }

    const vectors = await Promise.all(
      characterIds.map((id) => this.getPersonalityVector(id)),
    );

    const validVectors = vectors.filter(
      (v): v is CharacterPersonalityVector => v !== null,
    );

    if (validVectors.length === 0) {
      return "";
    }

    const parts: string[] = ["## 角色人格约束（对话必须符合以下特征）\n"];

    for (const vector of validVectors) {
      parts.push(`### ${vector.characterName}`);

      if (vector.speechStyle) {
        parts.push(`**说话风格**: ${vector.speechStyle}`);
      }

      if (vector.commonPhrases.length > 0) {
        parts.push(
          `**常用词汇**: ${vector.commonPhrases.slice(0, 10).join("、")}`,
        );
      }

      if (vector.forbiddenPhrases.length > 0) {
        parts.push(
          `**禁用词汇**: ❌ ${vector.forbiddenPhrases.slice(0, 10).join("、")}`,
        );
      }

      if (vector.sentencePattern) {
        parts.push(`**句式特点**: ${vector.sentencePattern}`);
      }

      if (vector.emotionPattern) {
        parts.push(`**情绪表达**: ${vector.emotionPattern}`);
      }

      if (vector.uniqueMannerisms.length > 0) {
        parts.push(
          `**特有习惯**: ${vector.uniqueMannerisms.slice(0, 5).join("、")}`,
        );
      }

      parts.push("");
    }

    return parts.join("\n");
  }

  /**
   * 通过角色名查询角色信息（支持别名匹配）
   */
  async getCharacterByName(
    projectId: string,
    characterName: string,
  ): Promise<WritingCharacter | null> {
    const project = await this.prisma.writingProject.findUnique({
      where: { id: projectId },
      include: {
        storyBible: {
          include: {
            characters: {
              include: {
                personalityProfile: true,
              },
            },
          },
        },
      },
    });

    if (!project?.storyBible) {
      return null;
    }

    // 查找匹配的角色（支持主名和别名）
    const character = project.storyBible.characters.find(
      (char) =>
        char.name === characterName ||
        char.aliases?.includes(characterName) ||
        false,
    );

    return character || null;
  }

  /**
   * 获取多个角色的人格约束
   */
  async getPersonalityConstraints(
    projectId: string,
    characterNames: string[],
  ): Promise<PersonalityConstraint[]> {
    if (characterNames.length === 0) {
      return [];
    }

    const project = await this.prisma.writingProject.findUnique({
      where: { id: projectId },
      include: {
        storyBible: {
          include: {
            characters: {
              include: {
                personalityProfile: true,
              },
            },
          },
        },
      },
    });

    if (!project?.storyBible) {
      return [];
    }

    const constraints: PersonalityConstraint[] = [];

    for (const name of characterNames) {
      const character = project.storyBible.characters.find(
        (char) => char.name === name || char.aliases?.includes(name) || false,
      );

      if (!character) {
        this.logger.warn(
          `[CharacterPersonality] Character "${name}" not found in project ${projectId}`,
        );
        continue;
      }

      const profile = character.personalityProfile;

      constraints.push({
        characterId: character.id,
        characterName: character.name,
        speechPatterns: profile?.commonPhrases || [],
        vocabularyLevel: this.inferVocabularyLevel(profile),
        emotionalTendency: profile?.emotionPattern
          ? [profile.emotionPattern]
          : [],
        tabooWords: profile?.forbiddenPhrases || [],
        catchphrases: profile?.commonPhrases?.slice(0, 5) || [],
        dialogueExamples: [], // 暂时返回空数组，未来可以从历史章节中提取
      });
    }

    return constraints;
  }

  /**
   * 生成角色约束提示词（基于 PersonalityConstraint）
   */
  generateConstraintPrompt(constraints: PersonalityConstraint[]): string {
    if (constraints.length === 0) {
      return "";
    }

    const parts: string[] = ["## 角色人格约束\n"];

    for (const constraint of constraints) {
      parts.push(`### ${constraint.characterName}`);

      if (constraint.speechPatterns.length > 0) {
        parts.push(
          `**常用表达**: ${constraint.speechPatterns.slice(0, 10).join("、")}`,
        );
      }

      if (constraint.vocabularyLevel) {
        const levelDesc =
          constraint.vocabularyLevel === "formal"
            ? "正式、文雅"
            : constraint.vocabularyLevel === "casual"
              ? "口语化、随意"
              : "混合风格";
        parts.push(`**用词风格**: ${levelDesc}`);
      }

      if (constraint.emotionalTendency.length > 0) {
        parts.push(`**情绪倾向**: ${constraint.emotionalTendency.join("、")}`);
      }

      if (constraint.tabooWords.length > 0) {
        parts.push(
          `**禁用词汇**: ❌ ${constraint.tabooWords.slice(0, 10).join("、")}`,
        );
      }

      if (constraint.catchphrases.length > 0) {
        parts.push(`**口头禅**: ${constraint.catchphrases.join("、")}`);
      }

      parts.push("");
    }

    return parts.join("\n");
  }

  /**
   * 验证对话是否符合角色性格
   */
  async validateDialogue(
    projectId: string,
    dialogues: Array<{ characterName: string; dialogue: string }>,
  ): Promise<DialogueValidationResult> {
    const issues: DialogueValidationResult["issues"] = [];

    // 获取所有相关角色的人格约束
    const characterNames = [...new Set(dialogues.map((d) => d.characterName))];
    const constraints = await this.getPersonalityConstraints(
      projectId,
      characterNames,
    );

    const constraintMap = new Map(constraints.map((c) => [c.characterName, c]));

    for (const { characterName, dialogue } of dialogues) {
      const constraint = constraintMap.get(characterName);
      if (!constraint) {
        // 角色未找到，跳过验证
        continue;
      }

      // 1. 检查禁用词汇
      for (const taboo of constraint.tabooWords) {
        if (dialogue.includes(taboo)) {
          issues.push({
            characterName,
            dialogue: dialogue.substring(0, 50) + "...",
            issue: `使用了禁用词汇 "${taboo}"`,
            suggestion: `${characterName} 不会使用 "${taboo}"，请替换为更符合其性格的表达`,
          });
        }
      }

      // 2. 检查是否使用了常用表达（正向指标）
      const hasCommonPhrase = constraint.speechPatterns.some((phrase) =>
        dialogue.includes(phrase),
      );

      // 3. 简单的风格匹配检查
      const isFormalDialogue = this.isFormalSpeech(dialogue);
      const expectedFormal = constraint.vocabularyLevel === "formal";

      if (isFormalDialogue !== expectedFormal && dialogue.length > 20) {
        const styleDesc = expectedFormal ? "正式" : "口语化";
        issues.push({
          characterName,
          dialogue: dialogue.substring(0, 50) + "...",
          issue: `语言风格不符合角色设定`,
          suggestion: `${characterName} 的说话风格应该是${styleDesc}的`,
        });
      }

      // 4. 如果对话较长但没有使用任何常用表达，给出提示
      if (
        dialogue.length > 30 &&
        !hasCommonPhrase &&
        constraint.speechPatterns.length > 0
      ) {
        issues.push({
          characterName,
          dialogue: dialogue.substring(0, 50) + "...",
          issue: `未体现角色特色表达`,
          suggestion: `建议融入 ${characterName} 的常用表达，如: ${constraint.speechPatterns.slice(0, 3).join("、")}`,
        });
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  }

  /**
   * 添加对话样本（暂时记录到 commonPhrases 中）
   */
  async addDialogueSample(
    projectId: string,
    characterName: string,
    dialogue: string,
    context?: string,
  ): Promise<void> {
    const character = await this.getCharacterByName(projectId, characterName);
    if (!character) {
      this.logger.warn(
        `[CharacterPersonality] Character "${characterName}" not found, cannot add dialogue sample`,
      );
      return;
    }

    // 提取对话中的短语（2-4个字的词组）
    const phrases = dialogue.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    const phraseFreq = new Map<string, number>();

    for (const phrase of phrases) {
      phraseFreq.set(phrase, (phraseFreq.get(phrase) || 0) + 1);
    }

    // 找出高频短语
    const significantPhrases = Array.from(phraseFreq.entries())
      .filter(([_, count]) => count >= 2)
      .map(([phrase]) => phrase);

    if (significantPhrases.length === 0) {
      return;
    }

    // 更新人格档案
    const existing = await this.prisma.writingCharacterPersonality.findUnique({
      where: { characterId: character.id },
    });

    if (existing) {
      // 合并新短语到 commonPhrases
      const updatedPhrases = [
        ...new Set([...existing.commonPhrases, ...significantPhrases]),
      ];

      await this.prisma.writingCharacterPersonality.update({
        where: { characterId: character.id },
        data: {
          commonPhrases: updatedPhrases.slice(0, 50), // 最多保留50个
        },
      });

      this.logger.log(
        `[CharacterPersonality] Added dialogue sample for ${characterName}, context: ${context || "N/A"}`,
      );
    }
  }

  /**
   * 获取对话样本（从 commonPhrases 中返回）
   */
  async getDialogueExamples(
    characterId: string,
    limit = 10,
  ): Promise<DialogueExample[]> {
    const personality =
      await this.prisma.writingCharacterPersonality.findUnique({
        where: { characterId },
      });

    if (!personality || personality.commonPhrases.length === 0) {
      return [];
    }

    // 将 commonPhrases 转换为 DialogueExample 格式
    return personality.commonPhrases.slice(0, limit).map((phrase, index) => ({
      id: `${characterId}-${index}`,
      characterId,
      dialogue: phrase,
      context: "历史对话样本",
      chapterId: undefined,
    }));
  }

  // ==================== 辅助方法 ====================

  /**
   * 推断词汇水平
   */
  private inferVocabularyLevel(
    profile: WritingCharacterPersonality | null,
  ): "formal" | "casual" | "mixed" {
    if (!profile) return "mixed";

    const style = profile.speechStyle.toLowerCase();

    if (
      style.includes("正式") ||
      style.includes("书卷") ||
      style.includes("文雅")
    ) {
      return "formal";
    }

    if (
      style.includes("口语") ||
      style.includes("随意") ||
      style.includes("活泼")
    ) {
      return "casual";
    }

    return "mixed";
  }

  /**
   * 判断对话是否为正式风格
   */
  private isFormalSpeech(dialogue: string): boolean {
    // 正式风格特征
    const formalIndicators = [
      "确实",
      "想来",
      "倒也",
      "不妨",
      "自然",
      "岂能",
      "何必",
    ];
    const casualIndicators = [
      "哎呀",
      "真的假的",
      "人家",
      "嘛",
      "啦",
      "呀",
      "喔",
    ];

    const formalCount = formalIndicators.filter((ind) =>
      dialogue.includes(ind),
    ).length;
    const casualCount = casualIndicators.filter((ind) =>
      dialogue.includes(ind),
    ).length;

    return formalCount > casualCount;
  }

  // ==================== 人格一致性检测 ====================

  /**
   * 检测内容中的对话是否符合角色人格
   */
  async checkPersonalityConsistency(
    projectId: string,
    content: string,
  ): Promise<PersonalityConsistencyResult> {
    const vectors = await this.getProjectPersonalityVectors(projectId);

    if (vectors.length === 0) {
      return {
        isConsistent: true,
        score: 1.0,
        violations: [],
      };
    }

    const violations: PersonalityConsistencyResult["violations"] = [];

    // 提取对话
    const dialogues = this.extractDialogues(content);

    for (const dialogue of dialogues) {
      // 尝试匹配对话的说话者
      const speaker = this.identifySpeaker(
        dialogue.context,
        vectors.map((v) => v.characterName),
      );

      if (!speaker) continue;

      const vector = vectors.find((v) => v.characterName === speaker);
      if (!vector) continue;

      // 检查禁用词汇
      for (const forbidden of vector.forbiddenPhrases) {
        if (dialogue.text.includes(forbidden)) {
          violations.push({
            type: "forbidden_phrase",
            description: `角色 ${speaker} 使用了禁用词汇 "${forbidden}"`,
            location: dialogue.text.substring(0, 50) + "...",
            suggestion: `${speaker} 不会说 "${forbidden}"，请使用更符合其人格的表达`,
          });
        }
      }

      // 检查风格匹配（简化检测）
      const styleScore = this.evaluateStyleMatch(dialogue.text, vector);
      if (styleScore < 0.5) {
        violations.push({
          type: "style_mismatch",
          description: `角色 ${speaker} 的对话风格不符合其人格设定`,
          location: dialogue.text.substring(0, 50) + "...",
          suggestion: `${speaker} 的说话风格应该是: ${vector.speechStyle}`,
        });
      }
    }

    const score = Math.max(0, 1 - violations.length * 0.1);

    return {
      isConsistent: violations.length === 0,
      score,
      violations,
    };
  }

  /**
   * 从内容中提取对话
   */
  private extractDialogues(
    content: string,
  ): Array<{ text: string; context: string }> {
    const dialogues: Array<{ text: string; context: string }> = [];

    // 匹配中文引号内的对话
    const patterns = [
      /"([^"]+)"/g, // 中文双引号
      /"([^"]+)"/g, // 英文双引号
      /「([^」]+)」/g, // 日式引号
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const dialogueText = match[1];
        // 获取对话前的上下文（前50个字符）
        const startIndex = Math.max(0, match.index - 50);
        const context = content.substring(startIndex, match.index);

        dialogues.push({
          text: dialogueText,
          context,
        });
      }
    }

    return dialogues;
  }

  /**
   * 从上下文识别说话者
   */
  private identifySpeaker(
    context: string,
    characterNames: string[],
  ): string | null {
    // 查找上下文中最后出现的角色名
    let lastFound: { name: string; index: number } | null = null;

    for (const name of characterNames) {
      const index = context.lastIndexOf(name);
      if (index !== -1) {
        if (!lastFound || index > lastFound.index) {
          lastFound = { name, index };
        }
      }
    }

    return lastFound?.name || null;
  }

  /**
   * 评估对话与人格的风格匹配度
   */
  private evaluateStyleMatch(
    dialogue: string,
    vector: CharacterPersonalityVector,
  ): number {
    let score = 0.5; // 基础分

    // 检查常用词汇的使用
    for (const phrase of vector.commonPhrases) {
      if (dialogue.includes(phrase)) {
        score += 0.1;
      }
    }

    // 检查语气词使用（根据风格）
    const exclamations = (dialogue.match(/[！!？?]/g) || []).length;
    const dialogueLength = dialogue.length;
    const exclamationRatio = exclamations / dialogueLength;

    // 外向型角色应该有更多语气词
    if (vector.assertiveness >= 7) {
      if (exclamationRatio > 0.05) score += 0.1;
    } else if (vector.assertiveness <= 3) {
      if (exclamationRatio < 0.02) score += 0.1;
    }

    return Math.min(1, score);
  }

  // ==================== 人格学习 ====================

  /**
   * 从已有章节内容中学习角色人格特征
   * （用于初始化或完善人格档案）
   */
  async learnFromContent(
    _characterId: string,
    characterName: string,
    content: string,
  ): Promise<Partial<CharacterPersonalityVector>> {
    // 提取该角色的对话
    const dialogues = this.extractDialogues(content).filter((d) =>
      d.context.includes(characterName),
    );

    if (dialogues.length === 0) {
      return {};
    }

    // 分析对话特征
    const allDialogueText = dialogues.map((d) => d.text).join(" ");

    // 提取常用词汇（简化实现）
    const wordFreq = new Map<string, number>();
    const words = allDialogueText.match(/[\u4e00-\u9fa5]{2,4}/g) || [];

    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }

    const commonPhrases = Array.from(wordFreq.entries())
      .filter(([_, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);

    // 分析语气特征
    const totalExclamations = (allDialogueText.match(/[！!]/g) || []).length;
    const totalQuestions = (allDialogueText.match(/[？?]/g) || []).length;
    const avgLength =
      dialogues.reduce((sum, d) => sum + d.text.length, 0) / dialogues.length;

    let speechStyle = "";
    if (avgLength > 30) speechStyle += "话多、详细";
    else speechStyle += "简洁、精练";

    if (totalExclamations > dialogues.length * 0.3) speechStyle += "、情绪外露";
    else speechStyle += "、情绪内敛";

    if (totalQuestions > dialogues.length * 0.2) speechStyle += "、好奇心强";

    return {
      commonPhrases,
      speechStyle,
      assertiveness:
        totalExclamations > dialogues.length * 0.5
          ? 8
          : totalExclamations > dialogues.length * 0.2
            ? 6
            : 4,
    };
  }
}
