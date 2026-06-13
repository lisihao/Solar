/**
 * AI Infrastructure Facade (L1)
 *
 * Unified entry point for all platform public exports.
 * All higher-layer modules (L3 AI Engine, L4 AI Apps, L5 Open API)
 * should import platform symbols from this facade, not from internal paths.
 *
 * NOTE: NestJS Module classes are NOT exported here to avoid circular
 * dependency chains. Module imports in `imports: []` arrays should use
 * direct paths (e.g., `import { CreditsModule } from "../platform/credits/credits.module"`).
 */

// ─── Auth ───
export { AuthService } from "../auth/auth.service";

// ─── Credits & Billing ───
export { CreditsService } from "../credits/credits.service";
export { CreditRulesService } from "../credits/policies/credit-rules.service";
export { CheckinService } from "../credits/rewards/checkin.service";
export { BillingContext } from "../credits/billing-context.store";
export { InsufficientCreditsException } from "../credits/exceptions/insufficient-credits.exception";

// ─── Secrets ───
export { SecretsService } from "../credentials/storage/secrets/secrets.service";
export { SecretKeysService } from "../credentials/storage/secrets/secret-keys.service";
export {
  SECRET_NAMES,
  EXTERNAL_TOOL_SECRET_MAPPING,
} from "../credentials/storage/secrets/secret-name.catalog";

// ─── Storage ───
export { StorageGovernanceService } from "../storage/governance/storage-governance.service";
export { ObjectStorageService } from "../storage/object-store/object-storage.service";

// ─── Email ───
export { EmailService } from "../email/email.service";
export {
  EmailNotificationPresetsService,
  type FeedbackEmailNotification,
  type MissionCompletionEmailNotification,
  type FeedbackStatusEmailNotification,
} from "../email/presets/email-notification-presets.service";

// ─── Notifications ───
export { NotificationService } from "../notifications/notification.service";
export { NotificationPresetsService } from "../notifications/presets/notification-presets.service";
export { NotificationTypeDto } from "../notifications/notification.types";

// ─── Notification Dispatcher (PR-DR1a/b) ───
export { NotificationDispatcher } from "../notifications/dispatcher/notification-dispatcher.service";
export { NotificationPreferenceService } from "../notifications/dispatcher/preferences/notification-preference.service";
export { UnsubscribeTokenService } from "../notifications/dispatcher/preferences/unsubscribe-token.service";
export type {
  UnsubscribeScope,
  UnsubscribeResult,
} from "../notifications/dispatcher/preferences/unsubscribe-token.service";
export {
  type DispatchPayload,
  type DispatchOptions,
  type DispatchResult,
  type INotificationChannel,
  type ChannelCapabilities,
  type NotificationChannel,
} from "../notifications/dispatcher/abstractions/notification-channel";
export { RadarMissionCompletePreset } from "../notifications/dispatcher/presets/radar-mission-complete.preset";
export { FeedbackStatusUpdatePreset } from "../notifications/dispatcher/presets/feedback-status-update.preset";
export { MissionCompletionPreset } from "../notifications/dispatcher/presets/mission-completion.preset";
export { MissionFailedPreset } from "../notifications/dispatcher/presets/mission-failed.preset";

// ─── Settings ───
export { SettingsService } from "../settings/settings.service";

// ─── Monitoring ───
export { AIMetricsService } from "../monitoring/metrics/ai-metrics.service";
export { ErrorTrackingService } from "../monitoring/error-reporting/error-tracking.service";
export { HealthCheckService } from "../monitoring/health/health-check.service";
export { AuditLogService } from "../monitoring/audit/audit-log.service";
export type {
  AuditResult,
  AuditRecordInput,
  AuditQueryFilter,
} from "../monitoring/audit/audit-log.service";

// ─── BYOK / Credentials ─── 2026-06-02: 迁至 ai-engine（AI 专属：模型/供应商密钥
// 解析 + user-model-configs）。从 ai-engine/facade 暴露，不再经 platform/facade。

// ─── Release ───
export { ReleaseService } from "../release/release.service";

// ─── Abstractions (DI tokens for L2 service injection) ───
export type {
  IAiChat,
  IAiObservability,
} from "../abstractions/ai-services.interface";
export {
  AI_CHAT_TOKEN,
  AI_OBSERVABILITY_TOKEN,
} from "../abstractions/ai-services.interface";

// ─── Database Governance ───
export { DbOpsService } from "../db-ops/db-ops.service";
export { DataRetentionService } from "../db-ops/data-retention.service";
