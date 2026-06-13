import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";

interface CreateAiTaskPayload {
  workspaceId: string;
  templateId: string;
  model: string;
  resources: Array<Record<string, unknown>>;
  question?: string;
  overrides?: Record<string, unknown>;
  resourceIds?: string[];
}

@Injectable()
export class WorkspaceAiClient {
  private readonly logger = new Logger(WorkspaceAiClient.name);
  private readonly http: AxiosInstance;
  private readonly apiBase: string;

  constructor() {
    const baseUrl = process.env.AI_SERVICE_URL || "http://localhost:5000";
    this.apiBase = `${baseUrl.replace(/\/$/, "")}/api/v1`;
    this.http = axios.create({
      baseURL: this.apiBase,
      timeout: Number(process.env.AI_SERVICE_TIMEOUT ?? 60000),
    });
  }

  async createTask(payload: CreateAiTaskPayload) {
    this.logger.debug(
      `Creating AI workspace task (template=${payload.templateId})`,
    );
    const response = await this.http.post("/workspace-tasks", {
      workspaceId: payload.workspaceId,
      templateId: payload.templateId,
      model: payload.model,
      resources: payload.resources,
      question: payload.question,
      overrides: payload.overrides,
      resourceIds: payload.resourceIds,
    });
    return response.data;
  }

  async getTaskStatus(taskId: string) {
    this.logger.debug(`Fetching AI workspace task status (taskId=${taskId})`);
    const response = await this.http.get(`/workspace-tasks/${taskId}`);
    return response.data;
  }
}
