-- SOTA v1 · Task-Centric Agent Runtime 数据模型迁移
-- 文档：docs/design/topic-insights-harness-redesign/30-sota-task-centric-architecture.md
-- 目标：
--   1. ResearchTaskStatus enum 扩展 8 个 FSM 状态
--   2. AgentStepType enum 新建（11 种 ReAct step 类型）
--   3. research_tasks 表加 FSM / ReAct / budget / parent-child 字段
--   4. 新建 agent_steps / task_checkpoints / verification_records 三张表

-- =============================================================
-- 1. ResearchTaskStatus enum 扩展（baseline 迁移规范：ADD VALUE 不能在事务中）
-- =============================================================
ALTER TYPE "ResearchTaskStatus" ADD VALUE IF NOT EXISTS 'CREATED';
ALTER TYPE "ResearchTaskStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "ResearchTaskStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "ResearchTaskStatus" ADD VALUE IF NOT EXISTS 'RUNNING';
ALTER TYPE "ResearchTaskStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "ResearchTaskStatus" ADD VALUE IF NOT EXISTS 'AWAITING_HUMAN';
ALTER TYPE "ResearchTaskStatus" ADD VALUE IF NOT EXISTS 'VERIFYING';
ALTER TYPE "ResearchTaskStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- =============================================================
-- 2. AgentStepType enum 新建
-- =============================================================
DO $$ BEGIN
  CREATE TYPE "AgentStepType" AS ENUM (
    'OBSERVE', 'THINK', 'PLAN', 'TOOL_CALL', 'TOOL_RESULT',
    'REFLECT', 'SELF_EVAL', 'JUDGE_EVAL', 'HUMAN_INPUT', 'CHECKPOINT', 'DONE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================
-- 3. research_tasks 字段扩展
-- =============================================================
ALTER TABLE "research_tasks"
  ADD COLUMN IF NOT EXISTS "queued_at"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scheduled_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paused_at"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resumed_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "current_iteration"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "max_iterations"       INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "last_checkpoint_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "retry_count"          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "max_retries"          INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "requires_revision"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "token_budget"         INTEGER,
  ADD COLUMN IF NOT EXISTS "tokens_used"          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cost_usd"             DECIMAL(10, 6),
  ADD COLUMN IF NOT EXISTS "latency_ms"           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "parent_task_id"       TEXT,
  ADD COLUMN IF NOT EXISTS "result_score"         INTEGER;

-- parent-child self-reference FK（NoAction 避免级联风暴）
ALTER TABLE "research_tasks"
  DROP CONSTRAINT IF EXISTS "research_tasks_parent_task_id_fkey";
ALTER TABLE "research_tasks"
  ADD CONSTRAINT "research_tasks_parent_task_id_fkey"
  FOREIGN KEY ("parent_task_id") REFERENCES "research_tasks"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 新增索引
CREATE INDEX IF NOT EXISTS "research_tasks_status_scheduled_at_idx"
  ON "research_tasks"("status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "research_tasks_parent_task_id_idx"
  ON "research_tasks"("parent_task_id");

-- =============================================================
-- 4. agent_steps 表（替代 research_agent_activities 的 step-level 视角）
-- =============================================================
CREATE TABLE IF NOT EXISTS "agent_steps" (
  "id"                 TEXT NOT NULL,
  "task_id"            TEXT NOT NULL,
  "mission_id"         TEXT NOT NULL,
  "topic_id"           TEXT NOT NULL,
  "iteration"          INTEGER NOT NULL,
  "step_index"         INTEGER NOT NULL,
  "step_type"          "AgentStepType" NOT NULL,
  "model_id"           VARCHAR(100),
  "prompt_tokens"      INTEGER,
  "completion_tokens"  INTEGER,
  "cost_usd"           DECIMAL(10, 6),
  "tool_name"          VARCHAR(100),
  "tool_args"          JSONB,
  "tool_result"        JSONB,
  "tool_latency_ms"    INTEGER,
  "tool_success"       BOOLEAN,
  "content"            TEXT,
  "structured_data"    JSONB,
  "trace_id"           VARCHAR(64),
  "span_id"            VARCHAR(64),
  "parent_span_id"     VARCHAR(64),
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_steps_task_id_fkey" FOREIGN KEY ("task_id")
    REFERENCES "research_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "agent_steps_task_iter_step_idx"
  ON "agent_steps"("task_id", "iteration", "step_index");
CREATE INDEX IF NOT EXISTS "agent_steps_mission_created_idx"
  ON "agent_steps"("mission_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_steps_trace_idx"
  ON "agent_steps"("trace_id");

-- =============================================================
-- 5. task_checkpoints 表（ReAct loop 崩溃恢复）
-- =============================================================
CREATE TABLE IF NOT EXISTS "task_checkpoints" (
  "id"                      TEXT NOT NULL,
  "task_id"                 TEXT NOT NULL,
  "iteration"               INTEGER NOT NULL,
  "step_index"              INTEGER NOT NULL DEFAULT 0,
  "observations"            JSONB NOT NULL,
  "reasoning_memory"        JSONB NOT NULL,
  "tool_invocation_history" JSONB NOT NULL DEFAULT '[]',
  "budget_snapshot"         JSONB NOT NULL,
  "status"                  "ResearchTaskStatus" NOT NULL,
  "reason"                  VARCHAR(200),
  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "task_checkpoints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_checkpoints_task_id_fkey" FOREIGN KEY ("task_id")
    REFERENCES "research_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "task_checkpoints_task_created_idx"
  ON "task_checkpoints"("task_id", "created_at");

-- =============================================================
-- 6. verification_records 表（multi-judge 审核）
-- =============================================================
CREATE TABLE IF NOT EXISTS "verification_records" (
  "id"               TEXT NOT NULL,
  "task_id"          TEXT NOT NULL,
  "iteration"        INTEGER NOT NULL,
  "judge_verdicts"   JSONB NOT NULL,
  "consensus"        VARCHAR(50) NOT NULL,
  "decided_score"    INTEGER NOT NULL,
  "meta_judge_note"  TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "verification_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "verification_records_task_id_fkey" FOREIGN KEY ("task_id")
    REFERENCES "research_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "verification_records_task_created_idx"
  ON "verification_records"("task_id", "created_at");
