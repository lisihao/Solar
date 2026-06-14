import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { FeishuController } from "./feishu.controller";
import { FeishuDataSourceController } from "./feishu-data-source.controller";
import { FeishuService } from "./feishu.service";
import { FeishuAuthService } from "./feishu-auth.service";
import { FeishuCryptoService } from "./feishu-crypto.service";
import { FeishuDataSourceService } from "./feishu-data-source.service";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { RAGModule } from "../../rag/rag.module";
import { AiEngineModule } from "../../../../ai-engine/ai-engine.module";

@Module({
  imports: [HttpModule, PrismaModule, RAGModule, AiEngineModule],
  controllers: [FeishuController, FeishuDataSourceController],
  providers: [
    FeishuService,
    FeishuAuthService,
    FeishuCryptoService,
    FeishuDataSourceService,
  ],
  exports: [FeishuService, FeishuAuthService, FeishuDataSourceService],
})
export class FeishuModule {}
