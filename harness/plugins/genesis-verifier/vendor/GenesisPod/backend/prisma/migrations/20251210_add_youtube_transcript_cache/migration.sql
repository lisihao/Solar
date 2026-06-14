-- CreateTable
CREATE TABLE "youtube_transcript_cache" (
    "id" TEXT NOT NULL,
    "video_id" VARCHAR(100) NOT NULL,
    "title" VARCHAR(1000),
    "transcript" JSONB NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_transcript_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "youtube_transcript_cache_video_id_key" ON "youtube_transcript_cache"("video_id");

-- CreateIndex
CREATE INDEX "youtube_transcript_cache_video_id_idx" ON "youtube_transcript_cache"("video_id");

-- CreateIndex
CREATE INDEX "youtube_transcript_cache_expires_at_idx" ON "youtube_transcript_cache"("expires_at");
