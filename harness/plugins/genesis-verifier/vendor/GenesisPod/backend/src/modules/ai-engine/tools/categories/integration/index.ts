/**
 * Integration Tools - 外部集成工具导出
 * 统一导出所有外部集成工具实现
 */

export { MessagePushTool } from "./message-push.tool";
export { CloudStorageTool } from "./cloud-storage.tool";
export { GitHubIntegrationTool } from "./github-integration.tool";
export { EmailSenderTool } from "./email-sender.tool";
export { CalendarIntegrationTool } from "./calendar-integration.tool";
export { WebhookTriggerTool } from "./webhook-trigger.tool";
export { WechatMpPublishTool } from "./wechat-mp-publish.tool";
export { XhsPublishTool } from "./xhs-publish.tool";
export { SocialPublishStatusTool } from "./social-publish-status.tool";

// Social publish port abstractions（ai-app/social 一侧实现该端口）
export {
  SOCIAL_PUBLISH_PORT,
  type SocialPublishPort,
  type SocialPublishContext,
  type SocialPlatform,
  type PublishJobStatus,
  type PublishJobReceipt,
  type PublishStatusSnapshot,
  type WechatMpPublishInput,
  type XhsPublishInput,
} from "./abstractions";

// 导出类型
export type {
  MessagePushInput,
  MessagePushOutput,
  MessagePlatform,
  MessageFormat,
  MessageAttachment,
  SlackConfig,
  DiscordConfig,
  EmailConfig,
  WebhookConfig,
  DeliveryStatus,
} from "./message-push.tool";

export type {
  CloudStorageInput,
  CloudStorageOutput,
  StorageProvider,
  StorageOperation,
  FilePermission,
  S3Config,
  GCSConfig,
  AzureConfig,
  MinIOConfig,
  UploadFileInfo,
  ListOptions,
  FileObject,
} from "./cloud-storage.tool";

export type {
  GitHubIntegrationInput,
  GitHubIntegrationOutput,
  GitHubOperation,
} from "./github-integration.tool";

export type {
  EmailSenderInput,
  EmailSenderOutput,
  EmailAttachment,
} from "./email-sender.tool";

export type {
  CalendarIntegrationInput,
  CalendarIntegrationOutput,
  CalendarOperation,
  CalendarProvider,
  CalendarEvent,
  CalendarEventAttendee,
} from "./calendar-integration.tool";

export type {
  WebhookTriggerInput,
  WebhookTriggerOutput,
  HttpMethod,
} from "./webhook-trigger.tool";

export type { WechatMpPublishToolOutput } from "./wechat-mp-publish.tool";
export type { XhsPublishToolOutput } from "./xhs-publish.tool";
export type {
  SocialPublishStatusInput,
  SocialPublishStatusOutput,
} from "./social-publish-status.tool";
