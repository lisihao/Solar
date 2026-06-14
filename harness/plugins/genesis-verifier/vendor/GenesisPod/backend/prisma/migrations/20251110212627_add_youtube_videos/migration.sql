-- CreateTable
CREATE TABLE "youtube_videos" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "video_id" VARCHAR(100) NOT NULL,
    "title" VARCHAR(1000) NOT NULL,
    "url" TEXT NOT NULL,
    "transcript" JSONB,
    "translated_text" TEXT,
    "ai_report" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "youtube_videos_user_id_idx" ON "youtube_videos"("user_id");

-- CreateIndex
CREATE INDEX "youtube_videos_created_at_idx" ON "youtube_videos"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "youtube_videos_user_id_video_id_key" ON "youtube_videos"("user_id", "video_id");

-- AddForeignKey
ALTER TABLE "youtube_videos" ADD CONSTRAINT "youtube_videos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
