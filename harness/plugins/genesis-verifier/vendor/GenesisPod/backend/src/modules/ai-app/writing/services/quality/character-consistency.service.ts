/**
 * CharacterConsistencyService - 角色一致性服务
 *
 * 核心职责：
 * - 追踪角色的物理、情感、关系、知识状态
 * - 检测 OOC（Out of Character）行为
 * - 追踪角色成长并验证其合理性
 * - 为 Writer Agent 生成角色行为约束提示词
 * - 管理角色状态时间线
 *
 * 架构定位：
 * - 位于 Quality 层，作为写作质量保证的一部分
 * - 与 CharacterPersonalityService 协作（后者管理语言风格，本服务管理状态和行为）
 * - 与 StoryBible 集成，读写角色状态数据
 */

import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import type { WritingCharacter } from "@prisma/client";
import type {
  WritingCharacterEntity,
  CharacterStateSnapshot,
  CharacterStateTransition,
} from "../../interfaces/writing-context.interface";

// ==================== 类型定义 ====================

/**
 * 角色完整状态（融合静态设定和动态状态）
 */
export interface CharacterState {
  characterId: string;
  name: string;

  // 物理状态
  physicalState: {
    health: "healthy" | "injured" | "critical" | "unconscious" | "dead";
    injuries?: string[]; // 受伤描述
    location?: string; // 当前位置
    condition?: string; // 其他状态（疲惫、醉酒等）
  };

  // 情感状态
  emotionalState: {
    mood: string; // 当前情绪（焦虑、愤怒、平静等）
    moodHistory?: Array<{
      chapterNumber: number;
      mood: string;
      trigger?: string; // 情绪触发事件
    }>;
    dominantEmotion?: string; // 主导情绪
  };

  // 关系状态（与其他角色的关系）
  relationships: Record<
    string,
    {
      characterName: string;
      relationType: "ally" | "enemy" | "neutral" | "romantic" | "family";
      trustLevel: number; // 0-100
      affinity: number; // 好感度 -100 ~ 100
      lastInteraction?: {
        chapterNumber: number;
        summary: string;
        outcome: "positive" | "negative" | "neutral";
      };
    }
  >;

  // 知识状态（角色知道什么）
  knownSecrets: string[]; // 角色已知的秘密
  knownEvents: string[]; // 角色已知的事件
  beliefs: string[]; // 角色的信念和认知

  // 隐藏秘密（角色不知道的剧情信息，只有作者知道）
  hiddenSecrets: string[];

  // 目标和动机
  goals: Array<{
    description: string;
    priority: "primary" | "secondary" | "minor";
    status: "active" | "achieved" | "failed" | "abandoned";
  }>;

  // 状态时间线（追踪状态变化）
  stateTimeline: CharacterStateSnapshot[];

  // 身份/立场转变记录
  stateTransitions: CharacterStateTransition[];
}

/**
 * OOC（Out of Character）检测结果
 */
export interface OOCDetectionResult {
  isOOC: boolean;
  severity: "low" | "medium" | "high"; // 违和程度
  reason?: string; // OOC 原因
  suggestion?: string; // 修改建议
  violationType?:
    | "personality_conflict" // 性格冲突
    | "impulsive_decision" // 冲动决策（违反性格）
    | "inconsistent_knowledge" // 知识不一致（知道不该知道的）
    | "relationship_violation" // 关系违反（对敌人太友好）
    | "unmotivated_change"; // 无动机变化
}

/**
 * 角色成长验证结果
 */
export interface CharacterGrowthValidationResult {
  isValid: boolean;
  issues: Array<{
    type: "no_trigger" | "too_sudden" | "inconsistent_with_setup";
    description: string;
    suggestion: string;
  }>;
}

/**
 * 角色行为约束（生成的提示词片段）
 */
export interface CharacterBehaviorConstraints {
  characterName: string;
  coreTraits: string[]; // 核心性格特征
  behaviorPatterns: string[]; // 行为模式
  prohibitions: string[]; // 行为禁止项
  encouragements: string[]; // 行为鼓励项
  currentStateConstraints: string[]; // 基于当前状态的约束
  relationshipConstraints: string[]; // 基于人际关系的约束
}

/**
 * ★★★ 新增：角色名称验证结果 ★★★
 * 检测内容中的角色名称是否与 Story Bible 一致
 */
export interface CharacterNameValidationResult {
  isValid: boolean;
  issues: CharacterNameIssue[];
  mentionedCharacters: string[]; // 内容中提到的所有角色名
  unmatchedNames: string[]; // 无法匹配的名字
}

export interface CharacterNameIssue {
  type:
    | "unknown_character" // 未知角色（可能是笔误或遗漏）
    | "inconsistent_name" // 名字不一致（如用别名代替正名）
    | "wrong_title" // 称谓错误
    | "possible_typo"; // 可能的笔误
  foundName: string; // 在内容中发现的名字
  suggestedName?: string; // 建议使用的正确名字
  context?: string; // 上下文（名字出现的位置）
  severity: "error" | "warning";
}

// ==================== 服务实现 ====================

@Injectable()
export class CharacterConsistencyService {
  private readonly logger = new Logger(CharacterConsistencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================== 角色状态管理 ====================

  /**
   * 获取角色的完整状态
   */
  async getCharacterState(characterId: string): Promise<CharacterState | null> {
    const character = await this.prisma.writingCharacter.findUnique({
      where: { id: characterId },
      include: {
        personalityProfile: true,
      },
    });

    if (!character) {
      return null;
    }

    return this.buildCharacterState(character);
  }

  /**
   * 获取项目中所有角色的状态
   */
  async getProjectCharacterStates(
    projectId: string,
  ): Promise<CharacterState[]> {
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

    return project.storyBible.characters.map((char) =>
      this.buildCharacterState(char),
    );
  }

  /**
   * 更新角色状态（章节写完后调用）
   *
   * ★ 使用事务确保并行场景下的数据一致性
   */
  async updateCharacterState(
    characterId: string,
    chapterNumber: number,
    stateUpdates: Partial<CharacterState>,
  ): Promise<void> {
    // ★ 使用事务确保读取和更新的原子性，避免并行写作时的竞态条件
    await this.prisma.$transaction(async (tx) => {
      const character = await tx.writingCharacter.findUnique({
        where: { id: characterId },
      });

      if (!character) {
        this.logger.warn(
          `[CharacterConsistency] Character ${characterId} not found`,
        );
        return;
      }

      // 读取当前状态
      const currentState = (character.currentState || {}) as Record<
        string,
        unknown
      >;
      const stateTimeline = (character.stateTimeline || []) as unknown[];

      // 创建状态快照
      const snapshot = {
        storyTime: `第${chapterNumber}章`,
        sourceChapterId: `chapter-${chapterNumber}`,
        state: {
          location:
            stateUpdates.physicalState?.location ||
            (currentState.location as string | undefined),
          condition:
            this.serializeHealthCondition(stateUpdates.physicalState) ||
            (currentState.condition as string | undefined),
          mood:
            stateUpdates.emotionalState?.mood ||
            (currentState.mood as string | undefined) ||
            "平静",
          relationships:
            stateUpdates.relationships ||
            (currentState.relationships as Record<string, unknown> | undefined),
          secrets:
            stateUpdates.knownSecrets ||
            (currentState.secrets as string[] | undefined),
          goals:
            stateUpdates.goals?.map((g) => g.description) ||
            (currentState.goals as string[] | undefined),
        },
      };

      // 合并新状态到 currentState
      const newCurrentState = {
        ...currentState,
        physicalState: stateUpdates.physicalState || currentState.physicalState,
        emotionalState:
          stateUpdates.emotionalState || currentState.emotionalState,
        relationships: stateUpdates.relationships || currentState.relationships,
        knownSecrets: stateUpdates.knownSecrets || currentState.knownSecrets,
        goals: stateUpdates.goals || currentState.goals,
      };

      // 更新数据库（在事务内执行，确保一致性）
      await tx.writingCharacter.update({
        where: { id: characterId },
        data: {
          currentState: newCurrentState as Prisma.InputJsonValue,
          stateTimeline: [
            ...stateTimeline,
            snapshot,
          ] as unknown as Prisma.InputJsonValue[],
        },
      });

      this.logger.log(
        `[CharacterConsistency] Updated state for ${character.name} at chapter ${chapterNumber}`,
      );
    });
  }

  /**
   * 记录角色状态转变（重大身份/立场变化）
   *
   * ★ 使用事务确保并行场景下的数据一致性
   */
  async recordStateTransition(
    characterId: string,
    transition: Omit<CharacterStateTransition, "chapterId" | "storyTime"> & {
      chapterNumber: number;
    },
  ): Promise<void> {
    // ★ 使用事务确保读取和更新的原子性
    await this.prisma.$transaction(async (tx) => {
      const character = await tx.writingCharacter.findUnique({
        where: { id: characterId },
      });

      if (!character) {
        return;
      }

      const stateTimeline = (character.stateTimeline || []) as unknown[];

      const newTransition: CharacterStateTransition = {
        ...transition,
        chapterId: `chapter-${transition.chapterNumber}`,
        storyTime: `第${transition.chapterNumber}章`,
      };

      // 将转变记录添加到时间线
      const updatedTimeline = [
        ...stateTimeline,
        {
          storyTime: newTransition.storyTime,
          sourceChapterId: newTransition.chapterId,
          state: {
            transition: newTransition,
          },
        },
      ];

      await tx.writingCharacter.update({
        where: { id: characterId },
        data: {
          stateTimeline: updatedTimeline as unknown as Prisma.InputJsonValue[],
        },
      });

      this.logger.log(
        `[CharacterConsistency] Recorded state transition for ${character.name}: ${transition.fromState} → ${transition.toState}`,
      );
    });
  }

  // ==================== OOC 检测 ====================

  /**
   * 检测角色行为是否 OOC
   */
  async detectOOC(
    character: WritingCharacterEntity,
    proposedAction: string,
    context: string,
  ): Promise<OOCDetectionResult> {
    const personality = character.personality;
    if (!personality) {
      return { isOOC: false, severity: "low" };
    }

    const traits = personality.traits || [];
    const strengths = personality.strengths || [];
    const weaknesses = personality.weaknesses || [];

    // 1. 性格冲突检测
    const personalityConflict = this.detectPersonalityConflict(
      proposedAction,
      traits,
      context,
    );
    if (personalityConflict) {
      return {
        isOOC: true,
        severity: "high",
        reason: personalityConflict.reason,
        suggestion: personalityConflict.suggestion,
        violationType: "personality_conflict",
      };
    }

    // 2. 冲动决策检测（谨慎角色突然冲动）
    if (this.isCautiousCharacter(traits)) {
      if (this.isImpulsiveAction(proposedAction)) {
        return {
          isOOC: true,
          severity: "medium",
          reason: `${character.name} 是谨慎型性格，不会做出如此冲动的决定`,
          suggestion: `让 ${character.name} 先观察、思考，再做决定`,
          violationType: "impulsive_decision",
        };
      }
    }

    // 3. 关系违反检测（对敌人太友好）
    if (context.includes("敌人") || context.includes("仇人")) {
      if (this.isFriendlyAction(proposedAction)) {
        return {
          isOOC: true,
          severity: "high",
          reason: `${character.name} 不会对敌人表现出友好`,
          suggestion: `保持警惕或敌意，符合当前关系状态`,
          violationType: "relationship_violation",
        };
      }
    }

    // 4. 优势/弱点检测
    const strengthViolation = this.detectStrengthWeaknessViolation(
      proposedAction,
      strengths,
      weaknesses,
    );
    if (strengthViolation) {
      return {
        isOOC: true,
        severity: "medium",
        reason: strengthViolation,
        suggestion: `行为应该体现角色的优势和弱点`,
        violationType: "personality_conflict",
      };
    }

    return { isOOC: false, severity: "low" };
  }

  /**
   * 检测角色成长/变化是否合理
   */
  async validateCharacterGrowth(
    characterId: string,
    proposedChange: {
      traitChange?: string; // 性格改变
      beliefChange?: string; // 信念改变
      relationshipChange?: {
        targetCharacter: string;
        changeDescription: string;
      };
    },
    triggerEvent?: string, // 触发事件
  ): Promise<CharacterGrowthValidationResult> {
    const issues: CharacterGrowthValidationResult["issues"] = [];

    // 1. 检查是否有触发事件
    if (!triggerEvent) {
      issues.push({
        type: "no_trigger",
        description: "角色性格/信念发生改变，但没有明确的触发事件",
        suggestion: "需要铺垫一个足够震撼的事件来触发改变",
      });
    }

    // 2. 检查是否过于突然（理想情况应该有渐进铺垫）
    const character = await this.prisma.writingCharacter.findUnique({
      where: { id: characterId },
    });

    if (character) {
      const stateTimeline = (character.stateTimeline || []) as unknown[];
      // 如果时间线中没有铺垫，变化可能过于突然
      if (stateTimeline.length < 3 && proposedChange.traitChange) {
        issues.push({
          type: "too_sudden",
          description: "角色性格改变过于突然，缺乏前文铺垫",
          suggestion: "建议在前几章中铺垫角色的内心冲突或疑虑",
        });
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  }

  // ==================== 行为约束生成 ====================

  /**
   * 生成角色行为约束（供 Writer Agent 使用）
   */
  async generateCharacterBehaviorConstraints(
    character: WritingCharacterEntity,
    chapterContext?: {
      chapterNumber: number;
      involvedCharacters: string[];
    },
  ): Promise<CharacterBehaviorConstraints> {
    const personality = character.personality;
    const currentState = character.currentState;

    const constraints: CharacterBehaviorConstraints = {
      characterName: character.name,
      coreTraits: personality?.traits || [],
      behaviorPatterns: [],
      prohibitions: [],
      encouragements: [],
      currentStateConstraints: [],
      relationshipConstraints: [],
    };

    // 1. 根据性格生成行为模式
    if (personality?.traits) {
      constraints.behaviorPatterns = this.deriveehaviorPatterns(
        personality.traits,
      );
    }

    // 2. 根据性格生成禁止项
    if (personality?.traits) {
      constraints.prohibitions = this.deriveProhibitions(personality.traits);
    }

    // 3. 根据性格生成鼓励项
    if (personality?.traits) {
      constraints.encouragements = this.deriveEncouragements(
        personality.traits,
      );
    }

    // 4. 根据当前状态生成约束
    if (currentState) {
      constraints.currentStateConstraints = this.deriveStateConstraints(
        currentState as unknown as Record<string, unknown>,
      );
    }

    // 5. 根据关系生成约束
    if (currentState && chapterContext?.involvedCharacters) {
      constraints.relationshipConstraints = this.deriveRelationshipConstraints(
        currentState as unknown as Record<string, unknown>,
        chapterContext.involvedCharacters,
      );
    }

    return constraints;
  }

  /**
   * 将行为约束转换为提示词
   */
  formatBehaviorConstraintsAsPrompt(
    constraints: CharacterBehaviorConstraints,
  ): string {
    const parts: string[] = [];

    parts.push(`## 角色行为约束：${constraints.characterName}\n`);

    // 性格特征
    if (constraints.coreTraits.length > 0) {
      parts.push(`### 核心性格特征`);
      parts.push(`- ${constraints.coreTraits.join("、")}\n`);
    }

    // 行为模式
    if (constraints.behaviorPatterns.length > 0) {
      parts.push(`### 性格决定的行为模式`);
      constraints.behaviorPatterns.forEach((pattern) => {
        parts.push(`- ${pattern}`);
      });
      parts.push("");
    }

    // 当前状态约束
    if (constraints.currentStateConstraints.length > 0) {
      parts.push(`### 当前状态约束`);
      constraints.currentStateConstraints.forEach((c) => {
        parts.push(`- ${c}`);
      });
      parts.push("");
    }

    // 关系约束
    if (constraints.relationshipConstraints.length > 0) {
      parts.push(`### 人际关系约束`);
      constraints.relationshipConstraints.forEach((c) => {
        parts.push(`- ${c}`);
      });
      parts.push("");
    }

    // 行为禁止
    if (constraints.prohibitions.length > 0) {
      parts.push(`### 行为禁止`);
      constraints.prohibitions.forEach((p) => {
        parts.push(`- ❌ ${p}`);
      });
      parts.push("");
    }

    // 行为鼓励
    if (constraints.encouragements.length > 0) {
      parts.push(`### 行为鼓励`);
      constraints.encouragements.forEach((e) => {
        parts.push(`- ✅ ${e}`);
      });
      parts.push("");
    }

    return parts.join("\n");
  }

  // ==================== 辅助方法 ====================

  /**
   * 从数据库角色构建 CharacterState
   */
  private buildCharacterState(character: WritingCharacter): CharacterState {
    const currentState = (character.currentState || {}) as Record<
      string,
      unknown
    >;
    const personality = (character.personality || {}) as Record<
      string,
      unknown
    >;
    const stateTimeline = (character.stateTimeline || []) as unknown[];

    return {
      characterId: character.id,
      name: character.name,
      physicalState:
        (currentState.physicalState as CharacterState["physicalState"]) || {
          health: "healthy" as const,
          injuries: [],
          location: undefined,
          condition: undefined,
        },
      emotionalState:
        (currentState.emotionalState as CharacterState["emotionalState"]) || {
          mood: "平静",
          moodHistory: [],
        },
      relationships:
        (currentState.relationships as CharacterState["relationships"]) || {},
      knownSecrets: (currentState.knownSecrets as string[]) || [],
      knownEvents: (currentState.knownEvents as string[]) || [],
      beliefs: (currentState.beliefs as string[]) || [],
      hiddenSecrets: (personality.hiddenSecrets as string[]) || [],
      goals: (currentState.goals as CharacterState["goals"]) || [],
      stateTimeline: stateTimeline as CharacterStateSnapshot[],
      stateTransitions: (currentState.stateTransitions ||
        []) as CharacterStateTransition[],
    };
  }

  /**
   * 序列化健康状况
   */
  private serializeHealthCondition(
    physicalState?: CharacterState["physicalState"],
  ): string | undefined {
    if (!physicalState) return undefined;

    const parts: string[] = [];
    parts.push(physicalState.health);

    if (physicalState.injuries && physicalState.injuries.length > 0) {
      parts.push(`伤势：${physicalState.injuries.join("、")}`);
    }

    if (physicalState.condition) {
      parts.push(physicalState.condition);
    }

    return parts.join("，");
  }

  /**
   * 检测性格冲突
   */
  private detectPersonalityConflict(
    action: string,
    traits: string[],
    _context: string,
  ): { reason: string; suggestion: string } | null {
    // 善良角色做残忍行为
    if (
      traits.some((t) =>
        ["善良", "仁慈", "温柔", "慈悲"].some((keyword) => t.includes(keyword)),
      )
    ) {
      if (
        action.includes("杀害") ||
        action.includes("折磨") ||
        action.includes("残忍")
      ) {
        return {
          reason: "善良角色不会做出残忍行为",
          suggestion: "改为犹豫、不忍、寻找其他解决方式",
        };
      }
    }

    // 骄傲角色突然卑微
    if (
      traits.some((t) =>
        ["骄傲", "高傲", "自尊心强"].some((keyword) => t.includes(keyword)),
      )
    ) {
      if (action.includes("卑躬屈膝") || action.includes("乞求")) {
        return {
          reason: "骄傲角色不会轻易卑微",
          suggestion: "即使妥协也要保持尊严，或者需要极端情况才会打破骄傲",
        };
      }
    }

    // 冷静角色突然情绪失控
    if (
      traits.some((t) =>
        ["冷静", "理智", "沉稳"].some((keyword) => t.includes(keyword)),
      )
    ) {
      if (action.includes("失控") || action.includes("暴怒")) {
        return {
          reason: "冷静角色不会轻易情绪失控",
          suggestion: "需要极强的触发事件（如亲人受伤）才会失控",
        };
      }
    }

    return null;
  }

  /**
   * 判断是否为谨慎角色
   */
  private isCautiousCharacter(traits: string[]): boolean {
    return traits.some((t) =>
      ["谨慎", "小心", "细心", "深思熟虑"].some((keyword) =>
        t.includes(keyword),
      ),
    );
  }

  /**
   * 判断是否为冲动行为
   */
  private isImpulsiveAction(action: string): boolean {
    const impulsiveKeywords = [
      "立即",
      "马上",
      "冲上去",
      "毫不犹豫",
      "不假思索",
      "脱口而出",
    ];
    return impulsiveKeywords.some((keyword) => action.includes(keyword));
  }

  /**
   * 判断是否为友好行为
   */
  private isFriendlyAction(action: string): boolean {
    const friendlyKeywords = ["微笑", "友好", "帮助", "关心", "温柔"];
    return friendlyKeywords.some((keyword) => action.includes(keyword));
  }

  /**
   * 检测优势/弱点违反
   */
  private detectStrengthWeaknessViolation(
    action: string,
    strengths: string[],
    weaknesses: string[],
  ): string | null {
    // 如果角色弱点是"胆小"，但行为是"勇敢冲锋"
    if (weaknesses.some((w) => w.includes("胆小") || w.includes("怯懦"))) {
      if (action.includes("勇敢") || action.includes("冲锋")) {
        return "角色弱点是胆小，不应表现出勇敢行为（除非有极强动机）";
      }
    }

    // 如果角色优势是"智慧"，但行为是"愚蠢决定"
    if (strengths.some((s) => s.includes("智慧") || s.includes("聪明"))) {
      if (action.includes("愚蠢") || action.includes("盲目")) {
        return "角色优势是智慧，不应做出明显愚蠢的决定";
      }
    }

    return null;
  }

  /**
   * 从性格特征推导行为模式
   */
  private deriveehaviorPatterns(traits: string[]): string[] {
    const patterns: string[] = [];

    if (traits.some((t) => t.includes("谨慎"))) {
      patterns.push("危险面前会先评估再行动");
      patterns.push("不会轻易信任他人");
    }

    if (traits.some((t) => t.includes("善良"))) {
      patterns.push("不会主动伤害无辜");
      patterns.push("倾向于帮助弱者");
    }

    if (traits.some((t) => t.includes("骄傲"))) {
      patterns.push("不会轻易低头认错");
      patterns.push("重视个人尊严和荣誉");
    }

    if (traits.some((t) => t.includes("聪明") || t.includes("智慧"))) {
      patterns.push("会通过观察和推理获取信息");
      patterns.push("决策前会权衡利弊");
    }

    return patterns;
  }

  /**
   * 从性格特征推导禁止项
   */
  private deriveProhibitions(traits: string[]): string[] {
    const prohibitions: string[] = [];

    if (traits.some((t) => t.includes("善良"))) {
      prohibitions.push("不会主动攻击无辜者");
      prohibitions.push("不会使用残忍手段");
    }

    if (traits.some((t) => t.includes("骄傲"))) {
      prohibitions.push("不会卑躬屈膝");
      prohibitions.push("不会向仇人求饶（除非极端情况）");
    }

    if (traits.some((t) => t.includes("谨慎"))) {
      prohibitions.push("不会做出冲动决定");
      prohibitions.push("不会在不了解情况时贸然行动");
    }

    if (traits.some((t) => t.includes("内向") || t.includes("隐忍"))) {
      prohibitions.push("不会向不信任的人吐露心声");
      prohibitions.push("不会在公开场合表达强烈情绪");
    }

    return prohibitions;
  }

  /**
   * 从性格特征推导鼓励项
   */
  private deriveEncouragements(traits: string[]): string[] {
    const encouragements: string[] = [];

    if (traits.some((t) => t.includes("谨慎") || t.includes("聪明"))) {
      encouragements.push("通过观察收集信息");
      encouragements.push("用策略达成目的");
    }

    if (traits.some((t) => t.includes("善良"))) {
      encouragements.push("展现同情心");
      encouragements.push("在力所能及时帮助他人");
    }

    if (traits.some((t) => t.includes("勇敢"))) {
      encouragements.push("在关键时刻挺身而出");
      encouragements.push("不畏强权");
    }

    if (traits.some((t) => t.includes("隐忍"))) {
      encouragements.push("保持表面的温顺恭敬");
      encouragements.push("用委婉方式表达意见");
    }

    return encouragements;
  }

  /**
   * 从当前状态推导约束
   */
  private deriveStateConstraints(
    currentState: Record<string, unknown>,
  ): string[] {
    const constraints: string[] = [];

    const physicalState = currentState.physicalState as
      | CharacterState["physicalState"]
      | undefined;
    if (physicalState) {
      const health = physicalState.health;
      const location = physicalState.location;

      if (health === "injured") {
        constraints.push("受伤状态，行动受限");
        constraints.push("不应表现出过于活跃的行为");
      }

      if (health === "critical") {
        constraints.push("重伤状态，几乎无法行动");
      }

      if (location) {
        constraints.push(`当前位置：${location}`);
      }
    }

    const emotionalState = currentState.emotionalState as
      | CharacterState["emotionalState"]
      | undefined;
    if (emotionalState) {
      const mood = emotionalState.mood;
      if (mood) {
        constraints.push(`当前情绪：${mood}`);
      }
    }

    return constraints;
  }

  /**
   * 从关系推导约束
   */
  private deriveRelationshipConstraints(
    currentState: Record<string, unknown>,
    involvedCharacters: string[],
  ): string[] {
    const constraints: string[] = [];
    const relationships = (currentState.relationships ||
      {}) as CharacterState["relationships"];

    for (const charName of involvedCharacters) {
      const rel = relationships[charName];
      if (rel) {
        if (rel.relationType === "enemy") {
          constraints.push(`对 ${charName} 保持警惕和敌意`);
        } else if (rel.relationType === "ally") {
          constraints.push(`对 ${charName} 保持信任和合作`);
        } else if (rel.relationType === "romantic") {
          constraints.push(`对 ${charName} 表现出特殊关注`);
        }

        if (rel.trustLevel !== undefined) {
          if (rel.trustLevel < 30) {
            constraints.push(`对 ${charName} 信任度很低，保持防备`);
          } else if (rel.trustLevel > 70) {
            constraints.push(`对 ${charName} 高度信任`);
          }
        }
      }
    }

    return constraints;
  }

  // ==================== ★★★ 角色名称验证（新增） ★★★ ====================

  /**
   * 验证内容中的角色名称是否与 Story Bible 一致
   *
   * 核心功能：
   * 1. 从内容中提取所有可能的角色名（2-4字中文名）
   * 2. 与 Story Bible 中定义的角色名和别名对比
   * 3. 报告未知名字、可能的笔误、不一致的称谓
   *
   * @param projectId 项目ID
   * @param content 待验证的章节内容
   * @returns 验证结果，包含发现的问题
   */
  async validateCharacterNames(
    projectId: string,
    content: string,
  ): Promise<CharacterNameValidationResult> {
    const issues: CharacterNameIssue[] = [];

    // 1. 获取项目中所有角色（包括别名）
    const characters = await this.getProjectCharacters(projectId);
    if (characters.length === 0) {
      return {
        isValid: true,
        issues: [],
        mentionedCharacters: [],
        unmatchedNames: [],
      };
    }

    // 2. 构建名字查找表
    const nameMap = this.buildCharacterNameMap(characters);

    // 3. 从内容中提取所有可能的角色名
    const extractedNames = this.extractPotentialCharacterNames(content);

    // 4. 验证每个提取的名字
    const mentionedCharacters: string[] = [];
    const unmatchedNames: string[] = [];

    for (const { name, context } of extractedNames) {
      const lookupResult = nameMap.get(name);

      if (lookupResult) {
        // 找到匹配
        mentionedCharacters.push(lookupResult.canonicalName);

        // 检查是否使用了非规范名（别名而非正名）
        if (
          lookupResult.type === "alias" &&
          lookupResult.canonicalName !== name
        ) {
          // 别名使用是警告级别，因为有时故意使用别名
          issues.push({
            type: "inconsistent_name",
            foundName: name,
            suggestedName: lookupResult.canonicalName,
            context: context,
            severity: "warning",
          });
        }
      } else {
        // 未找到匹配，检查是否可能是笔误
        const similarName = this.findSimilarCharacterName(name, nameMap);
        if (similarName) {
          issues.push({
            type: "possible_typo",
            foundName: name,
            suggestedName: similarName,
            context: context,
            severity: "error",
          });
        } else {
          // 完全未知的名字
          unmatchedNames.push(name);
          // 只有当这个名字看起来像角色名时才报告（排除地名等）
          if (this.looksLikeCharacterName(name)) {
            issues.push({
              type: "unknown_character",
              foundName: name,
              context: context,
              severity: "warning",
            });
          }
        }
      }
    }

    // 5. 检查称谓一致性（如"娘娘"/"王妃"等）
    const titleIssues = this.checkTitleConsistency(content, characters);
    issues.push(...titleIssues);

    return {
      isValid: issues.filter((i) => i.severity === "error").length === 0,
      issues,
      mentionedCharacters: [...new Set(mentionedCharacters)],
      unmatchedNames: [...new Set(unmatchedNames)],
    };
  }

  /**
   * 获取项目中所有角色
   */
  private async getProjectCharacters(projectId: string): Promise<
    Array<{
      id: string;
      name: string;
      aliases: string[];
      role: string | null;
      title?: string;
    }>
  > {
    const project = await this.prisma.writingProject.findUnique({
      where: { id: projectId },
      include: {
        storyBible: {
          include: {
            characters: {
              select: {
                id: true,
                name: true,
                aliases: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!project?.storyBible) {
      return [];
    }

    return project.storyBible.characters;
  }

  /**
   * 构建角色名称查找表
   * 包含正名和所有别名
   */
  private buildCharacterNameMap(
    characters: Array<{
      id: string;
      name: string;
      aliases: string[];
      role: string | null;
    }>,
  ): Map<
    string,
    { canonicalName: string; type: "canonical" | "alias"; characterId: string }
  > {
    const nameMap = new Map<
      string,
      {
        canonicalName: string;
        type: "canonical" | "alias";
        characterId: string;
      }
    >();

    for (const char of characters) {
      // 正名
      nameMap.set(char.name, {
        canonicalName: char.name,
        type: "canonical",
        characterId: char.id,
      });

      // 别名
      for (const alias of char.aliases || []) {
        nameMap.set(alias, {
          canonicalName: char.name,
          type: "alias",
          characterId: char.id,
        });
      }

      // 常见变体：只取姓或只取名
      if (char.name.length >= 2) {
        // 姓氏（第一个字）+ 角色 -> 如"苏姑娘"
        const surname = char.name.charAt(0);
        const commonTitles = [
          "姑娘",
          "公子",
          "小姐",
          "夫人",
          "大人",
          "娘子",
          "郎君",
        ];
        for (const title of commonTitles) {
          nameMap.set(`${surname}${title}`, {
            canonicalName: char.name,
            type: "alias",
            characterId: char.id,
          });
        }
      }
    }

    return nameMap;
  }

  /**
   * 从内容中提取潜在的角色名
   * 返回名字和上下文
   */
  private extractPotentialCharacterNames(
    content: string,
  ): Array<{ name: string; context: string }> {
    const results: Array<{ name: string; context: string }> = [];
    const seen = new Set<string>();

    // 模式1：引号内说话的人 - "XXX道"、"XXX说"
    const dialoguePattern =
      /[「""]([^「」""]+)[」""]，?([^，。]{1,4})(道|说|问|答|喊|叫|笑道|冷笑|叹息)/g;
    let match;
    while ((match = dialoguePattern.exec(content)) !== null) {
      const speaker = match[2];
      if (this.isValidCharacterName(speaker) && !seen.has(speaker)) {
        seen.add(speaker);
        results.push({
          name: speaker,
          context: match[0].substring(0, 50),
        });
      }
    }

    // 模式2：直接的角色名（2-4字中文名）
    // 常见模式："XXX心中"、"XXX看着"、"XXX走了"等
    const namePattern =
      /([\u4e00-\u9fa5]{2,4})(?:心中|心想|看着|望着|走|说|道|笑|问|答|想|觉得|以为|知道|明白|发现|注意到)/g;
    while ((match = namePattern.exec(content)) !== null) {
      const name = match[1];
      if (this.isValidCharacterName(name) && !seen.has(name)) {
        seen.add(name);
        results.push({
          name: name,
          context: match[0],
        });
      }
    }

    // 模式3：对话前的称呼 "XXX，你..."
    const addressPattern = /([\u4e00-\u9fa5]{2,4})，[你我他她]/g;
    while ((match = addressPattern.exec(content)) !== null) {
      const name = match[1];
      if (this.isValidCharacterName(name) && !seen.has(name)) {
        seen.add(name);
        results.push({
          name: name,
          context: match[0],
        });
      }
    }

    return results;
  }

  /**
   * 判断是否为有效的角色名
   */
  private isValidCharacterName(name: string): boolean {
    if (!name || name.length < 2 || name.length > 4) {
      return false;
    }

    // 排除常见非名字词汇
    const excludeWords = [
      "这里",
      "那里",
      "什么",
      "为什么",
      "怎么",
      "如何",
      "这样",
      "那样",
      "这个",
      "那个",
      "一个",
      "两个",
      "三个",
      "自己",
      "别人",
      "大家",
      "众人",
      "所有",
      "没有",
      "可以",
      "不能",
      "应该",
      "或许",
      "也许",
      "当然",
      "只是",
      "不过",
      "然而",
      "虽然",
      "因为",
      "所以",
      "如果",
      "就是",
      "那时",
      "此刻",
      "之后",
      "之前",
      "左右",
      "上下",
      "里面",
      "外面",
      "今天",
      "明天",
      "昨天",
      "时候",
      "地方",
      "事情",
      "东西",
      "意思",
      "样子",
      "声音",
      "眼睛",
      "心里",
    ];

    if (excludeWords.includes(name)) {
      return false;
    }

    return true;
  }

  /**
   * 判断名字是否看起来像角色名
   */
  private looksLikeCharacterName(name: string): boolean {
    // 常见姓氏
    const commonSurnames = [
      "王",
      "李",
      "张",
      "刘",
      "陈",
      "杨",
      "黄",
      "赵",
      "周",
      "吴",
      "徐",
      "孙",
      "马",
      "朱",
      "胡",
      "郭",
      "何",
      "高",
      "林",
      "罗",
      "郑",
      "梁",
      "谢",
      "宋",
      "唐",
      "许",
      "韩",
      "冯",
      "邓",
      "曹",
      "彭",
      "曾",
      "萧",
      "田",
      "董",
      "袁",
      "潘",
      "于",
      "蒋",
      "蔡",
      "余",
      "杜",
      "叶",
      "程",
      "苏",
      "魏",
      "吕",
      "丁",
      "任",
      "沈",
      "姚",
      "卢",
      "姜",
      "崔",
      "钟",
      "谭",
      "陆",
      "汪",
      "范",
      "金",
      "石",
      "廖",
      "贾",
      "夏",
      "韦",
      "付",
      "方",
      "白",
      "邹",
      "孟",
      "熊",
      "秦",
      "邱",
      "江",
      "尹",
      "薛",
      "闫",
      "段",
      "雷",
      "侯",
      "龙",
      "史",
      "陶",
      "黎",
      "贺",
      "顾",
      "毛",
      "郝",
      "龚",
      "邵",
      "万",
      "钱",
      "严",
      "覃",
      "武",
      "戴",
      "莫",
      "孔",
      "向",
      "汤",
    ];

    // 以常见姓氏开头
    if (commonSurnames.includes(name.charAt(0))) {
      return true;
    }

    // 包含常见称谓结尾
    const titleSuffixes = [
      "公",
      "妃",
      "嫔",
      "妃",
      "后",
      "帝",
      "王",
      "侯",
      "伯",
      "子",
      "爷",
      "姑",
      "嬷",
      "娘",
    ];
    if (titleSuffixes.some((s) => name.endsWith(s))) {
      return true;
    }

    return false;
  }

  /**
   * 查找相似的角色名（用于检测笔误）
   */
  private findSimilarCharacterName(
    name: string,
    nameMap: Map<
      string,
      {
        canonicalName: string;
        type: "canonical" | "alias";
        characterId: string;
      }
    >,
  ): string | null {
    // 计算编辑距离，找最接近的名字
    let minDistance = Infinity;
    let closestName: string | null = null;

    for (const [registeredName] of nameMap) {
      const distance = this.levenshteinDistance(name, registeredName);
      // 只考虑编辑距离为1的情况（一个字的差异）
      if (distance === 1 && distance < minDistance) {
        minDistance = distance;
        closestName = registeredName;
      }
    }

    return closestName;
  }

  /**
   * 计算 Levenshtein 编辑距离
   */
  private levenshteinDistance(s1: string, s2: string): number {
    const len1 = s1.length;
    const len2 = s2.length;

    const dp: number[][] = Array(len1 + 1)
      .fill(null)
      .map(() => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) dp[i][0] = i;
    for (let j = 0; j <= len2; j++) dp[0][j] = j;

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost,
        );
      }
    }

    return dp[len1][len2];
  }

  /**
   * 检查称谓一致性
   * 例如：同一角色不应在同一章节中既被称为"王妃"又被称为"娘娘"
   */
  private checkTitleConsistency(
    content: string,
    _characters: Array<{
      id: string;
      name: string;
      aliases: string[];
      role: string | null;
    }>,
  ): CharacterNameIssue[] {
    const issues: CharacterNameIssue[] = [];

    // 定义互斥的称谓组
    const exclusiveGroups = [
      ["王妃", "娘娘", "夫人"], // 宫廷女性称谓
      ["太子", "殿下", "王爷"], // 皇室男性称谓
      ["皇上", "陛下", "圣上"], // 皇帝称谓
      ["小姐", "姑娘", "千金"], // 未婚女子称谓
    ];

    for (const group of exclusiveGroups) {
      const foundTitles = group.filter((title) => content.includes(title));
      if (foundTitles.length > 1) {
        // 同一组内出现多个称谓，可能是问题
        // 但需要排除确实有多个角色使用不同称谓的情况
        // 这里只做警告
        issues.push({
          type: "wrong_title",
          foundName: foundTitles.join("/"),
          context: `同一章节中出现了多个相似称谓：${foundTitles.join("、")}`,
          severity: "warning",
        });
      }
    }

    return issues;
  }
}
