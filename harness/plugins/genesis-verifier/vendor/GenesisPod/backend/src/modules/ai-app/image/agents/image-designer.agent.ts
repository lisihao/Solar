/**
 * Image Designer Agent
 * AI 图像设计师 Agent
 *
 * 使用依赖反转原则,通过接口与 AI Apps 层解耦
 * - IImageGenerationService: 图像生成服务抽象接口
 */

import { Injectable, Logger, Optional, Inject } from "@nestjs/common";

interface StepArtifact {
  id: string;
  type: string;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
  metadata?: Record<string, unknown>;
}
import { PlanBasedAgent } from "@/modules/ai-harness/facade";
import { IMAGE_DESIGNER_AGENT_ID } from "../image.constants";
import {
  BUILTIN_TOOLS,
  type AgentInput,
  type AgentPlan,
  type AgentEvent,
  type AgentTemplate,
  type ToolId,
  type PlanStep,
  type IImageGenerationService,
  IMAGE_GENERATION_SERVICE_TOKEN,
} from "@/modules/ai-harness/facade";

/**
 * 信息图表风格 (从原 InfographicService 复制)
 */
export type InfographicStyle = "consulting" | "tech" | "business" | "creative";

/**
 * 信息图表布局 (从原 InfographicService 复制)
 */
export type TemplateLayout = "cards" | "timeline" | "grid" | "flow";

/**
 * 图像任务类型
 */
export enum ImageTaskType {
  INFOGRAPHIC = "infographic", // 信息图表
  PURE_IMAGE = "pure_image", // 纯图像生成
  PROMPT_ENHANCE = "prompt_enhance", // Prompt 增强
  STYLE_TRANSFER = "style_transfer", // 风格转换
  BRAND_DESIGN = "brand_design", // 品牌设计
}

/**
 * 图像风格
 */
export type ImageStyle =
  | "realistic"
  | "illustration"
  | "anime"
  | "cartoon"
  | "digital_art"
  | "watercolor"
  | "oil_painting"
  | "3d_render"
  | "minimal"
  | "tech";

@Injectable()
export class ImageDesignerAgent extends PlanBasedAgent {
  private readonly logger = new Logger(ImageDesignerAgent.name);

  readonly id = IMAGE_DESIGNER_AGENT_ID;
  readonly name = "AI Image Designer";
  readonly description = "智能图像设计师,生成高质量图像和信息图表";
  readonly capabilities = [
    "信息图表生成",
    "Prompt 增强优化",
    "多风格图像生成",
    "图像编辑处理",
    "品牌套件设计",
    "批量图像生成",
  ];
  readonly requiredTools: ToolId[] = [
    BUILTIN_TOOLS.IMAGE_GENERATION,
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.TEMPLATE_RENDER,
    BUILTIN_TOOLS.EXPORT_IMAGE,
    BUILTIN_TOOLS.DATA_FETCH,
  ];

  protected templates: AgentTemplate[] = [
    {
      id: "infographic-consulting",
      name: "咨询风格信息图",
      description: "McKinsey/BCG 风格的专业信息图表",
      category: "infographic",
      icon: "📊",
      defaultPrompt: "生成关于[主题]的咨询风格信息图",
      defaultOptions: {
        taskType: ImageTaskType.INFOGRAPHIC,
        style: "consulting" as InfographicStyle,
        layout: "cards" as TemplateLayout,
      },
    },
    {
      id: "infographic-tech",
      name: "科技风格信息图",
      description: "现代科技感的信息图表",
      category: "infographic",
      icon: "💻",
      defaultPrompt: "生成关于[技术主题]的科技风格信息图",
      defaultOptions: {
        taskType: ImageTaskType.INFOGRAPHIC,
        style: "tech" as InfographicStyle,
        layout: "cards" as TemplateLayout,
      },
    },
    {
      id: "infographic-timeline",
      name: "时间线信息图",
      description: "时间线/流程布局的信息图表",
      category: "infographic",
      icon: "📅",
      defaultPrompt: "生成[项目/历程]的时间线信息图",
      defaultOptions: {
        taskType: ImageTaskType.INFOGRAPHIC,
        style: "business" as InfographicStyle,
        layout: "timeline" as TemplateLayout,
      },
    },
    {
      id: "pure-image-realistic",
      name: "写实风格图像",
      description: "逼真的写实风格图像",
      category: "image",
      icon: "📷",
      defaultPrompt: "生成[描述]的写实图像",
      defaultOptions: {
        taskType: ImageTaskType.PURE_IMAGE,
        style: "realistic" as ImageStyle,
      },
    },
    {
      id: "pure-image-illustration",
      name: "插画风格图像",
      description: "精美的插画风格图像",
      category: "image",
      icon: "🎨",
      defaultPrompt: "生成[描述]的插画",
      defaultOptions: {
        taskType: ImageTaskType.PURE_IMAGE,
        style: "illustration" as ImageStyle,
      },
    },
    {
      id: "prompt-enhance",
      name: "Prompt 优化",
      description: "优化图像生成 Prompt",
      category: "tool",
      icon: "✨",
      defaultPrompt: "优化以下 Prompt: [原始描述]",
      defaultOptions: {
        taskType: ImageTaskType.PROMPT_ENHANCE,
      },
    },
    {
      id: "brand-kit",
      name: "品牌视觉套件",
      description: "生成品牌视觉设计套件",
      category: "brand",
      icon: "🏷️",
      defaultPrompt: "为[品牌名]设计视觉套件",
      defaultOptions: {
        taskType: ImageTaskType.BRAND_DESIGN,
      },
    },
  ];

  protected selectionKeywords: string[] = [
    "图像",
    "图片",
    "信息图",
    "infographic",
    "设计",
    "海报",
    "logo",
    "banner",
    "品牌",
    "视觉",
    "image",
  ];

  constructor(
    @Optional()
    @Inject(IMAGE_GENERATION_SERVICE_TOKEN)
    private readonly imageService?: IImageGenerationService,
  ) {
    super();
    // 服务是可选的,如果未提供则 Agent 功能会降级
    void this.imageService;
  }

  /**
   * 分析用户输入,生成执行计划
   */
  async plan(input: AgentInput): Promise<AgentPlan> {
    this.logger.log(
      `[plan] Planning image design for: ${input.prompt?.slice(0, 100)}...`,
    );

    const taskId = this.generateTaskId();
    const taskType = this.classifyTask(input.prompt || "", input.options);
    const steps: PlanStep[] = [];

    // Step 1: 需求分析
    steps.push({
      id: this.generateStepId(),
      name: "需求分析",
      description: "分析图像生成需求",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [],
      estimatedDuration: 3000,
    });

    // 根据任务类型添加不同步骤
    switch (taskType) {
      case ImageTaskType.INFOGRAPHIC:
        steps.push(
          {
            id: this.generateStepId(),
            name: "内容提取",
            description: "提取信息图表内容结构",
            toolId: BUILTIN_TOOLS.TEXT_GENERATION,
            dependencies: [steps[0].id],
            estimatedDuration: 5000,
          },
          {
            id: this.generateStepId(),
            name: "模板渲染",
            description: "渲染信息图表模板",
            toolId: BUILTIN_TOOLS.TEMPLATE_RENDER,
            dependencies: [steps[1].id],
            estimatedDuration: 8000,
          },
          {
            id: this.generateStepId(),
            name: "图像导出",
            description: "导出信息图表图像",
            toolId: BUILTIN_TOOLS.EXPORT_IMAGE,
            dependencies: [steps[2].id],
            estimatedDuration: 5000,
          },
        );
        break;

      case ImageTaskType.PURE_IMAGE:
        steps.push(
          {
            id: this.generateStepId(),
            name: "Prompt 优化",
            description: "优化图像生成 Prompt",
            toolId: BUILTIN_TOOLS.TEXT_GENERATION,
            dependencies: [steps[0].id],
            estimatedDuration: 5000,
          },
          {
            id: this.generateStepId(),
            name: "图像生成",
            description: "生成图像",
            toolId: BUILTIN_TOOLS.IMAGE_GENERATION,
            dependencies: [steps[1].id],
            estimatedDuration: 30000,
          },
        );
        break;

      case ImageTaskType.PROMPT_ENHANCE:
        steps.push({
          id: this.generateStepId(),
          name: "Prompt 增强",
          description: "增强和优化 Prompt",
          toolId: BUILTIN_TOOLS.TEXT_GENERATION,
          dependencies: [steps[0].id],
          estimatedDuration: 5000,
        });
        break;

      case ImageTaskType.BRAND_DESIGN:
        steps.push(
          {
            id: this.generateStepId(),
            name: "品牌分析",
            description: "分析品牌特征和风格",
            toolId: BUILTIN_TOOLS.TEXT_GENERATION,
            dependencies: [steps[0].id],
            estimatedDuration: 5000,
          },
          {
            id: this.generateStepId(),
            name: "Logo 生成",
            description: "生成品牌 Logo",
            toolId: BUILTIN_TOOLS.IMAGE_GENERATION,
            dependencies: [steps[1].id],
            estimatedDuration: 20000,
          },
          {
            id: this.generateStepId(),
            name: "配色方案",
            description: "生成品牌配色方案",
            toolId: BUILTIN_TOOLS.TEXT_GENERATION,
            dependencies: [steps[1].id],
            estimatedDuration: 5000,
          },
          {
            id: this.generateStepId(),
            name: "视觉规范",
            description: "生成视觉设计规范",
            toolId: BUILTIN_TOOLS.TEXT_GENERATION,
            dependencies: [steps[3].id],
            estimatedDuration: 5000,
          },
        );
        break;

      default:
        steps.push({
          id: this.generateStepId(),
          name: "图像生成",
          description: "生成图像",
          toolId: BUILTIN_TOOLS.IMAGE_GENERATION,
          dependencies: [steps[0].id],
          estimatedDuration: 30000,
        });
    }

    const estimatedTime = steps.reduce(
      (acc, step) => acc + step.estimatedDuration,
      0,
    );

    return {
      taskId,
      agentId: this.id,
      steps,
      estimatedTime,
      toolsRequired: this.requiredTools,
      modelsRequired: ["chat", "image"],
      metadata: {
        taskType,
        style: input.options?.style,
        layout: input.options?.layout,
      },
    };
  }

  /**
   * 执行计划,流式返回进度和结果
   */
  async *execute(plan: AgentPlan): AsyncGenerator<AgentEvent> {
    this.logger.log(`[execute] Starting image design for task: ${plan.taskId}`);

    const input = (plan as AgentPlan & { input?: AgentInput }).input;
    if (!input) {
      yield {
        type: "error",
        error: "No input provided in plan context",
        stepId: plan.steps[0]?.id,
      };
      return;
    }

    const startTime = Date.now();
    const taskType =
      (plan.metadata?.taskType as ImageTaskType) || ImageTaskType.PURE_IMAGE;

    try {
      // 发送计划就绪事件
      yield {
        type: "plan_ready",
        plan,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- artifact shape varies by step type
      const artifacts: any[] = [];
      let enhancedPrompt = input.prompt || "";
      let infographicHtml = "";

      // 执行每个步骤
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];

        // 步骤开始
        yield {
          type: "step_start",
          stepId: step.id,
          message: `开始 ${step.name}`,
        };

        // 执行步骤
        const result = await this.executeStep(step, input, {
          taskType,
          enhancedPrompt,
          infographicHtml,
        });

        // 更新状态
        if (result.enhancedPrompt) {
          enhancedPrompt = result.enhancedPrompt;
        }
        if (result.html) {
          infographicHtml = result.html;
        }
        if (result.artifact) {
          artifacts.push(result.artifact);
        }

        yield {
          type: "step_progress",
          stepId: step.id,
          progress: 100,
          message: `${step.name} 完成`,
        };

        yield {
          type: "step_complete",
          stepId: step.id,
          result: result,
        };
      }

      // 完成
      const duration = Date.now() - startTime;

      yield {
        type: "complete",
        result: {
          success: true,
          artifacts,
          summary: `图像设计完成,生成 ${artifacts.length} 个产出物`,
          tokensUsed: 0,
          duration,
        },
      };
    } catch (error) {
      this.logger.error(`[execute] Error: ${error}`);
      yield {
        type: "error",
        error: error instanceof Error ? error.message : "图像设计失败",
      };
    }
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    step: PlanStep,
    input: AgentInput,
    context: {
      taskType: ImageTaskType;
      enhancedPrompt: string;
      infographicHtml: string;
    },
  ): Promise<{
    enhancedPrompt?: string;
    html?: string;
    artifact?: StepArtifact;
    content?: string;
  }> {
    const { taskType: _taskType } = context;

    switch (step.name) {
      case "需求分析":
        // 分析需求,返回增强的 prompt
        return {
          enhancedPrompt: this.analyzeRequirements(input.prompt || ""),
        };

      case "Prompt 优化":
      case "Prompt 增强":
        // 优化 prompt
        const enhanced = await this.enhancePrompt(context.enhancedPrompt);
        return { enhancedPrompt: enhanced };

      case "内容提取":
        // 提取信息图表内容
        const content = this.extractInfographicContent(input.prompt || "");
        return { content };

      case "模板渲染":
        // 渲染信息图表
        const html = await this.renderInfographic(input);
        return { html };

      case "图像导出":
        // 导出信息图表图像
        return {
          artifact: {
            id: this.generateTaskId(),
            type: "image",
            name: "infographic.png",
            mimeType: "image/png",
            size: 0,
            metadata: {
              style: input.options?.style,
              layout: input.options?.layout,
            },
          },
        };

      case "图像生成":
        // 生成图像
        const imageResult = await this.generateImage(
          context.enhancedPrompt,
          input.options,
        );
        return {
          artifact: {
            id: this.generateTaskId(),
            type: "image",
            name: "generated-image.png",
            mimeType: "image/png",
            size: 0,
            url: imageResult.url,
            metadata: {
              style: input.options?.style,
              prompt: context.enhancedPrompt,
            },
          },
        };

      case "品牌分析":
        return {
          content: this.analyzeBrand(input.prompt || ""),
        };

      case "Logo 生成":
        return {
          artifact: {
            id: this.generateTaskId(),
            type: "image",
            name: "logo.png",
            mimeType: "image/png",
            size: 0,
          },
        };

      case "配色方案":
        return {
          content: this.generateColorScheme(input.prompt || ""),
        };

      case "视觉规范":
        return {
          content: this.generateVisualGuideline(input.prompt || ""),
        };

      default:
        return {};
    }
  }

  /**
   * 分析需求
   */
  private analyzeRequirements(prompt: string): string {
    // 基础增强
    return prompt.trim();
  }

  /**
   * 增强 Prompt
   */
  private async enhancePrompt(prompt: string): Promise<string> {
    // 简化实现:添加质量修饰词
    const qualityModifiers = [
      "high quality",
      "detailed",
      "professional",
      "8k resolution",
    ];
    return `${prompt}, ${qualityModifiers.join(", ")}`;
  }

  /**
   * 提取信息图表内容
   */
  private extractInfographicContent(prompt: string): string {
    // 简化实现
    return prompt;
  }

  /**
   * 渲染信息图表
   */
  private async renderInfographic(input: AgentInput): Promise<string> {
    // 简化实现:返回模拟 HTML
    const style = (input.options?.style as InfographicStyle) || "consulting";
    return `<div class="infographic" style="${style}">
      <h1>${input.prompt}</h1>
      <div class="content">信息图表内容</div>
    </div>`;
  }

  /**
   * 生成图像
   */
  private async generateImage(
    _prompt: string,
    _options?: Record<string, unknown>,
  ): Promise<{ url: string }> {
    // 简化实现
    return {
      url: `/api/images/generated/${Date.now()}.png`,
    };
  }

  /**
   * 分析品牌
   */
  private analyzeBrand(prompt: string): string {
    return `品牌分析:${prompt}`;
  }

  /**
   * 生成配色方案
   */
  private generateColorScheme(_prompt: string): string {
    return `
配色方案:
- 主色:#3B82F6 (蓝色)
- 辅助色:#10B981 (绿色)
- 强调色:#F59E0B (橙色)
- 背景色:#F9FAFB (浅灰)
- 文字色:#111827 (深灰)
`;
  }

  /**
   * 生成视觉规范
   */
  private generateVisualGuideline(_prompt: string): string {
    return `
视觉设计规范:
1. Logo 使用规范
2. 字体规范:标题使用 Sans-serif,正文使用 System UI
3. 间距规范:基础单位 8px
4. 圆角规范:8px (小)、12px (中)、16px (大)
5. 阴影规范:轻阴影用于卡片,重阴影用于模态框
`;
  }

  /**
   * 分类任务类型
   */
  private classifyTask(
    prompt: string,
    options?: Record<string, unknown>,
  ): ImageTaskType {
    // 优先使用显式指定的任务类型
    if (options?.taskType) {
      return options.taskType as ImageTaskType;
    }

    const lowerPrompt = prompt.toLowerCase();

    if (
      lowerPrompt.includes("信息图") ||
      lowerPrompt.includes("infographic") ||
      lowerPrompt.includes("图表")
    ) {
      return ImageTaskType.INFOGRAPHIC;
    }

    if (
      lowerPrompt.includes("优化") ||
      lowerPrompt.includes("增强") ||
      lowerPrompt.includes("prompt")
    ) {
      return ImageTaskType.PROMPT_ENHANCE;
    }

    if (
      lowerPrompt.includes("品牌") ||
      lowerPrompt.includes("logo") ||
      lowerPrompt.includes("视觉识别")
    ) {
      return ImageTaskType.BRAND_DESIGN;
    }

    if (
      lowerPrompt.includes("风格转换") ||
      lowerPrompt.includes("style transfer")
    ) {
      return ImageTaskType.STYLE_TRANSFER;
    }

    return ImageTaskType.PURE_IMAGE;
  }
}
