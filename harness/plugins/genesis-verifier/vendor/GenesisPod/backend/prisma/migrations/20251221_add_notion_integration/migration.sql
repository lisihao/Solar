-- CreateEnum
CREATE TYPE "NotionConnectionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'ERROR');

-- CreateEnum
CREATE TYPE "NotionSyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "notion_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "workspace_name" TEXT,
    "workspace_icon" TEXT,
    "owner_type" TEXT NOT NULL DEFAULT 'user',
    "status" "NotionConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "sync_config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notion_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notion_pages" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "notion_page_id" TEXT NOT NULL,
    "title" VARCHAR(1000) NOT NULL,
    "icon" VARCHAR(200),
    "cover_url" TEXT,
    "url" TEXT NOT NULL,
    "parent_type" TEXT,
    "parent_id" TEXT,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "plain_text_content" TEXT,
    "notion_created_at" TIMESTAMP(3) NOT NULL,
    "notion_updated_at" TIMESTAMP(3) NOT NULL,
    "sync_status" "NotionSyncStatus" NOT NULL DEFAULT 'PENDING',
    "last_synced_at" TIMESTAMP(3),
    "sync_error" TEXT,
    "is_locally_modified" BOOLEAN NOT NULL DEFAULT false,
    "local_modified_at" TIMESTAMP(3),
    "linked_resource_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notion_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notion_databases" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "notion_db_id" TEXT NOT NULL,
    "title" VARCHAR(1000) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(200),
    "cover_url" TEXT,
    "url" TEXT NOT NULL,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "items" JSONB NOT NULL DEFAULT '[]',
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "sync_status" "NotionSyncStatus" NOT NULL DEFAULT 'PENDING',
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notion_databases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notion_block_versions" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "blocks" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notion_block_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notion_sync_history" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "status" "NotionSyncStatus" NOT NULL,
    "pages_processed" INTEGER NOT NULL DEFAULT 0,
    "pages_created" INTEGER NOT NULL DEFAULT 0,
    "pages_updated" INTEGER NOT NULL DEFAULT 0,
    "pages_deleted" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,

    CONSTRAINT "notion_sync_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notion_connections_user_id_idx" ON "notion_connections"("user_id");

-- CreateIndex
CREATE INDEX "notion_connections_status_idx" ON "notion_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "notion_connections_user_id_workspace_id_key" ON "notion_connections"("user_id", "workspace_id");

-- CreateIndex
CREATE INDEX "notion_pages_connection_id_idx" ON "notion_pages"("connection_id");

-- CreateIndex
CREATE INDEX "notion_pages_notion_page_id_idx" ON "notion_pages"("notion_page_id");

-- CreateIndex
CREATE INDEX "notion_pages_sync_status_idx" ON "notion_pages"("sync_status");

-- CreateIndex
CREATE INDEX "notion_pages_notion_updated_at_idx" ON "notion_pages"("notion_updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "notion_pages_connection_id_notion_page_id_key" ON "notion_pages"("connection_id", "notion_page_id");

-- CreateIndex
CREATE INDEX "notion_databases_connection_id_idx" ON "notion_databases"("connection_id");

-- CreateIndex
CREATE INDEX "notion_databases_notion_db_id_idx" ON "notion_databases"("notion_db_id");

-- CreateIndex
CREATE UNIQUE INDEX "notion_databases_connection_id_notion_db_id_key" ON "notion_databases"("connection_id", "notion_db_id");

-- CreateIndex
CREATE INDEX "notion_block_versions_page_id_version_idx" ON "notion_block_versions"("page_id", "version");

-- CreateIndex
CREATE INDEX "notion_sync_history_connection_id_started_at_idx" ON "notion_sync_history"("connection_id", "started_at");

-- AddForeignKey
ALTER TABLE "notion_connections" ADD CONSTRAINT "notion_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notion_pages" ADD CONSTRAINT "notion_pages_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "notion_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notion_databases" ADD CONSTRAINT "notion_databases_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "notion_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notion_block_versions" ADD CONSTRAINT "notion_block_versions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "notion_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notion_sync_history" ADD CONSTRAINT "notion_sync_history_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "notion_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
