/**
 * StyleTemplateService - 写作风格模板服务
 *
 * 核心职责：
 * - 管理风格模板的 CRUD
 * - 提供系统预设模板
 * - 生成合并后的风格提示词
 * - 处理项目级风格覆盖
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  getStylePreset,
  WRITING_STYLE_PRESETS,
} from "../../constants/writing-style-presets";

// ==================== 类型定义 ====================

export interface DialogueRules {
  /** 对话技巧 */
  techniques: string[];
  /** 按角色区分的语气 */
  voiceByRole: Record<string, string>;
  /** 对话示例 */
  examples: Array<{
    context: string;
    good: string;
    bad: string;
  }>;
  /** 避免模式 */
  avoidPatterns: string[];
}

export interface DescriptionRules {
  /** 微表情描写要点 */
  microExpressions: string[];
  /** 氛围营造元素 */
  atmosphereElements: string[];
  /** 描写示例 */
  examples: Array<{
    context: string;
    good: string;
    bad: string;
  }>;
  /** 避免模式 */
  avoidPatterns: string[];
}

export interface PacingRules {
  /** 主角行动要求 */
  protagonistAction: {
    required: boolean;
    minPerChapter: number;
  };
  /** 最大连续被动章节数 */
  maxConsecutivePassive: number;
  /** 伏笔要求 */
  foreshadowing: {
    required: boolean;
    description?: string;
  };
  /** 章节开场多样性 */
  chapterOpeningVariety: {
    cooldownChapters: number;
  };
}

export interface StyleTemplateData {
  name: string;
  baseStyle: string;
  description?: string;
  category: string;
  dialogueRules: DialogueRules;
  descriptionRules: DescriptionRules;
  pacingRules: PacingRules;
  avoidPatterns: string[];
  referenceWorks: string[];
  systemPromptFragment?: string;
}

export interface MergedStyleConfig {
  /** 基础风格信息 */
  baseStyle: {
    id: string;
    name: string;
    pacing: string;
    dialogueStyle: string;
    descriptionStyle: string;
  };
  /** 合并后的详细规则 */
  dialogueRules: DialogueRules;
  descriptionRules: DescriptionRules;
  pacingRules: PacingRules;
  avoidPatterns: string[];
  /** 生成的完整提示词 */
  fullPrompt: string;
}

// ==================== 系统预设模板 ====================

/**
 * 系统预设的风格模板
 * 这些模板会在系统初始化时写入数据库
 */
export const SYSTEM_STYLE_TEMPLATES: StyleTemplateData[] = [
  {
    name: "甄嬛传式宫斗",
    baseStyle: "web_gongdou",
    description:
      "以《甄嬛传》为标杆的宫斗权谋风格，强调一语双关、暗藏机锋、微表情描写",
    category: "宫斗权谋",
    dialogueRules: {
      techniques: ["一语双关", "暗语试探", "借古讽今", "指桑骂槐"],
      voiceByRole: {
        太后: "端庄持重，话少而威严，常用'哀家'",
        皇后: "表面贤良，话中藏刀，常用'本宫'",
        贵妃: "骄纵跋扈或阴沉内敛，各有特色",
        嫔妃: "温婉型/泼辣型/阴沉型，语气词不同",
        宫女: "恭敬卑微，但有心机者话中有话",
        皇帝: "威严但有人情味，偶尔流露真情",
      },
      examples: [
        {
          context: "皇后警告新宠妃",
          good: "'妹妹年轻，不懂事也是有的。本宫自会替皇上教导妹妹规矩。'",
          bad: "'你给我小心点，别以为有皇上宠着就能无法无天。'",
        },
        {
          context: "试探对方立场",
          good: "'姐姐今日穿的这身衣裳，倒与昨日皇上赏我的那匹料子一个颜色。'",
          bad: "'你是不是也想争宠？'",
        },
      ],
      avoidPatterns: [
        "过于直白的威胁",
        "现代口语化表达",
        "所有角色说话方式雷同",
      ],
    },
    descriptionRules: {
      microExpressions: [
        "眸光一闪",
        "目光微凝",
        "眼底划过一丝xxx",
        "嘴角微扬",
        "嘴角微抿",
        "唇角轻颤",
        "指尖微颤",
        "轻抚衣袖",
        "握紧茶盏",
        "手指无意识地绞着帕子",
      ],
      atmosphereElements: [
        "用环境暗示人物心境（如阴雨暗示不安）",
        "用物件暗示权力关系（座位、赏赐、服饰）",
        "用宫殿布置暗示势力范围",
        "用天气变化呼应情节发展",
      ],
      examples: [
        {
          context: "权力微妙变化",
          good: "太后赐坐，皇后只得侧身让出主位，嘴角那抹笑意僵了一瞬。",
          bad: "皇后很生气，但不敢表现出来。",
        },
      ],
      avoidPatterns: [
        "只用'心中一震'等内心独白代替外在表现",
        "忽略人物的肢体语言",
        "环境描写与情节脱节",
      ],
    },
    pacingRules: {
      protagonistAction: {
        required: true,
        minPerChapter: 1,
      },
      maxConsecutivePassive: 2,
      foreshadowing: {
        required: true,
        description: "每个看似无意的细节都要在后续有呼应",
      },
      chapterOpeningVariety: {
        cooldownChapters: 5,
      },
    },
    avoidPatterns: [
      "情节靠巧合推进（恰好听到、恰好遇到）",
      "反派智商下线、无脑送人头",
      "主角连续多章只观察不行动",
      "脸谱化的善恶划分",
      "过于戏剧化的巧合",
    ],
    referenceWorks: ["甄嬛传", "如懿传", "延禧攻略"],
    systemPromptFragment: `## 甄嬛传式宫斗核心要求

### 对话必须做到
1. 每段重要对话至少一处"话中有话"
2. 不同身份角色语气明显不同
3. 善用典故、诗词暗示立场

### 描写必须做到
1. 每场戏必须有微表情或肢体语言描写
2. 用环境和物件暗示权力关系
3. 禁止只用心理独白代替外在表现

### 情节必须做到
1. 主角每章至少一个主动决策或行动
2. 重要物件/对话必须有后续呼应
3. 各方势力有清晰的利益诉求`,
  },
  {
    name: "琅琊榜式权谋",
    baseStyle: "web_gongdou",
    description:
      "以《琅琊榜》为标杆的智谋权谋风格，强调布局深远、步步为营、大格局",
    category: "宫斗权谋",
    dialogueRules: {
      techniques: ["借力打力", "以退为进", "声东击西", "明修栈道暗度陈仓"],
      voiceByRole: {
        谋士: "言简意赅，点到为止，善用比喻",
        皇帝: "喜怒不形于色，深沉内敛",
        王爷: "或豪爽或阴沉，各有特色",
        武将: "直率但不莽撞",
        文臣: "引经据典，言辞恳切",
      },
      examples: [
        {
          context: "谋士提点主公",
          good: "'棋至中局，落子无悔。主公今日所行，不过是三年前那盘棋的延续罢了。'",
          bad: "'我三年前就开始布局了，现在终于要收网了。'",
        },
      ],
      avoidPatterns: ["谋士把计划全盘托出", "反派一眼看穿主角计谋"],
    },
    descriptionRules: {
      microExpressions: [
        "眼神深邃如潭",
        "神色淡然",
        "唇角微勾",
        "目光如炬",
        "眉峰微挑",
      ],
      atmosphereElements: [
        "棋局暗示政局",
        "天气暗示形势",
        "书房布置暗示人物性格",
      ],
      examples: [
        {
          context: "谋士布局",
          good: "他拈起一枚黑子，迟迟未落，烛火映照下，那张清俊的面容深不可测。",
          bad: "他心想，这步棋很关键。",
        },
      ],
      avoidPatterns: ["过多的心理描写", "忽略智谋对决的张力"],
    },
    pacingRules: {
      protagonistAction: {
        required: true,
        minPerChapter: 1,
      },
      maxConsecutivePassive: 1,
      foreshadowing: {
        required: true,
        description: "所有计谋必须有前期铺垫，禁止突然出现的神来之笔",
      },
      chapterOpeningVariety: {
        cooldownChapters: 4,
      },
    },
    avoidPatterns: [
      "主角计谋毫无铺垫突然成功",
      "敌人智商临时下线",
      "过于巧合的转机",
      "配角沦为工具人",
    ],
    referenceWorks: ["琅琊榜", "大明王朝1566", "雍正王朝"],
    systemPromptFragment: `## 琅琊榜式权谋核心要求

### 智谋对决
1. 每个计谋必须有前期铺垫和合理推演
2. 敌我双方都有智慧，是棋逢对手
3. 胜利来自更高明的布局，而非对手失误

### 人物塑造
1. 谋士深藏不露，点到为止
2. 配角有独立人格和判断力
3. 反派有合理的动机和能力`,
  },
  {
    name: "金庸经典武侠",
    baseStyle: "jin_yong",
    description:
      "以金庸武侠为标杆的江湖风格，侠之大者、家国情怀、武功招式有诗意",
    category: "武侠江湖",
    dialogueRules: {
      techniques: ["以武论道", "侠义之辩", "江湖切口"],
      voiceByRole: {
        大侠: "豪迈洒脱，言出必践",
        前辈高人: "语重心长，暗含深意",
        江湖豪客: "爽朗直率",
        名门弟子: "礼数周全，稍显拘谨",
        邪派人物: "狡黠阴沉或狂妄不羁",
      },
      examples: [
        {
          context: "侠客相见",
          good: "'阁下剑法凌厉，想必便是江湖传闻的落雁剑罗大侠？在下有礼了。'",
          bad: "'你就是罗大侠吧？你好你好。'",
        },
      ],
      avoidPatterns: ["现代口语", "过于直白的表达感情", "称呼错误"],
    },
    descriptionRules: {
      microExpressions: ["目光如电", "神色肃然", "嘴角含笑", "眉头深锁"],
      atmosphereElements: [
        "以景写情（残阳如血、明月清风）",
        "武功招式有意境",
        "江湖规矩体现人物立场",
      ],
      examples: [
        {
          context: "武功描写",
          good: "他长剑一挥，剑光如匹练横空，招式中隐含悲天悯人之意，正是'降龙十八掌'中的'亢龙有悔'。",
          bad: "他用了一个很厉害的招式攻击对方。",
        },
      ],
      avoidPatterns: ["武功描写太过简单", "缺乏江湖气息"],
    },
    pacingRules: {
      protagonistAction: {
        required: true,
        minPerChapter: 1,
      },
      maxConsecutivePassive: 2,
      foreshadowing: {
        required: false,
        description: "情节可以有意外，但要合情合理",
      },
      chapterOpeningVariety: {
        cooldownChapters: 3,
      },
    },
    avoidPatterns: [
      "主角成长太快",
      "武功等级混乱",
      "正邪过于分明",
      "历史背景错误",
    ],
    referenceWorks: ["射雕英雄传", "天龙八部", "笑傲江湖", "鹿鼎记"],
    systemPromptFragment: `## 金庸武侠核心要求

### 武侠气质
1. 对话有江湖气息，符合身份
2. 武功描写有意境和画面感
3. 侠义精神贯穿始终

### 人物成长
1. 主角成长要有过程和代价
2. 师徒传承要有感情
3. 正邪不是非黑即白`,
  },
];

// ==================== 服务实现 ====================

@Injectable()
export class StyleTemplateService {
  private readonly logger = new Logger(StyleTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================== 初始化系统预设 ====================

  /**
   * 初始化系统预设模板
   * 在系统启动时调用，确保系统模板存在
   */
  async initializeSystemTemplates(): Promise<void> {
    for (const template of SYSTEM_STYLE_TEMPLATES) {
      const existing = await this.prisma.writingStyleTemplate.findFirst({
        where: {
          name: template.name,
          isSystem: true,
        },
      });

      if (!existing) {
        await this.prisma.writingStyleTemplate.create({
          data: {
            name: template.name,
            baseStyle: template.baseStyle,
            description: template.description,
            category: template.category,
            isSystem: true,
            dialogueRules:
              template.dialogueRules as unknown as Prisma.InputJsonValue,
            descriptionRules:
              template.descriptionRules as unknown as Prisma.InputJsonValue,
            pacingRules:
              template.pacingRules as unknown as Prisma.InputJsonValue,
            avoidPatterns: template.avoidPatterns,
            referenceWorks: template.referenceWorks,
            systemPromptFragment: template.systemPromptFragment,
          },
        });

        this.logger.log(`Created system template: ${template.name}`);
      }
    }
  }

  // ==================== 查询方法 ====================

  /**
   * 获取所有可用模板（系统 + 用户的）
   */
  async getAvailableTemplates(userId?: string) {
    const templates = await this.prisma.writingStyleTemplate.findMany({
      where: {
        OR: [{ isSystem: true }, ...(userId ? [{ ownerId: userId }] : [])],
      },
      orderBy: [{ isSystem: "desc" }, { useCount: "desc" }],
    });

    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      baseStyle: t.baseStyle,
      description: t.description,
      category: t.category,
      isSystem: t.isSystem,
      useCount: t.useCount,
    }));
  }

  /**
   * 获取模板详情
   */
  async getTemplate(templateId: string) {
    const template = await this.prisma.writingStyleTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }

    return template;
  }

  /**
   * 根据类别获取推荐模板
   */
  async getRecommendedTemplates(category: string) {
    return this.prisma.writingStyleTemplate.findMany({
      where: {
        category: { contains: category },
        isSystem: true,
      },
      orderBy: { useCount: "desc" },
      take: 5,
    });
  }

  // ==================== 核心：生成合并后的风格配置 ====================

  /**
   * 获取项目的完整风格配置（合并模板 + 项目覆盖）
   */
  async getMergedStyleConfig(
    projectId: string,
  ): Promise<MergedStyleConfig | null> {
    const project = await this.prisma.writingProject.findUnique({
      where: { id: projectId },
      include: { styleTemplate: true },
    });

    if (!project) {
      return null;
    }

    // 1. 获取基础风格
    const baseStyleId = project.writingStyle || "modern_realistic";
    const basePreset =
      getStylePreset(baseStyleId) || getStylePreset("modern_realistic")!;

    // 2. 获取模板规则（如果有）
    const template = project.styleTemplate;
    const templateRules = template
      ? {
          dialogueRules: template.dialogueRules as unknown as DialogueRules,
          descriptionRules:
            template.descriptionRules as unknown as DescriptionRules,
          pacingRules: template.pacingRules as unknown as PacingRules,
          avoidPatterns: template.avoidPatterns as string[],
          systemPromptFragment: template.systemPromptFragment,
        }
      : null;

    // 3. 获取项目级覆盖（如果有）
    const projectOverrides = project.styleOverrides as Record<
      string,
      unknown
    > | null;

    // 4. 合并规则
    const mergedDialogueRules = this.mergeRules<DialogueRules>(
      this.getDefaultDialogueRules(),
      templateRules?.dialogueRules,
      projectOverrides?.dialogueRules as DialogueRules | undefined,
    );

    const mergedDescriptionRules = this.mergeRules<DescriptionRules>(
      this.getDefaultDescriptionRules(),
      templateRules?.descriptionRules,
      projectOverrides?.descriptionRules as DescriptionRules | undefined,
    );

    const mergedPacingRules = this.mergeRules<PacingRules>(
      this.getDefaultPacingRules(),
      templateRules?.pacingRules,
      projectOverrides?.pacingRules as PacingRules | undefined,
    );

    const mergedAvoidPatterns = [
      ...basePreset.avoidPatterns,
      ...(templateRules?.avoidPatterns || []),
      ...((projectOverrides?.avoidPatterns as string[] | undefined) || []),
    ];

    // 5. 生成完整提示词
    const fullPrompt = this.generateFullPrompt(
      basePreset,
      mergedDialogueRules,
      mergedDescriptionRules,
      mergedPacingRules,
      mergedAvoidPatterns,
      templateRules?.systemPromptFragment,
    );

    return {
      baseStyle: {
        id: baseStyleId,
        name: basePreset.name,
        pacing:
          basePreset.characteristics.pacing === "fast"
            ? "快节奏"
            : basePreset.characteristics.pacing === "slow"
              ? "慢节奏"
              : "适中",
        dialogueStyle: basePreset.characteristics.dialogueStyle,
        descriptionStyle: basePreset.characteristics.descriptionStyle,
      },
      dialogueRules: mergedDialogueRules,
      descriptionRules: mergedDescriptionRules,
      pacingRules: mergedPacingRules,
      avoidPatterns: mergedAvoidPatterns,
      fullPrompt,
    };
  }

  // ==================== CRUD 方法 ====================

  /**
   * 创建用户自定义模板
   */
  async createTemplate(userId: string, data: Partial<StyleTemplateData>) {
    return this.prisma.writingStyleTemplate.create({
      data: {
        name: data.name || "自定义模板",
        baseStyle: data.baseStyle || "modern_realistic",
        description: data.description,
        category: data.category || "自定义",
        isSystem: false,
        ownerId: userId,
        dialogueRules:
          (data.dialogueRules as unknown as Prisma.InputJsonValue) || {},
        descriptionRules:
          (data.descriptionRules as unknown as Prisma.InputJsonValue) || {},
        pacingRules:
          (data.pacingRules as unknown as Prisma.InputJsonValue) || {},
        avoidPatterns: data.avoidPatterns || [],
        referenceWorks: data.referenceWorks || [],
        systemPromptFragment: data.systemPromptFragment,
      },
    });
  }

  /**
   * 更新模板
   */
  async updateTemplate(
    templateId: string,
    userId: string,
    data: Partial<StyleTemplateData>,
  ) {
    const template = await this.prisma.writingStyleTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }

    // 只有所有者可以更新非系统模板
    if (template.isSystem || template.ownerId !== userId) {
      throw new Error("Cannot update this template");
    }

    return this.prisma.writingStyleTemplate.update({
      where: { id: templateId },
      data: {
        name: data.name,
        description: data.description,
        dialogueRules: data.dialogueRules as unknown as Prisma.InputJsonValue,
        descriptionRules:
          data.descriptionRules as unknown as Prisma.InputJsonValue,
        pacingRules: data.pacingRules as unknown as Prisma.InputJsonValue,
        avoidPatterns: data.avoidPatterns,
        systemPromptFragment: data.systemPromptFragment,
      },
    });
  }

  /**
   * 为项目设置风格模板
   */
  async setProjectTemplate(
    projectId: string,
    templateId: string | null,
    overrides?: Record<string, unknown>,
  ) {
    // 增加模板使用计数
    if (templateId) {
      await this.prisma.writingStyleTemplate.update({
        where: { id: templateId },
        data: { useCount: { increment: 1 } },
      });
    }

    return this.prisma.writingProject.update({
      where: { id: projectId },
      data: {
        styleTemplateId: templateId,
        styleOverrides: (overrides as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }

  // ==================== 私有辅助方法 ====================

  private getDefaultDialogueRules(): DialogueRules {
    return {
      techniques: [],
      voiceByRole: {},
      examples: [],
      avoidPatterns: [],
    };
  }

  private getDefaultDescriptionRules(): DescriptionRules {
    return {
      microExpressions: [],
      atmosphereElements: [],
      examples: [],
      avoidPatterns: [],
    };
  }

  private getDefaultPacingRules(): PacingRules {
    return {
      protagonistAction: { required: false, minPerChapter: 0 },
      maxConsecutivePassive: 5,
      foreshadowing: { required: false },
      chapterOpeningVariety: { cooldownChapters: 3 },
    };
  }

  /**
   * 深度合并规则对象
   *
   * 合并策略：
   * - 对象：递归深度合并
   * - 数组：追加合并（去重）
   * - 基本类型：后者覆盖前者
   */
  private mergeRules<T>(defaults: T, template?: T, overrides?: T): T {
    const result = { ...defaults } as Record<string, unknown>;

    // 合并 template
    if (template) {
      this.deepMergeInto(result, template as Record<string, unknown>);
    }

    // 合并 overrides
    if (overrides) {
      this.deepMergeInto(result, overrides as Record<string, unknown>);
    }

    return result as T;
  }

  /**
   * 深度合并源对象到目标对象
   */
  private deepMergeInto(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ): void {
    for (const key of Object.keys(source)) {
      const sourceVal = source[key];
      const targetVal = target[key];

      if (sourceVal === undefined || sourceVal === null) {
        continue;
      }

      if (Array.isArray(sourceVal)) {
        // 数组：追加合并（去重）
        if (Array.isArray(targetVal)) {
          const combined = [...targetVal, ...sourceVal];
          // 对于简单类型去重
          if (combined.every((v) => typeof v !== "object")) {
            target[key] = [...new Set(combined)];
          } else {
            target[key] = combined;
          }
        } else {
          target[key] = sourceVal;
        }
      } else if (
        typeof sourceVal === "object" &&
        typeof targetVal === "object" &&
        !Array.isArray(targetVal)
      ) {
        // 对象：递归合并
        this.deepMergeInto(
          targetVal as Record<string, unknown>,
          sourceVal as Record<string, unknown>,
        );
      } else {
        // 基本类型：直接覆盖
        target[key] = sourceVal;
      }
    }
  }

  private generateFullPrompt(
    basePreset: (typeof WRITING_STYLE_PRESETS)[keyof typeof WRITING_STYLE_PRESETS],
    dialogueRules: DialogueRules,
    descriptionRules: DescriptionRules,
    pacingRules: PacingRules,
    avoidPatterns: string[],
    customFragment?: string | null,
  ): string {
    const parts: string[] = [];

    // 1. 基础风格
    parts.push(`# 写作风格：${basePreset.name}\n`);
    parts.push(basePreset.systemPromptFragment);
    parts.push("");

    // 2. 对话规则
    if (dialogueRules.techniques.length > 0) {
      parts.push("## 对话规则");
      parts.push(`**核心技巧**：${dialogueRules.techniques.join("、")}`);

      if (Object.keys(dialogueRules.voiceByRole).length > 0) {
        parts.push("\n**角色语气区分**：");
        for (const [role, voice] of Object.entries(dialogueRules.voiceByRole)) {
          parts.push(`- ${role}：${voice}`);
        }
      }

      if (dialogueRules.examples.length > 0) {
        parts.push("\n**对话示例**：");
        for (const ex of dialogueRules.examples.slice(0, 2)) {
          parts.push(`场景：${ex.context}`);
          parts.push(`✅ 好：${ex.good}`);
          parts.push(`❌ 差：${ex.bad}`);
        }
      }
      parts.push("");
    }

    // 3. 描写规则
    if (descriptionRules.microExpressions.length > 0) {
      parts.push("## 描写规则");
      parts.push(
        `**微表情描写**：${descriptionRules.microExpressions.slice(0, 8).join("、")}`,
      );

      if (descriptionRules.atmosphereElements.length > 0) {
        parts.push(
          `**氛围营造**：${descriptionRules.atmosphereElements.join("、")}`,
        );
      }
      parts.push("");
    }

    // 4. 节奏规则
    if (pacingRules.protagonistAction.required) {
      parts.push("## 节奏要求");
      parts.push(
        `- 主角每章至少 ${pacingRules.protagonistAction.minPerChapter} 个主动决策/行动`,
      );
      parts.push(`- 最多连续 ${pacingRules.maxConsecutivePassive} 章被动观察`);

      if (pacingRules.foreshadowing.required) {
        parts.push(
          `- 伏笔要求：${pacingRules.foreshadowing.description || "重要情节必须有前期铺垫"}`,
        );
      }
      parts.push("");
    }

    // 5. 避免模式
    if (avoidPatterns.length > 0) {
      parts.push("## 必须避免");
      for (const pattern of avoidPatterns) {
        parts.push(`- ❌ ${pattern}`);
      }
      parts.push("");
    }

    // 6. 自定义片段
    if (customFragment) {
      parts.push("## 特别要求");
      parts.push(customFragment);
    }

    return parts.join("\n");
  }
}
