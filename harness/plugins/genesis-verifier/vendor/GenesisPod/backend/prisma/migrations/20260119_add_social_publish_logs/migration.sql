-- CreateTable
CREATE TABLE "social_publish_logs" (
    "id" TEXT NOT NULL,
    "content_id" TEXT NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "details" JSONB,
    "error_message" TEXT,
    "screenshot_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_publish_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_publish_logs_content_id_idx" ON "social_publish_logs"("content_id");

-- CreateIndex
CREATE INDEX "social_publish_logs_action_idx" ON "social_publish_logs"("action");

-- CreateIndex
CREATE INDEX "social_publish_logs_status_idx" ON "social_publish_logs"("status");

-- AddForeignKey
ALTER TABLE "social_publish_logs" ADD CONSTRAINT "social_publish_logs_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "social_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
