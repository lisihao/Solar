-- CreateEnum
CREATE TYPE "SlidesSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SlidesCheckpointType" AS ENUM ('TASK_DECOMPOSITION', 'OUTLINE_CONFIRMED', 'PAGE_RENDERED', 'BATCH_RENDERED', 'USER_MODIFIED', 'AUTO_SAVE');

-- CreateTable
CREATE TABLE "slides_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" "SlidesSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_state_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slides_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slides_checkpoints" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "SlidesCheckpointType" NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "state_json" JSONB NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slides_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slides_sessions_user_id_updated_at_idx" ON "slides_sessions"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "slides_sessions_status_idx" ON "slides_sessions"("status");

-- CreateIndex
CREATE INDEX "slides_checkpoints_session_id_created_at_idx" ON "slides_checkpoints"("session_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "slides_checkpoints_type_idx" ON "slides_checkpoints"("type");

-- AddForeignKey
ALTER TABLE "slides_sessions" ADD CONSTRAINT "slides_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slides_checkpoints" ADD CONSTRAINT "slides_checkpoints_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "slides_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
