/**
 * AI Engine - Realtime Module
 * 实时推送模块
 */

import { Module } from "@nestjs/common";
// ★ L2 internal — 绝不从 facade barrel 导入自己的兄弟子模块
import { EventBusService as EngineEventEmitterService } from "../ipc/event-bus.service";
import { ProgressTrackerService } from "../ipc/progress-tracker.service";

@Module({
  imports: [
    // Note: EventEmitterModule 应在 AppModule 中 forRoot()，此处不再重复导入
  ],
  providers: [EngineEventEmitterService, ProgressTrackerService],
  exports: [EngineEventEmitterService, ProgressTrackerService],
})
export class RealtimeModule {}
