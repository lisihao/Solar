-- CreateEnum
CREATE TYPE "AITeamTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "ai_team_templates" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(50),
    "color" VARCHAR(20),
    "category" VARCHAR(50),
    "status" "AITeamTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "workflow_config" JSONB,
    "constraint_profile" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_team_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_team_member_templates" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "avatar" TEXT,
    "role_description" VARCHAR(500),
    "personality" TEXT,
    "role_id" VARCHAR(50) NOT NULL,
    "is_leader" BOOLEAN NOT NULL DEFAULT false,
    "default_model" VARCHAR(100),
    "capabilities" "AICapability"[],
    "work_style" "AgentWorkStyle",
    "expertise_areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mcp_tools" JSONB,
    "system_prompt" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "min_count" INTEGER NOT NULL DEFAULT 1,
    "max_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_team_member_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_team_templates_status_idx" ON "ai_team_templates"("status");

-- CreateIndex
CREATE INDEX "ai_team_templates_category_idx" ON "ai_team_templates"("category");

-- CreateIndex
CREATE INDEX "ai_team_templates_sort_order_idx" ON "ai_team_templates"("sort_order");

-- CreateIndex
CREATE INDEX "ai_team_member_templates_team_id_idx" ON "ai_team_member_templates"("team_id");

-- CreateIndex
CREATE INDEX "ai_team_member_templates_role_id_idx" ON "ai_team_member_templates"("role_id");

-- CreateIndex
CREATE INDEX "ai_team_member_templates_is_leader_idx" ON "ai_team_member_templates"("is_leader");

-- AddForeignKey
ALTER TABLE "ai_team_member_templates" ADD CONSTRAINT "ai_team_member_templates_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "ai_team_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
