import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AiEngineModule } from "../../../ai-engine/ai-engine.module";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { SecretsModule } from "../../../platform/credentials/storage/secrets/secrets.module";

@Module({
  imports: [PrismaModule, AiEngineModule, SecretsModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
