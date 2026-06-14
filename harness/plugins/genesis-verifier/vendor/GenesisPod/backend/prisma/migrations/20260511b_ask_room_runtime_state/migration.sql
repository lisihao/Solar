CREATE TABLE "ask_room_session_runtime_states" (
  "session_id" TEXT NOT NULL,
  "max_emitted_seq" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ask_room_session_runtime_states_pkey" PRIMARY KEY ("session_id")
);
