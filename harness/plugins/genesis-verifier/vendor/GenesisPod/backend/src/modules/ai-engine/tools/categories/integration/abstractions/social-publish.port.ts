/**
 * SocialPublishPort — engine ↔ ai-app/social 反转端口
 *
 * Engine 工具（wechat-mp-publish / xhs-publish / social-publish-status）必须
 * 委托此端口完成发布。Engine 永远不知道发布是怎么落地的（puppeteer / MCP / 官方 API），
 * 这一切由 ai-app/social 一侧的 adapter 实现。
 *
 * 注入方式：
 *   constructor(@Optional() @Inject(SOCIAL_PUBLISH_PORT) port: SocialPublishPort | null)
 *
 * 未绑定时 tool 返回结构化失败，不抛 DI 异常 —— 这样在没装 AiSocialModule 的部署里
 * engine 仍可启动，社交发布工具只是"声明在册但不可用"。
 *
 * 反转方向（与 SKILL_PROVIDERS 同一标杆模式）：
 *   - 抽象 + token 定义在 ai-engine
 *   - 实现 + binding 在 ai-app/social 一侧（通过 @Global() bridge module 注册）
 *   - engine 永不 import ai-app，依赖单向
 */

import type { JsonObject } from "@/modules/ai-engine/facade/index";

// ============================================================================
// Token
// ============================================================================

export const SOCIAL_PUBLISH_PORT = Symbol("SOCIAL_PUBLISH_PORT");

// ============================================================================
// Common types
// ============================================================================

/** 发布上下文：tool 把 ToolContext 里的 userId 透传过来，端口实现按 userId 找连接 */
export interface SocialPublishContext {
  userId: string;
  /** 调用方便溯源（tool name / agent id），可选 */
  callerId?: string;
}

/** 发布任务回执 —— 立即返回，发布是异步的（30-120s 级） */
export interface PublishJobReceipt {
  /** jobId（实际上是 SocialContent.id，可用于后续状态查询） */
  jobId: string;
  /** 入队时的初始状态 */
  status: PublishJobStatus;
  /** 平台标识（便于 agent 在多平台 fanout 时区分） */
  platform: SocialPlatform;
}

/** 发布状态机 —— 与 SocialContentStatus 对齐但去掉业务无关项 */
export type PublishJobStatus = "queued" | "publishing" | "published" | "failed";

export type SocialPlatform = "wechat-mp" | "xhs";

/** 状态快照（社交发布是长任务，agent 用此 endpoint 轮询） */
export interface PublishStatusSnapshot {
  jobId: string;
  status: PublishJobStatus;
  platform: SocialPlatform;
  /** 已发布时的外链（公众号文章 URL / 小红书笔记 URL） */
  externalUrl?: string;
  /** 平台返回的外部 ID */
  externalId?: string;
  /** 失败信息（status === 'failed' 时填） */
  errorMessage?: string;
  /** 任务完成时间（published / failed 时填） */
  finishedAt?: Date;
}

// ============================================================================
// Platform-specific inputs
// ============================================================================

/** 公众号图文发布入参 */
export interface WechatMpPublishInput {
  /** 文章标题 */
  title: string;
  /** 文章正文（HTML 或纯文本，公众号编辑器接受 HTML） */
  content: string;
  /** 摘要（公众号摘要字段，可选；建议 64-120 字） */
  digest?: string;
  /** 封面图 URL（公众号要求 ≤2MB，建议 16:9） */
  coverImageUrl?: string;
  /** 作者署名（可选，公众号会用绑定主体的署名） */
  author?: string;
  /**
   * 指定使用哪个已绑定的公众号账号；不传则使用用户当前唯一活跃连接，
   * 多账号场景下不传必须能解析（端口实现自行 fallback / 报错）。
   */
  accountId?: string;
  /** 调用方附带的元数据（端口实现可存 SocialContent.metadata 便于审计） */
  metadata?: JsonObject;
}

/** 小红书笔记发布入参 */
export interface XhsPublishInput {
  /** 笔记标题（小红书 ≤20 字符） */
  title: string;
  /** 笔记正文 */
  content: string;
  /** 图片 URL 列表（小红书必传至少 1 张，上限 9 张；视频笔记走另一通道，本工具仅支持图文） */
  images: string[];
  /** 话题标签（不含 #，如 ['职场', 'AI'] —— 端口实现负责加 #） */
  tags?: string[];
  /** 地点标签 */
  location?: string;
  /** @ 用户列表（用户名或 user_id；端口实现根据平台 API 转换） */
  atUsers?: string[];
  /** 指定账号；同 WechatMpPublishInput.accountId */
  accountId?: string;
  metadata?: JsonObject;
}

// ============================================================================
// Port interface
// ============================================================================

/**
 * 社交发布端口。
 *
 * 实现侧（ai-app/social）：
 *   1. 创建 / 更新 SocialContent 行（写 DB）
 *   2. 立即 enqueue PublishExecutor（fire-and-forget）
 *   3. 同步返回 PublishJobReceipt，发布过程异步进行
 *   4. 通过 getPublishStatus(jobId) 暴露轮询入口
 */
export interface SocialPublishPort {
  publishWechatMp(
    input: WechatMpPublishInput,
    ctx: SocialPublishContext,
  ): Promise<PublishJobReceipt>;

  publishXhs(
    input: XhsPublishInput,
    ctx: SocialPublishContext,
  ): Promise<PublishJobReceipt>;

  /**
   * 查询发布状态。
   * 必须验证 jobId 归属给 ctx.userId —— 防止跨用户读取。
   * jobId 不存在或不归属返回 null。
   */
  getPublishStatus(
    jobId: string,
    ctx: SocialPublishContext,
  ): Promise<PublishStatusSnapshot | null>;
}
