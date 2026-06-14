/**
 * Social Publish Status Tool
 *
 * 查询 wechat-mp-publish / xhs-publish 返回的 jobId 当前状态。
 * 发布是异步长任务，agent 调完发布工具后用此工具轮询。
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
  type PublishJobStatus,
  type SocialPlatform,
} from "./abstractions/social-publish.port";

export interface SocialPublishStatusInput {
  jobId: string;
}

export interface SocialPublishStatusOutput {
  success: boolean;
  /** 任务存在与否（false = 该 jobId 不存在或不属于当前 userId） */
  found: boolean;
  jobId: string;
  status?: PublishJobStatus;
  platform?: SocialPlatform;
  /** published 时填，公众号文章 URL 或小红书笔记 URL */
  externalUrl?: string;
  externalId?: string;
  /** failed 时填 */
  errorMessage?: string;
  /** 任务完成时间（ISO 字符串），published / failed 时填 */
  finishedAt?: string;
  /** tool-level 错误（端口未注入 / 缺 userId 等） */
  error?: string;
}

@Injectable()
export class SocialPublishStatusTool extends BaseTool<
  SocialPublishStatusInput,
  SocialPublishStatusOutput
> {
  private readonly logger = new Logger(SocialPublishStatusTool.name);

  readonly id = "social-publish-status";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "integration";
  readonly tags = ["integration", "social", "publishing", "status"];
  readonly name = "社交发布任务状态";
  readonly description =
    "查询社交发布任务的状态（wechat-mp / xhs）。传入 wechat-mp-publish 或 xhs-publish 返回的 jobId，获取当前进度 / 外链 / 错误信息。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      jobId: {
        type: "string",
        description: "发布任务 ID（由 wechat-mp-publish / xhs-publish 返回）",
        minLength: 1,
      },
    },
    required: ["jobId"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      found: { type: "boolean" },
      jobId: { type: "string" },
      status: {
        type: "string",
        enum: ["queued", "publishing", "published", "failed"],
      },
      platform: { type: "string", enum: ["wechat-mp", "xhs"] },
      externalUrl: { type: "string" },
      externalId: { type: "string" },
      errorMessage: { type: "string" },
      finishedAt: { type: "string" },
      error: { type: "string" },
    },
    required: ["success", "found", "jobId"],
  };

  constructor(
    @Optional()
    @Inject(SOCIAL_PUBLISH_PORT)
    private readonly port: SocialPublishPort | null = null,
  ) {
    super();
  }

  validateInput(input: SocialPublishStatusInput): boolean {
    return typeof input.jobId === "string" && input.jobId.trim().length > 0;
  }

  protected async doExecute(
    input: SocialPublishStatusInput,
    context: ToolContext,
  ): Promise<SocialPublishStatusOutput> {
    if (!this.port) {
      this.logger.warn(
        "SOCIAL_PUBLISH_PORT 未注入 —— AiSocialModule 可能未加载",
      );
      return {
        success: false,
        found: false,
        jobId: input.jobId,
        error:
          "Social publish port not configured. Ensure AiSocialModule is loaded in the application module tree.",
      };
    }
    if (!context.userId) {
      return {
        success: false,
        found: false,
        jobId: input.jobId,
        error: "context.userId is required for status lookup",
      };
    }

    const snapshot = await this.port.getPublishStatus(input.jobId, {
      userId: context.userId,
      callerId: context.callerId ?? this.id,
    });

    if (!snapshot) {
      return {
        success: true,
        found: false,
        jobId: input.jobId,
      };
    }

    return {
      success: true,
      found: true,
      jobId: snapshot.jobId,
      status: snapshot.status,
      platform: snapshot.platform,
      externalUrl: snapshot.externalUrl,
      externalId: snapshot.externalId,
      errorMessage: snapshot.errorMessage,
      finishedAt: snapshot.finishedAt?.toISOString(),
    };
  }
}
