-- CreateTable: writing_quality_scores
-- This table stores quality assessment scores for each chapter

CREATE TABLE "writing_quality_scores" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,

    -- 多样性评分
    "diversity_score" DECIMAL(3,2) NOT NULL,
    "vocabulary_richness" DECIMAL(3,2) NOT NULL,
    "sentence_variety" DECIMAL(3,2) NOT NULL,
    "expression_novelty" DECIMAL(3,2) NOT NULL,

    -- 角色一致性评分
    "character_consistency" DECIMAL(3,2) NOT NULL,
    "dialogue_authenticity" DECIMAL(3,2) NOT NULL,

    -- 情节评分
    "plot_novelty" DECIMAL(3,2) NOT NULL,
    "narrative_flow" DECIMAL(3,2) NOT NULL,

    -- 史实/设定准确性
    "setting_accuracy" DECIMAL(3,2) NOT NULL,

    -- 综合评分
    "overall_score" DECIMAL(3,2) NOT NULL,

    -- 问题列表
    "issues" JSONB NOT NULL DEFAULT '[]',

    -- 是否通过质量门禁
    "passed_gate" BOOLEAN NOT NULL DEFAULT false,
    "rewrite_count" INTEGER NOT NULL DEFAULT 0,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "writing_quality_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "writing_quality_scores_project_id_idx" ON "writing_quality_scores"("project_id");

-- CreateIndex
CREATE INDEX "writing_quality_scores_chapter_id_idx" ON "writing_quality_scores"("chapter_id");

-- CreateIndex
CREATE UNIQUE INDEX "writing_quality_scores_project_id_chapter_id_key" ON "writing_quality_scores"("project_id", "chapter_id");

-- AddForeignKey
ALTER TABLE "writing_quality_scores" ADD CONSTRAINT "writing_quality_scores_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "writing_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
