-- AI 前瞻（Foresight）P0：假设卡 + 加权影响边 + 信号 + 复核 + 置信度账本 + 结论
-- 设计来源 docs/demos/insight-graph-demo.html v0.4

CREATE TABLE IF NOT EXISTS "foresight_cards" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "card_key" VARCHAR(40) NOT NULL,
  "layer" VARCHAR(8) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "claim" TEXT NOT NULL,
  "conf" DOUBLE PRECISION NOT NULL,
  "sens" VARCHAR(8) NOT NULL,
  "horizon" INTEGER NOT NULL,
  "stage" VARCHAR(16) NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "falsifiers" JSONB NOT NULL DEFAULT '[]',
  "sources" JSONB NOT NULL DEFAULT '[]',
  "scenarios" JSONB,
  "origin_type" VARCHAR(24) NOT NULL DEFAULT 'manual',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "foresight_cards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "foresight_cards_user_id_card_key_key" ON "foresight_cards"("user_id", "card_key");
CREATE INDEX IF NOT EXISTS "foresight_cards_user_id_layer_idx" ON "foresight_cards"("user_id", "layer");

CREATE TABLE IF NOT EXISTS "foresight_edges" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "from_card_id" TEXT NOT NULL,
  "to_card_id" TEXT NOT NULL,
  "metric" VARCHAR(120) NOT NULL,
  "type" VARCHAR(12) NOT NULL DEFAULT 'flow',
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "foresight_edges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "foresight_edges_from_card_id_fkey" FOREIGN KEY ("from_card_id") REFERENCES "foresight_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "foresight_edges_to_card_id_fkey" FOREIGN KEY ("to_card_id") REFERENCES "foresight_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "foresight_edges_from_card_id_to_card_id_key" ON "foresight_edges"("from_card_id", "to_card_id");
CREATE INDEX IF NOT EXISTS "foresight_edges_user_id_idx" ON "foresight_edges"("user_id");
CREATE INDEX IF NOT EXISTS "foresight_edges_to_card_id_idx" ON "foresight_edges"("to_card_id");

CREATE TABLE IF NOT EXISTS "foresight_signals" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" VARCHAR(300) NOT NULL,
  "target_card_id" TEXT NOT NULL,
  "direction" VARCHAR(8) NOT NULL DEFAULT 'down',
  "target_conf" DOUBLE PRECISION NOT NULL,
  "effect" TEXT NOT NULL,
  "basis" JSONB NOT NULL DEFAULT '{}',
  "grade" VARCHAR(8) NOT NULL DEFAULT 'strong',
  "status" VARCHAR(12) NOT NULL DEFAULT 'candidate',
  "injected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "foresight_signals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "foresight_signals_user_id_status_idx" ON "foresight_signals"("user_id", "status");

CREATE TABLE IF NOT EXISTS "foresight_review_items" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "signal_id" TEXT NOT NULL,
  "card_id" TEXT NOT NULL,
  "impact" DOUBLE PRECISION NOT NULL,
  "depth" INTEGER NOT NULL,
  "is_source" BOOLEAN NOT NULL DEFAULT false,
  "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
  "decision" VARCHAR(8),
  "conf_from" DOUBLE PRECISION,
  "conf_to" DOUBLE PRECISION,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "foresight_review_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "foresight_review_items_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "foresight_signals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "foresight_review_items_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "foresight_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "foresight_review_items_user_id_status_idx" ON "foresight_review_items"("user_id", "status");
CREATE INDEX IF NOT EXISTS "foresight_review_items_card_id_status_idx" ON "foresight_review_items"("card_id", "status");

CREATE TABLE IF NOT EXISTS "foresight_conf_logs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "card_id" TEXT NOT NULL,
  "from_conf" DOUBLE PRECISION NOT NULL,
  "to_conf" DOUBLE PRECISION NOT NULL,
  "actor" VARCHAR(60) NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "foresight_conf_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "foresight_conf_logs_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "foresight_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "foresight_conf_logs_card_id_created_at_idx" ON "foresight_conf_logs"("card_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "foresight_conf_logs_user_id_idx" ON "foresight_conf_logs"("user_id");

CREATE TABLE IF NOT EXISTS "foresight_conclusions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "concl_key" VARCHAR(24) NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "body" TEXT NOT NULL,
  "decisions" JSONB NOT NULL DEFAULT '[]',
  "trigger" TEXT NOT NULL,
  "upstream_keys" TEXT[],
  "conf" DOUBLE PRECISION NOT NULL,
  "horizon" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "foresight_conclusions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "foresight_conclusions_user_id_concl_key_key" ON "foresight_conclusions"("user_id", "concl_key");
CREATE INDEX IF NOT EXISTS "foresight_conclusions_user_id_idx" ON "foresight_conclusions"("user_id");
