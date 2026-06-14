import { Module } from "@nestjs/common";
import { LibraryKnowledgeGraphService } from "./knowledge-graph.service.postgres";
import { KnowledgeGraphController } from "./knowledge-graph.controller";
import { KnowledgeController } from "./knowledge-admin.controller";
import { KnowledgeAdminService } from "./knowledge-admin.service";
import { GraphModule } from "../../../../common/graph/graph.module";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { AiEngineModule } from "../../../ai-engine/ai-engine.module";

/**
 * 知识图谱模块（使用 PostgreSQL 实现）
 */
@Module({
  imports: [GraphModule, PrismaModule, AiEngineModule],
  controllers: [KnowledgeGraphController, KnowledgeController],
  providers: [LibraryKnowledgeGraphService, KnowledgeAdminService],
  exports: [LibraryKnowledgeGraphService, KnowledgeAdminService],
})
export class KnowledgeGraphModule {}
