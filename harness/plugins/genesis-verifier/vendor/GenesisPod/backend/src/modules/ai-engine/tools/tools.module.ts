/**
 * AI Engine Tools Module
 * 工具系统子模块
 *
 * 提供:
 * - Tool Registry
 * - Tool Pipeline & Executor
 * - All 46 Built-in Tools
 */

import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { ExportModule } from "../../../common/export/export.module";
import { BrowserModule } from "../../../common/browser/browser.module";
import { SecretsModule } from "../../platform/credentials/storage/secrets/secrets.module";
import { ToolKeyResolverModule } from "../../platform/credentials/resolution/tool-key-resolver/tool-key-resolver.module";

// Registry
import { ToolRegistry } from "./registry/tool.registry";

// Middleware
import { ToolPipeline, ToolExecutor } from "./middleware/tool-pipeline";
import { ValidationMiddleware } from "./middleware/validation.middleware";
import { TimeoutMiddleware } from "./middleware/timeout.middleware";
import { RateLimitMiddleware } from "./middleware/rate-limit.middleware";

// Policy Data Service
import { PolicyDataService } from "./categories/information/policy";
// ★ Phase 3: 工具并发 + 中间件
import { ToolConcurrencyService } from "./concurrency/tool-concurrency.service";
import { PermissionMiddleware } from "./middleware/permission.middleware";
import { ProgressMiddleware } from "./middleware/progress.middleware";
// ★ L2-7: Tool result cache
import { ToolResultCacheService } from "./cache/tool-result-cache.service";
import { HumanApprovalPrimitiveService } from "./categories/collaboration/human-approval-primitive.service";
// W1-a-fixup: rate-limit 回归 engine 后注入到 ToolPipeline middleware
import { RateLimitService } from "../reliability/rate-limit/rate-limit.service";

// All Tools
import {
  ALL_TOOL_PROVIDERS,
  allToolsProvider,
  ALL_TOOLS_TOKEN,
} from "./tools.provider";

/**
 * 工具管道工厂
 */
const toolPipelineFactory = {
  provide: ToolPipeline,
  useFactory: (
    permissionMiddleware: PermissionMiddleware,
    progressMiddleware: ProgressMiddleware,
    toolResultCacheService: ToolResultCacheService,
    rateLimitService: RateLimitService,
  ) => {
    const pipeline = new ToolPipeline(toolResultCacheService);
    pipeline.use(permissionMiddleware); // priority 5：permission check
    pipeline.use(new RateLimitMiddleware(rateLimitService)); // priority 8：限速（W1-a-fixup 回归）
    pipeline.use(new ValidationMiddleware()); // priority 10
    pipeline.use(new TimeoutMiddleware()); // priority 20
    pipeline.use(progressMiddleware); // priority 90：progress tracking (runs last)
    return pipeline;
  },
  inject: [
    PermissionMiddleware,
    ProgressMiddleware,
    ToolResultCacheService,
    RateLimitService,
  ],
};

/**
 * 工具执行器工厂
 */
const toolExecutorFactory = {
  provide: ToolExecutor,
  useFactory: (pipeline: ToolPipeline) => {
    return new ToolExecutor(pipeline);
  },
  inject: [ToolPipeline],
};

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    BrowserModule,
    ExportModule, // FileConversionTool needs ExportOrchestratorService
    SecretsModule,
    ToolKeyResolverModule,
  ],
  providers: [
    // Registry
    ToolRegistry,

    // Pipeline & Executor
    toolPipelineFactory,
    toolExecutorFactory,

    // Policy Data Service
    PolicyDataService,
    // ★ Phase 3: 工具并发 + 中间件
    ToolConcurrencyService,
    PermissionMiddleware,
    ProgressMiddleware,
    // ★ L2-7: Tool result cache
    ToolResultCacheService,
    // Shared HITL approval DB primitive (HumanApprovalTool + self-driven gate
    // both delegate store/poll/cleanup here).
    HumanApprovalPrimitiveService,

    // All 46 Built-in Tools
    ...ALL_TOOL_PROVIDERS,
    allToolsProvider,
  ],
  exports: [
    ToolRegistry,
    ToolPipeline,
    ToolExecutor,
    PolicyDataService,
    HumanApprovalPrimitiveService,
    ...ALL_TOOL_PROVIDERS,
    ALL_TOOLS_TOKEN, // Export token for AiEngineModule injection
    // ★ Phase 3
    ToolConcurrencyService,
    PermissionMiddleware,
    ProgressMiddleware,
    // ★ L2-7
    ToolResultCacheService,
  ],
})
export class AiEngineToolsModule {}
