import { CleanupPolicyDto } from "../db-ops.types";

export const TABLE_CLEANUP_POLICIES: Record<string, CleanupPolicyDto> = {
  // ==================== LOG tables (high-volume, safe to age-out) ====================
  ai_engine_metrics: {
    type: "age",
    field: "created_at",
    threshold: 14,
    description: "Delete AI engine metrics older than 14 days",
  },
  ai_usage_logs: {
    type: "age",
    field: "created_at",
    threshold: 30,
    description: "Delete AI usage logs older than 30 days",
  },
  mission_logs: {
    type: "age",
    field: "created_at",
    threshold: 14,
    description: "Delete mission logs older than 14 days",
  },
  process_events: {
    type: "age",
    field: "created_at",
    threshold: 7,
    description: "Delete process events older than 7 days",
  },
  secret_access_logs: {
    type: "age",
    field: "timestamp",
    threshold: 30,
    description: "Delete secret access logs older than 30 days",
  },
  system_error_logs: {
    type: "age",
    field: "created_at",
    threshold: 14,
    description: "Delete system error logs older than 14 days",
  },
  agent_traces: {
    type: "age",
    field: "created_at",
    threshold: 7,
    description: "Delete agent traces older than 7 days",
  },
  agent_spans: {
    type: "age",
    field: "created_at",
    threshold: 7,
    description: "Delete agent spans older than 7 days",
  },

  // ==================== RESEARCH activity tables ====================
  research_agent_activities: {
    type: "age",
    field: "created_at",
    threshold: 30,
    description: "Delete research agent activities older than 30 days",
  },
  research_team_messages: {
    type: "age",
    field: "created_at",
    threshold: 30,
    description: "Delete research team messages older than 30 days",
  },

  // ==================== INGESTION tables ====================
  raw_data: {
    type: "age",
    field: "processed_at",
    threshold: 30,
    description: "Delete processed raw data older than 30 days",
  },
  collection_tasks: {
    type: "status",
    field: "status",
    condition: "COMPLETED OR FAILED",
    threshold: 7,
    dateField: "created_at",
    description: "Delete completed/failed tasks older than 7 days",
  },
  import_tasks: {
    type: "status",
    field: "status",
    condition: "SUCCESS OR FAILED",
    threshold: 7,
    dateField: "createdAt",
    description: "Delete completed/failed import tasks older than 7 days",
  },

  // ==================== SESSION tables ====================
  user_activities: {
    type: "age",
    field: "created_at",
    threshold: 30,
    description: "Delete user activities older than 30 days",
  },
  ask_sessions: {
    type: "age",
    field: "updated_at",
    threshold: 30,
    description: "Delete old Ask AI sessions older than 30 days",
  },
  deep_research_sessions: {
    type: "age",
    field: "created_at",
    threshold: 30,
    description: "Delete old research sessions older than 30 days",
  },
  agent_tasks: {
    type: "age",
    field: "created_at",
    threshold: 7,
    description: "Delete old agent tasks older than 7 days",
  },

  // ==================== OFFICE tables ====================
  office_documents: {
    type: "age",
    field: "created_at",
    threshold: 7,
    description: "Delete old office documents older than 7 days",
  },
  slides_sessions: {
    type: "age",
    field: "updated_at",
    threshold: 7,
    description: "Delete old slides sessions older than 7 days",
  },
  generated_images: {
    type: "status",
    field: "is_bookmarked",
    condition: "false",
    description: "Delete unbookmarked images (keep latest 20 per user)",
  },
  writing_mission_logs: {
    type: "age",
    field: "created_at",
    threshold: 14,
    description: "Delete writing mission logs older than 14 days",
  },

  // ==================== EXPORT tables (high storage, safe to age-out) ====================
  export_jobs: {
    type: "status",
    field: "status",
    condition: "COMPLETED OR FAILED OR PROCESSING",
    threshold: 7,
    dateField: "created_at",
    description:
      "Delete completed/failed/stuck-processing export jobs older than 7 days",
  },

  // ==================== RESEARCH data tables (large JSON payloads) ====================
  research_tasks: {
    type: "status",
    field: "status",
    condition: "COMPLETED OR FAILED OR EXECUTING OR PENDING",
    threshold: 30,
    dateField: "created_at",
    description:
      "Delete completed/failed/stuck research tasks older than 30 days (result JSON is the main bloat)",
  },
  topic_reports: {
    type: "custom",
    description:
      "Keep only latest 3 report versions per topic; older versions and their dimension_analyses cascade-delete",
  },

  // ==================== SYSTEM / CACHE tables ====================
  provider_quota_cache: {
    type: "age",
    field: "created_at",
    threshold: 7,
    description: "Delete provider quota cache older than 7 days",
  },
  youtube_transcript_cache: {
    type: "age",
    field: "created_at",
    threshold: 30,
    description: "Delete YouTube transcript cache older than 30 days",
  },
  webhook_deliveries: {
    type: "age",
    field: "created_at",
    threshold: 14,
    description: "Delete webhook delivery records older than 14 days",
  },
  credit_transactions: {
    type: "age",
    field: "created_at",
    threshold: 90,
    description: "Delete credit transactions older than 90 days",
  },
};
