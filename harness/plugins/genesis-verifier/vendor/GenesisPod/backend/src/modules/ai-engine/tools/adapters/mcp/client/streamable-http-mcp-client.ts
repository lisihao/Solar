/**
 * AI Engine - Streamable HTTP MCP Client
 * MCP 2025-11 规范的 Streamable HTTP 传输实现
 *
 * 协议流程:
 * - Client -> Server: HTTP POST (JSON-RPC 2.0)
 * - Server -> Client: SSE 流 或 JSON 响应
 * - Server push: Client 通过 GET 建立 SSE 流接收服务器推送
 * - Session: 通过 Mcp-Session-Id header 管理
 */

import axios, { AxiosInstance } from "axios";
import { BaseMCPClient } from "./mcp-client";
import { sanitizeError } from "@/common/utils/log-sanitizer.utils";
import { assertUrlSafe } from "@/modules/ai-engine/safety/security/ssrf/ssrf-guard";

/**
 * SSE 事件解析结果
 */
interface SSEEvent {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
}

/**
 * Streamable HTTP MCP 客户端
 * 实现 MCP 2025-11 规范中的 Streamable HTTP 传输
 */
export class StreamableHttpMCPClient extends BaseMCPClient {
  private httpClient: AxiosInstance | null = null;
  private sessionId: string | null = null;
  private lastEventId: string | null = null;
  private sseAbortController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private readonly reconnectGrowFactor = 1.5;
  private readonly maxRetries = 5;
  private retryCount = 0;

  protected async doConnect(): Promise<void> {
    if (!this.config.url) {
      throw new Error("URL is required for HTTP transport");
    }

    // ENG-002 SSRF 防护：连接前校验 MCP server URL（DNS 解析后复核私网/云元数据 IP）。
    //   端口非 SSRF 关切（MCP 服务器跑任意端口），放行配置端口；私网/loopback/元数据 IP 仍拦。
    await assertUrlSafe(this.config.url, {
      allowedPorts: ["", "80", "443", new URL(this.config.url).port],
    });

    this.httpClient = axios.create({
      baseURL: this.config.url,
      timeout: this.config.timeout || 30000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...this.getAuthHeaders(),
      },
    });

    this.retryCount = 0;
    this.reconnectDelay = 1000;
  }

  protected async doDisconnect(): Promise<void> {
    // Reject all pending requests before disconnecting
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error("Client disconnecting"));
    }
    this.pendingRequests.clear();

    // Close any active SSE stream
    if (this.sseAbortController) {
      this.sseAbortController.abort();
      this.sseAbortController = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Terminate session if we have one
    if (this.sessionId && this.httpClient) {
      try {
        await this.httpClient.delete("", {
          headers: { "Mcp-Session-Id": this.sessionId },
        });
      } catch {
        // Best-effort session termination
      }
    }

    this.httpClient = null;
    this.sessionId = null;
    this.lastEventId = null;
  }

  protected async doSend(message: unknown): Promise<void> {
    if (!this.httpClient) {
      throw new Error("HTTP client not initialized");
    }

    const headers: Record<string, string> = {};
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    try {
      const response = await this.httpClient.post("", message, {
        headers,
        responseType: "text",
        // Allow both JSON and SSE responses
        transformResponse: [(data: string) => data],
      });

      // Capture session ID from response
      const newSessionId = response.headers["mcp-session-id"];
      if (newSessionId) {
        this.sessionId = newSessionId;
      }

      const contentType = String(response.headers["content-type"] ?? "");

      if (contentType.includes("text/event-stream")) {
        // Parse SSE response
        this.processSSEData(response.data as string);
      } else if (contentType.includes("application/json")) {
        // Parse JSON response
        const parsed =
          typeof response.data === "string"
            ? JSON.parse(response.data)
            : response.data;
        if (parsed.id !== undefined) {
          this.handleResponse(parsed);
        }
      }
      // 202 Accepted with no body = notification acknowledged

      // Reset retry state on success
      this.retryCount = 0;
      this.reconnectDelay = 1000;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;

        // Session expired or invalid
        if (status === 404 && this.sessionId) {
          this.logger.warn("Session expired, reconnecting...");
          this.sessionId = null;
          await this.handleReconnect(message);
          return;
        }

        throw new Error(
          `HTTP ${status || "unknown"}: ${error.response?.data || error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Open a GET-based SSE stream for server-initiated messages
   */
  async openSSEStream(): Promise<void> {
    if (!this.httpClient || !this.sessionId) {
      return;
    }

    this.sseAbortController = new AbortController();

    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Mcp-Session-Id": this.sessionId,
    };

    if (this.lastEventId) {
      headers["Last-Event-ID"] = this.lastEventId;
    }

    try {
      const response = await this.httpClient.get("", {
        headers,
        responseType: "stream",
        signal: this.sseAbortController.signal,
      });

      let buffer = "";
      response.data.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const events = this.parseSSEBuffer(buffer);
        buffer = events.remaining;

        for (const event of events.parsed) {
          this.handleSSEEvent(event);
        }
      });

      response.data.on("end", () => {
        // Stream closed by server - attempt reconnect if still connected
        if (this._connected && this.config.autoReconnect !== false) {
          this.scheduleReconnect();
        }
      });

      response.data.on("error", (err: Error) => {
        if (err.name !== "AbortError") {
          this.logger.error(`SSE stream error: ${sanitizeError(err)}`);
          if (this._connected && this.config.autoReconnect !== false) {
            this.scheduleReconnect();
          }
        }
      });
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        this.logger.error(`Failed to open SSE stream: ${sanitizeError(error)}`);
      }
    }
  }

  /**
   * Parse SSE data from POST response body
   */
  private processSSEData(data: string): void {
    const events = this.parseSSEBuffer(data);
    for (const event of events.parsed) {
      this.handleSSEEvent(event);
    }
  }

  /**
   * Handle a parsed SSE event
   */
  private handleSSEEvent(event: SSEEvent): void {
    if (event.id) {
      this.lastEventId = event.id;
    }

    if (event.retry) {
      this.reconnectDelay = event.retry;
    }

    if (!event.data || event.data === "") {
      return;
    }

    try {
      const message = JSON.parse(event.data);
      if (
        message.id !== undefined &&
        (message.result !== undefined || message.error !== undefined)
      ) {
        // JSON-RPC response
        this.handleResponse(message);
      } else if (message.method) {
        // Server-initiated request or notification
        this.handleServerMessage(message);
      }
    } catch (err) {
      this.logger.warn(`Failed to parse SSE event data: ${sanitizeError(err)}`);
    }
  }

  /**
   * Handle server-initiated messages (notifications, requests)
   */
  private handleServerMessage(message: {
    method: string;
    params?: unknown;
    id?: string | number;
  }): void {
    // For now, log server-initiated messages
    // Future: emit events for notification handlers
    this.logger.debug(`Server message: ${message.method}`);
  }

  /**
   * Parse SSE text buffer into events
   */
  private parseSSEBuffer(buffer: string): {
    parsed: SSEEvent[];
    remaining: string;
  } {
    const parsed: SSEEvent[] = [];
    const blocks = buffer.split("\n\n");
    const remaining = blocks.pop() || "";

    for (const block of blocks) {
      if (!block.trim()) continue;

      const event: SSEEvent = { data: "" };
      const lines = block.split("\n");

      for (const line of lines) {
        if (line.startsWith("id:")) {
          event.id = line.slice(3).trim();
        } else if (line.startsWith("event:")) {
          event.event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          event.data += (event.data ? "\n" : "") + line.slice(5).trim();
        } else if (line.startsWith("retry:")) {
          event.retry = parseInt(line.slice(6).trim(), 10);
        }
      }

      if (event.data) {
        parsed.push(event);
      }
    }

    return { parsed, remaining };
  }

  /**
   * Schedule SSE stream reconnect with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.retryCount >= this.maxRetries) {
      this.logger.error(
        `Max reconnect retries (${this.maxRetries}) reached, giving up`,
      );
      return;
    }

    this.retryCount++;
    const delay = Math.min(this.reconnectDelay, this.maxReconnectDelay);
    this.reconnectDelay = Math.min(
      this.reconnectDelay * this.reconnectGrowFactor,
      this.maxReconnectDelay,
    );

    this.logger.log(
      `Reconnecting SSE stream in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.openSSEStream()
        .then(() => {
          // Reset retry count on successful reconnection
          this.retryCount = 0;
        })
        .catch((err) => {
          this.logger.error(`Reconnect failed: ${sanitizeError(err)}`);
        });
    }, delay);
  }

  /**
   * Handle reconnect for failed requests (session expired)
   */
  private async handleReconnect(originalMessage: unknown): Promise<void> {
    if (this.retryCount >= this.maxRetries) {
      throw new Error("Max reconnect retries reached");
    }

    this.retryCount++;

    // Re-initialize to get a new session
    try {
      await this.initialize();
      this._connected = true;
      // Reset retry count on successful reconnection
      this.retryCount = 0;
      // Retry the original message
      await this.doSend(originalMessage);
    } catch (error) {
      throw new Error(`Reconnect failed: ${(error as Error).message}`);
    }
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
