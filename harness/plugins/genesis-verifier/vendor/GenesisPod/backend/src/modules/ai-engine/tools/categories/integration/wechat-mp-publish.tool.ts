/**
 * WeChat Official Account (公众号) Publish Tool
 *
 * Thin engine tool —— 把 LLM 入参转交给 SocialPublishPort（实现侧在 ai-app/social）。
 * Engine 不知道发布走 puppeteer / 官方 API / MCP，只知道端口接口。
 *
 * 长任务处理（30-120s 级渲染 + 上传）：tool 立即返回 jobId，agent 后续
 * 调 social-publish-status 工具轮询。
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
  type WechatMpPublishInput,
  type PublishJobReceipt,
} from "./abstractions/social-publish.port";

/**
 * Tool output —— 在 TOutput 内嵌 success/error，与 message-push / video-generation 等
 * 现有 integration tool 风格一致（LLM 看到结构化结果便于决策）。
 */
export interface WechatMpPublishToolOutput {
  success: boolean;
  jobId?: string;
  status?: PublishJobReceipt["status"];
  /** 平台标识 —— 总是 "wechat-mp"，方便 LLM 在多平台 fanout 时溯源 */
  platform: "wechat-mp";
  error?: string;
}

@Injectable()
export class WechatMpPublishTool extends BaseTool<
  WechatMpPublishInput,
  WechatMpPublishToolOutput
> {
  private readonly logger = new Logger(WechatMpPublishTool.name);

  readonly id = "wechat-mp-publish";
  readonly sideEffect = "destructive" as const;
  readonly category: ToolCategory = "integration";
  readonly tags = [
    "integration",
    "social",
    "wechat",
    "wechat-mp",
    "publishing",
  ];
  readonly name = "微信公众号图文发布";
  readonly description =
    "发布图文文章到微信公众号。需要用户已在社交连接管理中绑定公众号账号。发布是异步过程（30-120s 级），工具立即返回 jobId，可用 social-publish-status 工具轮询状态。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "文章标题，公众号建议 ≤64 字符",
        minLength: 1,
        maxLength: 64,
      },
      content: {
        type: "string",
        description:
          "文章正文，公众号编辑器接受 HTML（支持 <p> <h2> <img> 等基础标签）",
        minLength: 1,
      },
      digest: {
        type: "string",
        description: "摘要，公众号建议 ≤120 字；不传则自动从正文截取",
        maxLength: 120,
      },
      coverImageUrl: {
        type: "string",
        description: "封面图 URL（建议 16:9，≤2MB）",
      },
      author: {
        type: "string",
        description: "作者署名（可选）",
      },
      accountId: {
        type: "string",
        description:
          "指定使用哪个已绑定的公众号账号 ID；不传则使用用户当前唯一活跃连接",
      },
      metadata: {
        type: "object",
        description: "调用方附加元数据（可选）",
        additionalProperties: true,
      },
    },
    required: ["title", "content"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      jobId: {
        type: "string",
        description: "发布任务 ID，用于轮询状态",
      },
      status: {
        type: "string",
        enum: ["queued", "publishing", "published", "failed"],
      },
      platform: { type: "string", enum: ["wechat-mp"] },
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

  validateInput(input: WechatMpPublishInput): boolean {
    if (!input.title?.trim()) return false;
    if (!input.content?.trim()) return false;
    if (input.title.length > 64) return false;
    return true;
  }

  protected async doExecute(
    input: WechatMpPublishInput,
    context: ToolContext,
  ): Promise<WechatMpPublishToolOutput> {
    if (!this.port) {
      this.logger.warn(
        "SOCIAL_PUBLISH_PORT 未注入 —— AiSocialModule 可能未加载",
      );
      return {
        success: false,
        platform: "wechat-mp",
        error:
          "Social publish port not configured. Ensure AiSocialModule is loaded in the application module tree.",
      };
    }
    if (!context.userId) {
      return {
        success: false,
        platform: "wechat-mp",
        error: "context.userId is required for social publish",
      };
    }

    const receipt = await this.port.publishWechatMp(input, {
      userId: context.userId,
      callerId: context.callerId ?? this.id,
    });

    return {
      success: true,
      jobId: receipt.jobId,
      status: receipt.status,
      platform: "wechat-mp",
    };
  }
}
