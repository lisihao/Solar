-- ★ 2026-05-06: mission 报告版本化
-- 每次 rerun 写入新版本行，不覆盖 mission.report_full（向后兼容）。
-- version 单调递增由 saveReportVersion 用 MAX(version)+1 原子分配。

CREATE TABLE IF NOT EXISTS "mission_report_versions" (
  "id"               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "mission_id"       UUID        NOT NULL,
  "version"          INT         NOT NULL,
  "version_label"    VARCHAR(120),
  "report_full"      JSONB,
  "report_title"     VARCHAR(500),
  "report_summary"   TEXT,
  "final_score"      INT,
  "leader_signed"    BOOLEAN,
  "trigger_type"     VARCHAR(40) NOT NULL,
  "changes_from_prev" JSONB,
  "generated_at"     TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "mission_report_versions_mission_version_unique"
  ON "mission_report_versions" ("mission_id", "version");

CREATE INDEX IF NOT EXISTS "mission_report_versions_mission_generatedAt_idx"
  ON "mission_report_versions" ("mission_id", "generated_at" DESC);

ALTER TABLE "mission_report_versions"
  ADD CONSTRAINT "mission_report_versions_mission_id_fkey"
  FOREIGN KEY ("mission_id") REFERENCES "agent_playground_missions"("id")
  ON DELETE CASCADE;
