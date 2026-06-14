-- AI Coding 功能的数据库迁移
-- 创建时间: 2025-12-22

-- ============ 枚举类型 ============

-- AI Coding 项目状态
DO $$ BEGIN
    CREATE TYPE "AiCodingProjectStatus" AS ENUM ('DRAFT', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AI Coding Agent 状态
DO $$ BEGIN
    CREATE TYPE "AiCodingAgentStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AI Coding 规范类型
DO $$ BEGIN
    CREATE TYPE "AiCodingStandardType" AS ENUM ('DIRECTORY_STRUCTURE', 'NAMING_CONVENTIONS', 'CODE_STYLE', 'API_DESIGN', 'DATABASE_DESIGN', 'TESTING_STANDARDS', 'GIT_WORKFLOW', 'DOCUMENTATION', 'SECURITY', 'GENERAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AI Coding 规范来源
DO $$ BEGIN
    CREATE TYPE "AiCodingStandardSource" AS ENUM ('UPLOADED', 'GITHUB', 'TEMPLATE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AI Coding 合规性状态
DO $$ BEGIN
    CREATE TYPE "AiCodingComplianceStatus" AS ENUM ('PENDING', 'RUNNING', 'PASSED', 'FAILED', 'WARNING');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AI Coding PR 状态
DO $$ BEGIN
    CREATE TYPE "AiCodingPRState" AS ENUM ('OPEN', 'CLOSED', 'MERGED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AI Coding 文档类型
DO $$ BEGIN
    CREATE TYPE "AiCodingDocumentType" AS ENUM ('PRD', 'DESIGN', 'API', 'README', 'CHANGELOG');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============ 核心表 ============

-- AI Coding 项目
CREATE TABLE IF NOT EXISTS "ai_coding_projects" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "tech_stack" JSONB NOT NULL DEFAULT '{}',
    "template" VARCHAR(50),
    "status" "AiCodingProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "agent_status" JSONB NOT NULL DEFAULT '{}',
    "outputs" JSONB NOT NULL DEFAULT '{}',
    "storage_path" TEXT,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "github_repo" VARCHAR(200),
    "github_url" TEXT,
    "error_message" TEXT,
    "checkpoint" JSONB DEFAULT 'null',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "standards_config" JSONB DEFAULT '{}',
    "compliance_score" INTEGER
);

CREATE INDEX IF NOT EXISTS "ai_coding_projects_user_id_created_at_idx" ON "ai_coding_projects"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "ai_coding_projects_status_idx" ON "ai_coding_projects"("status");

-- AI Coding 生成的文件
CREATE TABLE IF NOT EXISTS "ai_coding_files" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL REFERENCES "ai_coding_projects"("id") ON DELETE CASCADE,
    "path" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "language" VARCHAR(50) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "size" INTEGER NOT NULL DEFAULT 0,
    "line_count" INTEGER NOT NULL DEFAULT 0,
    "is_entry" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_coding_files_project_id_path_version_key" ON "ai_coding_files"("project_id", "path", "version");
CREATE INDEX IF NOT EXISTS "ai_coding_files_project_id_idx" ON "ai_coding_files"("project_id");

-- AI Coding 智能体日志
CREATE TABLE IF NOT EXISTS "ai_coding_agent_logs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL REFERENCES "ai_coding_projects"("id") ON DELETE CASCADE,
    "agent_type" VARCHAR(50) NOT NULL,
    "status" "AiCodingAgentStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB,
    "output" JSONB,
    "model_used" VARCHAR(100),
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "ai_coding_agent_logs_project_id_agent_type_idx" ON "ai_coding_agent_logs"("project_id", "agent_type");
CREATE INDEX IF NOT EXISTS "ai_coding_agent_logs_created_at_idx" ON "ai_coding_agent_logs"("created_at");

-- AI Coding 迭代记录
CREATE TABLE IF NOT EXISTS "ai_coding_iterations" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL REFERENCES "ai_coding_projects"("id") ON DELETE CASCADE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "feedback" TEXT NOT NULL,
    "changes" JSONB,
    "status" "AiCodingProjectStatus" NOT NULL DEFAULT 'PROCESSING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "ai_coding_iterations_project_id_version_idx" ON "ai_coding_iterations"("project_id", "version");

-- AI Coding 工程规范
CREATE TABLE IF NOT EXISTS "ai_coding_standards" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" VARCHAR(200) NOT NULL,
    "type" "AiCodingStandardType" NOT NULL,
    "source" "AiCodingStandardSource" NOT NULL,
    "content" TEXT NOT NULL,
    "rules" JSONB NOT NULL DEFAULT '[]',
    "github_repo" VARCHAR(200),
    "github_path" VARCHAR(500),
    "github_branch" VARCHAR(100),
    "last_synced_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ai_coding_standards_user_id_type_idx" ON "ai_coding_standards"("user_id", "type");
CREATE INDEX IF NOT EXISTS "ai_coding_standards_user_id_is_active_idx" ON "ai_coding_standards"("user_id", "is_active");

-- AI Coding 合规性报告
CREATE TABLE IF NOT EXISTS "ai_coding_compliance_reports" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL REFERENCES "ai_coding_projects"("id") ON DELETE CASCADE,
    "iteration_id" UUID,
    "overall_score" INTEGER NOT NULL DEFAULT 0,
    "status" "AiCodingComplianceStatus" NOT NULL DEFAULT 'PENDING',
    "results" JSONB DEFAULT '[]',
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "ai_coding_compliance_reports_project_id_idx" ON "ai_coding_compliance_reports"("project_id");

-- GitHub 连接
CREATE TABLE IF NOT EXISTS "github_connections" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "token_type" TEXT NOT NULL DEFAULT 'bearer',
    "scope" TEXT,
    "github_id" INTEGER NOT NULL,
    "github_login" VARCHAR(100) NOT NULL,
    "github_email" VARCHAR(200),
    "avatar_url" TEXT,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "github_connections_user_id_idx" ON "github_connections"("user_id");
CREATE INDEX IF NOT EXISTS "github_connections_github_id_idx" ON "github_connections"("github_id");

-- AI Coding GitHub 仓库
CREATE TABLE IF NOT EXISTS "ai_coding_github_repos" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL UNIQUE REFERENCES "ai_coding_projects"("id") ON DELETE CASCADE,
    "owner" VARCHAR(100) NOT NULL,
    "repo" VARCHAR(200) NOT NULL,
    "full_name" VARCHAR(300) NOT NULL,
    "html_url" TEXT NOT NULL,
    "clone_url" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "is_private" BOOLEAN NOT NULL DEFAULT true,
    "auto_sync" BOOLEAN NOT NULL DEFAULT false,
    "last_push_at" TIMESTAMP(3),
    "last_push_commit" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ai_coding_github_repos_project_id_idx" ON "ai_coding_github_repos"("project_id");

-- AI Coding Pull Request
CREATE TABLE IF NOT EXISTS "ai_coding_pull_requests" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "github_repo_id" UUID NOT NULL REFERENCES "ai_coding_github_repos"("id") ON DELETE CASCADE,
    "iteration_id" UUID,
    "pr_number" INTEGER NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "body" TEXT,
    "head_branch" VARCHAR(200) NOT NULL,
    "base_branch" VARCHAR(200) NOT NULL,
    "html_url" TEXT NOT NULL,
    "state" "AiCodingPRState" NOT NULL DEFAULT 'OPEN',
    "merged_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ai_coding_pull_requests_github_repo_id_idx" ON "ai_coding_pull_requests"("github_repo_id");
CREATE INDEX IF NOT EXISTS "ai_coding_pull_requests_pr_number_idx" ON "ai_coding_pull_requests"("pr_number");

-- AI Coding 文档
CREATE TABLE IF NOT EXISTS "ai_coding_documents" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL REFERENCES "ai_coding_projects"("id") ON DELETE CASCADE,
    "type" "AiCodingDocumentType" NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "diagrams" JSONB DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ai_coding_documents_project_id_type_idx" ON "ai_coding_documents"("project_id", "type");
