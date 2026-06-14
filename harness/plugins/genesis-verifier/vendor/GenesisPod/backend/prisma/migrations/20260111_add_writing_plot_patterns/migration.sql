-- CreateTable
CREATE TABLE "writing_plot_patterns" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "pattern_name" VARCHAR(100) NOT NULL,
    "pattern_type" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "use_count" INTEGER NOT NULL DEFAULT 1,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_chapter_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cooldown_chapters" INTEGER NOT NULL DEFAULT 20,
    "is_cooling_down" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_plot_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "writing_plot_patterns_project_id_pattern_type_idx" ON "writing_plot_patterns"("project_id", "pattern_type");

-- CreateIndex
CREATE UNIQUE INDEX "writing_plot_patterns_project_id_pattern_name_key" ON "writing_plot_patterns"("project_id", "pattern_name");

-- AddForeignKey
ALTER TABLE "writing_plot_patterns" ADD CONSTRAINT "writing_plot_patterns_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "writing_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
