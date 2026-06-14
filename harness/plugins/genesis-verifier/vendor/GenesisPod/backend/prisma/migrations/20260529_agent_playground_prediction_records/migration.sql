-- Foresight L3 (2026-05-29 前瞻洞察校准闭环)：前瞻预测留痕表
-- 每条 = mission foresight.baseCase 里的一个可证伪判断。
-- 生命周期：s12 落库(actualOutcome=null) → scheduler 到期裁决回填 → Brier 聚合反哺。
-- 独立表（非 mission JSON 字段）：支持 target_date 索引到期扫描 + 跨 mission Brier 聚合。
--
-- FK 内联在 CREATE TABLE body（幂等：整表创建是单一幂等单元，re-apply 不会重复 ADD CONSTRAINT 报错）。

CREATE TABLE IF NOT EXISTS "agent_playground_prediction_records" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "prediction_text" TEXT NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "confidence" VARCHAR(20) NOT NULL,
    "horizon" VARCHAR(20) NOT NULL,
    "target_date" TIMESTAMP(3) NOT NULL,
    "resolution_criteria" TEXT NOT NULL,
    "topic" VARCHAR(500) NOT NULL,
    "actual_outcome" BOOLEAN,
    "outcome_evidence_url" TEXT,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "judgment_at" TIMESTAMP(3),
    "brier_score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_playground_prediction_records_pkey" PRIMARY KEY ("id"),
    -- mission 删除时级联清理预测记录
    CONSTRAINT "agent_playground_prediction_records_mission_id_fkey"
        FOREIGN KEY ("mission_id") REFERENCES "agent_playground_missions" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- 到期回扫主索引："actual_outcome IS NULL AND target_date <= now()"
CREATE INDEX IF NOT EXISTS "agent_playground_prediction_records_actual_outcome_target_date_idx"
    ON "agent_playground_prediction_records" ("actual_outcome", "target_date");

-- 按 user + topic 聚合历史 Brier（反哺下次预测保守度）
CREATE INDEX IF NOT EXISTS "agent_playground_prediction_records_user_id_topic_idx"
    ON "agent_playground_prediction_records" ("user_id", "topic");

CREATE INDEX IF NOT EXISTS "agent_playground_prediction_records_mission_id_idx"
    ON "agent_playground_prediction_records" ("mission_id");
