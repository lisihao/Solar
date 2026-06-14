/**
 * Observability Module
 *
 * 提供 AI Engine 的可观测性能力：
 * - TraceCollectorService: 执行链路追踪（Trace + Span）
 * - AiObservabilityService: LLM 调用指标聚合
 * - CostAttributionService: 成本归因与预算告警
 * - SessionLatencyTrackerService: 会话延迟追踪
 * - ObservabilityController: Admin Trace 查询端点
 *
 * 本模块是 @Global()，所有其他模块无需显式 import 即可注入这些 service。
 * （保持与原 AiKernelModule 等价的全局注入体验。）
 */

import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { TraceCollectorService } from "./trace-collector.service";
import { AiObservabilityService } from "./ai-observability.service";
import { CostAttributionService } from "./cost-attribution.service";
import { SessionLatencyTrackerService } from "../latency/session-latency-tracker.service";
import { EvalPipelineService } from "../experiments/eval-pipeline.service";
import { EvalHarnessService } from "../experiments/eval-harness.service";
import { EvalExperimentService } from "../experiments/eval-experiment.service";
import {
  EVAL_RUN_STORE,
  InMemoryEvalRunStore,
  PrismaEvalRunStore,
  createEvalRunStore,
} from "../experiments/eval-run.store";
import { LlmEventsListener } from "./llm-events.listener";

const OBSERVABILITY_PROVIDERS = [
  TraceCollectorService,
  AiObservabilityService,
  CostAttributionService,
  SessionLatencyTrackerService,
  EvalPipelineService,
  InMemoryEvalRunStore,
  PrismaEvalRunStore,
  {
    provide: EVAL_RUN_STORE,
    useFactory: createEvalRunStore,
    inject: [InMemoryEvalRunStore, PrismaEvalRunStore],
  },
  EvalHarnessService,
  EvalExperimentService,
];

@Global()
@Module({
  imports: [PrismaModule],
  providers: [...OBSERVABILITY_PROVIDERS, LlmEventsListener],
  exports: OBSERVABILITY_PROVIDERS,
})
export class ObservabilityModule {}
