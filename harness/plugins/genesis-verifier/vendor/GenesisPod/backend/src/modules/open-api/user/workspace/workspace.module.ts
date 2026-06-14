import { Module } from "@nestjs/common";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "./workspace.service";
import { WorkspaceTaskService } from "./workspace-task.service";
import { ReportTemplateService } from "./report-template.service";
import { WorkspaceAiClient } from "./workspace-ai.client";

@Module({
  controllers: [WorkspaceController],
  providers: [
    WorkspaceService,
    WorkspaceTaskService,
    ReportTemplateService,
    WorkspaceAiClient,
  ],
  exports: [
    WorkspaceService,
    WorkspaceTaskService,
    ReportTemplateService,
    WorkspaceAiClient,
  ],
})
export class WorkspaceModule {}
