/**
 * 小红书 (Xiaohongshu) Publish Tool
 *
 * Thin engine tool —— 把 LLM 入参转交给 SocialPublishPort（实现侧在 ai-app/social）。
 * 当前仅支持图文笔记发布；视频笔记需要单独工具（不在本 PR 范围）。
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";
import {
  SOCIAL_PUBLISH_PORT,
  type SocialPublishPort,
  type XhsPublishInput,
  type PublishJobReceipt,
} from "./abstractions/social-publish.port";

export interface XhsPublishToolOutput {
  success: boolean;
  jobId?: string;
  status?: PublishJobReceipt["status"];
  platform: "xhs";
  error?: string;
}

@Injectable()
export class XhsPublishTool extends BaseTool<
  XhsPublishInput,
  XhsPublishToolOutput
> {
  private readonly logger = new Logger(XhsPublishTool.name);

  readonly id = "xhs-publish";
  readonly sideEffect = "destructive" as const;
  readonly category: ToolCategory = "integration";
  readonly tags = ["integration", "social", "xiaohongshu", "xhs", "publishing"];
  readonly name = "小红书图文笔记发布";
  readonly description =
    "发布图文笔记到小红书。需要用户已在社交连接管理中绑定小红书账号。至少 1 张图片，最多 9 张。发布是异步过程，工具立即返回 jobId，可用 social-publish-status 工具轮询状态。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "笔记标题，小红书 ≤20 字符",
        minLength: 1,
        maxLength: 20,
      },
      content: {
        type: "string",
        description: "笔记正文，小红书 ≤1000 字符",
        minLength: 1,
        maxLength: 1000,
      },
      images: {
        type: "array",
        description: "图片 URL 列表（1-9 张，必传）",
        items: { type: "string" },
        minItems: 1,
        maxItems: 9,
      },
      tags: {
        type: "array",
        description: "话题标签（不含 #，端口实现会自动加）",
        items: { type: "string" },
        maxItems: 10,
      },
      location: {
        type: "string",
        description: "地点标签（可选）",
      },
      atUsers: {
        type: "array",
        description: "@ 用户列表（用户名或 user_id）",
        items: { type: "string" },
        maxItems: 5,
      },
      accountId: {
        type: "string",
        description: "指定小红书账号 ID；不传则使用用户当前唯一活跃连接",
      },
      metadata: {
        type: "object",
        description: "调用方附加元数据（可选）",
        additionalProperties: true,
      },
    },
    required: ["title", "content", "images"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      jobId: { type: "string" },
      status: {
        type: "string",
        enum: ["queued", "publishing", "published", "failed"],
      },
      platform: { type: "string", enum: ["xhs"] },
      error: { type: "string" },
    },
    required: ["success", "platform"],
  };

  constructor(
    @Optional()
    @Inject(SOCIAL_PUBLISH_PORT)
    private readonly port: SocialPublishPort | null = null,
  ) {
    super();
  }

  validateInput(input: XhsPublishInput): boolean {
    if (!input.title?.trim()) return false;
    if (!input.content?.trim()) return false;
    if (input.title.length > 20) return false;
    if (input.content.length > 1000) return false;
    if (!Array.isArray(input.images) || input.images.length === 0) return false;
    if (input.images.length > 9) return false;
    return true;
  }

  protected async doExecute(
    input: XhsPublishInput,
    context: ToolContext,
  ): Promise<XhsPublishToolOutput> {
    if (!this.port) {
      this.logger.warn(
        "SOCIAL_PUBLISH_PORT 未注入 —— AiSocialModule 可能未加载",
      );
      return {
        success: false,
        platform: "xhs",
        error:
          "Social publish port not configured. Ensure AiSocialModule is loaded in the application module tree.",
      };
    }
    if (!context.userId) {
      return {
        success: false,
        platform: "xhs",
        error: "context.userId is required for social publish",
      };
    }

    const receipt = await this.port.publishXhs(input, {
      userId: context.userId,
      callerId: context.callerId ?? this.id,
    });

    return {
      success: true,
      jobId: receipt.jobId,
      status: receipt.status,
      platform: "xhs",
    };
  }
}
