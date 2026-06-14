-- ════════════════════════════════════════════════════════════════════
-- LLM Wiki v1.5.3 — schema initialization (P0b)
-- ════════════════════════════════════════════════════════════════════
-- Idempotent (IF NOT EXISTS on every CREATE) so Railway re-runs are safe.
-- Includes the wiki_diffs.affected_slugs GIN partial index that Prisma DSL
-- cannot express. SetNull onDelete on 3 FKs preserves operational history
-- when pages/ops are deleted (revisions, op-page links, lint findings).
-- ════════════════════════════════════════════════════════════════════

-- ─── Extend existing enums ──────────────────────────────────────────
DO $$ BEGIN
  ALTER TYPE "ExportSourceType" ADD VALUE IF NOT EXISTS 'WIKI';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "ExportFormat" ADD VALUE IF NOT EXISTS 'TARBALL';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Extend KnowledgeBase with wikiEnabled flag ─────────────────────
ALTER TABLE "knowledge_bases"
  ADD COLUMN IF NOT EXISTS "wiki_enabled" BOOLEAN NOT NULL DEFAULT false;

-- ─── New enums for wiki tables ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "WikiPageCategory" AS ENUM ('ENTITY', 'CONCEPT', 'SUMMARY', 'SOURCE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WikiPageEditedBy" AS ENUM ('USER', 'LLM', 'IMPORT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WikiPageEmbedResolution" AS ENUM ('ONELINER', 'BODY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WikiDiffStatus" AS ENUM ('PENDING', 'APPLIED', 'DISMISSED', 'CONFLICTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WikiOp" AS ENUM ('INGEST', 'LINT', 'EDIT', 'REVERT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WikiOpPageRole" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'AFFECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WikiLintType" AS ENUM ('CONTRADICTION', 'STALE', 'ORPHAN', 'MISSING_XREF', 'DATA_GAP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 1. wiki_pages ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wiki_pages" (
  "id" TEXT NOT NULL,
  "knowledge_base_id" TEXT NOT NULL,
  "slug" VARCHAR(200) NOT NULL,
  "title" VARCHAR(500) NOT NULL,
  "category" "WikiPageCategory" NOT NULL,
  "body" TEXT NOT NULL,
  "one_liner" VARCHAR(280) NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  "last_edited_by" "WikiPageEditedBy" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wiki_pages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wiki_pages_knowledge_base_id_slug_key"
  ON "wiki_pages"("knowledge_base_id", "slug");
CREATE INDEX IF NOT EXISTS "wiki_pages_knowledge_base_id_category_idx"
  ON "wiki_pages"("knowledge_base_id", "category");
CREATE INDEX IF NOT EXISTS "wiki_pages_knowledge_base_id_updated_at_idx"
  ON "wiki_pages"("knowledge_base_id", "updated_at");

DO $$ BEGIN
  ALTER TABLE "wiki_pages"
    ADD CONSTRAINT "wiki_pages_knowledge_base_id_fkey"
    FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 2. wiki_page_sources ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wiki_page_sources" (
  "id" TEXT NOT NULL,
  "page_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "span_start" INTEGER NOT NULL,
  "span_end" INTEGER NOT NULL,
  "quote" TEXT NOT NULL,
  CONSTRAINT "wiki_page_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wiki_page_sources_page_id_document_id_span_start_key"
  ON "wiki_page_sources"("page_id", "document_id", "span_start");
CREATE INDEX IF NOT EXISTS "wiki_page_sources_document_id_idx"
  ON "wiki_page_sources"("document_id");

DO $$ BEGIN
  ALTER TABLE "wiki_page_sources"
    ADD CONSTRAINT "wiki_page_sources_page_id_fkey"
    FOREIGN KEY ("page_id") REFERENCES "wiki_pages"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "wiki_page_sources"
    ADD CONSTRAINT "wiki_page_sources_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "knowledge_base_documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 3. wiki_page_links ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wiki_page_links" (
  "from_page_id" TEXT NOT NULL,
  "to_slug" VARCHAR(200) NOT NULL,
  CONSTRAINT "wiki_page_links_pkey" PRIMARY KEY ("from_page_id", "to_slug")
);

CREATE INDEX IF NOT EXISTS "wiki_page_links_to_slug_idx"
  ON "wiki_page_links"("to_slug");

DO $$ BEGIN
  ALTER TABLE "wiki_page_links"
    ADD CONSTRAINT "wiki_page_links_from_page_id_fkey"
    FOREIGN KEY ("from_page_id") REFERENCES "wiki_pages"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 4. wiki_page_revisions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wiki_page_revisions" (
  "id" TEXT NOT NULL,
  "page_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  "op_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wiki_page_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wiki_page_revisions_page_id_created_at_idx"
  ON "wiki_page_revisions"("page_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "wiki_page_revisions_op_id_idx"
  ON "wiki_page_revisions"("op_id");

DO $$ BEGIN
  ALTER TABLE "wiki_page_revisions"
    ADD CONSTRAINT "wiki_page_revisions_page_id_fkey"
    FOREIGN KEY ("page_id") REFERENCES "wiki_pages"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- op_id FK added later after wiki_operation_logs is created (forward reference)

-- ─── 5. wiki_page_embeddings ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wiki_page_embeddings" (
  "id" TEXT NOT NULL,
  "page_id" TEXT NOT NULL,
  "resolution" "WikiPageEmbedResolution" NOT NULL,
  "embedding" JSONB NOT NULL,
  "model" TEXT NOT NULL DEFAULT '',
  "dimensions" INTEGER NOT NULL DEFAULT 1536,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wiki_page_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wiki_page_embeddings_page_id_resolution_key"
  ON "wiki_page_embeddings"("page_id", "resolution");

DO $$ BEGIN
  ALTER TABLE "wiki_page_embeddings"
    ADD CONSTRAINT "wiki_page_embeddings_page_id_fkey"
    FOREIGN KEY ("page_id") REFERENCES "wiki_pages"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 6. wiki_diffs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wiki_diffs" (
  "id" TEXT NOT NULL,
  "knowledge_base_id" TEXT NOT NULL,
  "status" "WikiDiffStatus" NOT NULL DEFAULT 'PENDING',
  "items" JSONB NOT NULL,
  "baseline_hash" VARCHAR(64) NOT NULL,
  "affected_slugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_at" TIMESTAMP(3),
  "dismissed_at" TIMESTAMP(3),
  CONSTRAINT "wiki_diffs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wiki_diffs_knowledge_base_id_status_idx"
  ON "wiki_diffs"("knowledge_base_id", "status");

-- ★ GIN partial index on affected_slugs for status='PENDING' (slug-set conflict
-- detection): scanning only PENDING rows is far cheaper than full table scan.
-- Prisma DSL cannot express partial index → hand-written here.
CREATE INDEX IF NOT EXISTS "wiki_diffs_affected_slugs_gin"
  ON "wiki_diffs" USING GIN ("affected_slugs")
  WHERE "status" = 'PENDING';

DO $$ BEGIN
  ALTER TABLE "wiki_diffs"
    ADD CONSTRAINT "wiki_diffs_knowledge_base_id_fkey"
    FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 7. wiki_operation_logs ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wiki_operation_logs" (
  "id" TEXT NOT NULL,
  "knowledge_base_id" TEXT NOT NULL,
  "op" "WikiOp" NOT NULL,
  "title" VARCHAR(500) NOT NULL,
  "meta" JSONB NOT NULL DEFAULT '{}',
  "actor_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wiki_operation_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wiki_operation_logs_knowledge_base_id_created_at_idx"
  ON "wiki_operation_logs"("knowledge_base_id", "created_at" DESC);

DO $$ BEGIN
  ALTER TABLE "wiki_operation_logs"
    ADD CONSTRAINT "wiki_operation_logs_knowledge_base_id_fkey"
    FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Now we can safely add the forward-referenced wiki_page_revisions.op_id FK:
DO $$ BEGIN
  ALTER TABLE "wiki_page_revisions"
    ADD CONSTRAINT "wiki_page_revisions_op_id_fkey"
    FOREIGN KEY ("op_id") REFERENCES "wiki_operation_logs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 8. wiki_operation_log_pages ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wiki_operation_log_pages" (
  "id" TEXT NOT NULL,
  "op_id" TEXT NOT NULL,
  "page_id" TEXT,
  "role" "WikiOpPageRole" NOT NULL,
  CONSTRAINT "wiki_operation_log_pages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wiki_operation_log_pages_op_id_page_id_role_key"
  ON "wiki_operation_log_pages"("op_id", "page_id", "role");
CREATE INDEX IF NOT EXISTS "wiki_operation_log_pages_page_id_op_id_idx"
  ON "wiki_operation_log_pages"("page_id", "op_id");

DO $$ BEGIN
  ALTER TABLE "wiki_operation_log_pages"
    ADD CONSTRAINT "wiki_operation_log_pages_op_id_fkey"
    FOREIGN KEY ("op_id") REFERENCES "wiki_operation_logs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "wiki_operation_log_pages"
    ADD CONSTRAINT "wiki_operation_log_pages_page_id_fkey"
    FOREIGN KEY ("page_id") REFERENCES "wiki_pages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 9. wiki_lint_findings ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wiki_lint_findings" (
  "id" TEXT NOT NULL,
  "knowledge_base_id" TEXT NOT NULL,
  "type" "WikiLintType" NOT NULL,
  "page_id" TEXT,
  "detail" JSONB NOT NULL,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wiki_lint_findings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wiki_lint_findings_knowledge_base_id_resolved_at_type_idx"
  ON "wiki_lint_findings"("knowledge_base_id", "resolved_at", "type");
CREATE INDEX IF NOT EXISTS "wiki_lint_findings_page_id_idx"
  ON "wiki_lint_findings"("page_id");

DO $$ BEGIN
  ALTER TABLE "wiki_lint_findings"
    ADD CONSTRAINT "wiki_lint_findings_knowledge_base_id_fkey"
    FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "wiki_lint_findings"
    ADD CONSTRAINT "wiki_lint_findings_page_id_fkey"
    FOREIGN KEY ("page_id") REFERENCES "wiki_pages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 10. wiki_knowledge_base_configs ────────────────────────────────
CREATE TABLE IF NOT EXISTS "wiki_knowledge_base_configs" (
  "knowledge_base_id" TEXT NOT NULL,
  "inline_page_count" INTEGER NOT NULL DEFAULT 200,
  "inline_token_budget" INTEGER NOT NULL DEFAULT 500000,
  "ingest_max_tokens" INTEGER NOT NULL DEFAULT 80000,
  "cron_lint_enabled" BOOLEAN NOT NULL DEFAULT true,
  "cron_lint_daily_budget_calls" INTEGER NOT NULL DEFAULT 50,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wiki_knowledge_base_configs_pkey" PRIMARY KEY ("knowledge_base_id")
);

DO $$ BEGIN
  ALTER TABLE "wiki_knowledge_base_configs"
    ADD CONSTRAINT "wiki_knowledge_base_configs_knowledge_base_id_fkey"
    FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
