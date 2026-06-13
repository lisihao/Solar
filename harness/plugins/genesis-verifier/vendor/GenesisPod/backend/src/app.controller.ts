import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { AppService } from "./app.service";
import { Public } from "./common/decorators/public.decorator";
import { PrismaService } from "./common/prisma/prisma.service";
import { CacheService } from "./common/cache/cache.service";
import { APP_CONFIG } from "./common/config/app.config";

/** 单个依赖检查结果 */
interface DependencyCheck {
  status: "healthy" | "unhealthy";
  latency?: number;
  message?: string;
}

@Public()
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  @Get()
  getHello() {
    return this.appService.getHello();
  }

  /**
   * 依赖检查（DB + cache），/health 与 /readyz 共享，避免复制粘贴。
   */
  private async runDependencyChecks(): Promise<
    Record<string, DependencyCheck>
  > {
    const checks: Record<string, DependencyCheck> = {};

    // Database check
    checks.database = await this.prisma.healthCheck();

    // Cache check
    const cacheStart = Date.now();
    try {
      const testKey = "__health_check__";
      await this.cacheService.set(testKey, "ok", 10);
      const val = await this.cacheService.get<string>(testKey);
      checks.cache = {
        status: val === "ok" ? "healthy" : "unhealthy",
        latency: Date.now() - cacheStart,
      };
    } catch {
      checks.cache = {
        status: "unhealthy",
        latency: Date.now() - cacheStart,
        message: "Cache unavailable",
      };
    }

    return checks;
  }

  /**
   * Liveness 探针：只证明进程存活，不查任何依赖（依赖检查是 readiness 的事）。
   */
  @Get("healthz")
  getLiveness() {
    return { status: "ok" };
  }

  /**
   * Readiness 探针：复用依赖检查逻辑，全 healthy 返 200，否则 503。
   */
  @Get("readyz")
  async getReadiness() {
    const checks = await this.runDependencyChecks();
    const allHealthy = Object.values(checks).every(
      (c) => c.status === "healthy",
    );

    if (!allHealthy) {
      throw new HttpException(
        { status: "unavailable", checks },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { status: "ok", checks };
  }

  @Get("health")
  @HttpCode(HttpStatus.OK)
  async getHealth() {
    const checks = await this.runDependencyChecks();

    const allHealthy = Object.values(checks).every(
      (c) => c.status === "healthy",
    );

    return {
      status: allHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      service: `${APP_CONFIG.brand.fullName} Backend`,
      version: "1.0.0",
      // Build marker — Railway 部署完成后这两个值会变，用来快速验证生产线是否拉到了某个 commit
      buildSha:
        process.env.RAILWAY_GIT_COMMIT_SHA ??
        process.env.GIT_COMMIT_SHA ??
        process.env.SOURCE_COMMIT ??
        "unknown",
      buildTime: process.env.RAILWAY_DEPLOYMENT_ID ?? "unknown",
      // Marker tag — 改这个值就能在生产侧确认"这一份代码到了"
      buildMarker: "20260426-byok-modelconfig-fix",
      checks,
    };
  }
}
