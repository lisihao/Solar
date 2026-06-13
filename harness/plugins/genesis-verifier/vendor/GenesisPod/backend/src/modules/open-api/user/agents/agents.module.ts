import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AgentsController } from "./agents.controller";
import { AgentsService } from "./agents.service";
import { AgentsTaskQueueService } from "./agents-task-queue.service";
import { AgentsTaskProcessor } from "./agents-task.processor";
import { AiEngineModule } from "../../../ai-engine/ai-engine.module";
import { PrismaModule } from "../../../../common/prisma/prisma.module";

@Module({
  imports: [
    PrismaModule,
    AiEngineModule,
    // P0 durable queue：把 agents-api 异步任务从内存 fire-and-forget 迁到 BullMQ。
    // 仅 registerQueue —— BullMQ root（Redis 连接）由全局 BullModule.forRootAsync
    // 提供（RadarModule 注册的 shared config 是 global: true，全 app DI 可见，
    // 与导入顺序无关，因为 global provider 在 app 完成初始化后对所有模块可达）。
    BullModule.registerQueue({ name: AgentsTaskQueueService.QUEUE_NAME }),
  ],
  controllers: [AgentsController],
  providers: [AgentsService, AgentsTaskQueueService, AgentsTaskProcessor],
  exports: [AgentsService],
})
export class AgentsModule {}
