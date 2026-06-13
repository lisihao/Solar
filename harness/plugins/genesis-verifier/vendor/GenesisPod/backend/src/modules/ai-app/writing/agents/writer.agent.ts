/**
 * Writer Agent - 写作 Agent (Enhanced with Quality System)
 *
 * 核心写作角色，负责：
 * - 基于大纲和 Story Bible 设定完成章节创作
 * - 保持与项目整体风格一致
 * - 严格遵循 Story Bible 中的设定
 * - 【新增】遵循表达冷却约束，避免重复表达
 * - 【新增】遵循角色人格约束，保持角色一致性
 * - 【新增】遵循历史知识约束，避免历史错误
 *
 * 支持多实例并行，每个实例负责一个章节的写作。
 */

import { Injectable } from "@nestjs/common";
import { BaseAgent } from "@/modules/ai-harness/facade";
import {
  type ExecutionMode,
  BUILTIN_TOOLS,
  type AgentContext,
  type AgentCapability,
} from "@/modules/ai-harness/facade";
import {
  WritingContextPackage,
  ChapterWritingContext,
} from "../interfaces/writing-context.interface";
import { ExpressionMemoryService } from "../services/quality/expression-memory.service";
import { CharacterPersonalityService } from "../services/quality/character-personality.service";
import { HistoricalKnowledgeService } from "../services/quality/historical-knowledge.service";
import { ProfessionalVoiceService } from "../services/quality/professional-voice.service";
import { SensoryImmersionService } from "../services/quality/sensory-immersion.service";
import { OpeningHookService } from "../services/quality/opening-hook.service";
import { NarrativeCraftService } from "../services/quality/narrative-craft.service";
import { ForeshadowingService } from "../services/quality/foreshadowing.service";
import { PacingControlService } from "../services/quality/pacing-control.service";
// 新增：对话约束和角色一致性服务
import { DialogueConstraintsService } from "../services/quality/dialogue-constraints.service";
import { CharacterConsistencyService } from "../services/quality/character-consistency.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  generateStylePrompt,
  getRandomTechniques,
} from "../constants/writing-style-presets";

// ==================== 输入输出类型 ====================

export interface WriterInput {
  /** 章节ID */
  chapterId: string;
  /** 写作上下文包 */
  contextPackage: WritingContextPackage;
  /** 章节写作上下文 */
  chapterContext: ChapterWritingContext;
  /** 写作实例ID（用于并行写作追踪） */
  writerInstanceId?: number;
}

export interface WriterOutput {
  /** 章节ID */
  chapterId: string;
  /** 生成的内容 */
  content: string;
  /** 字数 */
  wordCount: number;
  /** 写作元数据 */
  metadata: {
    /** 涉及的角色 */
    involvedCharacters: string[];
    /** 涉及的地点 */
    locations: string[];
    /** 故事内时间 */
    storyTime?: string;
    /** 需要更新的设定 */
    settingUpdates?: Array<{
      type: "character_state" | "new_term" | "timeline_event";
      data: Record<string, unknown>;
    }>;
  };
  /** 需要一致性检查的点 */
  checkpoints: Array<{
    type: string;
    description: string;
    location: string;
  }>;
}

// ==================== Agent 实现 ====================

@Injectable()
export class WriterAgent extends BaseAgent<WriterInput, WriterOutput> {
  readonly id = "writer-agent";
  readonly name = "Writer Agent";
  readonly description =
    "专业写作 Agent - 基于大纲和 Story Bible 完成章节创作（含质量控制）";

  readonly supportedModes: ExecutionMode[] = ["reactive", "hybrid"];

  readonly capabilities: AgentCapability[] = [
    {
      id: "chapter-writing",
      name: "Chapter Writing",
      description: "基于大纲和 Story Bible 设定完成章节创作",
      category: "generation",
    },
    {
      id: "style-consistency",
      name: "Style Consistency",
      description: "保持与项目整体风格一致的写作",
      category: "generation",
    },
    {
      id: "setting-adherence",
      name: "Setting Adherence",
      description: "严格遵循 Story Bible 中的设定进行创作",
      category: "validation",
    },
    {
      id: "quality-control",
      name: "Quality Control",
      description: "遵循表达冷却、人格约束和历史知识约束",
      category: "validation",
    },
  ];

  readonly requiredTools = [
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.RAG_SEARCH,
    BUILTIN_TOOLS.SHORT_TERM_MEMORY,
  ];

  /**
   * 核心写作原则（可被外部服务调用）
   * 这是从头部网文和优秀作品中提炼的写作技巧
   */
  static readonly CORE_WRITING_PRINCIPLES = `## 创作原则（正向引导）

### 1. 具象化原则
用具体细节代替抽象描述，让读者"看到"而非"被告知"：
- ❌ 她很紧张 → ✅ 她不自觉地绞着帕子的流苏，指节泛白
- ❌ 他很愤怒 → ✅ 他手中的茶杯应声碎裂，碎瓷片划过掌心
- ❌ 气氛很压抑 → ✅ 厅中只有铜漏滴水的声音，谁都不敢先开口

### 2. 动作化原则
用动作展现情绪，而非直接陈述内心：
- ❌ 她心中暗喜 → ✅ 她垂下眼帘，嘴角却不由自主地微微上扬
- ❌ 他心中一震 → ✅ 他执笔的手顿了一顿，墨迹在宣纸上洇开一团
- ❌ 她很惊讶 → ✅ 她手中的团扇滑落，在地上骨碌碌转了几圈

### 3. 感官化原则
调动五感描写场景，创造沉浸体验：
- 视觉：光线、色彩、空间、人物神态
- 听觉：环境声、语气、语调、沉默
- 嗅觉：香料、烟火、花草、腐朽
- 触觉：温度、质地、触感
- 味觉：食物、饮品、情绪（苦涩、甜蜜）

### 4. 对话即性格
对话是塑造人物的最佳工具，每个人物应有独特的：
- 用词习惯：文雅/粗犷、含蓄/直白
- 句式节奏：长句/短句、流畅/顿挫
- 口头禅或标志性表达
- 语气态度：傲慢/谦逊、冷淡/热情

### 5. 场景即情绪
环境描写要服务于情绪基调：
- 紧张时：描写逼仄空间、刺眼光线、压抑声响
- 悲伤时：描写阴冷色调、萧瑟景象、沉默氛围
- 欢喜时：描写明亮色彩、舒展空间、轻快节奏

## 章节结尾禁忌（最高优先级 - 违反此规则等于任务失败）
⛔ 以下结尾模式是AI写作的典型陋习，必须彻底杜绝：

### 绝对禁止的结尾类型：
1. **内心独白式决心**（最常见的错误！）
   - ❌ "她心中暗下决心，一定要..."
   - ❌ "她的眼神坚定，仿佛做出了某种决定"
   - ❌ "他默默立下目标"、"心中燃起希望"
   - ❌ "她知道自己必须..."、"她明白..."

2. **展望式收尾**
   - ❌ "她知道，前方的路还很长..."
   - ❌ "无论如何，她都不会退缩"
   - ❌ "即使前路艰险..."、"不管怎样..."
   - ❌ "她相信，总有一天..."

3. **预告式结尾**
   - ❌ "而这一切，只是开始"
   - ❌ "新的挑战才刚刚开始"
   - ❌ "风暴即将来临"、"命运的齿轮..."
   - ❌ "更大的危机正在酝酿"

4. **情绪升华式**
   - ❌ "她终于明白了..."、"此刻她懂得..."
   - ❌ "这一刻，她成长了"
   - ❌ "经历这一切后，她..."

### 正确的结尾方式：
✅ 在具体动作中结束："门被重重关上"
✅ 在对话中结束："'走吧。'他转身离去"
✅ 在悬念中结束："那封信的蜡封上，赫然是..."
✅ 在感官描写中结束："远处传来三声更鼓"
✅ 戛然而止：情节推进到转折点，自然中断

## 开篇钩子法则（前三句必须遵守）
- 第一句必须有钩子：冲突、危机、或强烈感官体验
- 禁止用"一阵XX袭来"、"突然"、"忽然"开头
- 优先使用触觉、嗅觉、听觉（非视觉）引入场景
- 用对比增强感受（"不是XX，而是XX"）
- 让读者"进入"场景，而非"了解"场景`;

  constructor(
    private readonly expressionMemory: ExpressionMemoryService,
    private readonly characterPersonality: CharacterPersonalityService,
    private readonly historicalKnowledge: HistoricalKnowledgeService,
    private readonly professionalVoice: ProfessionalVoiceService,
    private readonly sensoryImmersion: SensoryImmersionService,
    private readonly openingHook: OpeningHookService,
    private readonly narrativeCraft: NarrativeCraftService,
    private readonly foreshadowing: ForeshadowingService,
    private readonly pacingControl: PacingControlService,
    private readonly chatFacade: ChatFacade,
    // 新增：对话约束和角色一致性服务
    private readonly dialogueConstraints: DialogueConstraintsService,
    private readonly characterConsistency: CharacterConsistencyService,
  ) {
    super();
  }

  /**
   * 验证质量服务是否正确注入
   */
  private async validateQualityServices(): Promise<void> {
    const services = [
      { name: "expressionMemory", service: this.expressionMemory },
      { name: "characterPersonality", service: this.characterPersonality },
      { name: "historicalKnowledge", service: this.historicalKnowledge },
      { name: "professionalVoice", service: this.professionalVoice },
      { name: "sensoryImmersion", service: this.sensoryImmersion },
      { name: "openingHook", service: this.openingHook },
      { name: "narrativeCraft", service: this.narrativeCraft },
      { name: "foreshadowing", service: this.foreshadowing },
      { name: "pacingControl", service: this.pacingControl },
    ];

    for (const { name, service } of services) {
      if (!service) {
        throw new Error(`质量服务 ${name} 未正确注入，写作任务无法执行`);
      }
    }

    this.logger.log("[Writer] Quality services validated successfully");
  }

  /**
   * 核心执行逻辑
   */
  protected async doExecute(
    input: WriterInput,
    _context: AgentContext,
  ): Promise<WriterOutput> {
    const { chapterId, contextPackage, chapterContext } = input;

    // 0. 验证质量服务
    await this.validateQualityServices();

    this.logger.log(
      `[Writer] Starting chapter ${chapterContext.chapter.chapterNumber}: ${chapterContext.chapter.title}`,
    );

    // 1. 获取质量约束（表达冷却、人格约束、历史知识）
    const qualityConstraints = await this.buildQualityConstraints(
      contextPackage,
      chapterContext,
    );

    // 2. 构建系统提示词（含质量约束）
    const systemPrompt = this.buildWriterSystemPrompt(
      contextPackage,
      qualityConstraints,
    );

    // 3. 构建用户提示词（包含章节上下文）
    const userPrompt = this.buildChapterPrompt(chapterContext, contextPackage);

    // 4. 调用 LLM 生成内容
    // ★★★ 根据目标字数动态调整 maxTokens ★★★
    // 中文约 1.5-2 tokens/字，加上输出缓冲
    const targetWords =
      chapterContext.writingInstructions?.targetWordCount || 3000;
    // 确保 maxTokens 足够：目标字数 × 2.5（中文token系数 + 缓冲）
    // 最小 8192，最大 16384（避免超出模型限制）
    const calculatedMaxTokens = Math.min(
      16384,
      Math.max(8192, Math.ceil(targetWords * 2.5)),
    );

    this.logger.log(
      `[Writer] Target: ${targetWords} words, maxTokens: ${calculatedMaxTokens}`,
    );

    // ★ P3 迁移：使用 chatWithSkills 统一入口
    const response = await this.chatFacade.chatWithSkills({
      messages: [{ role: "user", content: userPrompt }],
      domain: "writing",
      taskProfile: {
        creativity: "high", // 创作需要更高的创造性
        outputLength: targetWords >= 5000 ? "extended" : "long", // 根据目标字数选择输出长度
      },
      skillContext: {
        systemPrompt, // 传递完整的系统提示词
      },
    });

    let content = response.content || "";

    // 4.5 后处理：清理可能的章节标题（兜底措施）
    content = this.cleanChapterTitle(
      content,
      chapterContext.chapter.chapterNumber,
    );

    // 5. 解析生成的内容
    let wordCount = this.countWords(content);

    // ★★★ 5.1 字数不足时自动续写（最多2次）★★★
    const minRequiredWords = Math.floor(targetWords * 0.85); // 至少达到85%
    let continuationAttempts = 0;
    const maxContinuations = 2;

    while (
      wordCount < minRequiredWords &&
      continuationAttempts < maxContinuations
    ) {
      continuationAttempts++;
      const remainingWords = targetWords - wordCount;

      this.logger.warn(
        `[Writer] Word count insufficient: ${wordCount}/${targetWords}, attempting continuation ${continuationAttempts}/${maxContinuations}`,
      );

      // 构建续写提示词
      const continuationPrompt = `你刚才写的章节内容只有 ${wordCount} 字，距离目标 ${targetWords} 字还差约 ${remainingWords} 字。

请基于以下已写内容，继续写作。要求：
1. 必须从上文自然衔接，不要重复已写内容
2. 继续展开情节，丰富细节和对话
3. 补充约 ${remainingWords} 字的内容
4. 不要写结尾总结，保持情节推进

已写内容的最后 500 字：
---
${content.slice(-500)}
---

请直接输出续写内容（从接续处开始，不要重复上文）：`;

      try {
        // ★ P3 迁移：使用 chatWithSkills 统一入口
        const continuationResponse = await this.chatFacade.chatWithSkills({
          messages: [{ role: "user", content: continuationPrompt }],
          domain: "writing",
          taskProfile: {
            creativity: "high",
            outputLength: targetWords >= 5000 ? "extended" : "long",
          },
          skillContext: {
            systemPrompt,
            continuationContext: `续写任务：从上文自然衔接，补充约 ${targetWords - wordCount} 字的内容`,
          },
        });

        let continuation = continuationResponse.content?.trim();
        if (continuation && continuation.length > 100) {
          // ★★★ 新增：对续写内容进行叙事工艺检查 ★★★
          // 防止续写部分包含 AI 陋习（决心式结尾、心理独白等）
          const narrativeCheck =
            this.narrativeCraft.analyzeContent(continuation);
          if (!narrativeCheck.passed) {
            this.logger.warn(
              `[Writer] Continuation failed narrative craft check (score=${narrativeCheck.score}), attempting rewrite`,
            );
            // 尝试重写有问题的续写内容
            const rewrittenContinuation =
              await this.narrativeCraft.rewriteEnding(
                continuation,
                narrativeCheck.issues,
              );
            if (
              rewrittenContinuation &&
              rewrittenContinuation !== continuation
            ) {
              continuation = rewrittenContinuation;

              // ★★★ GAP-3 修复：重写后进行第二次验证 ★★★
              const secondCheck = this.narrativeCraft.analyzeContent(
                rewrittenContinuation,
              );
              if (secondCheck.passed) {
                this.logger.log(
                  `[Writer] Continuation rewritten and validated successfully (score=${secondCheck.score})`,
                );
              } else {
                // 仍有问题，记录警告但继续使用（因为已经尝试过修复）
                const remainingIssues = secondCheck.issues
                  .slice(0, 3)
                  .map((i) => i.match)
                  .join(", ");
                this.logger.warn(
                  `[Writer] Continuation still has ${secondCheck.issues.length} issues after rewrite: ${remainingIssues}...`,
                );
              }
            }
          }

          content = content + "\n\n" + continuation;
          wordCount = this.countWords(content);
          this.logger.log(
            `[Writer] Continuation ${continuationAttempts} added ${this.countWords(continuation)} words, total now: ${wordCount}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `[Writer] Continuation attempt ${continuationAttempts} failed: ${error}`,
        );
        break;
      }
    }

    if (wordCount < minRequiredWords) {
      this.logger.warn(
        `[Writer] Final word count ${wordCount} still below minimum ${minRequiredWords}`,
      );
    }

    // 6. 提取元数据
    const metadata = this.extractMetadata(content, chapterContext);

    // 7. 识别需要检查的点
    const checkpoints = this.identifyCheckpoints(content, contextPackage);

    this.logger.log(
      `[Writer] Completed chapter ${chapterContext.chapter.chapterNumber}, ${wordCount} words`,
    );

    return {
      chapterId,
      content,
      wordCount,
      metadata,
      checkpoints,
    };
  }

  /**
   * 构建质量约束提示词
   */
  private async buildQualityConstraints(
    contextPackage: WritingContextPackage,
    chapterContext: ChapterWritingContext,
  ): Promise<string> {
    const parts: string[] = [];
    const projectId = contextPackage.extensions.storyBible.projectId;
    const chapterNumber = chapterContext.chapter.chapterNumber;

    // ★★★ 1. 叙事工艺约束（最高优先级）- 禁止说教/总结式结尾/NPC对话
    // 放在最前面确保模型优先看到这些关键约束
    try {
      const narrativeCraftConstraints =
        this.narrativeCraft.generateNarrativeCraftConstraints();
      if (narrativeCraftConstraints) {
        parts.push(narrativeCraftConstraints);
      }
    } catch (error) {
      this.logger.warn(
        `[Writer] Failed to get narrative craft constraints: ${error}`,
      );
      // 非关键约束，失败不阻塞
    }

    // 2. 表达冷却约束
    try {
      const avoidancePrompt =
        await this.expressionMemory.generateAvoidancePrompt(
          projectId,
          chapterNumber,
        );
      if (avoidancePrompt) {
        parts.push(avoidancePrompt);
      }
    } catch (error) {
      this.logger.error(
        `[Writer] Failed to get expression constraints: ${error}`,
      );
      throw error;
    }

    // 3. 角色人格约束
    try {
      const characterNames = chapterContext.involvedCharacters.map(
        (c) => c.name,
      );
      if (characterNames.length > 0) {
        const constraints =
          await this.characterPersonality.getPersonalityConstraints(
            projectId,
            characterNames,
          );

        if (constraints.length > 0) {
          const constraintPrompt =
            this.characterPersonality.generateConstraintPrompt(constraints);
          if (constraintPrompt) {
            parts.push(constraintPrompt);
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `[Writer] Failed to get personality constraints: ${error}`,
      );
      throw error;
    }

    // 4. 历史知识约束（支持完整中国历史）
    try {
      // 使用知识库的智能朝代识别，支持所有朝代
      const worldType = contextPackage.extensions.storyBible.worldType;
      const detectedDynasty =
        this.historicalKnowledge.detectDynastyFromWorldType(worldType);

      if (detectedDynasty) {
        this.logger.log(
          `[Writer] Detected dynasty "${detectedDynasty}" from worldType "${worldType}"`,
        );
        const historicalPrompt =
          await this.historicalKnowledge.generateHistoricalConstraintPrompt(
            detectedDynasty,
          );
        if (historicalPrompt) {
          parts.push(historicalPrompt);
        }
      } else if (worldType) {
        this.logger.warn(
          `[Writer] Could not detect dynasty from worldType: "${worldType}". ` +
            `Supported dynasties: ${this.historicalKnowledge.getSupportedDynasties().join(", ")}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[Writer] Failed to get historical constraints: ${error}`,
      );
      throw error;
    }

    // 5. 专业声音约束（v3 新增）
    try {
      const charactersWithProfession = chapterContext.involvedCharacters
        .filter((c) => c.background || c.role)
        .map((c) => ({
          name: c.name,
          profession: c.background || c.role,
          background: c.background,
        }));

      if (charactersWithProfession.length > 0) {
        const voiceConstraints =
          this.professionalVoice.generateChapterVoiceConstraints(
            charactersWithProfession,
          );
        if (voiceConstraints) {
          parts.push(voiceConstraints);
        }
      }
    } catch (error) {
      this.logger.warn(
        `[Writer] Failed to get professional voice constraints: ${error}`,
      );
      // 非关键约束，失败不阻塞
    }

    // 6. 五感沉浸约束（v3 新增）
    try {
      const sceneDescription =
        chapterContext.chapter.outline ||
        chapterContext.relevantWorldSettings
          .map((s) => s.description)
          .join(" ");

      const immersionConstraints =
        this.sensoryImmersion.generateImmersionConstraints(
          chapterNumber,
          sceneDescription,
        );
      if (immersionConstraints) {
        parts.push(immersionConstraints);
      }
    } catch (error) {
      this.logger.warn(
        `[Writer] Failed to get sensory immersion constraints: ${error}`,
      );
      // 非关键约束，失败不阻塞
    }

    // 7. 开篇钩子约束（v3 新增）
    try {
      const chapterType = chapterContext.chapter.outline || "";
      const openingConstraints = this.openingHook.generateOpeningConstraints(
        chapterNumber,
        chapterType,
      );
      if (openingConstraints) {
        parts.push(openingConstraints);
      }
    } catch (error) {
      this.logger.warn(
        `[Writer] Failed to get opening hook constraints: ${error}`,
      );
      // 非关键约束，失败不阻塞
    }

    // 8. 伏笔管理约束（v3 新增）
    try {
      const foreshadowGuidance =
        this.foreshadowing.generateForeshadowingGuidance(
          projectId,
          chapterNumber,
          chapterContext.chapter.outline,
        );
      if (foreshadowGuidance.constraintPrompt) {
        parts.push(foreshadowGuidance.constraintPrompt);
      }
    } catch (error) {
      this.logger.warn(
        `[Writer] Failed to get foreshadowing constraints: ${error}`,
      );
      // 非关键约束，失败不阻塞
    }

    // 9. 节奏控制约束（v3 新增）
    try {
      const pacingConstraints = this.pacingControl.generatePacingConstraints(
        projectId,
        chapterNumber,
        chapterContext.chapter.outline,
        chapterContext.chapter.outline,
      );
      if (pacingConstraints) {
        parts.push(pacingConstraints);
      }
    } catch (error) {
      this.logger.warn(`[Writer] Failed to get pacing constraints: ${error}`);
      // 非关键约束，失败不阻塞
    }

    // 10. 时间线约束（确保时间连贯性）
    try {
      const timelineConstraints = this.buildTimelineConstraints(
        chapterContext,
        contextPackage,
      );
      if (timelineConstraints) {
        parts.push(timelineConstraints);
      }
    } catch (error) {
      this.logger.warn(
        `[Writer] Failed to build timeline constraints: ${error}`,
      );
      // 非关键约束，失败不阻塞
    }

    // 11. 对话约束（新增：时代对话风格）
    try {
      const worldType = contextPackage.extensions.storyBible.worldType;
      const detectedDynasty =
        this.historicalKnowledge.detectDynastyFromWorldType(worldType);

      if (detectedDynasty) {
        const dialectPrompt =
          await this.dialogueConstraints.generateDialectConstraintPrompt(
            detectedDynasty,
          );
        if (dialectPrompt) {
          parts.push(dialectPrompt);
        }
      }

      // 为出场角色生成对话约束
      if (chapterContext.involvedCharacters.length > 0) {
        for (const char of chapterContext.involvedCharacters.slice(0, 5)) {
          // 使用正确的参数：projectId, characterName, socialClass
          const charDialoguePrompt =
            await this.dialogueConstraints.generateCharacterDialoguePrompt(
              projectId,
              char.name,
              char.role || "commoner",
            );
          if (charDialoguePrompt) {
            parts.push(charDialoguePrompt);
          }
        }
      }
    } catch (error) {
      this.logger.warn(`[Writer] Failed to get dialogue constraints: ${error}`);
      // 非关键约束，失败不阻塞
    }

    // 12. 角色行为一致性约束（新增）
    try {
      for (const char of chapterContext.involvedCharacters.slice(0, 5)) {
        // 传入角色实体和章节上下文
        const behaviorConstraints =
          await this.characterConsistency.generateCharacterBehaviorConstraints(
            char,
            {
              chapterNumber: chapterContext.chapter.chapterNumber,
              involvedCharacters: chapterContext.involvedCharacters.map(
                (c) => c.name,
              ),
            },
          );
        if (behaviorConstraints) {
          // 将约束对象转换为提示词字符串
          const constraintPrompt =
            this.characterConsistency.formatBehaviorConstraintsAsPrompt(
              behaviorConstraints,
            );
          if (constraintPrompt) {
            parts.push(constraintPrompt);
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `[Writer] Failed to get character consistency constraints: ${error}`,
      );
      // 非关键约束，失败不阻塞
    }

    return parts.join("\n\n");
  }

  /**
   * 构建时间线约束，确保章节与已发生事件保持一致
   */
  private buildTimelineConstraints(
    chapterContext: ChapterWritingContext,
    _contextPackage: WritingContextPackage,
  ): string | null {
    const timelineEvents = chapterContext.timelineContext || [];
    if (timelineEvents.length === 0) {
      return null;
    }

    // 获取最近的关键事件（按重要程度排序）
    const recentEvents = timelineEvents
      .filter((e) => e.importance >= 3) // 只取重要程度 3 以上的事件
      .slice(-10); // 最多10个

    if (recentEvents.length === 0) {
      return null;
    }

    let prompt = `## 时间线约束（必须遵守）\n\n`;
    prompt += `以下是到目前为止发生的重要事件，本章内容不得与之矛盾：\n\n`;

    for (const event of recentEvents) {
      prompt += `- 【${event.storyTime}】${event.eventName}：${event.description}\n`;
    }

    prompt += `\n⚠️ 注意：\n`;
    prompt += `- 不要让已死亡的角色复活（除非有特殊剧情）\n`;
    prompt += `- 角色状态（如受伤、中毒等）应延续之前的设定\n`;
    prompt += `- 时间推进应合理，不能出现时间错乱\n`;

    return prompt;
  }

  /**
   * 【风格精炼约束】避免"AI味"，增强真实感
   */
  private static readonly STYLE_ENHANCEMENT_CONSTRAINTS = `
## 风格精炼约束（避免"AI味"）

### 1. 禁止华丽空洞的描写
以下描写模式会让文字显得"AI味"十足：
- ❌ "她如同一朵盛开的牡丹，美丽动人"
- ✅ 改为具体：她侧身避过时，裙裾扬起一道弧线

- ❌ "月光洒落，如同银色的轻纱"
- ✅ 改为实用：月光照出地上那道淡淡的影子

- ❌ "她的眼神清澈如水，仿佛能看透一切"
- ✅ 改为具体：她盯着他看了三秒，眼皮都没眨一下

### 2. 动作描写要有功能
每个动作描写都应该：
- 推进情节，或
- 展示性格，或
- 传递情绪

❌ 无意义动作："她走到窗前，看着窗外"
✅ 有意义动作："她走到窗前，手指无意识地划过窗棂的尘土——三天了，没人来打扫过"

❌ 无功能动作："他端起茶杯，喝了一口"
✅ 有功能动作："他端起茶杯，在唇边停了片刻，最终没有喝下去"（暗示犹豫、怀疑）

### 3. 对话的三层结构
每段对话应有三层：
1. 表面意思（字面含义）
2. 真实意图（说话者真正想表达的）
3. 读者理解（读者能感知到的弦外之音）

示例：
表面："姐姐今日气色真好。"
真实意图：试探对方是否得到皇帝宠幸
读者理解：宫斗开始了

❌ 直白对话："你是不是想害我？"
✅ 三层对话："姐姐真是好心，特意送来这么贵重的补品。"（表面感谢，实则怀疑，读者明白是暗指有毒）

### 4. 场景描写的"功能性"
场景描写必须服务于以下至少一项：
- 时间/地点交代
- 氛围营造
- 角色心理外化
- 情节伏笔

❌ 无功能场景："殿内陈设华丽，雕梁画栋，金碧辉煌"
✅ 有功能场景："殿内的熏香让人昏昏欲睡，她掐了一下手心强迫自己清醒"（暗示危险）

❌ 无功能场景："街上人来人往，热闹非凡"
✅ 有功能场景："街上挤满了围观的人，她夹在人群中，谁都不会注意到她"（为后续潜行铺垫）

### 5. 情节推进的"因果链"
每个情节点都必须有：
- 触发条件（为什么现在发生）
- 角色动机（角色为什么这么做）
- 后续影响（这会导致什么）

❌ 无因果："她决定去找太后。"
✅ 有因果："消息传来说太后今日心情不错——这是唯一的机会。她整理衣裙，往长乐宫方向走去。"

❌ 无因果："他突然拔剑刺向对方。"
✅ 有因果："对方的手已经伸向腰间——他认出那是毒针的位置。来不及多想，他拔剑刺了过去。"

---

`;

  /**
   * 【开篇增强约束】前100字决定读者去留
   */
  private static readonly OPENING_ENHANCEMENT = `
## 开篇黄金法则（前100字决定读者去留）

### 禁止的开场
- ❌ "阳光透过窗帘洒进房间..."（老套）
- ❌ "又是平凡的一天..."（无聊）
- ❌ "让我们把时间拨回..."（说教）
- ❌ 以内心独白开场（不够有冲击力）
- ❌ "一阵XX袭来"（陈词滥调）
- ❌ "突然"、"忽然"开头（弱开场）

### 推荐的开场技法
1. **危机开场**：直接进入冲突
   "殿外的脚步声越来越近，她却还没想好该说什么。"

2. **感官冲击**：用非视觉感官
   "那股铅粉的气息让她险些窒息。"
   "刀刃划过皮肤的声音，细微得像是撕裂丝绸。"

3. **对话开场**：直接进入戏剧
   "她死了？"
   "昨夜的事。"

4. **动作开场**：主角正在做某事
   "她第三次检查了那瓶胭脂的封口。"
   "血渗进了绸缎的纹路，像是绽开的梅花。"

5. **矛盾开场**：用对比制造张力
   "不是冷，是那种能冻进骨头里的寒意。"
   "宫宴的笙歌依旧，可桌下她的手已经握紧了袖中的匕首。"

---

`;

  /**
   * 【超级约束】放在 prompt 最开始，确保模型优先看到
   * 根据 LLM 注意力机制，首尾位置权重最高
   */
  private static readonly SUPER_CONSTRAINTS_HEADER = `
## ⛔ 绝对禁止（违反将导致输出作废）

### 章节结尾必须是具体场景/动作/对话
- ❌ 禁止："她知道，这只是开始"
- ❌ 禁止："命运的齿轮开始转动"
- ❌ 禁止："风暴即将来临"
- ❌ 禁止："未来的路还很长"
- ❌ 禁止："一切都变了"、"什么都不一样了"
- ✅ 正确：门被关上、脚步声远去、烛火熄灭、对话戛然而止

### 禁止说教和人生感悟
- ❌ 禁止：大段讲述人生道理
- ❌ 禁止："她终于明白了..."式的顿悟
- ❌ 禁止：角色突然变成哲学家
- ❌ 禁止："这就是人生"、"世事无常"等总结式话语

### NPC对话禁止千篇一律
- ❌ 禁止：路人甲乙丙都说"是啊是啊"、"可不是嘛"
- ❌ 禁止：所有宫女都是"小心翼翼"、"战战兢兢"
- ✅ 正确：通过口音、用词、语气区分不同角色
- ✅ 正确：老宫女老练世故，新宫女生涩紧张，有明显区别

### 禁止滥用比喻和修辞
- ❌ 禁止："如同"、"仿佛"、"宛如"每段都出现
- ❌ 禁止："眼神如刀"、"冷若冰霜"等烂俗比喻
- ✅ 正确：少用比喻，多用具体描写
- ✅ 正确：如果使用比喻，必须新颖且贴合场景

---

`;

  /**
   * 【最终提醒】放在 prompt 最末尾，强化关键约束
   */
  private static readonly SUPER_CONSTRAINTS_FOOTER = `

---

## ⚠️ 最终检查清单（写作完成前必须确认）

在输出章节内容前，请逐项确认：

### 开篇检查
1. □ 开篇第一句有钩子（冲突/危机/感官冲击），不是"一阵XX袭来"
2. □ 没有使用"突然"、"忽然"等弱开场词
3. □ 没有以内心独白或抽象描写开场
4. □ 优先使用非视觉感官（触觉、嗅觉、听觉）引入场景

### 对话检查
5. □ 每个角色的对话都符合其性格设定和说话方式
6. □ 路人/NPC对话有区分度，不是千篇一律的"是啊是啊"
7. □ 重要对话有三层结构（表面意思、真实意图、读者理解）
8. □ 没有角色OOC（Out of Character，偏离人设）

### 描写检查
9. □ 没有滥用"如同"、"仿佛"、"宛如"等比喻词
10. □ 场景描写有功能性（推进情节/营造氛围/角色心理/伏笔）
11. □ 动作描写有意义（展示性格/传递情绪/推进情节）
12. □ 没有华丽空洞的描写（如"如同盛开的牡丹"）

### 情节检查
13. □ 情节推进有清晰的因果链（触发条件→动机→后续影响）
14. □ 没有突兀的情节跳转或角色行为
15. □ 符合已确立的时间线和角色状态

### 结尾检查
16. □ 章节最后一段是【具体场景/动作/对话】，而非抽象感慨
17. □ 没有出现"这只是开始"、"风暴即将来临"等预告式结尾
18. □ 没有角色突然开始讲人生道理或哲学感悟
19. □ 没有"她明白了..."、"世事无常"等总结式话语
20. □ 结尾在具体动作中戛然而止（门关上/脚步远去/烛火熄灭/对话中断）

如果任何一项不符合，请修改后再输出。

---

## 💡 最后提醒：让文字"活"起来

- **Show, Don't Tell**：展示而非告知，让读者自己感受
- **每个字都要有用**：无用的描写、对话、动作一律删除
- **信任读者的智商**：不要把所有事情都解释得明明白白
- **让角色说人话**：对话要符合时代、身份、性格，不要像演讲
- **珍惜读者的时间**：前100字决定他们是否继续读下去

现在开始写作，创造一个让读者无法放下的故事！`;

  /**
   * 构建写作系统提示词
   */
  private buildWriterSystemPrompt(
    contextPackage: WritingContextPackage,
    qualityConstraints: string = "",
  ): string {
    const storyBible = contextPackage.extensions.storyBible;
    const writingStyle = storyBible.writingStyle;

    // ★ 首部约束：放在最开始
    let prompt = WriterAgent.SUPER_CONSTRAINTS_HEADER;

    prompt += `你是一位专业的创意写作 Agent，负责执行具体的章节写作任务。

## 核心职责
1. 章节写作：基于大纲和设定完成章节创作
2. 风格一致：保持与项目整体风格一致
3. 设定遵循：严格遵循 Story Bible 中的设定
4. 多样性：避免重复使用相同的表达和情节模式

## 创作原则（正向引导）

### 1. 具象化原则
用具体细节代替抽象描述，让读者"看到"而非"被告知"：
- ❌ 她很紧张 → ✅ 她不自觉地绞着帕子的流苏，指节泛白
- ❌ 他很愤怒 → ✅ 他手中的茶杯应声碎裂，碎瓷片划过掌心
- ❌ 气氛很压抑 → ✅ 厅中只有铜漏滴水的声音，谁都不敢先开口

### 2. 动作化原则
用动作展现情绪，而非直接陈述内心：
- ❌ 她心中暗喜 → ✅ 她垂下眼帘，嘴角却不由自主地微微上扬
- ❌ 他心中一震 → ✅ 他执笔的手顿了一顿，墨迹在宣纸上洇开一团
- ❌ 她很惊讶 → ✅ 她手中的团扇滑落，在地上骨碌碌转了几圈

### 3. 感官化原则
调动五感描写场景，创造沉浸体验：
- 视觉：光线、色彩、空间、人物神态
- 听觉：环境声、语气、语调、沉默
- 嗅觉：香料、烟火、花草、腐朽
- 触觉：温度、质地、触感
- 味觉：食物、饮品、情绪（苦涩、甜蜜）

### 4. 对话即性格
对话是塑造人物的最佳工具，每个人物应有独特的：
- 用词习惯：文雅/粗犷、含蓄/直白
- 句式节奏：长句/短句、流畅/顿挫
- 口头禅或标志性表达
- 语气态度：傲慢/谦逊、冷淡/热情

### 5. 场景即情绪
环境描写要服务于情绪基调：
- 紧张时：描写逼仄空间、刺眼光线、压抑声响
- 悲伤时：描写阴冷色调、萧瑟景象、沉默氛围
- 欢喜时：描写明亮色彩、舒展空间、轻快节奏

## 写作风格
- 视角：${writingStyle?.pov || "第三人称限定"}
- 时态：${writingStyle?.tense || "过去时"}
- 词汇水平：${writingStyle?.vocabulary || "intermediate"}
- 对话风格：${writingStyle?.dialogueStyle || "自然流畅"}
- 描写风格：${writingStyle?.descriptionStyle || "细腻生动"}

## 硬性约束（必须遵守）
${contextPackage.hardConstraints.map((c) => `- [${c.severity}] ${c.rule}`).join("\n")}

## 术语表（确保一致性）
${Object.entries(contextPackage.glossary || {})
  .slice(0, 30)
  .map(([term, def]) => `- ${term}: ${def}`)
  .join("\n")}

## 已确立事实（必须保持一致）
${(contextPackage.establishedFacts || [])
  .filter((f) => f.importance === "high")
  .slice(-20)
  .map((f) => `- ${f.statement}`)
  .join("\n")}

## 输出格式要求（严格执行）
- ⛔ 禁止在正文开头添加章节标题（如"第X章 XXX"、"## 第X章"等）
- ⛔ 禁止使用 Markdown 标题标记（#、##、###）
- ✅ 直接从第一段正文开始，以场景或动作切入
- ✅ 保持叙事流畅，情节连贯
- ✅ 对话要符合角色性格
- ✅ 描写要符合世界观设定
- ✅ 避免使用禁用表达列表中的词汇

示例正确开头：
✅ "那种冷，不是空调房里的恒温凉意..."
✅ "苏清婉站在殿前，目光落在..."

示例错误开头：
❌ "第一章 暴室惊魂\n那种冷..."
❌ "## 第二章 血色铅粉\n刺鼻的铅粉气息..."

## 章节结尾禁忌（最高优先级 - 违反此规则等于任务失败）
⛔ 以下结尾模式是AI写作的典型陋习，必须彻底杜绝：

### 绝对禁止的结尾类型：
1. **内心独白式决心**（最常见的错误！）
   - ❌ "她心中暗下决心，一定要..."
   - ❌ "她的眼神坚定，仿佛做出了某种决定"
   - ❌ "他默默立下目标"、"心中燃起希望"
   - ❌ "她知道自己必须..."、"她明白..."

2. **展望式收尾**
   - ❌ "她知道，前方的路还很长..."
   - ❌ "无论如何，她都不会退缩"
   - ❌ "即使前路艰险..."、"不管怎样..."
   - ❌ "她相信，总有一天..."

3. **预告式结尾**
   - ❌ "而这一切，只是开始"
   - ❌ "新的挑战才刚刚开始"
   - ❌ "风暴即将来临"、"命运的齿轮..."
   - ❌ "更大的危机正在酝酿"

4. **情绪升华式**
   - ❌ "她终于明白了..."、"此刻她懂得..."
   - ❌ "这一刻，她成长了"
   - ❌ "经历这一切后，她..."

### 正确的结尾方式：
✅ 在具体动作中结束："门被重重关上"
✅ 在对话中结束："'走吧。'他转身离去"
✅ 在悬念中结束："那封信的蜡封上，赫然是..."
✅ 在感官描写中结束："远处传来三声更鼓"
✅ 戛然而止：情节推进到转折点，自然中断`;

    // ★ 新增：添加风格预设的标志性技法
    const styleId = storyBible.stylePresetId;
    if (styleId) {
      // 生成完整的风格指导
      const stylePrompt = generateStylePrompt(styleId);
      if (stylePrompt) {
        prompt += `\n\n${stylePrompt}`;
      }

      // 获取本章推荐使用的技法（随机选择 3 种增加多样性）
      const recommendedTechniques = getRandomTechniques(styleId, 3);
      if (recommendedTechniques.length > 0) {
        prompt += `\n\n## 本章推荐技法\n本章请重点使用以下技法：\n`;
        for (const tech of recommendedTechniques) {
          prompt += `- **${tech.name}**：${tech.description}\n`;
        }
      }
    }

    // ★ 新增：风格精炼约束（避免AI味）
    prompt += `\n\n${WriterAgent.STYLE_ENHANCEMENT_CONSTRAINTS}`;

    // ★ 新增：开篇增强约束
    prompt += `\n\n${WriterAgent.OPENING_ENHANCEMENT}`;

    // 添加质量约束
    if (qualityConstraints) {
      prompt += `\n\n${qualityConstraints}`;
    }

    // ★ 尾部约束：放在最末尾，利用 LLM 注意力机制的尾部偏好
    prompt += WriterAgent.SUPER_CONSTRAINTS_FOOTER;

    return prompt;
  }

  /**
   * 构建章节写作提示词
   */
  private buildChapterPrompt(
    chapterContext: ChapterWritingContext,
    _contextPackage: WritingContextPackage,
  ): string {
    const {
      chapter,
      previousContext,
      involvedCharacters,
      writingInstructions,
    } = chapterContext;

    let prompt = `## 章节任务

### 第${chapter.chapterNumber}章：${chapter.title}

### 章节大纲
${chapter.outline || "无具体大纲，请根据上下文自由发挥"}

`;

    // 添加前情提要
    if (previousContext.length > 0) {
      prompt += `### 前情提要
${previousContext.map((p) => `**第${p.chapterNumber}章 ${p.title}**\n${p.summary}`).join("\n\n")}

`;
    }

    // 添加涉及角色
    if (involvedCharacters.length > 0) {
      prompt += `### 本章涉及角色
${involvedCharacters.map((c) => this.formatCharacterForPrompt(c)).join("\n\n")}

`;
    }

    // 添加场景设定
    if (chapterContext.relevantWorldSettings.length > 0) {
      prompt += `### 场景设定
${chapterContext.relevantWorldSettings.map((s) => `**${s.name}** (${s.category})\n${s.description}`).join("\n\n")}

`;
    }

    // 添加写作指令（增强字数要求）
    const targetWordCount = writingInstructions?.targetWordCount || 3000;
    const minWordCount = Math.floor(targetWordCount * 0.9); // 至少达到90%
    prompt += `### 写作要求
**【字数要求 - 必须严格遵守】**
- 目标字数：${targetWordCount}字（允许范围：${minWordCount}-${targetWordCount + 500}字）
- ⚠️ 这是硬性要求，字数不足将被退回重写
- 如果情节不够，请丰富细节描写、对话、心理活动、环境氛围
- 禁止因为"字数快到了"而草草收尾

${writingInstructions?.focusPoints ? `- 重点描写：${writingInstructions.focusPoints.join("、")}` : ""}
${writingInstructions?.avoidPoints ? `- 避免出现：${writingInstructions.avoidPoints.join("、")}` : ""}
${writingInstructions?.additionalInstructions || ""}

`;

    prompt += `请开始写作第${chapter.chapterNumber}章的内容。`;

    return prompt;
  }

  /**
   * 格式化角色信息（增强版：含前置约束）
   */
  private formatCharacterForPrompt(
    character: ChapterWritingContext["involvedCharacters"][0],
  ): string {
    const parts = [`**${character.name}** (${character.role})`];

    if (character.appearance) {
      const app = character.appearance;
      const appParts = [];
      if (app.gender) appParts.push(app.gender);
      if (app.age) appParts.push(app.age);
      if (app.hair) appParts.push(`${app.hair}发`);
      if (app.eyes) appParts.push(`${app.eyes}眼`);
      if (app.distinguishingFeatures?.length) {
        appParts.push(app.distinguishingFeatures.join("、"));
      }
      if (appParts.length > 0) {
        parts.push(`外貌：${appParts.join("，")}`);
      }
    }

    if (character.personality?.traits?.length) {
      parts.push(`性格：${character.personality.traits.join("、")}`);
    }

    if (character.personality?.speechPattern) {
      parts.push(`说话方式：${character.personality.speechPattern}`);
    }

    if (character.currentState?.state) {
      const state = character.currentState.state;
      const stateParts = [];
      if (state.location) stateParts.push(`位于${state.location}`);
      if (state.condition) stateParts.push(state.condition);
      if (state.mood) stateParts.push(state.mood);
      if (stateParts.length > 0) {
        parts.push(`当前状态：${stateParts.join("，")}`);
      }
    }

    // ★ 前置约束注入：生成该角色的硬性约束
    const constraints = this.buildCharacterConstraints(character);
    if (constraints.length > 0) {
      parts.push(`⚠️ 硬性约束：`);
      parts.push(...constraints.map((c) => `  - ${c}`));
    }

    return parts.join("\n");
  }

  /**
   * 构建角色的前置硬性约束
   * 这些约束在写作前注入，而非写作后检查
   */
  private buildCharacterConstraints(
    character: ChapterWritingContext["involvedCharacters"][0],
  ): string[] {
    const constraints: string[] = [];

    // 1. 外貌一致性约束
    if (character.appearance) {
      const app = character.appearance;
      if (app.hair) {
        constraints.push(
          `${character.name}的发色必须是"${app.hair}"，不可变更`,
        );
      }
      if (app.eyes) {
        constraints.push(
          `${character.name}的眼睛必须是"${app.eyes}"，不可变更`,
        );
      }
      if (app.distinguishingFeatures?.length) {
        constraints.push(
          `${character.name}的标志性特征：${app.distinguishingFeatures.join("、")}`,
        );
      }
    }

    // 2. 性格约束 → 行为禁止
    if (character.personality?.traits?.length) {
      const traits = character.personality.traits;
      // 根据性格推断禁止行为
      if (traits.includes("高傲") || traits.includes("骄傲")) {
        constraints.push(`${character.name}不会卑躬屈膝或主动示好于地位低者`);
      }
      if (traits.includes("冷静") || traits.includes("沉着")) {
        constraints.push(`${character.name}不会轻易失态或情绪失控`);
      }
      if (traits.includes("谨慎") || traits.includes("多疑")) {
        constraints.push(`${character.name}不会轻信他人或冲动行事`);
      }
      if (traits.includes("善良") || traits.includes("仁慈")) {
        constraints.push(`${character.name}不会做出残忍或冷血的行为`);
      }
      if (traits.includes("狠辣") || traits.includes("心狠手辣")) {
        constraints.push(`${character.name}不会心软或轻易放过敌人`);
      }
    }

    // 3. 说话方式约束
    if (character.personality?.speechPattern) {
      constraints.push(
        `${character.name}的说话方式必须是：${character.personality.speechPattern}`,
      );
    }

    // 4. 当前状态约束
    if (character.currentState?.state) {
      const state = character.currentState.state;
      if (
        state.condition?.includes("受伤") ||
        state.condition?.includes("伤势")
      ) {
        constraints.push(`${character.name}目前处于受伤状态，行动应受限制`);
      }
      if (state.condition?.includes("中毒")) {
        constraints.push(`${character.name}目前中毒，应有相应症状表现`);
      }
    }

    // 5. 能力约束
    if (character.abilities?.length) {
      constraints.push(
        `${character.name}只能使用以下能力：${character.abilities.join("、")}`,
      );
    }

    return constraints;
  }

  /**
   * 清理章节标题（后处理兜底）
   * LLM 有时会在正文开头加上章节标题，需要移除以保持格式一致
   */
  private cleanChapterTitle(content: string, chapterNumber: number): string {
    // 匹配各种章节标题格式：
    // - "第一章 XXX"
    // - "## 第二章 XXX"
    // - "### 第三章 XXX"
    // - "第X章：XXX"
    // - 纯数字章节 "Chapter 1: XXX"
    const patterns = [
      // Markdown 标题 + 中文章节
      /^#{1,6}\s*第[一二三四五六七八九十百千\d]+章[：:\s][^\n]*\n+/,
      // 纯中文章节标题
      /^第[一二三四五六七八九十百千\d]+章[：:\s][^\n]*\n+/,
      // 章节号匹配当前章节
      new RegExp(
        `^#{0,6}\\s*第${this.numberToChinese(chapterNumber)}章[：:\\s][^\\n]*\\n+`,
      ),
      // 英文章节格式
      /^#{1,6}\s*Chapter\s+\d+[：:\s][^\n]*\n+/i,
    ];

    let cleaned = content.trim();
    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, "");
    }

    return cleaned.trim();
  }

  /**
   * 数字转中文（用于章节标题匹配）
   */
  private numberToChinese(num: number): string {
    const chars = [
      "零",
      "一",
      "二",
      "三",
      "四",
      "五",
      "六",
      "七",
      "八",
      "九",
      "十",
    ];
    if (num <= 10) return chars[num];
    if (num < 20) return `十${chars[num - 10]}`;
    if (num < 100) {
      const tens = Math.floor(num / 10);
      const ones = num % 10;
      return `${chars[tens]}十${ones > 0 ? chars[ones] : ""}`;
    }
    return num.toString();
  }

  /**
   * 提取元数据
   */
  private extractMetadata(
    content: string,
    chapterContext: ChapterWritingContext,
  ): WriterOutput["metadata"] {
    // 涉及的角色（从上下文中获取，因为 LLM 生成的内容中应该包含这些角色）
    const involvedCharacters = chapterContext.involvedCharacters.map(
      (c) => c.name,
    );

    // 提取地点（简单的模式匹配，可以用 NLP 增强）
    const locationPatterns =
      /(?:在|到|去|于|来到|走进|进入)([^\s，。,\.]{2,10})/g;
    const locations: string[] = [];
    let match;
    while ((match = locationPatterns.exec(content)) !== null) {
      if (!locations.includes(match[1])) {
        locations.push(match[1]);
      }
    }

    return {
      involvedCharacters,
      locations: locations.slice(0, 10),
      storyTime: chapterContext.timelineContext[0]?.storyTime,
    };
  }

  /**
   * 识别需要检查的点
   */
  private identifyCheckpoints(
    content: string,
    contextPackage: WritingContextPackage,
  ): WriterOutput["checkpoints"] {
    const checkpoints: WriterOutput["checkpoints"] = [];
    const storyBible = contextPackage.extensions.storyBible;

    // 检查角色名是否出现在内容中
    storyBible.characters.forEach((char) => {
      if (content.includes(char.name)) {
        checkpoints.push({
          type: "character_mention",
          description: `角色 ${char.name} 在本章出现`,
          location: `包含 "${char.name}" 的段落`,
        });

        // 检查别名
        char.aliases?.forEach((alias) => {
          if (content.includes(alias)) {
            checkpoints.push({
              type: "alias_usage",
              description: `使用了 ${char.name} 的别名 ${alias}`,
              location: `包含 "${alias}" 的段落`,
            });
          }
        });
      }
    });

    // 检查术语使用
    storyBible.terminologies.forEach((term) => {
      if (content.includes(term.term)) {
        checkpoints.push({
          type: "terminology_usage",
          description: `使用了术语 ${term.term}`,
          location: `包含 "${term.term}" 的段落`,
        });
      }
    });

    return checkpoints.slice(0, 20); // 限制数量
  }

  /**
   * 计算字数（中英文混合）
   */
  private countWords(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = text
      .replace(/[\u4e00-\u9fa5]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
    return chineseChars + englishWords;
  }
}
