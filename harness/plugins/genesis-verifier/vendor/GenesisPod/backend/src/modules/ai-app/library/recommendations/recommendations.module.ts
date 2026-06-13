import { Module } from "@nestjs/common";
import { RecommendationsService } from "./recommendations.service.postgres";
import { RecommendationsController } from "./recommendations.controller";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { GraphModule } from "../../../../common/graph/graph.module";

/**
 * 推荐系统模块（使用 PostgreSQL 实现）
 */
@Module({
  imports: [PrismaModule, GraphModule],
  controllers: [RecommendationsController],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
