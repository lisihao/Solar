/**
 * A2A Client Service
 * 与外部 A2A Agent 通信的客户端服务
 */

import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import {
  A2AAgentCard,
  A2ATaskRequest,
  A2ATaskResponse,
  A2ATaskStatus,
  A2ATaskStatusResponse,
} from "../a2a.types";
import {
  sanitizeForLog,
  sanitizeError,
} from "@/common/utils/log-sanitizer.utils";

@Injectable()
export class A2AClientService {
  private readonly logger = new Logger(A2AClientService.name);
  private readonly httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      timeout: 30000, // 30s timeout
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  }

  /**
   * 获取 Agent Card（Agent 能力描述）
   */
  async discoverAgent(url: string): Promise<A2AAgentCard> {
    try {
      this.logger.log(`Discovering A2A agent at: ${url}`);

      const response = await this.httpClient.get<A2AAgentCard>(url);

      this.logger.log(`Successfully discovered agent: ${response.data.name}`);

      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to discover A2A agent at ${sanitizeForLog(url)}`,
        sanitizeError(error),
      );

      throw new Error(`Failed to discover A2A agent: ${sanitizeError(error)}`);
    }
  }

  /**
   * 创建任务
   */
  async createTask(
    agentUrl: string,
    taskRequest: A2ATaskRequest,
  ): Promise<A2ATaskResponse> {
    try {
      this.logger.log(
        `Creating task for skill: ${taskRequest.skillId} at ${agentUrl}`,
      );

      const response = await this.httpClient.post<A2ATaskResponse>(
        `${agentUrl}/tasks`,
        taskRequest,
      );

      this.logger.log(
        `Task created successfully: ${response.data.taskId} (status: ${response.data.status})`,
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to create task at ${sanitizeForLog(agentUrl)}`,
        sanitizeError(error),
      );

      throw new Error(`Failed to create A2A task: ${sanitizeError(error)}`);
    }
  }

  /**
   * 查询任务状态
   */
  async getTaskStatus(
    agentUrl: string,
    taskId: string,
  ): Promise<A2ATaskStatusResponse> {
    try {
      this.logger.debug(`Polling task status: ${taskId} at ${agentUrl}`);

      const response = await this.httpClient.get<A2ATaskStatusResponse>(
        `${agentUrl}/tasks/${taskId}`,
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to get task status for ${taskId} at ${sanitizeForLog(agentUrl)}`,
        sanitizeError(error),
      );

      throw new Error(`Failed to get A2A task status: ${sanitizeError(error)}`);
    }
  }

  /**
   * 轮询任务直到完成
   * @param agentUrl Agent URL
   * @param taskId 任务 ID
   * @param pollInterval 轮询间隔（毫秒）
   * @param maxAttempts 最大轮询次数
   */
  async pollTaskUntilComplete(
    agentUrl: string,
    taskId: string,
    pollInterval: number = 2000,
    maxAttempts: number = 150, // 最多 5 分钟（2s * 150）
  ): Promise<A2ATaskStatusResponse> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      const status = await this.getTaskStatus(agentUrl, taskId);

      // 如果任务完成或失败，返回
      if (
        status.status === A2ATaskStatus.COMPLETED ||
        status.status === A2ATaskStatus.FAILED ||
        status.status === A2ATaskStatus.CANCELLED
      ) {
        return status;
      }

      // 等待后继续轮询
      attempts++;
      await this.sleep(pollInterval);
    }

    throw new Error(
      `Task ${taskId} did not complete within maximum polling attempts`,
    );
  }

  /**
   * 睡眠辅助函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
