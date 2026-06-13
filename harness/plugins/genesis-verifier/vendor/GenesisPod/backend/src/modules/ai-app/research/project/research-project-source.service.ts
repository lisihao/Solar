import { Injectable } from "@nestjs/common";
import { InputJsonValue } from "@prisma/client/runtime/library";
import { AddSourceDto, SearchSourcesDto } from "./dto";
import { SourceIngestionService } from "./source-ingestion.service";
import { SourceMetadataService } from "./source-metadata.service";
import { SourceQueryService } from "./source-query.service";

/**
 * Thin facade that preserves the original public API while delegating to
 * focused sub-services:
 *
 * - SourceIngestionService  — addSource / addSources / uploadFiles
 * - SourceQueryService      — getSources / getSource / removeSource / searchSources
 * - SourceMetadataService   — updateSourceAnalysis
 */
@Injectable()
export class ResearchProjectSourceService {
  constructor(
    private readonly ingestion: SourceIngestionService,
    private readonly query: SourceQueryService,
    private readonly metadata: SourceMetadataService,
  ) {}

  addSource(userId: string, projectId: string, dto: AddSourceDto) {
    return this.ingestion.addSource(userId, projectId, dto);
  }

  addSources(userId: string, projectId: string, sources: AddSourceDto[]) {
    return this.ingestion.addSources(userId, projectId, sources);
  }

  uploadFiles(userId: string, projectId: string, files: Express.Multer.File[]) {
    return this.ingestion.uploadFiles(userId, projectId, files);
  }

  getSources(userId: string, projectId: string) {
    return this.query.getSources(userId, projectId);
  }

  getSource(userId: string, projectId: string, sourceId: string) {
    return this.query.getSource(userId, projectId, sourceId);
  }

  removeSource(userId: string, projectId: string, sourceId: string) {
    return this.query.removeSource(userId, projectId, sourceId);
  }

  searchSources(userId: string, dto: SearchSourcesDto) {
    return this.query.searchSources(userId, dto);
  }

  updateSourceAnalysis(
    sourceId: string,
    status: "PENDING" | "ANALYZING" | "COMPLETED" | "FAILED",
    aiSummary?: string,
    keyInsights?: InputJsonValue,
  ) {
    return this.metadata.updateSourceAnalysis(
      sourceId,
      status,
      aiSummary,
      keyInsights,
    );
  }
}
