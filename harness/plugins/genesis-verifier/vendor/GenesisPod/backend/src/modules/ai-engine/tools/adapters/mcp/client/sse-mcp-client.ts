/**
 * AI Engine - SSE MCP Client
 * 用于连接仅支持 SSE 传输的旧版 MCP 服务器
 *
 * 协议流程:
 * - Client -> Server: HTTP POST (JSON-RPC 2.0)
 * - Server -> Client: SSE 流推送响应和通知
 * - 比 Streamable HTTP 更简单，不支持 session 管理
 */

import axios, { AxiosInstance } from "axios";
import { BaseMCPClient } from "./mcp-client";
import { sanitizeError } from "@/common/utils/log-sanitizer.utils";

/**
 * SSE MCP 客户端
 * 用于兼容旧版仅支持 SSE 的 MCP 服务器
 */
export class SSEMCPClient extends BaseMCPClient {
  private httpClient: AxiosInstance | null = null;
  private sseAbortController: AbortController | null = null;
  private messageEndpoint: string | null = null;

  protected async doConnect(): Promise<void> {
    if (!this.config.url) {
      throw new Error("URL is required for SSE transport");
    }

    this.httpClient = axios.create({
      timeout: this.config.timeout || 30000,
      headers: {
        ...this.getAuthHeaders(),
      },
    });

    // Open SSE connection to discover the message endpoint
    await this.openSSEConnection();
  }

  protected async doDisconnect(): Promise<void> {
    if (this.sseAbortController) {
      this.sseAbortController.abort();
      this.sseAbortController = null;
    }

    this.httpClient = null;
    this.messageEndpoint = null;
  }

  protected async doSend(message: unknown): Promise<void> {
    if (!this.httpClient || !this.messageEndpoint) {
      throw new Error(
        "SSE client not connected or message endpoint not discovered",
      );
    }

    try {
      await this.httpClient.post(this.messageEndpoint, message, {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `HTTP ${error.response?.status || "unknown"}: ${error.response?.data || error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Open SSE connection to the server
   * The server sends an 'endpoint' event with the URL for POSTing messages
   */
  private async openSSEConnection(): Promise<void> {
    if (!this.httpClient || !this.config.url) {
      throw new Error("HTTP client not initialized");
    }

    return new Promise<void>((resolve, reject) => {
      this.sseAbortController = new AbortController();

      const timeout = setTimeout(() => {
        this.sseAbortController?.abort();
        reject(new Error("SSE connection timeout"));
      }, this.config.timeout || 30000);

      this.httpClient!.get(this.config.url!, {
        headers: { Accept: "text/event-stream" },
        responseType: "stream",
        signal: this.sseAbortController.signal,
      })
        .then((response) => {
          let buffer = "";
          let endpointResolved = false;

          response.data.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            const { parsed, remaining } = this.parseSSEBuffer(buffer);
            buffer = remaining;

            for (const event of parsed) {
              // Handle endpoint event (legacy SSE protocol)
              if (event.event === "endpoint" && event.data) {
                this.messageEndpoint = this.resolveEndpoint(event.data);
                if (!endpointResolved) {
                  endpointResolved = true;
                  clearTimeout(timeout);
                  resolve();
                }
                continue;
              }

              // Handle JSON-RPC messages
              if (event.data) {
                try {
                  const message = JSON.parse(event.data);
                  if (message.id !== undefined) {
                    this.handleResponse(message);
                  }
                } catch (err) {
                  this.logger.warn(
                    `Failed to parse SSE message: ${sanitizeError(err)}`,
                  );
                }
              }
            }
          });

          response.data.on("error", (err: Error) => {
            if (err.name !== "AbortError") {
              this.logger.error(`SSE stream error: ${sanitizeError(err)}`);
              if (!endpointResolved) {
                clearTimeout(timeout);
                reject(err);
              }
            }
          });

          response.data.on("end", () => {
            this._connected = false;
            this.logger.warn("SSE stream ended");
          });
        })
        .catch((err) => {
          clearTimeout(timeout);
          if (err.name !== "AbortError") {
            reject(err);
          }
        });
    });
  }

  /**
   * Resolve endpoint URL (may be relative or absolute)
   */
  private resolveEndpoint(endpoint: string): string {
    if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
      return endpoint;
    }

    // Resolve relative URL against base
    const base = new URL(this.config.url!);
    return new URL(endpoint, base).toString();
  }

  /**
   * Parse SSE text buffer into events
   */
  private parseSSEBuffer(buffer: string): {
    parsed: Array<{ event?: string; data: string; id?: string }>;
    remaining: string;
  } {
    const parsed: Array<{ event?: string; data: string; id?: string }> = [];
    const blocks = buffer.split("\n\n");
    const remaining = blocks.pop() || "";

    for (const block of blocks) {
      if (!block.trim()) continue;

      const event: { event?: string; data: string; id?: string } = { data: "" };
      const lines = block.split("\n");

      for (const line of lines) {
        if (line.startsWith("id:")) {
          event.id = line.slice(3).trim();
        } else if (line.startsWith("event:")) {
          event.event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          event.data += (event.data ? "\n" : "") + line.slice(5).trim();
        }
      }

      if (event.data || event.event) {
        parsed.push(event);
      }
    }

    return { parsed, remaining };
  }

  /**
   * Get auth headers from config env vars
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const env = this.config.env || {};

    if (env.API_KEY) {
      headers["Authorization"] = `Bearer ${env.API_KEY}`;
    }

    return headers;
  }
}
