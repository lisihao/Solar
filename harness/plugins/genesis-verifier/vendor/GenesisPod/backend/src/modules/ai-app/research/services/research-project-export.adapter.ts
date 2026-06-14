/**
 * Research Project Data Export Adapter
 *
 * Implements the IResearchProjectDataExport interface defined in the Office module.
 * Registered in ResearchModule and exported via RESEARCH_PROJECT_DATA_EXPORT token,
 * allowing Office to depend on the abstract interface rather than the
 * concrete ResearchModule.
 */

import { Injectable } from "@nestjs/common";
import {
  IResearchProjectDataExport,
  IExportableResearchProjectData,
  IResearchProjectListItem,
} from "../../contracts/interfaces/data-export.interface";
import { ResearchProjectExportService } from "./research-project-export.service";

@Injectable()
export class ResearchProjectExportAdapter implements IResearchProjectDataExport {
  constructor(
    private readonly researchProjectExportService: ResearchProjectExportService,
  ) {}

  getProjectForExport(
    projectId: string,
    userId: string,
  ): Promise<IExportableResearchProjectData> {
    return this.researchProjectExportService.getProjectForExport(
      projectId,
      userId,
    );
  }

  listProjectsForExport(
    userId: string,
    limit?: number,
  ): Promise<IResearchProjectListItem[]> {
    return this.researchProjectExportService.listProjectsForExport(
      userId,
      limit,
    );
  }
}
