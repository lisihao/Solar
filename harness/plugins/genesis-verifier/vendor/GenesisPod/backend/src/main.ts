import { NestFactory } from "@nestjs/core";
import {
  ValidationPipe,
  LogLevel,
  Logger,
  ConsoleLogger,
  RequestMethod,
} from "@nestjs/common";
import helmet from "helmet";
import { Request, Response, NextFunction } from "express";
import * as express from "express";
import * as crypto from "crypto";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { isWorkspaceAiV2Enabled } from "./common/utils/feature-flags";
import { setupSwagger } from "./common/config/swagger.config";
import { APP_CONFIG } from "./common/config/app.config";

/**
 * 启动期 NestJS 内置 RouterExplorer / RoutesResolver / InstanceLoader /
 * WebSocketsController 会按"每条路由 / 每个依赖 / 每个订阅"打 log 级日志（数百行），
 * 在 Railway 上瞬时冲爆 500 logs/sec 限速、把真正的业务日志一起丢掉
 * （"Railway rate limit … Messages dropped"）。这里在 log 级别静默这些框架 context，
 * warn/error 仍保留，业务自身日志（带各自 context）不受影响。
 */
class FrameworkQuietLogger extends ConsoleLogger {
  private static readonly NOISY_CONTEXTS = new Set([
    "RouterExplorer",
    "RoutesResolver",
    "InstanceLoader",
    "WebSocketsController",
  ]);

  log(message: unknown, ...rest: unknown[]): void {
    const context = rest.length > 0 ? rest[rest.length - 1] : undefined;
    if (
      typeof context === "string" &&
      FrameworkQuietLogger.NOISY_CONTEXTS.has(context)
    ) {
      return;
    }
    super.log(message as string, ...(rest as [string]));
  }
}

/**
 * 验证必需的环境变量
 * 启动时检查，缺失则拒绝启动
 */
function validateEnvConfig(): void {
  const logger = new Logger("EnvConfig");
  const required: string[] = ["DATABASE_URL", "JWT_SECRET"];
  const recommended: string[] = [
    "ADMIN_EMAILS",
    "STORAGE_ADMIN_KEY",
    "FRONTEND_URL",
  ];

  const missing = required.filter((key) => !process.env[key]);
  const missingRecommended = recommended.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.error("❌ Missing required environment variables:");
    missing.forEach((key) => logger.error(`   - ${key}`));
    logger.error(
      "\nPlease set these variables before starting the application.",
    );
    process.exit(1);
  }

  if (missingRecommended.length > 0) {
    logger.warn("⚠️  Missing recommended environment variables:");
    missingRecommended.forEach((key) => logger.warn(`   - ${key}`));
    logger.warn("   These should be set in production.\n");
  }

  // JWT_SECRET 指纹验证 (帮助调试跨部署的一致性问题)
  const jwtSecret = process.env.JWT_SECRET || "";
  const secretFingerprint = crypto
    .createHash("sha256")
    .update(jwtSecret)
    .digest("hex")
    .substring(0, 8);
  logger.log(`🔐 JWT_SECRET fingerprint: ${secretFingerprint}`);
  logger.log(
    `🌐 FRONTEND_URL: ${process.env.FRONTEND_URL || "(not set - using default)"}`,
  );

  logger.log("✅ Environment configuration validated");
}

async function bootstrap() {
  // 验证环境配置
  validateEnvConfig();

  // 根据环境配置日志级别
  // 生产环境输出 error, warn, log（不含 debug/verbose）
  // 开发环境输出全部级别
  const isProduction = process.env.NODE_ENV === "production";
  const logLevels: LogLevel[] = isProduction
    ? ["error", "warn", "log"]
    : ["error", "warn", "log", "debug", "verbose"];

  // ★ 2026-05-05 / 2026-05-25: 启动期 NestJS 内置 RouterExplorer / RoutesResolver /
  //   InstanceLoader / WebSocketsController 按"每条路由 / 每个依赖 / 每个订阅"打
  //   log 级日志（数百行），prod 里淹没业务日志且冲爆 Railway 500 logs/sec 限速丢日志。
  //   用 FrameworkQuietLogger 在 log 级静默这些框架 context（warn/error 仍保留）。
  const appLogger = new FrameworkQuietLogger();
  appLogger.setLogLevels(logLevels);
  const app = await NestFactory.create(AppModule, {
    logger: appLogger,
  });

  // ★ E17 (2026-05-25) graceful shutdown：监听 SIGTERM/SIGINT，触发各 provider 的
  //   onApplicationShutdown（如 MissionAbortRegistry 会 abort 所有在跑 mission，
  //   滚动部署时立即止血而非等 liveness 5min 回收）。
  app.enableShutdownHooks();

  // 增加请求体大小限制，支持大型字幕数据
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // 启用安全头 (Helmet) - 但对代理路由禁用CSP
  app.use((req: Request, res: Response, next: NextFunction) => {
    // 对代理路由禁用CSP和X-Frame-Options
    if (req.path.startsWith("/api/v1/proxy/")) {
      helmet({
        contentSecurityPolicy: false, // 完全禁用CSP
        frameguard: false, // 禁用X-Frame-Options
        crossOriginEmbedderPolicy: false,
      })(req, res, next);
    } else {
      const isProd = process.env.NODE_ENV === "production";
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            frameSrc: isProd ? ["'self'"] : ["'self'", "http://localhost:*"],
            frameAncestors: isProd
              ? ["'self'"]
              : ["'self'", "http://localhost:*"],
            upgradeInsecureRequests: isProd ? [] : null,
          },
        },
        crossOriginEmbedderPolicy: false, // 允许跨域资源嵌入
        frameguard: false, // 允许 iframe 嵌入（内部使用）
        strictTransportSecurity: isProd
          ? { maxAge: 31536000, includeSubDomains: true }
          : false,
      })(req, res, next);
    }
  });

  // 启用CORS - 支持开发和生产环境
  const corsOriginsEnv =
    process.env.CORS_ORIGINS?.split(",").map((o) => o.trim()) || [];
  const allowedOrigins = new Set<string>(corsOriginsEnv);
  const isDev = process.env.NODE_ENV !== "production";

  // Railway 环境自动添加前端 URL 到 CORS 白名单（SSE 直连需要）
  if (process.env.RAILWAY_ENVIRONMENT === "production") {
    const railwayFrontendUrl =
      process.env.RAILWAY_FRONTEND_URL || APP_CONFIG.railway.frontendUrl;
    allowedOrigins.add(railwayFrontendUrl);
  }

  app.enableCors({
    origin: (origin, callback) => {
      // 无 Origin 头的请求（健康检查、服务端调用、curl 等）始终放行
      // origin === 'null'（字符串）：浏览器 opaque origin（跨域重定向、sandboxed iframe 等）同样放行
      // 真正的安全由 JWT Auth Guard 保障，CORS 仅是浏览器级防护
      if (!origin || origin === "null") {
        callback(null, true);
        return;
      }

      // 开发环境允许 localhost
      const isLocalhost =
        isDev &&
        (origin.match(/^http:\/\/localhost:\d+$/) ||
          origin.match(/^http:\/\/127\.0\.0\.1:\d+$/) ||
          origin.match(/^http:\/\/\[::1\]:\d+$/));

      // 生产环境：精确匹配配置的域名（包括 Railway 域名）
      const isAllowed = allowedOrigins.has(origin);

      if (isLocalhost || isAllowed) {
        callback(null, true);
      } else {
        const logger = new Logger("CORS");
        logger.warn(`CORS rejected origin: ${origin}`);
        // 返回 false 而非抛异常 — 浏览器收到无 CORS 头的响应后自行拒绝，
        // 不会触发 500 INTERNAL_ERROR 污染日志
        callback(null, false);
      }
    },
    credentials: true,
    exposedHeaders: ["X-Request-Id"],
  });

  // 启用全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // 启用全局异常过滤器（统一处理所有异常，包括Prisma错误）
  app.useGlobalFilters(new AllExceptionsFilter());

  // RequestLoggerInterceptor 已通过 APP_INTERCEPTOR 全局注册（app.module.ts）
  // 生产环境仅记录慢请求(>500ms)，所有环境均记录 HTTP 指标和 Server-Timing 头

  // 添加根路径健康检查（供Railway healthcheck使用，不受全局前缀影响）
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: `${APP_CONFIG.brand.fullName} Backend`,
      version: "1.0.0",
      // 部署指纹：确认线上跑的是哪个 commit（Railway 注入；本地/CI 无此变量则 unknown）。
      // 没有它，"改了没生效"永远分不清是代码问题还是部署时序问题。
      commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown",
    });
  });

  // API前缀（排除 .well-known/* 以支持 A2A 标准发现路径）
  app.setGlobalPrefix("api/v1", {
    exclude: [{ path: ".well-known/(.*)", method: RequestMethod.GET }],
  });

  // 设置 Swagger API 文档（仅开发环境）
  if (!isProduction) {
    await setupSwagger(app);
  }

  // Railway uses PORT, fallback to BACKEND_PORT for local dev
  const port = process.env.PORT || process.env.BACKEND_PORT || 4000;

  // ★ 增加服务器超时以支持长时间 AI 调用
  // Railway 平台最大超时是 15 分钟，Node.js 默认是 5 分钟
  // 设置为 10 分钟以确保 AI 规划等长时间操作能够完成
  const server = await app.listen(port);
  const HTTP_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds
  server.setTimeout(HTTP_TIMEOUT);
  server.keepAliveTimeout = HTTP_TIMEOUT;
  server.headersTimeout = HTTP_TIMEOUT + 1000; // 必须大于 keepAliveTimeout

  // 根据环境显示正确的 URL
  const baseUrl = isProduction
    ? process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : process.env.FRONTEND_URL || `http://0.0.0.0:${port}`
    : `http://localhost:${port}`;

  // 生产环境精简启动日志，开发环境详细输出
  const logger = new Logger("Bootstrap");
  if (isProduction) {
    logger.log(
      `🚀 ${APP_CONFIG.brand.fullName} Backend started | ${baseUrl} | Port: ${port}`,
    );
  } else {
    logger.log(`🚀 ${APP_CONFIG.brand.fullName} Backend running on ${baseUrl}`);
    logger.log(`📚 API Docs: ${baseUrl}/api/docs`);
    logger.log(`🧩 Workspace AI v2 enabled: ${isWorkspaceAiV2Enabled()}`);
    logger.log(`📋 Log level: all (development)`);
  }
}

void bootstrap();
