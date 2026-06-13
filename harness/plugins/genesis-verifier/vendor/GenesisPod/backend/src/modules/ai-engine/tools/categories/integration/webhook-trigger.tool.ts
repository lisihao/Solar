/**
 * Webhook Trigger Tool
 * Webhook 触发工具 - 支持发送 HTTP 请求到 Webhook 端点
 */

import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosRequestConfig } from "axios";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";

// ============================================================================
// Types
// ============================================================================

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface WebhookTriggerInput {
  /**
   * Webhook URL
   */
  url: string;

  /**
   * HTTP 方法
   */
  method?: HttpMethod;

  /**
   * 请求头
   */
  headers?: Record<string, string>;

  /**
   * 请求体
   */
  payload?: unknown;

  /**
   * 查询参数
   */
  queryParams?: Record<string, string>;

  /**
   * 超时时间（毫秒）
   */
  timeout?: number;

  /**
   * 重试次数
   */
  retries?: number;

  /**
   * 重试间隔（毫秒）
   */
  retryDelay?: number;

  /**
   * 认证配置
   */
  auth?: {
    /**
     * 认证类型
     */
    type: "basic" | "bearer" | "api_key";

    /**
     * 用户名（Basic Auth）
     */
    username?: string;

    /**
     * 密码（Basic Auth）
     */
    password?: string;

    /**
     * Token（Bearer Auth）
     */
    token?: string;

    /**
     * API Key 名称
     */
    apiKeyName?: string;

    /**
     * API Key 值
     */
    apiKeyValue?: string;

    /**
     * API Key 位置
     */
    apiKeyIn?: "header" | "query";
  };

  /**
   * 是否验证 SSL 证书
   */
  validateSsl?: boolean;

  /**
   * 是否等待响应
   */
  waitForResponse?: boolean;
}

export interface WebhookTriggerOutput {
  /**
   * 是否成功
   */
  success: boolean;

  /**
   * HTTP 状态码
   */
  statusCode?: number;

  /**
   * 状态文本
   */
  statusText?: string;

  /**
   * 响应头
   */
  headers?: Record<string, string>;

  /**
   * 响应体
   */
  body?: unknown;

  /**
   * 请求耗时（毫秒）
   */
  duration?: number;

  /**
   * 重试次数
   */
  retriesUsed?: number;

  /**
   * 请求 ID（用于追踪）
   */
  requestId?: string;

  /**
   * 错误信息
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class WebhookTriggerTool extends BaseTool<
  WebhookTriggerInput,
  WebhookTriggerOutput
> {
  private readonly logger = new Logger(WebhookTriggerTool.name);

  readonly id = "webhook-trigger";
  readonly sideEffect = "destructive" as const;
  readonly category: ToolCategory = "integration";
  readonly tags = ["integration", "webhook", "http", "trigger", "callback"];
  readonly name = "Webhook 触发";
  readonly description =
    "触发 Webhook，发送 HTTP 请求到指定端点。支持自定义请求方法、请求头、请求体、认证方式、重试策略等。适用于系统集成、自动化工作流等场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      url: {
        type: "string",
        format: "uri",
        description: "Webhook URL",
      },
      method: {
        type: "string",
        description: "HTTP 方法",
        enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        default: "POST",
      },
      headers: {
        type: "object",
        description: "请求头",
        additionalProperties: { type: "string" },
      },
      payload: {
        type: "object",
        description: "请求体（JSON 对象）",
      },
      queryParams: {
        type: "object",
        description: "查询参数",
        additionalProperties: { type: "string" },
      },
      timeout: {
        type: "number",
        description: "超时时间（毫秒）",
        default: 30000,
        minimum: 1000,
        maximum: 300000,
      },
      retries: {
        type: "number",
        description: "重试次数",
        default: 0,
        minimum: 0,
        maximum: 5,
      },
      retryDelay: {
        type: "number",
        description: "重试间隔（毫秒）",
        default: 1000,
      },
      auth: {
        type: "object",
        description: "认证配置",
        properties: {
          type: {
            type: "string",
            enum: ["basic", "bearer", "api_key"],
          },
          username: { type: "string" },
          password: { type: "string" },
          token: { type: "string" },
          apiKeyName: { type: "string" },
          apiKeyValue: { type: "string" },
          apiKeyIn: { type: "string", enum: ["header", "query"] },
        },
      },
      validateSsl: {
        type: "boolean",
        description: "是否验证 SSL 证书",
        default: true,
      },
      waitForResponse: {
        type: "boolean",
        description: "是否等待响应",
        default: true,
      },
    },
    required: ["url"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean", description: "是否成功" },
      statusCode: { type: "number", description: "HTTP 状态码" },
      statusText: { type: "string", description: "状态文本" },
      headers: { type: "object", description: "响应头" },
      body: { type: "object", description: "响应体" },
      duration: { type: "number", description: "请求耗时（毫秒）" },
      retriesUsed: { type: "number", description: "使用的重试次数" },
      requestId: { type: "string", description: "请求 ID" },
      error: { type: "string", description: "错误信息" },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property
  }

  validateInput(input: WebhookTriggerInput) {
    if (!input.url) {
      return false;
    }

    // 验证 URL 格式
    try {
      new URL(input.url);
    } catch {
      return false;
    }

    // 验证认证配置
    if (input.auth) {
      switch (input.auth.type) {
        case "basic":
          if (!input.auth.username || !input.auth.password) return false;
          break;
        case "bearer":
          if (!input.auth.token) return false;
          break;
        case "api_key":
          if (!input.auth.apiKeyName || !input.auth.apiKeyValue) return false;
          break;
      }
    }

    return true;
  }

  protected async doExecute(
    input: WebhookTriggerInput,
    _context: ToolContext,
  ): Promise<WebhookTriggerOutput> {
    const {
      url,
      method = "POST",
      headers = {},
      payload,
      queryParams,
      timeout = 30000,
      retries = 0,
      retryDelay = 1000,
      auth,
      waitForResponse = true,
    } = input;

    this.logger.log(`[doExecute] Triggering webhook: ${method} ${url}`);

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const startTime = Date.now();
    let retriesUsed = 0;

    try {
      // 构建请求头
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
        ...headers,
      };

      // 添加认证头
      if (auth) {
        this.applyAuth(requestHeaders, queryParams || {}, auth);
      }

      // 模拟 HTTP 请求
      // 实际实现应使用 axios 或 fetch
      const response = await this.executeRequest(
        url,
        method,
        requestHeaders,
        payload,
        queryParams,
        timeout,
        retries,
        retryDelay,
        waitForResponse,
      );

      retriesUsed = response.retriesUsed || 0;

      return {
        success: response.statusCode >= 200 && response.statusCode < 300,
        statusCode: response.statusCode,
        statusText: response.statusText,
        headers: response.headers,
        body: response.body,
        duration: Date.now() - startTime,
        retriesUsed,
        requestId,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`[doExecute] Webhook trigger failed: ${errorMessage}`);

      return {
        success: false,
        duration: Date.now() - startTime,
        retriesUsed,
        requestId,
        error: errorMessage,
      };
    }
  }

  private applyAuth(
    headers: Record<string, string>,
    queryParams: Record<string, string>,
    auth: NonNullable<WebhookTriggerInput["auth"]>,
  ): void {
    switch (auth.type) {
      case "basic":
        const credentials = Buffer.from(
          `${auth.username}:${auth.password}`,
        ).toString("base64");
        headers["Authorization"] = `Basic ${credentials}`;
        break;

      case "bearer":
        headers["Authorization"] = `Bearer ${auth.token}`;
        break;

      case "api_key":
        if (auth.apiKeyIn === "query") {
          queryParams[auth.apiKeyName!] = auth.apiKeyValue!;
        } else {
          headers[auth.apiKeyName!] = auth.apiKeyValue!;
        }
        break;
    }
  }

  private async executeRequest(
    url: string,
    method: HttpMethod,
    headers: Record<string, string>,
    payload: unknown,
    queryParams?: Record<string, string>,
    timeout?: number,
    maxRetries: number = 0,
    retryDelay: number = 1000,
    waitForResponse: boolean = true,
  ): Promise<{
    statusCode: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
    retriesUsed: number;
  }> {
    let attempt = 0;

    while (true) {
      try {
        // Fire-and-forget mode: don't wait for response
        if (!waitForResponse) {
          const config: AxiosRequestConfig = {
            method,
            url,
            headers,
            params: queryParams,
            data: payload,
            timeout: 5000,
          };
          void axios(config).catch((err: Error) =>
            this.logger.debug(`Fire-and-forget webhook error: ${err?.message}`),
          );
          return {
            statusCode: 202,
            statusText: "Accepted",
            headers: {},
            body: { queued: true },
            retriesUsed: 0,
          };
        }

        const config: AxiosRequestConfig = {
          method,
          url,
          headers,
          params: queryParams,
          data: payload !== undefined ? payload : undefined,
          timeout: timeout || 30000,
          validateStatus: () => true, // don't throw on non-2xx
        };

        const response = await axios(config);

        // Convert response headers to plain Record
        const responseHeaders: Record<string, string> = {};
        if (response.headers) {
          for (const [k, v] of Object.entries(response.headers)) {
            if (typeof v === "string") responseHeaders[k] = v;
            else if (Array.isArray(v)) responseHeaders[k] = v.join(", ");
          }
        }

        return {
          statusCode: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: response.data,
          retriesUsed: attempt,
        };
      } catch (error) {
        if (attempt < maxRetries) {
          attempt++;
          this.logger.warn(
            `[executeRequest] Retry ${attempt}/${maxRetries} after ${retryDelay}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        } else {
          throw error;
        }
      }
    }
  }
}
