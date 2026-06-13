export type CleanupExceptionPolicy = {
  strategy: "keep-latest-per-parent";
  tableName: string;
  parentField: string;
  orderField: string;
  keepLatest: number;
  cascadeTables: string[];
};

export const TABLE_CLEANUP_EXCEPTIONS: Record<string, CleanupExceptionPolicy> =
  {
    topic_reports: {
      strategy: "keep-latest-per-parent",
      tableName: "topic_reports",
      parentField: "topic_id",
      orderField: "version",
      keepLatest: 3,
      cascadeTables: [
        "dimension_analyses",
        "topic_evidences",
        "topic_report_revisions",
        "report_changes",
        "report_annotations",
      ],
    },
  };
