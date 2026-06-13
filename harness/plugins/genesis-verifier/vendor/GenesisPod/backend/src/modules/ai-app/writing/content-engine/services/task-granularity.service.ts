/**
 * 任务粒度控制服务
 * Task Granularity Control Service
 *
 * 核心职责：
 * 1. 预估任务规模
 * 2. 生成粒度约束 Prompt
 * 3. 验证任务分解是否符合约束
 * 4. 自动修正不符合约束的任务分解
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  GranularityConstraint,
  GranularityLevel,
  TaskEstimate,
  TaskDecomposition,
  DecompositionValidation,
  GranularityPromptOptions,
} from "../interfaces";

/**
 * 粒度级别对应的典型输出规模
 */
const GRANULARITY_SIZE_ESTIMATES: Record<
  GranularityLevel,
  { minWords: number; maxWords: number; typicalTokens: number }
> = {
  volume: { minWords: 30000, maxWords: 100000, typicalTokens: 50000 },
  chapter: { minWords: 1000, maxWords: 5000, typicalTokens: 2500 },
  section: { minWords: 300, maxWords: 1500, typicalTokens: 800 },
  paragraph: { minWords: 50, maxWords: 300, typicalTokens: 150 },
  item: { minWords: 20, maxWords: 200, typicalTokens: 80 },
};

/**
 * 安全的单次 LLM 输出上限（字符）
 */
const SAFE_SINGLE_OUTPUT_LIMIT = 4000;

/**
 * 粒度级别的中文名称
 */
const GRANULARITY_NAMES: Record<GranularityLevel, string> = {
  volume: "卷",
  chapter: "章",
  section: "节",
  paragraph: "段落",
  item: "条目",
};

@Injectable()
export class TaskGranularityService {
  private readonly logger = new Logger(TaskGranularityService.name);

  /**
   * 根据用户需求预估任务规模
   */
  async estimateTaskScale(
    userRequirement: string,
    contextInfo?: {
      existingContent?: string;
      totalTargetWords?: number;
      preferredGranularity?: GranularityLevel;
    },
  ): Promise<TaskEstimate> {
    this.logger.debug(`Estimating task scale for: ${userRequirement}`);

    // 解析用户需求中的数量和规模信息
    const parsedRequirement = this.parseRequirement(userRequirement);

    // 确定推荐粒度
    const recommendedGranularity =
      contextInfo?.preferredGranularity ||
      this.determineOptimalGranularity(parsedRequirement);

    // 计算任务数量
    const granularityInfo = GRANULARITY_SIZE_ESTIMATES[recommendedGranularity];
    const estimatedTokensPerTask = granularityInfo.typicalTokens;

    // 根据解析结果确定总任务数
    let totalTasks = parsedRequirement.explicitCount || 1;
    if (parsedRequirement.totalWords && !parsedRequirement.explicitCount) {
      const avgWords =
        (granularityInfo.minWords + granularityInfo.maxWords) / 2;
      totalTasks = Math.ceil(parsedRequirement.totalWords / avgWords);
    }

    // 计算并行批次
    const tasksPerBatch = Math.min(10, Math.ceil(totalTasks / 8));
    const parallelBatches = Math.ceil(totalTasks / tasksPerBatch);

    // 检查是否需要续写机制
    const requiresContinuation =
      granularityInfo.maxWords * 2 > SAFE_SINGLE_OUTPUT_LIMIT;

    // 生成警告
    const warnings: string[] = [];
    if (totalTasks > 100) {
      warnings.push(`任务数量较多 (${totalTasks})，建议分批执行以保证质量`);
    }
    if (requiresContinuation) {
      warnings.push(`单任务预期输出较大，已启用续写机制`);
    }
    if (parsedRequirement.ambiguous) {
      warnings.push(`需求解析存在歧义，建议明确指定数量和粒度`);
    }

    return {
      estimatedTokensPerTask,
      recommendedGranularity,
      totalTasks,
      parallelBatches,
      tasksPerBatch,
      estimatedTotalTokens: estimatedTokensPerTask * totalTasks,
      warnings,
      requiresContinuation,
    };
  }

  /**
   * 构建粒度约束 Prompt
   */
  buildGranularityConstraintPrompt(
    constraint: GranularityConstraint,
    options?: GranularityPromptOptions,
  ): string {
    const granularityName = GRANULARITY_NAMES[constraint.level];
    const maxOutput = constraint.maxOutputPerTask.characters || 3000;

    let prompt = `
## 关键约束 - 必须严格遵守

### 任务粒度要求
- **粒度级别**：${granularityName}
- **每个任务最大输出**：${maxOutput} 字
- **禁止合并**：${constraint.allowMerge ? "允许合理合并" : `不得将多个${granularityName}合并为一个任务`}
`;

    // 注意：不再显示"预期任务数"，避免 Leader 误解为上限
    // 改为强调按用户需求分解
    if (constraint.expectedTotalTasks && constraint.expectedTotalTasks > 10) {
      prompt += `- **重要**：这是一个大型任务，预计需要 ${constraint.expectedTotalTasks} 个以上的${granularityName}级任务\n`;
      prompt += `- **禁止分批**：必须一次性列出所有任务，不得只列出"前几个"或"第一批"\n`;
    }

    // 添加错误示例
    prompt += `
### 错误示例（禁止）
`;

    if (constraint.level === "chapter") {
      prompt += `❌ 任务1：第1-10章（违反：合并了10章）
❌ 任务1：第一卷（违反：一卷包含多章）
❌ 任务1：创作前半部分（违反：粒度过大）
`;
    } else if (constraint.level === "section") {
      prompt += `❌ 任务1：第1-5节（违反：合并了5节）
❌ 任务1：完成第一章（违反：一章包含多节）
`;
    } else if (constraint.level === "item") {
      prompt += `❌ 任务1：分析所有数据点（违反：粒度过大）
❌ 任务1：处理10个条目（违反：合并了10个条目）
`;
    }

    // 添加正确示例
    prompt += `
### 正确示例（遵循）
`;

    if (options?.exampleTitles && options.exampleTitles.length > 0) {
      options.exampleTitles.forEach((title, idx) => {
        prompt += `✓ 任务${idx + 1}：${title}\n`;
      });
    } else if (constraint.level === "chapter") {
      prompt += `✓ 任务1：第1章 - 开篇引入
✓ 任务2：第2章 - 角色登场
✓ 任务3：第3章 - 初遇危机
...
`;
    } else if (constraint.level === "section") {
      prompt += `✓ 任务1：1.1 背景介绍
✓ 任务2：1.2 问题定义
✓ 任务3：1.3 研究方法
...
`;
    } else if (constraint.level === "item") {
      prompt += `✓ 任务1：分析数据点 A
✓ 任务2：分析数据点 B
✓ 任务3：分析数据点 C
...
`;
    }

    // 验证规则提醒
    prompt += `
### 验证规则
系统将自动验证你的任务分解：
- 如果单个任务包含多个${granularityName}，将被自动拆分
- 每个任务的标题必须明确指出是第几${granularityName}
- **必须按用户需求的完整结构分解**，不得自行缩减范围
`;

    if (options?.additionalConstraints) {
      prompt += `\n### 额外要求\n${options.additionalConstraints}\n`;
    }

    return prompt;
  }

  /**
   * 验证任务分解是否符合约束
   */
  validateDecomposition(
    tasks: TaskDecomposition[],
    constraint: GranularityConstraint,
  ): DecompositionValidation {
    const violations: DecompositionValidation["violations"] = [];
    const granularityName = GRANULARITY_NAMES[constraint.level];

    // 检查每个任务
    tasks.forEach((task, index) => {
      // 检查标题是否包含多个单元
      const multiUnitPattern = this.detectMultiUnitPattern(
        task.title,
        constraint.level,
      );
      if (multiUnitPattern) {
        violations.push({
          taskIndex: index,
          taskTitle: task.title,
          issue: `任务标题暗示包含多个${granularityName}：${multiUnitPattern}`,
          severity: "error",
        });
      }

      // 检查预估字数是否超过限制
      if (
        task.estimatedWords &&
        constraint.maxOutputPerTask.characters &&
        task.estimatedWords > constraint.maxOutputPerTask.characters * 1.5
      ) {
        violations.push({
          taskIndex: index,
          taskTitle: task.title,
          issue: `预估字数 (${task.estimatedWords}) 超过限制 (${constraint.maxOutputPerTask.characters})`,
          severity: "warning",
        });
      }
    });

    // 检查总任务数
    if (constraint.expectedTotalTasks) {
      const deviation =
        Math.abs(tasks.length - constraint.expectedTotalTasks) /
        constraint.expectedTotalTasks;
      if (deviation > 0.2) {
        violations.push({
          taskIndex: -1,
          taskTitle: "[总体]",
          issue: `任务总数 (${tasks.length}) 与预期 (${constraint.expectedTotalTasks}) 相差过大`,
          severity: "warning",
        });
      }
    }

    const valid = violations.filter((v) => v.severity === "error").length === 0;

    // 如果验证失败，尝试自动修正
    let autoFixed: TaskDecomposition[] | undefined;
    if (!valid) {
      autoFixed = this.autoRedecompose(tasks, constraint);
    }

    // 计算统计信息
    const totalEstimatedWords = tasks.reduce(
      (sum, t) => sum + (t.estimatedWords || 0),
      0,
    );

    return {
      valid,
      violations,
      autoFixed,
      stats: {
        originalTaskCount: tasks.length,
        fixedTaskCount: autoFixed?.length,
        totalEstimatedWords,
      },
    };
  }

  /**
   * 自动重新分解任务
   */
  autoRedecompose(
    originalTasks: TaskDecomposition[],
    constraint: GranularityConstraint,
  ): TaskDecomposition[] {
    this.logger.log(
      `Auto-redecomposing ${originalTasks.length} tasks to match constraint`,
    );

    const result: TaskDecomposition[] = [];
    let orderCounter = 1;

    for (const task of originalTasks) {
      // 检测是否是多单元任务
      const rangeMatch = this.extractRange(task.title, constraint.level);

      if (rangeMatch) {
        // 拆分为多个单独任务
        const { start, end } = rangeMatch;
        for (let i = start; i <= end; i++) {
          result.push({
            title: this.buildSingleUnitTitle(i, constraint.level, task.title),
            description: this.buildSingleUnitDescription(
              i,
              constraint.level,
              task.description,
            ),
            estimatedWords: constraint.maxOutputPerTask.characters
              ? Math.min(
                  (task.estimatedWords || 2000) / (end - start + 1),
                  constraint.maxOutputPerTask.characters,
                )
              : undefined,
            order: orderCounter++,
          });
        }
      } else {
        // 保持原样
        result.push({
          ...task,
          order: orderCounter++,
        });
      }
    }

    this.logger.log(
      `Redecomposed: ${originalTasks.length} → ${result.length} tasks`,
    );

    return result;
  }

  /**
   * 从约束构建默认配置
   */
  buildDefaultConstraint(
    level: GranularityLevel,
    options?: {
      expectedTotalTasks?: number;
      maxOutputPerTask?: number;
    },
  ): GranularityConstraint {
    const sizeEstimate = GRANULARITY_SIZE_ESTIMATES[level];

    return {
      level,
      maxOutputPerTask: {
        characters: options?.maxOutputPerTask || sizeEstimate.maxWords * 2,
        tokens: sizeEstimate.typicalTokens,
      },
      allowMerge: false,
      expectedTotalTasks: options?.expectedTotalTasks,
    };
  }

  // ============ 私有方法 ============

  /**
   * 内容结构单位定义（中英文双语）
   * 支持各种类型的结构化内容：小说、剧本、动漫、连载、课程等
   *
   * 层级分类：
   * - 大单位（容器级）：卷/volume、部/part、篇/book、季/season、册/tome
   * - 中单位（章节级）：章/chapter、回、集/episode、话、期/issue、幕/act、讲/lecture、课/lesson
   * - 小单位（段落级）：节/section、段/paragraph、条/item
   */
  private static readonly STRUCTURE_UNITS = {
    // 大单位 - 通常包含多个中单位
    container: [
      // 中文
      { unit: "卷", aliases: ["卷本", "分卷"], isEnglish: false },
      { unit: "部", aliases: ["部分"], isEnglish: false },
      { unit: "篇", aliases: ["上篇", "中篇", "下篇"], isEnglish: false },
      { unit: "季", aliases: ["第一季", "第二季"], isEnglish: false },
      { unit: "册", aliases: ["分册"], isEnglish: false },
      { unit: "辑", aliases: ["专辑"], isEnglish: false },
      { unit: "编", aliases: ["上编", "下编"], isEnglish: false },
      // 英文
      { unit: "volume", aliases: ["volumes", "vol", "vols"], isEnglish: true },
      { unit: "book", aliases: ["books"], isEnglish: true },
      { unit: "part", aliases: ["parts"], isEnglish: true },
      { unit: "season", aliases: ["seasons"], isEnglish: true },
      { unit: "series", aliases: [], isEnglish: true },
      { unit: "arc", aliases: ["arcs", "story arc"], isEnglish: true },
      { unit: "module", aliases: ["modules"], isEnglish: true },
    ],
    // 中单位 - 主要的任务粒度
    chapter: [
      // 中文
      { unit: "章", aliases: [], isEnglish: false },
      { unit: "回", aliases: [], isEnglish: false }, // 传统小说
      { unit: "集", aliases: [], isEnglish: false }, // 剧集/动漫
      { unit: "话", aliases: [], isEnglish: false }, // 漫画/轻小说
      { unit: "期", aliases: [], isEnglish: false }, // 连载/杂志
      { unit: "幕", aliases: [], isEnglish: false }, // 戏剧
      { unit: "讲", aliases: [], isEnglish: false }, // 课程/讲座
      { unit: "课", aliases: [], isEnglish: false }, // 教程
      { unit: "关", aliases: [], isEnglish: false }, // 游戏关卡
      { unit: "场", aliases: [], isEnglish: false }, // 戏剧场次
      // 英文
      {
        unit: "chapter",
        aliases: ["chapters", "chap", "chaps"],
        isEnglish: true,
      },
      { unit: "episode", aliases: ["episodes", "ep", "eps"], isEnglish: true },
      { unit: "lesson", aliases: ["lessons"], isEnglish: true },
      { unit: "lecture", aliases: ["lectures"], isEnglish: true },
      { unit: "unit", aliases: ["units"], isEnglish: true },
      { unit: "act", aliases: ["acts"], isEnglish: true },
      { unit: "scene", aliases: ["scenes"], isEnglish: true },
      { unit: "level", aliases: ["levels"], isEnglish: true },
      { unit: "stage", aliases: ["stages"], isEnglish: true },
      { unit: "track", aliases: ["tracks"], isEnglish: true },
      { unit: "article", aliases: ["articles"], isEnglish: true },
      { unit: "post", aliases: ["posts"], isEnglish: true },
    ],
    // 小单位 - 更细的粒度
    section: [
      // 中文
      { unit: "节", aliases: [], isEnglish: false },
      { unit: "段", aliases: [], isEnglish: false },
      { unit: "条", aliases: [], isEnglish: false },
      { unit: "项", aliases: [], isEnglish: false },
      { unit: "幅", aliases: [], isEnglish: false }, // 连环画
      // 英文
      { unit: "section", aliases: ["sections", "sec"], isEnglish: true },
      { unit: "paragraph", aliases: ["paragraphs", "para"], isEnglish: true },
      { unit: "segment", aliases: ["segments"], isEnglish: true },
      { unit: "step", aliases: ["steps"], isEnglish: true },
    ],
  };

  // 中文数字映射
  private static readonly CHINESE_NUMBERS: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    十一: 11,
    十二: 12,
    二十: 20,
    三十: 30,
    四十: 40,
    五十: 50,
    百: 100,
  };

  /**
   * 解析用户需求
   *
   * 通用结构解析：
   * - 识别两级结构：大单位 + 中单位（如 "8卷×10章"、"3季×12集"）
   * - 识别单级结构：直接中单位（如 "50章"、"24集"）
   * - 自动计算总任务数
   */
  private parseRequirement(requirement: string): {
    explicitCount?: number;
    totalWords?: number;
    granularityHint?: GranularityLevel;
    ambiguous: boolean;
    containerCount?: number;
    unitsPerContainer?: number;
    containerUnit?: string;
    chapterUnit?: string;
  } {
    const result: ReturnType<typeof this.parseRequirement> = {
      ambiguous: false,
    };

    // 第一步：检测两级结构（大单位 + 中单位）
    const twoLevelStructure = this.detectTwoLevelStructure(requirement);
    if (twoLevelStructure) {
      result.containerCount = twoLevelStructure.containerCount;
      result.unitsPerContainer = twoLevelStructure.unitsPerContainer;
      result.containerUnit = twoLevelStructure.containerUnit;
      result.chapterUnit = twoLevelStructure.chapterUnit;
      result.explicitCount =
        twoLevelStructure.containerCount * twoLevelStructure.unitsPerContainer;
      result.granularityHint = "chapter";
      this.logger.log(
        `Detected two-level structure: ${twoLevelStructure.containerCount} ${twoLevelStructure.containerUnit} × ${twoLevelStructure.unitsPerContainer} ${twoLevelStructure.chapterUnit} = ${result.explicitCount} total tasks`,
      );
      return result;
    }

    // 第二步：检测单级结构（直接中单位）
    const singleLevelStructure = this.detectSingleLevelStructure(requirement);
    if (singleLevelStructure) {
      result.explicitCount = singleLevelStructure.count;
      result.chapterUnit = singleLevelStructure.unit;
      result.granularityHint =
        singleLevelStructure.level === "chapter" ? "chapter" : "section";
      this.logger.log(
        `Detected single-level structure: ${singleLevelStructure.count} ${singleLevelStructure.unit}`,
      );
      return result;
    }

    // 第三步：从结构化内容中统计实际单位数量
    const countedStructure = this.countStructuredUnits(requirement);
    if (countedStructure) {
      result.explicitCount = countedStructure.totalCount;
      result.chapterUnit = countedStructure.unit;
      result.granularityHint = "chapter";
      this.logger.log(
        `Counted structured units: ${countedStructure.totalCount} ${countedStructure.unit}`,
      );
      return result;
    }

    // 第四步：匹配条目数量（通用格式）
    const itemMatch = requirement.match(/(\d+)\s*(个|条|项)/);
    if (itemMatch) {
      result.explicitCount = parseInt(itemMatch[1], 10);
      result.granularityHint = "item";
      return result;
    }

    // 第五步：匹配总字数（用于估算）
    const wordMatch = requirement.match(/(\d+)\s*(万|千)?\s*字/);
    if (wordMatch) {
      let words = parseInt(wordMatch[1], 10);
      if (wordMatch[2] === "万") words *= 10000;
      if (wordMatch[2] === "千") words *= 1000;
      result.totalWords = words;
    }

    // 检测歧义
    if (!result.explicitCount && !result.totalWords) {
      result.ambiguous = true;
    }

    return result;
  }

  /**
   * 检测两级结构（大单位 + 中单位）
   * 中文例如："8卷，每卷10章" → { containerCount: 8, unitsPerContainer: 10 }
   * 英文例如："8 volumes with 10 chapters each" → { containerCount: 8, unitsPerContainer: 10 }
   */
  private detectTwoLevelStructure(requirement: string):
    | {
        containerCount: number;
        unitsPerContainer: number;
        containerUnit: string;
        chapterUnit: string;
      }
    | undefined {
    // 遍历所有大单位
    for (const container of TaskGranularityService.STRUCTURE_UNITS.container) {
      const containerCount = this.extractUnitCount(requirement, container.unit);
      if (!containerCount) continue;

      const isEnglishContainer = /^[a-z]+$/i.test(container.unit);

      // 找到大单位后，查找对应的中单位
      for (const chapter of TaskGranularityService.STRUCTURE_UNITS.chapter) {
        const isEnglishChapter = /^[a-z]+$/i.test(chapter.unit);

        // 只匹配同语言的单位组合
        if (isEnglishContainer !== isEnglishChapter) continue;

        if (isEnglishContainer) {
          // 英文模式匹配
          const unitsPerContainer = this.extractEnglishPerUnitCount(
            requirement,
            container.unit,
            chapter.unit,
          );
          if (unitsPerContainer) {
            return {
              containerCount,
              unitsPerContainer,
              containerUnit: container.unit,
              chapterUnit: chapter.unit,
            };
          }
        } else {
          // 中文模式匹配 "每X N个Y" 格式
          const perPattern = new RegExp(
            `每${container.unit}[约]?\\s*(\\d+)\\s*${chapter.unit}`,
          );
          const perMatch = requirement.match(perPattern);
          if (perMatch) {
            return {
              containerCount,
              unitsPerContainer: parseInt(perMatch[1], 10),
              containerUnit: container.unit,
              chapterUnit: chapter.unit,
            };
          }
        }

        // 或者尝试统计实际的章节数量，推算每个大单位的中单位数
        const chapterCount = this.countUnitMentions(requirement, chapter.unit);
        if (chapterCount > 0) {
          // 如果有具体的章节列表，计算每个容器的章节数
          const unitsPerContainer = Math.ceil(chapterCount / containerCount);
          return {
            containerCount,
            unitsPerContainer,
            containerUnit: container.unit,
            chapterUnit: chapter.unit,
          };
        }
      }

      // 如果只找到大单位，没有找到中单位，使用默认值
      // 但需要从需求中推断合理的中单位数量
      const defaultUnits = this.estimateUnitsPerContainer(
        requirement,
        container.unit,
      );
      if (defaultUnits) {
        return {
          containerCount,
          unitsPerContainer: defaultUnits.count,
          containerUnit: container.unit,
          chapterUnit: defaultUnits.unit,
        };
      }
    }

    return undefined;
  }

  /**
   * 提取英文"每单位N个"格式的数量
   * 例如: "with 10 chapters each", "10 chapters per volume", "each volume has 10 chapters"
   */
  private extractEnglishPerUnitCount(
    requirement: string,
    containerUnit: string,
    chapterUnit: string,
  ): number | undefined {
    const lowerReq = requirement.toLowerCase();
    const containerForms = this.getEnglishUnitForms(
      containerUnit.toLowerCase(),
    );
    const chapterForms = this.getEnglishUnitForms(chapterUnit.toLowerCase());

    const containerPattern = containerForms.join("|");
    const chapterPattern = chapterForms.join("|");

    // 各种英文"每单位N个"的表达方式
    const patterns = [
      // "with 10 chapters each"
      new RegExp(
        `(?:with|containing)\\s*(\\d+)\\s*(?:${chapterPattern})\\s*each\\b`,
        "i",
      ),
      // "10 chapters per volume"
      new RegExp(
        `(\\d+)\\s*(?:${chapterPattern})\\s*(?:per|for each|in each)\\s*(?:${containerPattern})\\b`,
        "i",
      ),
      // "each volume has 10 chapters"
      new RegExp(
        `each\\s*(?:${containerPattern})\\s*(?:has|contains|includes)\\s*(\\d+)\\s*(?:${chapterPattern})\\b`,
        "i",
      ),
      // "10 chapters in each volume"
      new RegExp(
        `(\\d+)\\s*(?:${chapterPattern})\\s*in\\s*each\\s*(?:${containerPattern})\\b`,
        "i",
      ),
      // "averaging 10 chapters per volume"
      new RegExp(
        `(?:averaging|about|approximately|around)\\s*(\\d+)\\s*(?:${chapterPattern})\\s*(?:per|each)\\b`,
        "i",
      ),
    ];

    for (const pattern of patterns) {
      const match = lowerReq.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    return undefined;
  }

  /**
   * 检测单级结构（直接中单位或小单位）
   */
  private detectSingleLevelStructure(requirement: string):
    | {
        count: number;
        unit: string;
        level: "chapter" | "section";
      }
    | undefined {
    // 先检查章节级单位
    for (const chapter of TaskGranularityService.STRUCTURE_UNITS.chapter) {
      const count = this.extractUnitCount(requirement, chapter.unit);
      if (count) {
        return { count, unit: chapter.unit, level: "chapter" };
      }
    }

    // 再检查段落级单位
    for (const section of TaskGranularityService.STRUCTURE_UNITS.section) {
      const count = this.extractUnitCount(requirement, section.unit);
      if (count) {
        return { count, unit: section.unit, level: "section" };
      }
    }

    return undefined;
  }

  /**
   * 从结构化内容中统计实际单位数量
   * 例如：统计 "第一章...第二章...第三章..." 中有多少章
   */
  private countStructuredUnits(requirement: string):
    | {
        totalCount: number;
        unit: string;
      }
    | undefined {
    // 遍历所有中单位
    for (const chapter of TaskGranularityService.STRUCTURE_UNITS.chapter) {
      const count = this.countUnitMentions(requirement, chapter.unit);
      if (count >= 3) {
        // 至少要有3个才认为是结构化内容
        return { totalCount: count, unit: chapter.unit };
      }
    }

    // 再检查大单位
    for (const container of TaskGranularityService.STRUCTURE_UNITS.container) {
      const count = this.countUnitMentions(requirement, container.unit);
      if (count >= 2) {
        return { totalCount: count, unit: container.unit };
      }
    }

    return undefined;
  }

  /**
   * 提取单位数量（中英文双语支持）
   * 中文: "N个X"、"共N个X"、"全N个X"、"分为N个X" 等格式
   * 英文: "N units"、"N-unit"、"with N units"、"containing N units" 等格式
   */
  private extractUnitCount(
    requirement: string,
    unit: string,
  ): number | undefined {
    const lowerReq = requirement.toLowerCase();
    const lowerUnit = unit.toLowerCase();

    // 判断是否为英文单位
    const isEnglishUnit = /^[a-z]+$/i.test(unit);

    if (isEnglishUnit) {
      // 英文模式匹配
      return this.extractEnglishUnitCount(lowerReq, lowerUnit);
    } else {
      // 中文模式匹配
      return this.extractChineseUnitCount(requirement, unit);
    }
  }

  /**
   * 提取英文单位数量
   */
  private extractEnglishUnitCount(
    requirement: string,
    unit: string,
  ): number | undefined {
    // 获取单位的所有形式（单数和复数）
    const unitForms = this.getEnglishUnitForms(unit);
    const unitPattern = unitForms.join("|");

    // 英文数量表达方式
    const patterns = [
      // "8 volumes", "10 chapters", "12 episodes"
      new RegExp(`(\\d+)\\s*(?:${unitPattern})\\b`, "i"),
      // "a 8-volume novel", "10-chapter book"
      new RegExp(`(\\d+)[-\\s](?:${unitPattern})\\b`, "i"),
      // "with 8 volumes", "containing 10 chapters"
      new RegExp(
        `(?:with|containing|has|have|includes?)\\s*(\\d+)\\s*(?:${unitPattern})\\b`,
        "i",
      ),
      // "consists of 8 volumes"
      new RegExp(
        `(?:consists?\\s+of|divided\\s+into|split\\s+into)\\s*(\\d+)\\s*(?:${unitPattern})\\b`,
        "i",
      ),
      // "total of 8 volumes"
      new RegExp(
        `(?:total\\s+of|altogether)\\s*(\\d+)\\s*(?:${unitPattern})\\b`,
        "i",
      ),
      // "8 volumes in total"
      new RegExp(
        `(\\d+)\\s*(?:${unitPattern})\\s+(?:in\\s+total|altogether|total)\\b`,
        "i",
      ),
    ];

    for (const pattern of patterns) {
      const match = requirement.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    return undefined;
  }

  /**
   * 获取英文单位的所有形式（处理复数等）
   */
  private getEnglishUnitForms(unit: string): string[] {
    const forms = [unit];

    // 查找别名
    for (const category of Object.values(
      TaskGranularityService.STRUCTURE_UNITS,
    )) {
      for (const item of category) {
        if (item.unit === unit || item.aliases.includes(unit)) {
          forms.push(item.unit, ...item.aliases);
          break;
        }
      }
    }

    // 去重
    return [...new Set(forms)];
  }

  /**
   * 提取中文单位数量
   */
  private extractChineseUnitCount(
    requirement: string,
    unit: string,
  ): number | undefined {
    // 中文数量表达方式
    const patterns = [
      new RegExp(`(\\d+)\\s*${unit}`), // "8卷"
      new RegExp(`共\\s*(\\d+)\\s*${unit}`), // "共8卷"
      new RegExp(`全\\s*(\\d+)\\s*${unit}`), // "全8卷"
      new RegExp(`分\\s*(\\d+)\\s*${unit}`), // "分8卷"
      new RegExp(`(\\d+)\\s*${unit}本`), // "8卷本"
      new RegExp(`分为\\s*(\\d+)\\s*${unit}`), // "分为8卷"
      new RegExp(`包含\\s*(\\d+)\\s*${unit}`), // "包含8卷"
      new RegExp(`含\\s*(\\d+)\\s*${unit}`), // "含8卷"
    ];

    for (const pattern of patterns) {
      const match = requirement.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    // 尝试匹配中文数字
    const chinesePatterns = [
      new RegExp(`([一二三四五六七八九十百]+)\\s*${unit}`),
      new RegExp(`共\\s*([一二三四五六七八九十百]+)\\s*${unit}`),
    ];

    for (const pattern of chinesePatterns) {
      const match = requirement.match(pattern);
      if (match) {
        const num = this.parseChineseNumber(match[1]);
        if (num) return num;
      }
    }

    return undefined;
  }

  /**
   * 统计需求中某个单位的实际出现次数（中英文双语支持）
   * 中文: 统计 "第一章"、"第二章"... 的数量
   * 英文: 统计 "Chapter 1"、"Chapter 2"... 的数量
   */
  private countUnitMentions(requirement: string, unit: string): number {
    const isEnglishUnit = /^[a-z]+$/i.test(unit);

    if (isEnglishUnit) {
      return this.countEnglishUnitMentions(
        requirement.toLowerCase(),
        unit.toLowerCase(),
      );
    } else {
      return this.countChineseUnitMentions(requirement, unit);
    }
  }

  /**
   * 统计英文单位出现次数
   */
  private countEnglishUnitMentions(requirement: string, unit: string): number {
    const unitForms = this.getEnglishUnitForms(unit);

    let maxCount = 0;
    for (const form of unitForms) {
      // "Chapter 1", "Chapter 2", etc.
      const pattern1 = new RegExp(`${form}\\s*\\d+`, "gi");
      const matches1 = requirement.match(pattern1);

      // "1st chapter", "2nd chapter", etc.
      const pattern2 = new RegExp(`\\d+(?:st|nd|rd|th)?\\s*${form}`, "gi");
      const matches2 = requirement.match(pattern2);

      const count = Math.max(
        matches1 ? matches1.length : 0,
        matches2 ? matches2.length : 0,
      );
      maxCount = Math.max(maxCount, count);
    }

    return maxCount;
  }

  /**
   * 统计中文单位出现次数
   */
  private countChineseUnitMentions(requirement: string, unit: string): number {
    // 匹配 "第X章" 格式（数字或中文数字）
    const pattern = new RegExp(`第[一二三四五六七八九十百\\d]+${unit}`, "g");
    const matches = requirement.match(pattern);

    // 匹配 "章1"、"章2" 格式
    const pattern2 = new RegExp(`${unit}\\s*[\\d]+`, "g");
    const matches2 = requirement.match(pattern2);

    // 匹配 "卷一"、"卷二" 格式
    const pattern3 = new RegExp(`${unit}[一二三四五六七八九十百]+`, "g");
    const matches3 = requirement.match(pattern3);

    const count1 = matches ? matches.length : 0;
    const count2 = matches2 ? matches2.length : 0;
    const count3 = matches3 ? matches3.length : 0;

    return Math.max(count1, count2, count3);
  }

  /**
   * 解析中文数字
   */
  private parseChineseNumber(chinese: string): number | undefined {
    // 简单情况：直接查表
    if (TaskGranularityService.CHINESE_NUMBERS[chinese]) {
      return TaskGranularityService.CHINESE_NUMBERS[chinese];
    }

    // 处理组合数字，如 "二十三"
    let result = 0;
    let current = 0;

    for (const char of chinese) {
      const num = TaskGranularityService.CHINESE_NUMBERS[char];
      if (num === undefined) return undefined;

      if (num === 10) {
        if (current === 0) current = 1;
        result += current * 10;
        current = 0;
      } else if (num === 100) {
        if (current === 0) current = 1;
        result += current * 100;
        current = 0;
      } else {
        current = num;
      }
    }

    return result + current;
  }

  /**
   * 估算每个容器单位应该包含多少中单位
   * 基于内容类型和常见规范
   */
  private estimateUnitsPerContainer(
    requirement: string,
    containerUnit: string,
  ): { count: number; unit: string } | undefined {
    const text = requirement.toLowerCase();

    // 根据容器类型和内容类型估算
    switch (containerUnit) {
      case "卷":
        // 小说：每卷通常 8-15 章
        if (
          text.includes("小说") ||
          text.includes("武侠") ||
          text.includes("奇幻") ||
          text.includes("玄幻")
        ) {
          return { count: 10, unit: "章" };
        }
        return { count: 10, unit: "章" };

      case "部":
        // 长篇：每部可能是独立的，估算 20-30 章
        return { count: 25, unit: "章" };

      case "季":
        // 剧集：每季通常 10-24 集
        if (text.includes("动漫") || text.includes("番剧")) {
          return { count: 12, unit: "集" };
        }
        if (text.includes("美剧")) {
          return { count: 22, unit: "集" };
        }
        return { count: 12, unit: "集" };

      case "册":
        // 教材/漫画：每册章节数变化大
        return { count: 10, unit: "章" };

      case "篇":
        // 篇章结构：每篇可能较少
        return { count: 5, unit: "章" };

      case "辑":
        // 专辑/合集
        return { count: 10, unit: "集" };

      case "编":
        // 编辑结构
        return { count: 15, unit: "章" };

      default:
        return { count: 10, unit: "章" };
    }
  }

  /**
   * 确定最优粒度
   */
  private determineOptimalGranularity(
    parsed: ReturnType<typeof this.parseRequirement>,
  ): GranularityLevel {
    if (parsed.granularityHint) {
      return parsed.granularityHint;
    }

    if (parsed.totalWords) {
      if (parsed.totalWords >= 50000) return "chapter";
      if (parsed.totalWords >= 10000) return "section";
      return "paragraph";
    }

    // 默认使用章节粒度
    return "chapter";
  }

  /**
   * 检测多单元模式
   */
  private detectMultiUnitPattern(
    title: string,
    level: GranularityLevel,
  ): string | null {
    const patterns: Record<GranularityLevel, RegExp[]> = {
      volume: [/第?\d+-\d+卷/, /前\d+卷/, /后\d+卷/],
      chapter: [
        /第?\d+-\d+章/,
        /前\d+章/,
        /后\d+章/,
        /第.卷/,
        /全部章节/,
        /所有章节/,
      ],
      section: [/第?\d+-\d+节/, /\d+\.\d+-\d+\.\d+/],
      paragraph: [/第?\d+-\d+段/, /多个段落/],
      item: [/第?\d+-\d+[个条项]/, /所有[条项目]/, /全部[条项目]/],
    };

    for (const pattern of patterns[level]) {
      const match = title.match(pattern);
      if (match) {
        return match[0];
      }
    }

    return null;
  }

  /**
   * 提取范围
   */
  private extractRange(
    title: string,
    level: GranularityLevel,
  ): { start: number; end: number } | null {
    const rangePatterns: Record<GranularityLevel, RegExp> = {
      volume: /第?(\d+)-(\d+)卷/,
      chapter: /第?(\d+)-(\d+)章/,
      section: /第?(\d+)-(\d+)节/,
      paragraph: /第?(\d+)-(\d+)段/,
      item: /第?(\d+)-(\d+)[个条项]/,
    };

    const match = title.match(rangePatterns[level]);
    if (match) {
      return {
        start: parseInt(match[1], 10),
        end: parseInt(match[2], 10),
      };
    }

    return null;
  }

  /**
   * 构建单单元标题
   */
  private buildSingleUnitTitle(
    index: number,
    level: GranularityLevel,
    originalTitle: string,
  ): string {
    const unitName = GRANULARITY_NAMES[level];

    // 尝试从原标题提取主题
    const themeMatch = originalTitle.match(/[：:]\s*(.+)$/);
    const theme = themeMatch ? themeMatch[1] : "";

    return `第${index}${unitName}${theme ? `：${theme}` : ""}`;
  }

  /**
   * 构建单单元描述
   */
  private buildSingleUnitDescription(
    index: number,
    level: GranularityLevel,
    originalDescription: string,
  ): string {
    const unitName = GRANULARITY_NAMES[level];
    return `完成第${index}${unitName}的创作。${originalDescription}`;
  }
}
