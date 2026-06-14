import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { InputJsonValue } from "@prisma/client/runtime/library";

@Injectable()
export class SourceMetadataService {
  private readonly logger = new Logger(SourceMetadataService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Update source analysis status and AI-extracted metadata
   */
  async updateSourceAnalysis(
    sourceId: string,
    status: "PENDING" | "ANALYZING" | "COMPLETED" | "FAILED",
    aiSummary?: string,
    keyInsights?: InputJsonValue,
  ) {
    this.logger.log(
      `Updating analysis status for source ${sourceId}: ${status}`,
    );
    return this.prisma.researchProjectSource.update({
      where: { id: sourceId },
      data: {
        analysisStatus: status,
        ...(aiSummary && { aiSummary }),
        ...(keyInsights && { keyInsights }),
      },
    });
  }
}
