/**
 * OpeningHookService - 开篇钩子服务
 *
 * 核心职责：
 * - 提供高效开篇技巧指导
 * - 基于网文经典作品的开篇分析
 * - 生成章节开篇约束和示例
 *
 * 设计理念（源自《斗破苍穹》《寒霜千年》等经典作品）：
 * 1. 不要从感受开始，要从事件/冲突开始
 * 2. 用外部反应（对话、他人态度）展示主角处境
 * 3. 第一段必须有"钩子"——悬念或冲突
 * 4. 让读者先关心角色，再关心世界观
 *
 * 经典开篇案例：
 * - 《斗破苍穹》："斗之力，三段！" —— 开门见冲突
 * - 《寒霜千年》：穿越即面临被打死 —— 极端困境
 * - 《汉宫妆影》：被冷醒，感受湿冷 —— 具象感受引入
 */

import { Injectable, Logger } from "@nestjs/common";

// ==================== 类型定义 ====================

export interface OpeningHookTemplate {
  /** 钩子类型 */
  type:
    | "conflict_dialogue"
    | "crisis_situation"
    | "mystery_question"
    | "sensory_immersion"
    | "contrast_reveal";
  /** 类型名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 核心技巧 */
  techniques: string[];
  /** 经典案例 */
  examples: Array<{
    source: string;
    opening: string;
    analysis: string;
  }>;
  /** 模板公式 */
  formula: string;
  /** 禁忌 */
  forbidden: string[];
}

export interface ChapterOpeningGuidance {
  /** 章节类型 */
  chapterType: "first" | "climax" | "transition" | "revelation" | "normal";
  /** 推荐钩子类型 */
  recommendedHookTypes: string[];
  /** 具体指导 */
  guidance: string;
  /** 开篇禁忌 */
  forbidden: string[];
  /** 参考示例 */
  examples: string[];
}

// ==================== 开篇钩子模板库 ====================

const OPENING_HOOK_TEMPLATES: Record<string, OpeningHookTemplate> = {
  // 冲突对话式开篇
  conflict_dialogue: {
    type: "conflict_dialogue",
    name: "冲突对话式",
    description: "以包含冲突的对话或宣告开始，直接把读者拉入紧张氛围",
    techniques: [
      "第一句就是对话或宣告",
      "对话内容暗示冲突或危机",
      "通过围观者反应强化氛围",
      "对话后立即展示后果",
    ],
    examples: [
      {
        source: "《斗破苍穹》",
        opening: '"斗之力，三段！"',
        analysis:
          "一句简短的宣告，直接揭示主角的'废物'身份，后续通过围观者的嘲笑强化落差感",
      },
      {
        source: "《暴室场景》",
        opening: '"喂，那个穿麻衣的，愣着干什么！暴室的活儿干完了吗？"',
        analysis: "用他人对主角的呵斥开场，直接展示主角的卑微处境和紧迫压力",
      },
    ],
    formula:
      "[对白/宣告] → [主角身份/处境揭示] → [外部反应(嘲讽/威胁)] → [主角内心反应]",
    forbidden: [
      "不要用旁白解释对话背景",
      "不要用'突然有人说道'",
      "对话不能是普通寒暄",
    ],
  },

  // 极端困境式开篇
  crisis_situation: {
    type: "crisis_situation",
    name: "极端困境式",
    description: "开篇即把主角置于生死或重大危机中，制造即时紧张感",
    techniques: [
      "开篇前三句必须揭示危机",
      "危机必须是即时的、紧迫的",
      "用具体细节（而非抽象描述）展示危机",
      "留下一线生机暗示",
    ],
    examples: [
      {
        source: "《寒霜千年》",
        opening:
          "宋时安穿越到了一个架空的朝代，大虞。好消息是，他成了世家长子；坏消息是，他是个不成器的庶子，而且刚穿越过去他爹就要把他打死。",
        analysis:
          "好消息/坏消息的对比结构，最后一句直接抛出生死危机，制造即刻紧张",
      },
    ],
    formula: "[背景一句话] → [看似好消息] → [但实际是坏消息] → [极端危机揭示]",
    forbidden: [
      "不要用大段背景介绍开头",
      "不要让危机是模糊的或将来的",
      "不要让主角毫无反应",
    ],
  },

  // 悬念问题式开篇
  mystery_question: {
    type: "mystery_question",
    name: "悬念问题式",
    description: "以一个令人困惑的场景或问题开始，激发读者好奇心",
    techniques: [
      "开篇展示异常/矛盾现象",
      "主角的困惑即读者的困惑",
      "保留关键信息制造悬念",
      "暗示答案的重要性",
    ],
    examples: [
      {
        source: "《通用模板》",
        opening:
          "她醒来时，发现自己躺在一个完全陌生的地方。更奇怪的是，她的手——那双她熟悉了三十年的手——变得又小又嫩，像个十几岁少女的手。",
        analysis:
          "先展示异常（陌生环境），再加深异常（身体变化），激发读者好奇",
      },
    ],
    formula: "[异常现象] → [主角察觉] → [进一步异常] → [悬念问题形成]",
    forbidden: [
      "不要立刻给出答案",
      "不要让异常太过抽象",
      "不要让主角立即接受现实",
    ],
  },

  // 感官沉浸式开篇
  sensory_immersion: {
    type: "sensory_immersion",
    name: "感官沉浸式",
    description: "以强烈的感官体验开始，让读者'感受'而非'了解'场景",
    techniques: [
      "优先使用触觉、嗅觉、听觉（非视觉）",
      "用具体细节替代抽象形容",
      "用对比增强感受强度",
      "感官体验要服务于情绪基调",
    ],
    examples: [
      {
        source: "《汉宫妆影》",
        opening:
          "那种冷，不是空调房里恒温的凉意，而是一种湿冷，像无数条冰冷的小蛇顺着骨缝往里钻。",
        analysis:
          "用'不是XX，而是XX'的对比结构，将抽象的'冷'具象化为可感知的体验",
      },
    ],
    formula: "[感官体验(非视觉)] → [对比强化] → [具象比喻] → [主角反应]",
    forbidden: ["不要用'一阵XX袭来'", "不要以视觉开头", "不要用抽象形容词堆砌"],
  },

  // 反差揭示式开篇
  contrast_reveal: {
    type: "contrast_reveal",
    name: "反差揭示式",
    description: "通过前后对比或期望落差，制造戏剧张力",
    techniques: [
      "先展示'应该是'的状态",
      "再揭示'实际是'的反差",
      "反差要足够大，足够意外",
      "反差要引出核心冲突",
    ],
    examples: [
      {
        source: "《斗破苍穹》",
        opening:
          "十一岁成为斗者，被誉为天才... 如今，三年过去，这个天才却停滞在三段斗之力。",
        analysis:
          "曾经的辉煌与如今的落魄形成强烈反差，直接引出'天才陨落'的核心冲突",
      },
    ],
    formula:
      "[曾经/应该的辉煌] → [如今/实际的落魄] → [外界反应(嘲讽/怜悯)] → [主角态度]",
    forbidden: [
      "不要让反差太过牵强",
      "不要只叙述不展示",
      "反差揭示后不能立即逆转",
    ],
  },
};

// ==================== 章节类型对应钩子推荐 ====================

const CHAPTER_HOOK_RECOMMENDATIONS: Record<string, ChapterOpeningGuidance> = {
  // 第一章：最重要，决定读者是否继续
  first: {
    chapterType: "first",
    recommendedHookTypes: [
      "conflict_dialogue",
      "crisis_situation",
      "sensory_immersion",
    ],
    guidance: `## 第一章开篇黄金法则

第一章是最重要的章节，必须在前三段抓住读者。

### 核心要求
1. **前50字必须有钩子**：冲突、危机、或强烈感官体验
2. **不要世界观介绍**：让读者先关心角色，再了解世界
3. **主角必须有困境**：没有困境就没有故事
4. **留下悬念**：让读者想知道接下来会发生什么

### 推荐开篇方式
1. 冲突对话式：以揭示主角困境的对话开始
2. 极端困境式：开篇即是生死危机
3. 感官沉浸式：用强烈感官体验拉读者入场`,
    forbidden: [
      "不要以世界观设定开头",
      "不要以'故事要从XX说起'开头",
      "不要以大段环境描写开头",
      "不要以主角自我介绍开头",
      "不要用'在一个XX的世界里'",
    ],
    examples: [
      '"斗之力，三段！"——冲突对话，直接揭示困境',
      "那种冷，像无数条小蛇顺着骨缝往里钻——感官沉浸",
      "他睁开眼，看到的是一把架在脖子上的刀——极端困境",
    ],
  },

  // 高潮章节
  climax: {
    chapterType: "climax",
    recommendedHookTypes: ["crisis_situation", "conflict_dialogue"],
    guidance: `## 高潮章节开篇

高潮章节需要立即进入紧张状态。

### 核心要求
1. 开篇即战斗/冲突的最激烈时刻
2. 前一章的悬念在这里立即回应
3. 节奏要快，句子要短`,
    forbidden: ["不要用回顾式开头", "不要降低前一章建立的紧张感"],
    examples: [
      "剑已架在脖子上，他还有最后三息的时间",
      '"你以为这样就能赢我？"她嘴角流血，却笑了',
    ],
  },

  // 过渡章节
  transition: {
    chapterType: "transition",
    recommendedHookTypes: ["mystery_question", "contrast_reveal"],
    guidance: `## 过渡章节开篇

过渡章节要埋下伏笔，为后续发展铺路。

### 核心要求
1. 用悬念或异常开头，暗示新的发展
2. 可以适当放缓节奏，但仍需有钩子
3. 利用这个机会深化角色或关系`,
    forbidden: ["不要变成流水账", "不要完全没有冲突或悬念"],
    examples: ["三天后，她发现那封信不见了", "他没想到，事情会以这种方式收场"],
  },

  // 揭秘章节
  revelation: {
    chapterType: "revelation",
    recommendedHookTypes: ["mystery_question", "contrast_reveal"],
    guidance: `## 揭秘章节开篇

揭秘章节要制造"真相即将揭晓"的期待感。

### 核心要求
1. 暗示重大信息即将揭露
2. 用角色的紧张/期待带动读者
3. 不要一开始就揭秘，要有铺垫`,
    forbidden: ["不要开篇就把秘密说完", "不要降低秘密的重要性"],
    examples: [
      '"你想知道真相？"老人看着她，"你确定你承受得住？"',
      "所有线索都指向一个她不敢相信的答案",
    ],
  },

  // 普通章节
  normal: {
    chapterType: "normal",
    recommendedHookTypes: [
      "conflict_dialogue",
      "sensory_immersion",
      "mystery_question",
    ],
    guidance: `## 普通章节开篇

即使是普通章节，也需要开篇钩子。

### 核心要求
1. 至少有一个小冲突或小悬念
2. 与主线保持关联
3. 用角色互动或场景变化创造新鲜感`,
    forbidden: ["不要纯粹的日常流水账", "不要与主线完全脱节"],
    examples: [
      "她以为今天会是平静的一天，直到看到门口站着的那个人",
      "信使带来的消息让整个府邸陷入了沉默",
    ],
  },
};

// ==================== 服务实现 ====================

@Injectable()
export class OpeningHookService {
  private readonly logger = new Logger(OpeningHookService.name);

  constructor() {
    void this.logger;
  }

  /**
   * 获取指定类型的开篇钩子模板
   */
  getHookTemplate(
    type: keyof typeof OPENING_HOOK_TEMPLATES,
  ): OpeningHookTemplate {
    return OPENING_HOOK_TEMPLATES[type];
  }

  /**
   * 获取所有开篇钩子模板
   */
  getAllHookTemplates(): OpeningHookTemplate[] {
    return Object.values(OPENING_HOOK_TEMPLATES);
  }

  /**
   * 根据章节类型获取开篇指导
   */
  getChapterOpeningGuidance(
    chapterType: keyof typeof CHAPTER_HOOK_RECOMMENDATIONS,
  ): ChapterOpeningGuidance {
    return CHAPTER_HOOK_RECOMMENDATIONS[chapterType];
  }

  /**
   * 生成章节开篇约束提示词
   */
  generateOpeningConstraints(
    chapterNumber: number,
    chapterType?: string,
  ): string {
    const parts: string[] = [];

    // 确定章节类型
    let type: keyof typeof CHAPTER_HOOK_RECOMMENDATIONS = "normal";
    if (chapterNumber === 1) {
      type = "first";
    } else if (chapterType) {
      if (chapterType.includes("高潮") || chapterType.includes("决战")) {
        type = "climax";
      } else if (chapterType.includes("揭秘") || chapterType.includes("真相")) {
        type = "revelation";
      } else if (chapterType.includes("过渡") || chapterType.includes("铺垫")) {
        type = "transition";
      }
    }

    const guidance = this.getChapterOpeningGuidance(type);

    parts.push(guidance.guidance);

    parts.push(`\n### 开篇禁忌（绝对禁止）`);
    guidance.forbidden.forEach((f) => {
      parts.push(`- ❌ ${f}`);
    });

    parts.push(`\n### 参考示例`);
    guidance.examples.forEach((ex) => {
      parts.push(`- ${ex}`);
    });

    // 添加通用钩子技巧
    const recommendedTemplates = guidance.recommendedHookTypes
      .map((t) => OPENING_HOOK_TEMPLATES[t])
      .filter(Boolean);

    if (recommendedTemplates.length > 0) {
      parts.push(`\n### 推荐钩子技巧`);
      for (const template of recommendedTemplates.slice(0, 2)) {
        parts.push(`\n**${template.name}**`);
        parts.push(`公式：${template.formula}`);
        if (template.examples.length > 0) {
          const ex = template.examples[0];
          parts.push(`案例（${ex.source}）：「${ex.opening}」`);
        }
      }
    }

    return parts.join("\n");
  }

  /**
   * 分析开篇质量
   */
  analyzeOpeningQuality(opening: string): {
    score: number;
    hasHook: boolean;
    hookType: string | null;
    issues: string[];
    suggestions: string[];
  } {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 60; // 基础分
    let hasHook = false;
    let hookType: string | null = null;

    // 检查禁忌词
    const forbiddenPatterns = [
      { pattern: /^在一个/, issue: "以'在一个'开头，缺乏吸引力" },
      { pattern: /^故事/, issue: "以'故事'开头，过于直白" },
      { pattern: /^话说/, issue: "以'话说'开头，过于老套" },
      { pattern: /一阵.{1,4}袭来/, issue: "使用'一阵XX袭来'，表达陈旧" },
      { pattern: /突然|忽然|顿时/, issue: "使用'突然/忽然/顿时'，缺乏铺垫" },
      { pattern: /她感到|他感到/, issue: "直接描述感受，缺乏具象化" },
    ];

    for (const { pattern, issue } of forbiddenPatterns) {
      if (pattern.test(opening)) {
        issues.push(issue);
        score -= 10;
      }
    }

    // 检查钩子类型
    if (/^["「『]/.test(opening)) {
      // 以对话开头
      hasHook = true;
      hookType = "conflict_dialogue";
      score += 15;
    } else if (/冷|热|痛|刺|湿|干/.test(opening.slice(0, 50))) {
      // 感官描写开头
      hasHook = true;
      hookType = "sensory_immersion";
      score += 10;
    } else if (/不是.*而是|曾经.*如今/.test(opening.slice(0, 100))) {
      // 对比结构
      hasHook = true;
      hookType = "contrast_reveal";
      score += 12;
    } else if (/死|杀|险|危/.test(opening.slice(0, 50))) {
      // 危机暗示
      hasHook = true;
      hookType = "crisis_situation";
      score += 15;
    }

    // 检查开篇长度
    const firstSentence = opening.split(/[。！？]/)[0];
    if (firstSentence && firstSentence.length > 50) {
      issues.push("第一句过长，建议控制在50字以内");
      score -= 5;
    }

    // 生成建议
    if (!hasHook) {
      suggestions.push("建议使用对话、感官体验或危机场景开头");
      suggestions.push("参考公式：[冲突/感官] → [主角反应] → [悬念铺设]");
    }

    if (issues.length === 0 && hasHook) {
      score = Math.min(100, score + 10);
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      hasHook,
      hookType,
      issues,
      suggestions,
    };
  }

  /**
   * 生成随机开篇提示（用于激发创意）
   */
  generateRandomOpeningPrompt(): string {
    const templates = Object.values(OPENING_HOOK_TEMPLATES);
    const randomTemplate =
      templates[Math.floor(Math.random() * templates.length)];
    const randomExample =
      randomTemplate.examples[
        Math.floor(Math.random() * randomTemplate.examples.length)
      ];

    return `尝试使用【${randomTemplate.name}】开篇：
公式：${randomTemplate.formula}
参考：「${randomExample.opening}」（${randomExample.source}）`;
  }
}
