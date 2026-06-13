-- ==================== Research Feedback Loop System ====================
-- 研究反馈闭环系统：收集、分析、沉淀用户对研究报告的反馈

-- ==================== Enums ====================

-- 反馈来源
DO $$
BEGIN
  CREATE TYPE "ResearchFeedbackSource" AS ENUM (
  'REPORT_ANNOTATION',  -- 来自报告批注
  'MANUAL',             -- 手动提交
  'SYSTEM'              -- 系统生成
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 反馈分类
DO $$
BEGIN
  CREATE TYPE "ResearchFeedbackCategory" AS ENUM (
  'QUALITY_ISSUE',      -- 质量问题（内容错误、逻辑不通）
  'FEATURE_REQUEST',    -- 功能建议
  'CONTENT_ERROR',      -- 内容错误（数据错误、引用错误）
  'IMPROVEMENT',        -- 改进建议（表述、结构）
  'POSITIVE'            -- 正面反馈
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 反馈处理状态
DO $$
BEGIN
  CREATE TYPE "ResearchFeedbackItemStatus" AS ENUM (
  'PENDING',            -- 待处理
  'ANALYZING',          -- AI 分析中
  'REVIEWING',          -- 人工审核中
  'APPROVED',           -- 已批准
  'REJECTED',           -- 已拒绝
  'APPLIED',            -- 已应用
  'CLOSED'              -- 已关闭
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 改进类型
DO $$
BEGIN
  CREATE TYPE "ImprovementType" AS ENUM (
  'PROMPT_UPDATE',      -- Prompt 模板更新
  'STRATEGY_CHANGE',    -- 研究策略调整
  'QUALITY_RULE',       -- 质量规则新增
  'DOCUMENTATION'       -- 文档更新
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==================== Tables ====================

-- 研究反馈处理记录
CREATE TABLE IF NOT EXISTS "research_feedback_items" (
  "id" TEXT NOT NULL,

  -- 来源（多态关联）
  "source_type" "ResearchFeedbackSource" NOT NULL,
  "source_id" TEXT,

  -- 内容
  "content" TEXT NOT NULL,
  "selected_text" TEXT,

  -- AI 分类结果
  "category" "ResearchFeedbackCategory" DEFAULT 'IMPROVEMENT',
  "subcategory" VARCHAR(100),
  "priority" "FeedbackPriority" NOT NULL DEFAULT 'NORMAL',
  "ai_analysis" JSONB,

  -- 处理状态
  "status" "ResearchFeedbackItemStatus" NOT NULL DEFAULT 'PENDING',
  "assigned_to" TEXT,

  -- 知识沉淀关联
  "knowledge_item_id" TEXT,
  "action_taken" TEXT,

  -- 元数据
  "topic_id" TEXT,
  "report_id" TEXT,
  "section_id" TEXT,
  "user_id" TEXT NOT NULL,

  -- 时间戳
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),

  CONSTRAINT "research_feedback_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_feedback_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "research_feedback_items_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "research_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "research_feedback_items_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "topic_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "research_feedback_items_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- 研究反馈知识条目
CREATE TABLE IF NOT EXISTS "research_feedback_knowledge" (
  "id" TEXT NOT NULL,
  "feedback_item_id" TEXT NOT NULL,

  -- 知识内容
  "title" VARCHAR(500) NOT NULL,
  "content" TEXT NOT NULL,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- 改进措施
  "improvement_type" "ImprovementType" NOT NULL,
  "improvement_data" JSONB,

  -- 效果追踪
  "applied_at" TIMESTAMP(3),
  "effect_score" DOUBLE PRECISION,
  "effect_notes" TEXT,

  -- 时间戳
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "research_feedback_knowledge_pkey" PRIMARY KEY ("id")
);

-- 添加知识条目外键（在知识表创建后）
ALTER TABLE "research_feedback_items"
  ADD CONSTRAINT "research_feedback_items_knowledge_item_id_fkey"
  FOREIGN KEY ("knowledge_item_id") REFERENCES "research_feedback_knowledge"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ==================== Indexes ====================

-- ResearchFeedbackItem indexes
CREATE INDEX IF NOT EXISTS "research_feedback_items_status_priority_idx" ON "research_feedback_items"("status", "priority");
CREATE INDEX IF NOT EXISTS "research_feedback_items_category_idx" ON "research_feedback_items"("category");
CREATE INDEX IF NOT EXISTS "research_feedback_items_topic_id_idx" ON "research_feedback_items"("topic_id");
CREATE INDEX IF NOT EXISTS "research_feedback_items_report_id_idx" ON "research_feedback_items"("report_id");
CREATE INDEX IF NOT EXISTS "research_feedback_items_user_id_idx" ON "research_feedback_items"("user_id");
CREATE INDEX IF NOT EXISTS "research_feedback_items_source_idx" ON "research_feedback_items"("source_type", "source_id");
CREATE INDEX IF NOT EXISTS "research_feedback_items_created_at_idx" ON "research_feedback_items"("created_at" DESC);

-- ResearchFeedbackKnowledge indexes
CREATE INDEX IF NOT EXISTS "research_feedback_knowledge_feedback_item_id_idx" ON "research_feedback_knowledge"("feedback_item_id");
CREATE INDEX IF NOT EXISTS "research_feedback_knowledge_improvement_type_idx" ON "research_feedback_knowledge"("improvement_type");
CREATE INDEX IF NOT EXISTS "research_feedback_knowledge_applied_at_idx" ON "research_feedback_knowledge"("applied_at");
