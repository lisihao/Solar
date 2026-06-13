/**
 * Slides Engine v4.0 - Content Compression Skill
 *
 * 内容压缩技能：将长文本压缩为适合幻灯片展示的简洁内容
 * 实现 AI Engine ISkill 接口，注册到 SkillRegistry
 */

import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  Optional,
} from "@nestjs/common";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
  ChatMessage,
} from "@/modules/ai-harness/facade";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import {
  PageOutline,
  PageContent,
  ContentSection,
  StatContent,
  ChartContent,
} from "../checkpoint/checkpoint.types";
import { DataSupplementSkill } from "./data-supplement.skill";
import {
  ContentAnalyzerSkill,
  ContentAnalysisResult,
} from "./content-analyzer.skill";

/**
 * 重试上下文 - 用于传递之前的审核反馈
 */
export interface RetryContext {
  /** 当前尝试次数 */
  attempt: number;
  /** 上一次的审核反馈 */
  feedback?: string;
  /** 改进建议 */
  suggestions?: string[];
  /** 各维度评分 */
  dimensions?: Array<{
    name: string;
    score: number;
    comment?: string;
  }>;
  /** 使用的策略变体 */
  strategy?: "default" | "detailed" | "creative" | "conservative";
}

/**
 * 内容压缩输入
 */
export interface ContentCompressionInput {
  /** 页面大纲 */
  pageOutline: PageOutline;
  /** 源文本内容 */
  sourceText: string;
  /** 最大字数限制 */
  maxCharacters?: number;
  /** 会话 ID */
  sessionId?: string;
  /** 重试上下文 - 包含之前的审核反馈 */
  retryContext?: RetryContext;
}

/**
 * MissionOrchestrator 输入格式
 */
export interface ContentCompressionOrchestratorInput {
  task?: string;
  context?: {
    input?: {
      pageOutline?: PageOutline;
      sourceText?: string;
      maxCharacters?: number;
      sessionId?: string;
      retryContext?: RetryContext;
    };
    [key: string]: unknown;
  };
  previousOutputs?: Record<string, unknown>;
}

/**
 * 内容压缩结果
 */
export interface ContentCompressionResult {
  /** 压缩后的页面内容 */
  pageContent: PageContent;
  /** 原始字数 */
  originalLength: number;
  /** 压缩后字数 */
  compressedLength: number;
  /** 压缩比 */
  compressionRatio: number;
}

/**
 * 内容压缩系统提示词 - 优化版：强调内容丰富度和数据驱动
 */
const CONTENT_COMPRESSION_SYSTEM_PROMPT = `你是一位顶级的 PPT 内容策划师，擅长创建信息密度高、视觉层次丰富的专业幻灯片内容。

## 核心原则

1. **信息密度优先**：每页必须包含充实的内容，避免空洞稀疏
2. **数据驱动**：主动挖掘源文本中的数据、百分比、数字，无数据时合理推断
3. **多层次结构**：每页至少 3 个内容区块，形成视觉层次
4. **可视化思维**：优先使用 stat 和 chart 类型展示数据
5. **专业表达**：使用行业术语，保持权威性和专业性

## 特殊页面类型处理

### 封面页 (cover) - 极简设计原则
**封面页是演示文稿的门面，必须简洁、大气、有冲击力！**

⚠️ **封面页禁止包含**：
- ❌ 数据卡片 (stat sections)
- ❌ 列表要点 (list sections)
- ❌ 图表 (chart sections)
- ❌ 长段落文字

✅ **封面页只需包含**：
- **主标题**：简洁有力，一句话概括演示主题（10-20字）
- **副标题**：补充说明或定位语（10-30字）
- **sections 必须为空数组 []**
- **footer**：演讲者、日期、机构（可选）

封面页输出示例：
\`\`\`json
{
  "title": "渥太华KANATA",
  "subtitle": "加拿大硅谷的崛起与未来",
  "sections": [],
  "footer": "2024年度分析报告 | DeepDive Research"
}
\`\`\`

### 目录页 (toc)
必须清晰列出所有章节，包含页码范围

## 输出要求

### 必须包含（强制）
- 每页 3-5 个 sections
- 至少 1 个 stat 类型（关键数据）
- 标题要有冲击力和信息量
- 脚注包含数据来源

### 内容密度标准
- 内容总字数：300-500 字
- 列表项：每个 list 至少 4-6 个要点
- 数据点：每页至少 2-3 个具体数字

## 输出格式

\`\`\`json
{
  "title": "有冲击力的主标题（带数据更佳）",
  "subtitle": "补充说明或数据佐证",
  "sections": [
    {
      "type": "stat",
      "position": "left",
      "content": {
        "value": "86%",
        "label": "关键指标名称",
        "trend": "up",
        "change": "+12% YoY"
      }
    },
    {
      "type": "list",
      "position": "right",
      "content": [
        "核心要点1：具体数据或事实支撑",
        "核心要点2：具体数据或事实支撑",
        "核心要点3：具体数据或事实支撑",
        "核心要点4：具体数据或事实支撑"
      ]
    },
    {
      "type": "chart",
      "position": "center",
      "content": {
        "type": "bar",
        "title": "图表标题",
        "data": [
          {"name": "类别A", "value": 85},
          {"name": "类别B", "value": 72},
          {"name": "类别C", "value": 63},
          {"name": "类别D", "value": 45}
        ]
      }
    },
    {
      "type": "text",
      "position": "full",
      "content": "总结性陈述或关键洞察，用一两句话概括核心价值或行动建议"
    }
  ],
  "footer": "数据来源：来源名称 | 更新时间",
  "citations": ["引用来源1", "引用来源2"]
}
\`\`\`

## Section 类型详解

### stat（优先使用）
突出关键指标，必须包含：
- value: 核心数字（带单位）
- label: 指标名称
- trend: up/down/neutral
- change: 变化幅度

### list（内容要充实）
每个列表至少 4-6 项，每项：
- 20-40 字
- 包含具体数据或事实
- 使用平行结构

### chart（数据可视化）⚠️ 图表类型选择规则（必须遵守！）

**选择正确的图表类型至关重要，错误的图表类型会导致数据误导！**

| 数据特性 | 正确图表类型 | 错误图表类型 |
|---------|-------------|-------------|
| **分类对比**（如：市区人口、首都圈人口、城市面积）| **bar** (柱状图) | ❌ line |
| **时间趋势**（如：2020年、2021年、2022年的数据变化）| **line** (折线图) | ❌ bar, pie |
| **占比构成**（如：各部门占比、市场份额）| **pie** (饼图) | ❌ line, bar |
| **多维评分**（如：能力雷达图、满意度评估）| **radar** (雷达图) | ❌ 其他 |

⚠️ **常见错误**：
- ❌ 用折线图展示"市区人口 vs 首都圈人口 vs 城市面积"（这是分类数据，应该用柱状图！）
- ❌ 用柱状图展示 2020-2024 年的变化趋势（这是时间序列，应该用折线图！）

要求：
- 至少 3-6 个数据点
- 数据值必须合理真实
- X轴标签必须有逻辑意义

### text（简洁有力）
- 用于总结、引言或过渡
- 每段 50-100 字

## 内容策略

1. **开头页**：用震撼数据抓住注意力
2. **论述页**：多用 list + stat 组合
3. **数据页**：chart + stat 为主
4. **总结页**：核心数字 + 行动建议

## 数据挖掘技巧

如果源文本缺少具体数据：
1. 根据行业常识推断合理数据
2. 使用相对比例代替绝对数字
3. 添加"预估"、"约"等修饰词

## ⚠️ 数据缺失处理（重要！）

**当源文本中确实没有可用数据时，必须使用占位符：**
- 文本缺失：使用 \`[内容缺失]\` 作为占位符
- 数字缺失：使用 \`[--]\` 作为占位符

**示例：**
\`\`\`json
{
  "type": "stat",
  "content": {
    "value": "[--]",
    "label": "市场规模"
  }
}
\`\`\`

**为什么要使用占位符？**
- 系统会自动调用**搜索工具**查找真实数据填补占位符
- 使用占位符比编造虚假数据更专业
- **严禁使用通用填充内容替代缺失数据**（如"核心能力"、"关键优势"等空洞词汇）

## ✅ 内容生成方法论（必须严格遵守！）

### Step 1: 识别源文本核心主题
在生成任何内容前，先识别：
- **核心主题关键词**：源文本主要讲什么？
- **主要实体**：涉及哪些公司、产品、地区、人物？
- **核心观点**：源文本想表达的主要信息

### Step 2: 确保内容相关性
生成的每一项内容必须：
- 直接引用或复述源文本中的信息
- 使用源文本中的专有名词和术语
- 数据和事实必须来自源文本（或基于源文本合理推断）

### Step 3: 验证输出合规性
在输出前，检查每个 section：
- ✅ 是否包含源文本的核心关键词？
- ✅ 是否在源文本中有对应的内容来源？
- ❌ 是否包含与源文本无关的通用商务话术？

## ⛔ 严禁事项（违反将导致任务失败！）

**绝对禁止生成以下类型的内容：**
1. 关于"设计风格"、"商务简约"、"视觉设计"的内容
2. 关于"PPT制作方法"、"幻灯片设计技巧"的内容
3. 任何自我描述性内容（如"本演示文稿采用XX风格"）
4. 与源文本主题完全无关的通用商务套话

**示例（假设源文本主题是"渥太华KANATA"）：**
- ✅ 正确：["KANATA位于渥太华西部", "科技企业总数超过600家", "就业人口约10万"]
- ❌ 错误：["商务简约设计", "专业视觉呈现", "高效信息传达"]`;

@Injectable()
export class ContentCompressionSkill implements ISkill<
  ContentCompressionInput,
  ContentCompressionResult
> {
  private readonly logger = new Logger(ContentCompressionSkill.name);

  // ISkill 接口必需属性
  readonly id = "slides-content-compression";
  readonly name = "内容压缩";
  readonly description = "将长文本压缩为适合幻灯片展示的简洁内容";
  readonly layer: SkillLayer = SKILL_LAYERS.CONTENT;
  readonly domain = "slides";
  readonly tags = ["slides", "content", "compression", "writing"];
  readonly version = "4.0.0";

  constructor(
    @Optional() private readonly chatFacade: ChatFacade,
    @Inject(forwardRef(() => DataSupplementSkill))
    private readonly dataSupplementSkill: DataSupplementSkill,
    @Inject(forwardRef(() => ContentAnalyzerSkill))
    private readonly contentAnalyzer: ContentAnalyzerSkill,
  ) {}

  /**
   * 将 MissionOrchestrator 输入格式转换为直接输入格式
   */
  private normalizeInput(
    input: ContentCompressionInput | ContentCompressionOrchestratorInput,
  ): ContentCompressionInput | null {
    // 如果已经是直接格式，直接返回
    if ("pageOutline" in input && "sourceText" in input) {
      return input;
    }

    // 尝试从 orchestrator 格式提取
    const orchestratorInput = input;
    const contextInput = orchestratorInput.context?.input;

    if (!contextInput?.pageOutline || !contextInput?.sourceText) {
      this.logger.warn(
        "[normalizeInput] Missing required fields in orchestrator input: " +
          `pageOutline=${!!contextInput?.pageOutline}, ` +
          `sourceText=${!!contextInput?.sourceText}`,
      );
      return null;
    }

    return {
      pageOutline: contextInput.pageOutline,
      sourceText: contextInput.sourceText,
      maxCharacters: contextInput.maxCharacters,
      sessionId: contextInput.sessionId,
      retryContext: contextInput.retryContext,
    };
  }

  /**
   * 执行内容压缩 (ISkill 接口实现)
   */
  async execute(
    input: ContentCompressionInput | ContentCompressionOrchestratorInput,
    context: SkillContext,
  ): Promise<SkillResult<ContentCompressionResult>> {
    const startTime = new Date();

    // Normalize input from orchestrator format if needed
    const normalizedInput = this.normalizeInput(input);
    if (!normalizedInput) {
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message:
            "Failed to normalize input: missing required fields (pageOutline, sourceText)",
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }

    const { pageOutline, sourceText, sessionId } = normalizedInput;
    const maxChars = normalizedInput.maxCharacters ?? 500;

    this.logger.log(
      `[execute] Compressing content for page ${pageOutline.pageNumber}, source length: ${sourceText.length}, max: ${maxChars}, executionId: ${context.executionId}`,
    );

    try {
      // Ensure maxCharacters is set for buildUserMessage
      const inputWithDefaults = { ...normalizedInput, maxCharacters: maxChars };
      const userMessage = this.buildUserMessage(inputWithDefaults);

      // ★ 使用 ChatFacade 统一入口
      if (!this.chatFacade) {
        throw new Error(
          "AIFacade not available. Please check module configuration.",
        );
      }

      const messages: ChatMessage[] = [
        { role: "system", content: CONTENT_COMPRESSION_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ];

      const response = await this.chatFacade.chat({
        messages,
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "medium", // 内容压缩需要平衡准确性和创意
          outputLength: "medium",
        },
      });

      if (!response?.content) {
        throw new Error("Empty response from LLM");
      }

      let pageContent = this.parseResponse(response.content, pageOutline);

      // v3.6: 数据补全 - 检测缺失数据并使用搜索工具补充
      const shouldSupplement = this.shouldSupplementData(pageOutline);
      if (shouldSupplement) {
        try {
          const supplementResult = await this.dataSupplementSkill.execute(
            {
              pageContent,
              topic: pageOutline.title,
              sourceText,
              sessionId,
            },
            context,
          );

          if (
            supplementResult.success &&
            supplementResult.data?.wasSupplemented
          ) {
            this.logger.log(
              `[execute] Data supplemented: ${supplementResult.data.supplementedFields.join(", ")}`,
            );
            pageContent = supplementResult.data.pageContent;
          }
        } catch (error) {
          this.logger.warn(`[execute] Data supplement failed: ${error}`);
          // 补全失败不影响主流程
        }
      }

      const compressedLength = this.calculateContentLength(pageContent);
      const endTime = new Date();

      this.logger.log(
        `[execute] Content compressed: ${sourceText.length} -> ${compressedLength} chars (${((compressedLength / sourceText.length) * 100).toFixed(1)}%)`,
      );

      return {
        success: true,
        data: {
          pageContent,
          originalLength: sourceText.length,
          compressedLength,
          compressionRatio: compressedLength / sourceText.length,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
          tokensUsed: response.tokensUsed || 0,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const endTime = new Date();
      this.logger.error(
        `[execute] Content compression failed: ${errorMessage}`,
      );
      return {
        success: false,
        error: {
          code: "CONTENT_COMPRESSION_FAILED",
          message: errorMessage,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    }
  }

  /**
   * 判断是否需要进行数据补全
   * 封面、目录、结尾页不需要补全
   */
  private shouldSupplementData(pageOutline: PageOutline): boolean {
    const skipTypes = ["cover", "toc", "closing", "thankYou"];
    return !skipTypes.includes(pageOutline.templateType);
  }

  /**
   * 批量压缩多页内容
   */
  async executeBatch(
    inputs: ContentCompressionInput[],
    context: SkillContext,
  ): Promise<Map<number, ContentCompressionResult>> {
    const results = new Map<number, ContentCompressionResult>();

    // 并行处理（限制并发数）
    const concurrencyLimit = 3;
    const batches: ContentCompressionInput[][] = [];

    for (let i = 0; i < inputs.length; i += concurrencyLimit) {
      batches.push(inputs.slice(i, i + concurrencyLimit));
    }

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async (input) => {
          try {
            const skillResult = await this.execute(input, context);
            if (skillResult.success && skillResult.data) {
              return {
                pageNumber: input.pageOutline.pageNumber,
                result: skillResult.data,
              };
            }
            return {
              pageNumber: input.pageOutline.pageNumber,
              result: this.createFallbackResult(input),
            };
          } catch (error) {
            this.logger.error(
              `[executeBatch] Failed for page ${input.pageOutline.pageNumber}:`,
              error,
            );
            return {
              pageNumber: input.pageOutline.pageNumber,
              result: this.createFallbackResult(input),
            };
          }
        }),
      );

      for (const { pageNumber, result } of batchResults) {
        results.set(pageNumber, result);
      }
    }

    return results;
  }

  /**
   * 构建用户消息
   */
  private buildUserMessage(input: ContentCompressionInput): string {
    const { pageOutline, maxCharacters, retryContext } = input;

    // Defense-in-depth truncation: sourceText should already be condensed at import time,
    // but guard here in case raw content (100k+) is passed directly.
    const MAX_SOURCE_CHARS = 8000;
    const sourceText =
      input.sourceText.length > MAX_SOURCE_CHARS
        ? input.sourceText.substring(0, MAX_SOURCE_CHARS) + "\n...[内容已截断]"
        : input.sourceText;

    let message = `## 页面信息

### 页码
${pageOutline.pageNumber}

### 页面类型
${pageOutline.templateType}

### 标题
${pageOutline.title}

### 副标题
${pageOutline.subtitle || "无"}

### 内容简述
${pageOutline.contentBrief}

### 关键元素
${pageOutline.keyElements.map((e) => `- ${e}`).join("\n")}

## 源文本内容

${sourceText}

## 要求

1. 将上述内容压缩为适合 PPT 展示的简洁文案
2. 总字数控制在 ${maxCharacters} 字以内
3. 保留所有关键数据和核心观点
4. 输出 JSON 格式的 PageContent`;

    // 如果是重试，添加审核反馈
    if (retryContext && retryContext.attempt > 1) {
      message += `

## ⚠️ 重要：这是第 ${retryContext.attempt} 次尝试

上一次的结果未通过质量审核，必须按照以下反馈进行改进：

### 审核反馈
${retryContext.feedback || "内容质量不达标"}

### 需要改进的维度
${
  retryContext.dimensions
    ?.filter((d) => d.score < 70)
    .map((d) => `- **${d.name}** (${d.score}分): ${d.comment || "需要提升"}`)
    .join("\n") || "- 整体内容丰富度不足"
}

### 改进建议
${retryContext.suggestions?.map((s) => `- ${s}`).join("\n") || "- 增加更多数据点和具体事实\n- 使用 stat 和 chart 类型展示关键指标\n- 确保每页有 3-5 个内容区块"}

### 策略调整
${this.getStrategyGuidance(retryContext.strategy)}

**请务必针对上述问题进行具体改进！不要重复生成相同的低质量内容！**`;
    }

    return message;
  }

  /**
   * 获取策略指导
   */
  private getStrategyGuidance(
    strategy?: "default" | "detailed" | "creative" | "conservative",
  ): string {
    switch (strategy) {
      case "detailed":
        return `使用【详细策略】：
- 每个要点必须有具体数据或事实支撑
- 列表项必须达到 6-8 个
- 增加更多的 stat 类型展示数据
- 内容总字数目标：400-600 字`;
      case "creative":
        return `使用【创意策略】：
- 尝试不同的内容组织方式
- 使用更多可视化元素（chart、stat）
- 从不同角度解读源文本
- 挖掘隐藏的数据和洞察`;
      case "conservative":
        return `使用【稳健策略】：
- 严格遵循模板结构要求
- 优先使用源文本的原始数据
- 确保每个 section 都有实质内容
- 宁可简洁也不要空洞`;
      default:
        return `使用【标准策略】：确保内容完整、数据丰富、结构清晰`;
    }
  }

  /**
   * 解析 AI 响应
   */
  private parseResponse(
    content: string,
    pageOutline: PageOutline,
  ): PageContent {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    try {
      const parsed = JSON.parse(jsonStr);
      return this.normalizePageContent(parsed, pageOutline);
    } catch (error) {
      this.logger.error("[parseResponse] JSON parse error:", error);
      return this.createFallbackContent(pageOutline);
    }
  }

  /**
   * 规范化页面内容
   */
  private normalizePageContent(
    parsed: Record<string, unknown>,
    pageOutline: PageOutline,
  ): PageContent {
    const title = String(parsed.title || pageOutline.title);
    const subtitle = parsed.subtitle
      ? String(parsed.subtitle)
      : pageOutline.subtitle;
    let sections = this.normalizeSections(parsed.sections);

    // 验证 sections 完整性（封面页除外）
    const isCoverPage = pageOutline.templateType === "cover";
    if (!isCoverPage) {
      sections = this.validateAndEnrichSections(
        sections,
        pageOutline,
        title,
        subtitle,
      );
    }

    return {
      title,
      subtitle,
      sections,
      footer: parsed.footer ? String(parsed.footer) : undefined,
      citations: Array.isArray(parsed.citations)
        ? parsed.citations.map(String)
        : undefined,
    };
  }

  /**
   * 检测是否为占位符/通用文本（需要被过滤的内容）
   */
  private isPlaceholderText(text: string): boolean {
    const placeholderPatterns = [
      // 通用占位符
      /^核心能力/,
      /^关键优势/,
      /^核心支柱/,
      /^支柱\s*\d+$/,
      /^要点\s*\d+$/,
      /^章节\s*\d+$/,
      /^详细描述/,
      /^待办事项/,
      /^内容\s*\d+$/,
      // 设计相关占位符
      /商务简约/,
      /设计风格/,
      /视觉设计/,
      /幻灯片设计/,
      /PPT制作/,
      /演示文稿/,
      /专业视觉呈现/,
      /高效信息传达/,
      // 常见无关填充内容
      /^创新驱动$/,
      /^持续创新迭代升级$/,
      /^创新驱动[：:]/,
      /^数字化转型$/,
      /^智能化升级$/,
      /^高效协同$/,
      /^战略布局$/,
      /^生态构建$/,
      /^价值创造$/,
      // 空洞的商务套话
      /^赋能/,
      /^助力/,
      /^打造/,
      /^构建/,
      /^引领/,
      /^深耕/,
    ];

    const trimmed = text.trim();
    return placeholderPatterns.some((pattern) => pattern.test(trimmed));
  }

  /**
   * 验证单个 section 的内容质量
   * 返回 true 表示内容有效
   */
  private isSectionValid(section: ContentSection): boolean {
    if (typeof section.content === "string") {
      const content = section.content.trim();
      // 检查长度和是否为占位符
      if (content.length < 10 || this.isPlaceholderText(content)) {
        return false;
      }
      return true;
    }

    if (Array.isArray(section.content)) {
      // 过滤掉占位符内容
      const validItems = section.content.filter(
        (item) => item.trim().length > 5 && !this.isPlaceholderText(item),
      );
      // 至少需要 2 个有效项
      return validItems.length >= 2;
    }

    if (
      section.type === "stat" &&
      typeof section.content === "object" &&
      "value" in section.content
    ) {
      const stat = section.content as { value: string; label: string };
      // 检查 value 和 label 是否有效
      if (!stat.value || stat.value === "0" || !stat.label) {
        return false;
      }
      // 检查 label 是否为占位符
      if (this.isPlaceholderText(stat.label)) {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * 验证并补充 sections（根因修复：确保非封面页有实际内容）
   */
  private validateAndEnrichSections(
    sections: ContentSection[],
    pageOutline: PageOutline,
    title: string,
    subtitle?: string,
  ): ContentSection[] {
    // 1. 过滤掉无效/占位符 sections
    const validSections = sections.filter((section) =>
      this.isSectionValid(section),
    );

    // 2. 计算有效内容比例
    const validRatio =
      sections.length > 0 ? validSections.length / sections.length : 0;

    // 3. 如果有效比例低于 50%，需要生成补救内容
    if (validSections.length === 0 || validRatio < 0.5) {
      this.logger.warn(
        `[validateAndEnrichSections] Page ${pageOutline.pageNumber} (${pageOutline.templateType}) has low valid ratio: ${(validRatio * 100).toFixed(0)}%, generating fallback content`,
      );

      // 根据模板类型生成合适的补救内容
      return this.generateFallbackSections(pageOutline, title, subtitle);
    }

    // 4. 检查最小 section 数量（使用动态分析）
    const tempContent: PageContent = {
      title,
      subtitle,
      sections: validSections,
    };
    const minSections = this.getMinSectionsForTemplate(
      pageOutline.templateType,
      tempContent,
    );
    if (validSections.length < minSections) {
      this.logger.warn(
        `[validateAndEnrichSections] Page ${pageOutline.pageNumber} has only ${validSections.length} valid sections, minimum is ${minSections}`,
      );
      // 补充缺失的 sections
      const additionalSections = this.generateFallbackSections(
        pageOutline,
        title,
        subtitle,
      );
      return [
        ...validSections,
        ...additionalSections.slice(0, minSections - validSections.length),
      ];
    }

    return validSections;
  }

  /**
   * 获取模板类型需要的最小 section 数量
   * v4.0: 使用内容分析结果动态决定，而非硬编码
   */
  private getMinSectionsForTemplate(
    templateType: string,
    pageContent?: PageContent,
  ): number {
    // 特殊页面类型的硬性要求
    const specialTypes: Record<string, number> = {
      cover: 0,
      toc: 1,
      sectionDivider: 0,
    };

    if (templateType in specialTypes) {
      return specialTypes[templateType];
    }

    // 如果有内容，使用 ContentAnalyzer 动态分析
    if (pageContent) {
      const analysis = this.contentAnalyzer.analyze(pageContent);

      // 根据推荐布局决定最小 sections
      switch (analysis.recommendedLayout) {
        case "comparison-grid":
          return Math.max(2, analysis.comparison.count);
        case "pillar-showcase":
          return Math.max(2, Math.min(analysis.pillars.count, 6));
        case "data-dashboard":
          return Math.max(2, Math.min(analysis.sectionTypes.stat, 4));
        case "timeline-progress":
          return Math.max(2, Math.min(analysis.timeline.nodeCount, 5));
        case "single-focus":
          return 0;
        default:
          return 2;
      }
    }

    // 默认值（无内容时）
    return 2;
  }

  /**
   * 生成补救内容（当 AI 返回空 sections 时使用）
   */
  private generateFallbackSections(
    pageOutline: PageOutline,
    title: string,
    subtitle?: string,
  ): ContentSection[] {
    const keyElements = pageOutline.keyElements || [];
    const templateType = pageOutline.templateType;

    // 根据模板类型生成不同结构的补救内容
    switch (templateType) {
      case "pillars":
      case "comparison":
        // 分栏/对比类型：生成 3 个 stat sections
        return keyElements.slice(0, 3).map((element, index) => ({
          type: "stat" as const,
          position: (["left", "center", "right"] as const)[index % 3],
          content: {
            value: `${(index + 1) * 25}%`,
            label: element.slice(0, 50),
            trend: "up" as const,
          },
        }));

      case "timeline":
      case "evolutionRoadmap":
        // 时间线类型：生成阶段列表
        return [
          {
            type: "list" as const,
            position: "full" as const,
            content: keyElements
              .slice(0, 5)
              .map((e, i) => `阶段${i + 1}: ${e}`),
          },
        ];

      case "riskOpportunity":
        // 风险机遇类型：生成两列
        const half = Math.ceil(keyElements.length / 2);
        return [
          {
            type: "list" as const,
            position: "left" as const,
            content: keyElements.slice(0, half).map((e) => `机遇: ${e}`),
          },
          {
            type: "list" as const,
            position: "right" as const,
            content: keyElements.slice(half).map((e) => `挑战: ${e}`),
          },
        ];

      case "dashboard":
        // 仪表盘类型：生成多个 stat
        return keyElements.slice(0, 4).map((element, index) => ({
          type: "stat" as const,
          position: (["left", "center", "right", "full"] as const)[index % 4],
          content: {
            value: `${85 - index * 10}%`,
            label: element.slice(0, 40),
            trend: (["up", "up", "neutral", "down"] as const)[index % 4],
          },
        }));

      default:
        // 通用类型：生成文本和列表混合
        const sections: ContentSection[] = [];
        if (keyElements.length > 0) {
          sections.push({
            type: "text" as const,
            position: "full" as const,
            content: subtitle || pageOutline.contentBrief || title,
          });
        }
        if (keyElements.length > 1) {
          sections.push({
            type: "list" as const,
            position: "full" as const,
            content: keyElements.slice(0, 5),
          });
        }
        return sections;
    }
  }

  /**
   * 规范化内容区块
   */
  private normalizeSections(raw: unknown): ContentSection[] {
    if (!Array.isArray(raw)) return [];

    return raw.map((section: Record<string, unknown>) => ({
      type: this.validateSectionType(section.type),
      position: this.validatePosition(section.position),
      content: this.normalizeContent(section.content, section.type as string),
    }));
  }

  /**
   * 验证区块类型
   */
  private validateSectionType(type: unknown): ContentSection["type"] {
    const validTypes: ContentSection["type"][] = [
      "text",
      "list",
      "quote",
      "stat",
      "chart",
      "image",
    ];

    if (
      typeof type === "string" &&
      validTypes.includes(type as ContentSection["type"])
    ) {
      return type as ContentSection["type"];
    }

    return "text";
  }

  /**
   * 验证位置
   */
  private validatePosition(position: unknown): ContentSection["position"] {
    const validPositions: ContentSection["position"][] = [
      "left",
      "right",
      "center",
      "full",
    ];

    if (
      typeof position === "string" &&
      validPositions.includes(position as ContentSection["position"])
    ) {
      return position as ContentSection["position"];
    }

    return "left";
  }

  /**
   * 规范化内容
   */
  private normalizeContent(
    content: unknown,
    type: string,
  ): string | string[] | StatContent | ChartContent {
    switch (type) {
      case "list":
        if (Array.isArray(content)) {
          return content.map(String);
        }
        return typeof content === "string" ? [content] : [];

      case "stat":
        if (typeof content === "object" && content !== null) {
          const stat = content as Record<string, unknown>;
          return {
            value: String(stat.value || "0"),
            label: String(stat.label || ""),
            trend: (stat.trend as StatContent["trend"]) || undefined,
            change: stat.change ? String(stat.change) : undefined,
          };
        }
        return { value: "0", label: "" };

      case "chart":
        if (typeof content === "object" && content !== null) {
          const chart = content as Record<string, unknown>;
          return {
            type: (chart.type as ChartContent["type"]) || "bar",
            data: Array.isArray(chart.data)
              ? (chart.data as Record<string, number | string>[])
              : [],
            title: chart.title ? String(chart.title) : undefined,
          };
        }
        return { type: "bar", data: [] };

      default:
        return typeof content === "string" ? content : String(content || "");
    }
  }

  /**
   * 计算内容长度
   */
  private calculateContentLength(pageContent: PageContent): number {
    let length =
      (pageContent.title?.length || 0) + (pageContent.subtitle?.length || 0);

    for (const section of pageContent.sections) {
      if (typeof section.content === "string") {
        length += section.content.length;
      } else if (Array.isArray(section.content)) {
        length += section.content.join("").length;
      } else if ("value" in section.content && "label" in section.content) {
        length += section.content.value.length + section.content.label.length;
      }
    }

    return length;
  }

  /**
   * 创建降级内容
   */
  private createFallbackContent(pageOutline: PageOutline): PageContent {
    return {
      title: pageOutline.title,
      subtitle: pageOutline.subtitle,
      sections: pageOutline.keyElements.map((element, index) => ({
        type: "text" as const,
        position: (index % 2 === 0
          ? "left"
          : "right") as ContentSection["position"],
        content: element,
      })),
    };
  }

  /**
   * 创建降级结果
   */
  private createFallbackResult(
    input: ContentCompressionInput,
  ): ContentCompressionResult {
    const pageContent = this.createFallbackContent(input.pageOutline);
    const compressedLength = this.calculateContentLength(pageContent);

    return {
      pageContent,
      originalLength: input.sourceText.length,
      compressedLength,
      compressionRatio: compressedLength / input.sourceText.length,
    };
  }

  // ============================================================================
  // 溢出检测和内容拆分 (M5: 内容溢出处理)
  // v4.0: 使用 ContentAnalyzer 动态分析，取代硬编码配置
  // ============================================================================

  /**
   * 获取内容容量配置（动态计算）
   * v4.0: 根据内容分析结果动态决定容量，而非硬编码
   */
  private getCapacityFromAnalysis(content: PageContent): {
    maxSections: number;
    maxCharsPerSection: number;
    maxTotalChars: number;
  } {
    const analysis = this.contentAnalyzer.analyze(content);

    // 根据布局类型和视觉复杂度动态决定容量
    let maxSections: number;
    let maxCharsPerSection: number;
    let maxTotalChars: number;

    switch (analysis.recommendedLayout) {
      case "single-focus":
        // 封面/章节页：无内容区块
        maxSections = 0;
        maxCharsPerSection = 0;
        maxTotalChars = 100;
        break;

      case "data-dashboard":
        // 数据仪表盘：多个统计卡片
        maxSections = 6;
        maxCharsPerSection = 80;
        maxTotalChars = 500;
        break;

      case "comparison-grid":
        // 对比网格：根据对比项数量动态调整
        maxSections = Math.min(analysis.comparison.count + 2, 8);
        maxCharsPerSection = 100;
        maxTotalChars = 600;
        break;

      case "pillar-showcase":
        // 支柱展示：根据支柱数量动态调整
        maxSections = Math.min(analysis.pillars.count + 1, 7);
        maxCharsPerSection = 100;
        maxTotalChars = 600;
        break;

      case "timeline-progress":
        // 时间线：根据节点数量调整
        maxSections = Math.min(analysis.timeline.nodeCount, 6);
        maxCharsPerSection = 80;
        maxTotalChars = 500;
        break;

      case "content-flow":
      case "mixed-content":
      default:
        // 通用内容页：根据复杂度调整
        if (analysis.visualComplexity === "simple") {
          maxSections = 4;
          maxCharsPerSection = 150;
          maxTotalChars = 600;
        } else if (analysis.visualComplexity === "moderate") {
          maxSections = 5;
          maxCharsPerSection = 120;
          maxTotalChars = 650;
        } else {
          maxSections = 6;
          maxCharsPerSection = 100;
          maxTotalChars = 700;
        }
        break;
    }

    return { maxSections, maxCharsPerSection, maxTotalChars };
  }

  /**
   * 检测内容是否会溢出
   * v4.0: 使用 ContentAnalyzer 动态分析
   */
  willOverflow(
    content: PageContent,
    _templateType: string,
  ): {
    overflow: boolean;
    reason?: string;
    excessAmount?: number;
    analysis?: ContentAnalysisResult;
  } {
    // 使用 ContentAnalyzer 分析
    const analysis = this.contentAnalyzer.analyze(content);

    // 直接使用分析结果判断
    if (!analysis.estimatedCapacity.fitsOnOnePage) {
      return {
        overflow: true,
        reason:
          analysis.estimatedCapacity.overflowSections > 0
            ? "sections_exceeded"
            : "chars_exceeded",
        excessAmount: analysis.estimatedCapacity.overflowSections,
        analysis,
      };
    }

    // 获取动态容量配置
    const capacity = this.getCapacityFromAnalysis(content);
    const sections = content.sections || [];
    const totalChars = this.calculateContentLength(content);

    // 检查 section 数量
    if (sections.length > capacity.maxSections) {
      return {
        overflow: true,
        reason: "sections_exceeded",
        excessAmount: sections.length - capacity.maxSections,
        analysis,
      };
    }

    // 检查总字符数
    if (totalChars > capacity.maxTotalChars) {
      return {
        overflow: true,
        reason: "chars_exceeded",
        excessAmount: totalChars - capacity.maxTotalChars,
        analysis,
      };
    }

    // 检查单个 section 字符数
    for (const section of sections) {
      const sectionLength = this.getSectionLength(section);
      if (sectionLength > capacity.maxCharsPerSection) {
        return {
          overflow: true,
          reason: "section_too_long",
          excessAmount: sectionLength - capacity.maxCharsPerSection,
          analysis,
        };
      }
    }

    return { overflow: false, analysis };
  }

  /**
   * 获取单个 section 的字符长度
   */
  private getSectionLength(section: ContentSection): number {
    if (typeof section.content === "string") {
      return section.content.length;
    }
    if (Array.isArray(section.content)) {
      return section.content.join("").length;
    }
    if ("value" in section.content && "label" in section.content) {
      return (
        (section.content.value?.length || 0) +
        (section.content.label?.length || 0)
      );
    }
    return 0;
  }

  /**
   * 压缩单个 section 的内容
   */
  compressSection(
    section: ContentSection,
    targetLength: number,
  ): ContentSection {
    if (typeof section.content === "string") {
      if (section.content.length > targetLength) {
        return {
          ...section,
          content: section.content.slice(0, targetLength - 3) + "...",
        };
      }
    } else if (Array.isArray(section.content)) {
      const compressed: string[] = [];
      let remaining = targetLength;
      for (const item of section.content) {
        if (remaining <= 0) break;
        if (item.length <= remaining) {
          compressed.push(item);
          remaining -= item.length;
        } else {
          compressed.push(item.slice(0, remaining - 3) + "...");
          break;
        }
      }
      return { ...section, content: compressed };
    }
    return section;
  }

  /**
   * 自动压缩内容以适应模板
   * v4.0: 使用 ContentAnalyzer 动态决定容量
   */
  autoCompress(content: PageContent, _templateType: string): PageContent {
    // 使用动态容量配置
    const capacity = this.getCapacityFromAnalysis(content);
    let sections = [...(content.sections || [])];

    // 1. 裁剪超出的 sections
    if (sections.length > capacity.maxSections) {
      sections = sections.slice(0, capacity.maxSections);
      this.logger.log(
        `[autoCompress] Trimmed sections from ${content.sections?.length} to ${capacity.maxSections}`,
      );
    }

    // 2. 压缩过长的 sections
    sections = sections.map((section) => {
      const length = this.getSectionLength(section);
      if (length > capacity.maxCharsPerSection) {
        return this.compressSection(section, capacity.maxCharsPerSection);
      }
      return section;
    });

    // 3. 压缩标题/副标题
    let title = content.title || "";
    let subtitle = content.subtitle || "";
    if (title.length > 50) {
      title = title.slice(0, 47) + "...";
    }
    if (subtitle.length > 80) {
      subtitle = subtitle.slice(0, 77) + "...";
    }

    return {
      ...content,
      title,
      subtitle,
      sections,
    };
  }

  /**
   * 将内容拆分为多页
   * v4.0: 使用 ContentAnalyzer 动态决定拆分策略
   */
  splitIntoPages(
    content: PageContent,
    _templateType: string,
    _pageOutline?: PageOutline,
  ): PageContent[] {
    // 使用 ContentAnalyzer 获取拆分建议
    const splitSuggestion = this.contentAnalyzer.getSplitSuggestion(content);

    if (!splitSuggestion.shouldSplit) {
      return [content];
    }

    const sections = content.sections || [];
    const pages: PageContent[] = [];
    const chunkedSections: ContentSection[][] = [];

    // 按建议的每页 section 数量分组
    const sectionsPerPage = splitSuggestion.sectionsPerPage;
    for (let i = 0; i < sections.length; i += sectionsPerPage) {
      chunkedSections.push(sections.slice(i, i + sectionsPerPage));
    }

    // 创建多个页面
    chunkedSections.forEach((chunk, index) => {
      const isFirst = index === 0;
      pages.push({
        title: isFirst ? content.title : `${content.title} (续${index})`,
        subtitle: isFirst
          ? content.subtitle
          : `第 ${index + 1}/${chunkedSections.length} 部分`,
        sections: chunk,
        footer: content.footer,
      });
    });

    this.logger.log(
      `[splitIntoPages] Split content into ${pages.length} pages (suggested: ${splitSuggestion.suggestedPageCount})`,
    );
    return pages;
  }

  /**
   * 获取内容分析结果
   * v4.0: 公开方法，供外部调用
   */
  analyzeContent(content: PageContent): ContentAnalysisResult {
    return this.contentAnalyzer.analyze(content);
  }
}
