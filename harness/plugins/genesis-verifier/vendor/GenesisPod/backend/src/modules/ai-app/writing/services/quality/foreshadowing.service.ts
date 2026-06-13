/**
 * ForeshadowingService - 伏笔追踪服务
 *
 * 核心职责：
 * - 追踪已埋设的伏笔和悬念
 * - 提醒写手何时回收伏笔
 * - 生成伏笔相关的写作约束
 *
 * 设计理念（学习自《诡秘之主》）：
 * - 长线伏笔：10+ 章后回收，重大剧情转折
 * - 中线伏笔：3-5 章回收，情节推进
 * - 短线悬念：本章末尾抛出，下章开头解决
 *
 * 伏笔类型：
 * - mystery: 悬念型（谁是凶手、秘密身份）
 * - chekhov: 契诃夫之枪（出现的道具必须使用）
 * - prophecy: 预言型（预言/诅咒的应验）
 * - character: 角色伏笔（角色背景、动机暗示）
 * - worldbuilding: 世界观伏笔（规则、历史暗示）
 */

import { Injectable, Logger } from "@nestjs/common";

// ==================== 类型定义 ====================

export interface Foreshadow {
  /** 伏笔唯一ID */
  id: string;
  /** 伏笔类型 */
  type: "mystery" | "chekhov" | "prophecy" | "character" | "worldbuilding";
  /** 伏笔描述 */
  hint: string;
  /** 埋设章节 */
  chapterPlanted: number;
  /** 计划回收章节（可选） */
  chapterToReveal?: number;
  /** 实际回收章节（已回收时填写） */
  chapterRevealed?: number;
  /** 重要程度 */
  importance: "major" | "minor";
  /** 相关角色 */
  relatedCharacters?: string[];
  /** 相关物品/地点 */
  relatedElements?: string[];
  /** 状态 */
  status: "planted" | "hinted" | "revealed" | "abandoned";
  /** 回收方式描述 */
  revealDescription?: string;
}

export interface ForeshadowingGuidance {
  /** 待回收的伏笔列表 */
  pendingForeshadows: Foreshadow[];
  /** 本章应该回收的伏笔 */
  shouldRevealThisChapter: Foreshadow[];
  /** 本章可以埋设的伏笔类型建议 */
  suggestedNewForeshadows: string[];
  /** 生成的约束提示词 */
  constraintPrompt: string;
}

// ==================== 伏笔模板库 ====================

const FORESHADOW_TEMPLATES = {
  // 悬念型伏笔
  mystery: {
    name: "悬念型",
    description: "引发读者好奇心的未解之谜",
    examples: [
      "某角色说了一句意味深长的话，暗示他知道什么秘密",
      "发现一封没有署名的信，内容暗示阴谋",
      "角色做出不寻常的举动，动机不明",
    ],
    revealTiming: "根据重要程度，3-20章后回收",
    plantTechnique: "通过角色反常行为、神秘物品、未解释的现象埋设",
  },

  // 契诃夫之枪
  chekhov: {
    name: "契诃夫之枪",
    description: "出场的重要道具/技能必须在后文发挥作用",
    examples: [
      "角色随手捡起的一枚铜钱，后来成为关键证物",
      "提到角色会某种技能，后来在危机时刻派上用场",
      "描写房间里的某个物件，后来成为逃生工具",
    ],
    revealTiming: "1-10章内必须使用",
    plantTechnique: "自然地在场景描写或角色动作中引入",
  },

  // 预言型
  prophecy: {
    name: "预言型",
    description: "预言、诅咒、梦境的应验",
    examples: [
      "占卜师的模糊预言，逐步应验",
      "角色做的噩梦，暗示未来危险",
      "古老诅咒的条件，一步步被触发",
    ],
    revealTiming: "分阶段应验，完全应验可能需要很长",
    plantTechnique: "通过梦境、预言、诅咒、民间传说等形式",
  },

  // 角色伏笔
  character: {
    name: "角色伏笔",
    description: "暗示角色的真实身份、过去、动机",
    examples: [
      "角色对某个话题反应过度，暗示有相关过去",
      "角色身上的伤疤/标记，暗示身份",
      "角色的某个习惯，暗示其出身",
    ],
    revealTiming: "根据角色重要程度，5-30章后揭示",
    plantTechnique: "通过角色的微表情、习惯、回避话题等细节",
  },

  // 世界观伏笔
  worldbuilding: {
    name: "世界观伏笔",
    description: "暗示世界观的深层规则或历史",
    examples: [
      "提到某个被遗忘的古老势力",
      "某个看似普通的地名，其实有重大历史",
      "世界观规则的例外情况，暗示更深层的规则",
    ],
    revealTiming: "可以是非常长线的伏笔，甚至跨卷",
    plantTechnique: "通过历史文献、老人回忆、地名典故等",
  },
};

// ==================== 服务实现 ====================

@Injectable()
export class ForeshadowingService {
  private readonly logger = new Logger(ForeshadowingService.name);

  // 内存存储（实际项目应该用数据库）
  private foreshadowStore: Map<string, Foreshadow[]> = new Map();

  /**
   * 记录新埋设的伏笔
   */
  plantForeshadow(
    projectId: string,
    foreshadow: Omit<Foreshadow, "id" | "status">,
  ): Foreshadow {
    const id = `fs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newForeshadow: Foreshadow = {
      ...foreshadow,
      id,
      status: "planted",
    };

    const existing = this.foreshadowStore.get(projectId) || [];
    existing.push(newForeshadow);
    this.foreshadowStore.set(projectId, existing);

    this.logger.log(
      `[Foreshadowing] Planted ${foreshadow.type} foreshadow in chapter ${foreshadow.chapterPlanted}: ${foreshadow.hint.slice(0, 50)}...`,
    );

    return newForeshadow;
  }

  /**
   * 标记伏笔已回收
   */
  revealForeshadow(
    projectId: string,
    foreshadowId: string,
    chapterRevealed: number,
    revealDescription?: string,
  ): boolean {
    const foreshadows = this.foreshadowStore.get(projectId);
    if (!foreshadows) return false;

    const foreshadow = foreshadows.find((f) => f.id === foreshadowId);
    if (!foreshadow) return false;

    foreshadow.status = "revealed";
    foreshadow.chapterRevealed = chapterRevealed;
    foreshadow.revealDescription = revealDescription;

    this.logger.log(
      `[Foreshadowing] Revealed foreshadow ${foreshadowId} in chapter ${chapterRevealed}`,
    );

    return true;
  }

  /**
   * 获取待回收的伏笔列表
   */
  getPendingForeshadows(projectId: string): Foreshadow[] {
    const foreshadows = this.foreshadowStore.get(projectId) || [];
    return foreshadows.filter(
      (f) => f.status === "planted" || f.status === "hinted",
    );
  }

  /**
   * 获取本章应该回收的伏笔
   */
  getShouldRevealThisChapter(
    projectId: string,
    currentChapter: number,
  ): Foreshadow[] {
    const pending = this.getPendingForeshadows(projectId);

    return pending.filter((f) => {
      // 如果指定了回收章节
      if (f.chapterToReveal && f.chapterToReveal <= currentChapter) {
        return true;
      }

      // 根据类型和重要程度判断是否应该回收
      const chaptersSincePlanted = currentChapter - f.chapterPlanted;

      // 契诃夫之枪：10章内必须回收
      if (f.type === "chekhov" && chaptersSincePlanted >= 10) {
        return true;
      }

      // 短线伏笔（minor）：5章内应该回收
      if (f.importance === "minor" && chaptersSincePlanted >= 5) {
        return true;
      }

      // 中线伏笔：3-5章后提醒
      if (f.importance === "major" && chaptersSincePlanted >= 5) {
        // 只是提醒，不强制
        return false;
      }

      return false;
    });
  }

  /**
   * 生成伏笔相关的写作约束
   */
  generateForeshadowingGuidance(
    projectId: string,
    currentChapter: number,
    chapterType?: string,
  ): ForeshadowingGuidance {
    const pending = this.getPendingForeshadows(projectId);
    const shouldReveal = this.getShouldRevealThisChapter(
      projectId,
      currentChapter,
    );

    // 生成本章建议埋设的伏笔类型
    const suggestedNewForeshadows: string[] = [];

    if (currentChapter === 1) {
      suggestedNewForeshadows.push(
        "建议在第一章埋设1-2个长线伏笔（角色身份、世界观秘密）",
        "建议埋设1个短线悬念，在第2章回收，保持读者兴趣",
      );
    } else if (chapterType?.includes("高潮") || chapterType?.includes("决战")) {
      suggestedNewForeshadows.push(
        "高潮章节适合回收多个伏笔，形成信息爆炸",
        "可以埋设新的长线伏笔，为下一阶段铺垫",
      );
    } else {
      suggestedNewForeshadows.push(
        "普通章节建议埋设1个中线伏笔（3-5章后回收）",
        "每章结尾留一个小悬念，下章开头解决",
      );
    }

    // 生成约束提示词
    const constraintPrompt = this.buildConstraintPrompt(
      pending,
      shouldReveal,
      currentChapter,
    );

    return {
      pendingForeshadows: pending,
      shouldRevealThisChapter: shouldReveal,
      suggestedNewForeshadows,
      constraintPrompt,
    };
  }

  /**
   * 构建伏笔约束提示词
   */
  private buildConstraintPrompt(
    pending: Foreshadow[],
    shouldReveal: Foreshadow[],
    currentChapter: number,
  ): string {
    const parts: string[] = [];

    parts.push(`## 伏笔管理（第${currentChapter}章）\n`);

    // 必须回收的伏笔
    if (shouldReveal.length > 0) {
      parts.push(`### ⚠️ 本章应回收的伏笔（重要）\n`);
      for (const f of shouldReveal) {
        parts.push(`- **[${FORESHADOW_TEMPLATES[f.type].name}]** ${f.hint}`);
        parts.push(
          `  - 埋设于第${f.chapterPlanted}章，已等待${currentChapter - f.chapterPlanted}章`,
        );
        if (f.relatedCharacters?.length) {
          parts.push(`  - 相关角色：${f.relatedCharacters.join("、")}`);
        }
      }
      parts.push(``);
    }

    // 待回收的伏笔（提醒）
    const otherPending = pending.filter(
      (p) => !shouldReveal.find((s) => s.id === p.id),
    );
    if (otherPending.length > 0) {
      parts.push(`### 待回收伏笔（可在本章或后续章节回收）\n`);
      for (const f of otherPending.slice(0, 5)) {
        const waitingChapters = currentChapter - f.chapterPlanted;
        parts.push(
          `- [${f.importance === "major" ? "主线" : "支线"}] ${f.hint.slice(0, 40)}... (等待${waitingChapters}章)`,
        );
      }
      if (otherPending.length > 5) {
        parts.push(`- ...还有${otherPending.length - 5}个伏笔待回收`);
      }
      parts.push(``);
    }

    // 伏笔技巧提醒
    parts.push(`### 伏笔技巧\n`);
    parts.push(`1. **章节结尾留悬念**：本章结尾抛出一个小问题，下章开头解答`);
    parts.push(`2. **伏笔要自然**：伏笔应融入场景和对话，不要刻意强调`);
    parts.push(
      `3. **回收要有仪式感**：重要伏笔回收时要让读者有"原来如此"的感觉`,
    );
    parts.push(
      `4. **避免遗忘**：每个埋下的伏笔都要有回收计划，契诃夫之枪10章内必须使用`,
    );

    return parts.join("\n");
  }

  /**
   * 从章节内容中自动提取可能的伏笔
   * （供一致性检查服务调用）
   */
  async extractPotentialForeshadows(
    content: string,
    chapterNumber: number,
  ): Promise<Array<Omit<Foreshadow, "id" | "status">>> {
    // 简单的关键词匹配（实际项目可以用 LLM 分析）
    const potentialForeshadows: Array<Omit<Foreshadow, "id" | "status">> = [];

    // 检测悬念型伏笔
    const mysteryPatterns = [
      /他.*意味深长地.*笑了/,
      /她.*欲言又止/,
      /这件事.*以后再说/,
      /你.*还不到知道的时候/,
      /总有一天.*会明白/,
    ];

    for (const pattern of mysteryPatterns) {
      const match = content.match(pattern);
      if (match) {
        potentialForeshadows.push({
          type: "mystery",
          hint: match[0],
          chapterPlanted: chapterNumber,
          importance: "minor",
        });
      }
    }

    // 检测契诃夫之枪（物品描写）
    const chekhovPatterns = [
      /(?:随手|顺手)(?:捡起|拿起|收好).*?(?:放入|揣进|收进)/,
      /(?:注意到|看到).*?(?:匕首|短刀|钥匙|信件|令牌)/,
    ];

    for (const pattern of chekhovPatterns) {
      const match = content.match(pattern);
      if (match) {
        potentialForeshadows.push({
          type: "chekhov",
          hint: match[0],
          chapterPlanted: chapterNumber,
          importance: "minor",
        });
      }
    }

    return potentialForeshadows;
  }

  /**
   * 获取伏笔统计
   */
  getForeshadowStats(projectId: string): {
    total: number;
    planted: number;
    revealed: number;
    overdue: number;
  } {
    const foreshadows = this.foreshadowStore.get(projectId) || [];

    return {
      total: foreshadows.length,
      planted: foreshadows.filter((f) => f.status === "planted").length,
      revealed: foreshadows.filter((f) => f.status === "revealed").length,
      overdue: foreshadows.filter(
        (f) =>
          f.status === "planted" &&
          f.chapterToReveal &&
          f.chapterToReveal < (f.chapterRevealed || Infinity),
      ).length,
    };
  }
}
