import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { PrismaModule } from "../../../common/prisma/prisma.module";
// 直接从文件导入，避免 barrel export 循环依赖
import { AiEngineModule } from "../../ai-engine/ai-engine.module";
import { CreditsModule } from "../../platform/credits/credits.module";
import { AiSimulationService } from "./ai-simulation.service";
import { AiSimulationController } from "./ai-simulation.controller";
import { AiSimulationEngineService } from "./ai-simulation.engine";
import { ExternalDataService } from "./external-data.service";
import { AIAssistService } from "./ai-assist.service";
import { AgentRegistry } from "@/modules/ai-harness/facade";
import { SimulatorAgent } from "./agents";

@Module({
  imports: [PrismaModule, AiEngineModule, CreditsModule],
  controllers: [AiSimulationController],
  providers: [
    AiSimulationService,
    AiSimulationEngineService,
    ExternalDataService,
    AIAssistService,
    SimulatorAgent,
  ],
  exports: [
    AiSimulationService,
    AiSimulationEngineService,
    ExternalDataService,
    AIAssistService,
  ],
})
export class AiSimulationModule implements OnModuleInit {
  private readonly logger = new Logger(AiSimulationModule.name);

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly simulatorAgent: SimulatorAgent,
  ) {}

  onModuleInit() {
    this.agentRegistry.register(this.simulatorAgent);
    this.logger.log("Registered SimulatorAgent to AgentRegistry");
  }
}
