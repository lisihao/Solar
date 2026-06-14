CREATE TABLE "mission_election_states" (
  "mission_id" TEXT NOT NULL,
  "committed_model_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "reservations" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mission_election_states_pkey" PRIMARY KEY ("mission_id")
);
