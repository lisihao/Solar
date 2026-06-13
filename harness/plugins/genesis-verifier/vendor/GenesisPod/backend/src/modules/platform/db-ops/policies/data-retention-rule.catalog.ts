export interface DataRetentionRule {
  table: string;
  retentionDays: number;
  timestampColumn: string;
  action: "delete" | "update";
  updateSet?: string;
  extraWhere?: string;
  description: string;
}

export const DATA_RETENTION_RULES: DataRetentionRule[] = [
  {
    table: "ai_engine_metrics",
    retentionDays: 30,
    timestampColumn: "created_at",
    action: "delete",
    description: "AI model metrics",
  },
  {
    table: "research_agent_activities",
    retentionDays: 30,
    timestampColumn: "created_at",
    action: "delete",
    description: "Research agent activity logs",
  },
  {
    table: "ai_usage_logs",
    retentionDays: 30,
    timestampColumn: "created_at",
    action: "delete",
    description: "AI usage logs",
  },
  {
    table: "process_events",
    retentionDays: 14,
    timestampColumn: "created_at",
    action: "delete",
    description: "Process events",
  },
  {
    table: "secret_access_logs",
    retentionDays: 30,
    timestampColumn: "timestamp",
    action: "delete",
    description: "Secret access logs",
  },
  {
    table: "mission_logs",
    retentionDays: 30,
    timestampColumn: "created_at",
    action: "delete",
    description: "Mission logs",
  },
  {
    table: "leader_decisions",
    retentionDays: 30,
    timestampColumn: "created_at",
    action: "delete",
    description: "Leader decisions",
  },
  {
    table: "credit_transactions",
    retentionDays: 90,
    timestampColumn: "created_at",
    action: "delete",
    description: "Credit transactions",
  },
  {
    table: "research_tasks",
    retentionDays: 30,
    timestampColumn: "created_at",
    action: "update",
    updateSet: `result = '{}', result_summary = NULL`,
    extraWhere: `status = 'FAILED'`,
    description: "Failed research tasks - clear result JSON",
  },
  {
    table: "research_tasks",
    retentionDays: 60,
    timestampColumn: "created_at",
    action: "update",
    updateSet: `result = '{}'`,
    extraWhere: `status = 'COMPLETED' AND result IS NOT NULL AND result::text != '{}'`,
    description: "Completed research tasks - clear result JSON",
  },
];
