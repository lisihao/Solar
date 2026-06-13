/**
 * Writing Data Export Adapter
 *
 * Implements the IWritingDataExport interface defined in the Office module.
 * Registered in AiWritingModule and exported via WRITING_DATA_EXPORT token,
 * allowing Office to depend on the abstract interface rather than the
 * concrete AiWritingModule.
 */

import { Injectable } from "@nestjs/common";
import {
  IWritingDataExport,
  IExportableWritingData,
  IWritingListItem,
} from "../../contracts/interfaces/data-export.interface";
import { WritingDataExportService } from "./writing-data-export.service";

@Injectable()
export class WritingDataExportAdapter implements IWritingDataExport {
  constructor(
    private readonly writingDataExportService: WritingDataExportService,
  ) {}

  getProjectForExport(
    projectId: string,
    userId: string,
  ): Promise<IExportableWritingData> {
    return this.writingDataExportService.getProjectForExport(projectId, userId);
  }

  listProjectsForExport(
    userId: string,
    limit?: number,
  ): Promise<IWritingListItem[]> {
    return this.writingDataExportService.listProjectsForExport(userId, limit);
  }
}
