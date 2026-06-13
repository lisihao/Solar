/**
 * AI Engine - Evidence Module
 * 证据管理模块
 */

import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { EvidenceManagerService } from "./services/evidence-manager.service";
import { CitationFormatterService } from "./services/citation-formatter.service";

@Module({
  imports: [PrismaModule],
  providers: [EvidenceManagerService, CitationFormatterService],
  exports: [EvidenceManagerService, CitationFormatterService],
})
export class EvidenceModule {}


