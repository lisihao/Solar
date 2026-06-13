import { Injectable } from "@nestjs/common";
import { isWorkspaceAiV2Enabled } from "./common/utils/feature-flags";
import { APP_CONFIG } from "./common/config/app.config";

export interface AppInfo {
  message: string;
  version: string;
  docs: string;
  health: string;
  workspaceAiV2Enabled: boolean;
}

@Injectable()
export class AppService {
  getHello(): AppInfo {
    return {
      message: `Welcome to ${APP_CONFIG.brand.fullName} API`,
      version: "1.0.0",
      docs: "/api/v1",
      health: "/api/v1/health",
      workspaceAiV2Enabled: isWorkspaceAiV2Enabled(),
    };
  }
}
