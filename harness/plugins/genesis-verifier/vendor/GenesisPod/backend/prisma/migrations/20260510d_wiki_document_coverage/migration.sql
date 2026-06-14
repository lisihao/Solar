-- Track which KB source documents are actually covered by the current wiki
-- state. Auto-ingest must key off applied coverage, not diff proposal time.

CREATE TABLE "wiki_document_coverages" (
  "knowledge_base_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "last_covered_document_updated_at" TIMESTAMP(3) NOT NULL,
  "last_applied_diff_id" TEXT NOT NULL,
  "last_applied_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wiki_document_coverages_pkey"
    PRIMARY KEY ("knowledge_base_id", "document_id"),
  CONSTRAINT "wiki_document_coverages_knowledge_base_id_fkey"
    FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "wiki_document_coverages_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "knowledge_base_documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "wiki_document_coverages_last_applied_diff_id_fkey"
    FOREIGN KEY ("last_applied_diff_id") REFERENCES "wiki_diffs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "wiki_document_coverages_knowledge_base_id_last_applied_at_idx"
  ON "wiki_document_coverages"("knowledge_base_id", "last_applied_at");

CREATE INDEX "wiki_document_coverages_document_id_idx"
  ON "wiki_document_coverages"("document_id");
