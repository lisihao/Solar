-- 2026-05-21 PR-I.2 Dreaming 主动反思 — DreamingRun + DreamingRule 表
--
-- 补 a97c9a6a1 commit 漏掉的 schema migration（彼时只 push 了 service / controller /
-- types / spec / UI，没出 model + migration，prod main 调 prisma.dreamingRule.* 必崩）。
--
-- DreamingRun  : 一次反思调度的执行记录（trigger / 抽样窗口 / 产出统计）
-- DreamingRule : 反思 run 归纳出的通用失败模式 + mitigation（注入下轮 leader plan）

CREATE TABLE "dreaming_runs" (
    "id" TEXT NOT NULL,
    "trigger_kind" VARCHAR(32) NOT NULL,
    "trigger_detail" VARCHAR(255),
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "sampled_mission_ids" TEXT[],
    "sample_strategy" VARCHAR(32) NOT NULL,
    "new_rules_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_candidates" INTEGER NOT NULL DEFAULT 0,
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dreaming_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dreaming_runs_triggered_at_idx" ON "dreaming_runs" ("triggered_at" DESC);
CREATE INDEX "dreaming_runs_status_idx" ON "dreaming_runs" ("status");

CREATE TABLE "dreaming_rules" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "mitigation" TEXT NOT NULL,
    "failure_codes" TEXT[],
    "derived_from_mission_ids" TEXT[],
    "derived_from_run_id" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "application_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dreaming_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dreaming_rules_disabled_confidence_idx" ON "dreaming_rules" ("disabled", "confidence" DESC);
CREATE INDEX "dreaming_rules_failure_codes_idx" ON "dreaming_rules" USING GIN ("failure_codes");
CREATE INDEX "dreaming_rules_derived_from_run_id_idx" ON "dreaming_rules" ("derived_from_run_id");

ALTER TABLE "dreaming_rules"
    ADD CONSTRAINT "dreaming_rules_derived_from_run_id_fkey"
    FOREIGN KEY ("derived_from_run_id") REFERENCES "dreaming_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
