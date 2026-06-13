/**
 * FlareSolverr 服务
 *
 * 用于绕过 Cloudflare 等反爬虫保护
 * FlareSolverr 是一个代理服务器，使用无头浏览器解决 Cloudflare 挑战
 *
 * @see https://github.com/FlareSolverr/FlareSolverr
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import axios from "axios";

export interface FlareSolverrCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
}

export interface FlareSolverrSolution {
  url: string;
  status: number;
  headers: Record<string, string>;
  response: string; // HTML content
  cookies: FlareSolverrCookie[];
  userAgent: string;
}

export interface FlareSolverrResponse {
  status: "ok" | "error";
  message?: string;
  solution?: FlareSolverrSolution;
  startTimestamp: number;
  endTimestamp: number;
  version: string;
}

export interface FlareSolverrResult {
  success: boolean;
  html?: string;
  cookies?: FlareSolverrCookie[];
  userAgent?: string;
  finalUrl?: string;
  error?: string;
  solveTime?: number;
}

@Injectable()
export class FlareSolverrService implements OnModuleInit {
  private readonly logger = new Logger(FlareSolverrService.name);

  // FlareSolverr 服务地址
  private readonly FLARESOLVERR_URL =
    process.env.FLARESOLVERR_URL || "http://localhost:8191/v1";

  // 是否可用
  private isAvailable = false;
  // 2026-05-13 P3-#23: 上次健康检查失败时间戳，防止 fetchPage 每次都重新探测
  //   导致 ECONNREFUSED 日志风暴（Railway log 实证：service 永久 down 时每
  //   秒级刷屏）。失败后 60s 内不重试探测，直接快速 fail。
  private lastHealthCheckFailedAt = 0;
  private static readonly HEALTH_RECHECK_COOLDOWN_MS = 60_000;

  async onModuleInit() {
    // 仅在显式配置 FLARESOLVERR_URL 时才检查健康状态
    // 未配置时跳过，避免对 localhost:8191 发起无意义的连接尝试
    if (!process.env.FLARESOLVERR_URL) {
      this.logger.debug(
        "FLARESOLVERR_URL not configured, skipping health check",
      );
      return;
    }
    await this.checkHealth();
  }

  /**
   * 检查 FlareSolverr 服务健康状态
   */
  async checkHealth(): Promise<boolean> {
    try {
      // FlareSolverr 没有专门的健康检查端点，我们发送一个简单请求测试
      const response = await axios.post(
        this.FLARESOLVERR_URL,
        {
          cmd: "sessions.list",
        },
        {
          timeout: 5000,
          headers: { "Content-Type": "application/json" },
        },
      );

      this.isAvailable = response.data?.status === "ok";

      if (this.isAvailable) {
        // 健康恢复 → 重置失败时间戳，让后续 fetch 不再走 cooldown 分支
        this.lastHealthCheckFailedAt = 0;
        this.logger.log(
          `FlareSolverr is available at ${this.FLARESOLVERR_URL}`,
        );
      } else {
        this.logger.warn(
          `FlareSolverr responded but status is not ok: ${response.data?.message}`,
        );
      }

      return this.isAvailable;
    } catch (error) {
      this.isAvailable = false;
      this.lastHealthCheckFailedAt = Date.now();
      // 2026-05-13: FlareSolverr 服务已下线（Railway 已删 service）；env var
      // 残留时不再 WARN 刷屏 — log 一次 debug 即可，service 自动 fallback skip。
      // 完整移除追踪 task #58。
      this.logger.debug(
        `FlareSolverr not reachable at ${this.FLARESOLVERR_URL} — Cloudflare bypass disabled (service is optional).`,
      );
      return false;
    }
  }

  /**
   * 检查服务是否可用
   */
  getIsAvailable(): boolean {
    return this.isAvailable;
  }

  /**
   * 使用 FlareSolverr 获取网页内容
   * 可以绕过 Cloudflare 等保护
   *
   * @param url 目标 URL
   * @param options 选项
   */
  async fetchPage(
    url: string,
    options: {
      maxTimeout?: number;
      cookies?: FlareSolverrCookie[];
      session?: string;
    } = {},
  ): Promise<FlareSolverrResult> {
    const { maxTimeout = 60000, cookies, session } = options;

    if (!this.isAvailable) {
      // 2026-05-13 P3-#23: 60s cooldown 内直接快速 fail，不要每次 fetch 都
      //   发请求触发 ECONNREFUSED 刷屏。
      const since = Date.now() - this.lastHealthCheckFailedAt;
      if (
        this.lastHealthCheckFailedAt > 0 &&
        since < FlareSolverrService.HEALTH_RECHECK_COOLDOWN_MS
      ) {
        return {
          success: false,
          error: `FlareSolverr unavailable (skipping recheck for ${Math.ceil((FlareSolverrService.HEALTH_RECHECK_COOLDOWN_MS - since) / 1000)}s)`,
        };
      }
      // 冷却已过，重新检查一次
      await this.checkHealth();
      if (!this.isAvailable) {
        return {
          success: false,
          error: "FlareSolverr service is not available",
        };
      }
    }

    const startTime = Date.now();

    try {
      this.logger.log(`Fetching page via FlareSolverr: ${url}`);

      const requestBody: Record<string, unknown> = {
        cmd: "request.get",
        url,
        maxTimeout,
      };

      if (cookies && cookies.length > 0) {
        requestBody.cookies = cookies;
      }

      if (session) {
        requestBody.session = session;
      }

      const response = await axios.post<FlareSolverrResponse>(
        this.FLARESOLVERR_URL,
        requestBody,
        {
          timeout: maxTimeout + 10000, // 给 FlareSolverr 额外的处理时间
          headers: { "Content-Type": "application/json" },
        },
      );

      const solveTime = Date.now() - startTime;

      if (response.data.status === "ok" && response.data.solution) {
        const solution = response.data.solution;

        this.logger.log(
          `FlareSolverr successfully fetched page (${solveTime}ms): ${solution.url}`,
        );

        return {
          success: true,
          html: solution.response,
          cookies: solution.cookies,
          userAgent: solution.userAgent,
          finalUrl: solution.url,
          solveTime,
        };
      } else {
        const errorMessage =
          response.data.message || "FlareSolverr returned error status";
        this.logger.warn(`FlareSolverr failed: ${errorMessage}`);

        return {
          success: false,
          error: errorMessage,
          solveTime,
        };
      }
    } catch (error) {
      const solveTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`FlareSolverr request failed: ${errorMessage}`);

      // 如果是超时错误，可能是 Cloudflare 挑战太复杂
      if (axios.isAxiosError(error) && error.code === "ECONNABORTED") {
        return {
          success: false,
          error:
            "FlareSolverr timeout - Cloudflare challenge may be too complex",
          solveTime,
        };
      }

      // 如果连接失败，标记服务不可用
      if (axios.isAxiosError(error) && error.code === "ECONNREFUSED") {
        this.isAvailable = false;
        return {
          success: false,
          error: "FlareSolverr service is not running",
          solveTime,
        };
      }

      return {
        success: false,
        error: errorMessage,
        solveTime,
      };
    }
  }

  /**
   * 创建持久会话
   * 可用于需要登录或多次请求的场景
   */
  async createSession(sessionId?: string): Promise<string | null> {
    if (!this.isAvailable) {
      return null;
    }

    try {
      const response = await axios.post<FlareSolverrResponse>(
        this.FLARESOLVERR_URL,
        {
          cmd: "sessions.create",
          session: sessionId,
        },
        {
          timeout: 30000,
          headers: { "Content-Type": "application/json" },
        },
      );

      if (response.data.status === "ok") {
        this.logger.log(`FlareSolverr session created: ${sessionId}`);
        return sessionId || "default";
      }

      return null;
    } catch (error) {
      this.logger.error("Failed to create FlareSolverr session");
      return null;
    }
  }

  /**
   * 销毁会话
   */
  async destroySession(sessionId: string): Promise<boolean> {
    if (!this.isAvailable) {
      return false;
    }

    try {
      const response = await axios.post<FlareSolverrResponse>(
        this.FLARESOLVERR_URL,
        {
          cmd: "sessions.destroy",
          session: sessionId,
        },
        {
          timeout: 10000,
          headers: { "Content-Type": "application/json" },
        },
      );

      return response.data.status === "ok";
    } catch (error) {
      return false;
    }
  }
}
