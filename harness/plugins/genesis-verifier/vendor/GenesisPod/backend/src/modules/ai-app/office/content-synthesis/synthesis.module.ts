/**
 * Synthesis Module
 * AI Engine 核心能力 - 报告合成通用模块
 *
 * 提供跨模块共享的报告合成原子操作。
 * AIFacade 通过 @Global() 自动可用。
 */

import { Module } from "@nestjs/common";
import { ReportSynthesisEngine } from "./report-synthesis.service";
import { REPORT_SYNTHESIS_ENGINE_TOKEN } from "@/modules/ai-harness/facade";

@Module({
  providers: [
    ReportSynthesisEngine,
    // String-token alias for cross-layer DI via facade IntelligenceFeature
    {
      provide: REPORT_SYNTHESIS_ENGINE_TOKEN,
      useExisting: ReportSynthesisEngine,
    },
  ],
  exports: [ReportSynthesisEngine, REPORT_SYNTHESIS_ENGINE_TOKEN],
})
export class SynthesisModule {}
