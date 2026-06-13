-- CreateEnum for SimulationTeam
DO $$ BEGIN
 CREATE TYPE "SimulationTeam" AS ENUM ('BLUE', 'RED', 'GREEN', 'CHAOS');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- CreateEnum for SimulationRunStatus
DO $$ BEGIN
 CREATE TYPE "SimulationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- CreateTable simulation_scenarios
CREATE TABLE IF NOT EXISTS "simulation_scenarios" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "name" VARCHAR(200) NOT NULL,
    "industry" VARCHAR(100) NOT NULL,
    "region" VARCHAR(100),
    "goals" JSONB,
    "constraints" JSONB,
    "dataSources" JSONB,
    "createdById" VARCHAR(36),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulation_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable simulation_companies
CREATE TABLE IF NOT EXISTS "simulation_companies" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "scenarioId" VARCHAR(36) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" VARCHAR(50),
    "market" VARCHAR(100),
    "metrics" JSONB,
    "publicData" JSONB,
    "privateData" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulation_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable simulation_agents
CREATE TABLE IF NOT EXISTS "simulation_agents" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "scenarioId" VARCHAR(36) NOT NULL,
    "companyId" VARCHAR(36),
    "team" "SimulationTeam" NOT NULL DEFAULT 'BLUE',
    "role" VARCHAR(100) NOT NULL,
    "persona" JSONB,
    "memoryPublic" JSONB,
    "memoryPrivate" JSONB,
    "tools" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulation_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable simulation_runs
CREATE TABLE IF NOT EXISTS "simulation_runs" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "scenarioId" VARCHAR(36) NOT NULL,
    "status" "SimulationRunStatus" NOT NULL DEFAULT 'PENDING',
    "params" JSONB,
    "rounds" INTEGER NOT NULL DEFAULT 2,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "worldState" JSONB,
    "evidenceTrail" JSONB,
    "summary" JSONB,
    "startedById" VARCHAR(36),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "simulation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable simulation_turns
CREATE TABLE IF NOT EXISTS "simulation_turns" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "runId" VARCHAR(36) NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "submissions" JSONB,
    "adjudication" JSONB,
    "evidence" JSONB,
    "worldState" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulation_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable _TurnAgents (many-to-many relationship)
CREATE TABLE IF NOT EXISTS "_TurnAgents" (
    "A" VARCHAR(36) NOT NULL,
    "B" VARCHAR(36) NOT NULL
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "simulation_scenarios_industry_idx" ON "simulation_scenarios"("industry");
CREATE INDEX IF NOT EXISTS "simulation_companies_scenarioId_idx" ON "simulation_companies"("scenarioId");
CREATE INDEX IF NOT EXISTS "simulation_agents_scenarioId_idx" ON "simulation_agents"("scenarioId");
CREATE INDEX IF NOT EXISTS "simulation_agents_companyId_idx" ON "simulation_agents"("companyId");
CREATE INDEX IF NOT EXISTS "simulation_agents_team_idx" ON "simulation_agents"("team");
CREATE INDEX IF NOT EXISTS "simulation_runs_scenarioId_idx" ON "simulation_runs"("scenarioId");
CREATE INDEX IF NOT EXISTS "simulation_runs_status_idx" ON "simulation_runs"("status");
CREATE INDEX IF NOT EXISTS "simulation_turns_runId_roundNumber_idx" ON "simulation_turns"("runId", "roundNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "_TurnAgents_AB_unique" ON "_TurnAgents"("A", "B");
CREATE INDEX IF NOT EXISTS "_TurnAgents_B_index" ON "_TurnAgents"("B");

-- AddForeignKey
ALTER TABLE "simulation_companies" ADD CONSTRAINT "simulation_companies_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "simulation_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_agents" ADD CONSTRAINT "simulation_agents_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "simulation_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_agents" ADD CONSTRAINT "simulation_agents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "simulation_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "simulation_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_turns" ADD CONSTRAINT "simulation_turns_runId_fkey" FOREIGN KEY ("runId") REFERENCES "simulation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TurnAgents" ADD CONSTRAINT "_TurnAgents_A_fkey" FOREIGN KEY ("A") REFERENCES "simulation_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TurnAgents" ADD CONSTRAINT "_TurnAgents_B_fkey" FOREIGN KEY ("B") REFERENCES "simulation_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
