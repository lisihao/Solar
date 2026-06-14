-- CreateTable: 工具配置表
CREATE TABLE "tool_configs" (
    "id" TEXT NOT NULL,
    "tool_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "display_name" TEXT,
    "description" TEXT,
    "config" JSONB,
    "requires_auth" BOOLEAN NOT NULL DEFAULT false,
    "allowed_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: 技能配置表
CREATE TABLE "skill_configs" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "display_name" TEXT,
    "description" TEXT,
    "config" JSONB,
    "allowed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "layer" TEXT,
    "domain" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MCP服务器配置表
CREATE TABLE "mcp_server_configs" (
    "id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "transport" TEXT NOT NULL,
    "command" TEXT,
    "args" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "url" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_connect" BOOLEAN NOT NULL DEFAULT true,
    "api_key" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_server_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: 能力使用统计表
CREATE TABLE "capability_usages" (
    "id" TEXT NOT NULL,
    "capability_type" TEXT NOT NULL,
    "capability_id" TEXT NOT NULL,
    "user_id" TEXT,
    "team_id" TEXT,
    "agent_id" TEXT,
    "success" BOOLEAN NOT NULL,
    "duration" INTEGER,
    "tokens_used" INTEGER,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capability_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 工具配置索引
CREATE UNIQUE INDEX "tool_configs_tool_id_key" ON "tool_configs"("tool_id");
CREATE INDEX "tool_configs_enabled_idx" ON "tool_configs"("enabled");
CREATE INDEX "tool_configs_category_idx" ON "tool_configs"("category");

-- CreateIndex: 技能配置索引
CREATE UNIQUE INDEX "skill_configs_skill_id_key" ON "skill_configs"("skill_id");
CREATE INDEX "skill_configs_enabled_idx" ON "skill_configs"("enabled");
CREATE INDEX "skill_configs_domain_idx" ON "skill_configs"("domain");

-- CreateIndex: MCP服务器配置索引
CREATE UNIQUE INDEX "mcp_server_configs_server_id_key" ON "mcp_server_configs"("server_id");
CREATE INDEX "mcp_server_configs_enabled_idx" ON "mcp_server_configs"("enabled");

-- CreateIndex: 能力使用统计索引
CREATE INDEX "capability_usages_capability_type_capability_id_idx" ON "capability_usages"("capability_type", "capability_id");
CREATE INDEX "capability_usages_created_at_idx" ON "capability_usages"("created_at");
