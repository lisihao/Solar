/**
 * Human Approval Tool
 * 人机协作工具 - 请求人类审批和反馈
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  HumanApprovalPrimitiveService,
  approvalRequestKey,
  approvalResponseKey,
} from "./human-approval-primitive.service";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";
// AgentId and AgentResult available from "@/modules/ai-harness/agents/abstractions/agent.types" if needed

import { randomUUID } from "crypto";

// ============================================================================
// Types
// ============================================================================

/**
 * 审批类型
 */
export type ApprovalType = "confirm" | "choose" | "input" | "review";

/**
 * 选项定义
 */
export interface ChoiceOption {
  /**
   * 选项 ID
   */
  id: string;

  /**
   * 选项标签
   */
  label: string;

  /**
   * 选项描述（可选）
   */
  description?: string;
}

/**
 * 审批上下文
 */
export interface ApprovalContext {
  /**
   * 摘要信息
   */
  summary?: string;

  /**
   * 详细信息
   */
  details?: unknown;

  /**
   * 预览内容（如图片 URL、文档预览等）
   */
  preview?: string;
}

/**
 * 审批选项
 */
export interface ApprovalOptions {
  /**
   * 可选项列表（type="choose" 时必需）
   */
  choices?: ChoiceOption[];

  /**
   * 超时时间（毫秒）
   */
  timeout?: number;

  /**
   * 默认操作（超时时自动执行）
   */
  defaultAction?: string;
}

/**
 * 人类审批输入
 */
export interface HumanApprovalInput {
  /**
   * 审批类型
   * - confirm: 确认/拒绝
   * - choose: 从多个选项中选择
   * - input: 输入自定义内容
   * - review: 审查并反馈
   */
  type: ApprovalType;

  /**
   * 审批提示信息
   */
  prompt: string;

  /**
   * 审批上下文
   */
  context?: ApprovalContext;

  /**
   * 审批选项
   */
  options?: ApprovalOptions;
}

/**
 * 审批响应
 */
export interface ApprovalResponse {
  /**
   * 用户选择（type="choose" 时）
   */
  choice?: string;

  /**
   * 用户输入（type="input" 时）
   */
  input?: unknown;

  /**
   * 用户反馈（type="review" 时）
   */
  feedback?: string;
}

/**
 * 人类审批输出
 */
export interface HumanApprovalOutput {
  /**
   * 是否批准
   */
  approved: boolean;

  /**
   * 审批响应
   */
  response?: ApprovalResponse;

  /**
   * 响应时间
   */
  respondedAt: Date;

  /**
   * 是否超时
   */
  timedOut: boolean;

  /**
   * 元数据
   */
  metadata?: {
    /**
     * 请求 ID
     */
    requestId: string;

    /**
     * 请求时间
     */
    requestedAt: Date;

    /**
     * 响应时长（毫秒）
     */
    responseTime: number;
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

/**
 * 人机协作工具
 *
 * 用于在 Agent 执行过程中请求人类审批、选择或反馈，支持：
 * - 确认/拒绝操作
 * - 多选项选择
 * - 自定义输入
 * - 内容审查
 *
 * @example
 * ```typescript
 * // 确认是否继续
 * {
 *   type: "confirm",
 *   prompt: "是否继续生成剩余 10 张图片？这将消耗 100 积分。",
 *   context: {
 *     summary: "已生成 5/15 张图片"
 *   }
 * }
 *
 * // 选择方案
 * {
 *   type: "choose",
 *   prompt: "请选择海报设计风格",
 *   context: {
 *     preview: "https://example.com/preview.png"
 *   },
 *   options: {
 *     choices: [
 *       { id: "modern", label: "现代简约", description: "极简主义设计" },
 *       { id: "tech", label: "科技感", description: "科技蓝渐变" },
 *       { id: "creative", label: "创意艺术", description: "艺术插画风格" }
 *     ]
 *   }
 * }
 *
 * // 审查内容
 * {
 *   type: "review",
 *   prompt: "请审查以下文档内容是否符合要求",
 *   context: {
 *     summary: "产品发布会演讲稿",
 *     details: { wordCount: 1500, sections: 5 },
 *     preview: "https://example.com/doc.pdf"
 *   }
 * }
 * ```
 */
@Injectable()
export class HumanApprovalTool extends BaseTool<
  HumanApprovalInput,
  HumanApprovalOutput
> {
  private readonly logger = new Logger(HumanApprovalTool.name);

  readonly id = "human-approval";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "collaboration";
  readonly tags = ["collaboration", "human-in-loop", "approval", "review"];
  readonly name = "人类审批";
  readonly description =
    "请求人类审批、选择或反馈。适用于需要人工决策、确认重要操作、或需要人类创意输入的场景。支持确认、选择、输入和审查等多种交互模式。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: "审批类型",
        enum: ["confirm", "choose", "input", "review"],
      },
      prompt: {
        type: "string",
        description: "审批提示信息，清晰说明需要用户做什么",
      },
      context: {
        type: "object",
        description: "审批上下文，提供必要的背景信息",
        properties: {
          summary: {
            type: "string",
            description: "摘要信息",
          },
          details: {
            type: "object",
            description: "详细信息",
          },
          preview: {
            type: "string",
            description: "预览 URL（图片、文档等）",
          },
        },
      },
      options: {
        type: "object",
        description: "审批选项",
        properties: {
          choices: {
            type: "array",
            description: "可选项列表（type=choose 时必需）",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "选项 ID" },
                label: { type: "string", description: "选项标签" },
                description: { type: "string", description: "选项描述" },
              },
            },
          },
          timeout: {
            type: "number",
            description: "超时时间（毫秒）",
            default: 300000, // 5分钟
          },
          defaultAction: {
            type: "string",
            description: "超时时的默认操作",
          },
        },
      },
    },
    required: ["type", "prompt"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      approved: {
        type: "boolean",
        description: "是否批准",
      },
      response: {
        type: "object",
        description: "用户响应",
        properties: {
          choice: {
            type: "string",
            description: "用户选择（type=choose 时）",
          },
          input: {
            type: "object",
            description: "用户输入（type=input 时）",
          },
          feedback: {
            type: "string",
            description: "用户反馈（type=review 时）",
          },
        },
      },
      respondedAt: {
        type: "string",
        description: "响应时间（ISO 8601）",
      },
      timedOut: {
        type: "boolean",
        description: "是否超时",
      },
    },
  };

  constructor(private readonly approval: HumanApprovalPrimitiveService) {
    super();
    // defaultTimeout set in class property // 稍大于默认审批超时
  }

  /**
   * 验证输入
   */
  validateInput(input: HumanApprovalInput) {
    // 验证审批类型
    const validTypes: ApprovalType[] = ["confirm", "choose", "input", "review"];
    if (!validTypes.includes(input.type)) {
      this.logger.warn(`Invalid approval type: ${input.type}`);
      return false;
    }

    // 验证提示信息
    if (!input.prompt || input.prompt.trim().length === 0) {
      this.logger.warn("Approval prompt is required");
      return false;
    }

    // 验证 choose 类型必须有选项
    if (input.type === "choose") {
      if (!input.options?.choices || input.options.choices.length === 0) {
        this.logger.warn("Choices are required for 'choose' type");
        return false;
      }

      // 验证选项格式
      for (const choice of input.options.choices) {
        if (!choice.id || !choice.label) {
          this.logger.warn("Each choice must have id and label");
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 执行人类审批请求
   */
  protected async doExecute(
    input: HumanApprovalInput,
    context: ToolContext,
  ): Promise<HumanApprovalOutput> {
    const requestId = randomUUID();
    const requestedAt = new Date();
    const { type, prompt, context: approvalContext, options = {} } = input;
    const { timeout = 300000, defaultAction } = options;

    this.logger.log(
      `Requesting human approval [${requestId}] - ${type}: ${prompt.substring(0, 50)}...`,
    );

    // 记录审批请求详情
    this.logger.debug({
      requestId,
      type,
      prompt,
      context: approvalContext,
      options,
      taskId: context.executionId,
      userId: context.userId,
    });

    try {
      // TODO: 实际实现需要：
      // 1. 通过 WebSocket 发送审批请求到前端
      // 2. 存储审批请求到数据库
      // 3. 等待用户响应或超时
      // 4. 返回审批结果

      // 当前版本：模拟自动批准（用于开发测试）
      const result = await this.waitForHumanResponse(
        requestId,
        type,
        prompt,
        approvalContext,
        options,
        timeout,
      );

      const respondedAt = new Date();
      const responseTime = respondedAt.getTime() - requestedAt.getTime();

      this.logger.log(
        `Human approval ${result.approved ? "approved" : "rejected"} [${requestId}] in ${responseTime}ms`,
      );

      return {
        ...result,
        respondedAt,
        metadata: {
          requestId,
          requestedAt,
          responseTime,
        },
      };
    } catch (error) {
      // 超时处理
      if (error instanceof Error && error.message.includes("timeout")) {
        this.logger.warn(
          `Human approval timed out [${requestId}], using default action: ${defaultAction}`,
        );

        const respondedAt = new Date();
        const responseTime = respondedAt.getTime() - requestedAt.getTime();

        // 使用默认操作
        const approved = this.determineDefaultApproval(type, defaultAction);

        return {
          approved,
          respondedAt,
          timedOut: true,
          metadata: {
            requestId,
            requestedAt,
            responseTime,
          },
        };
      }

      throw error;
    }
  }

  /**
   * 等待人类响应（DB 轮询实现）
   * 将审批请求写入 LongTermMemory，轮询等待外部系统写入响应记录。
   */
  private async waitForHumanResponse(
    requestId: string,
    type: ApprovalType,
    prompt: string,
    context: ApprovalContext | undefined,
    options: ApprovalOptions,
    timeout: number,
  ): Promise<Omit<HumanApprovalOutput, "respondedAt" | "metadata">> {
    if (!(await this.approval.tableReady())) {
      throw new Error(
        "Memory table not available, approval system unavailable",
      );
    }

    // 1. Store the request via the shared primitive (external systems read it).
    await this.approval.storeRequest({
      requestId,
      payload: {
        requestId,
        approvalType: type,
        prompt,
        context: (context || null) as unknown,
        choices: (options.choices || null) as unknown,
        defaultAction: options.defaultAction || null,
        status: "pending",
        createdAt: new Date().toISOString(),
      },
      tags: ["human-approval", type],
      expiresAt: new Date(Date.now() + timeout + 60_000),
    });
    this.logger.log(
      `[HumanApproval] Request stored in DB [${requestId}], polling for response (timeout: ${timeout}ms)`,
    );

    // 2. Poll via the shared primitive. The tool passes no abort signal, so the
    //    outcome is either "resolved" or "timed_out".
    const result = await this.approval.pollForResponse(requestId, timeout);
    if (result.kind === "resolved") {
      this.logger.log(
        `[HumanApproval] Response received [${requestId}]: approved=${result.data.approved}`,
      );
      await this.approval.cleanup([
        approvalRequestKey(requestId),
        approvalResponseKey(requestId),
      ]);
      return {
        approved: result.data.approved ?? false,
        response: {
          choice: result.data.choice,
          input: result.data.input,
          feedback: result.data.feedback,
        },
        timedOut: false,
      };
    }

    // 3. Timeout: clean up the request and throw (tool policy: timeout = error).
    await this.approval.cleanup([approvalRequestKey(requestId)]);
    throw new Error(`Human approval timeout after ${timeout}ms [${requestId}]`);
  }

  /**
   * 确定默认审批结果（超时时使用）
   */
  private determineDefaultApproval(
    type: ApprovalType,
    defaultAction?: string,
  ): boolean {
    // 如果指定了默认操作
    if (defaultAction) {
      return defaultAction.toLowerCase() === "approve";
    }

    // 否则根据类型决定
    // confirm: 默认拒绝（安全起见）
    // choose/input/review: 默认批准（使用第一个选项或空输入）
    return type !== "confirm";
  }
}
