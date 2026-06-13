import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { RuntimeJournalModule } from "../../protocols/journal/journal.module";
import { RuntimeIpcModule } from "../../protocols/ipc/ipc.module";
import { RuntimeResourceModule } from "../../guardrails/resources/resource.module";
import { RuntimeMemoryModule } from "../../memory/working/memory.module";
import { ObservabilityModule } from "../../tracing/observability/observability.module";
import { TeamsModule } from "../../teams/teams.module";
import { ProcessManagerService } from "../../lifecycle/manager/process-manager.service";
import { ProcessSupervisorService } from "../../lifecycle/supervisor/process-supervisor.service";
import { MissionExecutorService } from "../../lifecycle/manager/mission-executor.service";
import { KernelSchedulerService } from "../../runner/scheduler/kernel-scheduler.service";
import { HarnessApiService } from "./harness-api.service";

const HARNESS_API_PROVIDERS = [
  ProcessManagerService,
  ProcessSupervisorService,
  MissionExecutorService,
  KernelSchedulerService,
  HarnessApiService,
];

@Global()
@Module({
  imports: [
    PrismaModule,
    RuntimeJournalModule,
    RuntimeIpcModule,
    RuntimeResourceModule,
    RuntimeMemoryModule,
    ObservabilityModule,
    TeamsModule,
  ],
  providers: HARNESS_API_PROVIDERS,
  exports: [
    RuntimeJournalModule,
    RuntimeIpcModule,
    RuntimeResourceModule,
    RuntimeMemoryModule,
    ObservabilityModule,
    TeamsModule,
    ...HARNESS_API_PROVIDERS,
  ],
})
export class HarnessApiModule {}
