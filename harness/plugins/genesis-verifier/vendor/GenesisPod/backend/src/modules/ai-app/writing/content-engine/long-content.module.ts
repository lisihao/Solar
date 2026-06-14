/**
 * 长内容引擎模块
 * Long Content Engine Module
 *
 * 提供长内容处理的核心能力：
 * - 任务粒度控制
 * - 续写协议处理
 * - 滑动窗口上下文管理
 * - 质量监控
 */

import { Module } from "@nestjs/common";
import { TaskGranularityService } from "./services/task-granularity.service";
import { ContinuationProtocolService } from "./services/continuation-protocol.service";
import { SlidingWindowContextService } from "./services/sliding-window-context.service";
import { QualityMonitorService } from "./services/quality-monitor.service";
import { LongContentEngineService } from "./services/long-content-engine.service";
import {
  LONG_CONTENT_ENGINE_TOKEN,
  CONTINUATION_PROTOCOL_TOKEN,
} from "@/modules/ai-harness/facade";

@Module({
  providers: [
    TaskGranularityService,
    ContinuationProtocolService,
    SlidingWindowContextService,
    QualityMonitorService,
    LongContentEngineService,
    // String-token aliases for cross-layer DI via facade ContentFeature
    {
      provide: LONG_CONTENT_ENGINE_TOKEN,
      useExisting: LongContentEngineService,
    },
    {
      provide: CONTINUATION_PROTOCOL_TOKEN,
      useExisting: ContinuationProtocolService,
    },
  ],
  exports: [
    TaskGranularityService,
    ContinuationProtocolService,
    SlidingWindowContextService,
    QualityMonitorService,
    LongContentEngineService,
    LONG_CONTENT_ENGINE_TOKEN,
    CONTINUATION_PROTOCOL_TOKEN,
  ],
})
export class LongContentModule {}
