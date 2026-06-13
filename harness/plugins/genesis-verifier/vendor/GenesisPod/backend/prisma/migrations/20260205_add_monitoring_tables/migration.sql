-- CreateTable: 系统错误日志 - 替代 Sentry 的错误跟踪
CREATE TABLE IF NOT EXISTS "system_error_logs" (
    "id" TEXT NOT NULL,
    "error_code" TEXT NOT NULL,
    "error_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "component" TEXT,
    "message" TEXT NOT NULL,
    "stack_trace" TEXT,
    "fingerprint" TEXT,
    "path" TEXT,
    "method" TEXT,
    "status_code" INTEGER,
    "user_id" TEXT,
    "request_id" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AI 引擎指标日志 - LLM 调用、Token 使用等
CREATE TABLE IF NOT EXISTS "ai_engine_metrics" (
    "id" TEXT NOT NULL,
    "metric_type" TEXT NOT NULL,
    "operation_id" TEXT,
    "model_id" TEXT,
    "provider_id" TEXT,
    "agent_id" TEXT,
    "mission_id" TEXT,
    "user_id" TEXT,
    "duration" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "estimated_cost" DECIMAL(10,6),
    "success" BOOLEAN NOT NULL,
    "error_code" TEXT,
    "error_msg" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_engine_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 系统错误日志索引
CREATE INDEX IF NOT EXISTS "system_error_logs_error_code_created_at_idx" ON "system_error_logs"("error_code", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "system_error_logs_severity_created_at_idx" ON "system_error_logs"("severity", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "system_error_logs_component_created_at_idx" ON "system_error_logs"("component", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "system_error_logs_fingerprint_idx" ON "system_error_logs"("fingerprint");
CREATE INDEX IF NOT EXISTS "system_error_logs_resolved_created_at_idx" ON "system_error_logs"("resolved", "created_at" DESC);

-- CreateIndex: AI 引擎指标索引
CREATE INDEX IF NOT EXISTS "ai_engine_metrics_metric_type_created_at_idx" ON "ai_engine_metrics"("metric_type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "ai_engine_metrics_model_id_created_at_idx" ON "ai_engine_metrics"("model_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "ai_engine_metrics_user_id_created_at_idx" ON "ai_engine_metrics"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "ai_engine_metrics_success_created_at_idx" ON "ai_engine_metrics"("success", "created_at" DESC);
