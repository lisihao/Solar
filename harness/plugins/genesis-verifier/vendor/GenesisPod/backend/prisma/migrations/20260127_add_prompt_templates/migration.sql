-- CreateTable: prompt_templates
-- Prompt 模板管理表，支持版本控制和激活/回滚

CREATE TABLE IF NOT EXISTS "prompt_templates" (
    "id" TEXT NOT NULL,
    "taskType" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "template" TEXT NOT NULL,
    "variables" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "created_by" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "prompt_templates_taskType_version_key" ON "prompt_templates"("taskType", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "prompt_templates_taskType_is_active_idx" ON "prompt_templates"("taskType", "is_active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "prompt_templates_taskType_version_idx" ON "prompt_templates"("taskType", "version");
